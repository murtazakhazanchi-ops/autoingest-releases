'use strict';
// Checkpoint 13 smoke test -- NOT a scored evaluation set, just direct
// re-verification of the exact cases motivating this checkpoint plus the
// new RD37-class failure found in Phase 7's baseline. Never used as a
// frozen qualification set, never counted toward any acceptance bar.
module.exports = [
  { id: 'SMOKE_QX03', turns: ['Does Metadata Reapply use the same tabbed modal interface that the Metadata Management Modal does, or is it a separate window?'] },
  { id: 'SMOKE_RD37', turns: ["The Dashboard and Archive Health Reporting are the same screen under two names, right -- which one should I stop calling by the old name?"] },
  { id: 'SMOKE_POSITIVE', turns: ['Does the Keyword Registry feed both the Metadata Management Modal and Metadata Reapply, or just one of them?'] },
];
