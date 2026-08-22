const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const fsp  = require('fs').promises;
const { execFile } = require('child_process');
const { detectMemoryCards, listAllDrives } = require('./driveDetector');
const { scanMediaRecursive, buildFolderTree, getShallowFolderTree, readDirectory } = require('./fileBrowser');
const { copyFiles, copyFileJobs, setPaused, getFileHash, abortCopy } = require('./fileManager');
const { getThumbnail, shutdownWorkers } = require('../services/thumbnailer');
const listManager  = require('./listManager');
const aliasEngine  = require('./aliasEngine');
const dateEngine   = require('./dateEngine');
const { parseEventName } = require('./eventNameParser');
const { log } = require('../services/logger');
const telemetry     = require('../services/telemetry');
const crashReporter = require('../services/crashReporter');
const perf          = require('../services/performanceMonitor');
const autoUpdater   = require('../services/autoUpdater');
const settings        = require('../services/settings');
// Canonical Representation Audit, L1 (2026-08-11): the ONE path-containment
// implementation for this whole codebase — already proven correct under
// BUG-013 for the renderer's own UNC/case-sensitivity handling. Dual-exported
// (CJS module.exports here, window.PathUtils for the renderer's own
// <script>-tag load) specifically so both processes share it instead of each
// maintaining its own ad hoc `x.startsWith(root + path.sep)` check.
const PathUtils        = require('../renderer/pathUtils.js');
const nasEventCache       = require('../services/nasEventCache');
const localMirrorService  = require('../services/localMirrorService');
const localSyncManifest   = require('../services/localSyncManifest');
const syncQueueService    = require('../services/syncQueueService');
const archiveSyncService  = require('../services/archiveSyncService');
const archiveLockService      = require('../services/archiveLockService');
const transferExportService      = require('../services/transferExportService');
const transferImportService      = require('../services/transferImportService');
const archiveDiagnosticsService  = require('../services/archiveDiagnosticsService');
const archiveRepairService          = require('../services/archiveRepairService');
const archiveConsistencyService     = require('../services/archiveConsistencyService');
const archiveCompletenessService    = require('../services/archiveCompletenessService');
const archiveAuditTimelineService   = require('../services/archiveAuditTimelineService');
const syncReviewService             = require('../services/syncReviewService');
const adoptionPreviewService        = require('../services/adoptionPreviewService');
const adoptionDryRunService      = require('../services/adoptionDryRunService');
const adoptionWriteService       = require('../services/adoptionWriteService');
const { hidePathBestEffort }     = require('../services/internalFileProtection');
const userManager   = require('./userManager');
const { validateEventJson } = require('./contracts/dataValidator');
const exifService         = require('./exifService');
const { updateEventJsonAtomic } = require('./eventJsonStore');
const metadataQueueStore    = require('./metadataQueueStore');
const metadataStateService  = require('./metadataStateService');
const metadataQueueRecovery = require('./metadataQueueRecovery');
const metadataVerificationService = require('./metadataVerificationService');
const metadataAuditService  = require('../services/metadataAuditService');
const metadataAuditExport   = require('../services/metadataAuditExport');
const metadataRepairService = require('./metadataRepairService');
const metadataSyncService = require('./metadataSyncService');
const { resolvePhotographerFromPath } = require('../services/eventEvidenceReconstruction');
const realtimeOps              = require('../services/realtimeOperationsService');
const offlineCollectionRegistry    = require('../services/offlineCollectionRegistryService');
const photographerSeqService       = require('../services/photographerSequenceService');
const qmzService                   = require('./qmzService');

// ── Platform ─────────────────────────────────────────────────────────────────
const isMac = process.platform === 'darwin';

// ── Constants ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000;
const DEFAULT_DEST     = path.join(os.homedir(), 'Desktop', 'AutoIngestTest');

// ── In-process sync guard ─────────────────────────────────────────────────────
// Prevents duplicate concurrent syncJobNow calls for the same job.
const _syncingJobIds   = new Set();
// Per-job pause signals; set to { paused: true } to stop after the current file.
const _jobPauseSignals = new Map();
// Prevents duplicate concurrent verifyJobChecksum calls for the same job.
const _verifyingJobIds = new Set();

// ── Device health broadcast (advisory) ───────────────────────────────────────
async function _emitDeviceHealth() {
  try {
    const nasRoot     = settings.getNasRoot();
    const stagingRoot = settings.getLocalStagingRoot();
    const summary     = await syncQueueService.getSummary().catch(() => ({ ready: 0, needsAttention: 0, failed: 0 }));
    realtimeOps.emitDeviceHealth({
      nasConnected:     !!nasRoot,
      stagingAvailable: !!stagingRoot,
      pendingSyncCount: (summary.ready || 0) + (summary.needsAttention || 0),
      failedSyncCount:  summary.failed || 0,
    });
  } catch { /* non-fatal advisory emission */ }
}

// ── Last imported file pairs for optional checksum verification ───────────────
// Populated after each import; holds { src, dest } for every copied file.
let lastImportedFiles = [];

// ── Global Import Index ───────────────────────────────────────────────────────
// Persists { lowercaseFilename: { size, addedAt } } across sessions.
// Stored in: ~/Library/Application Support/AutoIngest/importIndex.json
// Old entries written as plain numbers (size only) are treated as already-imported
// with an unknown timestamp; the renderer handles both shapes gracefully.
const IMPORT_INDEX_PATH  = path.join(app.getPath('userData'), 'importIndex.json');
const MAX_INDEX_ENTRIES  = 5000;
let importIndex = {};

// ── What's New ────────────────────────────────────────────────────────────────
// Read and immediately delete the file so the modal shows only once per update.
// storedUpdateInfo is null when there is no pending update to announce.
const LAST_UPDATE_PATH = path.join(app.getPath('userData'), 'lastUpdate.json');
let storedUpdateInfo = null;
try {
  const raw = fs.readFileSync(LAST_UPDATE_PATH, 'utf8');
  storedUpdateInfo = JSON.parse(raw);
  fs.unlinkSync(LAST_UPDATE_PATH);
} catch { /* no pending update — normal startup */ }

function loadImportIndex() {
  try {
    const raw = fs.readFileSync(IMPORT_INDEX_PATH, 'utf8');
    importIndex = JSON.parse(raw);
  } catch {
    importIndex = {};
  }
}

async function saveImportIndex() {
  const tmp = IMPORT_INDEX_PATH + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(importIndex), 'utf8');
    await fsp.rename(tmp, IMPORT_INDEX_PATH);
  } catch (err) {
    log(`importIndex save failed: ${err.message}`);
    try { await fsp.unlink(tmp); } catch {}
  }
}

/**
 * Trims the oldest entries when the index exceeds MAX_INDEX_ENTRIES.
 * Sorts by addedAt ascending so the truly oldest records are removed first.
 * Entries without addedAt (migrated from the old plain-number format) sort
 * to the front and are evicted first — a safe migration default.
 * Runs synchronously and is O(n log n) only when trimming is actually needed.
 */
function trimImportIndex() {
  const entries = Object.entries(importIndex);
  if (entries.length <= MAX_INDEX_ENTRIES) return;
  // Sort oldest first; missing addedAt (legacy entries) sort to position 0
  entries.sort((a, b) => {
    const tA = (a[1] && a[1].addedAt) || 0;
    const tB = (b[1] && b[1].addedAt) || 0;
    return tA - tB;
  });
  const excess = entries.length - MAX_INDEX_ENTRIES;
  for (let i = 0; i < excess; i++) delete importIndex[entries[i][0]];
}

/**
 * Records each successfully copied file into the global index.
 * filePaths: original source paths; destination: the dest folder used.
 */
async function updateImportIndex(filePaths, destPath) {
  let changed = false;
  for (const srcPath of filePaths) {
    try {
      const filename = path.basename(srcPath).toLowerCase();
      const stat     = await fsp.stat(srcPath);
      // Composite key: name + size eliminates false matches when different files
      // share the same filename (e.g. IMG_0001.JPG from two separate shoots).
      const key = filename + '_' + stat.size;
      if (!importIndex[key]) {
        importIndex[key] = { size: stat.size, addedAt: Date.now() };
      }
      // If key already exists the entry is identical — no update needed.
      changed = true;
    } catch { /* skip unreadable */ }
  }
  if (changed) {
    trimImportIndex();
    await saveImportIndex();
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const savedBounds = settings.getWindowBounds();
  const win = new BrowserWindow({
    width:     savedBounds?.width  ?? Math.floor(width  * 0.85),
    height:    savedBounds?.height ?? Math.floor(height * 0.9),
    x:         savedBounds?.x,
    y:         savedBounds?.y,
    minWidth:  1100,
    minHeight: 700,
    center:    !savedBounds,
    show:      false,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 8 } }
      : { frame: false }),
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.on('close', () => settings.setWindowBoundsSync(win.getBounds()));
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}

function createSplashWindow() {
  const win = new BrowserWindow({
    width:       980,
    height:      480,
    center:      true,
    resizable:   false,
    show:        false,
    frame:       false,
    transparent: true,  // lets CSS fade reach true transparency (no dark bg flash)
    hasShadow:   true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '../renderer/splash.html'));
  return win;
}

// ── Drive polling ─────────────────────────────────────────────────────────────
function startDrivePolling() {
  async function poll() {
    try {
      const { dcim, removable } = await listAllDrives();
      if (dcim.length) {
        dcim.forEach(c => log(`Drive detected: ${c.mountpoint} (${c.label})`));
      }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('drives:updated', dcim);
          win.webContents.send('drives:allUpdated', removable);
        }
      }
    } catch (err) {
      console.error('[driveDetector] poll error:', err.message);
    }
  }
  poll();
  return setInterval(poll, POLL_INTERVAL_MS);
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
let pollHandle = null;
let _splashWin = null;

app.whenReady().then(() => {
  if (!isMac) Menu.setApplicationMenu(null);
  log('App started');
  loadImportIndex();
  settings.init();
  realtimeOps.init();
  // Seed operator name from the last active user so presence is correct from first connect.
  try {
    const _activeUser = userManager.getActiveUser();
    if (_activeUser?.name) realtimeOps.setOperatorName(_activeUser.name);
  } catch (_e) { /* non-fatal — identity updates later via users:setActive */ }
  // Emit initial health snapshot after a short startup delay, then every 60 s.
  setTimeout(_emitDeviceHealth, 6000);
  setInterval(_emitDeviceHealth, 60_000);
  // Resume metadata batches an unclean exit left mid-write. Runs once, after a
  // short delay so it never competes with startup I/O for the splash screen.
  setTimeout(() => {
    metadataQueueRecovery.resumeInterruptedBatches()
      .then(summary => {
        if (summary.batchesScanned > 0) {
          log(`[main] Metadata queue resume: ${summary.batchesScanned} batch(es) scanned, ${summary.filesResumed} file(s) resumed, ${summary.filesStale} stale, ${summary.eventsUpdated} event(s) updated`);
        }
        // Prune old compacted batches only after resume has had first crack at the
        // active queue — retention is a disk-growth concern with no correctness
        // impact (compacted/ is never rescanned by resume/audit/repair), so it can
        // safely run after, never gating, the recovery pass. Best-effort by design;
        // never throws.
        return metadataQueueStore.pruneCompactedBatches();
      })
      .then(pruneSummary => {
        if (pruneSummary && pruneSummary.deleted > 0) {
          log(`[main] Metadata queue retention: ${pruneSummary.deleted}/${pruneSummary.scanned} compacted file(s) older than retention pruned, ${pruneSummary.failed} failed`);
        }
      })
      .catch(err => log(`[main] Metadata queue resume/prune failed: ${err.message}`));
  }, 3000);
  listManager.init(app.getPath('userData'));
  aliasEngine.init(app.getPath('userData'));
  telemetry.init();
  perf.init();
  autoUpdater.init();
  _splashWin = createSplashWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      _splashWin = createSplashWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log('App closing');
  perf.stop();
  telemetry.flush().catch(() => {});
  shutdownWorkers();
  exifService.shutdown().catch(() => {});
  realtimeOps.shutdown();
  if (pollHandle) clearInterval(pollHandle);
  if (process.platform !== 'darwin') app.quit();
});

// Catch unhandled rejections so they go to the log and never crash the process.
process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  console.error('[unhandledRejection]', reason);
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Patch 22: request-id tracking per sender
const activeFileRequests = new Map();

// Startup: splash complete → open main window, close splash
ipcMain.handle('splash:complete', () => {
  const mainWin = createMainWindow();
  crashReporter.init(mainWin);
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = startDrivePolling();
  // Start invisible so we can fade in after the splash closes
  mainWin.setOpacity(0);
  mainWin.once('ready-to-show', () => {
    // Show main window (invisible) then close splash — both windows swap without a gap
    mainWin.show();
    if (_splashWin && !_splashWin.isDestroyed()) {
      _splashWin.close();
      _splashWin = null;
    }
    // Fade main window in over 200ms (10 steps × 20ms)
    let step = 0;
    const fadeIn = setInterval(() => {
      step++;
      mainWin.setOpacity(step / 10);
      if (step >= 10) clearInterval(fadeIn);
    }, 20);
  });
});

// Drive list (on-demand)
ipcMain.handle('drives:get', async () => detectMemoryCards());

ipcMain.handle('drive:eject', async (event, mountpoint) => {
  // Patch 21: input validation + execFile with array args (no shell injection)
  if (typeof mountpoint !== 'string' || mountpoint.length > 260) {
    throw new Error('Invalid mountpoint');
  }

  const cards = await detectMemoryCards();
  if (!cards.some(c => c.mountpoint === mountpoint)) {
    throw new Error('Mountpoint is not a known card');
  }

  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => err ? reject(err) : resolve(true));
  });

  const platform = process.platform;
  const safe     = path.normalize(mountpoint);
  log(`Eject requested: ${safe}`);

  // Patch 28: clear any pending thumb watchdog timers before unmounting
  perf.clearThumbTimers();

  try {
    if (platform === 'darwin') {
      if (!/^\/Volumes\/[^'"`$;&|]+\/?$/.test(safe)) throw new Error('Unsafe path');
      try { await run('diskutil', ['eject', safe]); }
      catch { await run('diskutil', ['unmount', safe]); }
    } else if (platform === 'win32') {
      const m = safe.match(/^([A-Z]):[\\/]*$/i);
      if (!m) throw new Error('Invalid Windows drive letter');
      await run('powershell', ['-Command', `Remove-Volume -DriveLetter ${m[1]} -Confirm:$false`]);
    } else {
      if (!/^[/\w.\-]+$/.test(safe)) throw new Error('Unsafe path');
      await run('udisksctl', ['unmount', '-b', safe]);
    }

    log(`Eject success: ${safe}`);
    return true;

  } catch (err) {
    log(`Eject failed: ${safe} | ${err.message}`);
    throw err;
  }
});

// File browser
ipcMain.handle('files:get', async (event, { drivePath, folderPath, requestId }) => {
  const senderId = event.sender.id;
  activeFileRequests.set(senderId, requestId); // Patch 22: track active request per sender

  // -- Commit 3 (v0.6.0): full-card recursive scan.
  // Replaces getDCIMPath + readDirectory + scanPrivateFolder.
  // scanMediaRecursive walks the tree from targetPath, filters to media, bat-ches stats,
  // and naturally covers Sony PRIVATE/M4ROOT/CLIP, AVCHD/STREAM, any user-created subdirs.
  const targetPath = folderPath || drivePath;

  // dcimPathForUI: anchor value the renderer still consumes for breadcrumb + sidebar.
  // Until Commit 6 builds a real folder tree, we return the drive mountpoint so the
  // renderer has a stable non-null root. Folders list is empty in Commits 3-5.
  const dcimPathForUI = drivePath;

  const files = await scanMediaRecursive(targetPath, (batch) => {
    if (activeFileRequests.get(senderId) !== requestId) return; // Patch 22: superseded
    if (event.sender.isDestroyed()) return;
    event.sender.send('files:batch', {
      requestId,
      dcimPath:   dcimPathForUI,
      folderPath: targetPath,
      folders:    null,          // Commit 6: null = "no tree update"; real tree ships in final return
      files:      batch.files,
      processed:  batch.processed,
      total:      batch.total,
    });
  });

  // Sort newest-first (renderer pair/timeline logic assumes this).
  files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  // Patch 22: if a newer request arrived during the scan, return empty.
  if (activeFileRequests.get(senderId) !== requestId) {
    return { dcimPath: dcimPathForUI, folderPath: targetPath, folders: [], files: [] };
  }

  // Commit 6: build folder tree once from the complete file list and ship it.
  const folderTree = buildFolderTree(files);
  return { dcimPath: dcimPathForUI, folderPath: targetPath, folders: folderTree, files };
});

// Shallow folder tree — directories only, no file scanning.
// Used by external-drive/local-folder entry for instant workspace reveal.
ipcMain.handle('folders:get', async (_event, { drivePath }) => {
  return getShallowFolderTree(drivePath);
});

// Non-recursive direct listing — immediate children only (media files + subfolders).
// Used by external-drive/local-folder folder navigation so clicking a folder
// never triggers a recursive descent into nested directories.
ipcMain.handle('files:getDirect', async (_event, { folderPath }) => {
  return readDirectory(folderPath);
});

// Default destination path
ipcMain.handle('dest:getDefault', async () => DEFAULT_DEST);

