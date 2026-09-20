'use strict';
// ASK AUTOINGEST — CHECKPOINT 14, PHASE 17. 20 highest-risk conversations
// selected from finalBlindC14.js, to be run 5 more times each (100 total
// repeated blind conversations) via ORCH_REPEAT_INDEX. Includes: directional
// relationships, Decision-backed facts, UNKNOWN relations, the 3
// conversations that tripped the repetition-loop circuit breaker in Phase
// 16 (highest possible risk for that mechanism specifically), difficult
// retrieval paraphrases, and false-premise/adversarial questions.
const fb = require('./finalBlindC14');
const byId = new Map(fb.map((c) => [c.id, c]));
const SELECTED = [
  'FB08', 'FB14', 'FB19', 'FB20', // directional (FB14 carries the Tier-1 data-nuance footnote)
  'FB25', 'FB35', 'FB36', 'FB73', // decisionBacked
  'FB56', 'FB61', // unknownRelation
  'FB65', 'FB69', 'FB71', // falsePremise
  'FB42', 'FB44', 'FB50', // paraphrase
  'FB79', 'FB83', 'FB88', // repeated-tool pressure -- these 3 tripped the circuit breaker in Phase 16
  'FB43', // stylistic near-repetition observed in Phase 16
];
module.exports = SELECTED.map((id) => byId.get(id));
