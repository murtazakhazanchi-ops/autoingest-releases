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
const metadataSyncService = require('./metadataSyncService');
const realtimeOps              = require('../services/realtimeOperationsService');
const offlineCollectionRegistry = require('../services/offlineCollectionRegistryService');

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
  // Emit initial health snapshot after a short startup delay, then every 60 s.
  setTimeout(_emitDeviceHealth, 6000);
  setInterval(_emitDeviceHealth, 60_000);
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

  const importStartMs    = Date.now();
  let   bytesCopiedSoFar = 0;
  let   fileIndex        = 0;

  let result;
  try {
    result = await copyFileJobs(normalisedJobs, (progress) => {
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
  const { done = 0, failed = 0, skipped = 0 } = batchStats;
  const status = failed === 0 ? 'applied' : (done > 0 || skipped > 0) ? 'partial' : 'failed';
  const lastMetadataRun = {
    timestamp: new Date().toISOString(),
    status,
    processed: done,
    failed,
    skipped,
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
    const raw = await fsp.readFile(eventJsonFilePath, 'utf8');
    const doc = JSON.parse(raw);
    doc.lastMetadataRun = lastMetadataRun;
    if (metadataSummary) doc.metadataSummary = metadataSummary;
    const tmp = eventJsonFilePath + '.tmp';
    try {
      await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
      await fsp.rename(tmp, eventJsonFilePath);
      hidePathBestEffort(eventJsonFilePath).catch(() => {});
    } catch (writeErr) {
      try { await fsp.unlink(tmp); } catch {}
      throw writeErr;
    }
  } catch (err) {
    log(`[main] Failed to persist lastMetadataRun to ${path.basename(eventJsonFilePath)}: ${err.message}`);
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

    if (originalEventJson && typeof originalEventJson === 'object') {
      const jsonPath = path.join(eventJsonPath, 'event.json');
      const tmp = jsonPath + '.tmp';
      await fsp.writeFile(
        tmp,
        JSON.stringify({ ...originalEventJson, status: 'created', updatedAt: Date.now() }, null, 2),
        'utf-8'
      );
      await fsp.rename(tmp, jsonPath);
      hidePathBestEffort(jsonPath).catch(() => {});
      return;
    }

    const rollbackResult = await updateEventJson(eventJsonPath, { status: 'created' });
    if (!rollbackResult?.ok) {
      throw new Error(rollbackResult?.reason || 'Event rollback failed.');
    }
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
      // Single atomic write: merge audit logs + set lastImport + set status:'complete'.
      // All three fields are updated in one read/merge/write cycle to eliminate the
      // partial-state window where a crash between writes would erase already-committed
      // audit entries while leaving copied files on disk.
      const jsonPath = path.join(eventJsonPath, 'event.json');
      let doc = {};
      // First read
      try {
        const raw = await fsp.readFile(jsonPath, 'utf8');
        doc = JSON.parse(raw);
      } catch { /* no file yet — start from empty */ }
      // Second read (handles concurrent writers on NAS)
      try {
        const latestRaw = await fsp.readFile(jsonPath, 'utf8');
        doc = JSON.parse(latestRaw);
      } catch { /* fall back to first read */ }

      if (logs.length > 0) {
        const mergedMap = new Map();
        (Array.isArray(doc.imports) ? doc.imports : [])
          .concat(logs)
          .forEach(entry => {
            if (isValidImportEntry(entry)) mergedMap.set(entry.id, entry);
            else console.warn('[AUDIT] Skipped invalid entry:', entry);
          });
        doc.imports = Array.from(mergedMap.values());
        const MAX_IMPORTS = 5000;
        if (doc.imports.length > MAX_IMPORTS) {
          doc.imports = doc.imports.sort(sortImports).slice(0, MAX_IMPORTS);
          console.warn('[AUDIT] Trimmed to latest', MAX_IMPORTS);
        }
        const latestLog = logs[logs.length - 1];
        doc.lastImport = {
          photographer: latestLog.photographer,
          timestamp:    latestLog.timestamp,
          fileCount:    latestLog.counts.photos + latestLog.counts.videos,
        };
      }

      doc.status    = 'complete';
      doc.updatedAt = Date.now();
      if (metadataGroupsForDisk) doc.metadataGroups = metadataGroupsForDisk;

      const tmp = jsonPath + '.tmp';
      try {
        await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
        try {
          await fsp.rename(tmp, jsonPath);
        } catch (renameErr) {
          if (renameErr.code !== 'EXDEV') throw renameErr;
          // Cross-device rename (e.g. NAS or iCloud drive on different volume) — fall back to copy+unlink.
          await fsp.copyFile(tmp, jsonPath);
          await fsp.unlink(tmp).catch(() => {});
        }
        hidePathBestEffort(jsonPath).catch(() => {});
      } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
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
        photographer:   photographer || '',
        eventName:      eventJsonPath ? path.basename(eventJsonPath) : '',
        collName:       collName || '',
        hijriDate:      originalEventJson?.hijriDate || null,
        groups:         groups || [],
        diskComponents: originalEventJson?.components || [],
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
            }
            if (baseEmit) baseEmit(p);
          }
        : null;

      exifService.applyBatch(batchId, result.copiedFiles, metaContext, emitFn);
      result.metadataBatchId = batchId;
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
  const user   = await userManager.getActiveUser().catch(() => null);
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
  const _isNasPath = _nasRoot && (
    path.resolve(basePath) === path.resolve(_nasRoot) ||
    path.resolve(basePath).startsWith(path.resolve(_nasRoot) + path.sep)
  );
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
 * Returns an array sorted by (hijriDate, seq) DESCENDING so newest events
 * are listed first. Unparseable entries are appended at the end in the same
 * insertion order (their hijriDate/seq are unreliable).
 *
 * Never throws for missing or unreadable masters — returns [] instead.
 */
ipcMain.handle('master:scanEvents', async (_event, masterPath) => {
  if (!masterPath || typeof masterPath !== 'string') return [];

  let entries;
  try {
    entries = await fsp.readdir(masterPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Load lists ONCE for this scan; parser is a pure function of its inputs.
  const lists = {
    cities:     listManager.getList('cities'),
    locations:  listManager.getList('locations'),
    eventTypes: listManager.getList('event-types'),
  };

  const resolved   = [];
  const unparseable = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // Skip macOS/system artefacts defensively (even though these aren't directories usually)
    if (name.startsWith('.')) continue;

    // Try event.json first (authoritative); fallback to parser for legacy events.
    const jsonPath = path.join(masterPath, name, 'event.json');
    let eventJson = null;
    let jsonCorrupt = false;
    try {
      const raw = await fsp.readFile(jsonPath, 'utf8');
      const obj = normalizeEventJson(JSON.parse(raw));
      if (isValidEventJson(obj)) {
        eventJson = obj;
        hidePathBestEffort(jsonPath).catch(() => {});
        // Patch 3: crash recovery — reset stuck in-progress status on next startup.
        // An event left as 'in-progress' means the app crashed or was force-quit
        // mid-import. Reset to 'created' so the user can retry cleanly.
        if (eventJson.status === 'in-progress') {
          eventJson.status   = 'created';
          eventJson.updatedAt = Date.now();
          const tmp = jsonPath + '.tmp';
          await fsp.writeFile(tmp, JSON.stringify(eventJson, null, 2), 'utf8');
          await fsp.rename(tmp, jsonPath);
          hidePathBestEffort(jsonPath).catch(() => {});
        }
      } else {
        jsonCorrupt = true;
        console.error('[scanEvents] isValidEventJson failed for', name, '— shape dump:', JSON.stringify(obj).slice(0, 400));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        jsonCorrupt = true;
        console.error('[scanEvents] Failed to parse event.json for', name, ':', err.message);
      }
      // ENOENT = no JSON file → legacy event, fallback to parser below
    }

    const parsed = parseEventName(name, lists);

    if (eventJson) {
      // event.json is the SOLE source of components. Parser provides hijriDate+sequence only.
      const hijriDate = parsed.ok ? parsed.hijriDate : (eventJson.hijriDate || '');
      const sequence  = parsed.ok ? parsed.sequence  : (eventJson.sequence  || '00');
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
    } else {
      // Both JSON (if present) and parser failed.
      unparseable.push({
        folderName: name,
        isParseable: false,
        reason:      parsed.ok ? 'corrupt-json' : parsed.reason,
        isCorrupt:   jsonCorrupt,
      });
    }
  }

  // Sort resolved newest-first by (hijriDate desc, sequence desc). Both are
  // fixed-width strings so lexicographic comparison is equivalent to numeric.
  resolved.sort((a, b) => {
    if (a.hijriDate !== b.hijriDate) return b.hijriDate.localeCompare(a.hijriDate);
    return b.sequence.localeCompare(a.sequence);
  });

  return [...resolved, ...unparseable];
});

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
    const _isNasEv    = _nasRoot3 && (
      path.resolve(eventFolderPath) === path.resolve(_nasRoot3) ||
      path.resolve(eventFolderPath).startsWith(path.resolve(_nasRoot3) + path.sep)
    );
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

  let dataToWrite;
  if (isFullPayload) {
    // Repair / save path — caller supplies the complete payload; write it directly.
    dataToWrite = {
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
    if (!isValidEventJson(dataToWrite)) {
      return { ok: false, reason: 'event.json full payload failed schema validation.' };
    }
  } else {
    // Status-only / partial-patch path — read existing, merge, write back.
    let existing = {};
    try {
      const raw = await fsp.readFile(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') existing = parsed;
    } catch { /* no file yet — partial write will be best-effort */ }
    const PATCH_ALLOWLIST = new Set(['status']);
    const safePatch = {};
    for (const [k, v] of Object.entries(payload)) {
      if (PATCH_ALLOWLIST.has(k)) safePatch[k] = v;
    }
    dataToWrite = { ...existing, ...safePatch, updatedAt: Date.now() };
  }

  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(dataToWrite, null, 2), 'utf-8');
    await fsp.rename(tmp, jsonPath);
    hidePathBestEffort(jsonPath).catch(() => {});
    return { ok: true };
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
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
  let doc = {};
  try {
    const raw = await fsp.readFile(jsonPath, 'utf8');
    doc = JSON.parse(raw);
  } catch { /* no file yet — start from empty doc */ }
  // Re-read latest before final write (handles concurrent writers on NAS).
  let latestImports = [];
  try {
    const latestRaw = await fsp.readFile(jsonPath, 'utf8');
    const latest = JSON.parse(latestRaw);
    if (Array.isArray(latest.imports)) latestImports = latest.imports;
    doc = latest; // use freshest doc as base for write
  } catch { /* file unchanged or gone — fall back to first read */ }
  const incomingSafe = Array.isArray(entries) ? entries : [];
  const mergedMap = new Map();
  [...latestImports, ...incomingSafe].forEach(entry => {
    if (isValidImportEntry(entry)) {
      mergedMap.set(entry.id, entry);
    } else {
      console.warn('[AUDIT] Skipped invalid entry:', entry);
    }
  });
  doc.imports = Array.from(mergedMap.values());
  const MAX_IMPORTS = 5000;
  if (doc.imports.length > MAX_IMPORTS) {
    doc.imports = doc.imports.sort(sortImports).slice(0, MAX_IMPORTS);
    console.warn('[AUDIT] Trimmed to latest', MAX_IMPORTS);
  }
  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
    await fsp.rename(tmp, jsonPath);
    hidePathBestEffort(jsonPath).catch(() => {});
    return { ok: true, count: incomingSafe.length };
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
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
    realRoots.some(r => resolved === r || resolved.startsWith(r + path.sep));

  const _isDescendantOfRoot = (resolved) =>
    realRoots.some(r => resolved.startsWith(r + path.sep));

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

ipcMain.handle('archive:getOperationsStatus', async () => {
  const nasRoot          = settings.getNasRoot();
  const localStagingRoot = settings.getLocalStagingRoot();
  const defaultImportMode = settings.getDefaultImportMode();
  const mainArchiveRoot  = settings.getMainArchiveRoot();

  if (!nasRoot) {
    return { status: 'nas-not-set', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
  }

  // Quick reachability check (stat the root directory)
  try {
    const stat = await fsp.stat(nasRoot);
    if (!stat.isDirectory()) {
      return { status: 'invalid-nas', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
    }
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTCONN' || err.code === 'EIO') {
      return { status: 'nas-disconnected', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
    }
    return { status: 'invalid-nas', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
  }

  // Validate marker
  try {
    const markerPath = path.join(nasRoot, '.autoingest', 'root', 'archive-root.json');
    const raw = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (marker.type !== 'autoingest-nas-root') {
      return { status: 'invalid-nas', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
    }
  } catch {
    return { status: 'invalid-nas', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
  }

  if (defaultImportMode === 'local-first' && !localStagingRoot) {
    return { status: 'local-staging-missing', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
  }

  return { status: 'ready', nasRoot, localStagingRoot, defaultImportMode, mainArchiveRoot };
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

  let collectionEntries;
  try {
    collectionEntries = await fsp.readdir(nasRoot, { withFileTypes: true });
  } catch (err) {
    const reason = (err.code === 'ENOENT' || err.code === 'ENOTCONN' || err.code === 'EIO')
      ? 'nas-disconnected' : 'invalid-nas';
    return { status: reason, refreshedAt, source: 'nas', collections: [] };
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

    let eventEntries;
    try {
      eventEntries = await fsp.readdir(collPath, { withFileTypes: true });
    } catch {
      // Unreadable collection — skip silently
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

  // Validate the NAS root marker before scanning
  try {
    const markerPath = path.join(nasRoot, '.autoingest', 'root', 'archive-root.json');
    const raw  = await fsp.readFile(markerPath, 'utf8');
    const mark = JSON.parse(raw);
    if (mark.type !== 'autoingest-nas-root') {
      return { status: 'invalid-nas', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      try {
        await fsp.stat(nasRoot);
        return { status: 'invalid-nas', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
      } catch {
        return { status: 'nas-disconnected', refreshedAt: new Date().toISOString(), source: 'nas', collections: [] };
      }
    }
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

  if (!realEventPath.startsWith(realRoot + path.sep)) {
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

  if (!realEventPath.startsWith(realRoot + path.sep)) {
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
  if (!nasRoot) return { ok: true, blocked: [] };

  const scopes  = _extractPhotographerLockScopes(fileJobs || [], nasRoot);
  const blocked = [];
  for (const scope of scopes) {
    try {
      const r = await archiveLockService.checkLock(nasRoot, scope);
      if (r.blocked) blocked.push({ ...scope, lockedBy: r.lockedBy, expiresAt: r.expiresAt });
    } catch (err) {
      console.warn('[archive:checkDirectArchiveLocks] checkLock I/O error (treating as not blocked):', scope.photographerFolderName, err.message);
    }
  }
  return { ok: true, blocked };
});

// ── EXIF metadata service ─────────────────────────────────────────────────────

ipcMain.handle('metadata:getStatus', (_event, batchId) => {
  return exifService.getBatchStatus(batchId);
});

ipcMain.handle('metadata:retry', async (_event, batchId) => {
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
  const emitFn = win
    ? (progress) => { if (!win.isDestroyed()) win.webContents.send('metadata:progress', progress); }
    : null;
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
    const rel   = path.relative(baseDir, filePath);
    const parts = rel.split(path.sep);
    const seg   = parts.length > 1 ? parts[0] : '';
    return seg || fallbackPhotographer;
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
  const reapplyContext = {
    photographer:   fallbackPhotographer,
    eventName,
    collName,
    hijriDate,
    groups,
    diskComponents: components,
  };
  const reapplyEventJsonPath = path.join(eventFolderPath, 'event.json');
  const baseEmit = win
    ? (p) => { if (!win.isDestroyed()) win.webContents.send('metadata:progress', p); }
    : null;
  const emitFn = baseEmit
    ? async (p) => {
        if (p.event === 'batch_complete')
          await _writeLastMetadataRun(reapplyEventJsonPath, p, reapplyContext.groups);
        baseEmit(p);
      }
    : null;

  exifService.applyBatch(batchId, copiedFiles, reapplyContext, emitFn);

  return { ok: true, batchId };
});

// ── List manager ──────────────────────────────────────────────────────────────

ipcMain.handle('lists:get',        (_event, name)                              => listManager.getList(name));
ipcMain.handle('lists:add',        (_event, name, value)                       => listManager.addToList(name, value));
ipcMain.handle('lists:match',      (_event, name, input)                       => aliasEngine.match(input, name, listManager.getList(name)));
ipcMain.handle('lists:learnAlias', (_event, name, canonicalId, label, typed)   => aliasEngine.learnAlias(name, canonicalId, label, typed));

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
        passes: realSrc.startsWith(realRoot + path.sep),
      });
    }
    if (!realSrc.startsWith(realRoot + path.sep)) {
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

ipcMain.handle('metadataSync:scanPending', async (_event, masterPath) => {
  if (!masterPath || typeof masterPath !== 'string') return [];
  const userDataPath = app.getPath('userData');
  return metadataSyncService.scanPendingEvents(masterPath, userDataPath);
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
  const nasRoot      = settings.getNasRoot();
  const transferRoot = settings.getTransferRoot();
  if (!nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.previewExport(nasRoot, transferRoot, scope);
});

ipcMain.handle('archive:runTransferExport', async (_event, { scope, operatorName } = {}) => {
  const nasRoot      = settings.getNasRoot();
  const transferRoot = settings.getTransferRoot();
  if (!nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.runExport(nasRoot, transferRoot, scope, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
  });
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

ipcMain.handle('archive:verifyTransferExport', async (_event, { scope } = {}) => {
  const nasRoot      = settings.getNasRoot();
  const transferRoot = settings.getTransferRoot();
  if (!nasRoot)      return { ok: false, reason: 'nas-not-set' };
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferExportService.verifyExport(nasRoot, transferRoot, scope);
});

// ── Transfer Import ───────────────────────────────────────────────────────────

ipcMain.handle('archive:getTransferDriveCollections', async () => {
  const transferRoot = settings.getTransferRoot();
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  return transferImportService.scanCollections(transferRoot);
});

ipcMain.handle('archive:previewTransferImport', async (_event, { scope } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.previewImport(transferRoot, mainArchiveRoot, scope);
});

ipcMain.handle('archive:runTransferImport', async (_event, { scope, operatorName } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.runImport(transferRoot, mainArchiveRoot, scope, {
    operatorName: operatorName || null,
    deviceName:   os.hostname(),
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
  });
});

ipcMain.handle('archive:verifyTransferImport', async (_event, { scope } = {}) => {
  const transferRoot    = settings.getTransferRoot();
  const mainArchiveRoot = settings.getMainArchiveRoot();
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };
  return transferImportService.verifyImport(transferRoot, mainArchiveRoot, scope);
});

// ── Archive Diagnostics (Phase 13A — read-only) ───────────────────────────────

ipcMain.handle('archive:runDiagnostics',       async (_event, { scope } = {}) => archiveDiagnosticsService.runDiagnostics(scope));
ipcMain.handle('archive:getDiagnosticsStatus', ()                              => archiveDiagnosticsService.getDiagnosticsStatus());
ipcMain.handle('archive:getDiagnosticsReport', ()                              => archiveDiagnosticsService.getDiagnosticsReport());

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
  if (!realNasColl.startsWith(realNasRoot + path.sep) && realNasColl !== realNasRoot) {
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
    const rel = path.relative(stagingRoot, localCollectionPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
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
  if (!realNasColl.startsWith(realNasRoot + path.sep) && realNasColl !== realNasRoot) {
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
    const rel = path.relative(stagingRoot, localCollectionPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
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
    if (realNasColl.startsWith(realNasRoot + path.sep) || realNasColl === realNasRoot) {
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
    if (realNasColl.startsWith(realNasRoot + path.sep) || realNasColl === realNasRoot) {
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
}));

ipcMain.handle('realtime:testConnection', async (_event, { serverUrl } = {}) => {
  if (!serverUrl || typeof serverUrl !== 'string') return { ok: false };
  const url = serverUrl.trim().replace(/\/$/, '') + '/health';
  return new Promise((resolve) => {
    const mod = url.startsWith('https://') ? require('https') : require('http');
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve({ ok }); } };
    const timer = setTimeout(() => finish(false), 5000);
    try {
      const req = mod.get(url, { timeout: 5000 }, (res) => {
        clearTimeout(timer);
        finish(res.statusCode >= 200 && res.statusCode < 500);
        res.resume();
      });
      req.on('error', () => { clearTimeout(timer); finish(false); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); finish(false); });
    } catch { clearTimeout(timer); finish(false); }
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
  const { enabled, serverUrl, deviceDisplayName, operatorName } = cfg;
  if (typeof enabled === 'boolean')          await settings.setRealtimeEnabled(enabled);
  if (serverUrl !== undefined)               await settings.setRealtimeServerUrl(typeof serverUrl === 'string' ? serverUrl : null);
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

