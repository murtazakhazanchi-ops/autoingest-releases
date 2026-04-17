/**
 * logger.js — Main-process logging utility.
 *
 * Appends timestamped lines to <userData>/app.log.
 * Uses fs.appendFile (async, non-blocking) so log writes never block
 * the main process event loop.
 *
 * Usage:
 *   const { log } = require('../services/logger');
 *   log('Drive detected: /Volumes/EOS_DIGITAL');
 *
 * Log location: reported to console on first write so it's easy to find.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// app may not be ready at require-time in some test contexts; resolve lazily.
let _logPath = null;

function getLogPath() {
  if (_logPath) return _logPath;
  const { app } = require('electron');
  _logPath = path.join(app.getPath('userData'), 'app.log');
  return _logPath;
}

let _pathReported = false;

/**
 * Append a log line asynchronously.
 * Failures are printed to stderr but never thrown.
 *
 * @param {string} message
 */
function log(message) {
  const logPath = getLogPath();
  const line    = `[${new Date().toISOString()}] ${message}\n`;

  if (!_pathReported) {
    _pathReported = true;
    console.log('[logger] Writing to:', logPath);
  }

  fs.appendFile(logPath, line, (err) => {
    if (err) console.error('[logger] Write failed:', err.message);
  });
}

module.exports = { log };
