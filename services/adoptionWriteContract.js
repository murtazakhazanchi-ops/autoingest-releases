'use strict';

/**
 * adoptionWriteContract.js — Phase 13C-6: Adoption Write Contract Design.
 *
 * Pure module. No filesystem access. No IPC. No writes.
 *
 * Defines the exact contract that a future adoption write (Phase 13C-7+) MUST
 * follow. Exports:
 *  - Constants: blocked conditions, required/manual fields, post-write actions
 *  - validateAdoptionInput() — validate operator confirmation before any write
 *  - buildAdoptionEventJson() — construct the event.json payload (pure, no I/O)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MANDATORY RULES FOR THE FUTURE WRITE PATH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. The write IPC handler MUST run entirely in the main process.
 *  2. Renderer data MUST NOT be trusted. Re-read and re-validate from disk.
 *  3. Validate folderPath containment under configured roots (path.normalize +
 *     path.sep suffix — same guard as adoptionDryRunService.js).
 *  4. Re-stat the candidate folder. Fail if not a directory.
 *  5. Re-check event.json absence (fsp.access). Block if present.
 *  6. Run validateAdoptionInput() — fail if invalid.
 *  7. Build payload with buildAdoptionEventJson() — pure, no I/O.
 *  8. Validate payload with isValidEventJson() (main.js) before writing.
 *  9. Write atomically: write to `jsonPath + '.tmp'`, then fsp.rename(tmp, jsonPath).
 *     On failure: try fsp.unlink(tmp); return { ok: false }.
 * 10. Return { ok: true, data: writtenPayload }. Caller triggers scanEvents refresh.
 * 11. NO folder rename, NO media move, NO metadata write, NO components written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY components: [] (empty)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Manual folders have photographer folders directly inside the event folder —
 *  no sub-event layer. The normal AutoIngest structure requires components with
 *  a folderName that references a sub-event sub-folder. Writing synthetic
 *  component folderNames would require renaming photographer folders (prohibited)
 *  or creating sub-event folders that don't exist (misleading).
 *
 *  Adoption therefore writes components: [] and marks status: 'created'. The
 *  operator opens the event in EventCreator to define components and photographer
 *  routing before any import is possible. The adoption metadata block records
 *  the photographer folders as discovered, for reference.
 *
 *  isValidEventJson() in main.js accepts empty components. dataValidator.js
 *  validateEventJson() also accepts empty components. This is the compliant path.
 */

// ── Blocked conditions ────────────────────────────────────────────────────────

const ADOPTION_BLOCKED_CONDITIONS = Object.freeze([
  'event.json already exists in the folder',
  'Folder path is outside all configured archive roots',
  'Folder no longer exists on disk',
  'Root type is not recognised',
  'Folder name matches a known external or non-event pattern',
  'Folder name cannot be parsed as an AutoIngest event folder',
  'Sequence is 00 (integer 0 fails isValidEventJson — must be >= 1)',
  'Hijri date not parseable from folder name',
  'Collection path not accessible',
  'operatorConfirmation validation failed',
]);

// ── Operator confirmation requirements ───────────────────────────────────────

const ADOPTION_REQUIRED_OPERATOR_FIELDS = Object.freeze([
  { field: 'hijriDate',                    description: 'Confirmed Hijri date (YYYY-MM-DD)' },
  { field: 'sequence',                     description: 'Confirmed sequence number (integer >= 1)' },
  { field: 'photographerFoldersConfirmed', description: 'Operator has reviewed the photographer folder list' },
  { field: 'selectedFolderConfirmed',      description: '_Selected confirmed as external output (not photographer)' },
  { field: 'noMediaChangeConfirmed',       description: 'Operator accepts that no media will be moved or renamed' },
]);

const ADOPTION_MANUAL_REVIEW_FIELDS = Object.freeze([
  { field: 'externalFolders', description: 'External/manual child folders — operator confirms they are preserved' },
  { field: 'manualReviewNotes', description: 'Notes about uncertain fields (written into adoption.manualReviewNotes)' },
]);

// ── No-change guarantees ──────────────────────────────────────────────────────

const ADOPTION_NO_CHANGE_GUARANTEES = Object.freeze([
  'No media files will be moved, copied, renamed, or deleted',
  'No existing folders will be renamed',
  'Photographer folders will be preserved exactly as found on disk',
  '_Selected will be preserved as external output — not treated as photographer content',
  'External and manual child folders will be preserved untouched',
  'No metadata will be applied during adoption',
  'components: [] — no sub-event structure will be imposed on the existing folder layout',
]);