// Native folder-picker dialog
ipcMain.handle('dest:choose', async () => {
  const win    = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      'Choose Import Destination',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

/**
 * dest:scanFiles — async, non-blocking scan of destination folder.
 * Returns { filename: sizeBytes } map filtered to known media extensions.
 * Patch 17: filters to known media extensions only.
 */
ipcMain.handle('dest:scanFiles', async (_event, destPath) => {
  const result = {};
  try {
    const config = require('../config/app.config');
    const knownExts = new Set([
      ...config.PHOTO_EXTENSIONS,
      ...config.VIDEO_EXTENSIONS,
    ]);
    const entries = await fsp.readdir(destPath, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(e => e.isFile())
        .filter(e => knownExts.has(path.extname(e.name).toLowerCase()))
        .map(async (entry) => {
          try {
            const stat = await fsp.stat(path.join(destPath, entry.name));
            result[entry.name] = stat.size;
          } catch { /* skip unreadable */ }
        })
    );
  } catch { /* folder doesn't exist yet */ }
  return result;
});

/**
 * files:import — ensures dest exists (async mkdir), copies files, logs outcome.
 */
ipcMain.handle('files:import', async (event, { filePaths, destination, importedBy }) => {
  log(`Import started: ${filePaths.length} files → ${destination}`);

  try {
    await fsp.mkdir(destination, { recursive: true });
  } catch (err) {
    log(`Import mkdir failed: ${destination} | ${err.message}`);
    throw err;
  }

  const importStartMs  = Date.now();
  let   bytesCopiedSoFar = 0;
  let   fileIndex      = 0;

  const result = await copyFiles(filePaths, destination, (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('import:progress', progress);
    }
    // Track bytes for speed sampling (status 'done' or 'renamed' = file was copied)
    if (progress.status === 'done' || progress.status === 'renamed') {
      bytesCopiedSoFar += progress.fileSize || 0;
      fileIndex++;
      // Sample speed every 10 copied files
      if (fileIndex % 10 === 0) {
        perf.importSpeedSample(bytesCopiedSoFar, Date.now() - importStartMs);
      }
    }
  });

  log(`Import completed: copied=${result.copied} skipped=${result.skipped} errors=${result.errors} → ${destination}`);

  // Store for optional post-import checksum verification
  lastImportedFiles = result.copiedFiles || [];

  // Size check is always performed by verifyFile() inside copyFiles().
  // Signal this to the renderer so the UI can confirm integrity was checked.
  result.integrity = 'verified';

  // Persist successfully-imported files into the global cross-session index
  if (result.copied > 0) {
    await updateImportIndex(filePaths, destination);
  }

  // Auto-report import failures to telemetry (passive — no tester action required)
  if (result.errors > 0) {
    telemetry.enqueue({
      type:         'error',
      issueType:    'Import Failure',
      severity:     result.errors >= 5 ? 'High' : 'Medium',
      description:  `Import completed with ${result.errors} failure(s) out of ${filePaths.length} files`,
      importResult: `Copied: ${result.copied}  Skipped: ${result.skipped}  Failed: ${result.errors}`,
      context: {
        destination,
        totalFiles: filePaths.length,
        errors:     result.errors,
      },
    });
  }

  result.importedBy = importedBy || null;
  // TODO: persist importedBy into importIndex entries and event.json imports[]
  //       once the audit schema is extended for operator attribution.
  return result;
});

// ── Sequenced-photographer-folder resolution ─────────────────────────────────
// Handles the case where photographer sequencing (PCxx- prefixes) has already
// been applied to an event folder but the import still references the plain name.
// importRouter builds dest paths from photographerSequences in event.json; if that
// field is absent (pre-feature events, manual renames, sync lag) the plain name is
// used and would create a duplicate unsequenced folder.
//
// This pre-flight step checks each unique photographer dest dir before the copy.
// If the dir doesn't exist but exactly one PCxx-/PCxx_ prefixed sibling matches
// (after prefix strip + normalisation), dest paths are rewritten to use it.
// 0 matches → create new folder as normal. 2+ matches → warn, keep plain name.

// PC prefix pattern: PC01-…PC999- or PC01_…PC999_ (mirrors photographerSequenceService)
const _IMPORT_PC_SEQ_RE = /^PC(\d{2,3})[-_]/;

function _normPhotogName(name) {
  return (name || '').replace(_IMPORT_PC_SEQ_RE, '').toLowerCase().trim()
    .replace(/[\s\-_]+/g, ' ');
}

async function _resolveSeqPhotographerFolders(jobs) {
  const VIDEO_EXTS = new Set(['.mp4', '.mov']); // mirrors VIDEO_EXTENSIONS in importRouter.js
  const SKIP_NAMES = new Set(['_Selected', '__MACOSX', '.autoingest', '.DS_Store']);

  // Collect unique photographer dirs (strip VIDEO sub-dir for video files).
  const dirMap = new Map(); // photogDir → resolved photogDir
  for (const job of jobs) {
    const ext = path.extname(job.dest).toLowerCase();
    let photogDir = path.dirname(job.dest);
    if (VIDEO_EXTS.has(ext) && path.basename(photogDir) === 'VIDEO') {
      photogDir = path.dirname(photogDir);
    }
    if (!dirMap.has(photogDir)) dirMap.set(photogDir, photogDir);
  }

  for (const [photogDir] of dirMap) {
    // Already exists (correct folder name, sequenced or plain) → no change needed.
    try { await fsp.access(photogDir); continue; } catch {}

    const parentDir  = path.dirname(photogDir);
    const targetNorm = _normPhotogName(path.basename(photogDir));
    if (!targetNorm) continue;

    let candidates = [];
    try {
      const entries = await fsp.readdir(parentDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (SKIP_NAMES.has(e.name) || e.name.startsWith('.')) continue;
        if (!_IMPORT_PC_SEQ_RE.test(e.name)) continue; // only check sequenced folders
        if (_normPhotogName(e.name) === targetNorm) candidates.push(e.name);
      }
    } catch { continue; }

    if (candidates.length === 1) {
      dirMap.set(photogDir, path.join(parentDir, candidates[0]));
      log(`[import] Sequenced folder resolved: "${path.basename(photogDir)}" → "${candidates[0]}"`);
    } else if (candidates.length > 1) {
      log(`[import] Ambiguous sequenced folder for "${path.basename(photogDir)}" (${candidates.join(', ')}) — keeping plain name`);
    }
  }

  // Rewrite dest paths only where the photographer dir changed.
  return jobs.map(job => {
    const ext = path.extname(job.dest).toLowerCase();
    let photogDir = path.dirname(job.dest);
    let relSuffix = path.basename(job.dest);
    if (VIDEO_EXTS.has(ext) && path.basename(photogDir) === 'VIDEO') {
      relSuffix = path.join('VIDEO', relSuffix);
      photogDir = path.dirname(photogDir);
    }
    const resolved = dirMap.get(photogDir);
    if (resolved && resolved !== photogDir) {
      return { src: job.src, dest: path.join(resolved, relSuffix) };
    }
    return job;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function importFileJobs(event, fileJobs, onTeamProgress = null) {
  if (!Array.isArray(fileJobs) || fileJobs.length === 0) {
    return { copied: 0, skipped: 0, errors: 0, skippedReasons: [], failedFiles: [], duration: 0, integrity: 'verified' };
  }

  log(`Import (jobs) started: ${fileJobs.length} files`);

  // Normalise dest paths to the OS-native separator.
  // The renderer builds dest strings with '/' separators for simplicity;
  // path.normalize converts them to '\' on Windows and is a no-op on macOS.
  const normalisedJobs = fileJobs.map(j => ({
    src:  path.normalize(j.src),
    dest: path.normalize(j.dest),
  }));

  // Resolve existing sequenced photographer folders before copying.
  // Rewrites dest paths to match an existing PCxx-Name folder when the plain
  // name doesn't exist on disk yet. No-op when sequences are already correct.
  const resolvedJobs = await _resolveSeqPhotographerFolders(normalisedJobs);

  const importStartMs    = Date.now();
  let   bytesCopiedSoFar = 0;
  let   fileIndex        = 0;

  let result;
  try {
    result = await copyFileJobs(resolvedJobs, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('import:progress', progress);
      }
      if (progress.status === 'done' || progress.status === 'renamed') {
        bytesCopiedSoFar += progress.fileSize || 0;
        fileIndex++;
        if (fileIndex % 10 === 0) {
          perf.importSpeedSample(bytesCopiedSoFar, Date.now() - importStartMs);
        }
        if (onTeamProgress) onTeamProgress(progress.completedCount, progress.total);
      }
    });
  } catch (err) {
    // mkdir pre-flight failure (e.g. disk full, permission denied)
    log(`Import (jobs) mkdir failed: ${err.message}`);
    throw err;
  }

  log(`Import (jobs) completed: copied=${result.copied} skipped=${result.skipped} errors=${result.errors}`);

  // Store for optional post-import checksum verification
  lastImportedFiles = result.copiedFiles || [];

  // Size check is always performed by verifyFile() inside copyFileJobs.
  result.integrity = 'verified';

  // Persist successfully-imported source files into the global cross-session index.
  // updateImportIndex only uses the src paths (destPath arg is unused).
  if (result.copied > 0) {
    await updateImportIndex(normalisedJobs.map(j => j.src), null);
  }

  // Auto-report import failures to telemetry
  if (result.errors > 0) {
    telemetry.enqueue({
      type:         'error',
      issueType:    'Import Failure',
      severity:     result.errors >= 5 ? 'High' : 'Medium',
      description:  `Import (jobs) completed with ${result.errors} failure(s) out of ${fileJobs.length} files`,
      importResult: `Copied: ${result.copied}  Skipped: ${result.skipped}  Failed: ${result.errors}`,
      context: {
        totalFiles: fileJobs.length,
        errors:     result.errors,
      },
    });
  }

  return result;
}

/**
 * files:importJobs — event-based import using the fileJobs model (G2).
 *
 * Each job specifies its own destination path, enabling routing to:
 *   archiveRoot/Collection/Event/[SubEvent/]Photographer/[VIDEO/]filename
 *
 * This handler is the entry point for the structured archive flow (G3–G5).
 * The legacy files:import handler remains for Quick Import (G6).
 *
 * @param {{ fileJobs: Array<{src: string, dest: string}> }} payload
 * @returns same result shape as files:import
 */
ipcMain.handle('files:importJobs', async (event, { fileJobs }) => {
  return importFileJobs(event, fileJobs);
});

function normalizeImportSource(src) {
  if (!src || typeof src !== 'object') {
    return { type: 'unknown', label: 'Unknown source', path: '' };
  }
  const type  = typeof src.type  === 'string' ? src.type.trim()  : '';
  const label = typeof src.label === 'string' ? src.label.trim() : '';
  const p     = typeof src.path  === 'string' ? src.path.trim()  : '';
  return {
    type:  type  || 'unknown',
    label: label || 'Unknown source',
    path:  p,
  };
}

function buildAuditImportEntries(auditContext = {}) {
  const now = new Date().toISOString();
  const baseSeq = Date.now();
  const subEventNames = Array.isArray(auditContext.subEventNames) ? auditContext.subEventNames : [];
  const isMulti = subEventNames.length > 0;
  const groups = Array.isArray(auditContext.groups) ? auditContext.groups : [];
  const liveComps = Array.isArray(auditContext.components) ? auditContext.components : [];
  const photographer = auditContext.photographer;
  const source       = normalizeImportSource(auditContext.source);
  const importedBy   = (auditContext.importedBy && typeof auditContext.importedBy === 'object')
    ? auditContext.importedBy
    : null;
  const config = require('../config/app.config');
  const VIDEO_EXT_SET = new Set(config.VIDEO_EXTENSIONS);
  const logs = [];

  groups.forEach((group, index) => {
    let componentIndex = 0;
    if (isMulti) {
      const matchIdx = subEventNames.findIndex(se => se.name === group.subEventId);
      if (matchIdx >= 0) componentIndex = matchIdx;
    }
    const comp = liveComps[componentIndex];
    const componentName = comp ? comp.eventTypes.map(t => t.label).join(', ') : '';
    let photos = 0, videos = 0;
    for (const filePath of (group.files || [])) {
      const ext = '.' + (filePath.split('.').pop() || '').toLowerCase();
      if (VIDEO_EXT_SET.has(ext)) videos++; else photos++;
    }
    const id = Date.now().toString(36) +
      '-' + Math.random().toString(36).slice(2) +
      '-' + (auditContext.collName || 'unknown');
    logs.push({
      id,
      seq:            baseSeq + index,
      timestamp:      now,
      photographer,
      componentIndex,
      componentName,
      counts:         { photos, videos },
      source,
      importedBy,
    });
  });

  return logs;
}

async function _writeLastMetadataRun(eventJsonFilePath, batchStats, contextGroups) {
  const { done = 0, failed = 0, skipped = 0, partial = 0, ambiguous = 0 } = batchStats;
  // partial/ambiguous files were written (or skipped) without full read-back-verified
  // completion — they must not be reported as a clean 'applied' run. A fuller
  // per-event-state derivation (durable counts, precedence-free decision tree) is
  // Phase C/D scope; this is the minimal fix so lastMetadataRun.status stops lying.
  const status = (failed > 0 && done === 0 && skipped === 0) ? 'failed'
    : (failed > 0 || partial > 0 || ambiguous > 0) ? 'partial'
    : 'applied';
  const lastMetadataRun = {
    timestamp: new Date().toISOString(),
    status,
    processed: done,
    failed,
    skipped,
    partial,
    ambiguous,
    metadataVersion: 1,
  };
  const taggedGroups = Array.isArray(contextGroups)
    ? contextGroups.filter(g => Array.isArray(g.metadataTags))
    : [];
  const metadataSummary = taggedGroups.length > 0
    ? taggedGroups.map(g => ({
        tag: g.metadataTags.length === 0 ? 'No component tag' : g.metadataTags.join(' + '),
        fileCount: Array.isArray(g.files) ? g.files.length : 0,
      }))
    : null;
  try {
    await updateEventJsonAtomic(eventJsonFilePath, () => {
      const changes = { lastMetadataRun };
      if (metadataSummary) changes.metadataSummary = metadataSummary;
      return changes;
    });
    hidePathBestEffort(eventJsonFilePath).catch(() => {});
  } catch (err) {
    log(`[main] Failed to persist lastMetadataRun to ${path.basename(eventJsonFilePath)}: ${err.message}`);
  }
}

/**
 * Recomputes the event's durable metadata-status block from the metadata-queue
 * manifest+journal records and persists it into event.json, then compacts the
 * batch's manifest+journal out of the active queue dir — only after event.json
 * durably reflects the outcome, so a crash between these two steps never makes a
 * batch's result invisible to a later resume.
 */
async function _persistMetadataStateAndCompact(batchId, eventJsonFilePath) {
  if (!eventJsonFilePath) return;
  try {
    await metadataStateService.persistEventMetadataState(eventJsonFilePath);
  } catch (err) {
    log(`[main] Failed to persist metadataState for ${eventJsonFilePath}: ${err.message}`);
    return; // do not compact — event.json doesn't durably reflect this batch yet.
  }
  if (batchId) {
    metadataQueueStore.compactBatch(batchId).catch(err =>
      log(`[main] Failed to compact metadata batch ${batchId}: ${err.message}`));
  }
}

/**
 * Read-only verification + reconcile for files that reached the archive outside the
 * normal applyBatch write path (Transfer Import, same-size-skip). Incomplete files
 * are queued through applyBatch — governed by settings.getAutoMetadataEnabled() —
 * only when the setting is on; otherwise they're recorded as verification-required.
 *
 * Known limitation: extraCounts merged here reflect this verification pass's
 * findings at the moment it runs. If a later, unrelated metadata batch for the same
 * event recomputes metadataState (manifest-derived only), that later recompute can
 * transiently drop this pass's contribution from the displayed rollup until the next
 * verification run — the underlying files' real tag state on disk is unaffected.
 * A durable per-event verification ledger (merged the same way manifests are) would
 * close this gap; not built here (Phase E/F-adjacent scope).
 *
 * @param {string} eventJsonFilePath
 * @param {Array<{src:string, dest:string, photographer?:string|null}>} files
 * @param {object} context Same evidence shape exifService.applyBatch consumes.
 */
async function _verifyAndReconcile(eventJsonFilePath, files, context) {
  if (!files || files.length === 0) return;

  let results;
  try {
    results = await metadataVerificationService.verifyFiles(files, context);
  } catch (err) {
    log(`[main] Metadata verification failed for ${eventJsonFilePath}: ${err.message}`);
    return;
  }

  const toQueue = [];
  const extraCounts = { eligible: 0, complete: 0, ambiguous: 0, verificationRequired: 0, failed: 0 };

  for (const r of results) {
    if (r.status === 'excluded') continue; // video — never eligible, never counted.
    if (r.status === 'complete') { extraCounts.eligible++; extraCounts.complete++; continue; }
    if (r.status === 'ambiguous') { extraCounts.eligible++; extraCounts.ambiguous++; continue; }
    if (r.status === 'read-error') { extraCounts.eligible++; extraCounts.failed++; continue; }
    // incomplete
    if (settings.getAutoMetadataEnabled()) {
      const src = files.find(f => f.dest === r.dest);
      if (src) toQueue.push(src);
    } else {
      extraCounts.eligible++; extraCounts.verificationRequired++;
    }
  }

  if (toQueue.length > 0) {
    const batchId = `verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    exifService.applyBatch(batchId, toQueue, context, async (p) => {
      if (p.event === 'batch_complete') {
        try {
          await _writeLastMetadataRun(eventJsonFilePath, p, context.groups);
        } catch (writeErr) {
          log(`[main] verify-and-repair _writeLastMetadataRun failed for ${eventJsonFilePath}: ${writeErr.message}`);
        }
        await _persistMetadataStateAndCompact(p.batchId, eventJsonFilePath);
      }
    });
  }

  if (extraCounts.eligible > 0) {
    try {
      await metadataStateService.persistEventMetadataState(eventJsonFilePath, { extraCounts });
    } catch (err) {
      log(`[main] Failed to persist verification-derived metadataState for ${eventJsonFilePath}: ${err.message}`);
    }
  }
}

/**
 * Reconstructs groups/diskComponents-shaped evidence + per-file photographer for
 * files that reached the archive without ever passing through a renderer-built
 * metadataGroups selection (Transfer Import) — mirrors metadata:reapplyEvent's
 * folder-structure-based photographer resolution, the only other workflow that
 * already has to solve this same problem.
 */
function _buildTransferVerificationContext(eventFolderPath, eventJson, filesForEvent) {
  const components = Array.isArray(eventJson?.components) ? eventJson.components : [];
  const isMulti = components.length > 1;
  const imports = Array.isArray(eventJson?.imports) ? eventJson.imports : [];
  const fallbackPhotographer = imports.length > 0 ? (imports[imports.length - 1].photographer || '') : '';

  const resolvePhotographer = (filePath, baseDir) => resolvePhotographerFromPath(filePath, baseDir, fallbackPhotographer);

  const groups = [];
  const filesWithPhotographer = [];

  if (!isMulti) {
    groups.push({ id: 'root', subEventId: null, files: filesForEvent.map(f => f.dest) });
    for (const f of filesForEvent) {
      filesWithPhotographer.push({ ...f, photographer: resolvePhotographer(f.dest, eventFolderPath) });
    }
  } else {
    const matched = new Set();
    for (const comp of components) {
      if (!comp.folderName) continue;
      const compDir  = path.join(eventFolderPath, comp.folderName) + path.sep;
      const compFiles = filesForEvent.filter(f => f.dest.startsWith(compDir));
      if (compFiles.length === 0) continue;
      groups.push({ id: comp.folderName, subEventId: comp.folderName, files: compFiles.map(f => f.dest) });
      for (const f of compFiles) {
        filesWithPhotographer.push({ ...f, photographer: resolvePhotographer(f.dest, path.join(eventFolderPath, comp.folderName)) });
        matched.add(f.dest);
      }
    }
    for (const f of filesForEvent) {
      if (!matched.has(f.dest)) filesWithPhotographer.push({ ...f, photographer: fallbackPhotographer || null });
    }
  }

  return {
    context: {
      photographer: fallbackPhotographer, hijriDate: eventJson?.hijriDate || null,
      eventDescription: eventJson?.eventName || null, groups, diskComponents: components,
      eventJsonPath: path.join(eventFolderPath, 'event.json'),
    },
    files: filesWithPhotographer,
  };
}

/**
 * Post-transfer metadata verification (plan §7). Reads the batch's per-file outcome
 * manifest, scopes verification to files this transfer actually materialized
 * (copied/same-size-skipped/renamed/resumed — never a destination-folder walk, and
 * never failed/changed-skipped files), groups by owning event, and reconciles each.
 */
async function _verifyTransferBatch(mainArchiveRoot, batchId) {
  if (!batchId) return;
  let outcomes;
  try {
    outcomes = await transferImportService.readTransferOutcomes(mainArchiveRoot, batchId);
  } catch (err) {
    log(`[main] Transfer metadata verification: could not read outcomes for batch ${batchId}: ${err.message}`);
    return;
  }
  if (outcomes.length === 0) return;

  const eligibleOutcomes = new Set(['copied', 'same-size-skipped', 'renamed', 'resumed']);
  const byEvent = new Map();
  for (const o of outcomes) {
    if (!eligibleOutcomes.has(o.outcome) || !o.eventPath) continue;
    if (!byEvent.has(o.eventPath)) byEvent.set(o.eventPath, []);
    byEvent.get(o.eventPath).push({ src: o.destPath, dest: o.destPath });
  }

  for (const [eventFolderPath, filesForEvent] of byEvent) {
    try {
      const raw = await fsp.readFile(path.join(eventFolderPath, 'event.json'), 'utf8');
      const eventJson = JSON.parse(raw);
      const { context, files } = _buildTransferVerificationContext(eventFolderPath, eventJson, filesForEvent);
      await _verifyAndReconcile(context.eventJsonPath, files, context);
    } catch (err) {
      log(`[main] Transfer metadata verification failed for ${eventFolderPath}: ${err.message}`);
    }
  }
}

ipcMain.handle('import:commitTransaction', async (event, {
  fileJobs,
  eventJsonPath,
  groups,
  photographer,
  liveComps,
  subEventNames,
  collName,
  source,
  importedBy,
  importMode,   // 'direct-nas' | 'local-first' | undefined
}) => {
  let originalEventJson = null;

  const restoreCreatedStatus = async () => {
    if (!eventJsonPath) return;
    const jsonPath = path.join(eventJsonPath, 'event.json');

    if (originalEventJson && typeof originalEventJson === 'object') {
      // Restore every field to its pre-import snapshot, routed through the shared
      // updater so this rollback can't race (or be raced by) a concurrent writer —
      // a plain overwrite here would have silently discarded any unrelated field a
      // concurrent operation (e.g. a metadata completion for a different batch)
      // wrote in the meantime.
      await updateEventJsonAtomic(jsonPath, () => ({ ...originalEventJson, status: 'created', updatedAt: Date.now() }));
      hidePathBestEffort(jsonPath).catch(() => {});
      return;
    }

    await updateEventJsonAtomic(jsonPath, () => ({ status: 'created', updatedAt: Date.now() }));
    hidePathBestEffort(jsonPath).catch(() => {});
  };

  // Declared before the outer try so both are reachable by the inner catch and outer catch.
  const _directNasLocks      = [];
  const heartbeatAbortSignal = { aborted: false, reason: null };

  try {
    if (eventJsonPath) {
      try {
        const raw = await fsp.readFile(path.join(eventJsonPath, 'event.json'), 'utf8');
        originalEventJson = JSON.parse(raw);
      } catch { /* rollback falls back to status-only patch */ }
    }

    // Acquire per-photographer write locks for direct-nas imports.
    // Locks remain active through exifService metadata writes — XMP sidecars and
    // in-place writes both go to the same photographer folder on the Active Archive.
    // Locks are released at batch_complete (or immediately when metadata is skipped).
    if (importMode === 'direct-nas') {
      const nasRoot = settings.getNasRoot();
      if (nasRoot) {
        const scopes = _extractPhotographerLockScopes(fileJobs, nasRoot);
        const jobId  = `direct-${Date.now().toString(36)}`;
        for (const scope of scopes) {
          const lockResult = await archiveLockService.acquireLock(nasRoot, {
            ...scope, jobId, batchId: null,
          });
          if (!lockResult.acquired) {
            _releaseDirectNasLocks(_directNasLocks); // release any already-acquired locks
            throw new Error(`Archive folder is busy — locked by ${lockResult.lockedBy}. Please retry.`);
          }
          const expectedOwner  = { jobId: lockResult.lockData.jobId, deviceName: lockResult.lockData.deviceName };
          const heartbeatTimer = setInterval(() => {
            archiveLockService.renewLock(lockResult.lockPath, expectedOwner).then(r => {
              if (!r.renewed) {
                // Lock gone, stolen, or ownership mismatch — stop the copy.
                heartbeatAbortSignal.aborted = true;
                heartbeatAbortSignal.reason  = r.reason;
                clearInterval(heartbeatTimer);
                abortCopy(); // signals copyFileJobs to skip remaining files
              }
            }).catch(err => {
              console.error('[import:commitTransaction] Lock heartbeat I/O error:', err.message);
              heartbeatAbortSignal.aborted = true;
              heartbeatAbortSignal.reason  = 'heartbeat-io-error';
              clearInterval(heartbeatTimer);
              abortCopy();
            });
          }, archiveLockService.LOCK_HEARTBEAT_INTERVAL_MS);
          _directNasLocks.push({ lockPath: lockResult.lockPath, heartbeatTimer });
        }
      }
    }

    // Advisory: broadcast import start to Team Live (non-blocking, fire-and-forget).
    realtimeOps.emitDeviceActivity({
      mode:            'importing',
      collectionName:  collName || null,
      eventFolderName: eventJsonPath ? path.basename(eventJsonPath) : null,
      photographer:    photographer || null,
      progressCurrent: 0,
      progressTotal:   fileJobs.length,
      status:          'Importing',
    });

    // Throttled team progress callback — fires at most once per second during copy.
    let _tlImportThrottleTs = 0;
    const _teamImportProgress = (current, total) => {
      const now = Date.now();
      if (now - _tlImportThrottleTs < 1000) return;
      _tlImportThrottleTs = now;
      realtimeOps.emitDeviceActivity({
        mode:            'importing',
        collectionName:  collName || null,
        eventFolderName: eventJsonPath ? path.basename(eventJsonPath) : null,
        photographer:    photographer || null,
        progressCurrent: current,
        progressTotal:   total,
        status:          `${current} of ${total}`,
      });
    };

    let result;
    try {
      result = await importFileJobs(event, fileJobs, _teamImportProgress);
    } catch (err) {
      // Copy failed — no archive writes completed; release locks immediately.
      _releaseDirectNasLocks(_directNasLocks);
      throw err;
    }
    // importFileJobs succeeded — keep locks active through metadata writes (direct-nas).

    // If a heartbeat failure fired abortCopy() mid-copy, copyFileJobs drained without
    // writing remaining files. The lock was lost; do not commit a partial import.
    if (heartbeatAbortSignal.aborted) {
      _releaseDirectNasLocks(_directNasLocks);
      throw new Error(
        `Direct Archive import stopped: archive lock lost during copy (${heartbeatAbortSignal.reason}). ` +
        `Retry to complete the import.`
      );
    }

    // If the copy was aborted by an external signal (e.g. source drive disconnected),
    // copyFileJobs drained silently — unstarted files were dropped without incrementing
    // errors, so copied + skipped + errors < total. Do NOT commit event.json as
    // 'complete': the audit log counts come from group metadata (all selected files),
    // not from result.copiedFiles, so committing would record a false file total.
    // Roll back to 'created' instead; the user can retry and duplicate detection
    // will skip files that were already successfully copied.
    if (result.wasAborted) {
      _releaseDirectNasLocks(_directNasLocks);
      const copied = result.copied || 0;
      const total  = fileJobs.length;
      throw new Error(
        `Import was cancelled — ${copied} of ${total} file${total !== 1 ? 's' : ''} copied before cancellation. ` +
        `Retry to import the remaining files (already-copied files will be skipped automatically).`
      );
    }

    const auditContext = {
      groups,
      photographer,
      components: liveComps,
      subEventNames,
      collName,
      source,
      importedBy,
    };
    let logs;
    try {
      logs = buildAuditImportEntries(auditContext);
    } catch (auditErr) {
      console.error('[import:commitTransaction] buildAuditImportEntries failed:', auditErr.stack || auditErr.message);
      logs = [];
    }

    // If audit entry creation failed or produced nothing, synthesize a minimal valid record.
    // This guarantees imports[] / lastImport are never silently blank after a successful copy,
    // keeping the Activity Log and metadata batchId consistent.
    if (logs.length === 0 && result.copied > 0) {
      let fbPhotos = 0, fbVideos = 0;
      const _vidExts = new Set((require('../config/app.config').VIDEO_EXTENSIONS) || []);
      for (const cf of (result.copiedFiles || [])) {
        if (_vidExts.has(path.extname(cf.src || '').toLowerCase())) fbVideos++;
        else fbPhotos++;
      }
      logs = [{
        id:             `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        seq:            Date.now(),
        timestamp:      new Date().toISOString(),
        photographer:   photographer || '',
        componentIndex: 0,
        componentName:  '',
        counts:         { photos: fbPhotos, videos: fbVideos },
        source:         normalizeImportSource(source),
        importedBy:     (importedBy && typeof importedBy === 'object') ? importedBy : null,
      }];
      console.warn('[import:commitTransaction] Audit entry creation produced no records — fallback import record written.');
    }

    result.auditLogs = logs;

    // Build metadataGroups for reapply: map dest-relative paths → metadataTags.
    // Only populated when at least one group carries an explicit metadataTags array.
    let metadataGroupsForDisk = null;
    if (Array.isArray(groups) && groups.some(g => Array.isArray(g.metadataTags)) && result.copiedFiles?.length > 0) {
      const srcToTags = new Map();
      for (const g of groups) {
        if (!Array.isArray(g.metadataTags)) continue;
        for (const src of (g.files || [])) srcToTags.set(path.normalize(src), g.metadataTags);
      }
      const buckets = new Map(); // JSON(tags) → { metadataTags, relPaths }
      for (const cf of result.copiedFiles) {
        const tags = srcToTags.get(path.normalize(cf.src));
        if (!Array.isArray(tags)) continue;
        const key = JSON.stringify(tags);
        if (!buckets.has(key)) buckets.set(key, { metadataTags: tags, relPaths: [] });
        if (eventJsonPath) buckets.get(key).relPaths.push(path.relative(eventJsonPath, cf.dest));
      }
      if (buckets.size > 0) metadataGroupsForDisk = Array.from(buckets.values());
    }

    if (eventJsonPath) {
      // Single serialized read/merge/write: merge audit logs + set lastImport + set
      // status:'complete'. Routed through updateEventJsonAtomic (not a hand-rolled
      // read-then-write) so this write can never race a concurrent metadata-completion
      // write (or any other event.json writer) to the same document — the prior
      // "read twice" heuristic reduced but did not eliminate that window.
      const jsonPath = path.join(eventJsonPath, 'event.json');
      try {
        await updateEventJsonAtomic(jsonPath, (doc) => {
          const changes = { status: 'complete', updatedAt: Date.now() };

          if (logs.length > 0) {
            const mergedMap = new Map();
            (Array.isArray(doc.imports) ? doc.imports : [])
              .concat(logs)
              .forEach(entry => {
                if (isValidImportEntry(entry)) mergedMap.set(entry.id, entry);
                else console.warn('[AUDIT] Skipped invalid entry:', entry);
              });
            let imports = Array.from(mergedMap.values());
            const MAX_IMPORTS = 5000;
            if (imports.length > MAX_IMPORTS) {
              imports = imports.sort(sortImports).slice(0, MAX_IMPORTS);
              console.warn('[AUDIT] Trimmed to latest', MAX_IMPORTS);
            }
            changes.imports = imports;
            const latestLog = logs[logs.length - 1];
            changes.lastImport = {
              photographer: latestLog.photographer,
              timestamp:    latestLog.timestamp,
              fileCount:    latestLog.counts.photos + latestLog.counts.videos,
            };
          }

          if (metadataGroupsForDisk) changes.metadataGroups = metadataGroupsForDisk;
          return changes;
        });
        hidePathBestEffort(jsonPath).catch(() => {});
      } catch (err) {
        console.error(`[import:commitTransaction] event.json write failed at ${jsonPath}:`, err.stack || err.message);
        throw new Error(`Event finalization failed (${err.code || 'ERR'}): ${err.message}`);
      }
    }

    // Post-import EXIF metadata hook — fire-and-forget; never blocks the response.
    // Context is derived from event.json (originalEventJson) + import results,
    // not from transient renderer UI state (liveComps is intentionally excluded).
    //
    // For direct-nas: metadata writes go to the same NAS photographer paths as the
    // file copy, so locks must remain active until batch_complete fires.
    // If metadata is disabled (or no files copied), release locks immediately below.
    const _willWriteNasMetadata = _directNasLocks.length > 0
      && settings.getAutoMetadataEnabled()
      && (result.copiedFiles?.length > 0);

    if (!_willWriteNasMetadata) {
      // Metadata won't write to archive paths — safe to release locks now.
      _releaseDirectNasLocks(_directNasLocks);
    }

    if (settings.getAutoMetadataEnabled() && result.copiedFiles?.length > 0) {
      const batchId = result.auditLogs?.[0]?.id || Date.now().toString(36);
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      const metaContext = {
        photographer:     photographer || '',
        eventName:        eventJsonPath ? path.basename(eventJsonPath) : '',
        collName:         collName || '',
        hijriDate:        originalEventJson?.hijriDate || null,
        eventDescription: originalEventJson?.eventName || null,
        groups:           groups || [],
        diskComponents:   originalEventJson?.components || [],
        eventJsonPath:    eventJsonPath ? path.join(eventJsonPath, 'event.json') : null,
      };
      const baseEmit = win
        ? (p) => { if (!win.isDestroyed()) win.webContents.send('metadata:progress', p); }
        : null;

      // emitFn is non-null when a window is open OR when locks need deferred release.
      // For direct-nas: release archive locks at batch_complete — all file writes are done.
      const emitFn = (baseEmit || _willWriteNasMetadata)
        ? async (p) => {
            if (_willWriteNasMetadata && p.event === 'batch_complete') {
              _releaseDirectNasLocks(_directNasLocks);
            }
            if (p.event === 'batch_complete' && eventJsonPath) {
              try {
                await _writeLastMetadataRun(path.join(eventJsonPath, 'event.json'), p, metaContext.groups);
              } catch (writeErr) {
                log(`[main] _writeLastMetadataRun failed for ${eventJsonPath}: ${writeErr.message}`);
              }
              await _persistMetadataStateAndCompact(p.batchId, path.join(eventJsonPath, 'event.json'));
            }
            if (baseEmit) baseEmit(p);
          }
        : null;

      exifService.applyBatch(batchId, result.copiedFiles, metaContext, emitFn);
      result.metadataBatchId = batchId;
    }

    // Same-size-skip metadata verification (plan §6): a skipped file's pre-existing
    // destination content was never checked for metadata by the copy step itself —
    // it may be a leftover from before this fix, or from an import where metadata
    // writing was disabled. Read-only verification runs regardless of whether this
    // import's own copy batch had metadata enabled; only auto-repair is gated by it.
    if (eventJsonPath && result.skippedFiles?.length > 0) {
      const verifyContext = {
        photographer:     photographer || '',
        hijriDate:        originalEventJson?.hijriDate || null,
        eventDescription: originalEventJson?.eventName || null,
        groups:           groups || [],
        diskComponents:   originalEventJson?.components || [],
      };
      const verifyEventJsonPath = path.join(eventJsonPath, 'event.json');
      _verifyAndReconcile(
        verifyEventJsonPath,
        result.skippedFiles.map(f => ({ src: f.src, dest: f.dest })),
        verifyContext
      ).catch(err => log(`[main] same-size-skip metadata verification failed for ${eventJsonPath}: ${err.message}`));
    }

    // Realtime: broadcast import completed summary (advisory only, non-blocking).
    realtimeOps.emitImportCompleted({
      collectionName:  collName   || null,
      eventFolderName: eventJsonPath ? path.basename(eventJsonPath) : null,
      photographer:    photographer || null,
      completedFiles:  result.copied || 0,
      totalFiles:      (result.copied || 0) + (result.skipped || 0) + (result.errors || 0),
    });
    realtimeOps.emitDeviceActivity({
      mode:            'idle',
      collectionName:  collName || null,
      eventFolderName: eventJsonPath ? path.basename(eventJsonPath) : null,
      status:          'import-complete',
    });

    return result;
  } catch (err) {
    console.error('[import:commitTransaction] finalization error:', err.stack || err.message);
    // Release any remaining locks (e.g. event.json write failed after importFileJobs).
    _releaseDirectNasLocks(_directNasLocks);
    try {
      await restoreCreatedStatus();
    } catch (rollbackErr) {
      log(`Import transaction rollback failed: ${eventJsonPath || 'unknown'} | ${rollbackErr.message}`);
    }
    throw err;
  }
});

/**
 * thumb:get — returns thumbnail URL; logs failures without throwing.
 */
ipcMain.handle('thumb:get', async (_event, srcPath) => {
  perf.thumbStart(srcPath);
  try {
    const url = await getThumbnail(srcPath);
    perf.thumbEnd(srcPath, { success: true });
    return url;
  } catch (err) {
    log(`Thumbnail failed: ${srcPath} | ${err.message}`);
    perf.thumbEnd(srcPath, { success: false, error: err.message });
    return null;
  }
});

ipcMain.handle('thumbnail:getVideoThumb', async (_event, srcPath) => {
  const { getVideoThumb } = require('./videoThumbService');
  return getVideoThumb(srcPath);
});

// ── User / operator identity ──────────────────────────────────────────────────
ipcMain.handle('users:list',      async ()         => userManager.listUsers());
ipcMain.handle('users:create',    async (_e, p)    => userManager.createUser(p));
ipcMain.handle('users:getActive', async ()         => userManager.getActiveUser());
ipcMain.handle('users:setActive', async (_e, id) => {
  const result = await userManager.setActiveUser(id);
  // getActiveUser() is synchronous — await is safe but .catch() is not a method on a
  // plain return value, so guard with try/catch instead.
  let user = null;
  try { user = await userManager.getActiveUser(); } catch { user = null; }
  if (user?.name) realtimeOps.setOperatorName(user.name);
  return result;
});

// Pause / Resume / Abort copy pipeline
ipcMain.on('copy:pause',  () => setPaused(true));
ipcMain.on('copy:resume', () => setPaused(false));
ipcMain.on('copy:abort',  () => {
  log('Copy abort requested');
  abortCopy();
});

// Global import index — returns { lowercaseFilename: { size, addedAt } }
ipcMain.handle('importIndex:get', async () => importIndex);

// Patch 12: cancellable checksum
let checksumCancelled = false;
ipcMain.on('checksum:cancel', () => { checksumCancelled = true; });

// Optional post-import checksum verification (user-triggered, runs in background).
// Compares SHA-256 of each copied file's source against its destination.
// Sends 'checksum:progress' after each file and 'checksum:complete' when done.
ipcMain.handle('checksum:run', async () => {
  checksumCancelled = false; // reset at start
  const win   = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
  const total = lastImportedFiles.length;
  let completed = 0;
  let failed    = 0;
  const failures = [];

  for (const file of lastImportedFiles) {
    if (checksumCancelled) break; // Patch 12: bail on cancel
    try {
      const srcHash  = await getFileHash(file.src);
      const destHash = await getFileHash(file.dest);
      if (srcHash !== destHash) {
        failed++;
        failures.push(path.basename(file.src));
        log(`Checksum mismatch: ${file.src}`);
      }
    } catch (err) {
      failed++;
      failures.push(path.basename(file.src || '') || 'unknown');
      log(`Checksum error: ${file.src} — ${err.message}`);
    }

    completed++;
    if (win && !win.isDestroyed()) {
      win.webContents.send('checksum:progress', { completed, total });
    }
  }

  const result = { total, failed, failures };
  if (win && !win.isDestroyed()) win.webContents.send('checksum:complete', result);
  return result;
});

