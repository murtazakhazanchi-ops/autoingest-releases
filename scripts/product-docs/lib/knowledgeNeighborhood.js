'use strict';

// Part 5 Phase 5.2 (Decision 3 of 8) — minimum-sufficient multi-record
// neighborhood observability. This module NEVER re-decides what
// answerQuestion() already decided for RANKING/PRIMARY SELECTION — it is a
// read-only explanation of the real answer's own sources[]/
// matchedCapabilities, the same "diagnostic, not a second implementation"
// discipline explainNormalization()/explainRelationships() established.
// It DOES perform one real judgment of its own: the three-stage admission
// test below (eligibility -> materiality -> admission) is genuinely new
// reasoning, not present anywhere else — but it only ever LABELS an
// already-produced sources[] entry as admitted/not-admitted, never adds,
// removes, or reorders anything in the public answer object.
//
// Central distinction (Product Owner, Phase 5.2 authorization): sources[]
// VISIBILITY is not NEIGHBORHOOD ADMISSION. Three explicit stages:
//
//   ELIGIBILITY  — is this record even a candidate worth considering?
//                  (independently retrieved above CONFIDENCE_FLOOR, or
//                  visible via a real Phase 5.1 canonical relationship)
//   MATERIALITY  — does *this specific record* answer a distinct aspect
//                  *this specific question* actually requests, that the
//                  primary cannot itself authoritatively supply?
//   ADMISSION    — materiality decided; admitted records form the
//                  minimum-sufficient neighborhood report.
//
// Score/eligibility alone never implies materiality (Decision 3, explicit,
// reaffirmed 2026-08-17 Materiality Correction). The materiality test for
// EVERY role (Workflow included) below now combines TWO independent,
// pre-existing deterministic signals, neither new nor semantic:
//
//   1. Classification-implied aspect need (classifyQuestion(), reused,
//      never a second/multi-label classifier): TROUBLESHOOTING/EXPLANATION
//      for Governance roles; the same workflowPreferredType classification
//      set (HOW_TO/TROUBLESHOOTING/EXPLANATION/TEAM_ACTIVITY) for Workflow.
//   2. Canonical relationship directness (lib/authorityTopics.js's
//      directBugs/directDecisions/directPostmortems, Phase 5.2 addition —
//      see that file's own comment): a citation the canonical Markdown
//      itself marks "found via reverse lookup — not yet cross-linked" is a
//      real, existing, but secondary/tangential relationship, not a
//      primary one. Governance materiality requires DIRECT citation, not
//      merely visible-via-relationship.
//
// Empirical proof this two-signal combination is necessary (not
// arbitrary): raw retrieval score, either absolute or relative to the
// primary's own score, was tested and PROVEN insufficient during the
// investigation — a governance record can score exactly as strongly for a
// materially-irrelevant STATUS question as for a materially-relevant
// TROUBLESHOOTING one (AI-FEAT-032/DEC-009: ratio 1.00 in BOTH cases), and
// a tangential, non-material relationship (AI-FEAT-039/DEC-012, "reverse
// lookup") can score a HIGHER ratio to its primary (0.75) than a
// genuinely-material one (AI-FEAT-047/DEC-011, ratio 0.47) — score ordering
// does not track materiality ordering at all. See DEC-020's Materiality
// Correction entry for the full comparison table.

const AUTHORITY_ROLES = Object.freeze({
  feature: 'what-exists-current-scope',
  workflow: 'how-to-procedure',
  decision: 'why-rationale',
  bug: 'defect-status',
  postmortem: 'incident-root-cause-lesson',
});

const ROLE_LABEL = Object.freeze({
  feature: 'Feature',
  workflow: 'Workflow',
  decision: 'Decision',
  bug: 'Bug',
  postmortem: 'Postmortem',
});

// Materiality-eligible classifications, per role. Workflow reuses EXACTLY
// the same classification set knowledgeEngine.js's own workflowPreferredType
// already uses for a different purpose (selecting a Workflow-primary
// answer) — not a new taxonomy invented for this module.
const GOVERNANCE_ELIGIBLE_CLASSIFICATIONS = new Set(['TROUBLESHOOTING', 'EXPLANATION']);
const WORKFLOW_ELIGIBLE_CLASSIFICATIONS = new Set(['HOW_TO', 'TROUBLESHOOTING', 'EXPLANATION', 'TEAM_ACTIVITY']);