// ── Post-write actions (caller responsibility) ────────────────────────────────

const ADOPTION_POST_WRITE_ACTIONS = Object.freeze([
  'Caller triggers scanEvents / archive event index refresh for the collection',
  'Return { ok: true, data: writtenPayload } to renderer for UI confirmation',
  'Renderer re-opens candidate detail (now shows as managed event)',
]);

// ── Rollback model ────────────────────────────────────────────────────────────

const ADOPTION_ROLLBACK_MODEL = Object.freeze({
  writePattern:   'write event.json.tmp → fsp.rename(tmp, event.json)',
  onRenameFailure: 'fsp.unlink(tmp) — leave folder unchanged',
  onValidationFailure: 'return { ok: false, reason } — do not touch disk',
  mediaProtection: 'only event.json is written — no other files are touched',
  idempotency:    'if event.json already exists at write time, return { ok: false, reason: "event-json-appeared" }',
});

// ── UI readiness gates (for future Adopt button) ──────────────────────────────

const ADOPTION_UI_READINESS_GATES = Object.freeze([
  'candidate.readiness === "ready-to-adopt-later"',
  'dryRun.okForFutureAdoption === true',
  'dryRun.blockers.length === 0',
  'operator has reviewed all manualReviewFields',
  'operatorConfirmation.photographerFoldersConfirmed === true',
  'operatorConfirmation.selectedFolderConfirmed === true',
  'operatorConfirmation.noMediaChangeConfirmed === true',
  'sequence parsed from folder name is an integer >= 1',
]);

// ── Input shape (JSDoc for future IPC handler) ────────────────────────────────

/**
 * Future adoption IPC input shape.
 *
 * @typedef {object} AdoptionInput
 * @property {string}              folderPath      Absolute path to the candidate folder
 * @property {string}              collectionPath  Absolute path to the parent collection
 * @property {string}              rootType        'activeArchiveRoot' | 'mainArchiveRoot' | 'transferRoot'
 * @property {string}              [candidateId]   Adoption preview ID (adopt-XXXX) — for audit only
 * @property {AdoptionConfirmation} operatorConfirmation  Operator-reviewed fields
 *
 * @typedef {object} AdoptionConfirmation
 * @property {string}    hijriDate                    Confirmed Hijri date YYYY-MM-DD
 * @property {number}    sequence                     Confirmed sequence integer >= 1
 * @property {boolean}   photographerFoldersConfirmed  Operator has reviewed photographer folder list
 * @property {boolean}   selectedFolderConfirmed       Operator confirms _Selected is external output
 * @property {boolean}  [externalFoldersConfirmed]    Optional: operator acknowledges external folder preservation.
 *                                                     Not enforced by validateAdoptionInput — external folders are
 *                                                     preserved unconditionally by the components:[] strategy.
 * @property {boolean}   noMediaChangeConfirmed        Operator accepts no media will be moved/renamed
 * @property {string[]} [manualReviewNotes]            Optional notes about uncertain fields
 */

// ── validateAdoptionInput() ───────────────────────────────────────────────────

