/**
 * eventDumpPaths.js — the Event Dump destination rule (AI-FEAT-064 EQI-1). Pure.
 *
 *   <event>/Dump/<photographer>/<file>          photos (RAW, JPEG, …)
 *   <event>/Dump/<photographer>/VIDEO/<file>    videos
 *
 * The photographer folder is the confirmed photographer's own plain name: Dump is never
 * PC-sequenced, belongs to no component, and a later Dump import by the same photographer reuses
 * the same folder. import:commitTransaction refuses a Dump import whose jobs break this rule
 * before anything is copied (renderer routing is ImportRouter.buildDumpFileJobs).
 */

'use strict';

const path = require('path');
const { DUMP_DIR, canonicalName } = require('./photographerSequenceService');

/**
 * @param {Array<{src: string, dest: string}>} fileJobs
 * @param {string} eventJsonPath  the event folder the transaction commits (staging copy in Local First)
 * @param {string} photographer   the confirmed photographer
 * @returns {string|null} refusal reason, or null when every job is a valid Dump destination
 */
function dumpJobsRefusal(fileJobs, eventJsonPath, photographer) {
  if (!Array.isArray(fileJobs) || fileJobs.length === 0) return 'no files';
  if (typeof eventJsonPath !== 'string' || !eventJsonPath) return 'no event';
  const name = typeof photographer === 'string' ? photographer.trim() : '';
  if (!name || name !== photographer) return 'no confirmed photographer';
  if (/[\\/:]/.test(name) || name.startsWith('.')) return 'photographer is not a safe folder name';
  if (canonicalName(name) !== name) return 'photographer folder must not carry a PC sequence';
  const base = path.resolve(eventJsonPath, DUMP_DIR, name);
  for (const job of fileJobs) {
    const dest = job && typeof job.dest === 'string' && job.dest ? path.resolve(job.dest) : null;
    if (!dest || !dest.startsWith(base + path.sep)) return 'a destination is outside Event/Dump/<photographer>';
    const rest = path.relative(base, dest).split(path.sep);
    const ok = rest.length === 1 || (rest.length === 2 && rest[0] === 'VIDEO');
    if (!ok || rest.some(p => !p || p === '..')) return 'a destination is not directly inside the photographer folder';
  }
  return null;
}

/**
 * Jobs whose photo is ALREADY in the Dump folder (EQI-1 re-import guard). The global import index
 * is a rolling, filename+size history; once an entry rolls off, a card inserted again looks new.
 * Its JPEGs in the Dump were since rewritten by metadata tagging (size changed), so the copy
 * engine's same-size skip no longer recognises them and would add "_1" duplicates. A job is held
 * back only on strong evidence: its destination exists AND ExifTool's ImageDataHash (image data
 * only, metadata excluded) of source and destination is equal. Different, unreadable or
 * unsupported → the job proceeds unchanged (a genuinely different photo with the same name is
 * still imported, and renamed by the existing conflict rule). Never deletes or overwrites.
 *
 * EQI-2 (Local First): the job's destination is the event's Local Staging copy, which may have been
 * cleared after an earlier sync. `alternateOf(job)` then names the same file in the archive's own
 * Dump folder, which is checked by the same rule — read-only — so a photo that is already in the
 * archive is not staged again and synced as a duplicate.
 * @param {Array<{src: string, dest: string}>} fileJobs
 * @param {{ exists: (p: string) => Promise<boolean>, hashOf: (p: string) => Promise<string|null>, alternateOf?: (job: object) => string|null }} io
 * @returns {Promise<{ copy: object[], alreadyInDump: object[] }>}
 */
async function partitionAlreadyInDump(fileJobs, { exists, hashOf, alternateOf = null }) {
  const copy = [];
  const alreadyInDump = [];
  for (const job of fileJobs) {
    let same = false;
    try {
      const candidates = [job.dest];
      const alt = alternateOf ? alternateOf(job) : null;
      if (alt && alt !== job.dest) candidates.push(alt);
      let srcHash;
      for (const p of candidates) {
        if (!(await exists(p))) continue;
        if (srcHash === undefined) srcHash = await hashOf(job.src);
        const other = await hashOf(p);
        if (typeof srcHash === 'string' && srcHash.length > 0 && srcHash === other) { same = true; break; }
      }
    } catch { same = false; }
    (same ? alreadyInDump : copy).push(job);
  }
  return { copy, alreadyInDump };
}

/**
 * EQI-2: the archive counterpart of a Local First Dump job — the same path below the archive event
 * folder as below the staging event folder. Only for a job inside <staging event>/Dump/.
 * @returns {string|null}
 */
function archiveCounterpart(job, stagingEventPath, archiveEventPath) {
  if (!job || typeof job.dest !== 'string' || !stagingEventPath || !archiveEventPath) return null;
  const rel = path.relative(path.resolve(stagingEventPath), path.resolve(job.dest));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] !== DUMP_DIR) return null;
  return path.join(path.resolve(archiveEventPath), rel);
}

module.exports = { dumpJobsRefusal, partitionAlreadyInDump, archiveCounterpart };
