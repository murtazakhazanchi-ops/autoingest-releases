'use strict';

// Deterministic compilation: (raw events[], optional linked Evidence Packet)
// -> canonical Memory Capsule Markdown matching docs/product/15_MEMORY_TEMPLATE.md.
// Pure function of its inputs — the same event journal and packet snapshot
// always produce byte-identical Markdown, which is what makes a repeated
// `memory finalize` idempotent (allocator.js's own placeholder-substitution
// step is the only thing that isn't itself idempotent, guarded separately by
// the *_created_id marker in lifecycle.js, exactly like canonicalUpdater.js's
// bug/decision/postmortem creation).
//
// Per docs/product/16_ENGINEERING_MEMORY_POLICY.md § 6, this module never
// invents connective prose beyond what the events/packet actually state — a
// section with no supporting event renders the literal "Evidence pending —
// source conversation unavailable" rather than a plausible-sounding guess.

const EVIDENCE_PENDING = 'Evidence pending — source conversation unavailable';

function field(v) {
  return (v === undefined || v === null || v === '') ? EVIDENCE_PENDING : v;
}

function listOrNone(arr, mapFn) {
  if (!arr || !arr.length) return 'None recorded.';
  return arr.map((x) => `- ${mapFn ? mapFn(x) : x}`).join('\n');
}

function byType(events, type) {
  return events.filter((e) => e.type === type);
}

function idsOfFamily(events, prefixTest) {
  const found = new Set();
  for (const e of events) {
    for (const id of e.related_ids || []) if (prefixTest(id)) found.add(id);
  }
  return Array.from(found).sort();
}

function tableRow(label, value) {
  return `| ${label} | ${field(value)} |`;
}

function renderIdentity(id, sessionId, packet, events, startedAt, completedAt, sourceTools, evidenceClassification) {
  return [
    '## Identity',
    '',
    '| Field | Value |',
    '|---|---|',
    tableRow('Memory ID', id),
    tableRow('Title', packet ? packet.task_title : (events[0] && events[0].summary)),
    tableRow('Status', 'Compiled'),
    tableRow('Date started', startedAt),
    tableRow('Date completed', completedAt),
    tableRow('Source agents/tools', sourceTools.join(', ') || null),
    tableRow('Source session ID(s)', sessionId),
    tableRow('Branch', packet ? packet.branch : null),
    tableRow('Base commit', packet ? packet.base_commit : null),
    tableRow('Final commit(s)', packet && packet.commits && packet.commits.length ? packet.commits.map((c) => c.short || c.hash).join(', ') : null),
    tableRow('Evidence classification', evidenceClassification),
  ].join('\n');
}

function renderScope(packet, events) {
  const featureIds = new Set([
    ...(packet && packet.affected_feature_ids ? packet.affected_feature_ids : []),
    ...idsOfFamily(events, (id) => /^AI-FEAT-\d{3}$/.test(id)),
  ]);
  const bugIds = idsOfFamily(events, (id) => /^BUG-\d{3}$/.test(id));
  const decisionIds = idsOfFamily(events, (id) => /^DEC-\d{3}$/.test(id));
  const postmortemIds = idsOfFamily(events, (id) => /^PM-\d{3}$/.test(id));
  const roadmapIds = new Set([
    ...(packet && packet.affected_roadmap_ids ? packet.affected_roadmap_ids : []),
    ...idsOfFamily(events, (id) => /^AI-RM-\d{3}$/.test(id)),
  ]);
  return [
    '## Scope',
    '',
    '| Field | Value |',
    '|---|---|',
    tableRow('Primary feature IDs', Array.from(featureIds).sort().join(', ') || null),
    tableRow('Secondary feature IDs', null),
    tableRow('Roadmap milestone IDs', Array.from(roadmapIds).sort().join(', ') || null),
    tableRow('Subsystems', packet && packet.affected_subsystems && packet.affected_subsystems.length ? packet.affected_subsystems.join(', ') : null),
    tableRow('Related bugs', bugIds.join(', ') || null),
    tableRow('Related decisions', decisionIds.join(', ') || null),
    tableRow('Related postmortems', postmortemIds.join(', ') || null),
    tableRow('Related releases', null),
    tableRow('Related technical docs', null),
  ].join('\n');
}

