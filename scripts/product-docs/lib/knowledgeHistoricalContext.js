'use strict';

const { runQuery } = require('./query');
const { findConcept } = require('./intentConcepts');

// Part 5 Phase 5.3 (Decision 5 of 8) — Memory (AI-MEM-####) / Architectural
// Evolution as bounded historical/evolutionary context. Unlike Phase 5.1's
// Decision/Postmortem visibility (unconditional relationship -> sources[],
// materiality judged only in a separate diagnostic layer), Decision 5
// requires materiality to gate VISIBILITY ITSELF for Memory/Architecture —
// "historical context still has to be materially necessary" to even appear.
// historicalContextForFeature() below is the ONE real implementation of
// that four-stage test (historical intent -> grounding -> materiality ->
// admission); knowledgeEngine.js's answerFromRecord() calls it and appends
// only the ADMITTED entries into the real, public sources[] (see that
// file's own comment at the call site), and explainHistoricalContext()
// (also below) is a thin, read-only diagnostic wrapper over the exact same
// function, reporting admitted AND rejected candidates with reasons — same
// "one real implementation, diagnostics observe it" discipline as
// explainNormalization()/explainRelationships()/explainNeighborhood(), only
// here the "real implementation" is consulted by answerQuestion() itself
// (through answerFromRecord()), not diagnostic-only. This was a deliberate
// design choice, made because Decision 6's own pre-scaffolded regression
// entries (RF-5.3-001/002, RF-5.4-005) already assert against real
// sources[]/matchedCapabilities membership via requiredMemberIds/
// mustNotContainMemoryRecord — the harness vocabulary that exists is for
// the real answer object, not a second seam. See the Phase 5.3 Pre-Commit
// Report for the full disclosure of this choice and the alternative
// (diagnostic-only) considered and rejected.
//
// Structural status prohibition: admitted entries are appended to sources[]
// ONLY (see knowledgeEngine.js's answerFromRecord()) — capabilityStatus is
// computed earlier, from knowledgeRecord.operatorStatus alone, and this
// module has no return path that reaches it. Exactly the same structural
// guarantee Phase 5.1's Decision/Postmortem sources[] append already relies
// on (sourcesForRecord() runs after status is decided) — not a new
// mechanism, reused verbatim.
//
// Canonical anchor first (Decision 5, explicit): every caller here is given
// the primary Feature ID ALREADY decided by answerQuestion()'s existing,
// completely unmodified ranking/selection logic — this module never
// searches for a Memory/Architecture record first and backfills a feature.
//
// Real schema differences found during investigation (Memory and
// Architecture are NOT treated as one abstraction):
//   - Memory grounds Memory -> Feature: a capsule's own Scope table (Primary
//     + Secondary feature IDs, lib/memoryIndex.js, already merged into the
//     search index's related_ids — no new parsing). One-directional; no
//     structured Feature -> Memory field exists (a capsule is cross-linked
//     into a feature's Engineering Evolution section as free-text prose by
//     scripts/product-docs/automation/memory/lifecycle.js's crossLinkFeatures,
//     not a parseable ID field), so no "direct vs. reverse-lookup" or
//     "reciprocal citation" signal (Phase 5.2's governance discriminators)
//     exists for Memory to reuse — inventing one would be exactly the
//     "manufactured reverse edge" Decision 5 prohibits. Materiality is
//     instead judged from real, already-computed memoryIndex fields:
//     revision_count / rejected_approaches / unresolved_items — a capsule
//     with none of these carries no distinguishing chronology beyond the
//     bare citation and is judged non-material.
//   - Architecture grounds Feature -> Architecture: a feature's own "Related
//     architectural evolution sections" Lifecycle Metadata field (real,
//     pre-existing, structured — see lib/authorityTopics.js's
//     extractArchitectureSectionIds), citing one or more
//     11_ARCHITECTURAL_EVOLUTION.md §3 sections. One-directional the other
//     way; §3 sections are prose, not individually-authored records with
//     their own header table, so there is no reciprocal or chronology
//     signal to check — a direct structured citation is trusted as
//     sufficient materiality once historical intent is present, mirroring
//     Phase 5.1's own precedent for Decision/Postmortem citations.
// Both share the SAME four-stage admission frame (historical intent ->
// grounding -> materiality -> admission) but each stage's concrete
// grounding/materiality test is type-specific, per Decision 5's explicit
// instruction not to force one abstraction merely because both are
// "historical."
//
// Grounding is Feature-primary only (verified: neither schema has a
// Workflow-citation field at all — Memory's Scope table has no "Related
// workflow IDs" row, and a Workflow's own header table has no "Related
// architectural evolution sections" row either) — answerFromWorkflow() is
// simply never wired to call this module at all (a Workflow-primary answer
// gets nothing, honestly, not a fabricated relationship); the diagnostic
// wrapper reports an explicit note for that case.

