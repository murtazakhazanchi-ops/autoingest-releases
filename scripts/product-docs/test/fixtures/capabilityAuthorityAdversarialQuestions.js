'use strict';

// Phase C1 (Semantic Authority Core Integration, 2026-08-19) — the 51
// non-SUPPORTS cases from the frozen entailment gold set
// (bench/entailmentGoldDataset.mjs, checksum 1e04f7affdab8ea793d4354b9c39a5cf
// at the time of this extraction), duplicated here as a small, COMMITTED,
// CI-eligible fixture. bench/ is intentionally never committed (see its own
// checkpoint history) and this permanent authority regression suite must
// run in ordinary CI without depending on it or on any local model — see
// test/capabilityAuthority.test.js's own adversarial integration sweep,
// which uses this list with controlled injected judge outputs to prove
// integration correctness, never model quality.
//
// `gold` is carried through only for traceability back to the frozen
// dataset; this fixture's own test does not compare against it (that
// remains the model-required benchmark's job, run manually against a real
// local model — see bench/runEntailmentBenchmark.mjs).

const ADVERSARIAL_QUESTIONS = [
  { id: 'A1', question: 'Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A2', question: 'Does AutoIngest support drone footage import with GPS flight paths?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A3', question: 'Does AutoIngest support two-factor authentication for operator login?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A4', question: 'Does AutoIngest offer cloud backup?', gold: 'CONTRADICTS' },
  { id: 'A5', question: 'Can AutoIngest recognize faces?', gold: 'CONTRADICTS' },
  { id: 'A6', question: 'Does AutoIngest support voice-command narration during import?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A7', question: 'Does AutoIngest offer automatic watermarking of exported photographs?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A8', question: 'Does AutoIngest support RAID array health monitoring for the archive drive?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A9', question: 'Does AutoIngest provide a built-in color grading tool for RAW files?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A10', question: 'Does AutoIngest support geofencing to restrict archive access by location?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A11', question: 'Does AutoIngest offer AI-generated photo captions for social media?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A12', question: 'Does AutoIngest support printing photo albums directly from the app?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A13', question: 'Does AutoIngest have a built-in virus scanner for imported media?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A14', question: 'Does AutoIngest support multi-language translation of event notes?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A15', question: 'Does AutoIngest offer biometric fingerprint login for operators?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'A16', question: 'Does AutoIngest support blockchain chain-of-custody tracking?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B1', question: 'Does AutoIngest support tiered cold storage for old archives?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B2', question: 'Does AutoIngest offer automatic archive deduplication across events?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B3', question: 'Does AutoIngest support tape backup for long-term archival?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B4', question: 'Does AutoIngest support custom metadata schemas per photographer?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B5', question: 'Does AutoIngest offer batch metadata editing across multiple events at once?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B6', question: 'Does AutoIngest support IPTC subject-code taxonomy tagging?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B7', question: 'Does AutoIngest support single sign-on through a corporate identity provider?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B8', question: 'Does AutoIngest offer session timeout configuration for operator logins?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B9', question: 'Does AutoIngest support VPN-based remote archive access?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B10', question: 'Does AutoIngest offer bandwidth throttling for network transfers?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B11', question: 'Does AutoIngest support peer-to-peer file sharing between operators?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B12', question: 'Does AutoIngest support HDR tone-mapping during import?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B13', question: 'Does AutoIngest offer automatic video transcoding to a smaller format?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B14', question: 'Does AutoIngest support batch noise reduction for high-ISO photographs?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B15', question: 'Does AutoIngest support lens-correction profiles for RAW files?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B16', question: 'Does AutoIngest offer automatic exposure bracketing merge?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B17', question: 'Does AutoIngest support video chapter markers for long recordings?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B18', question: 'Does AutoIngest offer automatic video stabilization?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B19', question: 'Does AutoIngest support incremental snapshot backups with versioning?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B20', question: 'Does AutoIngest offer offsite disaster-recovery replication?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B21', question: 'Does AutoIngest support real-time bidirectional sync between two archives?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B23', question: 'Does AutoIngest support end-to-end encryption of archived photographs?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B24', question: 'Does AutoIngest offer role-based access control down to the individual photo level?', gold: 'CONTRADICTS' },
  { id: 'B25', question: 'Does AutoIngest support inline commenting on individual photographs?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B26', question: 'Does AutoIngest offer shared review sessions with live cursors?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B27', question: 'Does AutoIngest support automatic duplicate-photo detection using image similarity?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B28', question: 'Does AutoIngest offer scene classification for imported photographs?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B29', question: 'Does AutoIngest support direct export to a cloud photo-sharing service?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'B30', question: 'Does AutoIngest offer scheduled automatic exports on a timer?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'C1', question: 'Can I delete an event?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'C3', question: 'Can I rename an event after creating it?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'C4', question: 'Can I use AutoIngest without an archive root configured?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'C5', question: 'Does AutoIngest support importing video files?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'C6', question: 'Does AutoIngest support RAW file formats?', gold: 'INSUFFICIENT_EVIDENCE' },
  { id: 'C7', question: 'Does AutoIngest support drone footage import with GPS flight paths?', gold: 'INSUFFICIENT_EVIDENCE' },
];

module.exports = { ADVERSARIAL_QUESTIONS };