function renderOriginalRequest(events, packet) {
  const reqEvent = byType(events, 'user_request_recorded')[0];
  return [
    '## Original Request',
    '',
    `- **User goal**: ${field(reqEvent ? reqEvent.summary : (packet && packet.user_request_summary))}`,
    `- **Original wording summary**: ${field(reqEvent && reqEvent.detail && reqEvent.detail.wording_summary)}`,
    `- **Explicit constraints**: ${field(reqEvent && reqEvent.detail && reqEvent.detail.constraints)}`,
    `- **Expected outcome**: ${field(reqEvent && reqEvent.detail && reqEvent.detail.expected_outcome)}`,
  ].join('\n');
}

function renderInitialUnderstanding(events) {
  const e = byType(events, 'task_started')[0];
  const d = (e && e.detail) || {};
  return [
    '## Initial Understanding',
    '',
    `- **How the agent understood the request**: ${field(e && e.summary)}`,
    `- **Initial assumptions**: ${field(d.assumptions)}`,
    `- **Uncertainties**: ${field(d.uncertainties)}`,
    `- **Questions raised**: ${field(d.questions)}`,
  ].join('\n');
}

function renderInitialPlan(events) {
  const e = byType(events, 'plan_created')[0];
  const d = (e && e.detail) || {};
  return [
    '## Initial Plan',
    '',
    `- **Proposed architecture**: ${field(d.architecture || (e && e.summary))}`,
    `- **Proposed files**: ${field(d.files)}`,
    `- **Proposed tests**: ${field(d.tests)}`,
    `- **Proposed workflow**: ${field(d.workflow)}`,
    `- **Original acceptance criteria**: ${field(d.acceptance_criteria)}`,
  ].join('\n');
}

function renderEvolutionTimeline(events) {
  const revisions = byType(events, 'plan_revised');
  if (!revisions.length) {
    return ['## Evolution Timeline', '', 'None recorded — no plan revision events captured for this session.'].join('\n');
  }
  const blocks = revisions.map((e, i) => {
    const d = e.detail || {};
    return [
      `- **Revision ${i + 1}** (${e.timestamp})`,
      `  - Trigger: ${field(d.trigger)}`,
      `  - User feedback: ${field(d.user_feedback)}`,
      `  - Discovered evidence: ${field(d.discovered_evidence)}`,
      `  - Prior approach: ${field(d.prior_approach)}`,
      `  - Revised approach: ${field(d.revised_approach || e.summary)}`,
      `  - Reason for revision: ${field(d.reason)}`,
      `  - Status: ${field(d.status)}`,
    ].join('\n');
  });
  return ['## Evolution Timeline', '', blocks.join('\n')].join('\n');
}

function renderInvestigationJournal(events) {
  const started = byType(events, 'investigation_started');
  const hypotheses = byType(events, 'hypothesis_added');
  const found = byType(events, 'evidence_found');
  const confirmed = byType(events, 'bug_confirmed');
  if (!started.length && !hypotheses.length && !found.length && !confirmed.length) {
    return ['## Investigation Journal', '', 'None recorded — no investigation events captured for this session.'].join('\n');
  }
  return [
    '## Investigation Journal',
    '',
    `- **Symptoms**: ${field(started[0] && started[0].summary)}`,
    `- **Files inspected**: ${field(started[0] && started[0].detail && started[0].detail.files_inspected)}`,
    `- **Commands run**: ${field(started[0] && started[0].detail && started[0].detail.commands_run)}`,
    `- **Evidence**: ${listOrNone(found, (e) => e.summary)}`,
    `- **Hypotheses**: ${listOrNone(hypotheses, (e) => e.summary)}`,
    '- **Experiments**: ' + field(null),
    `- **Findings**: ${listOrNone(found, (e) => e.summary)}`,
    `- **Root cause**: ${field(confirmed[0] && confirmed[0].detail && confirmed[0].detail.root_cause)}`,
    `- **Uncertainty**: ${field(null)}`,
  ].join('\n');
}

