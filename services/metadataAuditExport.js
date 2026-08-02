'use strict';

/**
 * metadataAuditExport.js — streams a completed metadataAuditService job report to
 * disk in JSON, JSONL, or CSV form (plan §9's export-correctness-at-scale
 * requirements). Never buffers the full report in memory; always writes to a
 * `<dest>.tmp` file and renames on success, so a cancelled/failed export never
 * leaves a file that looks complete.
 */

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { _statePath, _reportPath } = require('./metadataAuditService');

const CSV_FIELD_COLUMNS = ['photographer', 'description', 'location', 'city', 'country', 'copyright', 'hijriDate'];

function _isCompliant(status) {
  return status === 'complete' || status === 'excluded';
}

/** RFC 4180-style quoting: quote whenever the value contains a comma, quote, or newline. */
function _csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function _csvRow(values) {
  return values.map(_csvCell).join(',') + '\r\n';
}

function _csvHeader() {
  const cols = ['filePath', 'eventFolderPath', 'fileType', 'status', 'photographer', 'component', 'ambiguityReason', 'error'];
  for (const f of CSV_FIELD_COLUMNS) cols.push(`${f}_status`, `${f}_expected`, `${f}_actual`);
  cols.push('keywords_missing', 'keywords_unexpected', 'keywords_duplicates', 'keywords_caseVariants', 'keywords_whitespaceVariants');
  return cols;
}

function _csvRowFor(rec) {
  const row = [
    rec.filePath, rec.eventFolderPath, rec.fileType, rec.status,
    rec.photographer || '', rec.component || '', rec.ambiguityReason || '', rec.error || '',
  ];
  for (const f of CSV_FIELD_COLUMNS) {
    const d = rec.fields ? rec.fields[f] : null;
    row.push(d?.status || '', d?.expected ?? '', d?.actual ?? '');
  }
  const kw = rec.keywords;
  row.push(
    kw ? kw.missing.join('; ') : '',
    kw ? kw.unexpected.join('; ') : '',
    kw ? kw.duplicates.map(d => `${d.keyword} x${d.count}`).join('; ') : '',
    kw ? kw.caseVariants.map(v => `${v.expected}→${v.actual}`).join('; ') : '',
    kw ? kw.whitespaceVariants.map(v => `${v.expected}→${v.actual}`).join('; ') : '',
  );
  return row;
}

async function _readState(jobId) {
  return JSON.parse(await fsp.readFile(_statePath(jobId), 'utf8'));
}

async function _forEachRecord(jobId, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(_reportPath(jobId)), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    await fn(rec);
  }
}

function _reportMetadata(state) {
  return {
    jobId: state.jobId, scope: state.scope, metadataContractVersion: state.metadataContractVersion,
    resolverVersion: state.resolverVersion, appVersion: state.appVersion,
    archiveRootIdentity: state.archiveRootIdentity, startedAt: state.startedAt, completedAt: state.completedAt,
    resumedOverChangedScope: state.resumedOverChangedScope || false,
    scannedCount: state.scannedCount, exceptionCount: state.exceptionCount,
  };
}

/**
 * @param {string} jobId
 * @param {{format:'json'|'jsonl'|'csv', destPath:string, exceptionsOnly?:boolean}} opts
 * @returns {Promise<{ok:boolean, path?:string, reason?:string}>}
 */
async function exportMetadataAuditReport(jobId, opts) {
  const { format, destPath, exceptionsOnly = false } = opts;
  const state = await _readState(jobId).catch(() => null);
  if (!state) return { ok: false, reason: 'job-not-found' };

  const tmpPath = destPath + '.tmp';
  const out = fs.createWriteStream(tmpPath);
  const writeAsync = (chunk) => new Promise((resolve, reject) => out.write(chunk, err => err ? reject(err) : resolve()));

  try {
    if (format === 'json') {
      await writeAsync('{"reportMetadata":' + JSON.stringify(_reportMetadata(state))
        + ',"aggregates":' + JSON.stringify(state.aggregates) + ',"items":[');
      let first = true;
      await _forEachRecord(jobId, async (rec) => {
        if (exceptionsOnly && _isCompliant(rec.status)) return;
        await writeAsync((first ? '' : ',') + JSON.stringify(rec));
        first = false;
      });
      await writeAsync(']}');
    } else if (format === 'jsonl') {
      await _forEachRecord(jobId, async (rec) => {
        if (exceptionsOnly && _isCompliant(rec.status)) return;
        await writeAsync(JSON.stringify(rec) + '\n');
      });
    } else if (format === 'csv') {
      await writeAsync(_csvRow(_csvHeader()));
      await _forEachRecord(jobId, async (rec) => {
        if (exceptionsOnly && _isCompliant(rec.status)) return;
        await writeAsync(_csvRow(_csvRowFor(rec)));
      });
    } else {
      throw new Error(`Unknown export format: ${format}`);
    }
  } catch (err) {
    await new Promise(resolve => out.end(resolve));
    await fsp.unlink(tmpPath).catch(() => {});
    return { ok: false, reason: err.message };
  }

  await new Promise(resolve => out.end(resolve));
  await fsp.rename(tmpPath, destPath);

  // CSV/JSONL carry no structured-metadata home of their own — write the same
  // reproducibility metadata to a companion sidecar rather than into the data file.
  if (format === 'csv' || format === 'jsonl') {
    const metaPath = destPath + '.meta.json';
    const metaTmp = metaPath + '.tmp';
    await fsp.writeFile(metaTmp, JSON.stringify({ reportMetadata: _reportMetadata(state), aggregates: state.aggregates, exceptionsOnly }, null, 2), 'utf8');
    await fsp.rename(metaTmp, metaPath);
  }

  return { ok: true, path: destPath };
}

module.exports = { exportMetadataAuditReport, _csvCell, _csvRow, _csvHeader, _csvRowFor, CSV_FIELD_COLUMNS };
