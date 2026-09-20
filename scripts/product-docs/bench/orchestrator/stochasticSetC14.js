'use strict';
// ASK AUTOINGEST — CHECKPOINT 14, PHASE 12. 20 highest-risk conversations
// selected from dev75C14.js, to be run 5 times each (100 total repetitions)
// via ORCH_REPEAT_INDEX. Covers directional relationships, Decision-backed
// facts, UNKNOWN relations, repeated-tool/loop-pressure questions, and
// difficult retrieval paraphrases, per Phase 12's explicit requirement.
const dev = require('./dev75C14');
const byId = new Map(dev.map((c) => [c.id, c]));
const SELECTED = [
  'DEV01', 'DEV04', 'DEV07', 'DEV10', 'DEV14', // directional
  'DEV17', 'DEV19', 'DEV22', 'DEV26', // decisionBacked
  'DEV28', 'DEV29', 'DEV35', // loopPressure (DEV35 needed regen-fallback in dev75 -- highest risk)
  'DEV39', 'DEV44', // paraphrase
  'DEV47', 'DEV52', 'DEV56', // unknownRelation
  'DEV41', // Phase 11's own redaction-fix re-verification, under repeat pressure
  'DEV59', // Phase 11's flagged subject-substitution finding, under repeat pressure
  'DEV62', // multiTurn, decision-adjacent (archive lock heartbeat guard)
];
module.exports = SELECTED.map((id) => byId.get(id));
