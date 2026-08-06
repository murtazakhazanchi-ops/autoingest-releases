'use strict';

// Part 6 session lifecycle: start -> event/feedback/plan/... (events.js) ->
// finalize (significance check -> compile -> allocate -> rebuild indexes ->
// cross-link feature files -> validate). Mirrors automation/orchestrator.js's
// shape deliberately (see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 13)
// but is a separate module: a memory session may exist with no linked Part 5
// Evidence Packet at all (a pure investigation/import-driven capsule).

const fs = require('fs');
const path = require('path');
const events = require('./events');
const { planMemoryCapsule } = require('./significance');
const { allocateTemplatedCapsule } = require('./allocator');
const { compileCapsule } = require('./compiler');
const { MEMORY_DOCS_ROOT, PROCESSED_DIR, FAILED_DIR } = require('./paths');
const { atomicWriteFileSync, appendJsonLineSync } = require('../atomicWrite');
const { AUDIT_DIR } = require('./paths');
const build = require('../../lib/build');
const { appendLineToSection } = require('../markdownSections');
const evidencePacket = require('../evidencePacket');

function slugify(title) {
  return String(title || 'UNTITLED').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'UNTITLED';
}

function start({ title, taskId, sourceTool, linkedPacketSessionId }) {
  const sessionId = events.newSessionId();
  events.touchSessionMeta(sessionId);
  const ev = events.buildEvent({
    sessionId,
    type: 'task_started',
    taskId: taskId || sessionId,
    sourceTool,
    sourceType: 'native-lifecycle',
    summary: title || 'Evidence pending — source conversation unavailable',
    confidence: 'explicit',
    detail: linkedPacketSessionId ? { linked_packet_session_id: linkedPacketSessionId } : {},
  });
  events.appendEvent(ev);
  return { sessionId, event: ev };
}

function recordAuditRun(entry) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  appendJsonLineSync(path.join(AUDIT_DIR, 'runs.jsonl'), entry);
}

// Cross-links the newly-created capsule into every primary feature file's
// Engineering Evolution section — idempotent (markdownSections.js's own
// append-if-not-present guarantee), exact-line dedupe, never a second-time
// duplicate on a repeated finalize. `capsuleFileName` must be the capsule's
// REAL on-disk basename (allocator.js's return value), never re-derived from
// `title` here — re-slugifying the title independently can silently diverge
// from the slug allocateAndWriteRecord actually used (its own slug input,
// truncation, and stripping rules aren't guaranteed identical to a second,
// separate slugify() call over a possibly-different title string).
function crossLinkFeatures(capsuleId, capsuleFileName, title, featureIds) {
  const linked = [];
  for (const featId of featureIds) {
    const files = fs.readdirSync(path.join(require('../paths').REPO_ROOT, 'docs', 'product', 'features'))
      .filter((f) => f.startsWith(`${featId}_`) && f.endsWith('.md'));
    if (!files.length) continue;
    const filePath = path.join(require('../paths').REPO_ROOT, 'docs', 'product', 'features', files[0]);
    const content = fs.readFileSync(filePath, 'utf8');
    const line = `- **Engineering memory**: [${capsuleId}](../memory/${capsuleFileName}) — ${title}.`;
    try {
      const updated = appendLineToSection(content, 'Engineering Evolution', line);
      if (updated !== content) {
        atomicWriteFileSync(filePath, updated);
        linked.push(path.relative(require('../paths').REPO_ROOT, filePath).split(path.sep).join('/'));
      }
    } catch {
      // Section not found (a record file, not a feature file, or a feature
      // file predating the Engineering Evolution section) — skip silently,
      // this is a best-effort cross-link, never a hard requirement.
    }
  }
  return linked;
}

