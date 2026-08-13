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
  // Stage 2 — four Online Registry authority/scope boundaries, added after
  // Phase 20's expanded eval corpus surfaced several boundary questions
  // that were confidently (sometimes "strong") answered AVAILABLE despite
  // contradicting already-evidenced facts from the Online Registry
  // architecture audit (AI-WF-006). Each citation traces to AI-WF-006's own
  // verbatim text, which itself traces to the realtime-server/ and
  // services/realtimeOperationsService.js emitter-call-site trace.
  //
  // All four carry `hardOverride: true` — a second real fix found in the
  // same pass. The existing "a strong RAW feature match may override a
  // boundary" rule (see knowledgeEngine.js answerQuestion) was designed for
  // the Stage 1 cloud-backup lesson: a single GENERIC token (bare "backup")
  // producing a coincidental match that, if wrong, would mean the boundary
  // itself was stale. These four boundaries are different in kind: the
  // phrase "Online Registry" legitimately, correctly, strongly matches its
  // own parent feature (AI-FEAT-048) — but that match doesn't disprove the
  // NARROWER claim the boundary makes about that feature's scope (it
  // exists AND doesn't store photos; both true at once). A strong raw
  // match on the parent feature is not competing evidence against a
  // boundary about the parent feature's own documented limits, so it must
  // never be allowed to override one. Each boundary's own keyword list is a
  // specific multi-word phrase (not a generic single token), keeping
  // false-positive risk low despite the hard override.
  {
    id: 'registry-media-storage',
    hardOverride: true,
    keywords: ['registry store my photo', 'registry store photographs', 'photos over the network', 'photos through the relay', 'relay store', 'upload my photos to the registry', 'registry hold my photo'],
    statement: 'The Online Registry / relay never stores, transmits, or provides access to photograph or media file bytes — only small, size-capped presence/activity/status messages cross it.',
    citation: 'AI-WF-006 (See Who Else Is Online and What They\'re Working On): "No photographs or media files ever pass through this system. Only small, size-capped status/metadata messages are exchanged."',
  },
  {
    id: 'registry-not-source-of-truth',
    hardOverride: true,
    keywords: ['registry replace the archive', 'registry the source of truth', 'registry become the source of truth'],
    statement: 'The Online Registry never replaces or overrides the archive as the source of truth — event.json remains authoritative at all times, including when the relay is degraded or unavailable.',
    citation: 'AI-WF-006: "The archive\'s event.json remains the sole source of truth for event data; the Registry never replaces or overrides it."',
  },
  {
    id: 'registry-conflict-detection',
    hardOverride: true,
    keywords: ['conflict warning', 'conflict detection', 'conflict:warning', 'warn me if someone else is editing', 'warn if two people', 'warns about editing the same event', 'warn us about conflict', 'warn about conflict'],
    statement: 'AutoIngest does not currently provide active conflict detection or conflict warnings. The conflict:warning message type is wired into the client/server protocol but has no confirmed emitting code path anywhere in the repository — it is dormant, not active.',
    citation: 'AI-WF-006: "a conflict:warning message type is defined in the client/server protocol, but no code anywhere in this repository currently emits it. It is wired but dormant. Do not describe AutoIngest as detecting conflicts between operators on the basis of this alone."',
  },
  {
    id: 'registry-activity-scope',
    hardOverride: true,
    keywords: ['qmz sorting show up as activity', 'metadata audit activity', 'show up as activity to other operators', 'visible to other operators as activity'],
    statement: 'Real-time activity/progress visibility in the Online Registry is published only for Import and Transfer/Sync operations. QMZ sorting, metadata audit/repair, and other operations do not currently publish activity, so they are never visible to other operators as live activity.',
    citation: 'Online Registry architecture audit (behind AI-WF-006): services/realtimeOperationsService.js\'s activity-emission call sites are limited to Import and Transfer/Sync flows only.',
  },
  {
    id: 'registry-presence-not-activity',
    hardOverride: true,
    keywords: ['presence shows someone online, are they editing', 'does presence mean', 'presence mean they are editing', 'presence mean someone is working', 'stop me from also working', 'stop you from also working'],
    statement: 'Presence (a device/operator being connected) is tracked separately from activity and does not mean that operator is actively editing your specific files. AutoIngest enforces no conflict prevention based on presence alone — seeing someone else online does not stop you from also working on the same event.',
    citation: 'AI-WF-006: "Presence — is a device/operator currently connected. Tracked separately from activity." / "Seeing someone else\'s presence does not mean AutoIngest will stop you from also working on the same event."',
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