// What's New — returns { version, notes } once after an update, then null
ipcMain.handle('getLastUpdateInfo', () => storedUpdateInfo);

// Patch 44: expose last update state for renderer replay after window reload
ipcMain.handle('update:getLastState', () => autoUpdater.getLastUpdateState());

// ── Feedback: active user reports from the in-app modal ──────────────────────
ipcMain.handle('feedback:send', async (_evt, opts) => {
  try {
    telemetry.enqueue({
      type:        'feedback',
      issueType:   opts.issueType  || 'Other',
      severity:    opts.severity   || 'Medium',
      description: opts.description,
      reporter:    opts.reporter,
      logShared:   opts.includeLog || false,
    });
    // Flush immediately — user is waiting for the confirmation toast
    await telemetry.flush();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Master folder operations ──────────────────────────────────────────────────

ipcMain.handle('master:chooseArchiveRoot', async () => {
  const win    = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      'Choose Archive Location',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : { path: result.filePaths[0] };
});

ipcMain.handle('master:chooseExisting', async (_event, startPath) => {
  const win    = BrowserWindow.getFocusedWindow();
  const opts = {
    title:      'Select Existing Master Folder',
    properties: ['openDirectory']
  };
  // Soft nudge: start the picker inside the current archive root when available.
  // User is still free to navigate elsewhere; the defaultPath is just the initial view.
  if (startPath && typeof startPath === 'string') {
    opts.defaultPath = startPath;
  }
  const result = await dialog.showOpenDialog(win, opts);
  return result.canceled ? null : { path: result.filePaths[0] };
});

ipcMain.handle('master:validateAccessible', async (_event, folderPath) => {
  try {
    const stat = await fsp.stat(folderPath);
    if (!stat.isDirectory()) return { valid: false, reason: 'Not a directory.' };
    await fsp.access(folderPath, fs.constants.R_OK);
    return { valid: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { valid: false, reason: 'Folder does not exist.' };
    return { valid: false, reason: 'Folder is not accessible.' };
  }
});

ipcMain.handle('master:checkExists', async (_event, basePath, folderName) => {
  const fullPath = path.join(basePath, folderName);
  try {
    const stat = await fsp.stat(fullPath);
    return { exists: stat.isDirectory(), fullPath };
  } catch {
    return { exists: false, fullPath };
  }
});

ipcMain.handle('master:create', async (_event, basePath, folderName) => {
  const fullPath = path.join(basePath, folderName);
  await fsp.mkdir(fullPath, { recursive: true });
  realtimeOps.emitCollectionVisible({ collectionName: folderName });
  // Emit full registry entry so other devices can prepare locally
  const _nasRoot = settings.getNasRoot();
  const _isNasPath = _nasRoot && PathUtils.isPathUnderOrEqualToRoot(path.resolve(basePath), path.resolve(_nasRoot));
  realtimeOps.emitRegistryCollection({
    collectionName:      folderName,
    nasRoot:             _isNasPath ? _nasRoot : null,
    nasCollectionPath:   _isNasPath ? fullPath : null,
    origin:              _isNasPath ? 'archive-available' : 'remote-created',
    createdByDeviceName: settings.getDeviceDisplayName() || null,
  });
  return { path: fullPath, created: true };
});

/**
 * Scan a master folder for event subfolders.
 * Ignores files and any directory whose name doesn't match the event-name
 * prefix pattern. For each match, runs parseEventName() against the current
 * controlled-vocabulary lists so the renderer can render resolvable events
 * directly and mark the rest as warnings.
 *
 * `events` is sorted by (hijriDate, seq) DESCENDING so newest events are
 * listed first. Unparseable entries are appended at the end in the same
 * insertion order (their hijriDate/seq are unreliable).
 *
 * Never throws — returns { ok: false, events: [], errorReason } when the
 * master folder cannot be read (NAS hiccup, permission blip, disconnect,
 * etc). A read failure is NOT the same as "this collection has zero
 * events" and callers must not treat the two interchangeably.
 */
// Diagnostic-only, fire-and-forget (BUG-011 IPC-boundary investigation): forwards
// renderer-side scan-invoke markers into app.log alongside the main-process
// [EventDiscoveryIPC] lines. One-way (ipcMain.on/ipcRenderer.send, not
// handle/invoke) — no response is ever sent back, so it cannot itself affect
// scan behavior or add IPC round-trip latency. Input is coerced to a bounded-
// length string before logging; never trusted as anything but display text.
ipcMain.on('diag:rendererLog', (_event, msg) => {
  log(`[EventDiscoveryRenderer] ${String(msg).slice(0, 2000)}`);
});

// ── Diagnostic-only scan-stall tracking (BUG-011 real-Windows/NAS follow-up) ──
// Observation only — never read by any code path that alters scan behavior,
// timeouts, retries, or concurrency. Lets app.log show whether multiple
// master:scanEvents invocations overlap. Remove alongside the rest of the
// EventDiscoveryDiagnostics instrumentation once BUG-011 is closed.
const _activeEventDiscoveryScans = new Set();
let _eventDiscoveryScanSeq = 0;

// The handler is a thin wrapper around _scanEventsCore(): it exists to log
// unexpected errors surfacing at the IPC boundary (see BUG-011's investigation
// log — this is exactly the mechanism that caught the actual root cause, a
// TypeError thrown from inside the scan). `throw err` preserves the exact
// prior behavior of letting ipcMain.handle reject the renderer's invoke().
ipcMain.handle('master:scanEvents', async (_event, masterPath) => {
  const _scanId = `scan-${Date.now()}-${++_eventDiscoveryScanSeq}`;
  try {
    return await _scanEventsCore(masterPath, _scanId);
  } catch (err) {
    log(`[EventDiscoveryIPC] phase=IPC_HANDLER_ERROR scanId=${_scanId} error=${JSON.stringify((err && err.message) || String(err))}`);
    throw err;
  }
});

async function _scanEventsCore(masterPath, _scanId) {
  // Retains BUG-011's high-value diagnostics only (scan summary, unexpected-
  // state assertions, concurrent-scan detection) — the exhaustive per-entry/
  // per-operation trace logging used during that investigation was removed
  // once the root cause was confirmed and fixed (2026-08-11); see BUG-011's
  // Prevention/Reusable Lesson section and 10_CHANGELOG.md for what was
  // removed and why. Wrapped in try/finally so the active-scan tracking below
  // is guaranteed to be cleaned up on every exit path.
  const _diagRecords = [];
  const _scanStartedAt = Date.now();
  const _diagLog = (msg) => log(`[EventDiscoveryDiagnostics] scanId=${_scanId} ${msg}`);

  const _activeScanIdsAtStart = Array.from(_activeEventDiscoveryScans);
  if (_activeScanIdsAtStart.length > 0) {
    log(`[EventDiscoveryConcurrentScan] newScanId=${_scanId} activeScanIds=${JSON.stringify(_activeScanIdsAtStart)}`);
  }
  _activeEventDiscoveryScans.add(_scanId);

  try {

  if (!masterPath || typeof masterPath !== 'string') {
    _diagLog(`masterPath missing/invalid — returning {ok:true, events:[]} without scanning. typeof=${typeof masterPath}`);
    return { ok: true, events: [] };
  }

  // Archive-root context (settings, not derived from masterPath) — logged once
  // per scan for full path-diagnostic context, per BUG-011 RC request. Read-only,
  // no behavior implication.
  const _diagNasRoot  = settings.getNasRoot();
  const _diagMainRoot = settings.getMainArchiveRoot();
  const _diagShape     = _diagPathShape(masterPath);
  let _diagRealpath = null, _diagRealpathError = null, _diagMasterExists = null;
  try {
    _diagRealpath = await fsp.realpath(masterPath);
    _diagMasterExists = true;
  } catch (rpErr) {
    _diagRealpathError = rpErr.code || rpErr.message;
    _diagMasterExists = rpErr.code !== 'ENOENT';
  }
  _diagLog(`scan start masterPath=${JSON.stringify(masterPath)} `
    + `archiveRoot(nasRoot)=${JSON.stringify(_diagNasRoot)} mainArchiveRoot=${JSON.stringify(_diagMainRoot)} `
    + `win32Normalized=${JSON.stringify(path.win32.normalize(masterPath))} `
    + `realpath=${JSON.stringify(_diagRealpath)} realpathError=${JSON.stringify(_diagRealpathError)} `
    + `exists=${_diagMasterExists} isUNCPath=${_diagShape.isUNC} isDriveLetterPath=${_diagShape.isDriveLetter}`);

  let entries;
  try {
    entries = await fsp.readdir(masterPath, { withFileTypes: true });
  } catch (err) {
    _diagLog(`readdir(masterPath) THREW code=${err.code || 'unknown'} message=${err.message}`);
    return { ok: false, events: [], errorReason: err.code || 'scan-failed' };
  }

  _diagLog(`readdir(masterPath) returned ${entries.length} raw entr${entries.length === 1 ? 'y' : 'ies'} (directory listing target=${JSON.stringify(masterPath)})`);

  // Load lists ONCE for this scan; parser is a pure function of its inputs.
  const lists = {
    cities:     listManager.getList('cities'),
    locations:  listManager.getList('locations'),
    eventTypes: listManager.getList('event-types'),
  };

  const resolved   = [];
  const unparseable = [];

  for (let _entryIdx = 0; _entryIdx < entries.length; _entryIdx++) {
    const entry = entries[_entryIdx];
    const name = entry.name;
    const entryFullPath = path.join(masterPath, name);

    // Filesystem hardening (BUG-011 RC): Dirent.isDirectory() can misreport on
    // some network shares (a documented class of Node/libuv behavior — see
    // BUG-011's investigation log for the cited sources). If the Dirent says
    // "not a directory" but a real stat() on the same path says otherwise,
    // trust the stat() result and continue treating the entry as a directory,
    // instead of silently dropping a real, present event. This does not
    // change behavior for any entry where Dirent and stat agree (the normal
    // case on local disks) — it only recovers a specific disagreement that
    // previously caused a real folder to vanish with no explanation.
    let _statIsDirectory = null;
    let _statError = null;
    try {
      const st = await fsp.stat(entryFullPath);
      _statIsDirectory = st.isDirectory();
    } catch (statErr) {
      _statError = statErr.code || statErr.message;
    }
    const _direntSaysDir = entry.isDirectory();
    if (_direntSaysDir !== _statIsDirectory) {
      _diagLog(`DIRENT/STAT MISMATCH name=${JSON.stringify(name)} dirent.isDirectory()=${_direntSaysDir} stat.isDirectory()=${_statIsDirectory} statError=${_statError}`);
    }
    const _recoveredViaStat = !_direntSaysDir && _statIsDirectory === true;
    if (_recoveredViaStat) {
      log(`[EventDiscoveryDiagnostics] DIR_ENTRY_TYPE_MISMATCH name=${JSON.stringify(name)} path=${JSON.stringify(entryFullPath)} `
        + `dirent.isDirectory()=false stat.isDirectory()=true — accepting stat() result, treating as a directory`);
    }
    const _treatedAsDirectory = _direntSaysDir || _recoveredViaStat;

    if (!_treatedAsDirectory) {
      _diagRecords.push({
        folderName: name, folderPath: entryFullPath,
        direntIsDirectory: _direntSaysDir, direntIsFile: entry.isFile(),
        statIsDirectory: _statIsDirectory, statError: _statError,
        includedInEventList: false, rejectionStage: 'DIRENT_NOT_DIRECTORY',
        rejectionReason: `entry.isDirectory() was false and stat() did not confirm a directory either (statIsDirectory=${_statIsDirectory}, statError=${_statError})`,
      });
      continue;
    }
    // Skip macOS/system artefacts defensively (even though these aren't directories usually)
    if (name.startsWith('.')) {
      _diagRecords.push({
        folderName: name, folderPath: entryFullPath,
        direntIsDirectory: true, direntIsFile: false,
        statIsDirectory: _statIsDirectory, statError: _statError,
        includedInEventList: false, rejectionStage: 'DOTFILE', rejectionReason: 'folder name starts with "."',
      });
      continue;
    }

    // Try event.json first (authoritative); fallback to parser for legacy events.
    const jsonPath = path.join(masterPath, name, 'event.json');
    let eventJson = null;
    let jsonCorrupt = false;
    let _entryRealpath = null, _entryRealpathError = null;
    try {
      _entryRealpath = await fsp.realpath(entryFullPath);
    } catch (rpErr) {
      _entryRealpathError = rpErr.code || rpErr.message;
    }
    const _entryShape = _diagPathShape(entryFullPath);
    const _diag = {
      folderName: name, folderPath: entryFullPath,
      folderExists: true, // reached only when _treatedAsDirectory is true, i.e. stat() confirmed it
      directoryTypeRecoveredViaStat: _recoveredViaStat,
      realpath: _entryRealpath, realpathError: _entryRealpathError,
      isUNCPath: _entryShape.isUNC, isDriveLetterPath: _entryShape.isDriveLetter,
      eventJsonPath: jsonPath, eventJsonExists: null,
      readOk: null, readErrorCode: null,
      parseOk: null, parseError: null,
      eventJsonVersion: null, requiredFieldsPresent: null,
      eventName: null, safeEventName: null, status: null, componentsCount: null,
      validationOk: null, validationReason: null,
      normalizedFolderPath: path.win32.normalize(entryFullPath),
      normalizedCollectionPath: path.win32.normalize(masterPath),
      relativeToCollection: path.win32.relative(path.win32.normalize(masterPath), path.win32.normalize(entryFullPath)),
      relativeToArchiveRoot: _diagNasRoot ? path.win32.relative(path.win32.normalize(_diagNasRoot), path.win32.normalize(entryFullPath)) : null,
      // No separate archive-identity/path resolver exists in this code path today —
      // master:scanEvents receives masterPath as-is from the renderer and reads
      // directly under it. These fields document that fact explicitly rather than
      // silently omitting a stage the caller's schema asked about.
      resolvedArchivePath: entryFullPath, resolverOk: true, resolverReason: 'no separate resolver stage in this code path',
      archiveResolutionAttempted: false, archiveResolutionOk: null,
      archiveResolutionReason: 'no separate archive-resolution stage exists in master:scanEvents — masterPath is used as-is, verified by code reading and by test/bug011RealEventJsonReproduction.test.js',
      // "Current Device" IS this IPC result, unfiltered — see renderer/eventCreator.js
      // _renderEventList(): resolved = _scannedEvents.filter(e => e.isParseable).
      // No registry/lastEvent/resolveArchiveEventPath/session-collection gate exists
      // between this response and what renders under the Current Device tab.
      currentDeviceEligible: null, currentDeviceReason: 'no Current-Device-specific gate exists downstream of this IPC response — it mirrors includedInEventList exactly',
      // Online Registry is a fully separate, unrelated data source (other devices'
      // published events via realtime sync) — never evaluated here.
      onlineRegistryEligible: null, onlineRegistryReason: 'not applicable — Online Registry does not consult master:scanEvents',
      direntIsDirectory: true, direntIsFile: false,
      statIsDirectory: _statIsDirectory, statError: _statError,
      includedInEventList: null, rejectionStage: null, rejectionReason: null,
    };

    try {
      const raw = await fsp.readFile(jsonPath, 'utf8');
      _diag.eventJsonExists = true;
      _diag.readOk = true;
      let obj;
      try {
        obj = normalizeEventJson(JSON.parse(raw));
        _diag.parseOk = true;
        _diag.eventJsonVersion = obj?.version ?? null;
        _diag.eventName        = obj?.eventName ?? null;
        _diag.safeEventName    = obj?.safeEventName ?? null;
        _diag.status           = obj?.status ?? null;
        _diag.componentsCount  = Array.isArray(obj?.components) ? obj.components.length : null;
        _diag.requiredFieldsPresent = {
          hijriDate:  typeof obj?.hijriDate === 'string' && !!obj.hijriDate,
          sequence:   obj?.sequence !== undefined && obj?.sequence !== null,
          eventName:  typeof obj?.eventName === 'string' && !!obj.eventName,
          components: Array.isArray(obj?.components),
        };
      } catch (parseErr) {
        _diag.parseOk = false;
        _diag.parseError = parseErr.message;
        jsonCorrupt = true;
        _diagRecords.push({ ..._diag, includedInEventList: false, rejectionStage: 'JSON_PARSE_FAILED', rejectionReason: parseErr.message });
        _diagLog(`entry=${JSON.stringify(name)} JSON.parse FAILED: ${parseErr.message}`);
        continue;
      }

      if (isValidEventJson(obj)) {
        _diag.validationOk = true;
        eventJson = obj;
        hidePathBestEffort(jsonPath).catch(() => {});
        // Patch 3: crash recovery — reset stuck in-progress status on next startup.
        // An event left as 'in-progress' means the app crashed or was force-quit
        // mid-import. Reset to 'created' so the user can retry cleanly.
        if (eventJson.status === 'in-progress') {
          eventJson.status   = 'created';
          eventJson.updatedAt = Date.now();
          await updateEventJsonAtomic(jsonPath, () => ({ status: 'created', updatedAt: eventJson.updatedAt }));
          hidePathBestEffort(jsonPath).catch(() => {});
        }
      } else {
        jsonCorrupt = true;
        _diag.validationOk = false;
        _diag.validationReason = _diagnoseEventJsonValidation(obj);
        console.error('[scanEvents] isValidEventJson failed for', name, '— shape dump:', JSON.stringify(obj).slice(0, 400));
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        _diag.eventJsonExists = false;
        _diag.readOk = false;
        _diag.readErrorCode = 'ENOENT';
        // ENOENT = no JSON file → legacy event, fallback to parser below
      } else {
        jsonCorrupt = true;
        _diag.eventJsonExists = null; // unknown — the read itself failed for a non-ENOENT reason
        _diag.readOk = false;
        _diag.readErrorCode = err.code || 'unknown';
        console.error('[scanEvents] Failed to parse event.json for', name, ':', err.message);
      }
    }

    const parsed = parseEventName(name, lists);

    if (eventJson) {
      // event.json is the SOLE source of components. Parser provides hijriDate+sequence only.
      const hijriDate = parsed.ok ? parsed.hijriDate : (eventJson.hijriDate || '');
      // BUG-011 root cause (2026-08-11): parsed.sequence (from parseEventName's regex
      // capture) is always a zero-padded string, but eventJson.sequence — used only
      // when the folder name itself fails to parse — carries whatever type was last
      // persisted to disk. The Create/Edit Event form always writes sequence as a
      // number (renderer/eventCreator.js's `parseInt(seq, 10)` payloads), so a single
      // unparseable folder name mixes a number into an otherwise all-string sequence
      // set, and resolved.sort()'s `b.sequence.localeCompare(a.sequence)` below throws
      // TypeError the moment it compares that entry against any normally-parsed one —
      // silently aborting the entire scan for the whole collection, not just that one
      // folder. Normalized once, here, at the same point _scanNasArchive (this file,
      // ~line 3131) already normalizes the identical value for the identical reason —
      // every downstream consumer (this function's own sort, the IPC payload, the
      // renderer) then only ever sees the canonical zero-padded-string type the rest
      // of this codebase already assumes (see eventNameParser.js's own comment on
      // `sequence`). See test/bug011SequenceTypeMismatch.test.js for the regression
      // coverage this fix is verified against.
      const seqRaw    = parsed.ok ? parsed.sequence  : (eventJson.sequence  || '00');
      const sequence  = typeof seqRaw === 'number' ? String(seqRaw).padStart(2, '0') : String(seqRaw);
      // Strip imports[] before sending over IPC — it can be hundreds of entries per event.
      // All consumers need only the metadata fields; imports are loaded on demand per-event.
      const { imports: _omit, ...eventJsonMeta } = eventJson;
      resolved.push({
        folderName:           name,
        hijriDate,
        sequence,
        components:           eventJson.components,
        isFromJson:           true,
        isParseable:          true,
        isUnresolved:         eventJson.components.some(c => c.isUnresolved),
        isCorrupt:            false,
        isLegacy:             false,
        needsReconciliation:  (eventJson.safeEventName || sanitizeForPath(eventJson.eventName || '')) !== name,
        _eventJson:           eventJsonMeta,
      });
      _diagRecords.push({ ..._diag, includedInEventList: true, rejectionStage: null, rejectionReason: null });
    } else if (!jsonCorrupt && parsed.ok) {
      // No event.json (ENOENT) and folder name is parseable → legacy event, no components.
      // Components intentionally empty: event.json is the ONLY source. Legacy events must
      // be opened via the event.json write path before they can be viewed or edited.
      resolved.push({
        folderName:   name,
        hijriDate:    parsed.hijriDate,
        sequence:     parsed.sequence,
        components:   [],
        isFromJson:   false,
        isParseable:  true,
        isUnresolved: false,
        isLegacy:     true,
        isCorrupt:    false,
      });
      _diagRecords.push({ ..._diag, includedInEventList: true, rejectionStage: null, rejectionReason: 'legacy: no event.json, folder name parsed OK' });
    } else if (jsonCorrupt && parsed.ok) {
      // event.json exists but failed shape validation. Components intentionally empty.
      resolved.push({
        folderName:   name,
        hijriDate:    parsed.hijriDate,
        sequence:     parsed.sequence,
        components:   [],
        isFromJson:   false,
        isParseable:  true,
        isUnresolved: false,
        isLegacy:     true,
        isCorrupt:    true,
        _eventJson:   null,
      });
      _diagRecords.push({ ..._diag, includedInEventList: true, rejectionStage: null, rejectionReason: 'event.json invalid but folder name parsed OK — still counted as an existing event (isCorrupt:true)' });
    } else {
      // Both JSON (if present) and parser failed.
      unparseable.push({
        folderName: name,
        isParseable: false,
        reason:      parsed.ok ? 'corrupt-json' : parsed.reason,
        isCorrupt:   jsonCorrupt,
      });
      _diagRecords.push({
        ..._diag, includedInEventList: false, rejectionStage: 'UNPARSEABLE_FOLDER_NAME',
        rejectionReason: `folderNameParsed=${parsed.ok} (${parsed.ok ? '' : parsed.reason}); jsonCorrupt=${jsonCorrupt} — lands in "Unrecognised Folders", not "Existing Events"`,
      });
    }
  }

  // Sort resolved newest-first by (hijriDate desc, sequence desc). Both are
  // fixed-width strings so lexicographic comparison is equivalent to numeric.
  resolved.sort((a, b) => {
    if (a.hijriDate !== b.hijriDate) return b.hijriDate.localeCompare(a.hijriDate);
    return b.sequence.localeCompare(a.sequence);
  });

  // ── Diagnostic summary — one aggregate line, plus loud assertions for any
  // internal-invariant violation. ────────────────────────────────────────────
  // currentDeviceEligible mirrors includedInEventList exactly (see the
  // currentDeviceReason field's own explanation) — computed once here rather
  // than at every push site above, since the mirroring is unconditional for
  // every record this function ever produces.
  // Development assertion: a validated event.json that still didn't make it
  // into the final list would mean the branch logic and the diagnostic record
  // disagree — under current code this should never fire (validationOk===true
  // always routes into the `if (eventJson)` branch, which always pushes to
  // `resolved`), but it's cheap insurance against a future edit silently
  // breaking that invariant.
  for (const rec of _diagRecords) {
    rec.currentDeviceEligible = rec.includedInEventList;
    if (rec.validationOk === true && rec.includedInEventList !== true) {
      _diagLog(`UNEXPECTED_EVENT_REJECTION folderName=${JSON.stringify(rec.folderName)} `
        + `validationOk=true but includedInEventList=${rec.includedInEventList} `
        + `rejectionStage=${JSON.stringify(rec.rejectionStage)} rejectionReason=${JSON.stringify(rec.rejectionReason)}`);
    }
  }
  const _rejectionCounts = {};
  for (const rec of _diagRecords) {
    if (rec.rejectionStage) _rejectionCounts[rec.rejectionStage] = (_rejectionCounts[rec.rejectionStage] || 0) + 1;
  }
  const _directoriesAccepted = _diagRecords.filter(r => r.rejectionStage !== 'DIRENT_NOT_DIRECTORY' && r.rejectionStage !== 'DOTFILE').length;
  const _directoryTypeRecoveredCount = _diagRecords.filter(r => r.directoryTypeRecoveredViaStat === true).length;
  _diagLog(`EVENT_DISCOVERY_SUMMARY collection=${JSON.stringify(masterPath)} `
    + `entriesEnumerated=${entries.length} `
    + `directoriesAccepted=${_directoriesAccepted} `
    + `directoryTypeRecoveredViaStat=${_directoryTypeRecoveredCount} `
    + `eventJsonFound=${_diagRecords.filter(r => r.eventJsonExists === true).length} `
    + `eventJsonReadOk=${_diagRecords.filter(r => r.readOk === true).length} `
    + `eventJsonParsed=${_diagRecords.filter(r => r.parseOk === true).length} `
    + `eventJsonValidated=${_diagRecords.filter(r => r.validationOk === true).length} `
    + `rendered=${resolved.length} `
    + `rejectedFromExistingEvents=${_diagRecords.filter(r => r.includedInEventList === false).length} `
    + `unparseableFolders(shown as "Unrecognised Folders" in UI)=${unparseable.length} `
    + `rejectionCounts=${JSON.stringify(_rejectionCounts)}`);

  // Development assertion: rendered vs. validated counts legitimately differ
  // (legacy events with no event.json, and corrupt-but-parseable-folder-name
  // events, both render without validationOk===true) — but an unexplained gap
  // is worth a loud line rather than silent arithmetic the tester's app.log
  // reader would otherwise have to reconstruct by hand.
  const _validatedCount = _diagRecords.filter(r => r.validationOk === true).length;
  if (resolved.length !== _validatedCount) {
    const _legacyCount = _diagRecords.filter(r => r.rejectionReason === 'legacy: no event.json, folder name parsed OK').length;
    const _corruptButParseableCount = _diagRecords.filter(r =>
      typeof r.rejectionReason === 'string' && r.rejectionReason.startsWith('event.json invalid but folder name parsed OK')).length;
    _diagLog(`RENDER_COUNT_MISMATCH rendered=${resolved.length} validated=${_validatedCount} `
      + `explainedByLegacyEvents=${_legacyCount} explainedByCorruptButParseable=${_corruptButParseableCount} `
      + `unexplainedDelta=${resolved.length - _validatedCount - _legacyCount - _corruptButParseableCount}`);
  }
  _diagLog(`SCAN_COMPLETE totalDurationMs=${Date.now() - _scanStartedAt}`);

  return { ok: true, events: [...resolved, ...unparseable] };
  } finally {
    _activeEventDiscoveryScans.delete(_scanId);
  }
}

// Parse a single event folder name and return its components array.
// Used at startup to restore component data from the canonical source (the
// folder name itself) rather than from settings, which would drift on rename.
ipcMain.handle('master:parseEvent', (_event, folderName) => {
  if (!folderName || typeof folderName !== 'string') return [];
  const lists = {
    cities:     listManager.getList('cities'),
    locations:  listManager.getList('locations'),
    eventTypes: listManager.getList('event-types'),
  };
  const parsed = parseEventName(folderName, lists);
  return parsed.ok ? parsed.components : [];
});

// ── event.json disk-backed event persistence ──────────────────────────────────

// Strict shape validator. Returns true only when the object is safe to trust.
// Every caller that loads event.json MUST pass through this gate before using
// any field — partial or malformed data must never reach the UI.
function sanitizeForPath(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[/\\]/g, '-')
    .replace(/[:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── TEMPORARY DIAGNOSTIC INSTRUMENTATION (BUG-011 real-Windows/NAS RC follow-up) ──
// Not a fix. Pure evidence-gathering for a tester report where 38 event.json-backed
// folders are visible in Windows Explorer but master:scanEvents reports zero events
// on the real NAS/UNC archive. Mirrors isValidEventJson's checks but returns a
// human-readable reason instead of a bare boolean — used ONLY by the diagnostic
// block in master:scanEvents below; isValidEventJson itself is untouched and still
// the sole source of truth for actual validation behavior.
// Remove this whole block (and the diagnostic block in master:scanEvents) once the
// real root cause is found and the actual fix has landed.
function _diagnoseEventJsonValidation(obj) {
  if (obj === null || typeof obj !== 'object') return 'NOT_AN_OBJECT';
  if (obj.version !== 1) return `VERSION_MISMATCH(got=${JSON.stringify(obj.version)})`;
  if (!obj.hijriDate || typeof obj.hijriDate !== 'string') return 'HIJRI_DATE_MISSING_OR_NOT_STRING';
  const seqNum = typeof obj.sequence === 'number' ? obj.sequence : parseInt(obj.sequence, 10);
  if (!Number.isInteger(seqNum) || seqNum < 1) return `SEQUENCE_INVALID(got=${JSON.stringify(obj.sequence)})`;
  if (!obj.eventName || typeof obj.eventName !== 'string') return 'EVENT_NAME_MISSING_OR_NOT_STRING';
  if (!Array.isArray(obj.components)) return 'COMPONENTS_NOT_ARRAY';
  for (let i = 0; i < obj.components.length; i++) {
    const c = obj.components[i];
    if (c === null || typeof c !== 'object') return `COMPONENT_${i}_NOT_OBJECT`;
    if (!Array.isArray(c.types)) return `COMPONENT_${i}_TYPES_NOT_ARRAY`;
    if (typeof c.city !== 'string') return `COMPONENT_${i}_CITY_NOT_STRING(got=${JSON.stringify(c.city)})`;
    if (c.location !== null && c.location !== undefined && typeof c.location !== 'string') {
      return `COMPONENT_${i}_LOCATION_INVALID`;
    }
  }
  return null; // valid
}

// Diagnostic-only path-shape classifier (UNC vs. drive-letter vs. neither).
// Renderer has its own equivalent in pathUtils.js (WINDOWS_SHAPED) — duplicated
// here rather than shared, since main/renderer are separate Electron processes
// and this is temporary diagnostic code, not a shared contract.
function _diagPathShape(p) {
  if (typeof p !== 'string') return { isUNC: false, isDriveLetter: false };
  return {
    isUNC: /^\\\\/.test(p) || /^\/\//.test(p),
    isDriveLetter: /^[a-zA-Z]:[\\/]/.test(p),
  };
}

function normalizeEventJson(data) {
  if (!data || typeof data !== 'object') return data;
  const components = Array.isArray(data.components)
    ? data.components.map((c, i) => ({
        ...c,
        id: Number.isInteger(c.id) && c.id > 0 ? c.id : i + 1,
      }))
    : data.components;
  return { ...data, components };
}

function isValidEventJson(obj) {
  if (obj === null || typeof obj !== 'object') return false;
  if (obj.version !== 1) return false;
  if (!obj.hijriDate || typeof obj.hijriDate !== 'string') return false;

  // Validate sequence without mutating — normalization lives in normalizeEventJson.
  const seqNum = typeof obj.sequence === 'number' ? obj.sequence : parseInt(obj.sequence, 10);
  if (!Number.isInteger(seqNum) || seqNum < 1) return false;

  if (!obj.eventName || typeof obj.eventName !== 'string') return false;
  if (!Array.isArray(obj.components)) return false;

  // Structural per-component check only — content (non-empty types/city) is enforced
  // by the edit form, not here. Repair payloads legitimately write empty types and city.
  for (const c of obj.components) {
    if (c === null || typeof c !== 'object') return false;
    if (!Array.isArray(c.types)) return false;
    if (typeof c.city !== 'string') return false;
    if (c.location !== null && c.location !== undefined && typeof c.location !== 'string') return false;
  }

  return true;
}

// Write event.json to a new event folder. Creates the folder if absent.
// If event.json already exists, returns the existing data without overwriting
// (idempotent — duplicate creation is a no-op).
ipcMain.handle('event:write', async (_event, eventFolderPath, eventData) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, reason: 'Invalid folder path.' };
  }
  const jsonPath = path.join(eventFolderPath, 'event.json');
  try {
    await fsp.mkdir(eventFolderPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `mkdir failed: ${err.message}` };
  }
  // Check if already exists — don't overwrite
  try {
    const existing = await fsp.readFile(jsonPath, 'utf8');
    hidePathBestEffort(jsonPath).catch(() => {});
    return { ok: true, alreadyExisted: true, data: JSON.parse(existing) };
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, reason: `Read check failed: ${err.message}` };
  }
  if (!isValidEventJson(eventData)) {
    return { ok: false, reason: 'eventData failed schema validation.' };
  }
  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(eventData, null, 2), 'utf8');
    await fsp.rename(tmp, jsonPath);
    hidePathBestEffort(jsonPath).catch(() => {});
    realtimeOps.emitEventVisible({
      eventFolderName:  path.basename(eventFolderPath),
      eventDisplayName: eventData.folderName || path.basename(eventFolderPath),
    });
    // Emit full registry entry so other devices can prepare the same event locally
    const _evCollName = path.basename(path.dirname(eventFolderPath));
    const _nasRoot3   = settings.getNasRoot();
    const _isNasEv    = _nasRoot3 && PathUtils.isPathUnderOrEqualToRoot(path.resolve(eventFolderPath), path.resolve(_nasRoot3));
    const _jsonShell  = {
      version:      eventData.version || 1,
      hijriDate:    eventData.hijriDate,
      sequence:     typeof eventData.sequence === 'number' ? eventData.sequence : parseInt(eventData.sequence, 10),
      eventName:    eventData.eventName,
      safeEventName:eventData.safeEventName || eventData.eventName,
      status:       'created',
      components:   eventData.components,
      updatedAt:    Date.now(),
    };
    realtimeOps.emitRegistryEvent({
      collectionName:      _evCollName,
      eventFolderName:     path.basename(eventFolderPath),
      eventDisplayName:    eventData.eventName || path.basename(eventFolderPath),
      eventJsonShell:      _jsonShell,
      nasCollectionPath:   _isNasEv ? path.dirname(eventFolderPath) : null,
      nasEventPath:        _isNasEv ? eventFolderPath : null,
      origin:              _isNasEv ? 'archive-available' : 'remote-created',
      createdByDeviceName: settings.getDeviceDisplayName() || null,
    });
    return { ok: true, alreadyExisted: false, data: eventData };
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    return { ok: false, reason: `Write failed: ${err.message}` };
  }
});

