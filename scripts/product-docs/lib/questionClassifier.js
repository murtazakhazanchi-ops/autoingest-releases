'use strict';

// Stage 2 — question type classification (Phase 5). Deterministic pattern
// matching only, same spirit as Stage 1's classifyIntent (which this
// supersedes — kept as a superset, not a rewrite, so existing callers'
// expectations mostly still hold). Never forces a confident classification
// when the question doesn't clearly fit — falls back to UNKNOWN rather than
// guessing, per the Stage 2 brief's explicit instruction.

const QUESTION_TYPES = Object.freeze({
  HOW_TO: 'HOW_TO',
  CAPABILITY: 'CAPABILITY',
  TROUBLESHOOTING: 'TROUBLESHOOTING',
  NAVIGATION: 'NAVIGATION',
  EXPLANATION: 'EXPLANATION',
  STATUS: 'STATUS',
  ROADMAP: 'ROADMAP',
  COMPARISON: 'COMPARISON',
  TEAM_ACTIVITY: 'TEAM_ACTIVITY',
  CONNECTIVITY: 'CONNECTIVITY',
  UNKNOWN: 'UNKNOWN',
});

// Ordered: first pattern that matches wins. Order encodes real precedence
// decisions (e.g. a team-connectivity phrase should classify as
// CONNECTIVITY even though it might also loosely read as TROUBLESHOOTING).
const RULES = [
  { type: QUESTION_TYPES.ROADMAP, re: /\b(what'?s next|whats next|coming next|coming soon|planned features?|features?\s+(are|is)\s+planned|planned next|what is planned|roadmap|recent changes|what changed)\b/i },
  { type: QUESTION_TYPES.CONNECTIVITY, re: /\b(offline|reconnect|connection dropped|no internet|without internet|server unavailable|registry (down|unavailable)|can'?t connect)\b/i },
  { type: QUESTION_TYPES.TEAM_ACTIVITY, re: /\b(who('?s| is) (online|active|working)|another operator|other operators|team live|online registry|who else|see (what|who))\b/i },
  // Phase 4.4 (Decision 6, hygiene half) — "does(n'?t)?" made "why does X"
  // (no failure word) match TROUBLESHOOTING purely because "doesn't"
  // shares a prefix with "does". Narrowed to the negated contraction only;
  // a bare "why does/is/was" purpose question no longer implies failure.
  // "failed" broadened to "fail(s|ed)?" so "why did X fail" (a genuine
  // failure form with no other failure keyword) is still caught.
  { type: QUESTION_TYPES.TROUBLESHOOTING, re: /\b(stopped|not working|isn'?t working|error|missing|fail(s|ed)?|why (can'?t|won'?t|doesn'?t)|problem|stuck|wrong)\b/i },
  { type: QUESTION_TYPES.NAVIGATION, re: /^\s*where\b/i },
  { type: QUESTION_TYPES.COMPARISON, re: /\b(difference between|vs\.?|versus|compared to|or\b.*\?)\b/i },
  { type: QUESTION_TYPES.HOW_TO, re: /^\s*(how do i|how to|how can i|how does one)\b/i },
  { type: QUESTION_TYPES.STATUS, re: /\b(does autoingest|can autoingest|is there|will autoingest|support(s)?)\b/i },
  { type: QUESTION_TYPES.CAPABILITY, re: /^\s*(can i|can we)\b/i },
  // The trailing alternative is Phase 4.4's addition: a "why is/was/does"
  // question whose own text names a purpose/rationale word (exist, design,
  // create, reason, ...) routes to EXPLANATION rather than falling through
  // to UNKNOWN. TROUBLESHOOTING is checked earlier in this list, so a
  // genuine failure-form "why" question is never reached here.
  { type: QUESTION_TYPES.EXPLANATION, re: /^\s*(what is|what'?s|what are|explain)\b|^\s*what does\b.+\bmean\b|\bwhy (is|was|does)\b.*\b(exist(s)?|created?|design(ed)?|built|build|architected|structured|reason|rationale|authoritative|source of truth)\b/i },
];

function classifyQuestion(question) {
  const q = String(question || '').trim();
  if (!q) return QUESTION_TYPES.UNKNOWN;
  for (const rule of RULES) {
    if (rule.re.test(q)) return rule.type;
  }
  return QUESTION_TYPES.UNKNOWN;
}

module.exports = { QUESTION_TYPES, classifyQuestion };
