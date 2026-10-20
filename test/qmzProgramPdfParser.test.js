'use strict';

// Regression suite for main/qmzProgramPdfParser.js (Stage 2 of "PDF-Assisted QMZ Workspace
// Folder Generation"). Uses only SYNTHETIC, hand-constructed PDF fixtures built by the tiny
// writer below — the two real reference PDFs ("Monday Evening Surendranagar...", "Day 6
// Program (Dhrangadhra - Lakhtar)") contain real names, phone numbers and ITS IDs and are
// deliberately NOT committed to this repository; they were used only for ad-hoc,
// uncommitted ground-truth verification during development (see the Stage 2 implementation
// report). The synthetic fixtures below reproduce the exact STRUCTURAL shapes the real
// documents were found to have (header-anchored columns, a center-aligned Name-style column
// whose longer values can start left of a shorter neighbor's header word, letter-suffixed
// sequences, the combined "MZ" type, multi-city sections, itinerary-style banners inside a
// single city's block, and "N"/unnumbered continuation rows) without containing any real
// person's data.
//
// Requires the real Electron binary (this module's own dependency chain pulls in
// services/logger.js, which needs Electron's app.getPath — same constraint as every other
// qmz*.test.js in this project):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/qmzProgramPdfParser.test.js

const assert = require('node:assert/strict');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}
async function t(name, fn) {
  try { await fn(); ok(name); }
  catch (err) { fail(name, err && err.stack || err); }
}