const DIRECT_FIELD_BY_TYPE = Object.freeze({ bug: 'directBugs', decision: 'directDecisions', postmortem: 'directPostmortems' });

function roleFor(entityType) {
  return ROLE_LABEL[entityType] || entityType;
}

// Explains ONE already-produced answer's own sources[]/matchedCapabilities
// — never calls answerQuestion() a second time with different inputs,
// never runs a second search. `answer` must be the real, already-computed
// return value of answerQuestion(question, ctx).
function explainNeighborhood(question, answer, ctx) {
  const primaryMatch = answer.matchedCapabilities[0] || null;
  const primary = primaryMatch ? { id: primaryMatch.id, role: roleFor(primaryMatch.entityType), authorityScope: AUTHORITY_ROLES[primaryMatch.entityType] || null } : null;

  const governanceEligible = GOVERNANCE_ELIGIBLE_CLASSIFICATIONS.has(answer.classification);
  const workflowEligible = WORKFLOW_ELIGIBLE_CLASSIFICATIONS.has(answer.classification);
  const authorityEntry = primary && primaryMatch.entityType === 'feature' && ctx && ctx.authorityIndexByFeatureId
    ? ctx.authorityIndexByFeatureId.get(primary.id)
    : null;

  const admitted = [];
  const notAdmitted = [];
  const consideredIds = new Set(primary ? [primary.id] : []);

  for (const src of answer.sources) {
    if (consideredIds.has(src.id)) continue; // the primary's own self-citation
    consideredIds.add(src.id);
    const entityType = /^AI-WF-/.test(src.id) ? 'workflow'
      : /^AI-RM-/.test(src.id) ? 'roadmap'
      : /^BUG-/.test(src.id) ? 'bug'
      : /^DEC-/.test(src.id) ? 'decision'
      : /^PM-/.test(src.id) ? 'postmortem'
      : /^AI-FEAT-/.test(src.id) ? 'feature'
      : 'unknown';

    if (entityType === 'roadmap') continue; // not a candidate answer authority at all — informational only, never part of the neighborhood question

    const role = roleFor(entityType);

    if (entityType === 'workflow') {
      // ELIGIBILITY already established by findCompanionWorkflow()'s own
      // independent-score selection (knowledgeEngine.js) — real, non-
      // manufactured evidence. MATERIALITY is a SEPARATE, second test: does
      // *this question's own classification* actually indicate a procedural
      // aspect is being asked for? sources[]/guidance/steps themselves are
      // NOT gated by this (pre-existing, unconditional companion-Workflow
      // citation predates Part 5 entirely — Stage 2 architecture, far wider
      // blast radius than Decision 3's narrow remit; see DEC-020's
      // Materiality Correction entry for the explicit, disclosed scope
      // boundary this draws). This diagnostic layer alone distinguishes
      // "present" from "a materially distinct, admitted answer authority."
      const record = { id: src.id, role, materialAspect: AUTHORITY_ROLES.workflow, canonicalRelationshipSource: null };
      if (workflowEligible) {
        admitted.push({ ...record, source: 'independent-retrieval', reason: `Question classified ${answer.classification} — materially requests how-to-procedure, and this Workflow independently, verifiably supplies it (selected via the same single retrieval pass, not inherited).` });
      } else {
        notAdmitted.push({ ...record, source: 'independent-retrieval', reason: `Present in sources[] (pre-existing companion-Workflow citation) but NOT admitted: question classified ${answer.classification} — no procedural/how-to aspect materially requested. Eligibility (independent retrieval score) is not, by itself, materiality.` });
      }
      continue;
    }

    if (entityType === 'decision' || entityType === 'postmortem' || entityType === 'bug') {
      const isDirect = !!(authorityEntry && (authorityEntry[DIRECT_FIELD_BY_TYPE[entityType]] || []).includes(src.id));
      // Adversarial-control finding (Phase 5.2 Final Closure Check): direct
      // citation is STILL not sufficient on its own. AI-FEAT-010 directly
      // cites DEC-001, but DEC-001's own "Related feature(s)" header names
      // ONLY AI-FEAT-004 — DEC-001 is genuinely about a different feature's
      // rationale, cited into AI-FEAT-010 without being reciprocally
      // claimed back. Reciprocal citation (the governance record's own
      // already-parsed related_ids, the SAME field answerFromGovernanceRecord()
      // already reads for the opposite direction) is the third, existing,
      // deterministic signal: a governance record is materially about a
      // Feature only when THAT record's own canonical header also names the
      // Feature back. Verified corpus-wide: only 4 of 40+ direct citations
      // fail this (a real, rare, already-latent documentation inconsistency,
      // not a mechanism that guts admission generally).
      const governanceRec = ctx && ctx.searchIndexById ? ctx.searchIndexById.get(src.id) : null;
      const isReciprocal = !!(governanceRec && primary && (governanceRec.related_ids || []).includes(primary.id));
      const canonicalRelationshipSource = entityType === 'bug'
        ? 'knowledgeRecord.knownLimitations.openBugs (pre-existing, unconditional) + authorityTopics.js directBugs (Phase 5.2 materiality check)'
        : 'authorityTopics.js buildAuthorityIndex() (Phase 5.1, single-hop)' + (isDirect ? ', direct citation' : ', reverse-lookup citation (Phase 5.2 directness check)');
      const record = { id: src.id, role, materialAspect: AUTHORITY_ROLES[entityType], canonicalRelationshipSource };
      if (governanceEligible && isDirect && isReciprocal) {
        admitted.push({ ...record, source: 'phase5.1-relationship-visibility', reason: `Question classified ${answer.classification} (materially requests ${AUTHORITY_ROLES[entityType]}), this is a DIRECT canonical citation (not "found via reverse lookup"), AND ${src.id}'s own "Related feature(s)" header reciprocally names ${primary.id} back — eligibility, directness, and reciprocity all satisfied.` });
      } else if (governanceEligible && isDirect && !isReciprocal) {
        notAdmitted.push({ ...record, source: 'phase5.1-relationship-visibility', reason: `Visible in sources[] (Phase 5.1) but NOT admitted: ${src.id} is a direct citation FROM ${primary ? primary.id : 'the primary'}, but ${src.id}'s own canonical "Related feature(s)" header does not name ${primary ? primary.id : 'it'} back — a one-directional citation, real evidence this record's own subject is a different feature, not genuinely material here despite being direct and classification-eligible.` });
      } else if (governanceEligible && !isDirect) {
        notAdmitted.push({ ...record, source: 'phase5.1-relationship-visibility', reason: `Visible in sources[] (Phase 5.1) but NOT admitted: question classified ${answer.classification} (aspect-eligible), but this is a "found via reverse lookup" secondary citation, not a direct one — score/classification eligibility alone is not sufficient materiality evidence.` });
      } else {
        notAdmitted.push({ ...record, source: 'phase5.1-relationship-visibility', reason: `Visible in sources[] (Phase 5.1) but NOT admitted: question classified ${answer.classification}, not TROUBLESHOOTING/EXPLANATION — no material request for ${AUTHORITY_ROLES[entityType]} detected. Visibility is not admission.` });
      }
      continue;
    }

    if (entityType === 'feature') {
      // A second Feature appearing in sources[] is not a current Phase 5.2
      // mechanism (Feature-vs-Feature neighborhood synthesis is out of
      // scope) — recorded as visible-only for completeness, never admitted.
      notAdmitted.push({ id: src.id, role, materialAspect: AUTHORITY_ROLES.feature, source: 'sources[]', canonicalRelationshipSource: null, reason: 'A second Feature is not synthesized as a neighborhood member in Phase 5.2 — recorded for completeness only.' });
    }
  }

  return {
    primary,
    classification: answer.classification,
    governanceEligible,
    workflowEligible,
    admitted,
    notAdmitted,
    influencedRanking: false,
  };
}

module.exports = { AUTHORITY_ROLES, GOVERNANCE_ELIGIBLE_CLASSIFICATIONS, WORKFLOW_ELIGIBLE_CLASSIFICATIONS, roleFor, explainNeighborhood };
