// Ask AutoIngest Phase A.2 benchmark question set (Track 2.E expansion).
// `expected` fields established empirically against the REAL deterministic
// engine during this and prior sessions -- never assumed. `knownDefect`
// marks cases already known to fail retrieval before any synthesis is
// attempted (Product Owner directive: retrieval and synthesis are ALWAYS
// scored separately; a fluent synthesis over bad retrieval is never a pass).

export const MANDATORY_QUESTIONS = [
  { id: 'M1', category: 'HOW_TO', question: 'How do I import photographs from an SD card?', expected: { primaryId: 'AI-WF-001', capabilityStatus: 'AVAILABLE' } },
  { id: 'M2', category: 'EXPLANATION', question: 'What is QMZ?', expected: { capabilityStatus: 'AVAILABLE' } },
  { id: 'M3', category: 'TROUBLESHOOTING', question: 'My transfer stopped halfway, what happens now?', expected: { primaryId: 'AI-WF-005', capabilityStatus: 'AVAILABLE' } },
  { id: 'M4', category: 'CAPABILITY', question: 'Does AutoIngest offer cloud backup?', expected: { capabilityStatus: 'NOT_SUPPORTED' } },
  { id: 'M5', category: 'CAPABILITY', question: 'Can AutoIngest recognize faces?', expected: { capabilityStatus: 'NOT_SUPPORTED' } },
  { id: 'M6', category: 'CAPABILITY', question: 'If two people import at the same time, will there be a conflict warning?', expected: { capabilityStatus: 'NOT_SUPPORTED' } },
  { id: 'M7', category: 'EXPLANATION', question: 'Why does Transfer Import exist?', expected: { capabilityStatus: 'AVAILABLE' }, knownDefect: 'Gap-C / RF-4.3-001: wrong primary (AI-WF-006 instead of AI-WF-005/AI-FEAT-039).' },
  { id: 'M8', category: 'CAPABILITY', question: 'Does AutoIngest support drone footage import with GPS flight paths?', expected: { capabilityStatus: 'NOT_SUPPORTED_EXPECTED_BUT_ENGINE_SAYS_AVAILABLE' }, knownDefect: 'RF-4.3-EXT-001 confidence-safety flagship.' },
  { id: 'M9', category: 'EXPLANATION', question: "What is the Online Registry's current purpose, and why did that purpose get clarified over time?", expected: { primaryId: 'AI-WF-006', capabilityStatus: 'AVAILABLE' }, knownDefect: 'RF-5.4-005: no historical citation ever admitted for this Workflow-primary phrasing.' },
  { id: 'M10', category: 'UNKNOWN', question: 'Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Governance-primary false positive (DEC-017) -- Track 1, escalated not fixed; same root mechanism as RF-4.3-EXT-001.' },
];

export const SUPPLEMENTARY_QUESTIONS = [
  { id: 'S1', category: 'ROADMAP', question: "What's coming next for AutoIngest?", expected: { capabilityStatus: 'ROADMAP' } },
  { id: 'S2', category: 'TROUBLESHOOTING', question: 'Is the telemetry hardcoded service-account credential a security risk?', expected: { primaryId: 'BUG-017', capabilityStatus: 'PARTIALLY_AVAILABLE' } },
  { id: 'S3', category: 'EXPLANATION', question: "Why was Transfer Export's locking kept process-local?", expected: { primaryId: 'DEC-021', capabilityStatus: 'AVAILABLE' } },
  { id: 'S4', category: 'HOW_TO', question: 'How do I sort QMZ photographs?', expected: { primaryId: 'AI-WF-007', capabilityStatus: 'AVAILABLE' } },
  { id: 'S5', category: 'CAPABILITY', question: 'Is Global Search available?', expected: { capabilityStatus: 'PLANNED' } },
];

