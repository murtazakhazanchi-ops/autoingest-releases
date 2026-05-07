/**
 * driveDetector.js — Main-process module.
 *
 * Uses `drivelist` to enumerate all mounted drives, then checks each
 * mount point for a DCIM folder — the standard directory written by
 * cameras and camera phones.
 *
 * Returns two arrays:
 *   dcim      — drives with a DCIM folder (Memory Card card)
 *   removable — mounted non-system volumes (External Drive card)
 *
 * NOTE: `removable` does NOT rely on drive.isRemovable.  USB-attached SSDs
 * and many Thunderbolt drives report isRemovable:false on both macOS and
 * Windows even though they are externally connected.  Classification is done
 * by mountpoint path instead:
 *   macOS   — any /Volumes/<name> that is not the system disk
 *   Windows — any non-C: drive letter that is not the system disk
 *   other   — falls back to drive.isRemovable
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

/**
 * Returns true when the given mountpoint should appear in the External Drive card.
 *
 * We do not use drive.isRemovable because USB-attached SSDs and Thunderbolt drives
 * commonly report isRemovable:false on macOS and Windows.
 *
 * macOS: anything under /Volumes/ is an externally mounted volume.  The system
 *        disk's APFS sub-volumes (/, /System/Volumes/Data, /System/Volumes/Preboot,
 *        etc.) mount under / or /System/Volumes/ — never under /Volumes/ — so the
 *        prefix check is safe on macOS 10.15+.
 * Windows: exclude the C: drive (covered by isSystem too, but belt-and-suspenders).
 *          All other drive letters are treated as external.
 * Other: fall back to isRemovable.
 *
 * @param {import('drivelist').Drive} drive
 * @param {string} mountpoint
 * @returns {boolean}
 */
function _isExternalMount(drive, mountpoint) {
  if (!mountpoint) return false;
  if (process.platform === 'darwin') {
    return mountpoint.startsWith('/Volumes/');
  }
  if (process.platform === 'win32') {
    return mountpoint.charAt(0).toUpperCase() !== 'C';
  }
  return drive.isRemovable;
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('drivelist timeout')), ms))
  ]).catch(() => fallback);
}

/**
 * Single drivelist.list() call that returns both DCIM-detected memory cards
 * and all removable non-system drives in one pass.
 *
 * @returns {Promise<{ dcim: Array, removable: Array }>}
 */
async function listAllDrives() {
  const drives = await withTimeout(drivelist.list(), 4000, []);
  const dcimChecks = [];
  const removable  = [];

  for (const drive of drives) {
    if (drive.isSystem) continue;
    for (const mp of drive.mountpoints) {
      if (!mp.path) continue;
      dcimChecks.push(
        hasDCIM(mp.path).then(ok => ok ? {
          label:       mp.label || drive.description || 'Unnamed Drive',
          mountpoint:  mp.path,
          size:        drive.size        || 0,
          description: drive.description || '',
          busType:     drive.busType     || '',
          isCard:      drive.isCard      || false,
        } : null)
      );
      if (_isExternalMount(drive, mp.path)) {
        removable.push({
          // Prefer volume label (user-visible name, e.g. "PA1-2TBMK") over hardware description.
          label:      mp.label || drive.description || 'External Drive',
          mountpoint: mp.path,
          size:       drive.size || 0,
          busType:    drive.busType || '',
        });
      }
    }
  }

  const dcimResults = await Promise.all(dcimChecks);
  return { dcim: dcimResults.filter(Boolean), removable };
}

/**
 * Scans all connected drives and returns those that look like camera
 * memory cards (i.e. contain a DCIM folder at their root).
 *
 * @returns {Promise<Array<{ label: string, mountpoint: string }>>}
 */
async function detectMemoryCards() {
  const { dcim } = await listAllDrives();
  return dcim;
}

module.exports = { detectMemoryCards, listAllDrives };
