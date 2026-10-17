'use strict';

// The ONE definition of what a QMZ sequence CODE string looks like syntactically — shared by
// main/qmzService.js (the authoritative creation/parsing/scanning logic) and
// renderer/commandManager.js (the Logitech MX Creative Console command-shape pre-check), so
// the two can never drift the way they already had: commandManager.js's own independently
// copied regex (/^\d{2}[QMZ]$/) kept rejecting "05aMZ"/"06MZ" even after Stage 1 of
// "PDF-Assisted QMZ Workspace Folder Generation" added lowercase-suffix and combined-MZ
// support to qmzService.js's own SEQ_RE — a real MX Console regression, found and fixed in
// Stage 5's independent review. Dual-exported (CJS module.exports for main.js/
// qmzService.js's own require(), window.QmzSequenceFormat for the renderer's own <script>-tag
// load) using the exact pattern renderer/pathUtils.js and
// renderer/photographerSequenceUtils.js already established for this same main/renderer
// sharing problem.
//
// Wrapped in an IIFE (no top-level let/const) for the same reason those two files are — safe
// to load more than once in the same JS realm, so a classic-script renderer reload never
// throws "already declared".
(function () {
  // Sequence code shape: 2 zero-padded digits, an optional single lowercase alphabetic suffix
  // (a slot split across multiple honorees — e.g. a single numbered appointment subdivided
  // into "5a"/"5b"), then the QMZ type letter — Q/M/Z, or the combined type "MZ". See
  // qmzService.js's own SEQ_RE comment (its former definition site, before this extraction)
  // for the full rationale.
  const SEQ_RE = /^(\d{2})([a-z]?)(MZ|Q|M|Z)$/;

  function isValidSequenceCode(code) {
    return typeof code === 'string' && SEQ_RE.test(code);
  }

  const exportsObj = { SEQ_RE, isValidSequenceCode };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.QmzSequenceFormat = exportsObj;
  }
})();
