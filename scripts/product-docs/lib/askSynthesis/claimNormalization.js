'use strict';

// Ask AutoIngest — Capability Entailment Judge Prototype (Product Owner-
// authorized checkpoint, 2026-08-18). Deterministic capability-claim
// extraction, investigated and tested per Part 2/18 of the checkpoint brief.
//
// Scope: CAPABILITY/STATUS-classified questions only (lib/questionClassifier.js's
// own STATUS/CAPABILITY regexes, reused verbatim, never re-implemented) —
// these are highly templated by construction ("Does AutoIngest support X?",
// "Can AutoIngest X?", "Can I X?", "Is there X?", "Will AutoIngest X?"),
// which is exactly why deterministic extraction is viable here in a way it
// would not be for open-ended EXPLANATION/HOW_TO phrasing.
//
// METHOD: strip the interrogative template, keep the remaining clause
// completely verbatim (no synonym substitution, no paraphrase, no
// broadening/narrowing), wrap it in a fixed affirmative frame. This is
// string surgery, not semantic rewriting -- the LLM never sees or produces
// the claim; it only judges evidence against a claim this deterministic
// function already fixed.

const TEMPLATES = [
  // Order matters -- more specific patterns first so a generic template
  // doesn't swallow a more specific one's own leading words.
  { re: /^\s*does\s+autoingest\s+(offer|support|have|provide|include)\s+(.+?)\??\s*$/i, build: (m) => `AutoIngest ${m[1].toLowerCase()}s ${trimClause(m[2])}` },
  { re: /^\s*does\s+autoingest\s+(.+?)\??\s*$/i, build: (m) => `AutoIngest ${normalizeVerbClause(m[1])}` },
  { re: /^\s*can\s+autoingest\s+(.+?)\??\s*$/i, build: (m) => `AutoIngest can ${trimClause(m[1])}` },
  { re: /^\s*can\s+i\s+(.+?)\??\s*$/i, build: (m) => `An operator can ${trimClause(m[1])}` },
  { re: /^\s*can\s+we\s+(.+?)\??\s*$/i, build: (m) => `Operators can ${trimClause(m[1])}` },
  { re: /^\s*is\s+there\s+(.+?)\??\s*$/i, build: (m) => `AutoIngest has ${trimClause(m[1])}` },
  { re: /^\s*will\s+autoingest\s+(.+?)\??\s*$/i, build: (m) => `AutoIngest will ${trimClause(m[1])}` },
  { re: /^\s*is\s+(.+?)\s+available\??\s*$/i, build: (m) => `${capitalize(trimClause(m[1]))} is available in AutoIngest` },
];

function trimClause(c) {
  return String(c || '').trim().replace(/\s+/g, ' ');
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// "does AutoIngest X" where X is not offer/support/have/provide/include
// (e.g. "does AutoIngest offer cloud backup" is caught above; "does
// AutoIngest recognize faces" falls here) -- the verb is kept EXACTLY as
// written, never normalized to "support", per Part 18's explicit warning
// against changing modality/verb meaning.
function normalizeVerbClause(clause) {
  return trimClause(clause);
}

// Returns { claim, method: 'deterministic'|'unmatched', original } --
// 'unmatched' means no template fired; the checkpoint's own audit (§ below)
// treats every unmatched case as a disclosed gap, never silently guessed.
function normalizeClaim(question) {
  const q = String(question || '').trim();
  for (const t of TEMPLATES) {
    const m = q.match(t.re);
    if (m) {
      return { claim: t.build(m), method: 'deterministic', original: q };
    }
  }
  return { claim: null, method: 'unmatched', original: q };
}

module.exports = { normalizeClaim, TEMPLATES };
