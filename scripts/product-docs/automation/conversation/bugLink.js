'use strict';

// Conversation -> Bug linkage. Read-only search against existing BUG-###
// records only — this module never allocates a canonical BUG-### itself.
// Per the Part 8 brief: "Conversation alone is not sufficient to declare a
// code defect fixed. Implementation/testing evidence remains necessary,"
// and Part 5's own bug-record creation criteria
// (docs/product/CLAUDE.md § 12: "a bug's root cause, symptom, or fix
// pattern would help diagnose something similar faster") requires
// implementation evidence a conversation transcript alone cannot supply.
// A bug discussed but not matched to an existing record is recorded in the
// conversation's own "Bug / Investigation Evidence" section as evidence,
// never spun into a new canonical BUG-### file automatically.

const { runQuery } = require('../../lib/query');

const MATCH_SCORE_THRESHOLD = 500;

function findExistingBug(bugEntry, built) {
  const text = bugEntry.symptoms || bugEntry.root_cause;
  if (!text) return null;
  const results = runQuery(text, built.searchIndex, { entityType: 'bug', limit: 3 });
  const strong = results.find((r) => r.score >= MATCH_SCORE_THRESHOLD);
  return strong ? { bug_id: strong.record.stable_id, title: strong.record.title, score: strong.score } : null;
}

function linkBugs(packet, { built }) {
  return (packet.bugs_discussed || []).map((bugEntry) => {
    const existing = findExistingBug(bugEntry, built);
    return existing
      ? { bug_id: existing.bug_id, state: 'linked', match: existing }
      : { bug_id: null, state: 'unmatched', note: 'No existing BUG-### matched — recorded as conversation evidence only, never auto-created as a canonical bug record (see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10 and docs/product/CLAUDE.md § 12).' };
  });
}

module.exports = { linkBugs, findExistingBug, MATCH_SCORE_THRESHOLD };