// Publish an existing event to the Online Registry (called when selecting/viewing an event,
// not just on creation). Validates path containment, reads event.json, emits registry entry.
ipcMain.handle('event:publishRegistry', async (_event, { eventFolderPath, collectionName } = {}) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    console.warn('[publishRegistry] missing eventFolderPath');
    return { ok: false, reason: 'missing-path' };
  }
  if (!collectionName || typeof collectionName !== 'string') {
    console.warn('[publishRegistry] missing collectionName');
    return { ok: false, reason: 'missing-collection' };
  }

  const _pubRoots = [
    settings.getLocalStagingRoot(),
    settings.getNasRoot(),
    settings.getArchiveRoot(),
    settings.getMainArchiveRoot(),
  ].filter(Boolean).map(r => path.resolve(r));
  const realEvPath = path.resolve(eventFolderPath);

  if (!_pubRoots.some(r => PathUtils.isPathUnderOrEqualToRoot(realEvPath, r))) {
    console.warn('[publishRegistry] outside safe roots — not publishing');
    return { ok: false, reason: 'outside-roots' };
  }

  let eventData;
  try {
    const raw = await fsp.readFile(path.join(realEvPath, 'event.json'), 'utf8');
    eventData  = JSON.parse(raw);
  } catch (err) {
    console.warn('[publishRegistry] event.json read failed:', err.message);
    return { ok: false, reason: 'event-json-missing' };
  }
  if (!eventData || !Array.isArray(eventData.components) || eventData.components.length === 0) {
    console.warn('[publishRegistry] invalid event.json (no components)');
    return { ok: false, reason: 'event-json-invalid' };
  }

  const _nasRoot4  = settings.getNasRoot();
  const _isNasPub  = _nasRoot4 && PathUtils.isPathUnderOrEqualToRoot(realEvPath, path.resolve(_nasRoot4));
  const _origin    = _isNasPub ? 'archive-available' : 'remote-created';
  const _jsonShell = {
    version:       eventData.version || 1,
    hijriDate:     eventData.hijriDate,
    sequence:      typeof eventData.sequence === 'number' ? eventData.sequence : parseInt(eventData.sequence, 10),
    eventName:     eventData.eventName,
    safeEventName: eventData.safeEventName || eventData.eventName,
    status:        eventData.status || 'created',
    components:    eventData.components,
    updatedAt:     Date.now(),
  };
  realtimeOps.emitRegistryEvent({
    collectionName,
    eventFolderName:     path.basename(realEvPath),
    eventDisplayName:    eventData.eventName || path.basename(realEvPath),
    eventJsonShell:      _jsonShell,
    nasCollectionPath:   _isNasPub ? path.dirname(realEvPath) : null,
    nasEventPath:        _isNasPub ? realEvPath : null,
    origin:              _origin,
    createdByDeviceName: settings.getDeviceDisplayName() || null,
  });
  return { ok: true };
});

// Read event.json from a folder. Returns a valid parsed object or null.
ipcMain.handle('event:read', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') return null;

  const jsonPath = path.join(eventFolderPath, 'event.json');

  try {
    const raw = await fsp.readFile(jsonPath, 'utf8');

    const parsed = JSON.parse(raw);

    // Normalize first so backfillable fields (e.g. missing component id) are
    // repaired before validation — READ → NORMALIZE → VALIDATE.
    const obj = normalizeEventJson(parsed);

    if (!isValidEventJson(obj)) {
      console.error('[event:read] isValidEventJson failed:', eventFolderPath, JSON.stringify(obj).slice(0, 400));
      throw new Error('Invalid event.json structure');
    }

    validateEventJson(obj);

    return obj;

  } catch (err) {
    if (err.code === 'ENOENT') return null;

    // 🔴 IMPORTANT: show contract errors clearly
    if (err.name === 'ContractError') {
      console.error(err.toString(), err.meta);
      throw err; // do NOT swallow
    }

    console.error('[MAIN VALIDATION FAILED] parse error:', err.message);
    throw err;
  }
});

// Atomically write event.json. Detects full vs. partial payload:
// - Full (has hijriDate + sequence + components): writes the complete canonical shape.
// - Partial (e.g. { status: 'complete' }): reads existing file, merges, writes back.
// This prevents status-only callers from corrupting identity/component fields.
async function updateEventJson(eventFolderPath, payload) {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, reason: 'Invalid folder path.' };
  }

  const jsonPath = path.join(eventFolderPath, 'event.json');
  const isFullPayload = payload.hijriDate != null &&
                        payload.sequence !== undefined &&
                        Array.isArray(payload.components);

  try {
    let validationError = null;
    await updateEventJsonAtomic(jsonPath, (existing) => {
      if (isFullPayload) {
        // Repair / save path — caller supplies the complete identity/component shape.
        // Only these canonical fields are replaced; every other on-disk field (e.g.
        // lastMetadataRun, metadataSummary, metadataGroups, imports) survives untouched
        // — a prior version of this function reconstructed the whole document from
        // just these fields, silently discarding all of those on every repair/save.
        const changes = {
          version:       payload.version ?? 1,
          hijriDate:     payload.hijriDate,
          sequence:      typeof payload.sequence === 'number'
                           ? payload.sequence
                           : parseInt(payload.sequence, 10),
          eventName:     payload.eventName,
          safeEventName: payload.safeEventName,
          status:        payload.status ?? 'created',
          components:    payload.components,
          ...(payload.adoption != null ? { adoption: payload.adoption } : {}),
          updatedAt:     payload.updatedAt ?? Date.now(),
        };
        if (!isValidEventJson({ ...existing, ...changes })) {
          validationError = 'event.json full payload failed schema validation.';
          return {}; // no-op merge; validationError short-circuits below
        }
        return changes;
      }
      // Status-only / partial-patch path — allowlisted fields only.
      const PATCH_ALLOWLIST = new Set(['status']);
      const safePatch = {};
      for (const [k, v] of Object.entries(payload)) {
        if (PATCH_ALLOWLIST.has(k)) safePatch[k] = v;
      }
      return { ...safePatch, updatedAt: Date.now() };
    });
    if (validationError) return { ok: false, reason: validationError };
    hidePathBestEffort(jsonPath).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Write failed: ${err.message}` };
  }
}

ipcMain.handle('event:update', async (_event, eventFolderPath, payload) => {
  return updateEventJson(eventFolderPath, payload);
});

// Merge-safe import log append. Reads current event.json, deduplicates
// Stable sort: newest first, seq as tiebreaker (clock-skew safe).
function sortImports(a, b) {
  const t = new Date(b.timestamp) - new Date(a.timestamp);
  if (t !== 0) return t;
  return (b.seq || 0) - (a.seq || 0);
}

// Backward-compatible: counts shape is validated as object, not individual fields.
function isValidImportEntry(e) {
  return (
    e &&
    typeof e.id === 'string' &&
    typeof e.timestamp === 'string' &&
    typeof e.componentIndex === 'number' &&
    e.counts &&
    typeof e.counts === 'object'
  );
}

// Merge-safe import log append. Reads current event.json, deduplicates
// incoming entries by id, writes atomically via tmp→rename.
// TODO: support archive of trimmed logs if needed
ipcMain.handle('event:appendImports', async (_event, eventFolderPath, entries) => {
  if (!eventFolderPath || !Array.isArray(entries)) return { ok: false, reason: 'Invalid args.' };
  const jsonPath = path.join(eventFolderPath, 'event.json');
  const incomingSafe = Array.isArray(entries) ? entries : [];
  try {
    const updated = await updateEventJsonAtomic(jsonPath, (doc) => {
      const existingImports = Array.isArray(doc.imports) ? doc.imports : [];
      const mergedMap = new Map();
      [...existingImports, ...incomingSafe].forEach(entry => {
        if (isValidImportEntry(entry)) {
          mergedMap.set(entry.id, entry);
        } else {
          console.warn('[AUDIT] Skipped invalid entry:', entry);
        }
      });
      let imports = Array.from(mergedMap.values());
      const MAX_IMPORTS = 5000;
      if (imports.length > MAX_IMPORTS) {
        imports = imports.sort(sortImports).slice(0, MAX_IMPORTS);
        console.warn('[AUDIT] Trimmed to latest', MAX_IMPORTS);
      }
      return { imports };
    });
    hidePathBestEffort(jsonPath).catch(() => {});
    return { ok: true, count: incomingSafe.length, total: updated.imports.length };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('dir:ensure', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { ok: false, reason: 'Invalid path.' };
  try {
    await fsp.mkdir(dirPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('dir:findByPrefix', async (_event, basePath, prefix) => {
  if (!basePath || !prefix) return null;
  try {
    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    const matches = entries.filter(e => e.isDirectory() && e.name.startsWith(prefix));
    if (matches.length > 1) {
      console.warn('[FS] Multiple folders match prefix:', prefix, matches.map(m => m.name));
    }
    return matches.length > 0 ? { name: matches[0].name } : null;
  } catch {
    return null;
  }
});

ipcMain.handle('dir:exists', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try { await fsp.access(dirPath); return true; } catch { return false; }
});

ipcMain.handle('dir:hasContent', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    const entries = await fsp.readdir(dirPath);
    return entries.some(name =>
      name !== 'event.json' &&
      name !== 'event.metadata.json' &&
      name !== 'event.sync.json' &&
      !name.startsWith('.') &&
      name.trim() !== ''
    );
  } catch {
    return false;
  }
});

ipcMain.handle('dir:inspectContent', async (_event, dirPath) => {
  const empty = { hasContent: false, folders: [], files: [], folderCount: 0, fileCount: 0 };
  if (!dirPath || typeof dirPath !== 'string') return empty;
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const filtered = entries.filter(e =>
      e.name !== 'event.json' &&
      e.name !== 'event.metadata.json' &&
      e.name !== 'event.sync.json' &&
      !e.name.startsWith('.') &&
      e.name.trim() !== ''
    );
    const folders = filtered.filter(e => e.isDirectory()).map(e => e.name);
    const files   = filtered.filter(e => e.isFile()).map(e => e.name);
    return { hasContent: filtered.length > 0, folders, files, folderCount: folders.length, fileCount: files.length };
  } catch {
    return empty;
  }
});

ipcMain.handle('dir:rename', async (_event, oldPath, newPath) => {
  if (!oldPath || !newPath) return { ok: false, reason: 'Missing paths.' };
  if (oldPath === newPath) return { ok: true };

  // ── Collect configured archive roots ─────────────────────────────────
  const configuredRoots = [
    settings.getNasRoot(),
    settings.getArchiveRoot(),
    settings.getMainArchiveRoot(),
    settings.getLocalStagingRoot(),
  ].filter(Boolean);

  if (!configuredRoots.length) {
    return { ok: false, reason: 'Archive root not configured.' };
  }

  // Resolve symlinks on each root; skip roots that are offline or missing.
  const realRoots = [];
  for (const root of configuredRoots) {
    try { realRoots.push(await fsp.realpath(root)); } catch { /* offline — skip */ }
  }
  if (!realRoots.length) {
    return { ok: false, reason: 'Archive root not configured.' };
  }

  const _isInsideRoot = (resolved) =>
    realRoots.some(r => PathUtils.isPathUnderOrEqualToRoot(resolved, r));

  const _isDescendantOfRoot = (resolved) =>
    realRoots.some(r => PathUtils.isPathUnderRoot(resolved, r));

  // ── Resolve oldPath and confirm containment ───────────────────────────
  let realOld;
  try {
    realOld = await fsp.realpath(oldPath);
  } catch (err) {
    return { ok: false, reason: `Source not found: ${err.message}` };
  }
  if (!_isDescendantOfRoot(realOld)) {
    return { ok: false, reason: 'Source path outside configured archive roots.' };
  }

  // ── Resolve newPath parent and confirm containment ────────────────────
  // newPath may not exist yet — resolve its parent directory instead.
  let realNewParent;
  try {
    realNewParent = await fsp.realpath(path.dirname(newPath));
  } catch (err) {
    return { ok: false, reason: `Destination parent not accessible: ${err.message}` };
  }
  if (!_isInsideRoot(realNewParent)) {
    return { ok: false, reason: 'Destination path outside configured archive roots.' };
  }

  // ── Collision guard (matches master:renameEvent behavior) ─────────────
  try {
    await fsp.stat(newPath);
    return { ok: false, reason: 'collision' };
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, reason: `Cannot check target: ${err.message}` };
  }

  // ── Rename ────────────────────────────────────────────────────────────
  try {
    await fsp.rename(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('master:renameEvent', async (_event, masterPath, oldName, newName) => {
  if (!masterPath || !oldName || !newName) return { ok: false, reason: 'Missing parameters.' };
  if (oldName === newName) return { ok: true }; // no-op
  const oldPath = path.join(masterPath, oldName);
  const newPath = path.join(masterPath, newName);
  // Fresh stat for collision check (not cached — catches out-of-band changes).
  try {
    await fsp.stat(newPath);
    return { ok: false, reason: 'collision' };
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, reason: `Cannot check target: ${err.message}` };
  }
  // Acquire per-photographer archive locks before renaming the event folder.
  // Prevents rename from orphaning in-flight import/sync lock keys that are
  // keyed by (collection, eventFolderName, photographerFolderName).
  // Two-level walk covers both archive layouts without full recursion:
  //   single-component: event/photographer/file
  //   multi-component:  event/subEventId/photographer/file
  const nasRoot    = path.dirname(masterPath);
  const collection = path.basename(masterPath);
  const heldLocks  = [];
  try {
    const photographerNames = new Set();
    const level1 = await fsp.readdir(oldPath, { withFileTypes: true });
    for (const l1 of level1) {
      if (!l1.isDirectory() || l1.name.startsWith('.') || _NAS_SKIP_DIRS.has(l1.name) || l1.name === 'VIDEO') continue;
      photographerNames.add(l1.name);
      let level2;
      try { level2 = await fsp.readdir(path.join(oldPath, l1.name), { withFileTypes: true }); } catch { continue; }
      for (const l2 of level2) {
        if (l2.isDirectory() && !l2.name.startsWith('.') && !_NAS_SKIP_DIRS.has(l2.name) && l2.name !== 'VIDEO') {
          photographerNames.add(l2.name);
        }
      }
    }
    const jobId = `rename-${Date.now().toString(36)}`;
    for (const photographerFolderName of photographerNames) {
      const lockResult = await archiveLockService.acquireLock(nasRoot, {
        collection,
        eventFolderName:        oldName,
        photographerFolderName,
        jobId,
        batchId:                null,
      });
      if (!lockResult.acquired) {
        return { ok: false, reason: 'locked' };
      }
      heldLocks.push(lockResult.lockPath);
    }
    await fsp.rename(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Rename failed: ${err.message}` };
  } finally {
    for (const lockPath of heldLocks) {
      archiveLockService.releaseLock(lockPath).catch(() => {});
    }
    heldLocks.length = 0;
  }
});

// ── Settings (persisted user preferences) ─────────────────────────────

ipcMain.handle('settings:getArchiveRoot', () => settings.getArchiveRoot());

ipcMain.handle('settings:setArchiveRoot', async (_event, value) => {
  await settings.setArchiveRoot(value);
  return { ok: true };
});

ipcMain.handle('settings:getLastDestPath', () => settings.getLastDestPath());

ipcMain.handle('settings:setLastDestPath', async (_event, value) => {
  await settings.setLastDestPath(value);
  return { ok: true };
});

ipcMain.handle('settings:getLastEvent', () => settings.getLastEvent());

ipcMain.handle('settings:setLastEvent', async (_event, value) => {
  await settings.setLastEvent(value);
  return { ok: true };
});

ipcMain.handle('settings:getAutoMetadataEnabled', () => settings.getAutoMetadataEnabled());

ipcMain.handle('settings:setAutoMetadataEnabled', async (_event, value) => {
  await settings.setAutoMetadataEnabled(value);
  return { ok: true };
});

ipcMain.handle('settings:getUpdateChannel', () => settings.getUpdateChannel());

ipcMain.handle('settings:setUpdateChannel', async (_event, value) => {
  await settings.setUpdateChannel(value);
  autoUpdater.applyChannelSetting(value);
  return { ok: true };
});

// Checks that the collection folder (and optionally the event folder) still
// exist on disk. Returns false if either is missing or inaccessible.
ipcMain.handle('settings:verifyLastEvent', async (_event, collectionPath, eventFolderPath) => {
  if (!collectionPath) return false;
  try {
    const collStat = await fsp.stat(collectionPath);
    if (!collStat.isDirectory()) return false;
  } catch { return false; }
  if (eventFolderPath) {
    try {
      const evStat = await fsp.stat(eventFolderPath);
      if (!evStat.isDirectory()) return false;
    } catch { return false; }
  }
  return true;
});

// Bounded, exact-name search for an event folder under an archive root.
// Looks for a directory named exactly `collectionName` at the root itself or one
// intermediate level below it (e.g. a year/date folder), then for `eventFolderName`
// inside that collection. Exact-name matching only — never fuzzy. Depth and breadth
// are capped so this never recurses the whole NAS. Returns the resolved paths and
// whether event.json is actually present in the event folder.
const _RESOLVE_INTERMEDIATE_CAP = 64; // max intermediate (year/date) dirs probed
ipcMain.handle('settings:resolveArchiveEventPath', async (_event, rootPath, collectionName, eventFolderName) => {
  if (!rootPath || !collectionName) return { found: false, reason: 'missing-args' };
  try {
    const st = await fsp.stat(rootPath);
    if (!st.isDirectory()) return { found: false, reason: 'root-not-directory' };
  } catch {
    return { found: false, reason: 'root-offline' };
  }

  // Candidate base dirs that may directly contain the collection folder:
  // the root itself, plus one level of intermediate directories (year/date).
  const candidateBases = [rootPath];
  try {
    const entries = await fsp.readdir(rootPath, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') || _NAS_SKIP_DIRS.has(ent.name)) continue;
      if (ent.name === collectionName) continue; // direct hit handled below
      candidateBases.push(path.join(rootPath, ent.name));
      if (candidateBases.length > _RESOLVE_INTERMEDIATE_CAP) break;
    }
  } catch { /* root unreadable — fall through with direct base only */ }

  let collectionPath = null;
  for (const base of candidateBases) {
    const candidate = path.join(base, collectionName);
    try {
      const st = await fsp.stat(candidate);
      if (st.isDirectory()) { collectionPath = candidate; break; }
    } catch { /* not under this base */ }
  }
  if (!collectionPath) return { found: false, reason: 'collection-not-found' };
  if (!eventFolderName) return { found: false, reason: 'no-event-name', collectionPath };

  const eventPath = path.join(collectionPath, eventFolderName);
  try {
    const st = await fsp.stat(eventPath);
    if (!st.isDirectory()) return { found: false, reason: 'event-not-directory', collectionPath };
  } catch {
    return { found: false, reason: 'event-not-found', collectionPath };
  }

  let hasEventJson = false;
  try { hasEventJson = (await fsp.stat(path.join(eventPath, 'event.json'))).isFile(); } catch {}
  return { found: true, collectionPath, eventPath, hasEventJson };
});

// ── Archive Operations ────────────────────────────────────────────────────────

ipcMain.handle('archive:getDeviceIdentity', () => ({ deviceName: os.hostname() }));

ipcMain.handle('archive:setNasRoot', async (_event, value) => {
  await settings.setNasRoot(value);
});

ipcMain.handle('archive:setMainArchiveRoot', async (_event, value) => {
  await settings.setMainArchiveRoot(value);
});

ipcMain.handle('archive:validateMainArchiveRoot', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { valid: false, reason: 'no-path' };
  // Two-phase check: stat first (offline vs no-marker distinction)
  try {
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return { valid: false, reason: 'not-directory' };
  } catch (err) {
    return { valid: false, reason: 'offline' };
  }
  // Directory reachable — check for archive marker
  try {
    const markerPath = path.join(dirPath, '.autoingest', 'root', 'archive-root.json');
    const raw    = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (marker.type !== 'autoingest-nas-root') return { valid: false, reason: 'wrong-marker-type' };
    return { valid: true, archiveName: marker.archiveName || null };
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') return { valid: false, reason: 'no-access' };
    return { valid: false, reason: 'no-marker' };
  }
});

ipcMain.handle('archive:setLocalStagingRoot', async (_event, value) => {
  await settings.setLocalStagingRoot(value);
});

ipcMain.handle('archive:setDefaultImportMode', async (_event, value) => {
  await settings.setDefaultImportMode(value);
});

ipcMain.handle('archive:validateNasRoot', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { valid: false, reason: 'no-path' };
  try {
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return { valid: false, reason: 'not-directory' };
    const markerPath = path.join(dirPath, '.autoingest', 'root', 'archive-root.json');
    const raw = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (marker.type !== 'autoingest-nas-root') return { valid: false, reason: 'wrong-marker-type' };
    return { valid: true, archiveName: marker.archiveName || null };
  } catch (err) {
    if (err.code === 'ENOENT') return { valid: false, reason: 'no-marker' };
    if (err.code === 'EACCES') return { valid: false, reason: 'no-access' };
    return { valid: false, reason: 'error', message: err.message };
  }
});

ipcMain.handle('archive:initArchiveRoot', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { ok: false, reason: 'not-found' };

  // Phase 1: confirm directory exists and is reachable
  let stat;
  try {
    stat = await fsp.stat(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, reason: 'not-found' };
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, reason: 'no-access' };
    return { ok: false, reason: 'error', message: err.message };
  }
  if (!stat.isDirectory()) return { ok: false, reason: 'not-directory' };

  // Phase 2: confirm write access via temp-file probe (create + delete)
  const probe = path.join(dirPath, '.autoingest-probe-' + Date.now());
  try {
    await fsp.writeFile(probe, '', 'utf8');
    await fsp.unlink(probe);
  } catch {
    return { ok: false, reason: 'no-access' };
  }

  // Phase 3: check for an existing marker — do not overwrite a valid or incompatible one
  const markerDir  = path.join(dirPath, '.autoingest', 'root');
  const markerPath = path.join(markerDir, 'archive-root.json');
  try {
    const raw    = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (marker && marker.type === 'autoingest-nas-root') return { ok: false, reason: 'already-initialized' };
    if (marker && marker.type)                           return { ok: false, reason: 'incompatible-type' };
    // Unparseable / missing type — treat as corrupt, fall through to write
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Exists but unreadable or corrupt — fall through to overwrite
    }
    // ENOENT means no marker yet — proceed to write
  }

  // Phase 4: write the marker
  try {
    await fsp.mkdir(markerDir, { recursive: true });
    await fsp.writeFile(markerPath, JSON.stringify({
      type:      'autoingest-nas-root',
      createdAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    hidePathBestEffort(path.join(dirPath, '.autoingest')).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err.message };
  }
});