// Curated, deterministic, single-boolean historical-intent detector — same
// tier of mechanism as lib/intentConcepts.js's concept hints and
// lib/statusResolution.js's boundary triggers, NOT a second question-type
// classifier and NOT semantic/LLM matching. Built and empirically verified
// against real probe questions during the Phase 5.3 investigation (see the
// Pre-Commit Report): classifyQuestion()'s own single EXPLANATION rule
// (broadened in Phase 4.4 for "why is/was/does X exist/created/designed/
// built/architected") already treats some historical-rationale phrasing as
// EXPLANATION, but real natural phrasings like "how did X evolve" or "why
// was X consolidated" classify UNKNOWN under that classifier entirely (its
// RULES array has no category for retrospective/evolutionary intent) — this
// detector is a narrower, additive, orthogonal signal answering one question
// only ("does this ask about the past/how something changed"), independent
// of classifyQuestion()'s own question-TYPE dimension. A real, disclosed
// limitation: this is a curated phrase list, not exhaustive — a genuinely
// historical question phrased outside these patterns will not be detected,
// exactly as classifyQuestion() itself already discloses for its own RULES.
const HISTORICAL_INTENT_RE = /\b(why (was|were)\b|how did .+ (evolve|evolved|change|changed)|evolution of|history of|historical(ly)?\b|originally\b|used to\b|what changed|what (product-owner|user|customer) feedback|what led to|led to (the|this)\b|background on\b|rationale behind\b|revis(ed|ion)\b|what was .+ before\b|before .+ (existed|was built|was created|autoingest))/i;

function isHistoricalIntent(question) {
  return HISTORICAL_INTENT_RE.test(String(question || ''));
}

function memoryHasGenuineChronology(memDetail) {
  if (!memDetail) return false;
  return (memDetail.revision_count || 0) > 0
    || (memDetail.rejected_approaches && memDetail.rejected_approaches.length > 0)
    || (memDetail.unresolved_items && memDetail.unresolved_items.length > 0);
}

