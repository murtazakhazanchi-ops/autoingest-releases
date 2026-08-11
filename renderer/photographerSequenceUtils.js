'use strict';

// Canonical Representation Audit, L6 (2026-08-11): the ONE seqPrefix()
// implementation for this whole codebase. Previously duplicated —
// services/photographerSequenceService.js (main process) and
// renderer/eventCreator.js each maintained their own copy, kept in sync only
// by a code comment, no shared module. Both copies were verified identical at
// the time of the audit, but nothing enforced that. Dual-exported (CJS
// module.exports for main.js/photographerSequenceService.js's own
// require(), window.PhotographerSequenceUtils for the renderer's own
// <script>-tag load) using the exact pattern renderer/pathUtils.js already
// established for this same main/renderer sharing problem.
//
// Wrapped in an IIFE (no top-level let/const) for the same reason
// pathUtils.js is — safe to load more than once in the same JS realm, so a
// classic-script renderer reload never throws "already declared".
(function () {
  /**
   * Build the padded PC prefix string for a 1-based sequence number.
   * 1 → "PC01", 10 → "PC10", 100 → "PC100"
   * @param {number} seq  1-based sequence number (>= 1)
   * @returns {string}
   */
  function seqPrefix(seq) {
    if (seq < 10) return `PC0${seq}`;
    return `PC${seq}`;
  }

  const exportsObj = { seqPrefix };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.PhotographerSequenceUtils = exportsObj;
  }
})();