ipcMain.handle('archive:validateLocalStagingRoot', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { valid: false, reason: 'no-path' };
  try {
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return { valid: false, reason: 'not-directory' };
  } catch (err) {
    if (err.code === 'ENOENT') return { valid: false, reason: 'not-found' };
    if (err.code === 'EACCES' || err.code === 'EPERM') return { valid: false, reason: 'no-access' };
    return { valid: false, reason: 'error', message: err.message };
  }
  // Write-access probe — always cleaned up via finally
  const probe = path.join(dirPath, '.autoingest-probe-' + Date.now());
  let written = false;
  try {
    await fsp.writeFile(probe, '');
    written = true;
    return { valid: true };
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') return { valid: false, reason: 'no-access' };
    return { valid: false, reason: 'error', message: err.message };
  } finally {
    if (written) fsp.unlink(probe).catch(() => {});
  }
});

// Resolves which archive root is currently active.
// Prefers mainArchiveRoot when configured and reachable; nasRoot is a user-selected
// working override when main is also available, or the sole root when main is not.
// Returns computed state only — caller must never persist this result.
async function _resolveEffectiveArchiveRoot() {
  const mainRoot = settings.getMainArchiveRoot();
  const nasRoot  = settings.getNasRoot();
  if (mainRoot) {
    try {
      const stat = await fsp.stat(mainRoot);
      if (stat.isDirectory()) {
        const markerPath = path.join(mainRoot, '.autoingest', 'root', 'archive-root.json');
        const raw    = await fsp.readFile(markerPath, 'utf8');
        const marker = JSON.parse(raw);
        if (marker.type === 'autoingest-nas-root') {
          if (nasRoot && nasRoot !== mainRoot) {
            // User has an explicit working-root override that differs from main.
            return { path: nasRoot, source: 'override', lockedToMain: false, mainAvailable: true };
          }
          // nasRoot unset, or redundantly equals mainRoot — treat as auto-main.
          return { path: mainRoot, source: 'main', lockedToMain: false, mainAvailable: true };
        }
      }
    } catch { /* unreachable or no marker — fall through */ }
  }
  return { path: nasRoot || null, source: nasRoot ? 'active' : 'none', lockedToMain: false, mainAvailable: false };
}

ipcMain.handle('archive:resolveEffectiveRoot', async () => {
  return _resolveEffectiveArchiveRoot();
});

// Dashboard "Events This Week": count managed event folders (containing event.json) under the
// effective archive root whose folder was created/modified within the last 7 days. Read-only,
// bounded (collection → event, 2 levels). Returns { ok:false } when the archive is unavailable
// so the dashboard can show "—" (loading/unavailable) rather than a stale number.
ipcMain.handle('archive:countEventsThisWeek', async () => {
  const eff  = await _resolveEffectiveArchiveRoot();
  const root = eff?.path;
  if (!root) return { ok: false, reason: 'no-root' };
  let collEntries;
  try {
    const st = await fsp.stat(root);
    if (!st.isDirectory()) return { ok: false, reason: 'unavailable' };
    collEntries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const coll of collEntries) {
    if (!coll.isDirectory() || coll.name.startsWith('.') || _NAS_SKIP_DIRS.has(coll.name)) continue;
    const collPath = path.join(root, coll.name);
    let evEntries;
    try { evEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
    for (const ev of evEntries) {
      if (!ev.isDirectory() || ev.name.startsWith('.') || _NAS_SKIP_DIRS.has(ev.name)) continue;
      const evPath = path.join(collPath, ev.name);
      try { await fsp.access(path.join(evPath, 'event.json')); } catch { continue; } // managed events only
      try {
        const est = await fsp.stat(evPath);
        const t   = est.birthtimeMs > 0 ? est.birthtimeMs : est.mtimeMs; // creation when available, else modified
        if (t >= sinceMs) count++;
      } catch { /* skip unreadable event folder */ }
    }
  }
  return { ok: true, count };
});

ipcMain.handle('archive:getOperationsStatus', async () => {
  const localStagingRoot  = settings.getLocalStagingRoot();
  const defaultImportMode = settings.getDefaultImportMode();
  const mainArchiveRoot   = settings.getMainArchiveRoot();
  const nasRoot           = settings.getNasRoot();

  const effective = await _resolveEffectiveArchiveRoot();
  const base = {
    nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot,
    effectiveNasRoot: effective.path,
    effectiveSource:  effective.source,
    mainAvailable:    effective.mainAvailable,
  };

  if (effective.source === 'none') {
    return { ...base, status: 'nas-not-set' };
  }

  if (effective.source === 'main') {
    // mainArchiveRoot already validated inside _resolveEffectiveArchiveRoot
    if (defaultImportMode === 'local-first' && !localStagingRoot) {
      return { ...base, status: 'local-staging-missing' };
    }
    return { ...base, status: 'ready' };
  }

  // effective.source === 'active' — validate nasRoot
  try {
    const stat = await fsp.stat(nasRoot);
    if (!stat.isDirectory()) return { ...base, status: 'invalid-nas' };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTCONN' || err.code === 'EIO') {
      return { ...base, status: 'nas-disconnected' };
    }
    return { ...base, status: 'invalid-nas' };
  }

  try {
    const markerPath = path.join(nasRoot, '.autoingest', 'root', 'archive-root.json');
    const raw = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (marker.type !== 'autoingest-nas-root') return { ...base, status: 'invalid-nas' };
  } catch {
    return { ...base, status: 'invalid-nas' };
  }

  if (defaultImportMode === 'local-first' && !localStagingRoot) {
    return { ...base, status: 'local-staging-missing' };
  }

  return { ...base, status: 'ready' };
});

// ── Archive — NAS Event List ──────────────────────────────────────────────────

// Dirs inside event folders that must not be classified as photographer folders
// or treated as event sub-folders during scanning.
const _NAS_SKIP_DIRS = new Set(['_Selected', '.autoingest', '__MACOSX']);

/**
 * Scan the NAS archive root for collections and their event subfolders.
 *
 * Classification rules:
 *  - AutoIngest-managed event folder: contains a readable, valid event.json.
 *  - External/manual folder:          does not contain a valid event.json.
 *  - Skipped completely:              starts with "." or is in _NAS_SKIP_DIRS.
 *
 * IPC payload safety: imports[] is stripped before any event.json data is
 * returned (mirrors master:scanEvents) to prevent renderer OOM on large archives.
 *
 * @param {string} nasRoot  Absolute path to the NAS archive root directory.
 * @returns {Promise<{ status: string, refreshedAt: string, source: 'nas', collections: Array }>}
 */
async function _scanNasArchive(nasRoot) {
  const refreshedAt = new Date().toISOString();

  // TEMPORARY DIAGNOSTIC (BUG-011 real-Windows/NAS RC follow-up) — logs the exact
  // nasRoot and each collection's computed path, so it can be directly diffed
  // against master:scanEvents's own "scan start masterPath=..." line for the same
  // collection in the same app.log. Remove alongside the other diagnostic blocks.
  {
    const _mainRoot = settings.getMainArchiveRoot();
    const _shape = _diagPathShape(nasRoot);
    let _rp = null, _rpErr = null, _exists = null;
    try { _rp = await fsp.realpath(nasRoot); _exists = true; }
    catch (e) { _rpErr = e.code || e.message; _exists = e.code !== 'ENOENT'; }
    log(`[EventDiscoveryDiagnostics] _scanNasArchive start nasRoot(archiveRoot/workingRoot)=${JSON.stringify(nasRoot)} `
      + `mainArchiveRoot=${JSON.stringify(_mainRoot)} win32Normalized=${JSON.stringify(path.win32.normalize(nasRoot))} `
      + `realpath=${JSON.stringify(_rp)} realpathError=${JSON.stringify(_rpErr)} exists=${_exists} `
      + `isUNCPath=${_shape.isUNC} isDriveLetterPath=${_shape.isDriveLetter}`);
  }

  let collectionEntries;
  try {
    collectionEntries = await fsp.readdir(nasRoot, { withFileTypes: true });
  } catch {
    // The only caller (_runNasScan) already validated the archive-root marker
    // before invoking this function, so a readdir failure here is a transient
    // reachability problem (NAS hiccup, SMB timeout), not evidence of an invalid
    // archive — never report it the same way as "confirmed invalid".
    return { status: 'nas-disconnected', refreshedAt, source: 'nas', collections: [] };
  }

  const lists = {
    cities:     listManager.getList('cities'),
    locations:  listManager.getList('locations'),
    eventTypes: listManager.getList('event-types'),
  };

  const collections = [];

  for (const collEntry of collectionEntries) {
    if (!collEntry.isDirectory()) continue;
    if (collEntry.name.startsWith('.') || _NAS_SKIP_DIRS.has(collEntry.name)) continue;

    const collPath = path.join(nasRoot, collEntry.name);
    const collection = { name: collEntry.name, path: collPath, events: [], externalFolders: [] };
    log(`[EventDiscoveryDiagnostics] _scanNasArchive collection name=${JSON.stringify(collEntry.name)} collPath=${JSON.stringify(collPath)}`);

    let eventEntries;
    try {
      eventEntries = await fsp.readdir(collPath, { withFileTypes: true });
    } catch {
      // Read failed for this one collection (NAS hiccup mid-scan) — flag it so
      // callers don't mistake an unreadable collection for a genuinely empty one.
      collection.scanError = true;
      collections.push(collection);
      continue;
    }

    for (const evEntry of eventEntries) {
      if (!evEntry.isDirectory()) continue;
      if (evEntry.name.startsWith('.') || _NAS_SKIP_DIRS.has(evEntry.name)) continue;

      const evPath      = path.join(collPath, evEntry.name);
      const jsonPath    = path.join(evPath, 'event.json');

      let eventJson = null;
      let jsonCorrupt = false;
      try {
        const raw = await fsp.readFile(jsonPath, 'utf8');
        const obj = normalizeEventJson(JSON.parse(raw));
        if (isValidEventJson(obj)) {
          eventJson = obj;
        } else {
          jsonCorrupt = true;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') jsonCorrupt = true;
        // ENOENT = no event.json → external/manual folder
      }

      if (eventJson) {
        // AutoIngest-managed event — strip imports[] before IPC payload
        const { imports: _omit, ...meta } = eventJson;
        const parsed = parseEventName(evEntry.name, lists);
        const hijriDate = parsed.ok ? parsed.hijriDate : (eventJson.hijriDate || '');
        const seqRaw    = parsed.ok ? parsed.sequence  : (eventJson.sequence  || '00');
        const sequence  = typeof seqRaw === 'number'
          ? String(seqRaw).padStart(2, '0')
          : String(seqRaw);

        collection.events.push({
          name:          evEntry.name,
          path:          evPath,
          eventJsonPath: jsonPath,
          eventId:       meta.id          || null,
          eventName:     meta.eventName   || evEntry.name,
          hijriDate,
          sequence,
          status:        'available',
          isCorrupt:     false,
        });
      } else if (jsonCorrupt) {
        // event.json present but unreadable — surface as corrupt managed event
        const parsed = parseEventName(evEntry.name, lists);
        collection.events.push({
          name:          evEntry.name,
          path:          evPath,
          eventJsonPath: jsonPath,
          eventId:       null,
          eventName:     evEntry.name,
          hijriDate:     parsed.ok ? parsed.hijriDate : '',
          sequence:      parsed.ok ? String(parsed.sequence).padStart(2, '0') : '',
          status:        'corrupt',
          isCorrupt:     true,
        });
      } else {
        // No event.json → external/manual folder
        collection.externalFolders.push({
          name: evEntry.name,
          path: evPath,
          type: 'external-folder',
        });
      }
    }

    // Sort events newest-first (matches master:scanEvents ordering)
    collection.events.sort((a, b) => {
      if (a.hijriDate !== b.hijriDate) return b.hijriDate.localeCompare(a.hijriDate);
      return b.sequence.localeCompare(a.sequence);
    });

    collections.push(collection);
  }

  // Sort collections alphabetically
  collections.sort((a, b) => a.name.localeCompare(b.name));

  return { status: 'ready', refreshedAt, source: 'nas', collections };
}

async function _runNasScan() {
  const nasRoot = settings.getNasRoot();
  if (!nasRoot) {
    return { status: 'nas-not-set', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
  }

  // Validate the NAS root marker before scanning. Reading the marker and parsing
  // it are handled as separate failure modes: a read failure (network hiccup,
  // permission blip, SMB timeout) means "temporarily unreachable" and must not
  // be reported the same way as a marker that is actually corrupt/absent-by-design.
  let raw;
  try {
    const markerPath = path.join(nasRoot, '.autoingest', 'root', 'archive-root.json');
    raw = await fsp.readFile(markerPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      try {
        await fsp.stat(nasRoot);
        return { status: 'invalid-nas', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
      } catch {
        return { status: 'nas-disconnected', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
      }
    }
    // Root exists but the marker read failed for a non-ENOENT reason — a transient
    // reachability problem, not evidence the archive is misconfigured.
    return { status: 'nas-disconnected', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
  }

  try {
    const mark = JSON.parse(raw);
    if (mark.type !== 'autoingest-nas-root') {
      return { status: 'invalid-nas', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
    }
  } catch {
    // Marker file exists but its contents are corrupt — genuinely invalid, not transient.
    return { status: 'invalid-nas', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
  }

  const result = await _scanNasArchive(nasRoot);

  if (result.status === 'ready') {
    await nasEventCache.save({ cachedAt: result.refreshedAt, collections: result.collections });
  }

  return result;
}

ipcMain.handle('archive:scanNasEvents',    async () => _runNasScan());
ipcMain.handle('archive:refreshNasEvents', async () => _runNasScan());

// Scan Local Staging Root for master collections — used when Active Archive Root is offline.
// Does not require or validate an archive-root marker. Returns basic collection + event stubs.
// Each collection entry is augmented with linkData and linkStatus from collection.link.json.
ipcMain.handle('archive:scanStagingCollections', async (_event, stagingRoot) => {
  if (!stagingRoot || typeof stagingRoot !== 'string') return { ok: false, collections: [] };
  let entries;
  try {
    entries = await fsp.readdir(stagingRoot, { withFileTypes: true });
  } catch {
    return { ok: false, collections: [] };
  }

  const nasRoot  = settings.getNasRoot();
  let   nasOnline = false;
  if (nasRoot) {
    try { await fsp.access(nasRoot); nasOnline = true; } catch { /* offline */ }
  }

  const collections = [];
  for (const collEntry of entries) {
    if (!collEntry.isDirectory()) continue;
    if (collEntry.name.startsWith('.') || _NAS_SKIP_DIRS.has(collEntry.name)) continue;
    const collPath = path.join(stagingRoot, collEntry.name);
    const events = [];
    try {
      const evEntries = await fsp.readdir(collPath, { withFileTypes: true });
      for (const evEntry of evEntries) {
        if (!evEntry.isDirectory() || evEntry.name.startsWith('.')) continue;
        try {
          await fsp.access(path.join(collPath, evEntry.name, 'event.json'));
          events.push({ name: evEntry.name });
        } catch { /* no event.json — skip */ }
      }
    } catch { /* unreadable collection — include with 0 events */ }

    const { ok: hasLink, link } = await offlineCollectionRegistry.readLink(collPath);
    const linkData   = (hasLink && link) ? link : null;
    const linkStatus = offlineCollectionRegistry.deriveStatus(linkData, nasRoot, nasOnline);

    collections.push({ name: collEntry.name, path: collPath, events, linkData, linkStatus });
  }
  collections.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, collections };
});

ipcMain.handle('archive:getCachedNasEvents', async () => {
  const cached = await nasEventCache.load();
  if (!cached) return { status: 'no-cache', source: 'cache', collections: [] };
  return {
    status:      'ready',
    source:      'cache',
    cachedAt:    cached.cachedAt,
    refreshedAt: cached.cachedAt,
    collections: cached.collections,
  };
});

ipcMain.handle('archive:clearNasEventCache', async () => {
  await nasEventCache.clear();
});

// ── Local mirror service ──────────────────────────────────────────────────────

ipcMain.handle('archive:previewLocalMirror',   async (_event, params) => localMirrorService.previewLocalMirror(params));
ipcMain.handle('archive:ensureLocalMirror',    async (_event, params) => localMirrorService.ensureLocalMirror(params));
ipcMain.handle('archive:getLocalMirrorStatus', async (_event, params) => localMirrorService.getLocalMirrorStatus(params));

// ── Local sync manifest ───────────────────────────────────────────────────────

ipcMain.handle('archive:writeSyncManifest', async (_event, { localEventPath, manifest }) => {
  if (!localEventPath || typeof localEventPath !== 'string') {
    return { ok: false, reason: 'Invalid localEventPath.' };
  }

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root not configured.' };

  let realRoot;
  try {
    realRoot = await fsp.realpath(stagingRoot);
  } catch {
    return { ok: false, reason: 'Local Staging Root not accessible.' };
  }

  // localEventPath should exist after a completed import, but resolve parent as fallback.
  let realEventPath;
  try {
    realEventPath = await fsp.realpath(localEventPath);
  } catch {
    try {
      const parentReal = await fsp.realpath(path.dirname(localEventPath));
      realEventPath = path.join(parentReal, path.basename(localEventPath));
    } catch (err) {
      return { ok: false, reason: `localEventPath not accessible: ${err.message}` };
    }
  }

  if (!PathUtils.isPathUnderRoot(realEventPath, realRoot)) {
    return { ok: false, reason: 'localEventPath is outside the configured Local Staging Root.' };
  }

  return localSyncManifest.writeManifest(localEventPath, manifest);
});
ipcMain.handle('archive:readSyncManifest',  async (_event, { localEventPath }) =>
  localSyncManifest.readManifest(localEventPath));

ipcMain.handle('archive:appendSyncJob', async (_event, { localEventPath, job }) => {
  if (!localEventPath || typeof localEventPath !== 'string') {
    return { ok: false, reason: 'Invalid localEventPath.' };
  }

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root not configured.' };

  let realRoot;
  try {
    realRoot = await fsp.realpath(stagingRoot);
  } catch {
    return { ok: false, reason: 'Local Staging Root not accessible.' };
  }

  let realEventPath;
  try {
    realEventPath = await fsp.realpath(localEventPath);
  } catch {
    try {
      const parentReal = await fsp.realpath(path.dirname(localEventPath));
      realEventPath = path.join(parentReal, path.basename(localEventPath));
    } catch (err) {
      return { ok: false, reason: `localEventPath not accessible: ${err.message}` };
    }
  }

  if (!PathUtils.isPathUnderRoot(realEventPath, realRoot)) {
    return { ok: false, reason: 'localEventPath is outside the configured Local Staging Root.' };
  }

  return localSyncManifest.appendJob(localEventPath, job);
});

// ── Direct-archive lock helpers ───────────────────────────────────────────────

// Must match config/app.config.js VIDEO_EXTENSIONS exactly.
const _DIRECT_ARCHIVE_VIDEO_EXTS = new Set(['.mp4', '.mov']);

/**
 * Release all held direct-nas import locks and clear their heartbeat timers.
 * Idempotent — empties the array after the first call, so duplicate calls are safe.
 *
 * @param {Array<{lockPath:string, heartbeatTimer:*}>} locks
 */
function _releaseDirectNasLocks(locks) {
  for (const held of locks) {
    clearInterval(held.heartbeatTimer);
    archiveLockService.releaseLock(held.lockPath).catch(err =>
      console.warn('[import:commitTransaction] Lock release error:', err.message)
    );
  }
  locks.length = 0;
}

/**
 * Derive deduplicated photographer-level lock scopes from an array of fileJobs.
 *
 * Routing structure (from importRouter.js):
 *   single:  nasRoot/collection/eventName/photographer/[VIDEO/]file
 *   multi:   nasRoot/collection/eventName/subEventId/photographer/[VIDEO/]file
 *
 * VIDEO strip: only strip the VIDEO segment when the file has a video extension
 * AND the immediate parent dir name is literally "VIDEO".
 * photographerFolderName = segments[segments.length - 1] (last segment only),
 * which matches Phase 7 lock keys that use phEntry.name.
 *
 * @param {Array<{src:string, dest:string}>} fileJobs
 * @param {string} nasRoot
 * @returns {Array<{collection:string, eventFolderName:string, photographerFolderName:string}>}
 */
function _extractPhotographerLockScopes(fileJobs, nasRoot) {
  const seen = new Map();
  for (const job of fileJobs) {
    let parentDir = path.dirname(job.dest);
    const ext = path.extname(job.dest).toLowerCase();
    if (_DIRECT_ARCHIVE_VIDEO_EXTS.has(ext) && path.basename(parentDir) === 'VIDEO') {
      parentDir = path.dirname(parentDir);
    }
    const rel      = path.relative(nasRoot, parentDir);
    const segments = rel.split(path.sep).filter(Boolean);
    if (segments.length < 3) continue;
    const collection             = segments[0];
    const eventFolderName        = segments[1];
    const photographerFolderName = segments[segments.length - 1];
    const key = `${collection}\x00${eventFolderName}\x00${photographerFolderName}`;
    if (!seen.has(key)) seen.set(key, { collection, eventFolderName, photographerFolderName });
  }
  return Array.from(seen.values());
}

// ── Durable sync queue ────────────────────────────────────────────────────────

ipcMain.handle('archive:refreshSyncQueue',    async () => syncQueueService.refreshQueue());
ipcMain.handle('archive:getSyncQueue',        async () => syncQueueService.getQueue());
ipcMain.handle('archive:getSyncQueueSummary', async () => syncQueueService.getSummary());
ipcMain.handle('archive:readSyncJob',         async (_event, jobId) => syncQueueService.getJob(jobId));

// ── Background archive sync ───────────────────────────────────────────────────

ipcMain.handle('archive:syncJobNow', async (_event, jobId) => {
  if (!jobId || typeof jobId !== 'string') return { ok: false, error: 'Invalid jobId' };
  if (_syncingJobIds.has(jobId)) return { ok: false, error: 'Already syncing' };

  const job = await syncQueueService.getJob(jobId);
  if (!job) return { ok: false, error: 'Job not found' };
  // 'needs-attention' is eligible: a metadata failure must not block archive file copy.
  // 'paused' is eligible: resume continues from where it left off.
  if (job.status !== 'ready-for-sync' && job.status !== 'sync-failed' &&
      job.status !== 'waiting-for-lock' && job.status !== 'needs-attention' &&
      job.status !== 'paused') {
    return { ok: false, error: `Job not eligible for sync (status: ${job.status})` };
  }

  const nasRoot     = settings.getNasRoot();
  const stagingRoot = settings.getLocalStagingRoot();
  if (!nasRoot)     return { ok: false, error: 'Active Archive Root not configured' };
  if (!stagingRoot) return { ok: false, error: 'Local Staging Root not configured' };

  // Block provisional and stale-link collections before touching sync state.
  // Legacy collections with no link file are allowed (name-identity fallback).
  if (job.localEventPath) {
    const collPath = path.dirname(job.localEventPath);
    try {
      const { ok: hasLink, link } = await offlineCollectionRegistry.readLink(collPath);
      if (hasLink && link) {
        if (link.status === 'provisional') {
          return { ok: false, error: 'provisional-needs-match', provisionalBlocked: true };
        }
        if (link.nasRoot && nasRoot && link.nasRoot !== nasRoot) {
          return { ok: false, error: 'stale-link-needs-rematch', staleLinkBlocked: true };
        }
      }
    } catch { /* non-fatal — allow sync to proceed */ }
  }

  _syncingJobIds.add(jobId);
  // Send periodic heartbeats to keep the sync slot alive while copying.
  const _slotHeartbeatTimer = setInterval(() => realtimeOps.sendSlotHeartbeat(jobId), 15_000);
  await syncQueueService.updateJob(jobId, { status: 'syncing', syncStartedAt: Date.now() });
  realtimeOps.emitSyncStatus({
    jobId,
    collectionName:  job.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
    eventFolderName: job.localEventPath ? path.basename(job.localEventPath) : null,
    photographer:    job.photographer || null,
    status:          'syncing',
  });
  realtimeOps.emitDeviceActivity({
    mode:            'syncing',
    collectionName:  job.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
    eventFolderName: job.localEventPath ? path.basename(job.localEventPath) : null,
    photographer:    job.photographer || null,
    progressCurrent: 0,
    progressTotal:   null,
    status:          'Syncing',
  });

  // Load per-job files[] from manifest so syncJob can target exactly those files.
  let jobFiles = null;
  if (job.importId && job.localEventPath) {
    try {
      const manifest = await localSyncManifest.readManifest(job.localEventPath);
      const mJob = Array.isArray(manifest?.jobs)
        ? manifest.jobs.find(j => j.importId === job.importId)
        : null;
      if (Array.isArray(mJob?.files) && mJob.files.length > 0) jobFiles = mJob.files;
    } catch { /* non-fatal — fall back to folder-level sync */ }
  }

  // Fresh pause signal for this run; injected into archiveSyncService so it can
  // exit cleanly between files when archive:pauseJob is called.
  const pauseSignal = { paused: false };
  _jobPauseSignals.set(jobId, pauseSignal);

  let _tlSyncThrottleTs = 0;
  const progressCallback = (progress) => {
    const w = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (w) w.webContents.send('sync:jobProgress', { jobId, ...progress });

    // Throttled advisory team activity update — at most once per second.
    const now = Date.now();
    if (now - _tlSyncThrottleTs >= 1000) {
      _tlSyncThrottleTs = now;
      realtimeOps.emitDeviceActivity({
        mode:            'syncing',
        collectionName:  job.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
        eventFolderName: job.localEventPath ? path.basename(job.localEventPath) : null,
        photographer:    job.photographer || null,
        progressCurrent: progress.completedFiles || 0,
        progressTotal:   progress.totalFiles || 0,
        status:          `${progress.completedFiles || 0} of ${progress.totalFiles || 0}`,
      });
    }
  };

  try {
    const syncResult = await archiveSyncService.syncJob(
      { ...job, files: jobFiles },
      { nasRoot, stagingRoot },
      { progressCallback, pauseSignal },
    );
    await syncQueueService.updateJob(jobId, {
      status:        syncResult.status,
      syncResult,
      syncedAt:      syncResult.syncedAt  || null,
      syncStartedAt: syncResult.syncStartedAt,
    });
    realtimeOps.emitSyncStatus({
      jobId,
      collectionName:  job.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
      eventFolderName: job.localEventPath ? path.basename(job.localEventPath) : null,
      photographer:    job.photographer || null,
      status:          syncResult.status || 'synced',
    });
    realtimeOps.emitDeviceActivity({
      mode:            'idle',
      collectionName:  job.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
      eventFolderName: job.localEventPath ? path.basename(job.localEventPath) : null,
      status:          syncResult.status || 'synced',
    });
    return { ok: syncResult.ok, syncResult };
  } catch (err) {
    await syncQueueService.updateJob(jobId, { status: 'sync-failed', syncError: err.message });
    realtimeOps.emitSyncStatus({
      jobId,
      collectionName:  job?.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
      eventFolderName: job?.localEventPath ? path.basename(job.localEventPath) : null,
      photographer:    job?.photographer || null,
      status:          'sync-failed',
    });
    realtimeOps.emitDeviceActivity({
      mode:            'idle',
      collectionName:  job?.localEventPath ? path.basename(path.dirname(job.localEventPath)) : null,
      eventFolderName: job?.localEventPath ? path.basename(job.localEventPath) : null,
      status:          'sync-failed',
    });
    return { ok: false, error: err.message };
  } finally {
    clearInterval(_slotHeartbeatTimer);
    _syncingJobIds.delete(jobId);
    _jobPauseSignals.delete(jobId);
  }
});

ipcMain.handle('archive:pauseJob', async (_event, jobId) => {
  if (!jobId || typeof jobId !== 'string') return { ok: false, error: 'Invalid jobId' };
  if (!_syncingJobIds.has(jobId))          return { ok: false, error: 'Job not currently syncing' };
  const signal = _jobPauseSignals.get(jobId);
  if (!signal) return { ok: false, error: 'No pause signal for job' };
  signal.paused = true;
  return { ok: true };
});

ipcMain.handle('archive:verifyJobChecksum', async (_event, jobId) => {
  if (!jobId || typeof jobId !== 'string') return { ok: false, error: 'Invalid jobId' };
  if (_verifyingJobIds.has(jobId))         return { ok: false, error: 'Already verifying' };

  const job = await syncQueueService.getJob(jobId);
  if (!job) return { ok: false, error: 'Job not found' };

  const nasRoot     = settings.getNasRoot();
  const stagingRoot = settings.getLocalStagingRoot();
  if (!nasRoot) return { ok: false, error: 'Active Archive Root not configured' };

  // Load files[] from manifest for exact-file verification.
  let verifyFiles = null;
  if (job.importId && job.localEventPath) {
    try {
      const manifest = await localSyncManifest.readManifest(job.localEventPath);
      const mJob = Array.isArray(manifest?.jobs)
        ? manifest.jobs.find(j => j.importId === job.importId)
        : null;
      if (Array.isArray(mJob?.files) && mJob.files.length > 0) verifyFiles = mJob.files;
    } catch { /* non-fatal — fall back to photographer folder scan */ }
  }

  await syncQueueService.updateJob(jobId, { checksumStatus: 'running' });
  _verifyingJobIds.add(jobId);

  const progressCallback = (progress) => {
    const w = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (w) w.webContents.send('sync:checksumProgress', { jobId, ...progress });
  };

  try {
    const verifyJob = verifyFiles ? { ...job, files: verifyFiles } : job;
    const verifyResult = await archiveSyncService.verifyJobChecksum(
      verifyJob,
      { nasRoot, stagingRoot, progressCallback },
    );
    await syncQueueService.updateJob(jobId, {
      checksumStatus:     verifyResult.status,
      checksumResult:     verifyResult,
      checksumVerifiedAt: verifyResult.verifiedAt,
    });
    return { ok: verifyResult.ok, result: verifyResult };
  } catch (err) {
    await syncQueueService.updateJob(jobId, { checksumStatus: 'error', checksumError: err.message });
    return { ok: false, error: err.message };
  } finally {
    _verifyingJobIds.delete(jobId);
  }
});

ipcMain.handle('archive:syncAllReadyJobs', async () => {
  const nasRoot     = settings.getNasRoot();
  const stagingRoot = settings.getLocalStagingRoot();
  if (!nasRoot)     return { ok: false, error: 'Active Archive Root not configured' };
  if (!stagingRoot) return { ok: false, error: 'Local Staging Root not configured' };

  // Wait for sync slot — blocks until actually granted (not a timed bypass).
  // Falls back immediately if realtime is unavailable or unresponsive.
  let _batchSlotGranted = false;
  try {
    const slotResult = await realtimeOps.waitForSyncSlot('syncAllReady');
    _batchSlotGranted = !slotResult.fallback;
  } catch { /* non-fatal — proceed without slot coordination */ }

  const { jobs } = await syncQueueService.getQueue();
  const eligible  = (jobs || []).filter(j => j.status === 'ready-for-sync');

  const results = [];
  const totals  = { copiedToArchive: 0, skippedDuplicates: 0, renamedConflicts: 0, errors: 0 };
  try {
    for (const job of eligible) {
      if (_syncingJobIds.has(job.jobId)) { results.push({ jobId: job.jobId, skipped: true }); continue; }

      // Pre-check link status before marking syncing — mirrors syncJobNow to prevent
      // blocked jobs from briefly showing 'syncing' in the UI.
      if (job.localEventPath) {
        const _preCollPath = path.dirname(job.localEventPath);
        try {
          const { ok: _hasLink, link: _link, reason: _reason } = await offlineCollectionRegistry.readLink(_preCollPath);
          if (_hasLink && _link) {
            if (_link.status === 'provisional') {
              results.push({ jobId: job.jobId, status: 'provisional-needs-match', blocked: true });
              continue;
            }
            if (_link.nasRoot && nasRoot && _link.nasRoot !== nasRoot) {
              results.push({ jobId: job.jobId, status: 'stale-link-needs-rematch', blocked: true });
              continue;
            }
          } else if (_reason && _reason !== 'not-found') {
            // Link file exists but is unreadable — block rather than route to wrong NAS.
            results.push({ jobId: job.jobId, status: 'stale-link-needs-rematch', blocked: true });
            continue;
          }
        } catch { /* non-fatal — let service-level validation handle unexpected errors */ }
      }

      _syncingJobIds.add(job.jobId);
      await syncQueueService.updateJob(job.jobId, { status: 'syncing', syncStartedAt: Date.now() });
      // Load per-job files[] from manifest for targeted sync.
      let _jobFiles = null;
      if (job.importId && job.localEventPath) {
        try {
          const _m = await localSyncManifest.readManifest(job.localEventPath);
          const _mj = Array.isArray(_m?.jobs) ? _m.jobs.find(j => j.importId === job.importId) : null;
          if (Array.isArray(_mj?.files) && _mj.files.length > 0) _jobFiles = _mj.files;
        } catch { /* non-fatal */ }
      }
      const _batchPause = { paused: false };
      _jobPauseSignals.set(job.jobId, _batchPause);
      const _batchProgress = (progress) => {
        const w = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
        if (w) w.webContents.send('sync:jobProgress', { jobId: job.jobId, ...progress });
      };
      try {
        const syncResult = await archiveSyncService.syncJob(
          { ...job, files: _jobFiles },
          { nasRoot, stagingRoot },
          { progressCallback: _batchProgress, pauseSignal: _batchPause },
        );
        await syncQueueService.updateJob(job.jobId, {
          status:        syncResult.status,
          syncResult,
          syncedAt:      syncResult.syncedAt || null,
          syncStartedAt: syncResult.syncStartedAt,
        });
        totals.copiedToArchive   += syncResult.copiedToArchive   || 0;
        totals.skippedDuplicates += syncResult.skippedDuplicates || 0;
        totals.renamedConflicts  += syncResult.renamedConflicts  || 0;
        totals.errors            += syncResult.errors?.length    || 0;
        results.push({ jobId: job.jobId, status: syncResult.status });
      } catch (err) {
        await syncQueueService.updateJob(job.jobId, { status: 'sync-failed', syncError: err.message });
        totals.errors++;
        results.push({ jobId: job.jobId, status: 'sync-failed', error: err.message });
      } finally {
        _syncingJobIds.delete(job.jobId);
        _jobPauseSignals.delete(job.jobId);
      }
    }
  } finally {
    if (_batchSlotGranted) realtimeOps.releaseSyncSlot('syncAllReady');
  }
  return { ok: true, processed: results.length, results, totals };
});

// ── Direct archive lock check (advisory pre-flight) ──────────────────────────

ipcMain.handle('archive:checkDirectArchiveLocks', async (_event, { fileJobs } = {}) => {
  const nasRoot = settings.getNasRoot();
  const currentDeviceName = os.hostname();
  if (!nasRoot) return { ok: true, blocked: [], currentDeviceName };

  const scopes  = _extractPhotographerLockScopes(fileJobs || [], nasRoot);
  const blocked = [];
  for (const scope of scopes) {
    try {
      const r = await archiveLockService.checkLock(nasRoot, scope);
      if (r.blocked) {
        const lockPath = archiveLockService.getLockPath(nasRoot, scope);
        blocked.push({ ...scope, lockedBy: r.lockedBy, expiresAt: r.expiresAt, lockPath });
      }
    } catch (err) {
      console.warn('[archive:checkDirectArchiveLocks] checkLock I/O error (treating as not blocked):', scope.photographerFolderName, err.message);
    }
  }
  return { ok: true, blocked, currentDeviceName };
});

ipcMain.handle('archive:clearSelfStaleLock', async (_event, { lockPath, force = false } = {}) => {
  if (!lockPath || typeof lockPath !== 'string') return { ok: false, reason: 'invalid-path' };
  const nas  = settings.getNasRoot();
  const main = settings.getMainArchiveRoot();
  const configuredRoots = [nas, main].filter(Boolean);
  if (configuredRoots.length === 0) return { ok: false, reason: 'no-configured-roots' };
  // Allow bypassing the heartbeat recency guard only when the renderer has confirmed
  // no active import is running AND this process has no background sync jobs running.
  const allowForce = force && _syncingJobIds.size === 0;
  const result = await archiveLockService.clearSelfLock(lockPath, configuredRoots, { force: allowForce });
  if (result.ok) log(`[import] Cleared self-stale lock: ${path.basename(lockPath)}`);
  return result;
});

// ── EXIF metadata service ─────────────────────────────────────────────────────

// Canonical Representation Audit, L5 (2026-08-11): exifService.getBatchStatus()
// returns the internal batch object raw, including `_context` (whatever object
// was passed to applyBatch() — currently always a plain, JSON-safe shape at
// every verified call site, but never independently validated) and `_resolved`
// (per-file frozen expectation snapshots, also internal-only). This handler is
// the ONLY thing that sends that object over IPC — metadata:retry (below) also
// calls exifService.getBatchStatus() directly, main-process-internal, and
// still needs the real _context (it reads _context.eventJsonPath), so the
// projection belongs here, at the IPC boundary, not inside exifService.js
// itself. Does not change metadata behavior: the fields a status consumer
// actually needs (total/done/skipped/failed/partial/ambiguous/excluded/files)
// are unchanged; only the internal-only fields are no longer exposed to the
// renderer.
ipcMain.handle('metadata:getStatus', (_event, batchId) => {
  const batch = exifService.getBatchStatus(batchId);
  if (!batch) return batch;
  const { _context, _resolved, ...publicStatus } = batch;
  return publicStatus;
});

ipcMain.handle('metadata:retry', async (_event, batchId) => {
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
  // eventJsonPath was stored on the batch's context at applyBatch time (Standard
  // Import / Reapply) so a retry can persist lastMetadataRun the same way the
  // original run did — retry previously never wrote this at all.
  const storedContext = exifService.getBatchStatus(batchId)?._context || null;
  const eventJsonFilePath = storedContext?.eventJsonPath || null;
  const emitFn = async (progress) => {
    if (progress.event === 'batch_complete' && eventJsonFilePath) {
      try {
        await _writeLastMetadataRun(eventJsonFilePath, progress, storedContext?.groups);
      } catch (writeErr) {
        log(`[main] metadata:retry _writeLastMetadataRun failed for ${eventJsonFilePath}: ${writeErr.message}`);
      }
      await _persistMetadataStateAndCompact(progress.batchId, eventJsonFilePath);
    }
    if (win && !win.isDestroyed()) win.webContents.send('metadata:progress', progress);
  };
  // Context is taken from the stored batch state (event.json-derived), not from the renderer.
  exifService.retryFailed(batchId, emitFn);
  return { ok: true };
});

ipcMain.handle('metadata:getLastRun', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') return null;
  try {
    const raw = await fsp.readFile(path.join(eventFolderPath, 'event.json'), 'utf8');
    const doc = JSON.parse(raw);
    if (!doc.lastMetadataRun) return null;
    return {
      ...doc.lastMetadataRun,
      metadataSummary: Array.isArray(doc.metadataSummary) ? doc.metadataSummary : null,
    };
  } catch {
    return null;
  }
});

ipcMain.handle('metadata:getEventState', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') return null;
  try {
    const raw = await fsp.readFile(path.join(eventFolderPath, 'event.json'), 'utf8');
    const doc = JSON.parse(raw);
    return doc.metadataState || null;
  } catch {
    return null;
  }
});

ipcMain.handle('metadata:reapplyEvent', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, error: 'Invalid path' };
  }

  let eventJson;
  try {
    const raw = await fsp.readFile(path.join(eventFolderPath, 'event.json'), 'utf8');
    eventJson = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Could not read event.json' };
  }

  const components      = Array.isArray(eventJson?.components) ? eventJson.components : [];
  const hijriDate       = eventJson?.hijriDate || null;
  const imports         = Array.isArray(eventJson?.imports) ? eventJson.imports : [];
  // Fallback photographer used when path derivation yields an empty segment.
  const fallbackPhotographer = imports.length > 0 ? (imports[imports.length - 1].photographer || '') : '';
  const eventName       = path.basename(eventFolderPath);
  const collName        = path.basename(path.dirname(eventFolderPath));
  const isMulti         = components.length > 1;
  // Persisted metadata grouping: relPath → metadataTags[], built from last grouping import.
  const savedMetaGroups = Array.isArray(eventJson?.metadataGroups) ? eventJson.metadataGroups : null;

  const cfg        = require('../config/app.config');
  const MEDIA_EXTS = new Set([...cfg.PHOTO_EXTENSIONS, ...cfg.VIDEO_EXTENSIONS]);

  async function scanMediaDir(dir, depth) {
    if (depth > 8) return [];
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
    const files = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        files.push(...(await scanMediaDir(fullPath, depth + 1)));
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (MEDIA_EXTS.has(ext)) files.push(fullPath);
      }
    }
    return files;
  }

  // Resolve photographer from archive folder structure.
  // Single-component:  eventFolder/<photographer>/[VIDEO/]filename
  // Multi-component:   eventFolder/<comp>/<photographer>/[VIDEO/]filename
  // In both cases the photographer segment is always parts[0] relative to baseDir.
  function resolvePhotographer(filePath, baseDir) {
    return resolvePhotographerFromPath(filePath, baseDir, fallbackPhotographer);
  }

  const groups      = [];
  const copiedFiles = [];

  if (!isMulti) {
    const rawFiles = await scanMediaDir(eventFolderPath, 0);

    if (savedMetaGroups) {
      // Reconstruct per-tag groups from the persisted mapping so reapply writes
      // the same keyword assignments that were chosen during the original import.
      const relToTags = new Map();
      for (const mg of savedMetaGroups) {
        if (!Array.isArray(mg.metadataTags)) continue;
        for (const relPath of (mg.relPaths || [])) {
          relToTags.set(path.normalize(relPath), mg.metadataTags);
        }
      }
      const buckets  = new Map(); // JSON(tags) → files[]
      const noTagFiles = [];
      for (const f of rawFiles) {
        const rel  = path.normalize(path.relative(eventFolderPath, f));
        const tags = relToTags.get(rel);
        if (Array.isArray(tags)) {
          const key = JSON.stringify(tags);
          if (!buckets.has(key)) buckets.set(key, { tags, files: [] });
          buckets.get(key).files.push(f);
        } else {
          noTagFiles.push(f);
        }
      }
      let gid = 1;
      for (const [, { tags, files }] of buckets) {
        groups.push({ id: `meta-${gid++}`, subEventId: null, files, metadataTags: tags });
      }
      if (noTagFiles.length > 0) {
        groups.push({ id: 'meta-untagged', subEventId: null, files: noTagFiles, metadataTags: null });
      }
    } else {
      groups.push({ id: 'root', subEventId: null, files: rawFiles });
    }

    for (const f of rawFiles) {
      copiedFiles.push({ src: f, dest: f, photographer: resolvePhotographer(f, eventFolderPath) });
    }
  } else {
    for (const comp of components) {
      if (!comp.folderName) continue;
      const compDir  = path.join(eventFolderPath, comp.folderName);
      const rawFiles = await scanMediaDir(compDir, 0);
      if (rawFiles.length === 0) continue;
      groups.push({ id: comp.folderName, subEventId: comp.folderName, files: rawFiles });
      for (const f of rawFiles) {
        copiedFiles.push({ src: f, dest: f, photographer: resolvePhotographer(f, compDir) });
      }
    }
  }

  if (copiedFiles.length === 0) {
    return { ok: false, error: 'No eligible media files found in event folder' };
  }

  const batchId = `reapply-${Date.now().toString(36)}`;
  const win     = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
  const reapplyEventJsonPath = path.join(eventFolderPath, 'event.json');
  const reapplyContext = {
    photographer:     fallbackPhotographer,
    eventName,
    collName,
    hijriDate,
    eventDescription: eventJson?.eventName || null,
    groups,
    diskComponents:   components,
    eventJsonPath:    reapplyEventJsonPath,
  };
  const baseEmit = win
    ? (p) => { if (!win.isDestroyed()) win.webContents.send('metadata:progress', p); }
    : null;
  const emitFn = baseEmit
    ? async (p) => {
        if (p.event === 'batch_complete') {
          await _writeLastMetadataRun(reapplyEventJsonPath, p, reapplyContext.groups);
          await _persistMetadataStateAndCompact(p.batchId, reapplyEventJsonPath);
        }
        baseEmit(p);
      }
    : null;

  exifService.applyBatch(batchId, copiedFiles, reapplyContext, emitFn);

  return { ok: true, batchId };
});

