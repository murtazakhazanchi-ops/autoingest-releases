/**
 * photographerSequenceGuard.js — READ-ONLY: may photographer sequencing (PCxx renumbering) touch
 * this event? (AI-FEAT-063, AI-RM-014 Q5e-2b, S5 groundwork). Decided BEFORE any folder is renamed.
 *
 * Legacy events (no photographerFolders / photographerFolderHistory) are never affected: the
 * guard answers { ok: true, mapped: false } and sequencing behaves exactly as before.
 *
 * Events WITH S1 identity records (none exist in production — mapping writes are gated off):
 *   - an open photographer-rename transaction (S4 journal <event>/.autoingest/rename-*.json) blocks
 *     all sequencing: the event belongs to that transaction until it is recovered;
 *   - unreadable, invalid or newer-schema records block sequencing — nothing is guessed;
 *   - records that disagree with the folders on disk (missing, case-only, symlink, escape) block;
 *   - a planned rename that would move a MAPPED folder, or move another folder onto a mapped
 *     folder's name, is refused: recording that change in photographerFolders/-History needs the
 *     S4 journal so event.json and the disk can never disagree. There is no unjournaled path.
 *   - renames of folders no mapping refers to proceed; the mappings are carried over untouched.
 *
 * Coordination contract for the future S4 (documented, not implemented):
 *   - S4 takes archiveLockService photographer locks for BOTH the old and the new folder name on
 *     every copy, plus the registry write lock, and writes the journal before any change; this
 *     guard's journal check is what makes sequencing respect it. No second lock type is added.
 *   - an in-process per-event sequencing guard (main.js) refuses a second concurrent run;
 *   - event.json writes go through updateEventJsonAtomic, so a concurrent update is never lost;
 *   - active import / metadata / transfer exclusion for mapped events is S4's lock responsibility;
 *     the existing sync-job check in main.js stays as it is for every event.
 */

'use strict';

const path = require('path');
const F = require('./eventPhotographerFolders');

const EVENT_ROOT_KEY = '__eventRoot__';
const JOURNAL_RE = /^rename-.+\.json$/;
const _fold = (s) => s.normalize('NFC').toLowerCase();

const MESSAGE = {
  'rename-transaction-pending': 'A photographer rename for this event is not finished. Sequencing is blocked until it is completed or recovered.',
  'identity-records-unreadable': 'This event has photographer-folder identity records this version cannot safely update. Sequencing is blocked; nothing was changed.',
  'identity-records-disagree': 'This event\'s photographer-folder identity records do not match the folders on disk. Sequencing is blocked; nothing was changed.',
  'sequence-plan-unavailable': 'The folders of this event could not be read to check its photographer-folder identity records. Sequencing is blocked; nothing was changed.',
  'mapped-folder-rename-requires-s4': 'Renumbering would rename a photographer folder that has an identity record. That needs the archive-safe rename transaction, which is not available yet. Nothing was changed.',
};

async function _pendingJournal(eventPath, fsx) {
  try { return (await fsx.readdir(path.join(eventPath, '.autoingest'))).some(n => JOURNAL_RE.test(n)); }
  catch { return false; }
}

const _refuse = (code) => ({ ok: false, code, reason: MESSAGE[code] });

/**
 * @param {{ eventPath: string, doc: object|null, plan: Array<{ scopeKey: string, from: string, to: string }>|null,
 *           fs?: typeof import('fs').promises }} input
 *   doc — event.json as read before sequencing (null if unreadable: legacy handling applies)
 *   plan — photographerSequenceService.planRenames output, or null if it could not be computed
 * @returns {Promise<{ ok: true, mapped: boolean } | { ok: false, code: string, reason: string }>}
 */
async function checkSequencing({ eventPath, doc, plan, fs: fsx = require('fs').promises }) {
  const read = doc ? F.readPhotographerFolders(doc) : { state: 'absent', mappings: [] };
  if (read.state === 'absent') {
    // A rename journal without S1 records cannot come from this build, but is still respected.
    return (await _pendingJournal(eventPath, fsx)) ? _refuse('rename-transaction-pending') : { ok: true, mapped: false };
  }
  if (await _pendingJournal(eventPath, fsx)) return _refuse('rename-transaction-pending');
  if (read.state !== 'ok') return _refuse('identity-records-unreadable');
  const disk = await F.verifyMappingsOnDisk(eventPath, read.mappings, { fs: fsx });
  if (disk.some(d => d.state !== 'present')) return _refuse('identity-records-disagree');
  if (!Array.isArray(plan)) return _refuse('sequence-plan-unavailable');
  const scopeOf = (m) => (m.scope.componentId === null ? EVENT_ROOT_KEY : m.scope.componentFolder);
  const mapped = new Set(read.mappings.map(m => `${scopeOf(m)}|${_fold(m.folderName)}`));
  for (const r of plan) {
    if (mapped.has(`${r.scopeKey}|${_fold(r.from)}`) || mapped.has(`${r.scopeKey}|${_fold(r.to)}`)) return _refuse('mapped-folder-rename-requires-s4');
  }
  return { ok: true, mapped: true };
}

module.exports = { checkSequencing, MESSAGE, JOURNAL_RE };
