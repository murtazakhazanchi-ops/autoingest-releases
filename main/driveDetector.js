/**
 * driveDetector.js — Main-process module.
 *
 * Uses `drivelist` to enumerate all mounted drives, then checks each
 * mount point for a DCIM folder — the standard directory written by
 * cameras and camera phones. Returns only drives that pass that test.
 */

const drivelist = require('drivelist');
const fs        = require('fs');
const path      = require('path');

/** Folder name that identifies a camera memory card */
const DCIM_DIR = 'DCIM';

/**
 * Returns true when the given mount point contains a DCIM folder.
 * @param {string} mountpoint - Absolute path of the mounted volume.
 * @returns {boolean}
 */
function hasDCIM(mountpoint) {
  try {
    const dcimPath = path.join(mountpoint, DCIM_DIR);
    return fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory();
  } catch {
    // No read access or path doesn't exist — not a memory card
    return false;
  }
}

/**
 * Scans all connected drives and returns those that look like camera
 * memory cards (i.e. contain a DCIM folder at their root).
 *
 * @returns {Promise<Array<{ label: string, mountpoint: string }>>}
 */
async function detectMemoryCards() {
  const drives = await drivelist.list();
  const cards  = [];

  for (const drive of drives) {
    // A drive can expose multiple mountpoints (e.g. partitions)
    for (const mp of drive.mountpoints) {
      if (!mp.path) continue;

      if (hasDCIM(mp.path)) {
        cards.push({
          // Use the volume label when available, fall back to a tidy default
          label:      mp.label || drive.description || 'Unnamed Drive',
          mountpoint: mp.path
        });
      }
    }
  }

  return cards;
}

module.exports = { detectMemoryCards };