// ── List manager ──────────────────────────────────────────────────────────────

// Event Type / Location / City resolve through the Keyword Registry adapter; all
// other list names (photographers) keep the legacy listManager + aliasEngine path.
ipcMain.handle('lists:get',        (_event, name)                              => (_REG_LIST_CATEGORY[name] ? _registryListData(name) : listManager.getList(name)));
ipcMain.handle('lists:match',      (_event, name, input)                       => (_REG_LIST_CATEGORY[name] ? _registryMatch(name, input) : aliasEngine.match(input, name, listManager.getList(name))));
// Add New for registry-backed fields goes through keywords:addKeyword (the Add New
// Keyword modal) — block the legacy flat write so no parallel vocabulary source is created.
ipcMain.handle('lists:add',        (_event, name, value)                       => (_REG_LIST_CATEGORY[name] ? { success: false, error: 'use-registry-modal' } : listManager.addToList(name, value)));
// Alias learning is not persisted for registry-backed fields yet (safe no-op) — never
// write aliases into the legacy listManager alias files for these fields.
ipcMain.handle('lists:learnAlias', (_event, name, canonicalId, label, typed)   => (_REG_LIST_CATEGORY[name] ? { ok: true, skipped: 'registry-backed' } : aliasEngine.learnAlias(name, canonicalId, label, typed)));

// ── Date engine ──────────────────────────────────────────────────────────────
ipcMain.handle('date:getToday',       ()                   => dateEngine.getToday());
ipcMain.handle('date:toHijri',        (_event, isoDate)    => dateEngine.convertToHijri(isoDate));
ipcMain.handle('date:toGregorian',    (_event, hijri)      => dateEngine.convertToGregorian(hijri));
ipcMain.handle('date:getCalendar',    (_event, year, month)=> dateEngine.getHijriCalendar(year, month));

// ── Audit: event integrity verification (read-only, on-demand) ────────────────
// Counts media files on disk inside the event folder and compares with the
// expected total derived from imports[].counts in event.json.
// Bounded to depth 8 — event archive trees are at most 5 levels deep.
ipcMain.handle('audit:verifyEvent', async (_event, eventPath) => {
  if (!eventPath || typeof eventPath !== 'string') {
    return { ok: false, error: 'Invalid path' };
  }

  let eventJson;
  try {
    const raw = await fsp.readFile(path.join(eventPath, 'event.json'), 'utf8');
    eventJson = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Could not read event.json' };
  }

  const imports = Array.isArray(eventJson?.imports) ? eventJson.imports : [];
  let expectedPhotos = 0;
  let expectedVideos = 0;
  for (const entry of imports) {
    expectedPhotos += Math.max(0, parseInt(entry?.counts?.photos, 10) || 0);
    expectedVideos += Math.max(0, parseInt(entry?.counts?.videos, 10) || 0);
  }
  const expectedTotal = expectedPhotos + expectedVideos;

  const cfg        = require('../config/app.config');
  const MEDIA_EXTS = new Set([...cfg.PHOTO_EXTENSIONS, ...cfg.VIDEO_EXTENSIONS]);
  const VIDEO_EXTS = new Set(cfg.VIDEO_EXTENSIONS);

  let actualPhotos = 0;
  let actualVideos = 0;

  async function countMedia(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        await countMedia(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!MEDIA_EXTS.has(ext)) continue;
        if (VIDEO_EXTS.has(ext)) actualVideos++; else actualPhotos++;
      }
    }
  }

  try {
    await countMedia(eventPath, 0);
  } catch {
    return { ok: false, error: 'Scan failed' };
  }

  const actualTotal = actualPhotos + actualVideos;
  return {
    ok:             true,
    match:          actualTotal === expectedTotal,
    expectedPhotos, expectedVideos, expectedTotal,
    actualPhotos,   actualVideos,   actualTotal,
    delta:          actualTotal - expectedTotal,
  };
});

// ── Window controls ──────────────────────────────────────────────────────────
ipcMain.handle('files:deleteFromSource', async (_event, files, sourceRoot) => {
  if (!Array.isArray(files) || !sourceRoot || typeof sourceRoot !== 'string') {
    return { ok: false, error: 'Invalid arguments' };
  }

  // Resolve symlinks on the root once — fail the whole batch if the root is gone
  let realRoot;
  try {
    realRoot = await fsp.realpath(sourceRoot);
  } catch {
    return { ok: false, error: 'Cannot resolve source root — drive may have been ejected' };
  }

  const results = [];
  for (const f of files) {
    if (!f || typeof f !== 'object') {
      results.push({ src: String(f), deleted: false, error: 'Invalid entry' });
      continue;
    }
    const { src, dest, size, copyVerified } = f;
    if (!src || typeof src !== 'string') {
      results.push({ src: String(src), deleted: false, error: 'Invalid src path' });
      continue;
    }

    // ── Resolve symlinks on the source path ──────────────────────────────────
    let realSrc;
    try {
      realSrc = await fsp.realpath(src);
    } catch {
      results.push({ src, deleted: false, error: 'Source file not found' });
      continue;
    }

    // ── Containment check (after symlink resolution) ─────────────────────────
    if (process.env.DEBUG_SOURCE_CLEANUP) {
      console.log('[CSQ DEBUG] containment:', {
        src, dest, realSrc, realRoot,
        separator: JSON.stringify(path.sep),
        relative: path.relative(realRoot, realSrc),
        passes: PathUtils.isPathUnderRoot(realSrc, realRoot),
      });
    }
    if (!PathUtils.isPathUnderRoot(realSrc, realRoot)) {
      results.push({ src, deleted: false, error: 'Path outside source root' });
      continue;
    }

    // ── Must be a regular file, not a directory or device ────────────────────
    let srcStat;
    try {
      srcStat = await fsp.stat(realSrc);
    } catch {
      results.push({ src, deleted: false, error: 'Cannot stat source file' });
      continue;
    }
    if (!srcStat.isFile()) {
      results.push({ src, deleted: false, error: 'Not a regular file' });
      continue;
    }

    // ── Source file must be unchanged since copy ─────────────────────────────
    if (typeof size === 'number' && srcStat.size !== size) {
      results.push({ src, deleted: false, error: `Source file changed after import (expected ${size}, got ${srcStat.size})` });
      continue;
    }

    // ── Destination revalidation ──────────────────────────────────────────────
    if (!dest || typeof dest !== 'string') {
      results.push({ src, deleted: false, error: 'No destination path provided' });
      continue;
    }
    let destStat;
    try {
      destStat = await fsp.stat(dest);
    } catch {
      results.push({ src, deleted: false, error: 'Destination file not found — cannot confirm import' });
      continue;
    }
    // copyVerified entries may have a larger destination than the original source size
    // because metadata tagging (exiftool) embeds EXIF after copy verification.
    // Only block on destination size mismatch for entries without copy-time verification.
    if (!copyVerified && typeof size === 'number' && destStat.size !== size) {
      results.push({ src, deleted: false, error: `Destination size mismatch (expected ${size}, got ${destStat.size})` });
      continue;
    }
    if (copyVerified && typeof size === 'number' && destStat.size !== size) {
      log(`[sourceCleanup] ${path.basename(src)}: dest size changed after copy (${size} → ${destStat.size}), likely metadata update`);
    }

    // ── All checks passed — delete ────────────────────────────────────────────
    try {
      await fsp.unlink(realSrc);
      log(`[sourceCleanup] Deleted: ${realSrc} | dest: ${dest} | size: ${size ?? 'unknown'}`);
      results.push({ src, deleted: true });
    } catch (err) {
      results.push({ src, deleted: false, error: err.message });
    }
  }

  return { ok: true, results };
});

// ── Media preview URL (read-only) ────────────────────────────────────────────
// Returns a safe file:// URL for JPEG/PNG/MP4/MOV preview.
ipcMain.handle('files:getPreviewUrl', async (_event, srcPath) => {
  if (!srcPath || typeof srcPath !== 'string') return null;
  const { pathToFileURL } = require('url');
  const resolved = path.normalize(srcPath);
  try {
    const st = await fsp.stat(resolved);
    if (!st.isFile()) return null;
    return pathToFileURL(resolved).href;
  } catch { return null; }
});

// ── RAW full-size preview (Phase 2: macOS qlmanage, userData cache) ──────────
ipcMain.handle('preview:getRawPreview', async (_event, srcPath) => {
  const { getRawPreview } = require('./rawPreviewService');
  return getRawPreview(srcPath);
});

// ── Metadata Sync ─────────────────────────────────────────────────────────────

ipcMain.handle('metadataSync:scanPending', async (_event, masterPath, opts) => {
  if (!masterPath || typeof masterPath !== 'string') return [];
  const userDataPath = app.getPath('userData');
  return metadataSyncService.scanPendingEvents(masterPath, userDataPath, opts || {});
});

// ── Metadata scan background job ──────────────────────────────────────────────
// In-memory only — not persisted. One job at a time across all masterPaths.
let _msScanJob = {
  id: null, masterPath: null, state: 'idle',
  startedAt: null, updatedAt: null,
  result: null, errorType: null, errorMessage: null,
};

ipcMain.handle('metadataSync:startScanPending', async (_event, masterPath) => {
  if (!masterPath || typeof masterPath !== 'string') return { ok: false, errorType: 'invalid_path' };
  if (_msScanJob.state === 'running') {
    if (_msScanJob.masterPath === masterPath) return { ok: true, jobId: _msScanJob.id };
    return { ok: false, errorType: 'service_busy' };
  }
  try { await fsp.access(masterPath); } catch { return { ok: false, errorType: 'archive_unavailable' }; }
  const jobId        = `ms-scan-${Date.now().toString(36)}`;
  const userDataPath = app.getPath('userData');
  _msScanJob = { id: jobId, masterPath, state: 'running', startedAt: Date.now(), updatedAt: Date.now(), result: null, errorType: null, errorMessage: null };
  metadataSyncService.scanPendingEvents(masterPath, userDataPath, {})
    .then(pending => {
      if (_msScanJob.id !== jobId) return;
      _msScanJob = { ..._msScanJob, state: 'complete', result: pending, updatedAt: Date.now() };
    })
    .catch(err => {
      if (_msScanJob.id !== jobId) return;
      _msScanJob = { ..._msScanJob, state: 'error', errorType: 'scan_failed', errorMessage: err.message, updatedAt: Date.now() };
    });
  return { ok: true, jobId };
});

ipcMain.handle('metadataSync:getScanPendingStatus', (_event, jobId) => {
  if (!jobId || _msScanJob.id !== jobId) return { state: 'not_found' };
  return {
    id:           _msScanJob.id,
    state:        _msScanJob.state,
    startedAt:    _msScanJob.startedAt,
    updatedAt:    _msScanJob.updatedAt,
    result:       _msScanJob.state === 'complete' ? _msScanJob.result : null,
    errorType:    _msScanJob.errorType,
    errorMessage: _msScanJob.errorMessage,
  };
});

ipcMain.handle('metadataSync:scanEventFolder', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') return [];
  const userDataPath = app.getPath('userData');
  return metadataSyncService.scanSingleEventFolder(eventFolderPath, userDataPath);
});

ipcMain.handle('metadataSync:listEventsInMaster', async (_event, masterPath) => {
  if (!masterPath || typeof masterPath !== 'string') return [];
  return metadataSyncService.listEventsInMaster(masterPath);
});

ipcMain.handle('metadataSync:chooseEventFolder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title:      'Choose Event Folder',
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('metadataSync:syncEvent', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, error: 'Invalid event folder path' };
  }
  const userDataPath = app.getPath('userData');
  return metadataSyncService.syncEventMetadata(eventFolderPath, userDataPath);
});

ipcMain.handle('metadataSync:syncStatus', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') return null;
  return metadataSyncService.getSyncStatus(eventFolderPath);
});

ipcMain.handle('metadataSync:previewEvent', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, error: 'Invalid event folder path' };
  }
  const userDataPath = app.getPath('userData');
  return metadataSyncService.previewEventMetadata(eventFolderPath, userDataPath);
});

ipcMain.handle('keywords:updateFromBridgeTxt', async (_event, filePath, applyChanges) => {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: 'No file path provided' };
  }
  const userDataPath = app.getPath('userData');
  return metadataSyncService.updateRegistryFromBridgeTxt(filePath, userDataPath, applyChanges === true);
});

ipcMain.handle('keywords:repairIds', async () => {
  const userDataPath = app.getPath('userData');
  return metadataSyncService.repairOverrideIds(userDataPath);
});