// The Part 6 finalize sequence. Idempotent: a session already carrying
// memory_capsule_id in its meta is a no-op on a repeated call, mirroring
// canonicalUpdater.js's created_record_id guard exactly.
function finalize(sessionId, { title, packet, mode } = {}) {
  const meta = events.loadSessionMeta(sessionId) || { session_id: sessionId };
  if (meta.memory_capsule_id) {
    return { created: false, alreadyCompiled: true, capsuleId: meta.memory_capsule_id };
  }

  const sessionEvents = events.loadEvents(sessionId);
  const plan = planMemoryCapsule(packet, sessionEvents);

  if (!plan.justified) {
    events.setSessionStatus(sessionId, 'skipped-insignificant');
    recordAuditRun({ at: new Date().toISOString(), session_id: sessionId, outcome: 'skipped', reason: plan.reason });
    return { created: false, alreadyCompiled: false, plan };
  }

  if (mode === 'observe') {
    // OBSERVE never writes canonical memory — structural gate, matching
    // Part 5's own OBSERVE guarantee for canonicalUpdater/lifecycleUpdater.
    return { created: false, alreadyCompiled: false, plan, observedOnly: true };
  }

  const resolvedTitle = title || (packet && packet.task_title) || (sessionEvents[0] && sessionEvents[0].summary) || 'Untitled Engineering Memory';
  const sourceTools = Array.from(new Set(sessionEvents.map((e) => e.source_tool).filter(Boolean)));

  const { id, relPath } = allocateTemplatedCapsule(
    slugify(resolvedTitle),
    (placeholderOrId) => compileCapsule(placeholderOrId, { sessionId, title: resolvedTitle, events: sessionEvents, packet, sourceTools }),
  );

  events.touchSessionMeta(sessionId);
  const updatedMeta = events.loadSessionMeta(sessionId);
  updatedMeta.memory_capsule_id = id;
  updatedMeta.memory_capsule_path = relPath;
  updatedMeta.status = 'compiled';
  updatedMeta.updated_at = new Date().toISOString();
  atomicWriteFileSync(path.join(require('./paths').RAW_DIR, `${sessionId}.meta.json`), JSON.stringify(updatedMeta, null, 2) + '\n');

  const featureIds = Array.from(new Set([
    ...((packet && packet.affected_feature_ids) || []),
    ...sessionEvents.flatMap((e) => (e.related_ids || []).filter((x) => /^AI-FEAT-\d{3}$/.test(x))),
  ]));
  const crossLinked = crossLinkFeatures(id, path.basename(relPath), resolvedTitle, featureIds);

  let rebuildOk = true;
  let rebuildError = null;
  try {
    build.assemble(); // in-memory rebuild sanity check; the CLI's own `build`/`validate` commands write it to disk
  } catch (err) {
    rebuildOk = false;
    rebuildError = err.message;
  }

  recordAuditRun({
    at: new Date().toISOString(), session_id: sessionId, outcome: 'compiled',
    capsule_id: id, cross_linked_features: crossLinked, rebuild_ok: rebuildOk,
  });

  return { created: true, capsuleId: id, relPath, plan, crossLinkedFeatures: crossLinked, rebuildOk, rebuildError };
}

// Called from automation/orchestrator.js's finalize(), best-effort — never
// throws out to the caller, since a memory-compilation failure must not
// break Part 5's own finalize (see docs/product/16_ENGINEERING_MEMORY_POLICY.md
// § 16 for the STRICT-mode exception, enforced by the caller inspecting
// this function's return value, not by this function throwing).
function maybeCompileFromPacket(packet) {
  try {
    const sessionId = packet.session_id;
    const meta = events.loadSessionMeta(sessionId);
    const sessionEvents = meta ? events.loadEvents(sessionId) : [];
    const plan = planMemoryCapsule(packet, sessionEvents);
    if (!plan.justified) return { attempted: true, created: false, plan };
    if (!meta) events.touchSessionMeta(sessionId); // memory-only session never explicitly started via `memory start`
    return finalize(sessionId, { title: packet.task_title, packet, mode: packet.automation_mode });
  } catch (err) {
    return { attempted: true, created: false, error: err.message };
  }
}

module.exports = { start, finalize, maybeCompileFromPacket, crossLinkFeatures, slugify };
