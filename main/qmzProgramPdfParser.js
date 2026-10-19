'use strict';

/**
 * qmzProgramPdfParser.js — PDF-Assisted QMZ Workspace Folder Generation, Stage 2.
 *
 * Reads a QMZ "program" PDF (a numbered list of Q/M/Z/MZ/O/AQ appointments, usually produced
 * from a spreadsheet, one or more cities per document) and returns structured, validated
 * sequence data. Completely independent of the UI and of any filesystem operation — this
 * module NEVER creates, renames, moves, or deletes a QMZ folder, and never touches
 * qmz-sequences.json. It reuses main/qmzService.js's own formatCode/parseCode/letterToType
 * for normalization so the folder-name format can never drift between the two modules (no
 * parallel sequence model — same rule Stage 1 followed for the service layer itself).
 *
 * ── Why pdfjs-dist, and why loaded this way ─────────────────────────────────────────────
 * Electron 30.5.1 (this project's pinned version) embeds Node 20.16.0 — verified directly
 * via process.versions.node inside the real Electron binary, not assumed from package
 * metadata. pdfjs-dist's published versions from 5.5.0 onward require Node >=20.19.0/22.13,
 * which this Electron does not meet; 5.4.624 is the newest version whose own package.json
 * states `engines.node: ">=20.16.0 || >=22.3.0"`, satisfied exactly. Every pdfjs-dist build
 * from at least v4 onward — including its Node-targeted "legacy" build — ships ONLY as an
 * ES Module (`legacy/build/pdf.mjs`, no CommonJS entry point at all, confirmed by inspecting
 * the published package's real file listing). This project's own module system is CommonJS
 * (`package.json` has no "type": "module"; every main/*.js file uses require()/module.exports)
 * — rather than convert the project, this module loads pdfjs-dist via Node's standard,
 * fully-supported `import()` expression (dynamic import from CommonJS code), which Node 20
 * supports with no flag. The loaded module is cached after first use. `disableWorker: true`
 * is passed to getDocument() — verified empirically against both real reference PDFs — so no
 * separate worker thread/script needs to be spawned or packaged; parsing runs synchronously
 * within the calling async function, in-process.
 *
 * ── Table reconstruction approach (verified against both real reference PDFs) ───────────
 * PDF text extraction returns positioned fragments, not semantic rows/cells. pdf.js's own
 * getTextContent() already merges same-baseline, closely-spaced runs into one item per cell
 * in practice (a multi-word name like "Taher bs Aamir bs" arrives as ONE text item, not one
 * per word) and emits separate whitespace-only items for the larger gaps BETWEEN cells. This
 * module:
 *   1. Groups items into rows by Y-coordinate with a small tolerance (sub-baseline fragments
 *      of one logical row differ by <0.5 units; distinct rows differ by ~10+ units in both
 *      reference PDFs — verified directly, not assumed).
 *   2. Locates the header row: the row containing a cell whose trimmed text is exactly
 *      "Sharaf" (case-insensitive) — the confirmed product decision (Phase 5). If no page
 *      contains such a cell, parsing fails safely with a document-level warning and zero
 *      sections — this module never guesses a fallback column.
 *   3. Derives column boundaries from the HEADER ROW's own item X-positions (never
 *      hardcoded pixel coordinates) — each column's region is [its own header X, the next
 *      header cell's X). The sequence-number column is whichever column sits immediately to
 *      the LEFT of "Sharaf" — true in both reference PDFs despite their headers using
 *      different literal labels ("No" vs "Sr"), so this module does not hardcode either name.
 *   4. Buckets every later row's items into these same column regions by X-position, then
 *      classifies each reconstructed row (see _classifyRow).
 *
 * ── City/section detection (verified against the real Dhrangadhra/Lakhtar PDF) ──────────
 * Itinerary/activity banner rows (e.g. "Waaz (Dhrangadhra Masjid)", "Isteraahat") appear
 * liberally WITHIN a single city's block in the real reference PDF and must not be mistaken
 * for a city change — confirmed directly: three such banners appear inside Dhrangadhra's own
 * block before the genuine transition to Lakhtar. The reliable, per-ROW signal present on
 * every real data row is the city-prefix of the trailing Code/Safar-Code column (DGD-/LKR-/
 * SGR- in the two reference documents) and the city token embedded in the Address column —
 * both verified directly from the real extracted text. This module partitions by a change in
 * that row-level evidence (code prefix primarily, Address city-token as a second, independent
 * signal), using a bare/short banner row's text only as a LABEL for an already-detected
 * section, and sequence-number resets only as supporting (not deciding) confirmation — never
 * splits or merges a section on banner text or a number-reset alone. See _detectSections.
 */

