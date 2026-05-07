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
 * NOTE: `removable` does NOT rely solely on drive.isRemovable.  USB-attached
 * SSDs commonly report isRemovable:false on both macOS and Windows.
 * Classification:
 *   macOS   — any mountpoint under /Volumes/ (APFS system sub-volumes never
 *              mount there, so the prefix check is safe on macOS 10.15+)
 *   Windows — requires a positive external signal: isUSB, isRemovable,
 *              isCard, or busType in {USB, SD, MMC, 1394, FIBRE}.
 *              Known-internal busTypes (SATA, ATA, SCSI, …) are excluded.
 *              Conservative: drives with no recognisable signal are excluded.
 *              Thunderbolt drives fall in this gap; use Browse Manually.
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
 * busType strings (from drivelist's STORAGE_ADAPTER_DESCRIPTOR) that positively
 * identify an externally-connected device.
 */
const _EXTERNAL_BUS_TYPES = new Set(['USB', 'SD', 'MMC', '1394', 'FIBRE']);

/**
 * busType strings that positively identify an internally-connected device.
 * Only applied when isUSB and isRemovable are both false, to avoid
 * misclassifying UAS-over-USB drives (enumerator=SCSI, busType=USB).
 */
const _INTERNAL_BUS_TYPES = new Set(['SATA', 'ATA', 'ATAPI', 'SCSI', 'SAS', 'RAID', 'iSCSI']);

/**
 * Returns true when drivelist fields indicate the drive is externally connected.
 * Checks: isUSB (enumerator-based), isRemovable (Windows removal policy),
 * isCard (SD/MMC bus type), and busType from Storage Adapter Descriptor.
 *
 * @param {import('drivelist').Drive} drive
 * @returns {boolean}
 */
function _hasExternalSignal(drive) {
  if (drive.isUSB)       return true;
  if (drive.isRemovable) return true;
  if (drive.isCard)      return true;
  return _EXTERNAL_BUS_TYPES.has(drive.busType || '');
}

/**
 * Returns true when drivelist fields indicate the drive is internally connected.
 * The isUSB/isRemovable guard prevents false positives on UAS drives whose
 * busType reports as "USB" even though their enumerator is "SCSI".
 *
 * @param {import('drivelist').Drive} drive
 * @returns {boolean}
 */
function _hasInternalSignal(drive) {
  if (drive.isVirtual) return true;
  return _INTERNAL_BUS_TYPES.has(drive.busType || '') && !drive.isUSB && !drive.isRemovable;
}

/**
 * Windows-specific external-mount check.
 *
 * A drive letter is classified as external only when there is a positive external
 * signal (USB, SD/MMC, 1394, isRemovable, isCard).  Unknown non-C: drives with no
 * recognisable signal are excluded by default (conservative) to avoid showing
 * internal D:/E: recovery or data partitions.
 *
 * Thunderbolt drives (enumerator=SCSI, busType=SCSI, isUSB=false, isRemovable=false)
 * will be excluded by this conservative default; users can reach them via Browse Manually.
 *
 * @param {import('drivelist').Drive} drive
 * @param {string} mountpoint
 * @returns {boolean}
 */
function _isWindowsExternalMount(drive, mountpoint) {
  if (!mountpoint) return false;
  if (drive.isSystem) return false;
  if (mountpoint.charAt(0).toUpperCase() === 'C') return false;
  if (_hasInternalSignal(drive)) return false;
  if (_hasExternalSignal(drive)) return true;
  if (process.env.DEBUG_DRIVES) {
    console.log(
      `[driveDetector][win] excluded (no external signal): busType=${drive.busType}` +
      ` enumerator=${drive.enumerator} isUSB=${drive.isUSB}` +
      ` isRemovable=${drive.isRemovable} mp=${mountpoint}`
    );
  }
  return false;
}

/**
 * Returns true when the given mountpoint should appear in the External Drive card.
 *
 * macOS: anything under /Volumes/ is an externally mounted volume.  The system
 *        disk's APFS sub-volumes (/, /System/Volumes/Data, /System/Volumes/Preboot,
 *        etc.) mount under / or /System/Volumes/ — never under /Volumes/ — so the
 *        prefix check is safe on macOS 10.15+.
 * Windows: delegates to _isWindowsExternalMount, which requires a positive external
 *          signal (USB, SD/MMC, isRemovable, isCard) and excludes known-internal
 *          busTypes.  Conservative: drives with no recognised signal are excluded.
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
    return _isWindowsExternalMount(drive, mountpoint);
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
          label:       mp.label || drive.description || 'External Drive',
          mountpoint:  mp.path,
          size:        drive.size        || 0,
          busType:     drive.busType     || '',
          description: drive.description || '',
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
