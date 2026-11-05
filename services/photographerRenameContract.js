/**
 * photographerRenameContract.js — implementation contract for photographer renaming
 * (AI-FEAT-063, AI-RM-014 Q5b). Pure data plus one gate. Nothing here renames anything.
 *
 * WHAT EXISTS (Q5b): permanent identity resolution across official names (photographerNameModel),
 * official rename/alias event construction with stale-revision rejection
 * (photographerProfileCommands, gated OFF), and a read-only current-event folder planner
 * (photographerFolderRenamePlanner). WHAT DOES NOT: every requirement below. Until all of them
 * are implemented and separately approved, `renameGate()` keeps profile renaming disabled.
 *
 * Why the gate matters: import routing, local→NAS sync, metadata audit and pending learning
 * all find a photographer's folder BY NAME today. Renaming the registry profile alone would make
 * the next import create a second folder under the new name next to the old one; renaming the
 * folder alone would make sync and audit lose it. The two must change together, recoverably.
 *
 * ── Transaction model (S4) ─────────────────────────────────────────────────────────────────
 * One rename = one journalled transaction, keyed by a random txId, in this order:
 *   1 PLAN       read-only plan (photographerFolderRenamePlanner) + operator choice per folder;
 *                all event copies reachable (local staging AND every NAS copy), or refuse.
 *   2 LOCK       archive-side lock on every copy (archiveLockService, photographer scope, both
 *                old and new folder names) + the registry write lock. Refuse if any is held.
 *   3 JOURNAL    write <copy>/.autoingest/rename-<txId>.json on EVERY copy and a local journal:
 *                txId, photographerId, from/to folder names per scope, expected registry revision,
 *                and per folder a fingerprint (see "folder identity" below). Durable before step 4.
 *   4 EVENT.JSON append photographerFolderHistory + set photographerFolders (S1) on each copy,
 *                atomically (temp + fsync + rename), carrying txId.
 *   5 FOLDERS    two-phase rename per scope (old → .autoingest-tmp-<txId> → new), same as
 *                photographerSequenceService; case-only renames always go through the temp name.
 *   6 REGISTRY   append photographer-renamed with the expected revision (appendEventsChecked).
 *   7 COMMIT     mark journals committed, release locks, emit event:changed (S7), remap pending
 *                learning paths (S8), then delete the journals.
 *
 * Crash recovery (runs before any import, sync or audit on an event with a journal):
 *   - after 4, before 6 (event.json says new, registry still says old): NOT a valid end state.
 *     Recovery finishes forward when every folder from the journal is verified at its new name,
 *     else rolls event.json back to the journal's "from" mapping. The registry is only written
 *     once the archive side is consistent, so the profile name never moves alone.
 *   - after 6, before 7: forward only (registry events are immutable); complete steps 7.
 *   - journal on one copy but not another: the copy without it is untouched; recovery works per
 *     copy and the event stays locked for import until every copy is consistent.
 *   - older AutoIngest versions do not read journals: S1's `photographerFolders` plus a
 *     `minimumAppVersion` written into event.json while a transaction is open make older builds
 *     refuse the event rather than recreate a former-name folder.
 *
 * Folder identity during recovery is NEVER file count + total bytes alone. The journal records,
 * per folder, the folder's own device/inode where the filesystem provides one, a sorted list of
 * (relative path, size, mtime) for its files and a sha256 over that list, and the event-relative
 * scope. A folder is "the same" only when that manifest digest matches; a mismatch stops recovery
 * and asks the operator.
 */

'use strict';

/** Every item must be implemented AND separately approved before profile renaming is enabled. */
const PREREQUISITES = Object.freeze([
  { id: 'S1', title: 'event.json photographer-folder mapping', detail: 'photographerFolders {photographerId → folder per scope} and append-only photographerFolderHistory, written atomically; readers fall back to name matching only for events without it.' },
  { id: 'S2', title: 'Identity-aware import routing', detail: 'Import resolves the chosen name to the permanent ID (resolveOfficialName) and routes to the folder S1 maps for that ID in that scope; a former-name folder is reused, never duplicated under the new name.' },
  { id: 'S3', title: 'Local/NAS sync honours folder history', detail: 'archiveSyncService maps a local folder to its NAS counterpart through photographerFolderHistory, so a renamed folder is not copied as a new photographer folder.' },
  { id: 'S4', title: 'Rename transaction, archive locks, journal and recovery', detail: 'The ordered, journalled transaction above, with archive-side locks on every copy and crash recovery that never relies only on file counts and total bytes.' },
  { id: 'S5', title: 'Photographer sequence preservation', detail: 'The PCxx prefix is kept exactly; photographerSequenceService treats a renamed folder as the same sequence slot and never renumbers because a name changed.' },
  { id: 'S6', title: 'Metadata Audit & Repair', detail: 'Creator/Artist written under a former name is reported as "former official name" for that identity — expected, not a mismatch — and is never rewritten without an explicit repair choice.' },
  { id: 'S7', title: 'Stale renderer state', detail: 'event:changed notification after commit; open windows reload folder lists, and any import started against the old folder mapping is refused and re-planned.' },
  { id: 'S8', title: 'Pending-learning path remap', detail: 'Journalled learning jobs whose files sit under a renamed folder are remapped by the commit step (and by recovery), never dropped or re-attributed.' },
]);

/** The seven Q5a-accepted safety requirements, tracked with the S-items that satisfy them. */
const SAFETY_REQUIREMENTS = Object.freeze([
  { n: 1, text: 'Profile rename stays disabled until identity-aware future-import routing is safe.', by: ['S2'] },
  { n: 2, text: 'Folder rename and registry rename have coordinated, recoverable state transitions.', by: ['S1', 'S4'] },
  { n: 3, text: 'Crash recovery covers a failure between the event.json change and the registry update.', by: ['S4'] },
  { n: 4, text: 'NAS verification does not rely solely on matching file counts and total bytes.', by: ['S3', 'S4'] },
  { n: 5, text: 'Older AutoIngest versions do not silently recreate former-name folders in an event being renamed.', by: ['S1', 'S4'] },
  { n: 6, text: 'All event copies are reachable before a live-event folder rename.', by: ['S4'] },
  { n: 7, text: 'QMZ structures remain outside this rename feature.', by: [] },
]);

/** Requirement ids implemented so far. Empty in Q5b; each later stage adds its own id. */
const IMPLEMENTED = Object.freeze([]);

/** @returns {{ enabled: boolean, unmet: string[] }} */
function renameGate(implemented = IMPLEMENTED) {
  const done = new Set(implemented);
  const unmet = PREREQUISITES.map(p => p.id).filter(id => !done.has(id));
  return { enabled: unmet.length === 0, unmet };
}

module.exports = { PREREQUISITES, SAFETY_REQUIREMENTS, IMPLEMENTED, renameGate };
