'use strict';
// Ask AutoIngest — deterministic retrieval foundation. Reciprocal Rank
// Fusion (Stage 1, Section 8), productionized unchanged in formula from
// Production Readiness Phase 1's own prototype testing (Cormack/Clarke/
// Buettcher, SIGIR 2009; k=60, the paper's own reported constant, not
// tuned against any benchmark here).
//
// Purpose (Phase 1, Section 4's own forensic finding): prevents one
// deterministic retrieval channel (historically, the existing lexical
// scorer) from monopolizing the candidate window regardless of how weak
// its own matches are, by re-ranking every channel's candidates together
// on a common, rank-based scale rather than letting channel A's output
// unconditionally precede channel B's.

// weightedLists: an array of [rankedIdList, weight] pairs. Each list is
// already-ranked (best first) ids from one retrieval channel. Returns a
// single fused, deterministically-ordered id list (ties broken by id
// ascending, matching every other ranking pass in this module tree).
function reciprocalRankFusion(weightedLists, rrfK = 60) {
  const scoreById = new Map();
  for (const [list, weight] of weightedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((id, idx) => {
      scoreById.set(id, (scoreById.get(id) || 0) + weight / (rrfK + idx + 1));
    });
  }
  return [...scoreById.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(([id]) => id);
}

// Same fusion, but returns the fused SCORE alongside each id (not just the
// ordering) -- useful for a caller that wants to inspect confidence, not
// consumed by the Stage 1 retrieval boundary itself.
function reciprocalRankFusionScored(weightedLists, rrfK = 60) {
  const scoreById = new Map();
  for (const [list, weight] of weightedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((id, idx) => {
      scoreById.set(id, (scoreById.get(id) || 0) + weight / (rrfK + idx + 1));
    });
  }
  return [...scoreById.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(([id, score]) => ({ id, score }));
}

module.exports = { reciprocalRankFusion, reciprocalRankFusionScored };