function renderAlternativesConsidered(events, packet) {
  const considered = byType(events, 'option_considered');
  const rejected = byType(events, 'option_rejected');
  const accepted = byType(events, 'decision_accepted');
  const fromPacket = (packet && packet.alternatives_considered) || [];
  if (!considered.length && !rejected.length && !accepted.length && !fromPacket.length) {
    return ['## Alternatives Considered', '', 'None recorded.'].join('\n');
  }
  const blocks = [];
  for (const e of considered) {
    const d = e.detail || {};
    const wasRejected = rejected.find((r) => r.detail && r.detail.option_ref === (d.option_ref || e.event_id));
    blocks.push([
      `- **Description**: ${field(e.summary)}`,
      `- **Benefits**: ${field(d.benefits)}`,
      `- **Drawbacks**: ${field(d.drawbacks)}`,
      `- **Risks**: ${field(d.risks)}`,
      `- **Accepted or rejected**: ${wasRejected ? 'Rejected' : 'Accepted'}`,
      `- **Reason**: ${field(wasRejected ? (wasRejected.detail && wasRejected.detail.reason) : d.reason)}`,
      `- **Supporting evidence**: ${field(d.evidence)}`,
    ].join('\n'));
  }
  for (const alt of fromPacket) {
    blocks.push([
      `- **Description**: ${field(typeof alt === 'string' ? alt : alt.description)}`,
      `- **Benefits**: ${field(typeof alt === 'object' ? alt.benefits : null)}`,
      `- **Drawbacks**: ${field(typeof alt === 'object' ? alt.drawbacks : null)}`,
      `- **Risks**: ${field(typeof alt === 'object' ? alt.risks : null)}`,
      `- **Accepted or rejected**: ${field(typeof alt === 'object' ? alt.outcome : null)}`,
      `- **Reason**: ${field(typeof alt === 'object' ? alt.reason : null)}`,
      '- **Supporting evidence**: Part 5 Evidence Packet (`alternatives_considered`)',
    ].join('\n'));
  }
  return ['## Alternatives Considered', '', blocks.join('\n\n')].join('\n');
}

function renderImplementationChronicle(events, packet) {
  const started = byType(events, 'implementation_started');
  const changed = byType(events, 'implementation_changed');
  return [
    '## Implementation Chronicle',
    '',
    `- **Implementation stages**: ${listOrNone(started.concat(changed), (e) => `${e.timestamp} — ${e.summary}`)}`,
    `- **Files/modules changed**: ${field(packet && packet.affected_files && packet.affected_files.length ? packet.affected_files.join(', ') : null)}`,
    `- **Important design choices**: ${field(packet && packet.implementation_summary)}`,
    `- **Unexpected discoveries**: ${listOrNone(changed.filter((e) => e.detail && e.detail.unexpected), (e) => e.summary)}`,
    `- **Corrections**: ${field(null)}`,
    `- **Deviations from plan**: ${field(null)}`,
  ].join('\n');
}

function renderUserFeedback(events) {
  const feedback = byType(events, 'user_feedback_received');
  if (!feedback.length) return ['## User Feedback', '', 'None recorded.'].join('\n');
  const blocks = feedback.map((e) => {
    const d = e.detail || {};
    return [
      `- **Feedback summary**: ${field(e.summary)}`,
      `- **Affected design area**: ${field(d.affected_area)}`,
      `- **Action taken**: ${field(d.action_taken)}`,
      `- **Outcome**: ${field(d.outcome)}`,
      `- **Accepted / partially accepted / rejected**: ${field(d.disposition)}`,
      `- **Reasoning**: ${field(d.reasoning)}`,
    ].join('\n');
  });
  return ['## User Feedback', '', blocks.join('\n\n')].join('\n');
}

function renderVisualEvidence(events) {
  const shots = byType(events, 'screenshot_captured');
  if (!shots.length) return ['## Visual Evidence', '', 'None recorded.'].join('\n');
  const blocks = shots.map((e) => {
    const d = e.detail || {};
    return [
      `- **Asset ID**: ${field(d.asset_id)}`,
      `- **Description**: ${field(e.summary)}`,
      `- **Layout observations**: ${field(d.layout_observations)}`,
      `- **Before/after**: ${field(d.before_or_after)}`,
      `- **Screen size / theme / state**: ${field(d.screen_context)}`,
      `- **Provenance**: ${field(d.provenance)}`,
    ].join('\n');
  });
  return ['## Visual Evidence', '', blocks.join('\n\n')].join('\n');
}

