'use strict';
/**
 * services/crashReporter.js
 *
 * Passive capture of every crash and unhandled error.
 * Call init(mainWindow) once inside app.whenReady().then() — after telemetry.init().
 *
 * Hooks:
 *  • process uncaughtException        — main process fatal error
 *  • process unhandledRejection       — unhandled Promise rejection (in addition to existing handler)
 *  • app render-process-gone          — renderer hard crash
 *  • app child-process-gone           — GPU/utility process crash
 *  • ipcMain renderer:error           — JS errors forwarded from renderer (via preload)
 *  • ipcMain renderer:unhandledRejection — Promise rejections forwarded from renderer
 */

const telemetry = require('./telemetry');
const { log }   = require('./logger');

// Stack trace lines to include in each report
const STACK_DEPTH = 8;

// ── Public: wire up all passive handlers ─────────────────────────────────────
function init(mainWindow) {
  if (!telemetry.isEnabled()) return;
  hookMainProcess();
  hookElectronEvents(mainWindow);
}

// ── Main-process fatal errors ─────────────────────────────────────────────────
function hookMainProcess() {
  process.on('uncaughtException', (err) => {
    log(`Crash (uncaughtException): ${err.message}`);
    telemetry.enqueue({
      type:        'crash',
      issueType:   'Crash',
      severity:    'Critical',
      description: `Main process crash: ${err.message}`,
      expected:    'App runs without errors',
      actual:      err.message,
      context: {
        errorType: err.name || 'Error',
        stack:     trimStack(err.stack),
      },
    });
    // Best-effort flush before the process dies
    telemetry.flush().catch(() => {});
  });

  // Additional unhandledRejection listener — the existing one in main.js logs to file;
  // this one also sends to telemetry. Both listeners run independently.
  process.on('unhandledRejection', (reason) => {
    const msg   = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack   : '';
    telemetry.enqueue({
      type:        'error',
      issueType:   classifyError(msg),
      severity:    'High',
      description: `Unhandled rejection: ${msg}`,
      context:     { stack: trimStack(stack) },
    });
  });
}

// ── Electron process events ───────────────────────────────────────────────────
function hookElectronEvents(mainWindow) {
  const { app, ipcMain } = require('electron');

  // Renderer hard crash (OOM, native module fault, etc.)
  app.on('render-process-gone', (_event, webContents, details) => {
    log(`Renderer process gone: ${details.reason}`);
    telemetry.enqueue({
      type:        'crash',
      issueType:   'Crash',
      severity:    'Critical',
      description: `Renderer process crashed: ${details.reason}`,
      context: {
        exitCode: details.exitCode,
        reason:   details.reason,
        url:      webContents && webContents.getURL ? webContents.getURL() : '',
      },
    });
    telemetry.flush().catch(() => {});
  });

  // GPU / utility process crash
  app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU') return;
    log(`GPU process gone: ${details.reason}`);
    telemetry.enqueue({
      type:        'crash',
      issueType:   'Crash',
      severity:    'High',
      description: `GPU process exited: ${details.reason}`,
      context:     { exitCode: details.exitCode },
    });
  });

  // Renderer JS error forwarded via preload
  ipcMain.on('renderer:error', (_evt, payload) => {
    log(`Renderer JS error: ${payload.message}`);
    telemetry.enqueue({
      type:        'error',
      issueType:   classifyError(payload.message),
      severity:    'High',
      description: `Renderer error: ${payload.message}`,
      context: {
        stack:  payload.stack,
        source: payload.source,
        lineno: payload.lineno,
      },
    });
  });

  // Renderer unhandled rejection forwarded via preload
  ipcMain.on('renderer:unhandledRejection', (_evt, payload) => {
    log(`Renderer unhandledRejection: ${payload.reason}`);
    telemetry.enqueue({
      type:        'error',
      issueType:   classifyError(payload.reason),
      severity:    'High',
      description: `Renderer unhandled rejection: ${payload.reason}`,
      context:     { stack: payload.stack },
    });
  });
}

// ── Classify an error message into a Bug Tracker Issue Type ──────────────────
function classifyError(msg) {
  if (!msg) return 'Other';
  const m = msg.toLowerCase();
  if (m.includes('crash') || m.includes('segfault'))              return 'Crash';
  if (m.includes('enoent') || m.includes('copy') || m.includes('import')) return 'Import Failure';
  if (m.includes('thumb') || m.includes('sharp') || m.includes('exif'))  return 'Thumbnail Issue';
  if (m.includes('timeout') || m.includes('blocked') || m.includes('slow')) return 'Performance';
  return 'Other';
}

// ── Trim stack trace to N lines ───────────────────────────────────────────────
function trimStack(stack) {
  if (!stack) return '';
  return stack.split('\n').slice(0, STACK_DEPTH).join(' → ');
}

module.exports = { init };
