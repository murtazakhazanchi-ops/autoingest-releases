'use strict';

// "AutoIngest — QMZ Multi-Row PDF Parsing and Nikah Recognition Fix" — Phase 9's exact
// acceptance oracle, run against a SANITIZED, entirely synthetic regression fixture
// (test/fixtures/qmz-synthetic-sample-route.pdf) that reproduces the same structural shape
// — two pages, 24 numbered sequences, vertically-merged Sr cells spanning multiple physical
// rows, interleaved Nikah ("N") rows — as the real reference document this fix was originally
// diagnosed against, WITHOUT any real personal information. Every name/code in the fixture is
// an obviously fictional placeholder (see the generator in
// test/qmzMultiRowNikahParsing.test.js's buildRows/buildMultiPagePdf convention). Verified to
// reproduce the exact same missing-sequence defect (02Z, 03Z, 04Q, 15Q, 23Q) against the
// pre-fix parser and to resolve cleanly against the corrected one — see "AutoIngest —
// Sanitize QMZ Fixture and Publish Combined Preview v0.9.16-rc.3" for that verification.
//
// Run: node test/qmzSanitizedFixtureAcceptance.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === '../services/logger' || request.endsWith('/services/logger')) return { log: () => {} };
  return origLoad.call(this, request, ...args);
};
const { parseProgramPdf } = require('../main/qmzProgramPdfParser');

const FIXTURE = path.join(__dirname, 'fixtures', 'qmz-synthetic-sample-route.pdf');

let passed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  ok — ${msg}`); }
  else { console.error(`  FAIL — ${msg}`); process.exitCode = 1; }
}

const EXPECTED = [
  '01Q', '02Z', '03Z', '04Q', '05M', '06Q', '07Q', '08Q', '09Q', '10Q', '11Q', '12Z', '13M',
  '14Z', '15Q', '16Z', '17Z', '18Q', '19Q', '20Q', '21Q', '22Q', '23Q', '24Q',
];
const EXPECTED_NIKAH = new Set(['02Z', '03Z', '04Q', '15Q', '23Q']);

async function main() {
  console.log('qmzSanitizedFixtureAcceptance (synthetic fixture, no Electron)');

  if (!fs.existsSync(FIXTURE)) {
    console.error(`FATAL: fixture not found at ${FIXTURE} — the sanitized synthetic PDF is missing from test/fixtures/.`);
    process.exit(1);
  }

  const result = await parseProgramPdf(FIXTURE);
  check(result.fatal === null, `the fixture parses with no fatal error (got: ${JSON.stringify(result.fatal)})`);
  check(result.source.pageCount === 2, `document has 2 pages (got ${result.source.pageCount})`);
  check(result.sections.length === 1, `exactly one section/city is detected (got ${result.sections.length})`);

  const section = result.sections[0];
  const codes = section.entries.map(e => e.folderName);
  check(codes.length === 24, `exactly 24 sequences are recognized (got ${codes.length})`);
  check(JSON.stringify(codes) === JSON.stringify(EXPECTED), `the 24 codes exactly match the acceptance oracle, in order (got ${JSON.stringify(codes)})`);
  check(section.numberingGaps.length === 0, `no false missing-sequence warnings (got gaps: ${JSON.stringify(section.numberingGaps)})`);
  check(section.excludedRows.length === 0, `no rows left unaccounted for (got: ${JSON.stringify(section.excludedRows)})`);
  check(section.duplicates.length === 0, 'no duplicate sequence folders');

  const nikahCodes = section.entries.filter(e => e.hasNikah).map(e => e.folderName).sort();
  check(JSON.stringify(nikahCodes) === JSON.stringify([...EXPECTED_NIKAH].sort()),
    `exactly the five expected sequences (02Z, 03Z, 04Q, 15Q, 23Q) are flagged Nikah (got ${JSON.stringify(nikahCodes)})`);
  for (const e of section.entries) {
    check(e.nikahCount === (EXPECTED_NIKAH.has(e.folderName) ? 1 : 0), `${e.folderName} has the correct Nikah count (${e.nikahCount})`);
  }
  check(!codes.some(c => /N/.test(c)), 'no code contains an "N" — Nikah never becomes part of a folder name');

  console.log(`\n${passed} passed`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
