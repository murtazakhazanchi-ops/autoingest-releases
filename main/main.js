const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const fsp  = require('fs').promises;
const { exec, execFile } = require('child_process');
const { detectMemoryCards, listAllDrives } = require('./driveDetector');
const { readDirectory, getDCIMPath, scanPrivateFolder, safeExists, scanMediaRecursive, buildFolderTree } = require('./fileBrowser');
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
const settings      = require('../services/settings');

// ── Constants ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000;
const DEFAULT_DEST     = path.join(os.homedir(), 'Desktop', 'AutoIngestTest');

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

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 8 },
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
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
        if (!win.isDestroyed()) {
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

app.whenReady().then(() => {
  log('App started');
  loadImportIndex();
  settings.init();
  listManager.init(app.getPath('userData'));
  aliasEngine.init(app.getPath('userData'));
  telemetry.init();
  const mainWindow = createWindow();
  crashReporter.init(mainWindow);
  perf.init();
  autoUpdater.init();
  pollHandle = startDrivePolling();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log('App closing');
  perf.stop();
  telemetry.flush().catch(() => {});
  shutdownWorkers();
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
ipcMain.handle('files:import', async (event, { filePaths, destination }) => {
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

  return result;
});

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

// Legacy ping
ipcMain.handle('ping', async () => 'pong 🏓');

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

// TEMPORARY DEBUG — remove after diagnosis
ipcMain.handle('debug:telemetry', async () => {
  const fs   = require('fs');
  const path = require('path');

  const KEY_PATH  = path.join(__dirname, '../config/service-account-key.json');
  const SHEET_ID  = require('../services/telemetry').SHEET_ID ||
                    'check telemetry.js directly';

  const keyExists = fs.existsSync(KEY_PATH);
  let   keyValid  = false;
  let   keyEmail  = null;
  let   keyError  = null;

  if (keyExists) {
    try {
      const k = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
      keyEmail = k.client_email || null;
      keyValid = k.type === 'service_account' && !!k.private_key && !k._SETUP_INSTRUCTIONS;
    } catch (e) {
      keyError = e.message;
    }
  }

  // Try an actual Sheets append with full error surfacing
  let sheetsResult = null;
  if (keyValid) {
    try {
      const { google } = require('googleapis');
      const k    = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
      const auth = new google.auth.JWT(
        k.client_email, null, k.private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
      );
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.values.append({
        spreadsheetId:    SHEET_ID,
        range:            "'Bug Tracker'!A:S",
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [['', new Date().toDateString(), 'DEBUG', '0.1.0',
                                 'Mac', '', '', 'debug', 'Other', 'debug test',
                                 '', '', '', 'No', 'No', 'Low', 'New', '', '']] },
      });
      sheetsResult = 'SUCCESS — row appended';
    } catch (e) {
      sheetsResult = `FAILED: ${e.message}`;
    }
  }

  return {
    keyExists,
    keyValid,
    keyEmail,
    keyError,
    sheetId:      SHEET_ID,
    sheetsResult,
  };
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
      const obj = JSON.parse(raw);
      if (isValidEventJson(obj)) {
        eventJson = obj;
        // Patch 3: crash recovery — reset stuck in-progress status on next startup.
        // An event left as 'in-progress' means the app crashed or was force-quit
        // mid-import. Reset to 'created' so the user can retry cleanly.
        if (eventJson.status === 'in-progress') {
          eventJson.status   = 'created';
          eventJson.updatedAt = Date.now();
          const tmp = jsonPath + '.tmp';
          await fsp.writeFile(tmp, JSON.stringify(eventJson, null, 2), 'utf8');
          await fsp.rename(tmp, jsonPath);
        }
      } else {
        jsonCorrupt = true; // exists but fails shape validation — treat as corrupt
      }
    } catch (err) {
      if (err.code !== 'ENOENT') jsonCorrupt = true;
      // ENOENT = no JSON file → legacy event, fallback to parser below
    }

    const parsed = parseEventName(name, lists);

    if (eventJson) {
      // event.json is the SOLE source of components. Parser provides hijriDate+sequence only.
      const hijriDate = parsed.ok ? parsed.hijriDate : (eventJson.hijriDate || '');
      const sequence  = parsed.ok ? parsed.sequence  : (eventJson.sequence  || '00');
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
        _eventJson:           eventJson,
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

function isValidEventJson(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    obj.version === 1 &&
    typeof obj.hijriDate === 'string' && obj.hijriDate.length > 0 &&
    (typeof obj.sequence === 'number' || (typeof obj.sequence === 'string' && obj.sequence.length > 0)) &&
    typeof obj.eventName === 'string' && obj.eventName.length > 0 &&
    Array.isArray(obj.components) &&
    obj.components.length > 0 &&
    obj.components.every(c =>
      c !== null &&
      typeof c === 'object' &&
      Array.isArray(c.types) &&
      c.types.length > 0 &&
      typeof c.city === 'string' &&
      c.city.length > 0 &&
      (typeof c.location === 'string' || c.location === null || c.location === undefined)
    )
  );
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
    return { ok: true, alreadyExisted: true, data: JSON.parse(existing) };
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, reason: `Read check failed: ${err.message}` };
  }
  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(eventData, null, 2), 'utf8');
    await fsp.rename(tmp, jsonPath);
    return { ok: true, alreadyExisted: false, data: eventData };
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    return { ok: false, reason: `Write failed: ${err.message}` };
  }
});