// The one real admission implementation. `featureId` must be a real,
// already-resolved Feature primary ID (the caller's job, not this
// function's — see answerFromRecord()/explainHistoricalContext() below for
// the two ways a caller arrives at one). Returns real candidates split into
// admitted/notAdmitted, each carrying its own reason — never silently
// dropped, per Decision 5's "make visible... admitted/rejected reason"
// requirement.
function historicalContextForFeature(featureId, question, ctx) {
  const historicalIntent = isHistoricalIntent(question);
  const admitted = [];
  const notAdmitted = [];

  // ---- Memory candidates: Memory -> Feature (Scope table), real, one-hop ----
  const memoryRecords = (ctx.searchIndex || []).filter((r) => r.entity_type === 'memory');
  for (const rec of memoryRecords) {
    const grounded = (rec.related_ids || []).includes(featureId);
    if (!grounded) continue; // no real relationship -- never reported, never a phantom edge
    const memDetail = ctx.memoryIndexById ? ctx.memoryIndexById.get(rec.stable_id) : null;
    const hasChronology = memoryHasGenuineChronology(memDetail);
    const entry = {
      id: rec.stable_id,
      type: 'memory',
      role: 'Engineering Memory',
      title: rec.title,
      path: rec.canonical_path,
      materialAspect: 'historical-chronology-and-rationale-evolution',
      groundingSource: `${rec.stable_id}'s own Scope table (Primary/Secondary feature IDs) names ${featureId} — lib/memoryIndex.js's already-parsed related_ids, no new relationship invented.`,
      // Preserved verbatim, never summarized as "verified" — Decision 5's
      // explicit evidence-pending-qualification requirement.
      evidenceQualification: memDetail ? memDetail.evidence_classification : rec.evidence_status,
      historicalOnly: true,
    };
    if (!historicalIntent) {
      notAdmitted.push({ ...entry, reason: `Real relationship exists (${rec.stable_id} cites ${featureId}), but the question does not carry historical/evolutionary intent — grounding alone is not materiality (mirrors Phase 5.2's classification-eligibility discipline: eligibility/relationship is never, by itself, sufficient reason for admission).` });
    } else if (!hasChronology) {
      notAdmitted.push({ ...entry, reason: `Grounded and the question carries historical intent, but ${rec.stable_id} carries no distinguishing revision/rejected-alternative/unresolved-item chronology (revision_count 0, no rejected approaches recorded, no unresolved items) — nothing here a bare grounding citation would not already say. Not materially necessary; would be pure duplication of the citation itself.` });
    } else {
      admitted.push({ ...entry, reason: `Grounded (${rec.stable_id} cites ${featureId}), the question carries real historical/evolutionary intent, and ${rec.stable_id} carries genuine differentiating chronology (revision_count=${memDetail.revision_count}, ${memDetail.rejected_approaches.length} rejected alternative(s) recorded, ${memDetail.unresolved_items.length} unresolved item(s)) that ${featureId}'s own current-state text does not itself contain.` });
    }
  }

  // ---- Architecture candidates: Feature -> Architecture (Lifecycle field) ----
  const authorityEntry = ctx.authorityIndexByFeatureId ? ctx.authorityIndexByFeatureId.get(featureId) : null;
  const archIds = authorityEntry ? (authorityEntry.relatedArchitectureSections || []) : [];
  for (const archId of archIds) {
    const rec = ctx.searchIndexById ? ctx.searchIndexById.get(archId) : null;
    if (!rec) continue; // defensive only -- verified resolvable at build time, never assumed
    const entry = {
      id: archId,
      type: 'architecture_section',
      role: 'Architectural Evolution',
      title: rec.title,
      path: rec.canonical_path,
      materialAspect: 'architectural-evolution-context',
      groundingSource: `${featureId}'s own "Related architectural evolution sections" Lifecycle Metadata field cites ${archId} — a real, pre-existing structured citation (lib/authorityTopics.js), no new relationship invented.`,
      // Architecture sections carry no per-record evidence-classification
      // field distinct from 11_ARCHITECTURAL_EVOLUTION.md's own document-
      // level evidence discipline (that document's own §1 states it plainly
      // per section) — reported as null rather than a manufactured value.
      evidenceQualification: null,
      historicalOnly: true,
    };
    if (!historicalIntent) {
      notAdmitted.push({ ...entry, reason: `Real relationship exists (${featureId} cites ${archId}), but the question does not carry historical/evolutionary intent — grounding alone is not materiality.` });
    } else {
      admitted.push({ ...entry, reason: `Grounded (${featureId} cites ${archId} directly, a real Lifecycle Metadata citation) and the question carries real historical/evolutionary intent. Architectural Evolution sections are, by 11_ARCHITECTURAL_EVOLUTION.md's own §1 Purpose statement, narrative "how did this come to be" content distinct from a Feature's own current-capability summary.` });
    }
  }

  return { historicalIntent, admitted, notAdmitted };
}