const fs   = require('fs/promises');
const path = require('path');

// pdfjs-dist can optionally load its bundled standard-14 font metrics (for a PDF referencing
// e.g. Helvetica without embedding it) via a `standardFontDataUrl` option — tried and reverted:
// pdfjs-dist loads that URL through fetch() internally, which does not support `file://` in
// this Node/Electron context (confirmed directly: the lookup fails with "Unable to load font
// data"). Harmless either way — text extraction remains byte-for-byte correct even when this
// metrics lookup fails, only glyph-width-dependent rendering would be affected, and this
// module never renders — but it is not wired in, since a non-functional option is worse than
// none. Neither real reference PDF triggered this path at all (both embed their own fonts).
const { log } = require('../services/logger');
const { formatCode, parseCode, letterToType } = require('./qmzService');

// Supported QMZ types for this feature — confirmed product decision (Phase 5), extended by
// "QMZ Sequence Enhancements" to add O (Olda) and AQ (Aqeeqa) alongside the original Q/M/Z/MZ.
// Each value is the literal abbreviation the Sharaf column cell already contains — this is
// an exact-string match against an explicit field the program's own authors fill in, never a
// free-text keyword/NLP match against a full word like "Olda" or "Aqeeqa", exactly the same
// mechanism already used for Q/M/Z/MZ (no guessing is introduced by this extension). "N" is
// an explicit, recognized "not a QMZ row" marker in the real reference PDFs (e.g. an escort or
// additional family member listed without a sequence of their own) — it is recognized and
// silently excluded, never flagged as an unrecognized value.
const SHARAF_TYPES = new Set(['Q', 'M', 'Z', 'MZ', 'O', 'AQ']);
const SHARAF_NOT_APPLICABLE = 'N';

// Row-clustering tolerance: sub-baseline fragments of one logical PDF row differ by well
// under 1 unit in both reference documents; distinct rows differ by ~10+ units. A generous
// middle value keeps this robust to PDFs with a different row pitch without ever merging two
// real rows together.
const ROW_Y_TOLERANCE = 2.5;

// Header-cell labels this module looks for, matched case-insensitively against a cell's
// trimmed text. "Sharaf" is the confirmed anchor (Phase 5). The sequence-number column is
// NOT located by name (the two reference PDFs call it "No" and "Sr" respectively, and it is
// NOT adjacent to "Sharaf" — the real column order in both is No/Sr, Name, Sharaf, ...) — it
// is instead the table's own leftmost (first) column, true in both reference PDFs and a far
// more defensible structural signal than guessing at header vocabulary. "Address"/"...code"
// are optional, secondary signals for city detection only — their absence never blocks
// sequence extraction.
const SHARAF_HEADER = 'sharaf';
const ADDRESS_HEADER = 'address';
const CODE_HEADER_RE = /code/i; // matches "Code" and "Safar Code" without hardcoding either

const SEQUENCE_RAW_RE = /^(\d{1,2})([a-zA-Z]?)$/;
const CODE_PREFIX_RE  = /^([A-Za-z]{2,6})-\d+/;

let _pdfjsPromise = null;
function _loadPdfjs() {
  if (!_pdfjsPromise) _pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjsPromise;
}

// ── Low-level: bytes -> per-page rows of {x, str} cells (whitespace-only items dropped) ───

