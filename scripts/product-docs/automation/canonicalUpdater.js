'use strict';

// Executes ONLY the actions documentationPlanner marked justified: true.
// Every write is section-aware (markdownSections.js) and atomic
// (atomicWrite.js) — never a whole-file rewrite, never a silent deletion.
// Evidence-pending fields are written as the literal phrase
// "Evidence pending — not yet documented as fact." per
// docs/product/05_DOCUMENTATION_WORKFLOW.md § Evidence Discipline — never a
// guessed value.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');
const { PRODUCT_DOCS_ROOT } = require('../lib/repoRoot');
const { atomicWriteFileSync } = require('./atomicWrite');
const { appendLineToSection, insertAfterFirstRule } = require('./markdownSections');
const { allocateAndWriteRecord, acquireLock, releaseLock } = require('./recordAllocator');

// Non-record canonical writes (changelog, feature-evolution journal,
// dependency links) don't go through recordAllocator's per-family lock —
// they need a SINGLE lock so two genuinely concurrent `finalize` runs can't
// race a read-modify-write on the same file and silently drop one writer's
// entry (found in architecture review: idempotency protects a *retried*
// finalize, not two truly simultaneous ones). Reuses the same lock
// primitives with a dedicated lock-file name.
const CANONICAL_WRITE_LOCK = 'canonical-docs';

const EVIDENCE_PENDING = 'Evidence pending — not yet documented as fact.';
const CHANGELOG_PATH = path.join(REPO_ROOT, 'docs', 'product', '10_CHANGELOG.md');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function val(v) {
  if (v === null || v === undefined || v === '') return EVIDENCE_PENDING;
  return String(v);
}

function listOrNone(arr, none = 'None recorded.') {
  return Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : none;
}

// --- Changelog -------------------------------------------------------

function renderChangelogEntry(packet, classification, plan) {
  const title = packet.task_title || 'Untitled change';
  const bullets = [];
  bullets.push(`- **Task type**: ${packet.task_type} — ${val(packet.task_summary)}`);
  if (classification.primary_feature_ids.length) bullets.push(`- **Affected feature(s)**: ${classification.primary_feature_ids.join(', ')}`);
  if (classification.affected_roadmap_ids.length) bullets.push(`- **Affected roadmap milestone(s)**: ${classification.affected_roadmap_ids.join(', ')}`);
  if ((packet.commits || []).length) bullets.push(`- **Commits**: ${packet.commits.map((c) => c.hash || c).join(', ')}`);
  if ((packet.tests_run || []).length) bullets.push(`- **Tests**: ${packet.tests_run.join(', ')}`);
  if ((packet.unresolved_gaps || []).length) bullets.push(`- **Unresolved gaps**: ${packet.unresolved_gaps.join('; ')}`);
  bullets.push(`- **Evidence confidence**: ${classification.confidence} (session \`${packet.session_id}\`)`);
  return `## ${today()} — ${title}\n\n${bullets.join('\n')}`;
}

function applyChangelog(packet, classification, plan) {
  if (!plan.justified) return { applied: false, reason: plan.reason };
  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const entry = renderChangelogEntry(packet, classification, plan);
  const updated = insertAfterFirstRule(content, entry);
  if (updated !== content) atomicWriteFileSync(CHANGELOG_PATH, updated);
  return { applied: updated !== content, path: 'docs/product/10_CHANGELOG.md' };
}

// --- Feature evolution -------------------------------------------------

// parsed.features.get(id).filePath is relative to PRODUCT_DOCS_ROOT (see
// scripts/product-docs/lib/parseProductDocs.js's relPath helper), NOT the
// repository root — must be re-anchored before any fs call.
function findFeatureFile(parsed, featureId) {
  const feat = parsed.features.get(featureId);
  return feat ? path.join(PRODUCT_DOCS_ROOT, feat.filePath) : null;
}

function renderFeatureEvolutionLine(packet) {
  const date = today();
  const summary = val(packet.implementation_summary || packet.task_summary);
  const evidence = (packet.commits || []).map((c) => c.hash || c).join(', ') || `session ${packet.session_id}`;
  return `- **${date}** — ${summary} (evidence: ${evidence})`;
}

function applyFeatureEvolution(packet, parsed, plan) {
  if (!plan.justified) return { applied: false, reason: plan.reason, feature_id: plan.feature_id };
  const filePath = findFeatureFile(parsed, plan.feature_id);
  if (!filePath) return { applied: false, reason: `${plan.feature_id} has no canonical file`, feature_id: plan.feature_id };
  const content = fs.readFileSync(filePath, 'utf8');
  const line = renderFeatureEvolutionLine(packet);
  const updated = appendLineToSection(content, 'Evolution / Implementation Journal', line);
  if (updated !== content) atomicWriteFileSync(filePath, updated);
  return { applied: updated !== content, feature_id: plan.feature_id, path: path.relative(REPO_ROOT, filePath).split(path.sep).join('/') };
}

