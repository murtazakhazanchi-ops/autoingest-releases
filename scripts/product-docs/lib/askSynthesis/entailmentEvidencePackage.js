'use strict';

// Ask AutoIngest — Capability Entailment Judge Prototype (checkpoint
// authorized 2026-08-18). Bounded evidence package builder for the
// entailment judge ONLY — deliberately separate from evidencePackage.js
// (which serves full answer synthesis and is scoped much wider). This
// package contains ONLY what Part 3 of the checkpoint brief names: the
// normalized claim, the primary record's display name + Summary + relevant
// limitations, curated TOPIC_ALIASES when applicable, the existing
// KNOWN_BOUNDARIES verdict when applicable, and admitted related evidence —
// never the full corpus, never unrelated retrieved records, never roadmap
// material, never conversation history. Reuses existing, unmodified reads
// only (buildEngineContext()'s own ctx maps, TOPIC_ALIASES, matchKnownBoundary) —
// no new retrieval pass, no ranking change.

const { TOPIC_ALIASES } = require('../authorityTopics');
const { matchKnownBoundary } = require('../statusResolution');
const { displayNameFor } = require('./evidencePackage');
const { assignHandles } = require('./sourceHandles');

const GOVERNANCE_ENTITY_TYPES = new Set(['bug', 'decision', 'postmortem']);

// Phase C1 (Semantic Authority Core Integration, 2026-08-19) fix — a
// Governance-primary answer's `primary.id` is the bug/decision/postmortem's
// OWN id (e.g. "DEC-017"), which never resolves in ctx.knowledgeIndexById
// (Feature records only) -- every previous checkpoint's benchmark only
// ever exercised Feature-primary SUPPORTS cases (verified: all 5 frozen
// gold SUPPORTS cases are Feature-primary), so a Governance-primary
// evidence package silently building ZERO evidence items was never
// surfaced. answerFromGovernanceRecord() (knowledgeEngine.js) always
// constructs `sources` as [governanceRecord, featureContext] in that exact
// order -- the cited Feature the governance record borrowed its
// capabilityStatus from is always sources[1]; this resolves the record
// whose Summary/Limitations/Current-Behavior text should actually become
// evidence (the same feature the deterministic answer's own capability
// claim is grounded in).
function evidenceRecordId(primary, answer) {
  if (!primary) return null;
  if (primary.entityType === 'feature') return primary.id;
  if (GOVERNANCE_ENTITY_TYPES.has(primary.entityType)) {
    const cited = (answer.sources || [])[1];
    return cited ? cited.id : null;
  }
  return null; // workflow-primary or unrecognized -- no evidence-package concept applies
}

