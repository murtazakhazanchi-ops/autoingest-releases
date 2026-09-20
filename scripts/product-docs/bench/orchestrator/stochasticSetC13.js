'use strict';

// ASK AUTOINGEST — CHECKPOINT 13, PHASE 18. EXPERIMENTAL. Post-freeze
// stochastic reliability re-test: 15 highest-risk conversations selected
// from relationshipBlind75.js (Phase 17's one-time blind set), each to be
// run 5 additional times independently (ORCH_REPEAT_INDEX) with zero code
// changes -- pure reliability measurement, not tuning.
//
// Selection rationale (from the required Phase 17 manual read-through):
//   RB58, RB44, RB27 -- the three CONFIRMED genuine defects found this
//     phase (RB58: temporal-ordering inversion caused by a redaction
//     artifact destroying the antecedent of a dependency reference;
//     RB44: accepted a false presupposition about Archive Diagnostics
//     bypassing the heartbeat-recency guard, the disambiguating fact
//     living in a document type -- Decisions -- outside the tool
//     surface's reach; RB27: a severe repetition/looping defect from
//     repeated check_relationship dedup interaction). Selected to test
//     whether each is a STABLE, reproducible defect or a one-off.
//   RB56 -- the hardest temporal item per the corpus-building fork's own
//     flagged uncertainty (Local-First Sync/local-import overlap timing).
//   RB17, RB18, RB19 -- the three genuinely fresh, real `distinctFrom`
//     edges in this set (CONTRADICTED-path verification).
//   RB42, RB47, RB55 -- the AI-FEAT-054 open-design-question nuance
//     cases (testing whether "related but unresolved" stays correctly
//     hedged under repetition).
//   RB61, RB48, RB63 -- multi-entity relational-synthesis cases using
//     multiple check_relationship calls in one turn.
//   RB26 -- an UNKNOWN-handling case that required regeneration
//     (process-narration) this run; testing stability of the fix.
//   RB9 -- a case whose first draft leaked a raw internal id
//     (internal-id-leak) and was regenerated; testing stability of the
//     safety-net fix under repetition.

const dev = require('./relationshipBlind75');
const byId = new Map(dev.map((c) => [c.id, c]));
const wantedIds = [
  'RB58', 'RB44', 'RB27',
  'RB56',
  'RB17', 'RB18', 'RB19',
  'RB42', 'RB47', 'RB55',
  'RB61', 'RB48', 'RB63',
  'RB26', 'RB09',
];

module.exports = wantedIds.map((id) => byId.get(id));
