'use strict';

// Deterministic compilation: normalized ECP + resolved ownership + import
// metadata -> canonical ENG-CONV-#### Markdown matching
// docs/product/17_ENGINEERING_CONVERSATION_TEMPLATE.md. Pure function of its
// inputs — same idempotency property as automation/memory/compiler.js's
// compileCapsule. Never invents connective prose beyond what the packet
// actually states — a section with nothing to report renders the literal
// "Evidence pending — not present in imported packet" per
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 6.

const EVIDENCE_PENDING = 'Evidence pending — not present in imported packet';

function val(v) {
  if (v === null || v === undefined || v === '') return EVIDENCE_PENDING;
  return String(v);
}

// A multi-item list rendered INLINE after "- **Label**: ": a single item
// stays inline; two or more items become a properly-nested Markdown
// sub-list, indented under the parent bullet, rather than joined onto one
// label line with embedded "- " markers that read as broken sibling
// bullets (found reviewing this module's own first real import).
function inlineList(arr, none = 'None recorded') {
  if (!Array.isArray(arr) || !arr.length) return none;
  if (arr.length === 1) return String(arr[0]);
  return '\n' + arr.map((x) => `  - ${x}`).join('\n');
}

function tableRow(label, value) {
  return `| ${label} | ${val(value)} |`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function renderIdentity(id, packet, importMeta) {
  return [
    '## Identity',
    '',
    '| Field | Value |',
    '|---|---|',
    tableRow('Conversation ID', id),
    tableRow('Title', packet.conversation_title),
    tableRow('Status', 'Imported'),
    tableRow('Conversation type', importMeta.conversationType),
    tableRow('Source tool', packet.source_tool),
    tableRow('Source format', importMeta.format),
    tableRow('Date started', packet.conversation_started_at),
    tableRow('Date completed', packet.conversation_completed_at),
    tableRow('Participants/roles', null),
    tableRow('Import date', importMeta.importedAt),
    tableRow('Import session', importMeta.importId),
    tableRow('Provenance classification', importMeta.provenanceClassification),
    tableRow('Redaction status', importMeta.redactionStatusLabel),
    tableRow('Integrity checksum', importMeta.fingerprint),
  ].join('\n');
}

function renderRepositoryContext(packet) {
  const ctx = packet.repository_context || {};
  return [
    '## Repository Context',
    '',
    '| Field | Value |',
    '|---|---|',
    tableRow('Repository', packet.project),
    tableRow('Branch', ctx.branch),
    tableRow('Base commit', ctx.base_commit),
    tableRow('Head/final commit', ctx.head_commit),
    tableRow('Implementation state at time of discussion', null),
  ].join('\n');
}

function renderRelationships(ownership, packet) {
  return [
    '## Relationships',
    '',
    '| Field | Value |',
    '|---|---|',
    tableRow('Primary feature IDs', ownership.primary_feature_ids.join(', ') || 'None'),
    tableRow('Secondary feature IDs', ownership.secondary_feature_ids.join(', ') || 'None'),
    tableRow('Roadmap milestone IDs', ownership.roadmap_ids.join(', ') || 'None'),
    tableRow('Related bugs', ownership.bug_ids.join(', ') || 'None'),
    tableRow('Related decisions', ownership.decision_ids.join(', ') || 'None'),
    tableRow('Related postmortems', 'None'),
    tableRow('Related memory capsules', ownership.memory_ids.join(', ') || 'None'),
    tableRow('Related releases', 'None'),
    tableRow('Related conversations', (packet.__related_conversation_ids || []).join(', ') || 'None'),
    tableRow('Related technical docs', 'None'),
    tableRow('Related source files', 'None'),
    tableRow('Related tests', 'None'),
  ].join('\n');
}

function renderOriginalRequest(packet) {
  return [
    '## Original Request',
    '',
    `- **Why this discussion happened**: ${val(packet.user_goal)}`,
    `- **User goal**: ${val(packet.user_goal)}`,
    `- **Explicit requirements**: ${inlineList(packet.explicit_requirements)}`,
    `- **Constraints**: ${inlineList(packet.constraints, 'None recorded')}`,
  ].join('\n');
}

function renderInitialUnderstanding(packet) {
  return [
    '## Initial Understanding',
    '',
    `- **Inferred requirements**: ${EVIDENCE_PENDING} — not distinguished from explicit requirements by this importer's adapters; see Original Request`,
    `- **Evidence-pending items**: ${inlineList(packet.evidence_pending, 'None recorded')}`,
    `- **Uncertainties / questions raised at the start**: ${inlineList(packet.open_questions, 'None recorded')}`,
  ].join('\n');
}

function renderInitialProposal(packet) {
  const p = packet.initial_proposal || {};
  return [
    '## Initial Proposal',
    '',
    `- **First proposed direction**: ${val(p.direction)}`,
    `- **Expected behavior**: ${val(p.expected_behavior)}`,
    `- **Expected architecture**: ${val(p.expected_architecture)}`,
    `- **Acceptance criteria**: ${Array.isArray(p.acceptance_criteria) ? inlineList(p.acceptance_criteria) : val(p.acceptance_criteria)}`,
  ].join('\n');
}

function renderDiscussionEvolution(packet) {
  if (!packet.revisions || !packet.revisions.length) {
    return ['## Discussion Evolution', '', 'None recorded — no revisions captured in the imported packet.'].join('\n');
  }
  const blocks = packet.revisions.map((r, i) => [
    `- **Revision ${i + 1}**`,
    `  - Trigger: ${val(r.trigger)}`,
    `  - Feedback: ${val(r.user_feedback)}`,
    `  - Previous approach: ${val(r.prior_approach)}`,
    `  - Revised approach: ${val(r.revised_approach)}`,
    `  - Rationale: ${val(r.reason)}`,
    `  - Disposition: ${val(r.status)}`,
  ].join('\n'));
  return ['## Discussion Evolution', '', blocks.join('\n')].join('\n');
}

function renderAlternatives(packet) {
  if (!packet.rejected_approaches || !packet.rejected_approaches.length) {
    return ['## Alternatives', '', 'None recorded.'].join('\n');
  }
  const blocks = packet.rejected_approaches.map((a) => [
    `- **Proposal**: ${val(a.proposal)}`,
    `- **Advantages**: ${val(a.advantages)}`,
    `- **Disadvantages**: ${val(a.disadvantages)}`,
    `- **Risks**: ${val(a.risks)}`,
    `- **Accepted or rejected**: Rejected`,
    `- **Reason**: ${val(a.reason_rejected)}`,
    '- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)',
  ].join('\n'));
  return ['## Alternatives', '', blocks.join('\n\n')].join('\n');
}

function renderUserFeedback(packet) {
  if (!packet.feedback || !packet.feedback.length) {
    return ['## User Feedback', '', 'None recorded.'].join('\n');
  }
  const blocks = packet.feedback.map((f) => [
    `- **Feedback summary**: ${val(f.summary)}`,
    `- **Target area**: ${val(f.affected_area)}`,
    `- **Impact**: ${val(f.impact)}`,
    `- **Resulting change**: ${val(f.resulting_change)}`,
    `- **Final disposition**: ${val(f.disposition)}`,
  ].join('\n'));
  return ['## User Feedback', '', blocks.join('\n\n')].join('\n');
}

function renderEngineeringDecisions(packet, decisionLinkResult) {
  return [
    '## Engineering Decisions',
    '',
    `- **Accepted**: ${inlineList(packet.accepted_decisions, 'None')}`,
    `- **Rejected**: ${inlineList((packet.rejected_approaches || []).map((a) => a.proposal).filter(Boolean), 'None')}`,
    `- **Deferred**: ${inlineList(packet.deferred_items, 'None')}`,
    `- **Undecided**: ${inlineList(packet.open_questions, 'None')}`,
    decisionLinkResult && decisionLinkResult.state !== 'not_applicable'
      ? `- **Decision-intelligence linkage**: ${decisionLinkResult.state}${decisionLinkResult.decision_id ? ` (${decisionLinkResult.decision_id})` : ''} — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10 for how this is decided.`
      : '- **Decision-intelligence linkage**: Not applicable — no decision-shaped evidence in this packet.',
  ].join('\n');
}

function renderBugEvidence(packet, bugLinkResults) {
  if (!packet.bugs_discussed || !packet.bugs_discussed.length) {
    return ['## Bug / Investigation Evidence', '', 'Not applicable — no bug discussed.'].join('\n');
  }
  const blocks = packet.bugs_discussed.map((b, i) => {
    const link = (bugLinkResults || [])[i];
    return [
      `- **Symptoms**: ${val(b.symptoms)}`,
      `- **Hypotheses**: ${val(b.hypotheses)}`,
      `- **Evidence**: ${val(b.evidence)}`,
      `- **Root cause**: ${val(b.root_cause)}`,
      `- **Proposed fixes**: ${val(b.proposed_fixes)}`,
      `- **Accepted fix**: ${val(b.accepted_fix)}`,
      `- **Rejected fixes**: ${val(b.rejected_fixes)}`,
      `- **Linked existing bug**: ${link && link.bug_id ? link.bug_id : 'None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10'}`,
    ].join('\n');
  });
  return ['## Bug / Investigation Evidence', '', blocks.join('\n\n')].join('\n');
}

function renderVisualEvidence() {
  return ['## Visual Evidence', '', 'None recorded — this importer does not yet accept binary image attachments; see docs/product/conversations/README.md.'].join('\n');
}

function renderOpenQuestions(packet) {
  return [
    '## Open Questions',
    '',
    `- **Unresolved**: ${inlineList(packet.open_questions, 'None recorded')}`,
    `- **Deferred**: ${inlineList(packet.deferred_items, 'None recorded')}`,
    `- **Evidence pending**: ${inlineList(packet.evidence_pending, 'None recorded')}`,
  ].join('\n');
}

function renderImplementationHandoff(packet) {
  if (!packet.implementation_requests || !packet.implementation_requests.length) {
    return ['## Implementation Handoff', '', '- **Work requested**: None recorded.'].join('\n');
  }
  const blocks = packet.implementation_requests.map((r) => [
    `- **Work requested**: ${val(r.request)}`,
    `- **Expected feature IDs**: ${Array.isArray(r.expected_feature_ids) ? r.expected_feature_ids.join(', ') || 'None' : val(r.expected_feature_ids)}`,
    `- **Expected roadmap IDs**: ${Array.isArray(r.expected_roadmap_ids) ? r.expected_roadmap_ids.join(', ') || 'None' : val(r.expected_roadmap_ids)}`,
    `- **Implementation constraints**: ${val(r.constraints)}`,
    `- **Expected tests**: ${val(r.expected_tests)}`,
    `- **Explicit non-goals**: ${Array.isArray(r.non_goals) ? inlineList(r.non_goals) : val(r.non_goals)}`,
  ].join('\n'));
  return ['## Implementation Handoff', '', blocks.join('\n\n')].join('\n');
}

function renderOutcome(importMeta) {
  return [
    '## Outcome',
    '',
    `- **${today()}** — Imported. ${importMeta.importNote || 'Canonicalized from an Engineering Conversation Packet.'}`,
  ].join('\n');
}

function renderProvenance(packet, importMeta, evidencePendingFields) {
  return [
    '## Provenance',
    '',
    `- **Source file**: ${val(importMeta.sourceFile)}`,
    `- **Packet checksum**: ${importMeta.fingerprint}`,
    `- **Importer**: ${importMeta.format}`,
    `- **Source tool (as claimed by the packet)**: ${val(packet.source_tool)} — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13 (a claim, not proof)`,
    `- **Source conversation metadata**: ${val(packet.source_conversation_id)}`,
    `- **Transformation method**: ${importMeta.format} adapter (scripts/product-docs/automation/conversation/adapters.js)`,
    `- **Fields unavailable from source**: ${inlineList(importMeta.fieldsUnavailable, 'None — packet was complete for this adapter')}`,
    `- **Evidence classifications**: ${importMeta.provenanceClassification}`,
    `- **Evidence-pending items**: ${evidencePendingFields.length ? evidencePendingFields.join(', ') : 'None — every section above is evidence-grounded'}`,
  ].join('\n');
}

function collectEvidencePendingFields(sections) {
  const pending = [];
  for (const [name, text] of sections) {
    if (text.includes(EVIDENCE_PENDING)) pending.push(name);
  }
  return pending;
}

// Main entry point. `id` is either the real ENG-CONV-#### or allocator.js's
// ID_PLACEHOLDER (render-then-substitute pattern, matching every other
// family in this system).
function compileConversationRecord(id, { packet, ownership, importMeta, decisionLinkResult, bugLinkResults }) {
  const identitySection = renderIdentity(id, packet, importMeta);
  const repoSection = renderRepositoryContext(packet);
  const relationshipsSection = renderRelationships(ownership, packet);
  const originalRequestSection = renderOriginalRequest(packet);
  const initialUnderstandingSection = renderInitialUnderstanding(packet);
  const initialProposalSection = renderInitialProposal(packet);
  const discussionEvolutionSection = renderDiscussionEvolution(packet);
  const alternativesSection = renderAlternatives(packet);
  const userFeedbackSection = renderUserFeedback(packet);
  const decisionsSection = renderEngineeringDecisions(packet, decisionLinkResult);
  const bugSection = renderBugEvidence(packet, bugLinkResults);
  const visualSection = renderVisualEvidence();
  const openQuestionsSection = renderOpenQuestions(packet);
  const handoffSection = renderImplementationHandoff(packet);
  const outcomeSection = renderOutcome(importMeta);

  const sections = [
    ['Identity', identitySection],
    ['Repository Context', repoSection],
    ['Relationships', relationshipsSection],
    ['Original Request', originalRequestSection],
    ['Initial Understanding', initialUnderstandingSection],
    ['Initial Proposal', initialProposalSection],
    ['Discussion Evolution', discussionEvolutionSection],
    ['Alternatives', alternativesSection],
    ['User Feedback', userFeedbackSection],
    ['Engineering Decisions', decisionsSection],
    ['Bug / Investigation Evidence', bugSection],
    ['Visual Evidence', visualSection],
    ['Open Questions', openQuestionsSection],
    ['Implementation Handoff', handoffSection],
  ];
  const evidencePendingFields = collectEvidencePendingFields(sections);
  const provenanceSection = renderProvenance(packet, importMeta, evidencePendingFields);

  const titleLine = `# ${id} — ${packet.conversation_title || 'Untitled Engineering Conversation'}`;

  return [
    titleLine, '',
    identitySection, '',
    repoSection, '',
    relationshipsSection, '',
    originalRequestSection, '',
    initialUnderstandingSection, '',
    initialProposalSection, '',
    discussionEvolutionSection, '',
    alternativesSection, '',
    userFeedbackSection, '',
    decisionsSection, '',
    bugSection, '',
    visualSection, '',
    openQuestionsSection, '',
    handoffSection, '',
    outcomeSection, '',
    provenanceSection, '',
  ].join('\n');
}

module.exports = { compileConversationRecord, EVIDENCE_PENDING };