async function _extractPageRows(page) {
  const tc = await page.getTextContent();
  const clusters = []; // [{y, items: [{x, str}]}], sorted top-to-bottom as encountered
  for (const it of tc.items) {
    const text = it.str;
    if (!text || text.trim() === '') continue; // drop explicit inter-cell whitespace items
    const y = it.transform[5];
    const x = it.transform[4];
    let cluster = clusters.find(c => Math.abs(c.y - y) <= ROW_Y_TOLERANCE);
    if (!cluster) { cluster = { y, items: [] }; clusters.push(cluster); }
    cluster.items.push({ x, width: it.width || 0, str: text });
  }
  // PDF y grows upward — sort rows top-to-bottom (descending y) to match reading order.
  clusters.sort((a, b) => b.y - a.y);
  for (const c of clusters) c.items.sort((a, b) => a.x - b.x);
  return clusters;
}

// ── Column detection — anchored on the header row's own item positions, never hardcoded ──

/**
 * Finds the header row (first row containing a cell whose trimmed text is exactly "Sharaf",
 * case-insensitive) and derives column boundaries from ITS OWN item X-positions. Returns
 * null if no such row exists on this page — callers must treat that as "Sharaf column not
 * found", never guess a substitute.
 *
 * @returns {{ headerRowIndex:number, columns: Array<{label:string, left:number, right:number}>,
 *   sharafIndex:number, sequenceIndex:number, addressIndex:number, codeIndex:number } | null}
 */
function _locateColumns(rows) {
  for (let i = 0; i < rows.length; i++) {
    const items = rows[i].items;
    const sharafIdx = items.findIndex(it => it.str.trim().toLowerCase() === SHARAF_HEADER);
    if (sharafIdx === -1) continue;
    // A real header row has several short column-label cells, not just one matching word —
    // guards against a stray data cell that happens to read "Sharaf" in some other context.
    if (items.length < 4) continue;

    // Columns are anchored on each header cell's own X — _bucketRow assigns every data item
    // to its NEAREST header by distance, not by a fixed left/right range (see that function's
    // own comment for why a range-based boundary is not robust enough here).
    const columns = [...items].sort((a, b) => a.x - b.x).map(it => ({ label: it.str.trim(), x: it.x }));
    const sharafIndex = columns.findIndex(c => c.label.toLowerCase() === SHARAF_HEADER);
    if (sharafIndex <= 0) continue; // "Sharaf" must have at least one column to its left
    const sequenceIndex = 0; // the table's leftmost column — verified true in both reference PDFs, not adjacent to Sharaf
    const addressIndex  = columns.findIndex(c => c.label.toLowerCase() === ADDRESS_HEADER);
    const codeIndex      = (() => {
      for (let c = columns.length - 1; c >= 0; c--) if (CODE_HEADER_RE.test(columns[c].label)) return c;
      return -1;
    })();

    return { headerRowIndex: i, columns, sharafIndex, sequenceIndex, addressIndex, codeIndex };
  }
  return null;
}

/** Buckets one row's items into the column regions derived by _locateColumns. */
// A fixed left/right range per column, derived purely from the gap between adjacent header
// LABELS, is not reliable here: a short header word (e.g. "Name") sits well to the right of
// where its own (longer, sometimes visually centered) data values actually start — verified
// directly against the real reference PDFs, where this misclassified data into the wrong
// column for roughly half of all rows depending on each name's exact length/positioning.
// Assigning each item to whichever header it is numerically CLOSEST to (nearest-neighbor by
// X distance, not containment in a strict range) is far more tolerant of that asymmetry and
// was verified to correctly resolve every case the range-based approach got wrong.
function _bucketRow(row, columns) {
  const cells = columns.map(() => []);
  for (const it of row.items) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < columns.length; i++) {
      const d = Math.abs(it.x - columns[i].x);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    cells[bestIdx].push(it.str);
  }
  return cells.map(parts => parts.join(' ').trim());
}

// ── Row classification ─────────────────────────────────────────────────────────────────

/**
 * @returns one of:
 *   { kind: 'data', sequenceRaw, sharaf, addressText, codeText }
 *   { kind: 'excluded', reason: 'sharaf-not-applicable' | 'unrecognized-sharaf' | 'no-sequence-number', sharaf, sequenceRaw }
 *   { kind: 'banner', text }
 *   { kind: 'continuation' }
 */