// Diagnostic-only observability wrapper — same discipline as
// explainNormalization()/explainRelationships()/explainNeighborhood():
// `answer` must be the real, already-computed return value of
// answerQuestion(question, ctx), never a second search. Unlike those three,
// this module's core (historicalContextForFeature) is ALSO consulted by
// answerFromRecord() to build the real sources[] (see this file's header) —
// this wrapper exists purely to additionally expose the REJECTED candidates
// and their reasons, which the real answer object (by design) never carries.
function explainHistoricalContext(question, answer, ctx, confidenceFloor, matchQualityFor) {
  const primaryMatch = answer.matchedCapabilities[0] || null;
  const primary = primaryMatch ? { id: primaryMatch.id, entityType: primaryMatch.entityType } : null;
  const currentStatusAuthority = { id: primary ? primary.id : null, capabilityStatus: answer.capabilityStatus };

  if (primary && primary.entityType === 'workflow') {
    return {
      primary,
      historicalIntent: isHistoricalIntent(question),
      admitted: [], notAdmitted: [], currentStatusAuthority,
      unanchored: null,
      note: `workflow-primary: Memory/Architectural-Evolution grounding in Phase 5.3's schema only covers Feature-anchored citations (Memory's own Scope table cites Feature IDs; a Feature's own "Related architectural evolution sections" field cites Architecture sections) — no canonical relationship field exists for workflow-primary answers, so none is fabricated. A Workflow IS a real canonical anchor (unlike the no-primary/governance-primary case below), so the Decision-C unanchored fallback does not apply here either.`,
    };
  }

  if (!primary || primary.entityType !== 'feature') {
    // Part 5 Phase 5.3 Decision C — no Feature/Workflow canonical anchor
    // exists at all (governance-primary, or genuinely no primary). Attempts
    // the same unanchored fallback answerQuestion() itself already computes
    // for this exact case (see knowledgeEngine.js's withUnanchoredHistoricalContext) —
    // reported here for observability/testability, not a second computation
    // with different inputs.
    const uhc = unanchoredHistoricalContext(question, ctx, confidenceFloor, matchQualityFor);
    return {
      primary,
      historicalIntent: uhc.historicalIntent,
      admitted: [],
      notAdmitted: [],
      currentStatusAuthority,
      unanchored: uhc,
      note: !primary
        ? `No primary record resolved for this question. ${uhc.note}`
        : `${primary.entityType}-primary: Memory/Architectural-Evolution grounding in Phase 5.3's schema only covers Feature-anchored citations — no canonical relationship field exists for ${primary.entityType}-primary answers, so none is fabricated. ${uhc.note}`,
    };
  }

  const { historicalIntent, admitted, notAdmitted } = historicalContextForFeature(primary.id, question, ctx);
  return { primary, historicalIntent, admitted, notAdmitted, currentStatusAuthority, unanchored: null, note: null };
}

// Part 5 Phase 5.3 Decision C (Product Owner checkpoint, closure investigation
// + body-indexing correction) — the no-current-anchor fallback. Runs ONLY
// when NO Feature/Workflow canonical anchor exists at all (Governance-primary
// via answerFromGovernanceRecord, or unknownAnswer) — historicalContextForFeature()
// above remains the sole path whenever a real Feature anchor exists,
// completely unchanged. Reuses the EXACT SAME single retrieval pass
// searchCandidates() already performs (the same runQuery()/findConcept()
// calls, same candidateQueries construction) — NOT a second, differently-
// scoped query, NOT decomposition, NOT a parallel historical search engine.
// searchCandidates() already scores memory/architecture_section records in
// that pass; it simply discards them before building the Feature/Workflow/
// Governance candidate pool (see its own `if (r.record.entity_type !== ...)
// continue` line). This function re-runs the identical query construction
// and keeps ONLY what that filter throws away — literally the same data,
// never new data.
//
// Body-indexing correction (Phase 5.3 closure, Product Owner-authorized):
// architecture_section records now carry their own canonical body text in
// their keyword surface (see lib/searchIndex.js's own comment) — no longer
// heading-title-only. This materially improves recall (§3A now genuinely
// retrievable for the required acceptance question) but also increases the
// risk of tangential co-matches sharing a generic or document-wide word
// (empirically found: §3H shares "Aljamea" with §3A purely because both
// happen to mention the institution name, in unrelated contexts). Recall
// alone is therefore never sufficient reason to admit a candidate — see
// pickStrongLeader() below.
//
// Admission gate — reuses the EXISTING trusted quality/tie semantics
// (matchQualityFor, passed in by the caller; the SAME function
// answerQuestion() itself already uses for every other strong/weak,
// tied/untied judgment in this codebase — STRONG_MATCH_FLOOR=500,
// WEAK_SCORE_CEILING=100, tie-count-aware). No new scoring formula, ratio,
// margin constant, or Architecture-specific mechanism was introduced: the
// top-scoring candidate WITHIN EACH entity type (memory, architecture_section
// — evaluated independently, since a genuinely relevant Memory match and a
// genuinely relevant Architecture match are not mutually exclusive for the
// same question) is admitted only when it is quality 'strong' by that exact
// existing definition — i.e., untied among same-type candidates and either
// >= STRONG_MATCH_FLOOR or > WEAK_SCORE_CEILING. Every non-leading candidate
// within a type (however far above the evidence floor) is excluded purely by
// not being the type's own top-1 — not a manufactured threshold on that
// candidate specifically.
//
// `confidenceFloor`/`matchQualityFor` are passed in by the caller
// (knowledgeEngine.js's own CONFIDENCE_FLOOR/matchQualityFor) rather than
// re-imported here, to avoid a circular require (knowledgeEngine.js already
// requires this module).
function pickStrongLeader(bucket, confidenceFloor, matchQualityFor) {
  const all = Array.from(bucket.values());
  if (!all.length) return null;
  all.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const top = all[0];
  if (top.score < confidenceFloor) return null;
  const tiedCount = all.filter((c) => c.score === top.score).length;
  return matchQualityFor(top.score, tiedCount) === 'strong' ? top : null;
}

