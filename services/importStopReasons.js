/**
 * importStopReasons.js — operator wording for an import the copy engine stopped (AI-FEAT-064 EQI-3.1).
 *
 * Only an explicit operator request is a "cancellation". A source that disappeared, a card that was
 * removed or a lost archive lock is reported as what it was — every variant starts "Import was
 * cancelled" or "Import stopped" so the multi-event runner (importSessionRunner.isCancelMessage) still
 * stops before the next event.
 */

'use strict';

const plural = (n) => `${n} file${n !== 1 ? 's' : ''}`;

/**
 * @param {string|null} reason  fileManager abortReason
 * @param {number} copied
 * @param {number} total
 * @returns {string}
 */
function abortedImportMessage(reason, copied, total) {
  const done = `${copied} of ${plural(total)} copied`;
  const retry = 'Retry to import the remaining files (already-copied files will be skipped automatically).';
  switch (reason) {
    case 'source-unavailable':
      return `Import stopped: the source folder is no longer available (it was renamed, moved or disconnected) — ${done}. Select the source again, then ${retry.charAt(0).toLowerCase()}${retry.slice(1)}`;
    case 'source-disconnected':
      return `Import stopped: the source was disconnected — ${done}. Reconnect it, then ${retry.charAt(0).toLowerCase()}${retry.slice(1)}`;
    case 'lock-lost':
      return `Import stopped: the archive folder lock was lost — ${done}. ${retry}`;
    case 'user':
      return `Import was cancelled — ${done} before cancellation. ${retry}`;
    default:
      return `Import stopped unexpectedly — ${done}. ${retry}`;
  }
}

module.exports = { abortedImportMessage };
