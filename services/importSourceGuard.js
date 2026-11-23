/**
 * importSourceGuard.js — read-only source checks run before an import writes anything (AI-FEAT-064 EQI-3.1).
 *
 *   dumpOwnerOf      a file inside a managed event's Dump (<event>/Dump/…, the event has event.json) was
 *                    imported already — it is sorted with Sort Dump (a move), never imported a second time
 *   missingSourceDirs  source folders that no longer exist (renamed or moved event, ejected drive): the
 *                    import stops before creating a single destination folder instead of reporting a
 *                    "cancellation" nobody asked for
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { isEventDumpName, canonicalName } = require('./photographerSequenceService');

/**
 * The managed event whose Dump holds `srcPath`, or null.
 * @param {string} srcPath  absolute file path
 * @param {{ exists?: (p: string) => Promise<boolean> }} [io]
 * @returns {Promise<{ eventPath: string, dumpDir: string }|null>}
 */
async function dumpOwnerOf(srcPath, { exists = _isFile } = {}) {
  if (typeof srcPath !== 'string' || !path.isAbsolute(srcPath)) return null;
  let dir = path.dirname(path.resolve(srcPath));
  while (true) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    const name = path.basename(dir);
    if (isEventDumpName(name) && canonicalName(name) === name && await exists(path.join(parent, 'event.json'))) {
      return { eventPath: parent, dumpDir: name };
    }
    dir = parent;
  }
}

/**
 * First managed-event Dump among the jobs' sources (checked once per source folder), or null.
 * @param {Array<{ src: string }>} jobs
 */
async function firstDumpSource(jobs, io) {
  const seen = new Set();
  for (const j of jobs || []) {
    const dir = j && typeof j.src === 'string' ? path.dirname(j.src) : null;
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const owner = await dumpOwnerOf(j.src, io);
    if (owner) return owner;
  }
  return null;
}

/**
 * Source folders of `jobs` that are not reachable now.
 * @param {Array<{ src: string }>} jobs
 * @param {{ isDir?: (p: string) => Promise<boolean> }} [io]
 * @returns {Promise<string[]>}
 */
async function missingSourceDirs(jobs, { isDir = _isDir } = {}) {
  const dirs = [...new Set((jobs || []).filter(j => j && typeof j.src === 'string').map(j => path.dirname(j.src)))];
  const missing = [];
  for (const d of dirs) if (!(await isDir(d))) missing.push(d);
  return missing;
}

function _isFile(p) { return fsp.stat(p).then(s => s.isFile(), () => false); }
function _isDir(p) { return fsp.stat(p).then(s => s.isDirectory(), () => false); }

module.exports = { dumpOwnerOf, firstDumpSource, missingSourceDirs };
