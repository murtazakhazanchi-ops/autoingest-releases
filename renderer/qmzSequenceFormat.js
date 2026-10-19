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
  // into "5a"/"5b"), then the QMZ type letter — Q/M/Z/O, or a combined/two-letter type
  // (MZ/AQ). See qmzService.js's own SEQ_RE comment (its former definition site, before this
  // extraction) for the full rationale. "QMZ Sequence Enhancements" added O (Olda) and AQ
  // (Aqeeqa) to the original Q/M/Z/MZ set — the two-letter alternatives are listed first
  // purely for readability (matching the existing MZ convention); neither ordering nor
  // alternative shares a leading character that would make the other prefix-match first, so
  // this is not a correctness concern.
  const SEQ_RE = /^(\d{2})([a-z]?)(MZ|AQ|Q|M|Z|O)$/;

  function isValidSequenceCode(code) {
    return typeof code === 'string' && SEQ_RE.test(code);
  }

  // The SINGLE source of truth for per-letter numeric ceilings, shared by
  // main/qmzService.js (via require) and renderer/renderer.js (via window.QmzSequenceFormat)
  // so the renderer's own pre-flight range checks can never drift from the authoritative
  // server-side rule the way three now-fixed hardcoded "52" literals in renderer.js
  // previously did. Q/M/Z's specific ceilings (50/51/52) predate this feature and have no
  // discoverable rationale (see qmzService.js's own comment on this same constant) — left
  // completely untouched. MZ, O, and AQ deliberately have NO entry here: there is no product
  // rationale to invent one for any of them, so all three fall back to MAX_SEQUENCE_NUMBER —
  // exactly the precedent already established for MZ in Stage 1 of "PDF-Assisted QMZ
  // Workspace Folder Generation" (confirmed via AskUserQuestion at the time). O/AQ are a
  // direct continuation of that same decision, not a new ambiguity.
  const LETTER_MAX = { Q: 50, M: 51, Z: 52 };
  const MAX_SEQUENCE_NUMBER = 99;

  const exportsObj = { SEQ_RE, isValidSequenceCode, LETTER_MAX, MAX_SEQUENCE_NUMBER };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.QmzSequenceFormat = exportsObj;
  }
})();