// ── Minimal synthetic PDF writer ──────────────────────────────────────────────────────────
// Emits a single-page, uncompressed, unencrypted PDF with each requested text placed at an
// ABSOLUTE position via a text matrix (`Tm`) — no font embedding, standard Helvetica only.
// pdf.js reports exactly the x/y given here via its own transform[4]/[5], confirmed directly
// against this writer's own output, which is what makes deterministic, hand-designed table
// layouts possible for testing column/row reconstruction without a real document.
function _esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function makeSyntheticPdf(cells, { width = 842, height = 595 } = {}) {
  const ops = ['BT', '/F1 10 Tf'];
  for (const c of cells) ops.push(`1 0 0 1 ${c.x} ${c.y} Tm (${_esc(c.text)}) Tj`);
  ops.push('ET');
  const stream = ops.join('\n');

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/** A PDF with NO text operators at all — simulates a scanned/image-only page (no text layer). */
function makeBlankPagePdf({ width = 842, height = 595 } = {}) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

// ── Synthetic table builder — mirrors the real reference PDFs' verified column shape:
// No, Name, Sharaf, Floor, Code — with the Name column deliberately "center-aligned" (longer
// values start further left) to exercise the exact ambiguity the real parser had to solve. ──
const HEADER_Y = 560;
const ROW_H = 11; // real reference PDFs: ~10.2-10.7 unit pitch between distinct rows
const COL = { no: 50, name: 150, sharaf: 320, floor: 360, code: 460 };

function centeredNameX(text) {
  // Crude visual-centering simulation, DELIBERATELY BOUNDED: a longer name starts somewhat
  // further left of the column anchor (exercising the exact ambiguity that defeated simple
  // header-adjacent-range column boundaries against the real PDFs), but the shift is capped
  // well short of colliding with the Sharaf column — an earlier, unbounded version of this
  // helper could push a long enough name's rendered END past Sharaf's start, at which point
  // pdf.js's OWN internal text-run merging (not this module's column logic) legitimately fuses
  // the two into a single text item, which no column-reconstruction approach can un-merge.
  // Neither real reference PDF ever exhibited that collision (verified directly against both),
  // so reproducing it here would not be a representative test — it would be testing an
  // artifact of this fixture's own formula, not real-world PDF behavior.
  return COL.name - Math.min(30, Math.max(0, (text.length - 12) * 1.1));
}

function headerRow(y) {
  return [{ text: 'No', x: COL.no, y }, { text: 'Name', x: COL.name, y }, { text: 'Sharaf', x: COL.sharaf, y }, { text: 'Floor', x: COL.floor, y }, { text: 'Code', x: COL.code, y }];
}
/** A genuine numbered data row. `seq` may include a lowercase/uppercase letter suffix (e.g. "5a"). */
function dataRow(y, seq, name, sharaf, code) {
  return [{ text: seq, x: COL.no, y }, { text: name, x: centeredNameX(name), y }, { text: sharaf, x: COL.sharaf, y }, { text: 'G', x: COL.floor, y }, { text: code, x: COL.code, y }].filter(c => c.text !== '');
}
/** An "N" row — a named entry explicitly marked as not a QMZ appointment. */
function naRow(y, name, code) {
  return [{ text: name, x: centeredNameX(name), y }, { text: 'N', x: COL.sharaf, y }, { text: code, x: COL.code, y }];
}
/** An itinerary-style banner row whose text spills into the leading (No/Name/Sharaf) region. */
function bannerRow(y, text) {
  return [{ text, x: COL.no + 60, y }];
}
/** A pure continuation row — content ONLY in a column after Sharaf, nothing in the leading region. */
function continuationRow(y, floorText) {
  return [{ text: floorText, x: COL.floor, y }];
}

function buildTable(rows) {
  const cells = [...headerRow(HEADER_Y)];
  rows.forEach((r, i) => cells.push(...r(HEADER_Y - ROW_H * (i + 1))));
  return makeSyntheticPdf(cells);
}

let _parse;

(async () => {
  ({ parseProgramPdf: _parse } = require(path.join(PROJECT_ROOT, 'main/qmzProgramPdfParser')));
  const P = require(path.join(PROJECT_ROOT, 'main/qmzProgramPdfParser'));

  // ═══════════════════ GROUP A — single-city document (Surendranagar-shaped) ═══════════════
  console.log('=== GROUP A: single-city document ===');
  {
    const pdf = buildTable([
      y => dataRow(y, '1', 'Test Person One Alpha', 'Q', 'TCA-0001'),
      y => dataRow(y, '2', 'Test Person Two', 'Q', 'TCA-0002'),
      y => dataRow(y, '3', 'Test Person Three Beta Gamma', 'Z', 'TCA-0003'),
      y => naRow(y, 'Extra Escort Person', 'TCA-0094'),
      y => dataRow(y, '4', 'Test Person Four', 'M', 'TCA-0004'),
      y => continuationRow(y, 'extra incharge note'),
      y => dataRow(y, '5', 'Test Person Five Longname Extra Words', 'M', 'TCA-0005'),
    ]);
    const r = await _parse(pdf);

    await t('A1: no fatal error, no document-level warnings', () => {
      assert.equal(r.fatal, null);
      assert.deepStrictEqual(r.warnings, []);
    });
    await t('A2: exactly one city section', () => { assert.equal(r.sections.length, 1); });
    await t('A3: correct sequence extraction and folder names, in original order', () => {
      assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02Q', '03Z', '04M', '05M']);
    });
    await t('A4: correct Sharaf type extraction (type labels)', () => {
      assert.deepStrictEqual(r.sections[0].entries.map(e => e.type), ['Qadam', 'Qadam', 'Ziyafat', 'Majlis', 'Majlis']);
    });
    await t('A5: the "N" row is ignored for folder generation but recorded as excluded', () => {
      assert.ok(!r.sections[0].entries.some(e => e.folderName.includes('N')));
      assert.ok(r.sections[0].excludedRows.some(x => x.reason === 'sharaf-not-applicable'));
    });
    await t('A6: no accidental entries from unrelated table data (continuation row produced nothing)', () => {
      assert.equal(r.sections[0].entries.length, 5);
    });
    await t('A7: accurate extracted-entry count and no unexpected duplicates', () => {
      assert.equal(r.sections[0].entries.length, 5);
      assert.deepStrictEqual(r.sections[0].duplicates, []);
    });
    await t('A8: source page/row references are present and increasing', () => {
      const rows = r.sections[0].entries.map(e => e.sourceRow);
      assert.ok(rows.every((v, i) => i === 0 || v > rows[i - 1]));
      assert.ok(r.sections[0].entries.every(e => e.sourcePage === 1));
    });
  }

  // ═══════════════════ GROUP B — two-city document (Dhrangadhra/Lakhtar-shaped) ════════════
  console.log('=== GROUP B: two-city document, letter suffix, combined type ===');
  {
    const pdf = buildTable([
      y => dataRow(y, '1', 'City A Person One', 'Q', 'TCA-0001'),
      y => dataRow(y, '2', 'City A Person Two', 'Q', 'TCA-0002'),
      y => bannerRow(y, 'Ziyarat - Some Activity Heading'), // itinerary banner INSIDE city A — must not split
      y => dataRow(y, '3', 'City A Person Three', 'Q', 'TCA-0003'),
      y => dataRow(y, '4', 'City A Person Four', 'Q', 'TCA-0004'),
      y => bannerRow(y, 'Waaz (Some Masjid)'), // another itinerary banner INSIDE city A
      y => dataRow(y, '5', 'City A Person Five', 'Q', 'TCA-0005'),
      y => dataRow(y, '5a', 'City A Split Honoree A', 'MZ', 'TCA-0006'),
      y => dataRow(y, '5b', 'City A Split Honoree B', 'MZ', 'TCA-0007'),
      y => dataRow(y, '6', 'City A Person Six', 'Q', 'TCA-0008'),
      y => dataRow(y, '7', 'City A Person Seven', 'Q', 'TCA-0009'),
      y => bannerRow(y, 'TestCityB'), // bare city-name banner — the genuine city transition
      y => dataRow(y, '1', 'City B Person One', 'M', 'TCB-0001'),
      y => dataRow(y, '2', 'City B Person Two', 'Q', 'TCB-0002'),
      y => dataRow(y, '3', 'City B Person Three', 'Q', 'TCB-0003'),
    ]);
    const r = await _parse(pdf);

    await t('B1: exactly two genuine city sections (itinerary banners inside a city do not split it)', () => {
      assert.equal(r.sections.length, 2);
    });
    await t('B2: City A correctly identified with its own entries, independent numbering', () => {
      assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02Q', '03Q', '04Q', '05Q', '05aMZ', '05bMZ', '06Q', '07Q']);
    });
    await t('B3: City B correctly identified — numbering reset does NOT merge it into City A', () => {
      assert.deepStrictEqual(r.sections[1].entries.map(e => e.folderName), ['01M', '02Q', '03Q']);
    });
    await t('B4: the bare banner "TestCityB" became City B\'s suggested label (high confidence)', () => {
      assert.equal(r.sections[1].cityLabel, 'TestCityB');
      assert.equal(r.sections[1].cityConfidence, 'high');
    });
    await t('B5: 05aMZ extracted correctly — number 5, suffix "a", combined type MZ', () => {
      const e = r.sections[0].entries.find(x => x.folderName === '05aMZ');
      // "QMZ Sequence Enhancements" relabeled MZ's display type from "Majlis + Ziyafat" to
      // "Majmui Ziyafat" — MZ itself is unchanged, only this string.
      assert.ok(e); assert.equal(e.number, 5); assert.equal(e.suffix, 'a'); assert.equal(e.letter, 'MZ'); assert.equal(e.type, 'Majmui Ziyafat');
    });
    await t('B6: 05bMZ extracted correctly', () => {
      const e = r.sections[0].entries.find(x => x.folderName === '05bMZ');
      assert.ok(e); assert.equal(e.suffix, 'b'); assert.equal(e.letter, 'MZ');
    });
    await t('B7: MZ preserved as ONE combined type — never split into a separate M and Z entry', () => {
      assert.ok(!r.sections[0].entries.some(e => e.folderName === '05aM' || e.folderName === '05aZ'));
    });
    await t('B8: repeated sequence numbers across the two cities are not flagged as duplicates', () => {
      assert.deepStrictEqual(r.sections[0].duplicates, []);
      assert.deepStrictEqual(r.sections[1].duplicates, []);
    });
    await t('B9: correct order within each city, accurate entry counts', () => {
      assert.equal(r.sections[0].entries.length, 9);
      assert.equal(r.sections[1].entries.length, 3);
    });
    await t('B10: City A\'s section carries its own code-prefix evidence, distinct from City B\'s', () => {
      assert.equal(r.sections[0].cityEvidence.codePrefix, 'TCA');
      assert.equal(r.sections[1].cityEvidence.codePrefix, 'TCB');
    });
  }

  // ═══════════════════ GROUP C — normalization ═══════════════════
  console.log('=== GROUP C: normalization ===');
  await t('C1: 1Q -> 01Q, 2M -> 02M, 10Q -> 10Q through the real parser (not just the Stage 1 model directly)', async () => {
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person', 'Q', 'X-0001'),
      y => dataRow(y, '2', 'Person', 'M', 'X-0002'),
      y => dataRow(y, '10', 'Person', 'Q', 'X-0003'),
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02M', '10Q']);
  });
  await t('C2: 5aMZ / 5bMZ -> 05aMZ / 05bMZ through the real parser', async () => {
    const pdf = buildTable([y => dataRow(y, '5a', 'Person', 'MZ', 'X-0001'), y => dataRow(y, '5b', 'Person', 'MZ', 'X-0002')]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['05aMZ', '05bMZ']);
  });
  await t('C3: an uppercase source suffix still normalizes to a lowercase folder name', () => {
    const { entry } = P._normalizeEntry({ kind: 'data', sequenceRaw: '5A', sharaf: 'MZ' }, 1, 1);
    assert.ok(entry);
    assert.equal(entry.folderName, '05aMZ', 'canonical output must be lowercase regardless of source case');
    assert.equal(entry.suffix, 'a');
  });

  // ═══════════════════ GROUP D — malformed input ═══════════════════
  console.log('=== GROUP D: malformed input ===');
  await t('D1: missing Sharaf header — fails safely with zero sections and an explicit warning, never guesses', async () => {
    const pdf = makeSyntheticPdf([
      { text: 'No', x: COL.no, y: HEADER_Y }, { text: 'Name', x: COL.name, y: HEADER_Y }, { text: 'Type', x: COL.sharaf, y: HEADER_Y },
      { text: '1', x: COL.no, y: HEADER_Y - ROW_H }, { text: 'Person', x: COL.name, y: HEADER_Y - ROW_H }, { text: 'Q', x: COL.sharaf, y: HEADER_Y - ROW_H },
    ]);
    const r = await _parse(pdf);
    assert.equal(r.fatal, null);
    assert.equal(r.sections.length, 0);
    assert.ok(r.warnings.some(w => w.reason === 'sharaf-column-not-found'));
  });
  await t('D2: an unrecognized (non-blank, non-N, non-Q/M/Z/MZ) Sharaf value is excluded and flagged, never silently accepted', async () => {
    const pdf = buildTable([y => dataRow(y, '1', 'Person', 'X', 'TCA-0001')]);
    const r = await _parse(pdf);
    assert.equal(r.sections[0].entries.length, 0);
    assert.ok(r.sections[0].excludedRows.some(x => x.reason === 'unrecognized-sharaf' && x.sharaf === 'X'));
  });
  await t('D3: a numbered row with no Sharaf type is excluded, not silently guessed', async () => {
    const pdf = makeSyntheticPdf([...headerRow(HEADER_Y), { text: '1', x: COL.no, y: HEADER_Y - ROW_H }, { text: 'Person', x: COL.name, y: HEADER_Y - ROW_H }]);
    const r = await _parse(pdf);
    assert.equal(r.sections[0]?.entries.length || 0, 0);
    assert.ok(r.sections[0]?.excludedRows.some(x => x.reason === 'no-sequence-number'));
  });
  await t('D4: duplicate rows within the same city are detected and reported, not silently dropped', async () => {
    const pdf = buildTable([
      y => dataRow(y, '5', 'Person One', 'Q', 'TCA-0001'),
      y => dataRow(y, '5', 'Person Two (different person, same code)', 'Q', 'TCA-0002'),
    ]);
    const r = await _parse(pdf);
    assert.equal(r.sections[0].entries.length, 2, 'both rows are still preserved, not merged away');
    assert.deepStrictEqual(r.sections[0].duplicates, [{ folderName: '05Q', occurrences: [1, 2] }]);
  });
  await t('D5: an empty (zero-byte) file fails safely with a fatal, non-crashing result', async () => {
    const r = await _parse(Buffer.alloc(0));
    assert.ok(r.fatal);
    assert.equal(r.fatal.code, 'empty-file');
  });
  await t('D6: a corrupted/non-PDF byte sequence fails safely with a fatal, non-crashing result', async () => {
    const r = await _parse(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.ok(r.fatal);
    assert.equal(r.fatal.code, 'invalid-pdf');
  });
  await t('D7: a missing file path fails safely rather than throwing out of parseProgramPdf', async () => {
    const r = await _parse('/nonexistent/path/does-not-exist.pdf');
    assert.ok(r.fatal);
    assert.equal(r.fatal.code, 'unreadable-file');
  });
  await t('D8: a page with no text layer at all is reported as needing OCR, never a silent empty success', async () => {
    const r = await _parse(makeBlankPagePdf());
    assert.ok(r.fatal);
    assert.equal(r.fatal.code, 'no-extractable-text');
  });
  await t('D9: a table with a header but zero data rows yields a clear "no valid entries" warning, not a crash', async () => {
    const pdf = makeSyntheticPdf(headerRow(HEADER_Y));
    const r = await _parse(pdf);
    assert.equal(r.fatal, null);
    assert.ok(r.warnings.some(w => w.reason === 'no-valid-qmz-entries'));
  });

  // ═══════════════════ GROUP E — section detection ═══════════════════
  console.log('=== GROUP E: section detection ===');
  await t('E1: a one-city PDF yields exactly one section even with no banner text anywhere', async () => {
    const pdf = buildTable([y => dataRow(y, '1', 'Person', 'Q', 'ONLY-0001'), y => dataRow(y, '2', 'Person', 'Q', 'ONLY-0002')]);
    const r = await _parse(pdf);
    assert.equal(r.sections.length, 1);
  });
  await t('E2: code-prefix change alone (no banner, no number reset) is sufficient to detect a city transition', async () => {
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person', 'Q', 'AAA-0001'),
      y => dataRow(y, '2', 'Person', 'Q', 'AAA-0002'),
      y => dataRow(y, '3', 'Person', 'Q', 'BBB-0003'), // different prefix, numbering does NOT reset
      y => dataRow(y, '4', 'Person', 'Q', 'BBB-0004'),
    ]);
    const r = await _parse(pdf);
    assert.equal(r.sections.length, 2);
    assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02Q']);
    assert.deepStrictEqual(r.sections[1].entries.map(e => e.folderName), ['03Q', '04Q']);
  });
  await t('E3: a city missing from data/cities.json is still fully detectable (never used as an allow-list)', async () => {
    const pdf = buildTable([y => bannerRow(y, 'NotARealRegisteredCityXyz'), y => dataRow(y, '1', 'Person', 'Q', 'ZZZ-0001')]);
    const r = await _parse(pdf);
    assert.equal(r.sections[0].cityLabel, 'NotARealRegisteredCityXyz');
  });
  await t('E4: number-reset evidence is recorded but never used as the sole reason to split a section on its own', async () => {
    // Same code prefix throughout, numbering genuinely resets (e.g. a second page/list within
    // the same city) — must stay ONE section; the reset is recorded as supporting evidence only.
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person', 'Q', 'SAME-0001'),
      y => dataRow(y, '2', 'Person', 'Q', 'SAME-0002'),
      y => dataRow(y, '1', 'Person', 'Q', 'SAME-0003'),
    ]);
    const r = await _parse(pdf);
    assert.equal(r.sections.length, 1, 'a number reset alone, with no corroborating prefix/address change, must not split a section');
    assert.ok(r.sections[0].cityEvidence.numberResetAt != null, 'the reset is still recorded as evidence');
  });
  await t('E5: an uncertain city still returns an identifiable section rather than being dropped', async () => {
    const pdf = makeSyntheticPdf([...headerRow(HEADER_Y), ...dataRow(HEADER_Y - ROW_H, '1', 'Person', 'Q', '')]); // no code, no banner anywhere
    const r = await _parse(pdf);
    assert.equal(r.sections.length, 1);
    assert.equal(r.sections[0].entries.length, 1);
    assert.ok(r.sections[0].warnings.some(w => w.reason === 'city-undetermined'));
  });

  // ═══════════════════ GROUP F — safety ═══════════════════
  console.log('=== GROUP F: safety ===');
  const fs = require('fs/promises'), os = require('os');
  await t('F1-F6: parsing performs NO filesystem writes anywhere (no folders, no QMZ state, no renames, no source mutation)', async () => {
    const watchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-pdf-safety-'));
    const before = await fs.readdir(watchDir);
    const pdf = buildTable([y => dataRow(y, '5', 'Person', 'MZ', 'TCA-0001')]);
    const pdfPath = path.join(watchDir, 'synthetic.pdf');
    await fs.writeFile(pdfPath, pdf);
    const beforeBytes = await fs.readFile(pdfPath);
    await _parse(pdfPath);
    const afterBytes = await fs.readFile(pdfPath);
    const after = await fs.readdir(watchDir);
    assert.deepStrictEqual(after.sort(), [...before, 'synthetic.pdf'].sort(), 'no file or folder besides the input PDF itself was created');
    assert.deepStrictEqual(beforeBytes, afterBytes, 'the source PDF itself was never modified');
    await fs.rm(watchDir, { recursive: true, force: true });
  });
  await t('F7: repeated parsing of the same input is deterministic', async () => {
    const pdf = buildTable([y => dataRow(y, '5', 'Person', 'MZ', 'TCA-0001'), y => dataRow(y, '6', 'Person', 'Q', 'TCA-0002')]);
    const r1 = await _parse(pdf);
    const r2 = await _parse(pdf);
    assert.deepStrictEqual(r1, r2);
  });
  await t('F8: invalid input fails safely (no throw out of the public API, non-crashing result object)', async () => {
    const r = await _parse(Buffer.from('not a pdf at all'));
    assert.equal(typeof r, 'object');
    assert.ok(r.fatal);
  });
  await t('F9: no personal-looking free-text (Name-column content) leaks into the structured output', async () => {
    const pdf = buildTable([y => dataRow(y, '1', 'Secret Person Name Should Not Leak', 'Q', 'TCA-0001')]);
    const r = await _parse(pdf);
    const serialized = JSON.stringify(r);
    assert.ok(!serialized.includes('Secret Person Name'), 'the Name column\'s free text must never appear anywhere in the parser output');
  });

  // ═══════════════════ GROUP G — real operator report: "AutoIngest — QMZ PDF Import Missing
  // Sequences". Root-caused against a real QMZ program PDF (not committed — contains real
  // names/phone numbers/ITS IDs; verified live, uncommitted, during development, same
  // discipline as the two original reference PDFs this file's own header describes): a
  // left-margin grouping label spanning several consecutive rows (shared accommodation, e.g.
  // "Fakhri Heights"/"Same Building") can carry its own text item positioned LEFT of the
  // table's sequence-number column. Its Y-coordinate clustered with one specific data row,
  // became that row's leftmost item, and corrupted sequence extraction — silently losing a
  // real, numbered entry. These fixtures reproduce the exact STRUCTURAL shape with synthetic
  // names only. ═══════════════════
  console.log('=== GROUP G: left-margin label collision (real operator report) ===');
  await t('G1: a left-margin label sharing a row\'s Y-coordinate does not lose that row\'s sequence', async () => {
    const y = HEADER_Y - ROW_H * 3;
    const pdf = makeSyntheticPdf([
      ...headerRow(HEADER_Y),
      ...dataRow(HEADER_Y - ROW_H * 1, '1', 'Person One', 'Q', 'TCA-0001'),
      ...dataRow(HEADER_Y - ROW_H * 2, '2', 'Person Two', 'Q', 'TCA-0002'),
      { text: 'Fakhri Heights', x: COL.no - 15, y }, // the intruding margin label — same Y as row 3
      ...dataRow(y, '3', 'Person Three', 'Q', 'TCA-0003'),
      ...dataRow(HEADER_Y - ROW_H * 4, '4', 'Person Four', 'Q', 'TCA-0004'),
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02Q', '03Q', '04Q'],
      'the label-collided row (03Q) must not be lost');
  });
  await t('G2: a margin label spanning MULTIPLE consecutive rows loses none of them', async () => {
    // Matches the real document exactly: one label ("Fakhri Heights") visually spans rows
    // 11-14 but its own text anchor only actually collided with row 14; a second label ("Same
    // Building") spans rows 29-31 but only actually collided with row 30. Reproduced here as
    // two separate labels, each colliding with a different row in a short run.
    const rows = [1, 2, 3, 4, 5].map(n => HEADER_Y - ROW_H * n);
    const pdf = makeSyntheticPdf([
      ...headerRow(HEADER_Y),
      ...dataRow(rows[0], '1', 'Person One', 'Q', 'TCA-0001'),
      { text: 'Group Label A', x: COL.no - 15, y: rows[1] },
      ...dataRow(rows[1], '2', 'Person Two', 'Q', 'TCA-0002'),
      ...dataRow(rows[2], '3', 'Person Three', 'Q', 'TCA-0003'),
      { text: 'Group Label B', x: COL.no - 15, y: rows[3] },
      ...dataRow(rows[3], '4', 'Person Four', 'M', 'TCA-0004'),
      ...dataRow(rows[4], '5', 'Person Five', 'Q', 'TCA-0005'),
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02Q', '03Q', '04M', '05Q']);
  });
  await t('G3: the FINAL numbered row, immediately followed by an unnumbered trailing note, is retained', async () => {
    // Matches the real document exactly: the last numbered row (31M) sits directly above an
    // unnumbered closing note ("Haveli (Madrasa program)") with no number of its own.
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person One', 'Q', 'TCA-0001'),
      y => dataRow(y, '2', 'Person Two', 'M', 'TCA-0002'),
      y => bannerRow(y, 'Closing Note (Unnumbered)'),
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].entries.map(e => e.folderName), ['01Q', '02M'],
      'the final numbered row (02M) must survive even with a trailing unnumbered note directly beneath it');
  });
  await t('G4: a numeric-looking token elsewhere on an UNNUMBERED row is never misread as a sequence number', () => {
    // The exact false-positive this module's own dual geometry+content check exists to avoid:
    // a travel-time-shaped cell ("1 min") sitting in a LATER column, on a row with no real
    // leading sequence number, must not be picked up as "sequence 1".
    const y = HEADER_Y - ROW_H;
    const row = [
      { text: 'Closing Note', x: COL.no + 60, y },
      { text: '1 min', x: COL.code + 40, y }, // far right of the table — not near the sequence column
    ];
    const pdf = makeSyntheticPdf([...headerRow(HEADER_Y), ...row]);
    return _parse(pdf).then(r => {
      assert.equal(r.sections.length === 0 ? 0 : r.sections[0].entries.length, 0,
        'no entry must be fabricated from an unrelated numeric-looking cell');
    });
  });
  await t('G5: a genuinely ambiguous row (looks like it might be lost data) is reported, not silently dropped', async () => {
    // A row containing both a number-shaped token AND a recognized Sharaf-type token as
    // separate words, but that still does not resolve to a real data row through normal
    // classification — flagged as excludedRows reason 'ambiguous-banner' rather than being
    // absorbed as an ordinary section label or vanishing with no trace at all.
    const y = HEADER_Y - ROW_H;
    const pdf = makeSyntheticPdf([...headerRow(HEADER_Y), { text: 'Unclear 14 Q Entry', x: COL.no + 60, y }]);
    const r = await _parse(pdf);
    assert.ok(r.sections[0].excludedRows.some(x => x.reason === 'ambiguous-banner'),
      'an ambiguous row containing both a number and a type token must be reported, not silently absorbed');
  });
  await t('G6: numbering gaps within a section are detected and reported for operator review', async () => {
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person One', 'Q', 'TCA-0001'),
      y => dataRow(y, '2', 'Person Two', 'Q', 'TCA-0002'),
      y => dataRow(y, '5', 'Person Five', 'M', 'TCA-0005'), // 3 and 4 missing
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].numberingGaps, [3, 4]);
    assert.ok(r.sections[0].warnings.some(w => w.reason === 'numbering-gap' && JSON.stringify(w.missingNumbers) === JSON.stringify([3, 4])));
  });
  await t('G7: no numbering-gap warning when the section is genuinely contiguous', async () => {
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person One', 'Q', 'TCA-0001'),
      y => dataRow(y, '2', 'Person Two', 'Q', 'TCA-0002'),
      y => dataRow(y, '3', 'Person Three', 'M', 'TCA-0003'),
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].numberingGaps, []);
    assert.ok(!r.sections[0].warnings.some(w => w.reason === 'numbering-gap'));
  });
  await t('G8: a suffixed entry (e.g. "3a") shares its base number with "3" and is never itself a gap', async () => {
    const pdf = buildTable([
      y => dataRow(y, '1', 'Person One', 'Q', 'TCA-0001'),
      y => dataRow(y, '2', 'Person Two', 'Q', 'TCA-0002'),
      y => dataRow(y, '3', 'Person Three', 'Q', 'TCA-0003'),
      y => dataRow(y, '3a', 'Person Three A', 'MZ', 'TCA-0004'),
      y => dataRow(y, '4', 'Person Four', 'M', 'TCA-0005'),
    ]);
    const r = await _parse(pdf);
    assert.deepStrictEqual(r.sections[0].numberingGaps, []);
  });
  await t('G9: a wrapped/multi-line name (its own text lands in a separate Y-cluster) never loses the row\'s sequence', async () => {
    // A real reference PDF can render a long Name across two slightly different Y baselines
    // within the same logical row — confirmed directly against the real document. The
    // sequence number and Sharaf type, on the row's own primary baseline, must still resolve
    // correctly regardless of where the wrapped name fragment landed.
    const y = HEADER_Y - ROW_H;
    const pdf = makeSyntheticPdf([
      ...headerRow(HEADER_Y),
      { text: '1', x: COL.no, y },
      { text: 'Q', x: COL.sharaf, y },
      { text: 'TCA-0001', x: COL.code, y },
      { text: 'Wrapped Second Line Of Name', x: COL.name, y: y - 4.9 }, // within a DIFFERENT row's cluster
      ...dataRow(y - ROW_H, '2', 'Person Two', 'Q', 'TCA-0002'),
    ]);
    const r = await _parse(pdf);
    assert.ok(r.sections[0].entries.some(e => e.folderName === '01Q'), 'sequence 1 must survive a wrapped name fragment');
    assert.ok(r.sections[0].entries.some(e => e.folderName === '02Q'), 'the following row must also be unaffected');
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzProgramPdfParser] FATAL:', err);
  process.exit(1);
});
