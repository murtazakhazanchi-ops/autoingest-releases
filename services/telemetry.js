'use strict';
/**
 * services/telemetry.js
 *
 * Single pipeline that ALL reports flow through — crash, performance, feedback.
 * Nothing in the app posts to Google Sheets directly; everything calls enqueue().
 *
 * SETUP (one-time):
 *  1. console.cloud.google.com → New Project → Enable Google Sheets API
 *  2. Create Service Account → download JSON key
 *  3. Save key as config/service-account-key.json
 *  4. Share your tracker sheet with the service account email (Editor)
 *  5. Set SHEET_ID below to your sheet ID (from the URL)
 *
 * Until credentials are configured the queue drains silently — no crashes.
 */

const fs   = require('fs');
const path = require('path');

const TELEMETRY_ENABLED = true;   // set false to instantly disable all telemetry

// ── Config — fill these in ────────────────────────────────────────────────────
const SHEET_ID    = '1FKOL4bqScljgI8YPIMuCRNa0V7PtElnDFYaTYGx4TgU';      // ← paste your sheet ID here
const SHEET_RANGE = "'Bug Tracker'!A:S";
const KEY_PATH    = path.join(__dirname, '../config/service-account-key.json');

// Dedup window: ignore identical reports within this period (ms)
const DEDUP_WINDOW_MS = 60_000;
const FLUSH_INTERVAL  = 30_000;   // flush queue every 30 s
const MAX_QUEUE_SIZE  = 500;      // oldest entries dropped first when full (FIFO)

// ── State ─────────────────────────────────────────────────────────────────────
const recentHashes        = new Map();  // hash → { firstSeen, count }
let   queue               = [];
let   isFlushing          = false;
let   queuePath           = null;
let   flushTimer          = null;
let   consecutiveFailures = 0;

// ── Bootstrap — call once after app.whenReady() ───────────────────────────────
function init() {
  if (!TELEMETRY_ENABLED) return;
  const { app } = require('electron');
  queuePath = path.join(app.getPath('userData'), 'telemetry-queue.json');

  // Load any unsent reports from previous session; cap at MAX_QUEUE_SIZE
  try {
    if (fs.existsSync(queuePath)) {
      const saved = JSON.parse(fs.readFileSync(queuePath, 'utf8')) || [];
      queue = saved.slice(-MAX_QUEUE_SIZE);
    }
  } catch { queue = []; }

  flushTimer = setInterval(flush, FLUSH_INTERVAL);
  if (flushTimer.unref) flushTimer.unref();

  app.on('before-quit', () => {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    persistQueue();
    flush().catch(() => {});
  });
}

// ── Enqueue a report ──────────────────────────────────────────────────────────
/**
 * @param {object} report
 *   type        {string}  'crash' | 'error' | 'performance' | 'feedback'
 *   issueType   {string}  matches Bug Tracker Issue Type dropdown
 *   severity    {string}  'Critical' | 'High' | 'Medium' | 'Low'
 *   description {string}
 *   reporter    {string}  optional — defaults to 'Auto-report'
 *   context     {object}  extra key/value pairs — stored in Notes column
 */

function enqueue(report) {
  if (!TELEMETRY_ENABLED) return;
  const src  = (report.context && report.context.source) ? report.context.source : '';
  const hash = `${report.type}|${String(report.description || '').slice(0, 80)}|${src}`;
  const now  = Date.now();

  // Clean expired entries to prevent map growing unbounded
  for (const [k, v] of recentHashes) {
    if (now - v.firstSeen >= DEDUP_WINDOW_MS) recentHashes.delete(k);
  }

  const entry = recentHashes.get(hash);
  if (entry && (now - entry.firstSeen) < DEDUP_WINDOW_MS) {
    entry.count++;
    if (entry.count !== 2) return;
  } else {
    recentHashes.set(hash, { firstSeen: now, count: 1 });
  }

  while (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push(buildRow(report));
  persistQueue();
}

// ── Build a sheet row (columns A-S) ──────────────────────────────────────────
function buildRow(report) {
  let version  = '?';
  let platform = process.platform === 'darwin' ? 'Mac' : 'Windows';
  try {
    version = require('../package.json').version;
  } catch {}

  const date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const ctxObj = { ...(report.context || {}), submittedBy: report.reporter || 'Auto-report' };
  const notes  = Object.entries(ctxObj)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');

  return [
    Date.now(),                               // A: ID   (unix timestamp, always unique)
    date,                                     // B: Date
    report.reporter    || 'Auto-report',      // C: Reporter
    version,                                  // D: Version
    report.device      || platform,           // E: Device
    report.cardType    || '',                 // F: Card Type
    report.fileVolume  || '',                 // G: File Volume
    report.action      || report.type || '',  // H: Action Taken
    report.issueType   || 'Other',            // I: Issue Type
    String(report.description || '').slice(0, 500), // J: Description
    report.expected    || '',                 // K: Expected
    report.actual      || '',                 // L: Actual
    report.importResult || '',                // M: Import Result
    'No',                                     // N: Screenshot
    report.logShared ? 'Yes' : 'No',          // O: Log Shared
    report.severity    || 'Medium',           // P: Severity
    'New',                                    // Q: Status
    '',                                       // R: Assigned To
    notes,                                    // S: Notes
  ];
}

// ── Flush: send queue to Sheets ───────────────────────────────────────────────
async function flush() {
  if (!TELEMETRY_ENABLED) return;
  if (isFlushing || queue.length === 0) return;

  // Silently skip if credentials not configured
  if (!fs.existsSync(KEY_PATH)) return;
  if (SHEET_ID === 'YOUR_GOOGLE_SHEET_ID') return;

  isFlushing = true;
  const batch = [...queue];

  try {
    const { google } = require('googleapis');
    const key  = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    const auth = new google.auth.JWT(
      key.client_email, null, key.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId:    SHEET_ID,
      range:            SHEET_RANGE,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: batch },
    });

     consecutiveFailures = 0;
    queue = queue.filter(row => !batch.includes(row));
    persistQueue();
    // Restart timer if it was stopped by a previous failure streak
    if (!flushTimer) {
      flushTimer = setInterval(flush, FLUSH_INTERVAL);
      if (flushTimer.unref) flushTimer.unref();
    }
  } catch {
    consecutiveFailures++;
    if (consecutiveFailures >= 5 && flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  } finally {
    isFlushing = false;
  }
}

// ── Persist queue to disk ─────────────────────────────────────────────────────
function persistQueue() {
  if (!queuePath) return;
  try { fs.writeFileSync(queuePath, JSON.stringify(queue), 'utf8'); } catch {}
}

module.exports = { init, enqueue, flush, isEnabled: () => TELEMETRY_ENABLED };