// Track 1's 10 newly-generated plausible-but-nonexistent capability probes,
// reused here as Track 2.E's fictitious-capability synthesis-safety set --
// each one already empirically classified (Track 1 report) as either a
// confirmed retrieval false positive (must be scored retrievalOk:false
// regardless of synthesis fluency) or a correctly-honest UNKNOWN/PLANNED.
export const FICTITIOUS_QUESTIONS = [
  { id: 'F1', category: 'CAPABILITY', question: 'Does AutoIngest support voice-command narration during import?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Governance-primary false positive (DEC-004).' },
  { id: 'F2', category: 'CAPABILITY', question: 'Does AutoIngest offer automatic watermarking of exported photographs?', expected: { capabilityStatus: 'UNKNOWN' } },
  { id: 'F3', category: 'CAPABILITY', question: 'Does AutoIngest support RAID array health monitoring for the archive drive?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Feature-primary false positive (AI-FEAT-042), RF-4.3-EXT-001 mechanism.' },
  { id: 'F4', category: 'CAPABILITY', question: 'Does AutoIngest provide a built-in color grading tool for RAW files?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Governance-primary false positive (DEC-002).' },
  { id: 'F5', category: 'CAPABILITY', question: 'Does AutoIngest support geofencing to restrict archive access by location?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Feature-primary false positive (AI-FEAT-042), RF-4.3-EXT-001 mechanism.' },
  { id: 'F6', category: 'CAPABILITY', question: 'Does AutoIngest offer AI-generated photo captions for social media?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Feature-primary false positive (AI-FEAT-014), RF-4.3-EXT-001 mechanism.' },
  { id: 'F7', category: 'CAPABILITY', question: 'Does AutoIngest support printing photo albums directly from the app?', expected: { capabilityStatus: 'UNKNOWN' } },
  { id: 'F8', category: 'CAPABILITY', question: 'Does AutoIngest have a built-in virus scanner for imported media?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Feature-primary false positive (AI-FEAT-015), RF-4.3-EXT-001 mechanism.' },
  { id: 'F9', category: 'CAPABILITY', question: 'Does AutoIngest support multi-language translation of event notes?', expected: { capabilityStatus: 'PLANNED' } },
  { id: 'F10', category: 'CAPABILITY', question: 'Does AutoIngest offer biometric fingerprint login for operators?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Feature-primary false positive (AI-FEAT-002), RF-4.3-EXT-001 mechanism.' },
  { id: 'F11', category: 'CAPABILITY', question: 'Does AutoIngest support two-factor authentication for operator login?', expected: { capabilityStatus: 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED' }, knownDefect: 'Feature-primary false positive (AI-FEAT-028), RF-4.3-EXT-001 mechanism.' },
];

// Multi-record neighborhood / historical / representative-coverage
// supplements (Track 2.E requirement: multi-record neighborhood questions,
// known Part 3 residuals, additional representative HOW_TO/TROUBLESHOOTING/
// EXPLANATION coverage).
export const NEIGHBORHOOD_AND_RESIDUAL_QUESTIONS = [
  { id: 'N1', category: 'TROUBLESHOOTING', question: 'What went wrong with the same-size skip and metadata verification?', expected: { primaryId: 'AI-FEAT-032' }, note: 'Multi-record neighborhood: DEC-009/BUG-009/PM-001 all admitted (Phase 5.2 flagship).' },
  { id: 'N2', category: 'EXPLANATION', question: 'Why was the Metadata Audit and Repair tab redesigned as part of the Metadata Management Modal consolidation?', expected: {}, note: 'Multi-record neighborhood + Part 3 disclosed coarseness residual (DEC-012 visible-not-admitted).' },
  { id: 'N3', category: 'HOW_TO', question: 'How do I export or update a transfer drive?', expected: { primaryId: 'AI-WF-005' } },
  { id: 'N4', category: 'HOW_TO', question: 'How do I recover from an archive lock error?', expected: { primaryId: 'AI-WF-008' } },
  { id: 'N5', category: 'TROUBLESHOOTING', question: 'What is a sync-slot?', expected: { primaryId: 'AI-WF-006' } },
  { id: 'N6', category: 'CAPABILITY', question: 'Is Metadata Audit and Repair available?', expected: { primaryId: 'AI-FEAT-033', capabilityStatus: 'AVAILABLE' } },
  { id: 'N7', category: 'EXPLANATION', question: 'What is a Collection in AutoIngest?', expected: {} },
  { id: 'N8', category: 'TROUBLESHOOTING', question: 'Does AutoIngest warn me if someone else is editing the same event?', expected: { capabilityStatus: 'NOT_SUPPORTED' } },
];

export const ALL_QUESTIONS = [...MANDATORY_QUESTIONS, ...SUPPLEMENTARY_QUESTIONS, ...FICTITIOUS_QUESTIONS, ...NEIGHBORHOOD_AND_RESIDUAL_QUESTIONS];
