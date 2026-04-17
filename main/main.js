const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const fsp  = require('fs').promises;
const { exec } = require('child_process');
const { detectMemoryCards }          = require('./driveDetector');
const { readDirectory, getDCIMPath, scanPrivateFolder, safeExists } = require('./fileBrowser');
const { copyFiles, setPaused }       = require('./fileManager');
const { getThumbnail, shutdownWorkers } = require('../services/thumbnailer');
const { log } = require('../services/logger');
const telemetry     = require('../services/telemetry');
const crashReporter = require('../services/crashReporter');
const perf          = require('../services/performanceMonitor');
const autoUpdater   = require('../services/autoUpdater');

// ── Constants ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000;
const DEFAULT_DEST     = path.join(os.homedir(), 'Desktop', 'AutoIngestTest');

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

function saveImportIndex() {
  try {
    fs.writeFileSync(IMPORT_INDEX_PATH, JSON.stringify(importIndex), 'utf8');
  } catch (err) {
    log(`importIndex save failed: ${err.message}`);
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
      if (!importIndex[filename]) {
        // First import — record size and timestamp
        importIndex[filename] = { size: stat.size, addedAt: Date.now() };
      } else {
        // Re-import — preserve original addedAt so trim order is stable
        importIndex[filename].size = stat.size;
      }
      changed = true;
    } catch { /* skip unreadable */ }
  }
  if (changed) {
    trimImportIndex();
    saveImportIndex();
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

// Drive list (on-demand)
ipcMain.handle('drives:get', async () => detectMemoryCards());

ipcMain.handle('drive:eject', async (event, mountpoint) => {
  const platform       = process.platform;
  const safeMountpoint = path.normalize(mountpoint);

  log(`Eject requested: ${safeMountpoint}`);

  const run = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, (err) => { if (err) reject(err); else resolve(true); });
  });

  try {
    if (platform === 'darwin') {
      try {
        await run(`diskutil eject "${safeMountpoint}"`);
      } catch {
        await run(`diskutil unmount "${safeMountpoint}"`);
      }
    } else if (platform === 'win32') {
      const driveLetter = safeMountpoint.replace(/\\$/, '');
      await run(`powershell -Command "Remove-Volume -DriveLetter ${driveLetter[0]}"`);
    } else {
      await run(`udisksctl unmount -b "${safeMountpoint}"`);
    }

    log(`Eject success: ${safeMountpoint}`);
    return true;

  } catch (err) {
    log(`Eject failed: ${safeMountpoint} | ${err.message}`);
    throw err;
  }
});

// File browser
ipcMain.handle('files:get', async (event, { drivePath, folderPath, requestId }) => {
  const dcimPath = getDCIMPath(drivePath);
  if (!dcimPath) throw new Error(`No DCIM folder found on drive: ${drivePath}`);
  const targetPath = folderPath || dcimPath;
  const { folders, files } = await readDirectory(targetPath, (batch) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('files:batch', {
        requestId,
        dcimPath,
        folderPath: targetPath,
        folders: batch.folders,
        files: batch.files,
        processed: batch.processed,
        total: batch.total
      });
    }
  });

  // Merge Sony PRIVATE folder videos when browsing a drive root or the DCIM root
  let allFiles = files;
  const isBrowsingDcimRoot = !folderPath || folderPath === dcimPath;
  if (isBrowsingDcimRoot) {
    const privatePath = path.join(drivePath, 'PRIVATE');
    if (await safeExists(privatePath)) {
      const privateFiles = await scanPrivateFolder(privatePath);
      // Deduplicate by path — PRIVATE files are a separate tree, no overlap expected
      const seenPaths = new Set(files.map(f => f.path));
      const newFiles  = privateFiles.filter(f => !seenPaths.has(f.path));
      allFiles = [...files, ...newFiles];
    }
  }

  // Always sort the final list newest-first, regardless of source.
  // DCIM-only lists are pre-sorted by readDirectory, but a second stable
  // sort here costs <1 ms and guarantees consistent order for every path.
  allFiles.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  return { dcimPath, folderPath: targetPath, folders, files: allFiles };
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
 * Returns { filename: sizeBytes } map, or {} if folder doesn't exist yet.
 */
ipcMain.handle('dest:scanFiles', async (_event, destPath) => {
  const result = {};
  try {
    const entries = await fsp.readdir(destPath, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(e => e.isFile())
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
      const f = filePaths[progress.index - 1];
      try { bytesCopiedSoFar += require('fs').statSync(f).size; } catch {}
      fileIndex++;
      // Sample speed every 10 copied files
      if (fileIndex % 10 === 0) {
        perf.importSpeedSample(bytesCopiedSoFar, Date.now() - importStartMs);
      }
    }
  });

  log(`Import completed: copied=${result.copied} skipped=${result.skipped} errors=${result.errors} → ${destination}`);

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

// Pause / Resume copy pipeline
ipcMain.on('copy:pause',  () => setPaused(true));
ipcMain.on('copy:resume', () => setPaused(false));

// Global import index — returns { lowercaseFilename: { size, addedAt } }
ipcMain.handle('importIndex:get', async () => importIndex);

// What's New — returns { version, notes } once after an update, then null
ipcMain.handle('getLastUpdateInfo', () => storedUpdateInfo);

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