ipcMain.handle('keywords:chooseBridgeTxt', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Bridge Keyword Export (.txt)',
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
    properties: ['openFile'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('keywords:loadRegistry', async () => {
  const userDataPath = app.getPath('userData');
  // Expose the registry to the renderer (label list only — no internal caches)
  const registryPath = require('path').join(__dirname, '..', 'data', 'keywords.registry.json');
  const overridePath  = require('path').join(userDataPath, 'keywords.override.json');
  const result = { base: { groups: [], keywords: [] }, overrides: [] };
  try {
    const raw = await fsp.readFile(registryPath, 'utf8');
    result.base = JSON.parse(raw);
  } catch {}
  try {
    const raw = await fsp.readFile(overridePath, 'utf8');
    result.overrides = JSON.parse(raw).keywords || [];
  } catch {}
  return result;
});

ipcMain.handle('keywords:saveCityCountry', async (_event, cityLabel, countryLabel) => {
  if (!cityLabel || typeof cityLabel !== 'string') return { ok: false };
  if (!countryLabel || typeof countryLabel !== 'string') return { ok: false };
  const userDataPath = app.getPath('userData');
  const overridePath = require('path').join(userDataPath, 'keywords.override.json');
  try {
    const raw  = await fsp.readFile(overridePath, 'utf8');
    const data = JSON.parse(raw);
    const keywords = Array.isArray(data.keywords) ? data.keywords : [];
    const idx  = keywords.findIndex(
      kw => kw.category === 'city' && typeof kw.label === 'string' &&
            kw.label.toLowerCase() === cityLabel.toLowerCase()
    );
    if (idx >= 0) {
      // City already in override file — update or no-op
      if (keywords[idx].country === countryLabel) return { ok: true };
      keywords[idx] = { ...keywords[idx], country: countryLabel, updatedAt: new Date().toISOString() };
    } else {
      // City exists only in the base flat list — create a minimal keyword entry
      // so the association is stored in the single keyword registry source of truth.
      const slug = cityLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const now  = new Date().toISOString();
      keywords.push({
        id:           `city.${slug}`,
        label:        cityLabel,
        category:     'city',
        root:         'city',
        path:         ['03 City', cityLabel],
        parentId:     'city',
        groupLabel:   '03 City',
        depth:        1,
        aliases:      [],
        labelHistory: [],
        status:       'active',
        source:       'city-country-learn',
        country:      countryLabel,
        importedAt:   now,
        updatedAt:    now,
      });
    }
    data.keywords = keywords;
    await fsp.writeFile(overridePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('[keywords:saveCityCountry] failed:', err);
    return { ok: false, reason: err.message };
  }
});

// ── Keyword Registry adapter — single vocabulary source for event fields ────────
// Event Type / Location / City resolve through the Bridge-imported Keyword Registry
// (data/keywords.registry.json + userData/keywords.override.json) instead of the
// legacy listManager JSON files. listManager stays for 'photographers' and as a
// READ-ONLY fallback for the few legacy terms not yet in the registry. New writes
// go ONLY to the registry override via keywords:addKeyword.
const _REG_LIST_CATEGORY = { 'event-types': 'event', 'locations': 'location', 'cities': 'city' };

function _regOverridePath() {
  return require('path').join(app.getPath('userData'), 'keywords.override.json');
}

// Merged keyword array (base + override). Synchronous — used by lists:get / lists:match.
function _loadRegistryKeywords() {
  const registryPath = require('path').join(__dirname, '..', 'data', 'keywords.registry.json');
  let base = {}, ovr = {};
  try { base = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch {}
  try { ovr  = JSON.parse(fs.readFileSync(_regOverridePath(), 'utf8')); } catch {}
  const baseKws = Array.isArray(base.keywords) ? base.keywords : [];
  const ovrKws  = Array.isArray(ovr.keywords)  ? ovr.keywords  : [];
  return [...baseKws, ...ovrKws];
}

// Slug matching renderer/treeAutocomplete.js _slug() so tree-leaf ids, matchList ids
// and the pathMap breadcrumb keys stay consistent (and event.json id format is preserved).
function _regSlug(label) {
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function _regActiveInCategory(category) {
  return _loadRegistryKeywords().filter(
    k => k && k.category === category && k.label && k.status !== 'deleted'
  );
}

// Legacy listManager labels not present in the registry for this category — kept
// selectable (read-only fallback) so nothing the user relied on silently disappears.
function _regLegacyFallbackLabels(name, registryLabels) {
  const have = new Set(registryLabels.map(l => String(l).toLowerCase()));
  let legacy = [];
  try {
    const lm = listManager.getList(name) || [];
    legacy = lm.map(n => (typeof n === 'string' ? n : n.label))
               .filter(l => l && !have.has(String(l).toLowerCase()));
  } catch {}
  const seen = new Set();
  return legacy.filter(l => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Build TreeAutocomplete-shaped data for a registry-backed list name.
function _registryListData(name) {
  const category = _REG_LIST_CATEGORY[name];
  const kws      = _regActiveInCategory(category);

  if (name === 'cities') {
    const labels = kws.map(k => k.label);
    const legacy = _regLegacyFallbackLabels(name, labels);
    const seen = new Set();
    return [...labels, ...legacy].filter(l => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // Tree types: build nested tree from keyword.path, dropping path[0] (category root group).
  const root = new Map();
  for (const k of kws) {
    const segs = Array.isArray(k.path) ? k.path.slice(1) : [];
    if (segs.length === 0) continue;
    let level = root;
    for (const seg of segs) {
      if (!level.has(seg)) level.set(seg, { label: seg, _ch: new Map() });
      level = level.get(seg)._ch;
    }
  }
  const toArr = (m) => [...m.values()].map(n => {
    const children = toArr(n._ch);
    return children.length ? { label: n.label, children } : { label: n.label };
  });
  const tree = toArr(root);

  // Read-only fallback for legacy listManager terms not in the registry, grouped clearly.
  const registryLabels = [];
  (function collect(nodes) { for (const n of nodes) { registryLabels.push(n.label); if (n.children) collect(n.children); } })(tree);
  const legacy = _regLegacyFallbackLabels(name, registryLabels);
  if (legacy.length) {
    tree.push({ label: 'Other (legacy — read-only)', children: legacy.map(l => ({ label: l })) });
  }
  return tree;
}

// Registry-backed match for lists:match. Returns [{ id, label, matchType, score }].
function _registryMatch(name, input) {
  const q = String(input || '').trim().toLowerCase();
  if (!q) return [];
  const category = _REG_LIST_CATEGORY[name];
  const kws      = _regActiveInCategory(category);

  const seen = new Set();
  const out  = [];
  const push = (label, matchType, score) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: _regSlug(label), label, matchType, score });
  };
  for (const k of kws) {
    const lo = k.label.toLowerCase();
    if (lo === q)                    push(k.label, 'exact', 100);
    else if (lo.startsWith(q))       push(k.label, 'startsWith', 70);
    else if (lo.includes(q))         push(k.label, 'contains', 50);
    else if (Array.isArray(k.aliases) && k.aliases.some(a => String(a).toLowerCase().includes(q)))
                                     push(k.label, 'alias', 40);
  }
  // Legacy fallback terms participate in search too (read-only).
  const registryLabels = kws.map(k => k.label);
  for (const label of _regLegacyFallbackLabels(name, registryLabels)) {
    const lo = label.toLowerCase();
    if (lo === q)              push(label, 'exact', 100);
    else if (lo.startsWith(q)) push(label, 'startsWith', 70);
    else if (lo.includes(q))   push(label, 'contains', 50);
  }
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return out.slice(0, 50);
}

// Add a new keyword to the registry override under an explicitly chosen parent path.
// params: { label, parentId, parentPath:[...], category }
ipcMain.handle('keywords:addKeyword', async (_event, params) => {
  try {
    const label      = (params?.label || '').trim();
    const parentPath = Array.isArray(params?.parentPath) ? params.parentPath.filter(Boolean) : null;
    const parentId   = (params?.parentId || '').trim();
    const category   = (params?.category || '').trim();
    if (!label)               return { ok: false, reason: 'empty-label' };
    if (!category)            return { ok: false, reason: 'no-category' };
    if (!parentPath || parentPath.length === 0) return { ok: false, reason: 'no-parent-path' };

    const overridePath = _regOverridePath();
    let data = { version: 1, keywords: [] };
    try { data = JSON.parse(fs.readFileSync(overridePath, 'utf8')); } catch {}
    if (!Array.isArray(data.keywords)) data.keywords = [];

    const all = _loadRegistryKeywords();
    const newPath = [...parentPath, label];
    const newPathKey = newPath.join('›').toLowerCase();

    // Duplicate check: same label (or alias) already under the same parent path / category branch.
    const dup = all.find(k => {
      if (k.category !== category) return false;
      const sameLabel = (k.label || '').toLowerCase() === label.toLowerCase();
      const aliasHit  = Array.isArray(k.aliases) && k.aliases.some(a => String(a).toLowerCase() === label.toLowerCase());
      const samePath  = Array.isArray(k.path) && k.path.join('›').toLowerCase() === newPathKey;
      return samePath || ((sameLabel || aliasHit) && Array.isArray(k.path) &&
             k.path.slice(0, parentPath.length).join('›').toLowerCase() === parentPath.join('›').toLowerCase());
    });
    if (dup) return { ok: false, reason: 'duplicate', existingLabel: dup.label };

    const root  = category;
    const depth = parentPath.length;
    const slug  = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    let   id    = `${root}.${slug}`;
    if (all.some(k => k.id === id)) id = `${root}.${slug}_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    data.keywords.push({
      id, label, category, root,
      path:         newPath,
      parentId:     parentId || root,
      groupLabel:   parentPath[0],
      depth,
      aliases:      [],
      labelHistory: [],
      status:       'active',
      source:       'manual-add',
      importedAt:   now,
      updatedAt:    now,
    });

    const tmp = overridePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, overridePath);
    return { ok: true, id, label, category, path: newPath };
  } catch (err) {
    console.error('[keywords:addKeyword] failed:', err);
    return { ok: false, reason: err.message };
  }
});

// ── Transfer Export ───────────────────────────────────────────────────────────

ipcMain.handle('archive:chooseTransferRoot', async () => {
  const win    = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      'Choose Transfer Drive',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return null;
  await settings.setTransferRoot(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('archive:getTransferRoot', () => settings.getTransferRoot());

ipcMain.handle('archive:validateTransferRoot', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { valid: false, reason: 'not-set' };
  // Phase 1: confirm directory exists and is reachable
  try {
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return { valid: false, reason: 'not-directory' };
  } catch {
    return { valid: false, reason: 'offline' };
  }
  // Phase 2: read transfer marker — missing marker means uninitialized, not invalid
  const markerPath = path.join(dirPath, '.autoingest-transfer', 'transfer-root.json');
  try {
    const raw    = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (!marker || marker.type !== 'autoingest-transfer-root') {
      return { valid: false, reason: 'metadata-invalid' };
    }
    return { valid: true, initialized: true, deviceName: marker.deviceName || null };
  } catch (err) {
    if (err.code === 'ENOENT') return { valid: true, initialized: false, reason: 'uninitialized' };
    if (err.code === 'EACCES' || err.code === 'EPERM') return { valid: false, reason: 'no-access' };
    return { valid: false, reason: 'metadata-invalid' };
  }
});

ipcMain.handle('archive:getTransferExportTree', async () => {
  const nasRoot = settings.getNasRoot();
  if (!nasRoot) return { ok: false, reason: 'nas-not-set' };
  return transferExportService.scanExportTree(nasRoot);
});

ipcMain.handle('archive:previewTransferExport', async (_event, { scope } = {}) => {
  const isCustom     = scope?.sourceMode === 'custom';
  const nasRoot      = isCustom ? scope.customSrcRoot  : settings.getNasRoot();
  const transferRoot = isCustom ? scope.customDestRoot : settings.getTransferRoot();
  if (isCustom && (!nasRoot || !transferRoot)) return { ok: false, reason: 'custom-paths-not-set' };
  if (!isCustom && !nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!isCustom && !transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.previewExport(nasRoot, transferRoot, scope);
});

// Read-only pre-copy backup sync scan: classify source vs external-drive backup by
// relative path (new / existing-same / changed / incomplete / destination-only / error).
// Filesystem comparison is the source of truth — works across devices, no userData dependency.
ipcMain.handle('archive:scanBackupSync', async (_event, { scope } = {}) => {
  const isCustom     = scope?.sourceMode === 'custom';
  const nasRoot      = isCustom ? scope.customSrcRoot  : settings.getNasRoot();
  const transferRoot = isCustom ? scope.customDestRoot : settings.getTransferRoot();
  if (isCustom && (!nasRoot || !transferRoot)) return { ok: false, reason: 'custom-paths-not-set' };
  if (!isCustom && !nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!isCustom && !transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.scanBackupSync(nasRoot, transferRoot, scope);
});

ipcMain.handle('archive:runTransferExport', async (_event, { scope, operatorName } = {}) => {
  const isCustom     = scope?.sourceMode === 'custom';
  const nasRoot      = isCustom ? scope.customSrcRoot  : settings.getNasRoot();
  const transferRoot = isCustom ? scope.customDestRoot : settings.getTransferRoot();
  if (isCustom && (!nasRoot || !transferRoot)) return { ok: false, reason: 'custom-paths-not-set' };
  if (!isCustom && !nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!isCustom && !transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.runExport(nasRoot, transferRoot, scope, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
  });
});

ipcMain.handle('archive:chooseCustomSrcFolder', async () => {
  const win    = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      'Choose Source Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('archive:chooseCustomDestFolder', async () => {
  const win    = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title:      'Choose Destination Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('archive:renameFolderOnTransferDrive', async (_event, { destAbsPath, newName } = {}) => {
  const transferRoot = settings.getTransferRoot();
  if (!transferRoot)           return { ok: false, reason: 'transfer-root-not-set' };
  if (!destAbsPath || !newName) return { ok: false, reason: 'invalid-args' };
  // Safety: destAbsPath must be inside transferRoot.
  let realTransfer, realDest;
  try { realTransfer = await fsp.realpath(transferRoot); } catch { realTransfer = transferRoot; }
  try { realDest     = await fsp.realpath(destAbsPath);  } catch { realDest     = destAbsPath;  }
  if (!PathUtils.isPathUnderRoot(realDest, realTransfer)) return { ok: false, reason: 'outside-transfer-root' };
  // Target path must not already exist.
  const newPath = path.join(path.dirname(destAbsPath), newName);
  try { await fsp.access(newPath); return { ok: false, reason: 'target-already-exists' }; } catch {}
  try {
    await fsp.rename(destAbsPath, newPath);
    return { ok: true, newPath };
  } catch (e) {
    return { ok: false, reason: 'rename-failed', error: e.message };
  }
});

ipcMain.handle('archive:getTransferExportStatus', () => transferExportService.getExportStatus());

ipcMain.handle('archive:pauseTransferExport',  () => transferExportService.pauseExport());
ipcMain.handle('archive:resumeTransferExport', () => transferExportService.resumeExport());

ipcMain.handle('archive:getTransferExportCheckpoint', async () => {
  const transferRoot = settings.getTransferRoot();
  if (!transferRoot) return null;
  return transferExportService.getExportCheckpoint(transferRoot);
});

ipcMain.handle('archive:clearTransferExportCheckpoint', async () => {
  const transferRoot = settings.getTransferRoot();
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.clearExportCheckpoint(transferRoot);
});

ipcMain.handle('archive:resumeTransferExportFromCheckpoint', async (_event, { operatorName } = {}) => {
  const nasRoot      = settings.getNasRoot();
  const transferRoot = settings.getTransferRoot();
  if (!nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.resumeExportFromCheckpoint(nasRoot, transferRoot, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
  });
});

ipcMain.handle('archive:validateCustomExportSource', async (_event, { customSrcRoot, customDestRoot } = {}) => {
  if (!customSrcRoot || !customDestRoot) return { ok: false, reason: 'missing-paths' };
  return transferExportService.validateCustomExportSource(customSrcRoot, customDestRoot);
});

ipcMain.handle('archive:getCustomTransferExportCheckpoint', async (_event, { customDestRoot } = {}) => {
  if (!customDestRoot) return null;
  return transferExportService.getExportCheckpoint(customDestRoot);
});

ipcMain.handle('archive:clearCustomTransferExportCheckpoint', async (_event, { customDestRoot } = {}) => {
  if (!customDestRoot) return { ok: false, reason: 'custom-dest-not-set' };
  return transferExportService.clearExportCheckpoint(customDestRoot);
});

ipcMain.handle('archive:resumeCustomTransferExportFromCheckpoint', async (_event, { customSrcRoot, customDestRoot, operatorName } = {}) => {
  if (!customSrcRoot || !customDestRoot) return { ok: false, reason: 'custom-paths-not-set' };
  return transferExportService.resumeExportFromCheckpoint(customSrcRoot, customDestRoot, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
  });
});

ipcMain.handle('archive:verifyTransferExport', async (_event, { scope } = {}) => {
  const nasRoot      = settings.getNasRoot();
  const transferRoot = settings.getTransferRoot();
  if (!nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.verifyExport(nasRoot, transferRoot, scope);
});

// ── Transfer Import ───────────────────────────────────────────────────────────

ipcMain.handle('archive:getTransferImportTree', async () => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJson);
});

ipcMain.handle('archive:previewTransferImport', async (_event, { scope } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJson);
});

// Read-only pre-copy scan: classify the selected Transfer Drive scope against the Main
// Archive Root by relative path + size (new / already-imported / changed / unresolved).
ipcMain.handle('archive:scanImportSync', async (_event, { scope } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.scanImportSync(transferRoot, mainArchiveRoot, scope, isValidEventJson);
});

ipcMain.handle('archive:runTransferImport', async (_event, { scope, operatorName } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJson, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
    onComplete: (result) => {
      if (result?.ok && result.batchId) {
        _verifyTransferBatch(mainArchiveRoot, result.batchId).catch(err =>
          log(`[main] Transfer metadata verification orchestration failed: ${err.message}`));
      }
    },
  });
});

ipcMain.handle('archive:getTransferImportStatus', () => transferImportService.getImportStatus());

ipcMain.handle('archive:pauseTransferImport',  () => transferImportService.pauseImport());
ipcMain.handle('archive:resumeTransferImport', () => transferImportService.resumeImport());

ipcMain.handle('archive:getTransferImportCheckpoint', async () => {
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!mainArchiveRoot) return null;
  return transferImportService.getImportCheckpoint(mainArchiveRoot);
});

ipcMain.handle('archive:clearTransferImportCheckpoint', async () => {
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.clearImportCheckpoint(mainArchiveRoot);
});

ipcMain.handle('archive:resumeTransferImportFromCheckpoint', async (_event, { operatorName } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.resumeImportFromCheckpoint(transferRoot, mainArchiveRoot, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
    onComplete: (result) => {
      if (result?.ok && result.batchId) {
        _verifyTransferBatch(mainArchiveRoot, result.batchId).catch(err =>
          log(`[main] Transfer metadata verification orchestration failed: ${err.message}`));
      }
    },
  });
});

ipcMain.handle('archive:verifyTransferImport', async (_event, { scope } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.verifyImport(transferRoot, mainArchiveRoot, scope, isValidEventJson);
});

// ── Archive Diagnostics (Phase 13A — read-only) ───────────────────────────────

ipcMain.handle('archive:runDiagnostics',       async (_event, { scope } = {}) => archiveDiagnosticsService.runDiagnostics(scope));
ipcMain.handle('archive:getDiagnosticsStatus', ()                              => archiveDiagnosticsService.getDiagnosticsStatus());
ipcMain.handle('archive:getDiagnosticsReport', ()                              => archiveDiagnosticsService.getDiagnosticsReport());

// ── Metadata Audit (Phase E — read-only, scope always explicit, never auto-scans) ──

ipcMain.handle('archive:runMetadataAudit', async (_event, { scope } = {}) => {
  if (!scope || !scope.type) return { ok: false, reason: 'invalid-scope' };
  // 'archiveRoot' with no explicit rootPath resolves to the configured Main Archive
  // Root server-side — the renderer's "Main Archive Root" option never guesses a path.
  let rootPath = scope.rootPath;
  if (!rootPath && scope.type === 'archiveRoot') rootPath = settings.getMainArchiveRoot();
  if (!rootPath) return { ok: false, reason: 'invalid-scope' };
  return metadataAuditService.runMetadataAudit({ ...scope, rootPath });
});
ipcMain.handle('archive:resumeMetadataAudit',  async (_event, { jobId } = {}) => metadataAuditService.resumeMetadataAudit(jobId));
ipcMain.handle('archive:cancelMetadataAudit',  (_event, { jobId } = {})       => metadataAuditService.cancelMetadataAudit(jobId));
ipcMain.handle('archive:getMetadataAuditStatus', async (_event, { jobId } = {}) => metadataAuditService.getMetadataAuditStatus(jobId));
ipcMain.handle('archive:getMetadataAuditReport', async (_event, { jobId, offset, limit, statusFilter } = {}) =>
  metadataAuditService.getMetadataAuditReport(jobId, { offset, limit, statusFilter }));

ipcMain.handle('archive:exportMetadataAuditReport', async (_event, { jobId, format, exceptionsOnly } = {}) => {
  const win = BrowserWindow.getFocusedWindow();
  const ext = format === 'csv' ? 'csv' : (format === 'jsonl' ? 'jsonl' : 'json');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Metadata Audit Report',
    defaultPath: `metadata-audit-${jobId}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false, reason: 'cancelled' };
  return metadataAuditExport.exportMetadataAuditReport(jobId, { format: format || 'json', destPath: filePath, exceptionsOnly: !!exceptionsOnly });
});

ipcMain.handle('archive:chooseMetadataAuditFolder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose Audit Scope Folder',
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

// ── Metadata Repair (Phase F — consumes an audit's frozen snapshot only) ───────

ipcMain.handle('archive:previewMetadataRepair', async (_event, { auditJobId } = {}) => metadataRepairService.previewMetadataRepair(auditJobId));
ipcMain.handle('archive:runMetadataRepair',     async (_event, { auditJobId } = {}) => metadataRepairService.runMetadataRepair(auditJobId));
ipcMain.handle('archive:getMetadataRepairResult', async (_event, { batchId } = {}) => metadataRepairService.getMetadataRepairResult(batchId));

// ── Archive Diagnostics — Stale Lock Release (Phase 13B-1) ───────────────────

ipcMain.handle('archive:releaseStaleLock', async (_event, { lockPath } = {}) => {
  if (!lockPath || typeof lockPath !== 'string') return { ok: false, reason: 'invalid-path' };
  const nas  = settings.getNasRoot();
  const main = settings.getMainArchiveRoot();
  const configuredRoots = [nas, main].filter(Boolean);
  if (configuredRoots.length === 0) return { ok: false, reason: 'no-configured-roots' };
  return archiveLockService.releaseStaleLock(lockPath, configuredRoots);
});

// ── Sync Issue Review (Phase 13B-3) ──────────────────────────────────────────

ipcMain.handle('archive:markSyncIssueReviewed', async (_event, { jobId, batchId, manifestPath, reason } = {}) => {
  if (!jobId || typeof jobId !== 'string') return { ok: false, reason: 'invalid-jobId' };
  const localStagingRoot = settings.getLocalStagingRoot();
  if (!localStagingRoot) return { ok: false, reason: 'no-staging-root' };
  return syncReviewService.markReviewed({ jobId, batchId, manifestPath, reason, localStagingRoot });
});

ipcMain.handle('archive:getSyncIssueReviews', async () => syncReviewService.getReviews());

// ── Adoption Preview (Phase 13C-1 — read-only) ───────────────────────────────

ipcMain.handle('archive:runAdoptionPreview',       async (_event, { scope } = {}) => adoptionPreviewService.runAdoptionPreview(scope));
ipcMain.handle('archive:getAdoptionPreviewStatus', ()                              => adoptionPreviewService.getAdoptionPreviewStatus());
ipcMain.handle('archive:getAdoptionPreviewReport', ()                              => adoptionPreviewService.getAdoptionPreviewReport());

// ── Adoption Dry-run Validation (Phase 13C-5 — read-only) ────────────────────

ipcMain.handle('archive:dryRunAdoptionCandidate', async (_event, params = {}) => {
  const { folderPath, collectionPath, rootType, candidateId } = params;
  if (!folderPath     || typeof folderPath     !== 'string') return { ok: false, reason: 'invalid-params' };
  if (!collectionPath || typeof collectionPath !== 'string') return { ok: false, reason: 'invalid-params' };
  return adoptionDryRunService.runAdoptionDryRun({ folderPath, collectionPath, rootType, candidateId });
});

// ── Adoption Write (Phase 13C-7) ──────────────────────────────────────────────

ipcMain.handle('archive:adoptManualFolder', async (_event, input = {}) => {
  const { folderPath, collectionPath } = input;
  if (!folderPath     || typeof folderPath     !== 'string') return { ok: false, reason: 'invalid-params' };
  if (!collectionPath || typeof collectionPath !== 'string') return { ok: false, reason: 'invalid-params' };
  const activeUser = userManager.getActiveUser();
  return adoptionWriteService.adoptFolder(input, isValidEventJson, activeUser);
});

// ── Archive Diagnostics — Temp File Cleanup (Phase 13B-2) ────────────────────

ipcMain.handle('archive:cleanupTempFile', async (_event, { tempPath } = {}) => {
  if (!tempPath || typeof tempPath !== 'string') return { ok: false, reason: 'invalid-path' };
  const nas   = settings.getNasRoot();
  const local = settings.getLocalStagingRoot();
  const tx    = settings.getTransferRoot();
  const main  = settings.getMainArchiveRoot();
  const configuredRoots = [nas, local, tx, main].filter(Boolean);
  if (configuredRoots.length === 0) return { ok: false, reason: 'outside-configured-root' };
  return archiveRepairService.cleanupTempFile(tempPath, configuredRoots);
});

// ── Archive Consistency Report (Phase 13D-1 — read-only) ─────────────────────

ipcMain.handle('archive:generateConsistencyReport', async () =>
  archiveConsistencyService.generateReport());

ipcMain.handle('archive:getConsistencyReport', () =>
  archiveConsistencyService.getLastReport());

// ── Archive Completeness Checklist (Phase 13D-3 — read-only) ─────────────────

ipcMain.handle('archive:generateCompletenessChecklist', async () =>
  archiveCompletenessService.generateChecklist());

ipcMain.handle('archive:getCompletenessChecklist', () =>
  archiveCompletenessService.getLastChecklist());

// ── Archive Audit Timeline (Phase 13D-5 — read-only) ─────────────────────────

ipcMain.handle('archive:generateAuditTimeline', async () =>
  archiveAuditTimelineService.generateTimeline());

ipcMain.handle('archive:getAuditTimeline', () =>
  archiveAuditTimelineService.getLastTimeline());

// ── Offline Collection Registry ───────────────────────────────────────────────
// Manages collection.link.json — the authoritative staging-collection-to-NAS
// link file. Advisory soft-conflict warnings are still handled by the realtime
// layer; this layer enforces the hard sync block for provisional collections.

ipcMain.handle('collection:prepareOffline', async (_event, { nasCollectionPath, collectionName } = {}) => {
  if (!nasCollectionPath || typeof nasCollectionPath !== 'string') {
    return { ok: false, reason: 'nasCollectionPath required' };
  }
  if (!collectionName || typeof collectionName !== 'string') {
    return { ok: false, reason: 'collectionName required' };
  }

  const nasRoot     = settings.getNasRoot();
  const stagingRoot = settings.getLocalStagingRoot();
  if (!nasRoot)     return { ok: false, reason: 'Active Archive Root not configured' };
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root not configured' };

  // nasCollectionPath must be inside the current nasRoot
  const realNasRoot = path.resolve(nasRoot);
  const realNasColl = path.resolve(nasCollectionPath);
  if (!PathUtils.isPathUnderOrEqualToRoot(realNasColl, realNasRoot)) {
    return { ok: false, reason: 'nasCollectionPath is outside the configured Archive Root' };
  }

  // Verify NAS is accessible right now
  try { await fsp.access(nasCollectionPath); } catch {
    return { ok: false, reason: 'NAS collection path is not accessible — archive may be offline' };
  }

  const localCollectionPath = path.join(stagingRoot, collectionName);
  await fsp.mkdir(localCollectionPath, { recursive: true });

  const deviceId = settings.getDeviceId ? settings.getDeviceId() : null;
  const result   = await offlineCollectionRegistry.writeLink(localCollectionPath, {
    collectionName,
    nasRoot:                    nasRoot,
    nasCollectionPath:          nasCollectionPath,
    localStagingCollectionPath: localCollectionPath,
    preparedAt:                 Date.now(),
    deviceId,
    operator:                   null,
    status:                     'linked',
  });

  return { ok: result.ok, localCollectionPath, reason: result.reason };
});

ipcMain.handle('collection:readLink', async (_event, { localCollectionPath } = {}) => {
  if (!localCollectionPath || typeof localCollectionPath !== 'string') {
    return { ok: false, reason: 'localCollectionPath required' };
  }
  const stagingRoot = settings.getLocalStagingRoot();
  if (stagingRoot) {
    if (!PathUtils.isPathUnderRoot(path.resolve(localCollectionPath), path.resolve(stagingRoot))) {
      return { ok: false, reason: 'localCollectionPath is outside staging root' };
    }
  }
  const nasRoot  = settings.getNasRoot();
  let   nasOnline = false;
  if (nasRoot) { try { await fsp.access(nasRoot); nasOnline = true; } catch { /* offline */ } }
  const { ok, link, reason } = await offlineCollectionRegistry.readLink(localCollectionPath);
  const linkStatus = offlineCollectionRegistry.deriveStatus(ok ? link : null, nasRoot, nasOnline);
  return { ok, link: ok ? link : null, linkStatus, reason };
});

ipcMain.handle('collection:matchToNas', async (_event, { localCollectionPath, nasCollectionPath } = {}) => {
  if (!localCollectionPath || !nasCollectionPath) {
    return { ok: false, reason: 'localCollectionPath and nasCollectionPath required' };
  }
  const nasRoot = settings.getNasRoot();
  if (!nasRoot) return { ok: false, reason: 'Active Archive Root not configured' };

  const realNasRoot = path.resolve(nasRoot);
  const realNasColl = path.resolve(nasCollectionPath);
  if (!PathUtils.isPathUnderOrEqualToRoot(realNasColl, realNasRoot)) {
    return { ok: false, reason: 'nasCollectionPath is outside the configured Archive Root' };
  }

  const collectionName = path.basename(localCollectionPath);
  const { ok: hasLink, link: existing } = await offlineCollectionRegistry.readLink(localCollectionPath);

  const deviceId = settings.getDeviceId ? settings.getDeviceId() : null;
  const result   = await offlineCollectionRegistry.writeLink(localCollectionPath, {
    collectionName:             existing?.collectionName || collectionName,
    nasRoot,
    nasCollectionPath,
    localStagingCollectionPath: localCollectionPath,
    preparedAt:                 (hasLink && existing?.preparedAt) ? existing.preparedAt : Date.now(),
    deviceId:                   (hasLink && existing?.deviceId)   ? existing.deviceId   : deviceId,
    operator:                   (hasLink && existing?.operator)   ? existing.operator   : null,
    status:                     'linked',
  });

  if (result.ok) {
    // Emit registry update so other devices see the NAS target. Use the registryId
    // already stored in collection.link.json if this collection was prepared from registry.
    const collName        = existing?.collectionName || collectionName;
    const existingRegId   = hasLink && existing?.registryId ? existing.registryId : null;
    realtimeOps.emitRegistryCollection({
      registryId:          existingRegId || `coll:${collName}`,
      collectionName:      collName,
      nasRoot,
      nasCollectionPath,
      origin:              'archive-available',
      createdByDeviceName: settings.getDeviceDisplayName() || null,
    });
  }

  return { ok: result.ok, reason: result.reason };
});

ipcMain.handle('collection:listProvisional', async () => {
  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root not configured', collections: [] };
  let entries;
  try { entries = await fsp.readdir(stagingRoot, { withFileTypes: true }); } catch {
    return { ok: false, reason: 'Cannot read staging root', collections: [] };
  }
  const provisional = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || _NAS_SKIP_DIRS.has(e.name)) continue;
    const collPath = path.join(stagingRoot, e.name);
    const { ok, link } = await offlineCollectionRegistry.readLink(collPath);
    if (ok && link?.status === 'provisional') {
      provisional.push({ name: e.name, localCollectionPath: collPath });
    }
  }
  return { ok: true, collections: provisional };
});

ipcMain.handle('collection:writeProvisionalLink', async (_event, { localCollectionPath, collectionName, operator } = {}) => {
  if (!localCollectionPath || typeof localCollectionPath !== 'string') {
    return { ok: false, reason: 'localCollectionPath required' };
  }
  const stagingRoot = settings.getLocalStagingRoot();
  if (stagingRoot) {
    if (!PathUtils.isPathUnderRoot(path.resolve(localCollectionPath), path.resolve(stagingRoot))) {
      return { ok: false, reason: 'localCollectionPath is outside staging root' };
    }
  }
  const deviceId = settings.getDeviceId ? settings.getDeviceId() : null;
  const result   = await offlineCollectionRegistry.writeLink(localCollectionPath, {
    collectionName:             collectionName || path.basename(localCollectionPath),
    nasRoot:                    null,
    nasCollectionPath:          null,
    localStagingCollectionPath: localCollectionPath,
    preparedAt:                 Date.now(),
    deviceId,
    operator:                   operator || null,
    status:                     'provisional',
  });
  return { ok: result.ok, reason: result.reason };
});

// ── Online Collection/Event Registry ─────────────────────────────────────────
// Advisory registry sourced from realtime service. All preparation actions
// write to local staging only — no authoritative files are touched by registry.

ipcMain.handle('registry:getAll', () => {
  return { ok: true, entries: realtimeOps.getRegistry() };
});

ipcMain.handle('collection:prepareFromRegistry', async (_event, { entry } = {}) => {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: 'Invalid registry entry' };
  }
  const { collectionName, nasCollectionPath, registryId } = entry;
  if (!collectionName || typeof collectionName !== 'string') {
    return { ok: false, reason: 'collectionName required' };
  }

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root not configured' };

  const localCollectionPath = path.join(stagingRoot, collectionName);
  try {
    await fsp.mkdir(localCollectionPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Failed to create collection folder: ${err.message}` };
  }

  // Validate nasCollectionPath against current nasRoot to prevent path traversal
  const nasRoot = settings.getNasRoot();
  let validatedNasPath = null;
  if (nasCollectionPath && typeof nasCollectionPath === 'string' && nasRoot) {
    const realNasRoot = path.resolve(nasRoot);
    const realNasColl = path.resolve(nasCollectionPath);
    if (PathUtils.isPathUnderOrEqualToRoot(realNasColl, realNasRoot)) {
      validatedNasPath = nasCollectionPath;
    }
  }

  const hasNasTarget = !!validatedNasPath;
  const deviceId     = settings.getDeviceId ? settings.getDeviceId() : null;

  // Preserve an existing confirmed link — registry data must not overwrite a
  // previously matched or prepared target (prevents cross-site link corruption).
  const { ok: _priorOk, link: _priorLink } = await offlineCollectionRegistry.readLink(localCollectionPath);
  if (_priorOk && _priorLink && _priorLink.status === 'linked' && _priorLink.nasCollectionPath) {
    return { ok: true, localCollectionPath };
  }

  const result = await offlineCollectionRegistry.writeLink(localCollectionPath, {
    collectionName,
    registryId:                 registryId || null,
    nasRoot:                    hasNasTarget ? nasRoot : null,
    nasCollectionPath:          validatedNasPath,
    localStagingCollectionPath: localCollectionPath,
    preparedAt:                 Date.now(),
    deviceId,
    operator:                   null,
    status:                     hasNasTarget ? 'linked' : 'provisional',
  });

  return { ok: result.ok, localCollectionPath, reason: result.reason };
});

ipcMain.handle('event:prepareFromRegistry', async (_event, { entry } = {}) => {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: 'Invalid registry entry' };
  }
  const { collectionName, eventFolderName, eventJsonShell, nasCollectionPath, registryId } = entry;
  if (!collectionName || typeof collectionName !== 'string') {
    return { ok: false, reason: 'collectionName required' };
  }
  if (!eventFolderName || typeof eventFolderName !== 'string') {
    return { ok: false, reason: 'eventFolderName required' };
  }
  if (!eventJsonShell || typeof eventJsonShell !== 'object') {
    return { ok: false, reason: 'missing-event-shell', message: 'This item cannot be prepared yet because event details are missing from the registry.' };
  }
  if (!isValidEventJson(eventJsonShell)) {
    return { ok: false, reason: 'invalid-event-shell', message: 'This item cannot be prepared yet because event details are incomplete or invalid.' };
  }

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root not configured' };

  const localCollectionPath = path.join(stagingRoot, collectionName);
  const localEventPath      = path.join(localCollectionPath, eventFolderName);

  try {
    await fsp.mkdir(localCollectionPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Failed to create collection folder: ${err.message}` };
  }

  // Validate nasCollectionPath
  const nasRoot = settings.getNasRoot();
  let validatedNasPath = null;
  if (nasCollectionPath && typeof nasCollectionPath === 'string' && nasRoot) {
    const realNasRoot = path.resolve(nasRoot);
    const realNasColl = path.resolve(nasCollectionPath);
    if (PathUtils.isPathUnderOrEqualToRoot(realNasColl, realNasRoot)) {
      validatedNasPath = nasCollectionPath;
    }
  }
  const hasNasTarget = !!validatedNasPath;
  const deviceId     = settings.getDeviceId ? settings.getDeviceId() : null;

  // Write collection.link.json only when no confirmed link exists — event-level
  // registry data must not demote a linked collection to provisional, and must
  // not silently rewrite the NAS target with a cross-site path.
  const { ok: _priorOk2, link: _priorLink2 } = await offlineCollectionRegistry.readLink(localCollectionPath);
  if (!(_priorOk2 && _priorLink2 && _priorLink2.status === 'linked' && _priorLink2.nasCollectionPath)) {
    await offlineCollectionRegistry.writeLink(localCollectionPath, {
      collectionName,
      registryId:                 registryId || null,
      nasRoot:                    hasNasTarget ? nasRoot : null,
      nasCollectionPath:          validatedNasPath,
      localStagingCollectionPath: localCollectionPath,
      preparedAt:                 Date.now(),
      deviceId,
      operator:                   null,
      status:                     hasNasTarget ? 'linked' : 'provisional',
    });
  }

  try {
    await fsp.mkdir(localEventPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Failed to create event folder: ${err.message}` };
  }

  // Write event.json — no-overwrite if already exists
  const jsonPath = path.join(localEventPath, 'event.json');
  try {
    await fsp.access(jsonPath);
    return { ok: true, alreadyExisted: true, localCollectionPath, localEventPath };
  } catch { /* ENOENT — proceed */ }

  const shell = {
    version:      eventJsonShell.version || 1,
    hijriDate:    eventJsonShell.hijriDate,
    sequence:     typeof eventJsonShell.sequence === 'number' ? eventJsonShell.sequence : parseInt(eventJsonShell.sequence, 10),
    eventName:    eventJsonShell.eventName,
    safeEventName:eventJsonShell.safeEventName || eventJsonShell.eventName,
    status:       'created',
    components:   eventJsonShell.components,
    updatedAt:    Date.now(),
  };

  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(shell, null, 2), 'utf8');
    await fsp.rename(tmp, jsonPath);
    hidePathBestEffort(jsonPath).catch(() => {});
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    return { ok: false, reason: `Failed to write event.json: ${err.message}` };
  }

  return { ok: true, alreadyExisted: false, localCollectionPath, localEventPath };
});

// ── Realtime Operations Layer ─────────────────────────────────────────────────
// Advisory live-awareness layer. Never writes event.json, sync manifests,
// archive folders, metadata files, or any authoritative state.

ipcMain.handle('realtime:getStatus', () => realtimeOps.getStatus());

ipcMain.handle('realtime:getSettings', () => ({
  enabled:   settings.getRealtimeEnabled(),
  serverUrl: settings.getRealtimeServerUrl(),
  serverKey: settings.getRealtimeServerKey(),
}));

ipcMain.handle('realtime:testConnection', async (_event, { serverUrl, serverKey } = {}) => {
  if (!serverUrl || typeof serverUrl !== 'string') return { ok: false };
  let sioClient;
  try { sioClient = require('socket.io-client'); } catch { return { ok: false }; }
  return new Promise((resolve) => {
    let resolved = false;
    const done = (ok, reason) => {
      if (resolved) return;
      resolved = true;
      resolve(reason ? { ok, reason } : { ok });
    };
    const timer = setTimeout(() => {
      sock.disconnect();
      done(false);
    }, 7000);
    const sock = sioClient(serverUrl, {
      auth:         { serverKey: serverKey || '' },
      reconnection: false,
      timeout:      6000,
      transports:   ['websocket', 'polling'],
    });
    sock.on('connect', () => {
      clearTimeout(timer);
      // Wait for the server-side disconnect to complete before resolving,
      // so the server processes the close cleanly rather than seeing a ping timeout.
      sock.once('disconnect', () => done(true));
      sock.disconnect();
      // Safety fallback: resolve after 500 ms if disconnect event is delayed.
      setTimeout(() => done(true), 500);
    });
    sock.on('connect_error', (err) => {
      clearTimeout(timer);
      sock.disconnect();
      if (err?.message === 'auth-failed') done(false, 'auth-failed');
      else done(false);
    });
  });
});

ipcMain.handle('realtime:getKnownNames', () => realtimeOps.getKnownNames());

// Team Live activity reporting (advisory only — never writes authoritative files).
// Renderer calls this when navigating to an event (viewing) or to report live state.
ipcMain.handle('team:reportActivity', (_event, data) => {
  if (!data || typeof data !== 'object') return { ok: false };
  const { mode, collectionName, eventFolderName, status } = data;
  realtimeOps.emitDeviceActivity({ mode, collectionName, eventFolderName, status });
  return { ok: true };
});

ipcMain.handle('realtime:getTeamLiveSnapshot', () => realtimeOps.getTeamLiveSnapshot());
ipcMain.handle('realtime:getSyncSlotStatus',   () => realtimeOps.getSyncSlotStatus());

// App version — renderer uses this for version mismatch display in Team Live.
ipcMain.handle('app:getVersion', () => app.getVersion());

// ── Sync slot coordination IPC (advisory; delegates to realtimeOperationsService) ──
ipcMain.handle('archive:requestSyncSlot', async (_event, jobId) => {
  if (!jobId || typeof jobId !== 'string') return { granted: true, fallback: true };
  try { return await realtimeOps.requestSyncSlot(jobId); }
  catch { return { granted: true, fallback: true }; }
});

ipcMain.handle('archive:releaseSyncSlot', (_event, jobId) => {
  if (jobId && typeof jobId === 'string') realtimeOps.releaseSyncSlot(jobId);
  return { ok: true };
});

ipcMain.handle('archive:cancelSyncSlot', (_event, jobId) => {
  if (jobId && typeof jobId === 'string') realtimeOps.cancelSyncSlot(jobId);
  return { ok: true };
});

ipcMain.handle('realtime:configure', async (_event, cfg) => {
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Invalid config' };
  const { enabled, serverUrl, serverKey, deviceDisplayName, operatorName } = cfg;
  if (typeof enabled === 'boolean')          await settings.setRealtimeEnabled(enabled);
  if (serverUrl !== undefined)               await settings.setRealtimeServerUrl(typeof serverUrl === 'string' ? serverUrl : null);
  if (serverKey !== undefined)               await settings.setRealtimeServerKey(typeof serverKey === 'string' ? serverKey : null);
  if (typeof deviceDisplayName === 'string') await settings.setDeviceDisplayName(deviceDisplayName || null);
  if (typeof operatorName === 'string') realtimeOps.setOperatorName(operatorName || null);
  const newEnabled = settings.getRealtimeEnabled();
  const newUrl     = settings.getRealtimeServerUrl();
  if (newEnabled && newUrl) {
    realtimeOps.connect(newUrl);
  } else if (newEnabled) {
    realtimeOps.disconnect('not-configured');
  } else {
    realtimeOps.disconnect('disabled');
  }
  return { ok: true, status: realtimeOps.getStatus() };
});

ipcMain.handle('window:minimize', () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});
ipcMain.handle('window:toggleMaximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('window:close', () => {
  BrowserWindow.getFocusedWindow()?.close();
});

// ── Photographer Folder Sequencing ────────────────────────────────────────────

ipcMain.handle('event:getPhotographerFolders', async (_event, { localEventPath } = {}) => {
  if (!localEventPath || typeof localEventPath !== 'string') {
    return { ok: false, reason: 'localEventPath required' };
  }

  // Validate against all configured roots — staging, NAS, archive.
  const _seqRoots = [
    settings.getLocalStagingRoot(),
    settings.getNasRoot(),
    settings.getArchiveRoot(),
    settings.getMainArchiveRoot(),
  ].filter(Boolean).map(r => path.resolve(r));
  if (!_seqRoots.length) return { ok: false, reason: 'No archive root configured.' };

  const realEvent = path.resolve(localEventPath);
  if (!_seqRoots.some(r => PathUtils.isPathUnderRoot(realEvent, r))) {
    return { ok: false, reason: 'Selected event folder is not accessible. Check archive location or reconnect the drive/NAS.' };
  }

  // Read event.json to determine component structure (single vs multi-component).
  // This drives which directories are scanned for photographer folders.
  const jsonPath = path.join(realEvent, 'event.json');
  let components = [];
  try {
    const raw  = await fsp.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.components)) components = parsed.components;
  } catch { /* no event.json yet — treat as single-component */ }

  try {
    const scopes = await photographerSeqService.scanPhotographerFolders(realEvent, components);
    return { ok: true, scopes };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('event:applyPhotographerSequence', async (_event, { localEventPath, scopedOrdered } = {}) => {
  if (!localEventPath || typeof localEventPath !== 'string') {
    return { ok: false, reason: 'localEventPath required' };
  }
  // scopedOrdered: [{ scopeKey: string, ordered: [{ canonical, sequence }] }]
  if (!Array.isArray(scopedOrdered) || scopedOrdered.length === 0) {
    return { ok: false, reason: 'scopedOrdered array required' };
  }

  // Validate against all configured roots — staging, NAS, archive.
  const _applySeqRoots = [
    settings.getLocalStagingRoot(),
    settings.getNasRoot(),
    settings.getArchiveRoot(),
    settings.getMainArchiveRoot(),
  ].filter(Boolean).map(r => path.resolve(r));
  if (!_applySeqRoots.length) return { ok: false, reason: 'No archive root configured.' };

  const realEvent = path.resolve(localEventPath);
  if (!_applySeqRoots.some(r => PathUtils.isPathUnderRoot(realEvent, r))) {
    return { ok: false, reason: 'Selected event folder is not accessible. Check archive location or reconnect the drive/NAS.' };
  }

  // Block if a sync job is actively running for this event
  const eventFolderName = path.basename(realEvent);
  for (const jobId of _syncingJobIds) {
    if (typeof jobId === 'string' && jobId.includes(eventFolderName)) {
      return { ok: false, reason: 'A sync job is active for this event. Please wait for it to complete.' };
    }
  }

  // Validate and build folderName for every entry in every scope.
  // scopeKey and canonical are renderer-provided; reject any value that could
  // construct a path outside the intended component/event directory.
  const fullScopedOrdered = [];
  for (const scope of scopedOrdered) {
    if (!scope.scopeKey || typeof scope.scopeKey !== 'string') {
      return { ok: false, reason: 'Each scope must have a scopeKey.' };
    }
    if (!Array.isArray(scope.ordered)) {
      return { ok: false, reason: `scope "${scope.scopeKey}": ordered array required.` };
    }

    // Resolve and validate the scope base directory.
    // EVENT_ROOT_KEY (__eventRoot__) maps directly to realEvent.
    // Any other scopeKey is a component folder name — must be a single path
    // segment with no separators and must resolve inside realEvent.
    let scopeBaseDir;
    if (scope.scopeKey === photographerSeqService.EVENT_ROOT_KEY) {
      scopeBaseDir = realEvent;
    } else {
      if (/[/\\]/.test(scope.scopeKey)) {
        return { ok: false, reason: `scope key "${scope.scopeKey}" contains path separator characters.` };
      }
      scopeBaseDir = path.resolve(path.join(realEvent, scope.scopeKey));
      if (!PathUtils.isPathUnderRoot(scopeBaseDir, realEvent)) {
        return { ok: false, reason: `scope key "${scope.scopeKey}" resolves outside event directory.` };
      }
    }

    const fullOrdered = [];
    for (const entry of scope.ordered) {
      if (!entry.canonical || typeof entry.canonical !== 'string') {
        return { ok: false, reason: `scope "${scope.scopeKey}": each entry must have a canonical name.` };
      }
      // Reject blank, path-separator chars, or any segment containing '..'.
      const trimmedCanonical = entry.canonical.trim();
      if (!trimmedCanonical) {
        return { ok: false, reason: `scope "${scope.scopeKey}": canonical name must not be blank.` };
      }
      if (/[/\\]/.test(trimmedCanonical) || trimmedCanonical.split(path.sep).includes('..') || trimmedCanonical.includes('..')) {
        return { ok: false, reason: `scope "${scope.scopeKey}": canonical name "${entry.canonical}" contains invalid characters.` };
      }
      if (typeof entry.sequence !== 'number' || entry.sequence < 1) {
        return { ok: false, reason: `scope "${scope.scopeKey}": each entry must have sequence >= 1.` };
      }
      const folderName     = `${photographerSeqService.seqPrefix(entry.sequence)}-${trimmedCanonical}`;
      const resolvedFolder = path.resolve(path.join(scopeBaseDir, folderName));
      if (!PathUtils.isPathUnderRoot(resolvedFolder, scopeBaseDir)) {
        return { ok: false, reason: `scope "${scope.scopeKey}": folder name for "${entry.canonical}" resolves outside scope directory.` };
      }
      fullOrdered.push({ canonical: trimmedCanonical, sequence: entry.sequence, folderName });
    }
    fullScopedOrdered.push({ scopeKey: scope.scopeKey, ordered: fullOrdered });
  }

  const totalFolders = fullScopedOrdered.reduce((n, s) => n + s.ordered.length, 0);
  log('info', `[seq] Applying photographer sequence to ${realEvent} — ${fullScopedOrdered.length} scope(s), ${totalFolders} folder(s)`);

  // Apply filesystem renames (component-aware two-phase)
  const renameResult = await photographerSeqService.applyRenames(realEvent, fullScopedOrdered);
  if (!renameResult.ok) {
    log('warn', `[seq] Rename failed: ${renameResult.error}`);
    return { ok: false, reason: renameResult.error };
  }

  // Build component-scoped photographerSequences
  // { scopeKey: { canonical: { sequence, folderName } } }
  const scopedSequences = {};
  for (const scope of fullScopedOrdered) {
    scopedSequences[scope.scopeKey] = {};
    for (const entry of scope.ordered) {
      scopedSequences[scope.scopeKey][entry.canonical] = {
        sequence:   entry.sequence,
        folderName: entry.folderName,
      };
    }
  }

  // Write photographerSequences into event.json
  const writeResult = await photographerSeqService.writeSequencesToEventJson(realEvent, scopedSequences);
  if (!writeResult.ok) {
    log('warn', `[seq] event.json update failed: ${writeResult.error}`);
    return { ok: false, reason: writeResult.error };
  }

  // Build scoped rename map for manifest update
  // Map<scopeKey, Map<canonical, newFolderName>>
  const scopedRenameMap = new Map(
    fullScopedOrdered.map(scope => [
      scope.scopeKey,
      new Map(scope.ordered.map(e => [e.canonical, e.folderName])),
    ])
  );
  await photographerSeqService.updateManifestAfterRename(realEvent, scopedRenameMap).catch(err => {
    log('warn', `[seq] Manifest update warning: ${err.message}`);
  });

  // Refresh the in-memory sync queue
  await syncQueueService.refreshQueue().catch(err => {
    log('warn', `[seq] Queue refresh warning: ${err.message}`);
  });

  log('info', `[seq] Sequence applied — ${renameResult.renames.length} folder(s) renamed`);
  return { ok: true, renames: renameResult.renames, sequences: scopedSequences };
});

// ── QMZ Sequence Manager ──────────────────────────────────────────────────────

// TEMPORARY (Bug 2 forensic investigation — remove once the Leicester "empty
// QMZ workspace" root cause is confirmed). Logs, to app.log, exactly which
// paths exist on disk around the moment a QMZ root is resolved by the
// renderer, so a real Windows/NAS reproduction can be correlated against the
// literal filesystem tree without guessing.
async function _diagPathExists(p) {
  try { const st = await fsp.stat(p); return st.isDirectory() ? 'dir' : 'file'; }
  catch (err) { return `absent(${err.code || err.message})`; }
}
ipcMain.handle('qmz:diagPaths', async (_e, { eventFolder, componentFolderName, qmzRoot }) => {
  try {
    const componentPath = componentFolderName ? path.join(eventFolder, componentFolderName) : null;
    const [eventExists, eventUnseq, compExists, compUnseq, qmzRootExists] = await Promise.all([
      _diagPathExists(eventFolder),
      _diagPathExists(path.join(eventFolder, '_Unsequenced')),
      componentPath ? _diagPathExists(componentPath) : Promise.resolve('n/a (no component folderName)'),
      componentPath ? _diagPathExists(path.join(componentPath, '_Unsequenced')) : Promise.resolve('n/a'),
      _diagPathExists(qmzRoot),
    ]);
    let realQmzRoot = null;
    try { realQmzRoot = await fsp.realpath(qmzRoot); } catch (err) { realQmzRoot = `realpath THREW: ${err.code || err.message}`; }
    log(`[qmz-diag] eventFolder=${JSON.stringify(eventFolder)} exists=${eventExists} `
      + `eventFolder/_Unsequenced=${eventUnseq} `
      + `componentFolderName=${JSON.stringify(componentFolderName)} componentPath=${compExists} componentPath/_Unsequenced=${compUnseq} `
      + `resolvedQmzRoot=${JSON.stringify(qmzRoot)} qmzRootExists=${qmzRootExists} realpath(qmzRoot)=${JSON.stringify(realQmzRoot)}`);
    return { ok: true };
  } catch (err) {
    log(`[qmz-diag] FAILED: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('qmz:scanRoot', async (_e, { qmzRoot }) => {
  return qmzService.scanRoot(qmzRoot);
});

ipcMain.handle('qmz:initRoot', async (_e, { qmzRoot }) => {
  return qmzService.initRoot(qmzRoot);
});

// Bug 2 perf fix, round 2: resolves authoritative EXIF capture dates for a
// batch of already-discovered files, separately from scanRoot()/initRoot()
// so the initial QMZ workspace never blocks on ExifTool — see
// qmzService.js's listMediaFiles()/resolveCaptureDates() header comments.
ipcMain.handle('qmz:resolveCaptureDates', async (_e, { files }) => {
  return qmzService.resolveCaptureDates(files);
});

ipcMain.handle('qmz:createSequence', async (_e, { qmzRoot, number, letter }) => {
  return qmzService.createSequence(qmzRoot, number, letter);
});

ipcMain.handle('qmz:bulkCreate', async (_e, { qmzRoot, items }) => {
  return qmzService.bulkCreateSequences(qmzRoot, items);
});

ipcMain.handle('qmz:editSequence', async (_e, { qmzRoot, code, newLetter }) => {
  return qmzService.editSequenceType(qmzRoot, code, newLetter);
});

ipcMain.handle('qmz:removeSequence', async (_e, { qmzRoot, code }) => {
  return qmzService.removeSequence(qmzRoot, code);
});

ipcMain.handle('qmz:moveToSequence', async (_e, { qmzRoot, filePaths, sequenceCode, photographerName }) => {
  return qmzService.moveFilesToSequence(qmzRoot, filePaths, sequenceCode, photographerName);
});

ipcMain.handle('qmz:moveToUnsequenced', async (_e, { qmzRoot, filePaths, photographerName }) => {
  return qmzService.moveFilesToUnsequenced(qmzRoot, filePaths, photographerName);
});

ipcMain.handle('qmz:queueMetadata', async (event, { batchId, files, context }) => {
  const sender = event.sender;
  const eventJsonFilePath = context?.eventJsonPath || null;
  const emitFn = async (data) => {
    if (data.event === 'batch_complete' && eventJsonFilePath) {
      try {
        await _writeLastMetadataRun(eventJsonFilePath, data, null);
      } catch (writeErr) {
        log(`[main] qmz:queueMetadata _writeLastMetadataRun failed for ${eventJsonFilePath}: ${writeErr.message}`);
      }
      await _persistMetadataStateAndCompact(data.batchId, eventJsonFilePath);
    }
    if (!sender.isDestroyed()) sender.send('qmz:metadata:progress', data);
  };
  // files: [{ dest, photographer }] — src == dest for in-place re-tagging
  const copiedFiles = files.map(f => ({ src: f.dest, dest: f.dest, photographer: f.photographer ?? null }));
  exifService.applyBatch(batchId, copiedFiles, context, emitFn);
  return { ok: true };
});