// Evidence-minimality variants under investigation (Part 16): the
// checkpoint wants a controlled comparison, not one fixed package. `level`
// selects how much of the primary record is exposed.
//   'summary'      — display name + Summary sentence(s) only
//   'summary+body' — + Limitations + (Workflow) steps/whenToUseIt
//   'full'         — + admitted neighborhood members' own Summary/steps too
function buildEntailmentEvidencePackage(question, claim, answer, ctx, { level = 'summary+body' } = {}) {
  const primary = answer.matchedCapabilities[0] || null;
  const boundary = matchKnownBoundary(question);
  const evidenceId = evidenceRecordId(primary, answer);

  const items = [];
  let idCounter = 0;
  const push = (id, kind, text) => {
    if (!text) return null;
    idCounter++;
    items.push({ id, kind, text });
    return id;
  };

  let primaryEvidenceIds = [];
  if (primary) {
    const displayName = primary.title || displayNameFor(primary.id, ctx);
    const rec = evidenceId && ctx.knowledgeIndexById ? ctx.knowledgeIndexById.get(evidenceId) : null;
    const wf = ctx.workflowIndexById ? ctx.workflowIndexById.get(primary.id) : null;

    if (level !== 'title-only') {
      if (rec && rec.summary) primaryEvidenceIds.push(push(evidenceId, 'summary', rec.summary));
      if (wf && wf.whatItDoes) primaryEvidenceIds.push(push(primary.id, 'summary', wf.whatItDoes));
    }
    if (level === 'summary+body' || level === 'full') {
      if (rec && (answer.limitations || []).length) {
        for (const l of answer.limitations) primaryEvidenceIds.push(push(evidenceId, 'limitation', l));
      }
      if (wf && wf.whenToUseIt) primaryEvidenceIds.push(push(primary.id, 'when-to-use', wf.whenToUseIt));
      if (wf && (wf.steps || []).length) primaryEvidenceIds.push(push(primary.id, 'steps', wf.steps.join(' | ')));
    }
    const aliases = TOPIC_ALIASES[evidenceId];
    if (aliases && aliases.length) primaryEvidenceIds.push(push(evidenceId, 'curated-alias', `Known alternate names for this record: ${aliases.join(', ')}`));
    // Verbatim "## Current Behavior" canonical section text, sourced from
    // the real parsed Feature record (lib/knowledgeIndex.js's
    // currentBehavior field -- itself forwarded unmodified from
    // lib/featureIndex.js/parseProductDocs.js). Current Behavior Evidence
    // Promotion checkpoint (2026-08-19): this replaces the earlier
    // bench-only duplicate extraction (bench/currentBehaviorExtraction.js,
    // now retired). Positioned LAST, after curated-alias, to exactly match
    // the item ORDER the prior checkpoint's bench-only variant used (that
    // variant appended current-behavior after the base package, which
    // already ended with curated-alias) -- item order measurably affects
    // this model's judgment (see the Part 6/10 investigation note below),
    // so this ordering is not cosmetic.
    if (level === 'summary+body' || level === 'full') {
      if (rec && rec.currentBehavior) primaryEvidenceIds.push(push(evidenceId, 'current-behavior', rec.currentBehavior));
    }
  }

  let relatedEvidenceIds = [];
  if (level === 'full') {
    for (const s of (answer.sources || []).slice(1, 4)) {
      const rec = ctx.knowledgeIndexById ? ctx.knowledgeIndexById.get(s.id) : null;
      if (rec && rec.summary) relatedEvidenceIds.push(push(s.id, 'related-summary', rec.summary));
    }
  }

  const pkg = {
    question,
    claim,
    primary: primary ? { id: primary.id, displayName: primary.title || displayNameFor(primary.id, ctx), entityType: primary.entityType } : null,
    deterministicCapabilityStatus: answer.capabilityStatus,
    curatedBoundary: boundary ? { id: boundary.id, statement: boundary.statement, hardOverride: !!boundary.hardOverride } : null,
    evidence: items,
    evidenceLevel: level,
  };

  // Opaque handles built from the SAME mechanism proven in Phase A.2 —
  // reused, not reimplemented. The "legitimateSourceIds" here are the
  // evidence ITEM ids (record IDs may repeat across several evidence items
  // -- e.g. a Summary and a Limitation from the same Feature -- so handles
  // are assigned per unique record ID, and each evidence item also carries
  // its own record's handle for citation).
  const uniqueIds = Array.from(new Set(items.map((i) => i.id).filter(Boolean)));
  const handleMap = assignHandles({ legitimateSourceIds: uniqueIds, sources: [], relatedCapabilities: [], admittedNeighborhood: [], visibleNotAdmitted: [], historical: { admitted: [], notAdmitted: [] }, primary: pkg.primary, searchIndexById: undefined });
  // assignHandles() looks up display names via several evidencePackage
  // fields this bounded package doesn't have -- backfill with the record's
  // own already-resolved display name directly instead of re-deriving.
  for (const id of uniqueIds) {
    if (!handleMap.displayNameByHandle.get(handleMap.handleById.get(id))) {
      const name = primary && primary.id === id ? pkg.primary.displayName : displayNameFor(id, ctx);
      handleMap.displayNameByHandle.set(handleMap.handleById.get(id), name);
    }
  }

  pkg.evidence = pkg.evidence.map((e) => ({ ...e, handle: handleMap.handleById.get(e.id) }));

  return { pkg, handleMap };
}

module.exports = { buildEntailmentEvidencePackage };
