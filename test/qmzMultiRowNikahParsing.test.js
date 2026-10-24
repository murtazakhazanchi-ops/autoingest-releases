'use strict';

// "AutoIngest — QMZ Multi-Row PDF Parsing and Nikah Recognition Fix" — automated regression
// coverage (Phase 11). Plain Node, no Electron (main/qmzProgramPdfParser.js is a pure,
// filesystem-reading-only module — see its own header comment).
//
// Root cause (confirmed directly against the real Coimbatore reference PDF, never assumed):
// a numbered QMZ sequence is a LOGICAL unit, not necessarily one physical table row. A
// vertically-merged Sr cell for a multi-person sequence spreads its own content across
// several physical rows — the primary Sharaf type on one row (sometimes with a name attached,
// sometimes bare), the bare sequence number on a DIFFERENT row (often lower down, not at the
// top of the group), and "N" (Nikah — confirmed NOT "Not Applicable") rows and plain
// name/continuation rows interspersed between and after. The previous parser classified every
// physical row independently: a Sharaf-bearing row with no number of its own fell through to
// a generic, unrelated "banner" classification (losing the type entirely), its lone-number
// row became an "excluded: no-sequence-number" row, and "N" was unconditionally excluded as
// "not applicable" — together making the whole numbered sequence vanish rather than being
// reported as a Nikah-bearing entry.
//
// Run: node test/qmzMultiRowNikahParsing.test.js

const assert = require('node:assert/strict');

// services/logger.js's log() reaches for Electron's `app` module, which is only real inside
// an actual Electron process (require('electron') resolves to a bare path string under plain
// `node`, matching the pre-existing, already-documented 12-file QMZ test-harness limitation —
// see test/qmzProgramPdfParser.test.js's own identical pattern). Stubbed here so this NEW
// test suite is not needlessly added to that known list — parseProgramPdf()'s own logging is
// a side effect this suite never asserts on.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === '../services/logger' || request.endsWith('/services/logger')) return { log: () => {} };
  return origLoad.call(this, request, ...args);
};

