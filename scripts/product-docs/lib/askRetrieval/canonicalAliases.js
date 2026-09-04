'use strict';
// Ask AutoIngest — deterministic retrieval foundation. Canonical-alias
// architecture (Stage 1, Section 9), productionized from Production
// Readiness Phase 1's own canonicalAliasesPR1.js prototype.
//
// AUDIT FINDING (Section 3): the prototype's provenance was comment-only
// prose, not inspectable data. Each entry below carries a structured
// `provenance` object (`field`, the canonical source field the hint is
// grounded in, and `quote`, the exact canonical text) instead of a
// source-code comment a human has to go read -- a dev tool, test, or future
// documentation generator can enumerate CANONICAL_ALIASES and print every
// entry's own grounding without touching this file's source.
//
// Deliberately small and NOT exhaustive -- one entry per genuinely
// reusable retrieval gap found during Production Readiness Phase 1's own
// fusion-miss review (see that phase's report, Section 7-11), never one
// invented per benchmark query. Every hint is a paraphrase of that
// record's OWN canonical text, never wording lifted from a specific test
// query (Section 9's own explicit prohibition: "no benchmark-specific
// aliases... no aliases invented solely from user test wording").

const CANONICAL_ALIASES = [
  {
    id: 'AI-FEAT-034',
    hint: 'single tabbed modal consolidating separate metadata surfaces one place',
    provenance: { field: 'summary', quote: 'A single tabbed modal consolidating three previously-separate metadata UI surfaces.' },
  },
  {
    id: 'AI-FEAT-003',
    hint: 'landing surface first screen after login hero card',
    provenance: { field: 'summary', quote: 'The landing surface of AutoIngest: hero card (event state)...' },
  },
  {
    id: 'AI-FEAT-027',
    hint: 'import history grouped by date audit view past imports',
    provenance: { field: 'summary', quote: 'On-demand audit view for any event in the master archive: import history grouped by date...' },
  },
  {
    id: 'AI-FEAT-053',
    hint: 'archive-wide search across every event entire archive',
    provenance: { field: 'registry entry', quote: 'Planned archive-wide search capability.' },
  },
  {
    id: 'AI-FEAT-051',
    hint: 'full archive browsing without import workflow',
    provenance: { field: 'registry entry', quote: 'Planned full-archive browsing capability.' },
  },
  {
    id: 'AI-FEAT-020',
    hint: 'skip existing file no overwrite conflict rename duplicate',
    provenance: { field: 'current_behavior (AI-FEAT-019/020)', quote: 'same file skips, conflicts rename' },
  },
  {
    id: 'AI-FEAT-042',
    hint: 'authoritative archive root resolution conflicting locations',
    provenance: { field: 'summary', quote: "automatic resolution of AutoIngest's four storage roots" },
  },
  {
    id: 'AI-FEAT-028',
    hint: 'source device attribution which card drive used per import',
    provenance: { field: 'summary', quote: 'identifying which memory card, external drive, or local folder was used' },
  },
  {
    id: 'AI-FEAT-045',
    hint: 'write lock concurrent import same folder prevention',
    provenance: { field: 'summary', quote: 'Photographer-level write locks for Direct Archive imports, preventing concurrent imports' },
  },
  {
    id: 'AI-FEAT-047',
    hint: 'photographer number own shots sequence after import',
    provenance: { field: 'summary', quote: 'a standalone sequencing workspace... numbered sequences' },
  },
  {
    id: 'AI-FEAT-010',
    hint: 'change details of an existing event after creation editing',
    provenance: { field: 'summary', quote: 'Selecting an existing event, editing it safely.' },
  },
];

const _aliasById = new Map(CANONICAL_ALIASES.map((a) => [a.id, a]));

function aliasHintFor(recordId) {
  const entry = _aliasById.get(recordId);
  return entry ? entry.hint : '';
}

// Section 9's own "provenance inspectable during development" requirement
// -- returns the full entry (hint + provenance) for a record, or null.
// Intended for a future documentation-generation pass or a dev-only
// inspection tool, not consumed by the retrieval boundary itself (which
// only ever needs aliasHintFor()'s plain hint text).
function aliasEntryFor(recordId) {
  return _aliasById.get(recordId) || null;
}

module.exports = { CANONICAL_ALIASES, aliasHintFor, aliasEntryFor };