// The sequence-number value is extracted directly from the ROW's own leading (leftmost) raw
// text item, not from a bucketed "sequence column" cell — verified necessary against the real
// reference PDF: its Name column is visually CENTER-aligned, so a longer name can start
// further left than a shorter one, in some rows sitting closer to the sequence-number column's
// own header position than to "Name"'s (no column-boundary geometry, however derived, can
// cleanly separate a center-aligned column from its neighbor on both sides at once). The
// sequence number, however, is reliably always the FIRST thing on the row — merged with
// trailing name text in that same item or not — so this takes the leading
// digit(s)+optional-letter token off the row's own first item and ignores everything after it
// (the rest is always irrelevant Name content, the confirmed product decision).
function _extractLeadingSequence(row) {
  if (!row.items.length) return null;
  const m = /^(\d{1,2}[a-zA-Z]?)\b/.exec(row.items[0].str.trim());
  return m ? m[1] : null;
}

function _classifyRow(row, cells, layout) {
  const sequenceRaw = _extractLeadingSequence(row) || '';
  const sharaf       = (cells[layout.sharafIndex] || '').trim().toUpperCase();
  const addressText  = layout.addressIndex >= 0 ? (cells[layout.addressIndex] || '').trim() : '';
  const codeText      = layout.codeIndex >= 0 ? (cells[layout.codeIndex] || '').trim() : '';

  const hasSeqShape = SEQUENCE_RAW_RE.test(sequenceRaw);

  if (hasSeqShape && SHARAF_TYPES.has(sharaf)) {
    return { kind: 'data', sequenceRaw, sharaf, addressText, codeText };
  }
  if (sharaf === SHARAF_NOT_APPLICABLE) {
    return { kind: 'excluded', reason: 'sharaf-not-applicable', sharaf, sequenceRaw };
  }
  if (sharaf && !SHARAF_TYPES.has(sharaf)) {
    return { kind: 'excluded', reason: 'unrecognized-sharaf', sharaf, sequenceRaw };
  }
  if (hasSeqShape && !sharaf) {
    // A numbered row with no recognizable QMZ type — per Phase 6, a number alone is never
    // sufficient; flagged distinctly from a plain continuation row (which has no number either).
    return { kind: 'excluded', reason: 'no-sequence-number', sharaf: '', sequenceRaw };
  }
  // No sequence number and no Sharaf value. If the leading (sequence/sharaf/and anything
  // between them) region is otherwise non-blank, treat it as a section/activity banner —
  // real reference-PDF banners commonly spill text leftward into these columns ("Ziyarat -
  // ...", "Waaz (...)"). A row with NOTHING in that leading region (only later columns like
  // Bs Incharge/Travel Time/Address populated) is an ordinary continuation row for the
  // person above — the common case, intentionally low-noise.
  const leadingText = cells.slice(0, layout.sharafIndex + 1).join(' ').trim();
  if (leadingText) return { kind: 'banner', text: leadingText };
  return { kind: 'continuation' };
}

// ── Sequence normalization — delegates to qmzService.js, never reimplements the model ────

/** Parses a raw sequence string like "5", "27", "5a" into { number, suffix } or null. */
function _parseSequenceRaw(raw) {
  const m = SEQUENCE_RAW_RE.exec(raw);
  if (!m) return null;
  return { number: parseInt(m[1], 10), suffix: m[2] ? m[2].toLowerCase() : '' };
}

/**
 * Builds a normalized entry from a classified data row, or a warning if the identifier is
 * one qmzService.js's own model would reject (e.g. a 3-digit number) — this module never
 * accepts a shape that createSequence() would later refuse; it mirrors the real model via
 * formatCode/parseCode rather than re-deriving the rules.
 */
