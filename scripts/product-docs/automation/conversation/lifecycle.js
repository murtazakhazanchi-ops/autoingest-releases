'use strict';

// Part 8 — the end-to-end conversation import pipeline. Orchestrates every
// module in this directory in the order documented in
// docs/product/conversations/README.md: load -> parse -> redact ->
// schema-validate -> fingerprint -> duplicate/continuation-detect ->
// significance-gate -> ownership-resolve -> allocate ID -> write canonical
// -> decision/bug/memory linkage -> rebuild generated indexes -> audit.
//
// Transactional: a staged snapshot is written to processing/ before any
// canonical write is attempted; on success it moves to imported/
// (or duplicates/ / rejected/ for the non-canonical outcomes); on an
// unexpected failure it moves to failed/ with the error preserved — the
// raw packet is never lost, and canonical docs/product/ content is never
// left half-written (every canonical write here is itself atomic, per
// atomicWrite.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadFile, resolveWithinRepo } = require('./fileLoader');
const { parseByFormat } = require('./adapters');
const { normalizeEcp } = require('./ecp');
const { redactPacket, scanPacketForSecrets, minimizeToRecognizedFields } = require('./redactor');
const { sanitizeDeep } = require('./markdownSanitizer');
const { fingerprintPacket } = require('./fingerprint');
const { findExactDuplicate, findPossibleContinuation } = require('./dedupe');
const { planConversationCanonicalization } = require('./significance');
const { allocateTemplatedConversation } = require('./allocator');
const { compileConversationRecord } = require('./compiler');
// ownership.js/decisionLink.js/bugLink.js/memoryLink.js are required lazily,
// at their call sites below, rather than at module top — matches
// automation/cli.js's own documented convention ("lets each milestone's
// dispatcher wiring land in its own commit without any intermediate commit
// referencing a module that doesn't exist yet at that point in history").
// Loading this file (transitively, via cli.js -> conversationCli.js) must
// never crash an unrelated command (build/validate/memory) just because
// the conversation-intelligence layer hasn't landed yet.
const { atomicWriteFileSync, appendJsonLineSync } = require('../atomicWrite');
const { PROCESSING_DIR, IMPORTED_DIR, REJECTED_DIR, DUPLICATES_DIR, FAILED_DIR, AUDIT_DIR, INBOX_DIR } = require('./paths');
const build = require('../../lib/build');