function renderTestingAndVerification(events, packet) {
  const runs = byType(events, 'test_run');
  return [
    '## Testing and Verification',
    '',
    `- **Tests run**: ${runs.length ? listOrNone(runs, (e) => e.summary) : field(packet && packet.tests_run && packet.tests_run.length ? packet.tests_run.join(', ') : null)}`,
    `- **Results**: ${listOrNone(runs.filter((e) => e.detail && e.detail.result), (e) => `${e.summary}: ${e.detail.result}`)}`,
    `- **Manual verification**: ${field(packet && packet.manual_verification && packet.manual_verification.length ? packet.manual_verification.join('; ') : null)}`,
    `- **Screenshots**: ${field(null)}`,
    `- **Performance measurements**: ${field(packet && packet.performance_results && packet.performance_results.length ? JSON.stringify(packet.performance_results) : null)}`,
    `- **Unresolved gaps**: ${field(packet && packet.unresolved_gaps && packet.unresolved_gaps.length ? packet.unresolved_gaps.join('; ') : null)}`,
  ].join('\n');
}

function renderFinalOutcome(events, packet) {
  const completed = byType(events, 'task_completed')[0];
  const d = (completed && completed.detail) || {};
  return [
    '## Final Outcome',
    '',
    `- **What shipped**: ${field(d.what_shipped || (packet && packet.accepted_solution))}`,
    `- **What did not**: ${field(d.what_did_not)}`,
    `- **Final architecture**: ${field(d.final_architecture)}`,
    `- **Final user workflow**: ${field(d.final_workflow)}`,
    `- **Known limitations**: ${field(d.known_limitations)}`,
    `- **Follow-up work**: ${listOrNone(byType(events, 'follow_up_created'), (e) => e.summary)}`,
  ].join('\n');
}

function renderLessons(events) {
  const corrections = byType(events, 'correction_applied');
  const findings = byType(events, 'review_finding');
  if (!corrections.length && !findings.length) return ['## Lessons', '', 'None recorded.'].join('\n');
  return [
    '## Lessons',
    '',
    `- **Reusable engineering lessons**: ${listOrNone(findings, (e) => e.summary)}`,
    `- **Feature-specific lessons**: ${field(null)}`,
    `- **Rejected patterns**: ${listOrNone(byType(events, 'option_rejected'), (e) => e.summary)}`,
    `- **Future warnings**: ${listOrNone(corrections, (e) => e.summary)}`,
  ].join('\n');
}

function collectEvidencePendingFields(sections) {
  const pending = [];
  for (const [name, text] of sections) {
    if (text.includes(EVIDENCE_PENDING)) pending.push(name);
  }
  return pending;
}

function renderProvenance(sessionId, packet, events, evidencePendingFields) {
  const commits = packet && packet.commits && packet.commits.length ? packet.commits.map((c) => c.short || c.hash).join(', ') : null;
  const evidenceRefs = Array.from(new Set(events.flatMap((e) => e.evidence_refs || [])));
  return [
    '## Provenance',
    '',
    `- **Source Evidence Packets**: ${field(packet ? packet.session_id : 'None — no linked Part 5 Evidence Packet')}`,
    `- **Commits**: ${field(commits)}`,
    `- **Test reports**: ${listOrNone(byType(events, 'test_run'), (e) => e.summary)}`,
    `- **Screenshots**: ${listOrNone(byType(events, 'screenshot_captured'), (e) => (e.detail && e.detail.asset_id) || e.summary)}`,
    `- **Imported conversation artifacts**: ${listOrNone(events.filter((e) => e.source_type === 'imported-transcript'), (e) => e.summary)}`,
    `- **Explicit user statements**: ${listOrNone(events.filter((e) => e.source_type === 'explicit-user-statement'), (e) => e.summary)}`,
    `- **Evidence-pending items**: ${evidencePendingFields.length ? evidencePendingFields.join(', ') : 'None — every section above is evidence-grounded'}`,
    evidenceRefs.length ? `\nRaw evidence references: ${evidenceRefs.join(', ')}` : '',
  ].join('\n');
}

