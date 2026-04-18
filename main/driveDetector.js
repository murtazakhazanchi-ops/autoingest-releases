/**
 * driveDetector.js — Main-process module.
 *
 * Uses `drivelist` to enumerate all mounted drives, then checks each
 * mount point for a DCIM folder — the standard directory written by
 * cameras and camera phones. Returns only drives that pass that test.
 *
 * Patch 37: async hasDCIM (fsp.stat instead of existsSync/statSync) +
 *           4-second drivelist timeout to prevent polling hangs.
 */

const drivelist = require('drivelist');
const fs        = require('fs');
const path      = require('path');

/** Folder name that identifies a camera memory card */
const DCIM_DIR = 'DCIM';

/**
 * Returns true when the given mount point contains a DCIM folder.
 * @param {string} mountpoint - Absolute path of the mounted volume.
 * @returns {Promise<boolean>}
 */
async function hasDCIM(mountpoint) {
  try {
    const st = await fs.promises.stat(path.join(mountpoint, DCIM_DIR));
    return st.isDirectory();
  } catch {
    return false;
  }
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('drivelist timeout')), ms))
  ]).catch(() => fallback);
}

/**
 * Scans all connected drives and returns those that look like camera
 * memory cards (i.e. contain a DCIM folder at their root).
 *
 * @returns {Promise<Array<{ label: string, mountpoint: string }>>}
 */
async function detectMemoryCards() {
  const drives = await withTimeout(drivelist.list(), 4000, []);
  const checks = [];

  for (const drive of drives) {
    for (const mp of drive.mountpoints) {
      if (!mp.path) continue;
      checks.push(
        hasDCIM(mp.path).then(ok => ok ? {
          label:      mp.label || drive.description || 'Unnamed Drive',
          mountpoint: mp.path,
        } : null)
      );
    }
  }

  const results = await Promise.all(checks);
  return results.filter(Boolean);
}

module.exports = { detectMemoryCards };