// --- Feature lifecycle forward-links (Known Bugs / Decisions) ----------

// Real filenames carry a slug suffix (BUG-001_NAME.md), never just the ID —
// resolve the actual basename from the parsed record rather than guessing it.
function recordBasename(parsed, kind, id) {
  const map = kind === 'bug' ? parsed.bugs : parsed.decisions;
  const rec = map.get(id);
  return rec ? path.basename(rec.filePath) : `${id}.md`;
}

function applyDependencyLink(parsed, plan) {
  const filePath = findFeatureFile(parsed, plan.feature_id);
  if (!filePath) return { applied: false, reason: `${plan.feature_id} has no canonical file`, feature_id: plan.feature_id };
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const link of plan.links) {
    const heading = link.kind === 'bug' ? 'Known Bugs / Troubleshooting' : 'Decisions';
    const basename = recordBasename(parsed, link.kind, link.id);
    const linkLine = `- [${link.id}](../${link.kind === 'bug' ? 'bugs' : 'decisions'}/${basename}) — see that record for detail.`;
    try {
      const updated = appendLineToSection(content, heading, linkLine);
      if (updated !== content) {
        content = updated;
        changed = true;
      }
    } catch {
      // Section not found under that exact heading — skip rather than guess a location.
    }
  }
  if (changed) atomicWriteFileSync(filePath, content);
  return { applied: changed, feature_id: plan.feature_id };
}

// --- Bug / decision / postmortem record creation ------------------------

function renderBugRecord(id, bug, packet) {
  const relatedFeatures = listOrNone(bug.related_feature_ids || packet.affected_feature_ids, 'None recorded');
  return `# ${id} — ${bug.title || packet.task_title}

| Field | Value |
|---|---|
| Related feature(s) | ${relatedFeatures} |
| Status | ${val(bug.status || 'Fixed')} |
| Severity | ${val(bug.severity)} |
| Discovered | ${bug.discovered_date || today()} |
| Fixed | ${bug.fixed_date || (bug.status === 'Fixed' ? today() : 'Not yet fixed')} |
| Evidence status | Recorded by automated documentation orchestration from session \`${packet.session_id}\`; evidence source(s): ${listOrNone(packet.evidence_sources)} |

## Symptom

${val(bug.symptom)}

## Root Cause

${val(bug.root_cause)}

## Investigation Log

- **${today()}** — ${val(bug.investigation_notes || packet.implementation_summary)}

## Fix

${val(bug.fix || packet.implementation_summary)}

## Prevention / Reusable Lesson

${val(bug.prevention)}

## Related

${listOrNone((packet.decisions_made || []).map((d) => d.decision_id).filter(Boolean))}
`;
}

function renderDecisionRecord(id, packet) {
  const alts = (packet.alternatives_considered || []).map((a, i) => `${i + 1}. **${a.name || `Option ${i + 1}`}** — ${val(a.description)}`).join('\n') || EVIDENCE_PENDING;
  return `# ${id} — ${packet.task_title}

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | ${listOrNone([...(packet.affected_feature_ids || []), ...(packet.affected_roadmap_ids || [])])} |
| Status | Accepted |
| Date | ${today()} |
| Evidence status | Recorded by automated documentation orchestration from session \`${packet.session_id}\` |

## Context

${val(packet.task_summary)}

## Options Considered

${alts}

## Decision

${val(packet.accepted_solution)}

## Consequences

${val(packet.risks && packet.risks.join('; '))}

## Reconciliation Note

None recorded.
`;
}

function renderPostmortemRecord(id, packet) {
  return `# ${id} — ${packet.task_title}

| Field | Value |
|---|---|
| Related feature(s) | ${listOrNone(packet.affected_feature_ids)} |
| Severity | ${val(packet.release_impact && packet.release_impact.severity)} |
| Date of incident | ${val(packet.release_impact && packet.release_impact.incident_date)} |
| Date resolved | ${today()} |
| Evidence status | Recorded by automated documentation orchestration from session \`${packet.session_id}\` |

## Summary

${val(packet.task_summary)}

## Impact

${val(packet.release_impact && packet.release_impact.impact_description)}

## Timeline

- **${today()}** — ${val(packet.implementation_summary)}

## Root Cause

${val(packet.root_cause)}

## Resolution

${val(packet.implementation_summary)}

## Follow-up Actions

${listOrNone(packet.unresolved_gaps)}

## Related

${listOrNone(packet.affected_feature_ids)}
`;
}

const ID_PLACEHOLDER = '{{RECORD_ID}}';

