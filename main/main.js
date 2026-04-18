const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const fsp  = require('fs').promises;
const { exec, execFile } = require('child_process');
const { detectMemoryCards }          = require('./driveDetector');
const { readDirectory, getDCIMPath, scanPrivateFolder, safeExists, scanMediaRecursive } = require('./fileBrowser');
const { copyFiles, setPaused, getFileHash, abortCopy } = require('./fileManager');
const { getThumbnail, shutdownWorkers } = require('../services/thumbnailer');
const { log } = require('../services/logger');
const telemetry     = require('../services/telemetry');
const crashReporter = require('../services/crashReporter');
const perf          = require('../services/performanceMonitor');
const autoUpdater   = require('../services/autoUpdater');

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
    width: 1200,
    height: 800,
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
      const cards = await detectMemoryCards();
      if (cards.length) {
        cards.forEach(c => log(`Drive detected: ${c.mountpoint} (${c.label})`));
      }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('drives:updated', cards);
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
      folders:    [],
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

  return { dcimPath: dcimPathForUI, folderPath: targetPath, folders: [], files };
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