function _normalizeEntry(dataRow, sourcePage, sourceRow) {
  const parsedSeq = _parseSequenceRaw(dataRow.sequenceRaw);
  if (!parsedSeq) {
    return { entry: null, warning: { sourcePage, sourceRow, reason: 'malformed-sequence-number', sequenceRaw: dataRow.sequenceRaw, sharaf: dataRow.sharaf } };
  }
  const folderName = formatCode(parsedSeq.number, dataRow.sharaf, parsedSeq.suffix);
  const reparsed = parseCode(folderName); // round-trip through the real model — the single source of truth for validity
  if (!reparsed) {
    return { entry: null, warning: { sourcePage, sourceRow, reason: 'rejected-by-sequence-model', sequenceRaw: dataRow.sequenceRaw, sharaf: dataRow.sharaf, attemptedFolderName: folderName } };
  }
  return {
    entry: {
      sequence: parsedSeq.suffix ? `${parsedSeq.number}${parsedSeq.suffix}` : String(parsedSeq.number),
      number: reparsed.number,
      suffix: reparsed.suffix,
      letter: reparsed.letter,
      type: reparsed.type || letterToType(reparsed.letter),
      folderName: reparsed.folderName,
      sourcePage,
      sourceRow,
      warnings: [],
    },
    warning: null,
  };
}

// ── Section (city) detection ──────────────────────────────────────────────────────────────

/**
 * Partitions a document-ordered list of classified rows into sections, using (in order of
 * authority): a change in the Code-column's city prefix; failing that, a change in the
 * Address-column's city token; a bare, short banner row is used only to LABEL whichever
 * section it immediately precedes, never to itself decide a boundary; a sequence-number reset
 * is recorded only as supporting corroboration in a section's evidence, never as the sole
 * reason to split. A single-city document (no prefix/address change at all) correctly yields
 * exactly one section. This function never assigns a row to a section with unjustified
 * confidence — see each section's own `cityConfidence`.
 */
