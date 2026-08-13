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
  { type: QUESTION_TYPES.TROUBLESHOOTING, re: /\b(stopped|not working|isn'?t working|error|missing|failed|why (can'?t|won'?t|does(n'?t)?)|problem|stuck|wrong)\b/i },
  { type: QUESTION_TYPES.NAVIGATION, re: /^\s*where\b/i },
  { type: QUESTION_TYPES.COMPARISON, re: /\b(difference between|vs\.?|versus|compared to|or\b.*\?)\b/i },
  { type: QUESTION_TYPES.HOW_TO, re: /^\s*(how do i|how to|how can i|how does one)\b/i },
  { type: QUESTION_TYPES.STATUS, re: /\b(does autoingest|can autoingest|is there|will autoingest|support(s)?)\b/i },
  { type: QUESTION_TYPES.CAPABILITY, re: /^\s*(can i|can we)\b/i },
  { type: QUESTION_TYPES.EXPLANATION, re: /^\s*(what is|what'?s|what are|explain)\b|^\s*what does\b.+\bmean\b/i },
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
