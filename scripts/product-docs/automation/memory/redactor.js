'use strict';

// Part 6 redaction surface — reuses Part 5's existing secret-pattern
// detector (automation/redact.js) rather than reimplementing one, per
// docs/product/16_ENGINEERING_MEMORY_POLICY.md § 11/§ 12. Adds only what
// Part 5 didn't need: a read-only *scan* over already-committed capsule text
// (for `memory verify` and the memoryValidators.js unredacted-secret rule),
// since Part 5's redactDeep() only ever runs on data about to be written,
// never re-scans canonical Markdown after the fact.

const { redactText, redactDeep } = require('../redact');

// Re-derive the same PATTERNS redact.js uses, for detection (not mutation).
// redact.js doesn't export PATTERNS directly (only the apply functions), so
// this detects a hit the same way redactText() would neutralize one: run
// redactText and compare — if it changed the text, something matched.
function scanForSecrets(text) {
  if (typeof text !== 'string' || !text) return [];
  const redacted = redactText(text);
  if (redacted === text) return [];
  // redactText doesn't report *which* pattern matched or *where* — for a
  // validator finding, "this file contains what looks like a credential" is
  // sufficient; the fix is always the same (run `memory redact`), and the
  // exact matched substring is deliberately never surfaced in a finding
  // message, so a validator run never itself becomes a place a real secret
  // gets copy-pasted into a report.
  return [{ matched: true }];
}

function redactCapsuleText(text) {
  return redactText(text);
}

module.exports = { scanForSecrets, redactCapsuleText, redactDeep };