function _detectSections(rowRecords) {
  // Column-boundary estimation (derived purely from header-label gaps — see _locateColumns)
  // is necessarily imprecise for a column whose real data is wider than its own short header
  // word; verified directly against the real reference PDFs, the "Mode" column's travel-mode
  // word (Car/Walk/Bike/Auto/Bus) can spill into the start of the adjacent Address cell's
  // bucketed text. Address is only ever a SECONDARY, supporting city signal (never required),
  // so rather than build a heavier content-aware column-width algorithm, this strips the
  // small, closed set of mode words in addition to digit-bearing plus-code tokens.
  const MODE_WORDS = new Set(['car', 'walk', 'bike', 'auto', 'bus', 'rickshaw']);
  const addressCity = (text) => {
    if (!text) return null;
    // Address cells observed in both reference PDFs end in "<City>, <State>" (e.g.
    // "XFX5+793 Dhrangadhra, Gujarat") after a plus-code; take the token before the comma,
    // stripping any leading plus-code/word run that contains a digit (plus-codes always do)
    // and any spilled-over mode-of-transport word.
    const parts = text.split(',');
    const beforeComma = parts[0].trim();
    const words = beforeComma.split(/\s+/).filter(w => !/\d/.test(w) && !MODE_WORDS.has(w.toLowerCase()));
    return words.length ? words.join(' ') : null;
  };
  const codePrefix = (text) => {
    const m = CODE_PREFIX_RE.exec(text || '');
    return m ? m[1].toUpperCase() : null;
  };
  // A bare banner is a short run of text with no itinerary punctuation — "Lakhtar" qualifies,
  // "Waaz (Dhrangadhra Masjid)" and "Ziyarat - Syedi Shaikh..." do not. Conservative by design:
  // only used as a LABEL, so a false negative here only means a section keeps a less specific
  // auto-label — the operator corrects it either way.
  const isBareBannerLabel = (text) => !!text && text.length <= 40 && !/[()\-]/.test(text) && text.split(/\s+/).length <= 4;

  const sections = [];
  let current = null;
  let lastPrefix = null, lastAddressCity = null, pendingLabel = null, prevNumber = null;

  const startSection = () => {
    current = { entries: [], excludedRows: [], prefixes: new Set(), addressCities: new Map(), bannerLabel: pendingLabel, numberResetAt: null };
    sections.push(current);
    pendingLabel = null;
  };

  for (const rec of rowRecords) {
    if (rec.row.kind === 'banner') {
      if (isBareBannerLabel(rec.row.text)) pendingLabel = rec.row.text;
      continue;
    }
    if (rec.row.kind === 'continuation') continue;

    const prefix = rec.row.kind === 'data' ? codePrefix(rec.row.codeText) : (rec.row.reason ? null : null);
    const city   = rec.row.kind === 'data' ? addressCity(rec.row.addressText) : null;

    if (!current) {
      startSection();
    } else if (rec.row.kind === 'data') {
      const prefixChanged = prefix && lastPrefix && prefix !== lastPrefix;
      const cityChanged   = !prefix && city && lastAddressCity && city.toLowerCase() !== lastAddressCity.toLowerCase();
      if (prefixChanged || cityChanged) startSection();
    }

    if (rec.row.kind === 'data') {
      if (prefix) { current.prefixes.add(prefix); lastPrefix = prefix; }
      if (city) { current.addressCities.set(city.toLowerCase(), (current.addressCities.get(city.toLowerCase()) || 0) + 1); lastAddressCity = city; }
      if (rec.entry) {
        if (prevNumber != null && rec.entry.number < prevNumber && !current.numberResetAt) current.numberResetAt = rec.entry.sourceRow;
        prevNumber = rec.entry.number;
        current.entries.push(rec.entry);
      } else if (rec.warning) {
        current.excludedRows.push({ ...rec.warning, kind: 'malformed' });
      }
    } else if (rec.row.kind === 'excluded') {
      if (!current) startSection();
      current.excludedRows.push({ sourcePage: rec.sourcePage, sourceRow: rec.sourceRow, reason: rec.row.reason, sharaf: rec.row.sharaf, sequenceRaw: rec.row.sequenceRaw });
    }
  }

  return sections.map((s, idx) => {
    const topAddressCity = [...s.addressCities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const codePrefixLabel = s.prefixes.size === 1 ? [...s.prefixes][0] : null;
    let cityLabel = s.bannerLabel || (topAddressCity ? topAddressCity.replace(/\b\w/g, c => c.toUpperCase()) : null) || codePrefixLabel;
    let cityConfidence = s.bannerLabel ? 'high' : topAddressCity ? 'medium' : codePrefixLabel ? 'low' : 'low';
    const warnings = [];
    if (!cityLabel) warnings.push({ reason: 'city-undetermined' });
    if (s.prefixes.size > 1) warnings.push({ reason: 'mixed-code-prefixes', prefixes: [...s.prefixes] });

    // Duplicate folderName detection WITHIN this section only — never across sections.
    const byFolder = new Map();
    for (const e of s.entries) byFolder.set(e.folderName, [...(byFolder.get(e.folderName) || []), e.sourceRow]);
    const duplicates = [...byFolder.entries()].filter(([, rows]) => rows.length > 1).map(([folderName, rows]) => ({ folderName, occurrences: rows }));

    return {
      id: `section-${idx + 1}`,
      cityLabel,
      cityConfidence,
      cityEvidence: { codePrefix: codePrefixLabel, addressCity: topAddressCity, bannerText: s.bannerLabel || null, numberResetAt: s.numberResetAt },
      entries: s.entries,
      excludedRows: s.excludedRows,
      duplicates,
      warnings,
    };
  });
}

// ── Public entry point ─────────────────────────────────────────────────────────────────────

/**
 * Parses a QMZ program PDF. `input` is either a file path (string) or raw PDF bytes
 * (Buffer/Uint8Array) — accepting bytes directly keeps this function usable from tests
 * without touching disk. Read-only: never writes, moves, or deletes anything, and never
 * touches qmz-sequences.json or any QMZ folder.
 *
 * @returns {Promise<{source, sections, warnings, fatal}>} — see this file's own header
 *   comment and docs for the full output contract; fatal is non-null only for a condition
 *   that prevented ANY extraction (missing/corrupted/password-protected/image-only file).
 */
async function parseProgramPdf(input) {
  const fileName = typeof input === 'string' ? path.basename(input) : 'inline-buffer';
  const result = { source: { fileName, pageCount: 0 }, sections: [], warnings: [], fatal: null };

  let data;
  try {
    data = typeof input === 'string' ? new Uint8Array(await fs.readFile(input)) : new Uint8Array(input);
  } catch (err) {
    result.fatal = { code: 'unreadable-file', message: err.message };
    return result;
  }
  if (data.length === 0) {
    result.fatal = { code: 'empty-file', message: 'The file is empty.' };
    return result;
  }

  let pdfjsLib, doc;
  try {
    pdfjsLib = await _loadPdfjs();
    doc = await pdfjsLib.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  } catch (err) {
    // pdfjs-dist's PasswordException is not part of its exported public API surface (verified
    // against the installed package — only AbortException/InvalidPDFException/
    // RenderingCancelledException/ResponseException are exported) — detected by error name,
    // the only mechanism pdfjs-dist itself makes available for this case.
    if (err && err.name === 'PasswordException') {
      result.fatal = { code: 'password-protected', message: 'This PDF is password-protected and cannot be read.' };
    } else {
      result.fatal = { code: 'invalid-pdf', message: (err && err.message) || 'The PDF could not be parsed.' };
    }
    log(`[qmz-pdf-parser] ${result.fatal.code}: ${result.fatal.message}`);
    return result;
  }

  result.source.pageCount = doc.numPages;

  let layout = null;
  let totalTextItems = 0;
  const rowRecords = [];
  let globalRowIndex = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const rows = await _extractPageRows(page);
    totalTextItems += rows.reduce((n, r) => n + r.items.length, 0);

    const pageLayout = _locateColumns(rows);
    if (pageLayout && !layout) layout = pageLayout; // first page carrying the header defines the columns for the whole document

    if (!layout) continue; // header not found on this page yet — nothing to classify until it is

    for (let r = 0; r < rows.length; r++) {
      // Skip the header row itself AND anything above it on the page where it was actually
      // found (e.g. a document title line like "14 Sep 2026 (Monday Evening) - Surendranagar"
      // — verified directly: its leading "14" otherwise false-matches the sequence-number
      // pattern and is misclassified as an excluded row rather than recognized as not part of
      // the table at all). Pages without their own repeated header (pageLayout null here)
      // have nothing to skip — every row on them is real table content under the
      // already-established, page-spanning `layout`.
      if (pageLayout && r <= pageLayout.headerRowIndex) continue;
      globalRowIndex++;
      const cells = _bucketRow(rows[r], layout.columns);
      const classified = _classifyRow(rows[r], cells, layout);
      if (classified.kind === 'data') {
        const { entry, warning } = _normalizeEntry(classified, p, globalRowIndex);
        rowRecords.push({ row: classified, entry, warning, sourcePage: p, sourceRow: globalRowIndex });
      } else {
        rowRecords.push({ row: classified, entry: null, warning: null, sourcePage: p, sourceRow: globalRowIndex });
      }
    }
  }

  if (!layout) {
    if (totalTextItems === 0) {
      result.fatal = { code: 'no-extractable-text', message: 'No text could be extracted from this PDF. It may be a scanned/image-only document — OCR is not supported.' };
    } else {
      result.warnings.push({ reason: 'sharaf-column-not-found', message: 'No "Sharaf" column header was found on any page — nothing was extracted.' });
    }
    log(`[qmz-pdf-parser] ${fileName}: ${result.fatal ? result.fatal.code : 'sharaf-column-not-found'}`);
    return result;
  }

  result.sections = _detectSections(rowRecords);
  if (result.sections.every(s => s.entries.length === 0)) {
    result.warnings.push({ reason: 'no-valid-qmz-entries', message: 'No numbered rows with a recognized QMZ type (Q/M/Z/MZ/O/AQ) were found.' });
  }

  log(`[qmz-pdf-parser] ${fileName}: ${result.sections.length} section(s), ${result.sections.reduce((n, s) => n + s.entries.length, 0)} entrie(s)`);
  return result;
}

module.exports = {
  parseProgramPdf,
  // Exported for focused unit testing only — not part of the module's conceptual public API.
  _extractPageRows,
  _locateColumns,
  _bucketRow,
  _classifyRow,
  _detectSections,
  _normalizeEntry,
};
