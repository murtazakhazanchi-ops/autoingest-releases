/**
 * trashService.js — recoverable removal of source files for EQI-4 Source Cleanup (AI-FEAT-064).
 *
 * The ONLY removal AutoIngest performs on a source: the operating system's own Trash, then proof that
 * the file is really there. Never unlink, never a hidden folder, never a permanent-delete fallback.
 *
 * macOS — Electron shell.trashItem (NSFileManager trashItemAtURL): on the boot volume the file goes to
 * ~/.Trash; on an external/removable volume (APFS, HFS+, exFAT, FAT32) to <volume>/.Trashes/<uid>/, from
 * where Finder's Put Back restores it. Before trashing, the volume must be local, writable and of a kind
 * that keeps a Trash (apfs, hfs, msdos, exfat); network, read-only and unknown volumes are refused.
 * After trashing, the file must be gone from the source AND found in that Trash (same size, same name or
 * Finder's "name <time>" variant) — otherwise the outcome is "needs attention", never "done".
 *
 * Windows — shell.trashItem (IFileOperation, allow-undo). Removable drives usually have no Recycle Bin and
 * Windows would then delete permanently, so only a fixed drive with a <drive>:\$Recycle.Bin folder is
 * accepted, and the trashed file must then be found in $Recycle.Bin (same size). NOT verified on Windows
 * hardware in this release.
 *
 * Other platforms: unsupported (refused).
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAC_TRASH_FS = new Set(['apfs', 'hfs', 'msdos', 'exfat']);

function _defaultDeps() {
  let shell = null;
  try { ({ shell } = require('electron')); } catch { /* not in Electron (unit tests inject trashItem) */ }
  return {
    platform: process.platform,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    home: os.homedir(),
    trashItem: shell ? (p) => shell.trashItem(p) : null,
    mountTable: () => new Promise((resolve) => execFile('/sbin/mount', [], { timeout: 5000 }, (err, out) => resolve(err ? '' : String(out)))),
  };
}

/** /sbin/mount lines → [{ device, mount, type, flags[] }], longest mount first. */
function parseMountTable(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^(.+?) on (.+) \(([^)]*)\)\s*$/.exec(line.trim());
    if (!m) continue;
    const parts = m[3].split(',').map(s => s.trim()).filter(Boolean);
    out.push({ device: m[1], mount: m[2], type: (parts[0] || '').toLowerCase(), flags: parts.slice(1).map(s => s.toLowerCase()) });
  }
  return out.sort((a, b) => b.mount.length - a.mount.length);
}

function _mountOf(table, p) {
  const q = path.resolve(p);
  return table.find(m => m.mount === '/' || q === m.mount || q.startsWith(m.mount + '/')) || null;
}

/**
 * Whether files under `root` can be moved to a recoverable Trash, and where they go.
 * @returns {Promise<{ ok: boolean, reason?: string, trashDir?: string, volume?: string, fsType?: string, platform: string, verified: boolean }>}
 */
async function capability(root, deps = _defaultDeps()) {
  const platform = deps.platform;
  if (!root) return { ok: false, platform, verified: false, reason: 'No source selected' };
  if (platform === 'darwin') {
    const table = parseMountTable(await deps.mountTable());
    const m = _mountOf(table, root);
    if (!m) return { ok: false, platform, verified: true, reason: 'The source volume could not be identified' };
    if (m.flags.includes('read-only') || m.flags.includes('rdonly')) return { ok: false, platform, verified: true, volume: m.mount, fsType: m.type, reason: 'The source is read-only (locked card or read-only volume) — nothing can be moved to the Trash' };
    if (!m.flags.includes('local')) return { ok: false, platform, verified: true, volume: m.mount, fsType: m.type, reason: `The source is a network volume (${m.type}) — macOS cannot move its files to a recoverable Trash` };
    if (!MAC_TRASH_FS.has(m.type)) return { ok: false, platform, verified: true, volume: m.mount, fsType: m.type, reason: `This volume type (${m.type}) is not supported for recoverable cleanup` };
    try { await fsp.access(root, fs.constants.W_OK); } catch { return { ok: false, platform, verified: true, volume: m.mount, fsType: m.type, reason: 'AutoIngest has no permission to change files on the source' }; }
    const boot = m.mount === '/' || m.mount === '/System/Volumes/Data';
    const trashDir = boot ? path.join(deps.home, '.Trash') : path.join(m.mount, '.Trashes', String(deps.uid));
    return { ok: true, platform, verified: true, volume: m.mount, fsType: m.type, trashDir, boot };
  }
  if (platform === 'win32') {
    const drive = path.parse(path.resolve(root)).root;   // "E:\"
    const bin = path.join(drive, '$Recycle.Bin');
    if (deps.removable) return { ok: false, platform, verified: false, volume: drive, reason: 'Removable drives have no Recycle Bin on Windows — Windows would delete the files permanently, so cleanup is refused' };
    const has = await fsp.stat(bin).then(s => s.isDirectory(), () => false);
    if (!has) return { ok: false, platform, verified: false, volume: drive, reason: 'This drive has no Recycle Bin — cleanup is refused' };
    return { ok: true, platform, verified: false, volume: drive, trashDir: bin };
  }
  return { ok: false, platform, verified: false, reason: 'Recoverable cleanup is not supported on this operating system' };
}