function newImportId() {
  return `imp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function stagePath(dir, importId) {
  return path.join(dir, `${importId}.json`);
}

function moveStaged(importId, fromDir, toDir, content) {
  atomicWriteFileSync(stagePath(toDir, importId), JSON.stringify(content, null, 2) + '\n');
  const fromPath = stagePath(fromDir, importId);
  if (fs.existsSync(fromPath)) fs.unlinkSync(fromPath);
}

function recordAudit(entry) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  appendJsonLineSync(path.join(AUDIT_DIR, 'runs.jsonl'), { at: new Date().toISOString(), ...entry });
}

// Steps 1-9 of the pipeline: load, parse, redact, normalize, fingerprint,
// dedupe/continuation-check, significance-check, ownership-resolve. Shared
// by both `previewPacket` (no writes) and `importPacket` (writes on top of
// this same analysis) so the two can never disagree about what a given
// packet would do.
function analyzePacket({ format, filePath, raw: providedRaw, sourceLabel }) {
  let raw = providedRaw;
  let absPath = sourceLabel || null;
  if (!raw) {
    const loaded = loadFile(format, filePath);
    raw = loaded.raw;
    absPath = loaded.absPath;
  }
  const parsedPacket = parseByFormat(format, raw, { projectName: 'AutoIngest' });
  const secretHits = scanPacketForSecrets(redactPacket(normalizeEcp(parsedPacket)));
  // Redact, THEN neutralize Markdown structural injection (escapes any
  // line-leading '#' or bare '|' in every string field) — every downstream
  // consumer (compiler.js, decisionLink.js, memoryLink.js, fingerprinting,
  // dedupe) only ever sees this fully-sanitized packet, never the raw
  // parse. See markdownSanitizer.js for why this is applied once, here,
  // rather than scattered per-renderer.
  const redacted = sanitizeDeep(redactPacket(normalizeEcp(parsedPacket)));
  const fingerprint = fingerprintPacket(redacted);

  const { parsed, built } = build.assemble();
  const duplicate = parsed.conversations ? findExactDuplicate(redacted, fingerprint, parsed.conversations) : null;
  const continuation = parsed.conversations ? findPossibleContinuation(redacted, built) : null;
  const significance = planConversationCanonicalization(redacted);
  const { resolveConversationOwnership } = require('./ownership');
  const ownership = resolveConversationOwnership(redacted, { parsed, built });

  return {
    format, sourceFile: absPath ? path.relative(require('./paths').REPO_ROOT, absPath).split(path.sep).join('/') : null,
    packet: redacted, fingerprint, secretHits, duplicate, continuation, significance, ownership, parsed, built,
  };
}

// `conversation preview` — full analysis, zero writes anywhere (not even a
// staged snapshot). OBSERVE-equivalent.
function previewPacket(args) {
  const a = analyzePacket(args);
  return {
    would_import: !a.duplicate && a.significance.justified,
    format: a.format, source_file: a.sourceFile, fingerprint: a.fingerprint,
    secret_pattern_hits: a.secretHits.length, duplicate: a.duplicate, continuation: a.continuation,
    significance: a.significance, ownership: a.ownership, packet_preview: minimizeToRecognizedFields(a.packet),
  };
}

// `conversation validate` — schema/security validation only.
function validatePacket({ format, filePath }) {
  const { raw } = loadFile(format, filePath);
  const parsedPacket = parseByFormat(format, raw, { projectName: 'AutoIngest' });
  const redacted = redactPacket(normalizeEcp(parsedPacket));
  const secretHits = scanPacketForSecrets(redacted);
  return { valid: true, secret_pattern_hits: secretHits.length, secret_fields: secretHits };
}

// `conversation import` — the full pipeline, STANDARD mode by default.
// mode: 'strict' | 'standard' | 'observe' (matches evidencePacket.js's
// AUTOMATION_MODES exactly — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md
// § 18). OBSERVE never writes canonical content, same guarantee as every
// other Part 5-7 module in this system.
function importPacket({ format, filePath, raw, sourceLabel, mode = 'standard' }) {
  const importId = newImportId();
  fs.mkdirSync(PROCESSING_DIR, { recursive: true });

  let analysis;
  try {
    analysis = analyzePacket({ format, filePath, raw, sourceLabel });
  } catch (err) {
    recordAudit({ import_id: importId, outcome: 'parse-failed', error: err.message });
    throw err;
  }

  const stagedSnapshot = {
    import_id: importId, format: analysis.format, source_file: analysis.sourceFile,
    fingerprint: analysis.fingerprint, staged_at: new Date().toISOString(), mode,
    packet: minimizeToRecognizedFields(analysis.packet),
  };
  atomicWriteFileSync(stagePath(PROCESSING_DIR, importId), JSON.stringify(stagedSnapshot, null, 2) + '\n');

  if (analysis.duplicate) {
    moveStaged(importId, PROCESSING_DIR, DUPLICATES_DIR, { ...stagedSnapshot, duplicate_of: analysis.duplicate });
    recordAudit({ import_id: importId, outcome: 'duplicate', duplicate_of: analysis.duplicate.conversation_id });
    return { status: 'duplicate', importId, duplicateOf: analysis.duplicate.conversation_id };
  }

  if (!analysis.significance.justified) {
    moveStaged(importId, PROCESSING_DIR, REJECTED_DIR, { ...stagedSnapshot, reason: analysis.significance.reason });
    recordAudit({ import_id: importId, outcome: 'not-significant', reason: analysis.significance.reason });
    return { status: 'not_significant', importId, reason: analysis.significance.reason };
  }

  if (mode === 'observe') {
    recordAudit({ import_id: importId, outcome: 'observed-only', significance: analysis.significance.reason });
    return { status: 'observed_only', importId, significance: analysis.significance, ownership: analysis.ownership };
  }

  try {
    // Classified by which category actually dominates the packet's content,
    // not by first-non-empty-array — a packet with substantial design
    // content plus one incidental bug mention should read as "design" or
    // "mixed," not "bug-investigation" (found reviewing this module's own
    // first real import, which discussed one bug alongside far more design
    // evolution/decision content).
    const categoryCounts = {
      'bug-investigation': analysis.packet.bugs_discussed.length,
      design: analysis.packet.rejected_approaches.length + analysis.packet.revisions.length,
      requirements: analysis.packet.implementation_requests.length,
    };
    const presentCategories = Object.entries(categoryCounts).filter(([, count]) => count > 0);
    const conversationType = presentCategories.length === 0 ? 'mixed'
      : presentCategories.length > 1 ? 'mixed'
      : presentCategories[0][0];
    const importMeta = {
      format: analysis.format, importId, importedAt: new Date().toISOString(),
      fingerprint: analysis.fingerprint, sourceFile: analysis.sourceFile,
      conversationType,
      provenanceClassification: analysis.secretHits.length
        ? 'Imported packet — automatic redaction applied'
        : 'Imported packet — no secret pattern detected',
      redactionStatusLabel: analysis.secretHits.length ? 'Applied — automatic secret-pattern scan (matches found)' : 'Applied — automatic secret-pattern scan (no matches)',
      fieldsUnavailable: [],
      importNote: `Canonicalized from a "${analysis.format}"-format packet claiming source_tool "${analysis.packet.source_tool}".`,
    };

    // First pass: allocate the real ENG-CONV-#### with linkage sections not
    // yet resolved (they need the real ID). Mirrors every other family's
    // render-placeholder-then-substitute idempotency pattern, extended with
    // a second real content pass rather than a second placeholder pass.
    const draftRecord = compileConversationRecord('{{RECORD_ID}}', {
      packet: analysis.packet, ownership: analysis.ownership, importMeta,
      decisionLinkResult: null, bugLinkResults: null,
    });
    const slug = analysis.packet.conversation_title;
    const { id: conversationId, relPath, filePath: conversationFilePath } = allocateTemplatedConversation(slug, () => draftRecord);

    // Second pass — decision/bug/memory linkage, now that the real
    // conversation ID exists to cite. Deliberately AFTER allocation, and
    // deliberately never reachable from a git hook — see
    // docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10.
    //
    // The ENG-CONV-#### ID is already permanently spent at this point (IDs
    // are never reused/renumbered) — a thrown error from any ONE of these
    // three independent linkage steps must not abort the whole import and
    // leave a stub record whose sections were rendered from null linkage
    // results while the audit trail claims "failed" (found in Part 8 code
    // review). Each is isolated in its own try/catch and degrades to its
    // own honest "not applicable/unmatched"-shaped result on failure,
    // never silently swallowed — the error is preserved on the result for
    // the audit log.
    const { built: freshBuilt } = build.assemble();
    let decisionLinkResult;
    try {
      const { linkOrDraftDecision } = require('./decisionLink');
      decisionLinkResult = linkOrDraftDecision(analysis.packet, { built: freshBuilt }, analysis.ownership, conversationId);
    } catch (err) {
      decisionLinkResult = { state: 'error', error: err.message };
    }
    let bugLinkResults;
    try {
      const { linkBugs } = require('./bugLink');
      bugLinkResults = linkBugs(analysis.packet, { built: freshBuilt });
    } catch (err) {
      bugLinkResults = [];
    }
    let memoryLinkResult;
    try {
      const { linkOrCreateMemory } = require('./memoryLink');
      memoryLinkResult = linkOrCreateMemory(analysis.packet, { built: freshBuilt }, conversationId, { mode });
    } catch (err) {
      memoryLinkResult = { state: 'error', error: err.message };
    }

    // decisionLinkResult can name a decision_id (linked to an existing
    // DEC-### or a freshly-drafted one) that didn't exist yet when
    // analysis.ownership was resolved from the packet's own (necessarily
    // prior) related_decision_ids claim — ownership resolution can't know
    // about a decision this same import is about to link or draft. Without
    // this merge, the Relationships table's "Related decisions" row (and
    // therefore the dependency graph, which parses that table) would show
    // "None" even though the Engineering Decisions section correctly
    // reports the linkage — a real relationship silently invisible to
    // every consumer that reads the structured table instead of the prose.
    const finalOwnership = (decisionLinkResult && decisionLinkResult.decision_id && !analysis.ownership.decision_ids.includes(decisionLinkResult.decision_id))
      ? { ...analysis.ownership, decision_ids: [...analysis.ownership.decision_ids, decisionLinkResult.decision_id] }
      : analysis.ownership;

    const finalContent = compileConversationRecord(conversationId, {
      packet: analysis.packet, ownership: finalOwnership, importMeta,
      decisionLinkResult, bugLinkResults,
    });
    atomicWriteFileSync(conversationFilePath, finalContent);

    const rebuildResult = (() => {
      try {
        build.assemble();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })();

    moveStaged(importId, PROCESSING_DIR, IMPORTED_DIR, {
      ...stagedSnapshot, conversation_id: conversationId, path: relPath,
      decision_link: decisionLinkResult, bug_links: bugLinkResults, memory_link: memoryLinkResult,
    });
    recordAudit({
      import_id: importId, outcome: 'imported', conversation_id: conversationId, path: relPath,
      decision_link: decisionLinkResult.state, memory_link: memoryLinkResult.state, rebuild_ok: rebuildResult.ok,
    });

    return {
      status: 'imported', importId, conversationId, path: relPath,
      ownership: analysis.ownership, decisionLink: decisionLinkResult, bugLinks: bugLinkResults,
      memoryLink: memoryLinkResult, rebuildOk: rebuildResult.ok,
    };
  } catch (err) {
    moveStaged(importId, PROCESSING_DIR, FAILED_DIR, { ...stagedSnapshot, error: err.message });
    recordAudit({ import_id: importId, outcome: 'failed', error: err.message });
    throw err;
  }
}

function listInbox() {
  if (!fs.existsSync(INBOX_DIR)) return [];
  return fs.readdirSync(INBOX_DIR).filter((f) => !f.startsWith('.'));
}

// `conversation process-inbox` — iterates every file currently in the local
// inbox, importing each with STANDARD mode by default, moving the source
// file out of inbox/ regardless of outcome (the outcome itself is recorded
// in imported/duplicates/rejected/failed, matching importPacket's own
// terminal-state contract). Never a long-running daemon — process-on-demand
// only, per docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 16.
function processInbox({ mode = 'standard' } = {}) {
  const files = listInbox();
  const results = [];
  for (const file of files) {
    const filePath = path.join(INBOX_DIR, file);
    const format = file.endsWith('.md') ? 'markdown' : 'json'; // JSON files are format-sniffed as ecp first, falling back to generic json
    let result;
    try {
      result = format === 'json'
        ? tryImportJsonAsEcpThenGeneric(filePath, mode)
        : importPacket({ format, filePath, mode });
    } catch (err) {
      result = { status: 'error', file, error: err.message };
    }
    results.push({ file, ...result });
    // The inbox file itself is removed once its outcome is durably recorded
    // in one of the terminal directories above (or failed/, on error) —
    // never left in inbox/ to be silently reprocessed on the next run.
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }
  return results;
}

function tryImportJsonAsEcpThenGeneric(filePath, mode) {
  try {
    return importPacket({ format: 'ecp', filePath, mode });
  } catch {
    return importPacket({ format: 'json', filePath, mode });
  }
}

module.exports = {
  analyzePacket, previewPacket, validatePacket, importPacket, listInbox, processInbox, newImportId,
};
