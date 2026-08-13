'use strict';

// Stage 1 Knowledge Engine — deterministic capability-status resolution.
// See docs/product/features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md
// for the full design rationale. Status is always read off evidence already
// present on a canonical record (feature Status field, linked bug status,
// an explicitly-curated boundary citation) — never inferred from a title,
// category, or the mere absence of a search result. This mirrors
// docs/product/CLAUDE.md's single most important rule ("never invent
// dates, bugs, architecture, decisions, ownership, or maturity") applied to
// a new kind of derived fact: operator-facing capability status.

// Per-record status — what a canonical AI-FEAT record itself resolves to.
// A record only ever resolves to one of these three: a feature record
// exists precisely because the capability is scoped (implemented or
// planned) — NOT_SUPPORTED/UNKNOWN are query-time-only outcomes (see
// QUERY_STATUS) for questions that match no record at all.
const RECORD_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIALLY_AVAILABLE: 'PARTIALLY_AVAILABLE',
  PLANNED: 'PLANNED',
});

// Full status vocabulary a query answer can resolve to.
const QUERY_STATUS = Object.freeze({
  AVAILABLE: RECORD_STATUS.AVAILABLE,
  PARTIALLY_AVAILABLE: RECORD_STATUS.PARTIALLY_AVAILABLE,
  PLANNED: RECORD_STATUS.PLANNED,
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  UNKNOWN: 'UNKNOWN',
});

// Resolve one feature-index record's operator-facing status from its own
// canonical Status field plus evidence already on the record (open bug
// count, passed in by the caller — see lib/knowledgeIndex.js). Never reads
// the record's title, category, or search keywords.
function resolveFeatureOperatorStatus(featureRecord, { openBugCount = 0 } = {}) {
  const status = String(featureRecord.status || '').trim();
  const evidence = [`canonical Status field: "${status || '(missing)'}"`];

  if (/^Planned$/i.test(status)) {
    return { operatorStatus: RECORD_STATUS.PLANNED, reason: 'Feature record status is Planned — not yet implemented.', evidence };
  }

  if (/^(Deferred|Deprecated|Superseded)$/i.test(status)) {
    return { operatorStatus: QUERY_STATUS.NOT_SUPPORTED, reason: `Feature record status is "${status}" — no longer available.`, evidence };
  }

  const isImplementedFamily = /^Implemented/i.test(status) || /^Partially implemented$/i.test(status) || /^In active development$/i.test(status);
  if (!isImplementedFamily) {
    return { operatorStatus: QUERY_STATUS.UNKNOWN, reason: 'Feature record status does not resolve to a known lifecycle state.', evidence };
  }

  const isEvolvingOrPartial = /evolving/i.test(status) || /^Partially implemented$/i.test(status) || /^In active development$/i.test(status);
  if (isEvolvingOrPartial) {
    return { operatorStatus: RECORD_STATUS.PARTIALLY_AVAILABLE, reason: 'Implemented, but the record\'s own status marks it evolving or partial.', evidence };
  }

  if (openBugCount > 0) {
    evidence.push(`${openBugCount} linked bug(s) not marked Fixed/Resolved/Closed`);
    return { operatorStatus: RECORD_STATUS.PARTIALLY_AVAILABLE, reason: `Implemented, but ${openBugCount} linked bug(s) are still open.`, evidence };
  }

  return { operatorStatus: RECORD_STATUS.AVAILABLE, reason: 'Feature record status is Implemented with no open blocking bugs.', evidence };
}

// A small, explicitly-curated, evidence-cited table used ONLY to elevate an
// otherwise-UNKNOWN answer (no confident record match) to NOT_SUPPORTED —
// never used to override a real record match, and never grown from a bare
// "search returned nothing." Each entry cites the exact canonical source
// backing the exclusion; verified by direct repository grep/read during
// Stage 1 implementation (2026-08-13). This is deliberately small and
// hand-authored — per the Phase 1 audit's own conclusion, distinguishing
// "definitely not supported" from "no evidence either way" is exactly the
// kind of judgment that requires authored operator guidance, not inference
// from zero search hits. Extend only with a real citation.
const KNOWN_BOUNDARIES = Object.freeze([
  {
    id: 'face-recognition',
    keywords: ['face', 'facial', 'recognize', 'recognition'],
    statement: 'AutoIngest has no face-recognition or facial-identification capability.',
    citation: 'No matching code, feature, or roadmap record for "face"/"facial"/"recognition" anywhere in main/, renderer/, services/, or docs/product/ (confirmed by direct repository search); 00_PROJECT_VISION.md scopes AutoIngest to structured archival ingestion, not photo analysis.',
  },
  {
    id: 'ai-auto-tagging',
    keywords: ['auto-tag', 'autotag', 'ai tagging', 'image recognition', 'object detection'],
    statement: 'AutoIngest has no AI-based image recognition or automatic content tagging.',
    citation: 'Same absence of evidence as face-recognition; AI-FEAT-056 (AI Archive Intelligence) is Planned with no finalized scope — its name must not be read as implying this capability exists or is scoped to include it.',
  },
  {
    id: 'photo-editing',
    keywords: ['edit photo', 'retouch', 'photo editing', 'crop photo', 'photo editor'],
    statement: 'AutoIngest does not edit, retouch, or otherwise modify photo content.',
    citation: '00_PROJECT_VISION.md: "built for structured archival workflows, not general-purpose photo management."',
  },
  {
    id: 'cloud-storage',
    keywords: ['cloud backup', 'cloud storage', 'cloud sync', 'upload to cloud', 'client gallery', 'website upload'],
    statement: 'AutoIngest has no cloud storage, cloud backup, or external website/gallery upload capability.',
    citation: 'DEC-003 (Local-First and On-Premises Architecture): all four storage roots are local or NAS-based; "no fallback to a remote service when local storage is unavailable."',
  },
  {
    id: 'linux',
    keywords: ['linux', 'ubuntu'],
    statement: 'AutoIngest does not support Linux.',
    citation: '00_PROJECT_VISION.md: "an Electron-based desktop application for macOS and Windows."',
  },
  {
    id: 'multi-user-roles',
    keywords: ['multiple users log in', 'concurrent users', 'user roles', 'role-based access', 'multiple accounts at once'],
    statement: 'AutoIngest does not support multiple concurrent user accounts or role-based access.',
    citation: '01_FEATURE_REGISTRY.md Reconciliation Notes: operator profiles are single-active-user (services/settings.js getLastActiveUserId() confirms a single value).',
  },
]);

function matchKnownBoundary(questionText) {
  const q = String(questionText || '').toLowerCase();
  for (const b of KNOWN_BOUNDARIES) {
    for (const kw of b.keywords) {
      if (q.includes(kw)) return b;
    }
  }
  return null;
}

module.exports = { RECORD_STATUS, QUERY_STATUS, resolveFeatureOperatorStatus, KNOWN_BOUNDARIES, matchKnownBoundary };
