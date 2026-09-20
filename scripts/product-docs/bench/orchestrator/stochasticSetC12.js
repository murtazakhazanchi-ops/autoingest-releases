'use strict';

// ASK AUTOINGEST — CHECKPOINT 12, PHASE 9. EXPERIMENTAL. 20 conversations
// selected from devSetC12.js (verbatim, same wording, same ids) for
// stochastic repetition -- 8 indirect identification, 4 thin/unknown,
// 4 capability, 4 multi-turn context, exactly per the checkpoint brief.
// Each will be run 5 times independently (100 total repeated
// conversations) with NO code changes between repetitions.

const dev = require('./devSetC12');
const byId = new Map(dev.map((c) => [c.id, c]));
const wantedIds = [
  // 8 indirect identification/terminology
  'IND02', 'IND04', 'IND06', 'IND07', 'IND09', 'IND12', 'IND14', 'IND15',
  // 4 thin/unknown
  'THIN01', 'THIN03', 'THIN07', 'THIN09',
  // 4 capability
  'UNSUP01', 'UNSUP03', 'ADV06', 'ADV08',
  // 4 multi-turn context
  'MULTI02', 'MULTI04', 'MULTI05', 'MULTI08',
];

module.exports = wantedIds.map((id) => byId.get(id));