/** Trash entries that could be `name` once trashed (on a collision macOS appends " <time>" to the name). */
async function _macCandidates(trashDir, name) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let entries = [];
  try { entries = await fsp.readdir(trashDir); } catch { return []; }
  // Measured (macOS 26, APFS/HFS+/exFAT/FAT32): a second "IMG_0001.JPG" lands as "IMG_0001.JPG 17-03-41-809.JPG".
  return entries.filter(n => !n.startsWith('._') && (n === name || n.startsWith(`${name} `) || (n.startsWith(`${stem} `) && n.endsWith(ext)))).map(n => path.join(trashDir, n));
}

async function _winCandidates(binDir, name) {
  const ext = path.extname(name).toLowerCase();
  const out = [];
  let sids = [];
  try { sids = await fsp.readdir(binDir); } catch { return out; }
  for (const sid of sids) {
    let entries = [];
    try { entries = await fsp.readdir(path.join(binDir, sid)); } catch { continue; }
    for (const n of entries) if (n.startsWith('$R') && path.extname(n).toLowerCase() === ext) out.push(path.join(binDir, sid, n));
  }
  return out;
}

const _candidates = (cap, name) => (cap.platform === 'win32' ? _winCandidates(cap.trashDir, name) : _macCandidates(cap.trashDir, name));

/** A Trash entry of `size` that was not there before (`before` = candidate paths listed before the move). */
async function _newEntry(cap, name, size, before) {
  const had = new Set(before || []);
  for (const p of await _candidates(cap, name)) {
    if (had.has(p)) continue;
    try { const st = await fsp.stat(p); if (st.isFile() && st.size === size) return p; } catch { /* next */ }
  }
  return null;
}

/**
 * Moves one file to the Trash and proves where it went.
 * @param {string} file
 * @param {{ trashDir: string, platform: string }} cap  capability() result (ok)
 * @param {object} [hooks]  { beforeTrash(candidates) } — the journal records the Trash entries that existed before
 * @returns {Promise<{ outcome: 'trashed', trashPath: string } | { outcome: 'not-removed', error: string } | { outcome: 'needs-attention', error: string }>}
 */
async function trashFile(file, cap, deps = _defaultDeps(), hooks = null) {
  if (!cap || !cap.ok) return { outcome: 'not-removed', error: (cap && cap.reason) || 'Trash unavailable' };
  if (typeof deps.trashItem !== 'function') return { outcome: 'not-removed', error: 'Trash unavailable' };
  let st;
  try { st = await fsp.stat(file); } catch { return { outcome: 'not-removed', error: 'File no longer on the source' }; }
  const before = await _candidates(cap, path.basename(file));
  if (hooks && typeof hooks.beforeTrash === 'function') await hooks.beforeTrash(before);
  try {
    await deps.trashItem(file);
  } catch (err) {
    const still = await fsp.stat(file).then(() => true, () => false);
    return still ? { outcome: 'not-removed', error: `The Trash refused it: ${err.message}` }
      : { outcome: 'needs-attention', error: `Reported an error but the file left the source: ${err.message}` };
  }
  const still = await fsp.stat(file).then(() => true, () => false);
  if (still) return { outcome: 'not-removed', error: 'The file is still on the source after the Trash request' };
  const found = await _newEntry(cap, path.basename(file), st.size, before);
  if (!found) return { outcome: 'needs-attention', error: 'The file left the source but was not found in the Trash' };
  return { outcome: 'trashed', trashPath: found };
}

/**
 * Recovery: where an interrupted cleanup's file is now — never repeats a removal. `before` is the list of
 * Trash entries the journal recorded just before the interrupted move.
 */
async function locate(file, size, before, cap) {
  const onSource = await fsp.stat(file).then(s => s.isFile() && s.size === size, () => false);
  if (onSource) return { where: 'source' };
  if (!cap || !cap.trashDir) return { where: 'unknown' };
  const found = await _newEntry(cap, path.basename(file), size, before);
  return found ? { where: 'trash', trashPath: found } : { where: 'unknown' };
}

module.exports = { capability, trashFile, locate, parseMountTable, MAC_TRASH_FS };
