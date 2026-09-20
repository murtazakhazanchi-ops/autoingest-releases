'use strict';

// ASK AUTOINGEST — CHECKPOINT 12, PHASE 13. EXPERIMENTAL. Post-freeze
// stochastic reliability re-test: 10 highest-risk conversations selected
// from finalBlindC12.js (Phase 12's new blind set), each to be run 5
// additional times independently (ORCH_REPEAT_INDEX) with zero code
// changes -- pure reliability measurement, not tuning.
//
// Selection rationale (from the required manual Phase 12 read-through):
//   QX01-QX04 -- all 4 adversarial items (fabrication-invitation,
//     confidently-wrong naming, cross-feature term misapplication,
//     presupposed capability). QX03 is a CONFIRMED factual error this
//     checkpoint found (claims Metadata Reapply shares the Metadata
//     Management Modal's UI; the real docs show it has its own separate
//     modal) -- selected specifically to test whether this error is
//     consistent (a stable model tendency) or probabilistic (sometimes
//     correct) across independent runs, which materially changes its
//     severity classification.
//   QI05 -- a CONFIRMED misleading omission this checkpoint found (denies
//     any metadata-tool consolidation exists, missing the Metadata
//     Management Modal that was purpose-built for exactly that). Same
//     consistency-vs-probabilistic question as QX03.
//   QI19, QU06 -- the two conversations in finalBlindC12.js whose first
//     draft triggered the ungrounded-capability-claim regeneration path
//     and fell through to the neutral fallback on both attempts.
//   QA02, QA04 -- the two hardest genuine-ambiguity disambiguation items
//     (both involve the Local-First Background Sync feature, which
//     participates in more feature-boundary confusion in this set than
//     any other subject: QA02, QA04, QX02, QX04, QT08, QM07 all touch it).
//   QM06 -- the one multi-turn conversation the automated validator
//     flagged (no-tool-calls-but-specific-claim on turn 2) that was
//     confirmed correct on manual read; included to verify that holds
//     across repeats too.

const dev = require('./finalBlindC12');
const byId = new Map(dev.map((c) => [c.id, c]));
const wantedIds = [
  'QX01', 'QX02', 'QX03', 'QX04',
  'QI05', 'QI19',
  'QU06',
  'QA02', 'QA04',
  'QM06',
];

module.exports = wantedIds.map((id) => byId.get(id));
