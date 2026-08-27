// Ask AutoIngest — Capability Entailment Judge Prototype, Part 11: frozen
// gold-label dataset. Investigation-only, never tuned after seeing model
// output (built and frozen BEFORE any judge benchmark ran this session).
//
// SCOPE FINDING, disclosed per checkpoint Part 1: of the 17 original + 30
// expanded adversarial questions, only 16+29=45 are actually classified
// CAPABILITY/STATUS by the real classifyQuestion() (one original --
// "will there be a conflict warning" -- is UNKNOWN; one expanded --
// "conflict-free replicated sync" -- is CONNECTIVITY). Of the 23
// title-gate regression cases, only 7 are CAPABILITY/STATUS-classified;
// the other 16 (HOW_TO/EXPLANATION/UNKNOWN/CONNECTIVITY/TEAM_ACTIVITY) were
// NEVER at risk from a judge scoped to CAPABILITY/STATUS only -- they are
// EXCLUDED here, not silently dropped: this is itself the reportable
// finding that scoping by question type already resolves most of the
// previous regression concern structurally, before the judge does anything.

export const GOLD = [
  // ---------------------------------------------------------------
  // A. Original 17 adversarial (16 in-scope; 1 excluded, noted below)
  // ---------------------------------------------------------------
  { id: 'A1', question: 'Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp', notes: 'DEC-017 is about release-signing infrastructure, unrelated to photo chain-of-custody. Known residual (RF-4.3-EXT-001-class).' },
  { id: 'A2', question: 'Does AutoIngest support drone footage import with GPS flight paths?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'The RF-4.3-EXT-001 flagship itself.' },
  { id: 'A3', question: 'Does AutoIngest support two-factor authentication for operator login?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-028 (Import Source Attribution) is unrelated to 2FA.' },
  { id: 'A4', question: 'Does AutoIngest offer cloud backup?', gold: 'CONTRADICTS', pattern: 'curated-boundary', notes: 'Existing hardOverride boundary; judge should never even be consulted (curated boundary wins first).' },
  { id: 'A5', question: 'Can AutoIngest recognize faces?', gold: 'CONTRADICTS', pattern: 'curated-boundary', notes: 'Same as A4.' },
  // "If two people import at the same time, will there be a conflict warning?" -- EXCLUDED, classifies UNKNOWN not CAPABILITY/STATUS.
  { id: 'A6', question: 'Does AutoIngest support voice-command narration during import?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp', notes: 'DEC-004 unrelated.' },
  { id: 'A7', question: 'Does AutoIngest offer automatic watermarking of exported photographs?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence', notes: 'Deterministic baseline already correctly UNKNOWN -- a control that the judge should not make worse.' },
  { id: 'A8', question: 'Does AutoIngest support RAID array health monitoring for the archive drive?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-042 (Archive Root Configuration) shares only the generic word "archive".' },
  { id: 'A9', question: 'Does AutoIngest provide a built-in color grading tool for RAW files?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp', notes: 'DEC-004 unrelated.' },
  { id: 'A10', question: 'Does AutoIngest support geofencing to restrict archive access by location?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'Same AI-FEAT-042 collision as A8.' },
  { id: 'A11', question: 'Does AutoIngest offer AI-generated photo captions for social media?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-014 (Thumbnail Generation) unrelated.' },
  { id: 'A12', question: 'Does AutoIngest support printing photo albums directly from the app?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence', notes: 'Deterministic baseline already correctly UNKNOWN.' },
  { id: 'A13', question: 'Does AutoIngest have a built-in virus scanner for imported media?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-015 (Media Preview) unrelated.' },
  { id: 'A14', question: 'Does AutoIngest support multi-language translation of event notes?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'planned-not-available', notes: 'Deterministic baseline correctly says PLANNED (AI-FEAT-051) -- this is a distinct, already-safe status the judge is not being asked to arbitrate; included as a non-AVAILABLE sanity control.' },
  { id: 'A15', question: 'Does AutoIngest offer biometric fingerprint login for operators?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-002 (Login & Operator Identity) confirms ordinary login exists, not biometric login specifically.' },
  { id: 'A16', question: 'Does AutoIngest support blockchain chain-of-custody tracking?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence', notes: 'Short mandatory phrasing; deterministic baseline already correctly UNKNOWN.' },

  // ---------------------------------------------------------------
  // B. Expanded 30 adversarial (29 in-scope; 1 excluded)
  // ---------------------------------------------------------------
  { id: 'B1', question: 'Does AutoIngest support tiered cold storage for old archives?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp' },
  { id: 'B2', question: 'Does AutoIngest offer automatic archive deduplication across events?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-020 is Duplicate Detection WITHIN an import batch, not cross-event archive deduplication -- a real, subtle distinction.' },
  { id: 'B3', question: 'Does AutoIngest support tape backup for long-term archival?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'planned-not-available' },
  { id: 'B4', question: 'Does AutoIngest support custom metadata schemas per photographer?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp' },
  { id: 'B5', question: 'Does AutoIngest offer batch metadata editing across multiple events at once?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp', notes: 'PM-001 is a postmortem, not a capability confirmation.' },
  { id: 'B6', question: 'Does AutoIngest support IPTC subject-code taxonomy tagging?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-029 supports IPTC keyword writing generally; "subject-code taxonomy" is a specific IPTC sub-feature not confirmed either way -- AMBIGUOUS, kept in with a lenient gold (INSUFFICIENT_EVIDENCE is defensible either way; not excluded, but flagged).' },
  { id: 'B7', question: 'Does AutoIngest support single sign-on through a corporate identity provider?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },
  { id: 'B8', question: 'Does AutoIngest offer session timeout configuration for operator logins?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp' },
  { id: 'B9', question: 'Does AutoIngest support VPN-based remote archive access?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'planned-not-available' },
  { id: 'B10', question: 'Does AutoIngest offer bandwidth throttling for network transfers?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },
  { id: 'B11', question: 'Does AutoIngest support peer-to-peer file sharing between operators?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-043 Archive Health Reporting unrelated.' },
  { id: 'B12', question: 'Does AutoIngest support HDR tone-mapping during import?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp' },
  { id: 'B13', question: 'Does AutoIngest offer automatic video transcoding to a smaller format?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },
  { id: 'B14', question: 'Does AutoIngest support batch noise reduction for high-ISO photographs?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp' },
  { id: 'B15', question: 'Does AutoIngest support lens-correction profiles for RAW files?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp' },
  { id: 'B16', question: 'Does AutoIngest offer automatic exposure bracketing merge?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },
  { id: 'B17', question: 'Does AutoIngest support video chapter markers for long recordings?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'planned-not-available' },
  { id: 'B18', question: 'Does AutoIngest offer automatic video stabilization?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },
  { id: 'B19', question: 'Does AutoIngest support incremental snapshot backups with versioning?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },
  { id: 'B20', question: 'Does AutoIngest offer offsite disaster-recovery replication?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-045 is archive lock recovery, not disaster-recovery replication.' },
  { id: 'B21', question: 'Does AutoIngest support real-time bidirectional sync between two archives?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-025 (checksum verification) unrelated to bidirectional sync.' },
  // B22 "conflict-free replicated sync for offline edits" -- EXCLUDED, classifies CONNECTIVITY not CAPABILITY/STATUS.
  { id: 'B23', question: 'Does AutoIngest support end-to-end encryption of archived photographs?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'planned-not-available' },
  { id: 'B24', question: 'Does AutoIngest offer role-based access control down to the individual photo level?', gold: 'CONTRADICTS', pattern: 'curated-boundary', notes: 'CONFIRMED via matchKnownBoundary(): the real, existing "multi-user-roles" hardOverride boundary fires on "role-based access" -- a genuine curated-boundary control, same class as A4/A5.' },
  { id: 'B25', question: 'Does AutoIngest support inline commenting on individual photographs?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp' },
  { id: 'B26', question: 'Does AutoIngest offer shared review sessions with live cursors?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'AI-FEAT-002 Login unrelated.' },
  { id: 'B27', question: 'Does AutoIngest support automatic duplicate-photo detection using image similarity?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'planned-not-available', notes: 'AI-FEAT-020 does real-time hash-based duplicate detection at import, NOT image-similarity-based detection -- a genuinely subtle, real distinction; AI-FEAT-056 (AI Archive Intelligence, Planned) is closer to what is actually asked.' },
  { id: 'B28', question: 'Does AutoIngest offer scene classification for imported photographs?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp' },
  { id: 'B29', question: 'Does AutoIngest support direct export to a cloud photo-sharing service?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'governance-primary-lexical-fp' },
  { id: 'B30', question: 'Does AutoIngest offer scheduled automatic exports on a timer?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'no-evidence' },

  // ---------------------------------------------------------------
  // C. In-scope subset of the 23 title-gate regression cases (7 of 23 --
  // the other 16 are EXCLUDED, see file header note)
  // ---------------------------------------------------------------
  { id: 'C1', question: 'Can I delete an event?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'honest-documented-gap', notes: 'Corpus\'s own text: "no feature/workflow record documents event deletion... an honest documentation gap." The ORIGINAL deterministic AVAILABLE-via-AI-FEAT-024 answer was itself questionable -- this is arguably a pre-existing baseline defect the title-gate incidentally "fixed" by accident, not a clean regression.' },
  { id: 'C2', question: 'Can I tell if a teammate is online right now?', gold: 'SUPPORTS', pattern: 'body-text-positive', notes: 'The ONE clean, confidently-verified body-text-only positive case found this session: AI-FEAT-027 (title "Activity Log", zero title-token overlap with the question) genuinely documents a real "Team Live" presence tab in its own Summary. This is THE critical case the judge must get right to prove semantic entailment adds value over the rejected title-overlap gate.' },
  { id: 'C3', question: 'Can I rename an event after creating it?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'honest-documented-gap', notes: 'Corpus: "same event-editing documentation gap." Same caveat as C1.' },
  { id: 'C4', question: 'Can I use AutoIngest without an archive root configured?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'honest-documented-gap', notes: 'Corpus: "no evidence either way."' },
  { id: 'C5', question: 'Does AutoIngest support importing video files?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'honest-documented-gap', notes: 'Corpus: "same recall gap... zero match... misses the already-disclosed import-video documentation gap." Deliberately kept INSUFFICIENT_EVIDENCE rather than assumed SUPPORTS.' },
  { id: 'C6', question: 'Does AutoIngest support RAW file formats?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'honest-documented-gap', notes: 'Corpus: "no evidence either way... honest weak/hedged gap."' },
  { id: 'C7', question: 'Does AutoIngest support drone footage import with GPS flight paths?', gold: 'INSUFFICIENT_EVIDENCE', pattern: 'feature-primary-lexical-fp', notes: 'Duplicate of A2, appears again in the regression corpus under RF-4.3-EXT-001\'s own control entry.' },

  // ---------------------------------------------------------------
  // D. Additional, independently-verified genuine positive controls
  // (title-confirmable, included as SUPPORTS sanity checks -- these are
  // NOT testing the hard body-text case, C2 is, but a judge that fails
  // these too would be unusable regardless)
  // ---------------------------------------------------------------
  { id: 'D1', question: 'Does AutoIngest support QMZ sequencing?', gold: 'SUPPORTS', pattern: 'title-confirmable-positive', notes: 'AI-FEAT-047, title itself names QMZ Sequencing Workspace.' },
  { id: 'D2', question: 'Does AutoIngest offer duplicate detection during import?', gold: 'SUPPORTS', pattern: 'title-confirmable-positive', notes: 'AI-FEAT-020, exact title match.' },
  { id: 'D3', question: 'Does AutoIngest support archive health reporting?', gold: 'SUPPORTS', pattern: 'title-confirmable-positive', notes: 'AI-FEAT-043, exact title match.' },
  { id: 'D4', question: 'Does AutoIngest offer stale lock detection and recovery?', gold: 'SUPPORTS', pattern: 'title-confirmable-positive', notes: 'AI-FEAT-045, exact title match.' },
];

// AMBIGUOUS cases explicitly excluded from headline accuracy, per checkpoint
// Part 11's own instruction not to force a convenient label:
export const AMBIGUOUS = [
  { id: 'AMB1', question: 'Does AutoIngest support IPTC subject-code taxonomy tagging?', reason: 'AI-FEAT-029 confirms general IPTC keyword writing; whether the specific "subject-code taxonomy" sub-feature is included is genuinely unclear to a human reviewer without deeper source inspection than this checkpoint performed.' },
];

export const EXCLUDED_OUT_OF_SCOPE = [
  { question: 'If two people import at the same time, will there be a conflict warning?', classification: 'UNKNOWN', reason: 'Not CAPABILITY/STATUS-classified -- out of this checkpoint\'s scope per Part 1, even though it is a real curated-boundary case in production today (matchKnownBoundary() runs before classification-based routing).' },
  { question: 'Does AutoIngest offer conflict-free replicated sync for offline edits?', classification: 'CONNECTIVITY', reason: 'Not CAPABILITY/STATUS-classified.' },
  // The other 16 of the 23 title-gate regression cases (HOW_TO/EXPLANATION/UNKNOWN/CONNECTIVITY/TEAM_ACTIVITY) -- see report for full list.
];
