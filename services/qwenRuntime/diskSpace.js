'use strict';

// services/qwenRuntime/diskSpace.js — Ask AutoIngest Stage 3, Section 14
// (disk-space safety). Deterministic, testable space-check logic for a
// future ~2.55 GiB model download/replacement, independent of actually
// performing a download (Section 13/14 both require this be designable
// and testable without a real transfer).
//
// Accounts for: the model's own expected size, a temporary partial-
// download allowance (a .partial file can transiently coexist with an
// existing verified final file during a forced re-download/update -- see
// modelManager.js's own download()'s "never destroy the currently
// verified model before the replacement verifies" contract), and a safety
// margin for filesystem overhead / concurrent activity.

const fsp = require('fs/promises');

// A flat margin (not a percentage) is used deliberately: a percentage of
// a ~2.55 GiB model would itself be hundreds of MB, disproportionate to
// what filesystem overhead/concurrent activity actually needs. 512 MiB is
// a generous, simple, easy-to-reason-about constant.
const SAFETY_MARGIN_BYTES = 512 * 1024 * 1024;

// Computes the bytes that must be free to safely start a download/replace
// of a model of `expectedSizeBytes`. `existingVerifiedPresent` accounts
// for the "replace" case (Section 8's own "supports... update safety
// margin"): when a verified model already occupies disk space and a NEW
// download is about to start alongside it (never destroying the old one
// until the new one verifies), the required free space is the FULL new
// download size + margin, regardless of the old file's own size (the old
// file's space is not being freed until after the new one is confirmed
// good).
function requiredFreeBytes(expectedSizeBytes) {
  return expectedSizeBytes + SAFETY_MARGIN_BYTES;
}

// Cross-platform free-space check via fs.statfs (Node 18.15+, available
// on both macOS and Windows -- no native dependency, no shelling out to
// `df`/`dir`). Returns { freeBytes, requiredBytes, sufficient, path }.
// Never throws on a missing/inaccessible path -- returns a explicit,
// caller-inspectable failure shape instead (Section 22's own "do not
// expose raw native exceptions" boundary applies here too).
async function checkDiskSpace(targetPath, expectedSizeBytes) {
  const requiredBytes = requiredFreeBytes(expectedSizeBytes);
  try {
    const stats = await fsp.statfs(targetPath);
    const freeBytes = stats.bavail * stats.bsize;
    return { ok: true, path: targetPath, freeBytes, requiredBytes, sufficient: freeBytes >= requiredBytes };
  } catch (err) {
    return { ok: false, path: targetPath, error: err && err.message ? err.message : String(err), requiredBytes };
  }
}

module.exports = { SAFETY_MARGIN_BYTES, requiredFreeBytes, checkDiskSpace };