// Main entry point. `id` is either the real AI-MEM-#### or allocator.js's
// ID_PLACEHOLDER — the compiler doesn't care which, it just renders the
// string it's given into the heading/header table, per allocator.js's
// render-then-substitute pattern.
function compileCapsule(id, { sessionId, title, events, packet, sourceTools }) {
  events = events || [];
  sourceTools = sourceTools && sourceTools.length ? sourceTools : ['claude-code'];
  const timestamps = events.map((e) => e.timestamp).sort();
  const startedAt = timestamps[0] || (packet && packet.created_at) || null;
  const completedAt = timestamps[timestamps.length - 1] || (packet && packet.updated_at) || null;
  const evidenceClassification = packet
    ? 'Full session capture — linked to Part 5 Evidence Packet'
    : (events.length ? 'Partial capture — memory events only, no linked Evidence Packet' : 'Evidence pending');

  // Every rendered section is scanned for the EVIDENCE_PENDING marker before
  // Provenance is rendered — not just the first three (Original
  // Request/Initial Understanding/Initial Plan). A prior version only
  // scanned those three, so a gap anywhere else (e.g. Implementation
  // Chronicle's "Important design choices") could render "Evidence pending"
  // in its own body while Provenance's "Evidence-pending items" line still
  // claimed "None — every section above is evidence-grounded" — a direct,
  // self-contradicting false claim inside the same capsule (found in code
  // review). Provenance itself is deliberately excluded from this scan: it
  // is the section reporting the gaps, not a candidate gap of its own.
  const identitySection = renderIdentity(id, sessionId, packet, events, startedAt, completedAt, sourceTools, evidenceClassification);
  const scopeSection = renderScope(packet, events);
  const originalRequestSection = renderOriginalRequest(events, packet);
  const initialUnderstandingSection = renderInitialUnderstanding(events);
  const initialPlanSection = renderInitialPlan(events);
  const evolutionTimelineSection = renderEvolutionTimeline(events);
  const investigationJournalSection = renderInvestigationJournal(events);
  const alternativesConsideredSection = renderAlternativesConsidered(events, packet);
  const implementationChronicleSection = renderImplementationChronicle(events, packet);
  const userFeedbackSection = renderUserFeedback(events);
  const visualEvidenceSection = renderVisualEvidence(events);
  const testingAndVerificationSection = renderTestingAndVerification(events, packet);
  const finalOutcomeSection = renderFinalOutcome(events, packet);
  const lessonsSection = renderLessons(events);

  const sections = [
    ['Identity', identitySection],
    ['Scope', scopeSection],
    ['Original Request', originalRequestSection],
    ['Initial Understanding', initialUnderstandingSection],
    ['Initial Plan', initialPlanSection],
    ['Evolution Timeline', evolutionTimelineSection],
    ['Investigation Journal', investigationJournalSection],
    ['Alternatives Considered', alternativesConsideredSection],
    ['Implementation Chronicle', implementationChronicleSection],
    ['User Feedback', userFeedbackSection],
    ['Visual Evidence', visualEvidenceSection],
    ['Testing and Verification', testingAndVerificationSection],
    ['Final Outcome', finalOutcomeSection],
    ['Lessons', lessonsSection],
  ];
  const evidencePendingFields = collectEvidencePendingFields(sections);

  const titleLine = `# ${id} — ${title || (packet && packet.task_title) || 'Untitled Engineering Memory'}`;

  const body = [
    titleLine,
    '',
    identitySection,
    '',
    scopeSection,
    '',
    originalRequestSection,
    '',
    initialUnderstandingSection,
    '',
    initialPlanSection,
    '',
    evolutionTimelineSection,
    '',
    investigationJournalSection,
    '',
    alternativesConsideredSection,
    '',
    implementationChronicleSection,
    '',
    userFeedbackSection,
    '',
    visualEvidenceSection,
    '',
    testingAndVerificationSection,
    '',
    finalOutcomeSection,
    '',
    lessonsSection,
    '',
    renderProvenance(sessionId, packet, events, evidencePendingFields),
    '',
  ].join('\n');

  return body;
}

module.exports = { compileCapsule, EVIDENCE_PENDING };