const parser = require('../main/qmzProgramPdfParser');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ── Synthetic PDF construction (identical convention to the established QMZ test suites —
// see test/qmzFinalValidationLiveE2E.test.js's own makeSyntheticPdf) ─────────────────────────
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
  for (let i = 0; i < objs.length; i++) { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const COL = { sr: 50, name: 150, sharaf: 320, floor: 360, code: 460 };
const HEADER_Y = 560, ROW_H = 12;

function headerRow(y) { return [{ text: 'Sr', x: COL.sr, y }, { text: 'Name', x: COL.name, y }, { text: 'Sharaf', x: COL.sharaf, y }, { text: 'Floor', x: COL.floor, y }, { text: 'Code', x: COL.code, y }]; }

// Each spec is one of:
//   { full: [seq, name, sharaf, code] }        — number + name + primary type together (single physical row)
//   { sharafOnly: [name, sharaf, code] }        — primary type (+ name), no number on this row
//   { seqOnly: seq }                            — bare sequence number alone
//   { nikah: [name, code] }                     — "N" (+ name), no number
//   { name: text }                              — a bare name/continuation-looking row
//   { banner: text }                            — an itinerary/activity banner (e.g. "Waaz (...)")
function buildRows(specs) {
  const cells = [...headerRow(HEADER_Y)];
  specs.forEach((spec, i) => {
    const y = HEADER_Y - ROW_H * (i + 1);
    if (spec.full) {
      const [seq, name, sharaf, code] = spec.full;
      cells.push({ text: `${seq} ${name}`, x: COL.sr, y }, { text: sharaf, x: COL.sharaf, y }, { text: code, x: COL.code, y });
    } else if (spec.sharafOnly) {
      const [name, sharaf, code] = spec.sharafOnly;
      cells.push({ text: name, x: COL.name, y }, { text: sharaf, x: COL.sharaf, y }, { text: code, x: COL.code, y });
    } else if (spec.seqOnly !== undefined) {
      cells.push({ text: String(spec.seqOnly), x: COL.sr, y });
    } else if (spec.nikah) {
      const [name, code] = spec.nikah;
      if (name) cells.push({ text: name, x: COL.name, y });
      cells.push({ text: 'N', x: COL.sharaf, y });
      if (code) cells.push({ text: code, x: COL.code, y });
    } else if (spec.name !== undefined) {
      cells.push({ text: spec.name, x: COL.name, y });
    } else if (spec.banner !== undefined) {
      cells.push({ text: spec.banner, x: COL.sr, y });
    }
  });
  return cells;
}

function buildPdf(specs) { return makeSyntheticPdf(buildRows(specs)); }

// Multi-page: a real two-object-per-page PDF, built directly (not via the single-page helper)
// — each page gets its own Pages/Kid/Contents objects and its own repeated header row.
function buildMultiPagePdf(specsPerPage) {
  const pageCount = specsPerPage.length;
  const kids = [];
  for (let i = 0; i < pageCount; i++) kids.push(`${3 + i * 2} 0 R`);
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  objs.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`); // 2
  const fontObjNum = 3 + pageCount * 2;
  for (let i = 0; i < pageCount; i++) {
    const cells = buildRows(specsPerPage[i]);
    const ops = ['BT', '/F1 10 Tf'];
    for (const c of cells) ops.push(`1 0 0 1 ${c.x} ${c.y} Tm (${_esc(c.text)}) Tj`);
    ops.push('ET');
    const stream = ops.join('\n');
    objs.push(`<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 842 595] /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // last, fontObjNum

  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function entryCodes(result) {
  return result.sections.flatMap(s => s.entries.map(e => e.folderName));
}
function findEntry(result, folderName) {
  for (const s of result.sections) {
    const e = s.entries.find(x => x.folderName === folderName);
    if (e) return e;
  }
  return null;
}

async function main() {
  console.log('qmzMultiRowNikahParsing (real filesystem, no Electron)');

  // ── 1-3. Single-row Q / M / Z (pre-existing behavior, unchanged) ─────────────────────────
  await t('1. single-row Q parses correctly, no Nikah', async () => {
    const r = await parser.parseProgramPdf(buildPdf([{ full: [1, 'Person A', 'Q', 'ABC-0001'] }]));
    assert.deepEqual(entryCodes(r), ['01Q']);
    assert.equal(findEntry(r, '01Q').hasNikah, false);
  });
  await t('2. single-row M parses correctly, no Nikah', async () => {
    const r = await parser.parseProgramPdf(buildPdf([{ full: [1, 'Person A', 'M', 'ABC-0001'] }]));
    assert.deepEqual(entryCodes(r), ['01M']);
  });
  await t('3. single-row Z parses correctly, no Nikah', async () => {
    const r = await parser.parseProgramPdf(buildPdf([{ full: [1, 'Person A', 'Z', 'ABC-0001'] }]));
    assert.deepEqual(entryCodes(r), ['01Z']);
  });

  // ── 4-6. Multi-row Q/M/Z + N — the primary defect, each primary type ─────────────────────
  for (const letter of ['Q', 'M', 'Z']) {
    await t(`4-6. multi-row ${letter} + N: recognized, Nikah preserved, folder uses ${letter} only`, async () => {
      const r = await parser.parseProgramPdf(buildPdf([
        { sharafOnly: ['Groom', letter, 'ABC-0001'] },
        { seqOnly: 2 },
        { name: 'Escort' },
        { nikah: ['Bride', 'ABC-0002'] },
        { name: 'Witness' },
        { full: [3, 'Next Person', 'Q', 'ABC-0003'] }, // closes the group
      ]));
      const code = `02${letter}`;
      assert.ok(entryCodes(r).includes(code), `expected ${code} among ${entryCodes(r)}`);
      const entry = findEntry(r, code);
      assert.equal(entry.hasNikah, true);
      assert.equal(entry.nikahCount, 1);
      assert.equal(entryCodes(r).some(c => c.includes('N')), false, 'never a separate N folder/code');
    });
  }

  // ── 7. N appearing BEFORE the primary Sharaf ──────────────────────────────────────────────
  await t('7. N appearing before the primary Sharaf is still correctly associated', async () => {
    // Real-world equivalent: the Nikah row is listed first, the primary type afterward, still
    // within one unbroken span bounded by the next primary-Sharaf row. Since grouping opens on
    // the FIRST primary-Sharaf row seen, an N row with no group open yet is reported instead of
    // silently guessed — the parser never invents an association without a primary type having
    // appeared first. This is intentionally verified as a reported edge case, not a success
    // case, matching Phase 8's "Only N, no primary Sharaf" rule (a Nikah row with nothing to
    // attach to yet must never silently open a sequence of its own).
    const r = await parser.parseProgramPdf(buildPdf([
      { nikah: ['Bride', 'ABC-0002'] },
      { sharafOnly: ['Groom', 'Z', 'ABC-0001'] },
      { seqOnly: 2 },
      { full: [3, 'Next', 'Q', 'ABC-0003'] },
    ]));
    const excluded = r.sections[0].excludedRows;
    assert.ok(excluded.some(x => x.reason === 'nikah-without-primary-sharaf'), JSON.stringify(excluded));
    // The primary Sharaf + number still resolve correctly on their own, independent of the
    // orphaned N row before them.
    assert.ok(entryCodes(r).includes('02Z'));
    assert.equal(findEntry(r, '02Z').hasNikah, false); // the orphaned N never retroactively attaches
  });

  // ── 8. Multiple N rows within one group ───────────────────────────────────────────────────
  await t('8. multiple N rows within one group: one Nikah activity per row, never duplicate folders', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { sharafOnly: ['Groom', 'Z', 'ABC-0001'] },
      { seqOnly: 2 },
      { nikah: ['Bride', 'ABC-0002'] },
      { nikah: ['Witness', 'ABC-0003'] },
      { full: [3, 'Next', 'Q', 'ABC-0004'] },
    ]));
    const entry = findEntry(r, '02Z');
    assert.equal(entry.nikahCount, 2);
    assert.equal(entryCodes(r).filter(c => c === '02Z').length, 1, 'still exactly one folder for this sequence');
  });

  // ── 9. N-only sequence (no primary Sharaf anywhere) ───────────────────────────────────────
  await t('9. N-only sequence: never invents Q/M/Z, flagged for review', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { full: [1, 'Prior', 'Q', 'ABC-0001'] },
      { seqOnly: 2 },
      { nikah: ['Someone', 'ABC-0002'] },
      { full: [3, 'Next', 'Q', 'ABC-0003'] },
    ]));
    assert.ok(!entryCodes(r).some(c => c.startsWith('02')), 'must never invent a type for sequence 2');
    const excluded = r.sections[0].excludedRows;
    assert.ok(excluded.some(x => x.reason === 'no-sequence-number' && x.sequenceRaw === '2'));
  });

  // ── 10. Vertically merged Sr cells (the real Coimbatore mechanism itself) ─────────────────
  await t('10. vertically merged Sr cell (number on its own row, separate from the type row)', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { sharafOnly: ['Person', 'M', 'ABC-0001'] },
      { seqOnly: 5 },
      { full: [6, 'Next', 'Q', 'ABC-0002'] },
    ]));
    assert.ok(entryCodes(r).includes('05M'));
  });

  // ── 11. Multiple people within one sequence (3+ name rows, one primary type, one Nikah) ──
  await t('11. multiple people within one sequence resolve to exactly one entry', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { sharafOnly: ['Groom', 'Z', 'ABC-0001'] },
      { seqOnly: 7 },
      { name: 'Escort One' },
      { nikah: ['Bride', 'ABC-0002'] },
      { name: 'Escort Two' },
      { name: 'Escort Three' },
      { full: [8, 'Next', 'Q', 'ABC-0003'] },
    ]));
    assert.equal(entryCodes(r).filter(c => c === '07Z').length, 1);
    assert.equal(findEntry(r, '07Z').hasNikah, true);
  });

  // ── 12-13. Multi-page PDFs + repeated page headers ────────────────────────────────────────
  await t('12-13. multi-page PDF: groups resolve correctly on each page, repeated headers never become false sequences', async () => {
    const pdf = buildMultiPagePdf([
      [
        { full: [1, 'Person A', 'Q', 'ABC-0001'] },
        { sharafOnly: ['Person B', 'Z', 'ABC-0002'] },
        { seqOnly: 2 },
        { nikah: ['Person C', 'ABC-0003'] },
      ],
      [
        { full: [3, 'Person D', 'M', 'ABC-0004'] },
      ],
    ]);
    const r = await parser.parseProgramPdf(pdf);
    assert.equal(r.source.pageCount, 2);
    assert.deepEqual(entryCodes(r), ['01Q', '02Z', '03M']);
    assert.equal(findEntry(r, '02Z').hasNikah, true);
  });

  // ── 14. Supported compound Sharaf codes (MZ) unaffected ───────────────────────────────────
  await t('14. compound Sharaf code (MZ) still works, including as a multi-row + Nikah group', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { sharafOnly: ['Person', 'MZ', 'ABC-0001'] },
      { seqOnly: 4 },
      { nikah: ['Other', 'ABC-0002'] },
      { full: [5, 'Next', 'Q', 'ABC-0003'] },
    ]));
    assert.ok(entryCodes(r).includes('04MZ'));
    assert.equal(findEntry(r, '04MZ').hasNikah, true);
  });

  // ── 15. Suffixed codes (05aMZ) — a single-row case, unaffected by grouping ───────────────
  await t('15. suffixed sequence code (e.g. "5a") still parses to the correct folder name', async () => {
    const r = await parser.parseProgramPdf(buildPdf([{ full: ['5a', 'Person', 'MZ', 'ABC-0001'] }]));
    assert.deepEqual(entryCodes(r), ['05amz'.replace('amz', 'aMZ')]); // formatCode lowercases suffix, uppercases letter
  });

  // ── 16. Missing-sequence detection still works for GENUINE gaps ───────────────────────────
  await t('16. a genuinely missing sequence number is still reported as a gap', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { full: [1, 'A', 'Q', 'ABC-0001'] },
      { full: [3, 'B', 'Q', 'ABC-0002'] }, // "2" never appears anywhere at all
    ]));
    assert.deepEqual(r.sections[0].numberingGaps, [2]);
  });

  // ── 17. Conflicting primary Sharaf types within one still-numberless group ───────────────
  await t('17. a second, different primary type before the first ever gets a number is flagged, not merged', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { sharafOnly: ['Person A', 'Z', 'ABC-0001'] }, // opens a group, no number yet
      { sharafOnly: ['Person B', 'Q', 'ABC-0002'] }, // different type — closes the stale Z group unresolved, opens its own
      { seqOnly: 9 },
      { full: [10, 'Next', 'M', 'ABC-0003'] },
    ]));
    const excluded = r.sections[0].excludedRows;
    assert.ok(excluded.some(x => x.reason === 'no-sequence-number-in-group' && x.sharaf === 'Z'), JSON.stringify(excluded));
    assert.ok(entryCodes(r).includes('09Q'), 'the second (Q) group still correctly resolves with its own number');
  });

  // ── 18. Ambiguous row association — genuinely unreadable, retained for operator review ───
  await t('18. an ambiguous banner (both a seq-shaped token and a type token as separate words, neither nearest the Sr column) is reported, not silently merged', async () => {
    // Deliberately NOT built through buildRows()'s generic {banner} helper: that helper places
    // its text at the Sr column's own X, which _extractLeadingSequence would then read as a
    // real leading sequence number (routing to 'sequence-only', not 'banner') — the genuine
    // ambiguous-banner case this module guards against requires BOTH tokens to sit nearest a
    // DIFFERENT column (here: Name) so neither one is picked up as a real column-0 sequence
    // number, yet both still fall within the banner-detection region (columns 0..sharafIndex).
    const rows = [...headerRow(HEADER_Y)];
    const y1 = HEADER_Y - ROW_H;
    rows.push({ text: '1 A', x: COL.sr, y: y1 }, { text: 'Q', x: COL.sharaf, y: y1 }, { text: 'ABC-0001', x: COL.code, y: y1 });
    const y2 = HEADER_Y - ROW_H * 2;
    // Wide gap (not adjacent) so pdf.js's own text-extraction never merges these two draw
    // operations into one combined item (confirmed live: a 5-unit gap WAS silently merged
    // into a single "2Q" string by pdf.js's own text-layer heuristics, which no longer reads
    // as two separate words to _isAmbiguousBanner — this wider gap keeps them genuinely
    // separate while both still bucket nearest the Name column, not Sr).
    rows.push({ text: '2', x: COL.name, y: y2 }, { text: 'Q', x: COL.name + 40, y: y2 });
    const y3 = HEADER_Y - ROW_H * 3;
    rows.push({ text: '3 B', x: COL.sr, y: y3 }, { text: 'M', x: COL.sharaf, y: y3 }, { text: 'ABC-0002', x: COL.code, y: y3 });
    const r = await parser.parseProgramPdf(makeSyntheticPdf(rows));
    const excluded = r.sections[0].excludedRows;
    assert.ok(excluded.some(x => x.reason === 'ambiguous-banner'), JSON.stringify(excluded));
    assert.deepEqual(entryCodes(r), ['01Q', '03M']);
  });

  // ── 19. Nikah preservation through the full normalized entry shape ───────────────────────
  await t('19. a Nikah-bearing entry carries hasNikah/nikahCount on the SAME stable object other fields live on', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { sharafOnly: ['Groom', 'Q', 'ABC-0001'] },
      { seqOnly: 1 },
      { nikah: ['Bride', 'ABC-0002'] },
    ]));
    const entry = findEntry(r, '01Q');
    assert.equal(entry.hasNikah, true);
    assert.equal(entry.nikahCount, 1);
    assert.equal(entry.number, 1);
    assert.equal(entry.letter, 'Q');
    assert.ok(entry.type, 'letterToType must still resolve a real type name');
  });

  // ── 20. Previous QMZ PDF formats (single row per sequence, O/AQ types) remain functional ──
  await t('20. previous single-row-per-sequence PDF format (including O/AQ) remains fully functional', async () => {
    const r = await parser.parseProgramPdf(buildPdf([
      { full: [1, 'A', 'O', 'ABC-0001'] },
      { full: [2, 'B', 'AQ', 'ABC-0002'] },
      { full: [3, 'C', 'Q', 'ABC-0003'] },
    ]));
    assert.deepEqual(entryCodes(r), ['01O', '02AQ', '03Q']);
    assert.equal(entryCodes(r).every(c => !findEntry(r, c).hasNikah), true);
  });

  console.log(`\n${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}`);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