// Record content cites its own ID in the heading, but the ID is only known
// once allocateAndWriteRecord has taken the lock and computed the next
// number. Render with a placeholder, allocate+write once under the lock,
// then substitute the placeholder in a second atomic pass — the file is
// never visible on disk with the placeholder still in it because both
// writes happen back-to-back before any other process can plausibly open it
// for a purpose other than another allocation (which only reads the
// directory listing, not file contents).
function allocateTemplatedRecord(family, slug, renderFn) {
  const draft = renderFn(ID_PLACEHOLDER);
  const { id, relPath } = allocateAndWriteRecord(family, slug, draft);
  const finalPath = path.join(REPO_ROOT, relPath);
  const withId = fs.readFileSync(finalPath, 'utf8').split(ID_PLACEHOLDER).join(id);
  atomicWriteFileSync(finalPath, withId);
  return { id, relPath };
}

// Record creation must be retry-safe: if `finalize` throws partway through
// applyPlan (a later item's write fails) and the caller retries, the SAME
// evidence must not allocate a second BUG-###/DEC-###/PM-### ID (found in
// code review — plan.bug is the actual packet.bugs_discovered[idx] object
// reference, so this mutation is durably visible on the packet once
// persisted). documentationPlanner checks `created_record_id` and marks a
// re-planned entry as already-recorded rather than re-offering it.
function applyBugRecord(packet, plan) {
  if (plan.bug && plan.bug.created_record_id) return { applied: false, reason: `already recorded as ${plan.bug.created_record_id}`, id: plan.bug.created_record_id };
  if (!plan.justified) return { applied: false, reason: plan.reason };
  const bug = plan.bug || {};
  const { id, relPath } = allocateTemplatedRecord('bug', bug.title || packet.task_title, (id) => renderBugRecord(id, bug, packet));
  if (plan.bug) plan.bug.created_record_id = id; // mutates packet.bugs_discovered[idx] in place
  return { applied: true, id, path: relPath };
}

function applyDecisionRecord(packet, plan) {
  if (packet.decision_record_created_id) return { applied: false, reason: `already recorded as ${packet.decision_record_created_id}`, id: packet.decision_record_created_id };
  if (!plan.justified) return { applied: false, reason: plan.reason };
  const { id, relPath } = allocateTemplatedRecord('decision', packet.task_title, (id) => renderDecisionRecord(id, packet));
  packet.decision_record_created_id = id;
  return { applied: true, id, path: relPath };
}

function applyPostmortemRecord(packet, plan) {
  if (packet.postmortem_record_created_id) return { applied: false, reason: `already recorded as ${packet.postmortem_record_created_id}`, id: packet.postmortem_record_created_id };
  if (!plan.justified) return { applied: false, reason: plan.reason };
  const { id, relPath } = allocateTemplatedRecord('postmortem', packet.task_title, (id) => renderPostmortemRecord(id, packet));
  packet.postmortem_record_created_id = id;
  return { applied: true, id, path: relPath };
}

// --- Top-level entry point ----------------------------------------------

// Applies the whole plan produced by documentationPlanner. Returns a
// structured report of what was applied vs. skipped — never throws for a
// "not justified" action (that's expected, honest output), only for a
// genuine write failure.
function applyPlan(packet, classification, plan, parsed) {
  // Serializes ALL canonical-doc mutation across concurrent `finalize` runs
  // (not just record allocation, which recordAllocator already protects
  // per-family) — otherwise two genuinely simultaneous sessions could race
  // a read-modify-write on the same changelog/feature file and silently
  // drop one writer's entry (architecture review finding).
  const lockToken = acquireLock(CANONICAL_WRITE_LOCK);
  try {
    const report = {
      changelog: applyChangelog(packet, classification, plan.changelog[0] || { justified: false, reason: 'no changelog plan' }),
      feature_evolution: plan.feature_evolution.map((p) => applyFeatureEvolution(packet, parsed, p)),
      dependency_links: plan.dependency_links.map((p) => applyDependencyLink(parsed, p)),
      bug_records: plan.bug_records.map((p) => applyBugRecord(packet, p)),
      decision_records: plan.decision_records.map((p) => applyDecisionRecord(packet, p)),
      postmortems: plan.postmortems.map((p) => applyPostmortemRecord(packet, p)),
    };
    return report;
  } finally {
    releaseLock(CANONICAL_WRITE_LOCK, lockToken);
  }
}

module.exports = {
  EVIDENCE_PENDING,
  applyPlan,
  applyChangelog,
  applyFeatureEvolution,
  applyDependencyLink,
  applyBugRecord,
  applyDecisionRecord,
  applyPostmortemRecord,
  renderChangelogEntry,
  renderBugRecord,
  renderDecisionRecord,
  renderPostmortemRecord,
};