function unanchoredHistoricalContext(question, ctx, confidenceFloor, matchQualityFor) {
  const historicalIntent = isHistoricalIntent(question);
  if (!historicalIntent) {
    return { attempted: false, historicalIntent, candidates: [], note: 'Question does not carry historical/evolutionary intent -- fallback not attempted.' };
  }

  const concept = findConcept(String(question || '').toLowerCase());
  const candidateQueries = [question, ...(concept ? concept.hints : [])];
  const bestMemory = new Map();
  const bestArchitecture = new Map();
  for (const cq of candidateQueries) {
    const results = runQuery(cq, ctx.searchIndex, { limit: 20 });
    for (const r of results) {
      const bucket = r.record.entity_type === 'memory' ? bestMemory : r.record.entity_type === 'architecture_section' ? bestArchitecture : null;
      if (!bucket) continue;
      const prev = bucket.get(r.record.stable_id);
      if (!prev || r.score > prev.score) {
        bucket.set(r.record.stable_id, { id: r.record.stable_id, title: r.record.title, path: r.record.canonical_path, score: r.score, entityType: r.record.entity_type });
      }
    }
  }

  const leaders = [
    pickStrongLeader(bestMemory, confidenceFloor, matchQualityFor),
    pickStrongLeader(bestArchitecture, confidenceFloor, matchQualityFor),
  ].filter(Boolean);

  if (!leaders.length) {
    return {
      attempted: true, historicalIntent, candidates: [],
      note: 'No relevant historical material could be deterministically, unambiguously identified for this question (checked the same single retrieval pass already used elsewhere, restricted to memory/architecture_section records; a per-type leader must be strong and untied by the same quality standard every other entity type is held to -- a merely-present or ambiguous/tied candidate is not sufficient). Current implementation/status remains whatever the primary answer already established, unaffected by this fallback.',
    };
  }

  return {
    attempted: true, historicalIntent,
    candidates: leaders.map((c) => ({
      id: c.id,
      type: c.entityType === 'memory' ? 'memory' : 'architecture_section',
      role: c.entityType === 'memory' ? 'Engineering Memory' : 'Architectural Evolution',
      title: c.title,
      path: c.path,
      score: c.score,
      evidenceQualification: c.entityType === 'memory' && ctx.memoryIndexById && ctx.memoryIndexById.get(c.id)
        ? ctx.memoryIndexById.get(c.id).evidence_classification
        : null,
      historicalOnly: true,
      unanchored: true,
    })),
    note: 'Unanchored historical context -- no Feature/Workflow canonical anchor could be established for this question. This material does not establish current implementation/status.',
  };
}

module.exports = { isHistoricalIntent, historicalContextForFeature, explainHistoricalContext, memoryHasGenuineChronology, unanchoredHistoricalContext };