// Read event.json from a folder. Returns parsed object, null (missing), or
// { _corrupt: true } (invalid JSON, wrong version, or fails shape validation).
ipcMain.handle('event:read', async (_event, eventFolderPath) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') return null;
  const jsonPath = path.join(eventFolderPath, 'event.json');
  try {
    const raw = await fsp.readFile(jsonPath, 'utf8');
    const obj = JSON.parse(raw);
    if (!isValidEventJson(obj)) return { _corrupt: true };
    return obj;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return { _corrupt: true };
  }
});

// Atomically update allowed fields in event.json. Only the fields listed in
// ALLOWED_UPDATE_KEYS may be changed — unknown fields from `patch` are silently
// ignored so a stale caller can never corrupt the schema.
const ALLOWED_UPDATE_KEYS = ['components', 'status', 'eventName', 'safeEventName', 'updatedAt'];

ipcMain.handle('event:update', async (_event, eventFolderPath, patch) => {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, reason: 'Invalid folder path.' };
  }
  const jsonPath = path.join(eventFolderPath, 'event.json');
  let existing = {};
  try {
    const raw = await fsp.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch { /* no file yet — start fresh */ }
  // Allowlist merge: only modify permitted keys, never spread unknown fields.
  const updated = { ...existing };
  for (const key of ALLOWED_UPDATE_KEYS) {
    if (patch[key] !== undefined) updated[key] = patch[key];
  }
  updated.updatedAt = Date.now();
  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
    await fsp.rename(tmp, jsonPath);
    return { ok: true };
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    return { ok: false, reason: `Write failed: ${err.message}` };
  }
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

ipcMain.handle('dir:rename', async (_event, oldPath, newPath) => {
  if (!oldPath || !newPath) return { ok: false, reason: 'Missing paths.' };
  if (oldPath === newPath) return { ok: true };
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
  try {
    await fsp.rename(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Rename failed: ${err.message}` };
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

// Checks that the collection folder still exists on disk.
// Event folders are only created at import time, so we don't verify them.
ipcMain.handle('settings:verifyLastEvent', async (_event, collectionPath) => {
  if (!collectionPath) return false;
  try {
    const stat = await fsp.stat(collectionPath);
    return stat.isDirectory();
  } catch { return false; }
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

// ── Window controls ──────────────────────────────────────────────────────────
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

// TEMP DEBUG
ipcMain.handle('debug:flush', async () => {
  const fs   = require('fs');
  const path = require('path');
  const KEY_PATH = path.join(__dirname, '../config/service-account-key.json');
  const SHEET_ID = '1FKOL4bqScljgI8YPIMuCRNa0V7PtElnDFYaTYGx4TgU';

  try {
    const { google } = require('googleapis');
    const key  = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    const auth = new google.auth.JWT(
      key.client_email, null, key.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId:    SHEET_ID,
      range:            "'Bug Tracker'!A:S",
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [['', '16 Apr 2026', 'DebugTest', '0.1.0',
                               'Mac', '', '', 'debug', 'Other', 'direct debug test',
                               '', '', '', 'No', 'No', 'Low', 'New', '', '']] },
    });
    return { success: true, updatedRange: res.data.updates && res.data.updates.updatedRange };
  } catch (e) {
    return { success: false, error: e.message, code: e.code };
  }
});