/**
 * Validate the operator confirmation payload before any write is attempted.
 * Returns { ok: true } or { ok: false, reason: string }.
 * Called in the main process before calling buildAdoptionEventJson().
 *
 * Validates folderPath, collectionPath, rootType, and all required
 * operatorConfirmation fields. The future IPC handler (Phase 13C-7+)
 * may call this as the first validation step — the path/rootType guards
 * here are equivalent to any manual type-checks the handler would otherwise
 * write independently. No duplication is needed.
 *
 * externalFoldersConfirmed is intentionally NOT enforced here. External
 * folders are preserved unconditionally by the components:[] strategy — the
 * operator does not need to explicitly gate on this for adoption to proceed.
 *
 * @param {AdoptionInput} input
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateAdoptionInput(input) {
  if (!input || typeof input !== 'object')
    return { ok: false, reason: 'Input is required' };

  if (!input.folderPath     || typeof input.folderPath     !== 'string')
    return { ok: false, reason: 'folderPath is required' };
  if (!input.collectionPath || typeof input.collectionPath !== 'string')
    return { ok: false, reason: 'collectionPath is required' };
  if (!input.rootType       || typeof input.rootType       !== 'string')
    return { ok: false, reason: 'rootType is required' };

  const c = input.operatorConfirmation;
  if (!c || typeof c !== 'object')
    return { ok: false, reason: 'operatorConfirmation is required' };

  if (!c.hijriDate || typeof c.hijriDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.hijriDate))
    return { ok: false, reason: 'operatorConfirmation.hijriDate must be YYYY-MM-DD' };

  const seqNum = typeof c.sequence === 'number' ? c.sequence : parseInt(c.sequence, 10);
  if (!Number.isInteger(seqNum) || seqNum < 1)
    return { ok: false, reason: 'operatorConfirmation.sequence must be a positive integer >= 1 (sequence 00 is blocked)' };

  if (c.photographerFoldersConfirmed !== true)
    return { ok: false, reason: 'operatorConfirmation.photographerFoldersConfirmed must be true' };
  if (c.selectedFolderConfirmed !== true)
    return { ok: false, reason: 'operatorConfirmation.selectedFolderConfirmed must be true' };
  if (c.noMediaChangeConfirmed !== true)
    return { ok: false, reason: 'operatorConfirmation.noMediaChangeConfirmed must be true' };

  return { ok: true };
}

// ── buildAdoptionEventJson() ──────────────────────────────────────────────────

/**
 * Build the event.json payload for a future adoption write.
 * PURE — no filesystem I/O. Returns the object to write; does not write it.
 *
 * The returned object passes isValidEventJson() (main.js) and
 * validateEventJson() (dataValidator.js).
 *
 * components: [] — intentionally empty. Operator defines components via
 * EventCreator before the event is used for import routing. Photographer
 * folders are preserved in adoption.photographerFolders as advisory metadata.
 *
 * The caller MUST:
 *  1. Re-validate the folder live from disk before calling this.
 *  2. Confirm event.json is still absent.
 *  3. Call validateAdoptionInput() successfully.
 *  4. Call isValidEventJson(payload) — must return true.
 *  5. Write atomically: tmp → rename.
 *
 * @param {object}   params
 * @param {string}   params.folderName           Exact folder name on disk (basename)
 * @param {string}   params.hijriDate             Confirmed Hijri date YYYY-MM-DD
 * @param {number}   params.sequence              Confirmed sequence integer >= 1
 * @param {string[]} [params.photographerFolders] Discovered content folders (advisory)
 * @param {boolean}  [params.hasSelectedFolder]   Whether _Selected is present
 * @param {string[]} [params.externalFolders]     External/manual child folders
 * @param {string|null} [params.candidateId]      Adoption preview ID for audit trail
 * @param {string|null} [params.operatorId]       Operator user ID
 * @param {string|null} [params.operatorName]     Operator display name
 * @param {string[]} [params.warnings]            Dry-run warnings to preserve
 * @param {string[]} [params.manualReviewNotes]   Operator notes
 * @returns {object}  event.json payload (not yet written)
 */
function buildAdoptionEventJson({
  folderName,
  hijriDate,
  sequence,
  photographerFolders = [],
  hasSelectedFolder   = false,
  externalFolders     = [],
  candidateId         = null,
  operatorId          = null,
  operatorName        = null,
  warnings            = [],
  manualReviewNotes   = [],
}) {
  const safeEventName = folderName
    .replace(/[/\\]/g, '-')
    .replace(/[:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    version:      1,
    hijriDate,
    sequence:     Number(sequence),
    eventName:    folderName,
    safeEventName,
    status:       'created',
    components:   [],
    adoption: {
      source:              'manual-folder-adoption',
      adoptedAt:           new Date().toISOString(),
      candidateId:         candidateId  || null,
      operatorId:          operatorId   || null,
      operatorName:        operatorName || null,
      photographerFolders: photographerFolders.slice(),
      hasSelectedFolder:   Boolean(hasSelectedFolder),
      externalFolders:     externalFolders.slice(),
      warnings:            warnings.slice(),
      manualReviewNotes:   manualReviewNotes.slice(),
    },
    updatedAt: Date.now(),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ADOPTION_BLOCKED_CONDITIONS,
  ADOPTION_REQUIRED_OPERATOR_FIELDS,
  ADOPTION_MANUAL_REVIEW_FIELDS,
  ADOPTION_NO_CHANGE_GUARANTEES,
  ADOPTION_POST_WRITE_ACTIONS,
  ADOPTION_ROLLBACK_MODEL,
  ADOPTION_UI_READINESS_GATES,
  validateAdoptionInput,
  buildAdoptionEventJson,
};
