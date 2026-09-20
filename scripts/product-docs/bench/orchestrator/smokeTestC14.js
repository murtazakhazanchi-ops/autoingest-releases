'use strict';
// Checkpoint 14 smoke test -- NOT a scored evaluation set. Direct
// re-verification of RB58 (the exact question that surfaced the
// CORRUPTED_KNOWLEDGE defect) using the UNCHANGED C13 engine/validator,
// to isolate whether the Phase 2 Knowledge Model data fix alone resolves
// it, before any engine/tool changes are made for Phases 3, 6, 7.
module.exports = [
  { id: 'SMOKE_RB58', turns: ['Does Photographer-Folder Resolution run before Event-Component Import Routing decides the destination folder, or after?'] },
  // Phase 6 -- RB27's exact reproduction question (relationshipBlind75.js),
  // used here in isolation to verify the structural loop fix before
  // re-running the full historical set.
  { id: 'SMOKE_RB27', turns: ['Archive Folder Adoption reads its configuration from the Application Settings & Configuration Store, correct?'] },
  // Phase 11 dev-set finding -- AI-FEAT-022's own `behavior` field had a
  // meaning-damaging redaction (orphaned colon + orphaned parenthetical
  // connector, fixed in reshapeRegistry.js). DEV41 surfaced it via this
  // exact phrasing; re-verifying against the fixed Knowledge Model.
  { id: 'SMOKE_DEV41', turns: ['What actually decides whose folder a photo lands in when multiple photographers are shooting the same event?'] },
];
