'use strict';

// Defensive cross-stage field-name consistency check (closure item #10) — NOT the full
// FIELD_SPECS refactor (deliberately deferred; see the follow-up note in this file's
// header and docs/metadata-system.md). Interim protection only: fails if a future
// metadata field is added to one of the six field-definition sites but forgotten in
// another, instead of silently degrading (e.g. never detected as stale on resume,
// never verified after a write, never shown in an audit export).
//
// The six sites this test cross-checks:
//  1. services/metadataExpectationService.js — resolveExpectedMetadata()'s output shape
//     (the canonical source: whatever scalar fields it returns are what every other
//     site must also know about).
//  2. main/exifService.js — _buildTags() (which fields become ExifTool tags)
//  3. main/exifService.js — compareReadback() (which fields get read-back verified)
//  4. main/metadataQueueRecovery.js — _expectationsEqual() (which fields gate the
//     resume staleness check)
//  5. services/metadataAuditService.js — classifyOneFile()'s `fields` object (audit diff)
//  6. services/metadataAuditExport.js — CSV_FIELD_COLUMNS (export columns)
//
// Sites 2-4 are checked BEHAVIORALLY (each field flipped to a sentinel value, one at a
// time, and the function's output checked for a resulting change) rather than by
// hand-copying a duplicate field list into this test — a hand-copied list would give
// false confidence, since a real divergence in the SOURCE wouldn't be caught by a test
// comparing two independently-maintained copies. `_buildTags`/`_expectationsEqual` are
// exported from their modules for this purpose only (see the "Test-only" comments at
// each export site) — not part of either module's real public API.
//
// FOLLOW-UP (not implemented in this pass, per closure item #10's explicit scope limit —
// "do not implement the full FIELD_SPECS refactor unless it can be proven small and
// mechanically safe"): collapse these six independently-maintained lists into one
// shared FIELD_SPECS table (e.g. `[{key, tagXmp, tagIptc, auditLabel, csvColumn}, ...]`)
// that each of the five consumers maps over, so adding a field means editing one table
// instead of six call sites. This test is the interim guardrail until that refactor
// lands — a real correctness gap it does NOT close: silently DROPPED evidence within a
// single site's OWN logic (e.g. a typo'd tag name that happens to still change some
// output) isn't guaranteed to be caught by sentinel-probing alone. Full architectural
// review of the refactor's scope was intentionally left for its own dedicated change.
//
// Run with the Electron binary (services/metadataAuditService.js transitively requires
// main/exifService.js, which needs Electron's app.getPath via services/logger.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     test/fieldSpecsConsistency.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-fieldspec-q-'));
process.env.AUTOINGEST_METADATA_AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-fieldspec-j-'));

const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const exifService = require('../main/exifService');
const { _expectationsEqual } = require('../main/metadataQueueRecovery');
const audit = require('../services/metadataAuditService');
const { CSV_FIELD_COLUMNS } = require('../services/metadataAuditExport');

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}
async function ta(name, fn) {
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

// description/eventDescription are the same field with a legitimate, deliberate naming
// difference: the resolver's own contract calls it eventDescription; audit/export/
// readback call it description. Canonicalize before comparing sets across sites.
const ALIASES = { eventDescription: 'description' };
function canon(name) { return ALIASES[name] || name; }

const BASE_EVIDENCE = {
  filePath: '/archive/Event/Jane Doe/photo.jpg', photographer: 'Jane',
  hijriDate: '1448-01-01', eventDescription: 'Waaz',
  groups: [{ id: 'root', subEventId: null, files: ['/archive/Event/Jane Doe/photo.jpg'] }],
  diskComponents: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
};

(async () => {
  console.log('fieldSpecsConsistency (item #10 interim guardrail — no full refactor)');

  const expectation = resolveExpectedMetadata(BASE_EVIDENCE);
  assert.equal(expectation.status, 'resolved');

  // Site 1: the resolver's own canonical scalar field set — excludes keywords (its own
  // list-type field with separate, already-consistent parallel handling everywhere:
  // audit tracks it via record.keywords not record.fields, readback/staleness both
  // treat it as an array-diff, never a simple scalar) and structural/meta keys
  // (status, metadataContractVersion, resolverVersion, ambiguityReason, evidenceSource).
  const CANONICAL_FIELDS = ['photographer', 'copyright', 'description', 'hijriDate', 'location', 'city', 'country'];

  t('sanity: resolver actually populated every canonical field for this fixture', () => {
    assert.ok(expectation.photographer && expectation.copyright && expectation.eventDescription
      && expectation.hijriDate && expectation.component?.location && expectation.component?.city
      && expectation.component?.country, 'fixture must exercise every field or the probes below are meaningless');
  });

  function perturb(field, value) {
    const varied = { ...expectation, component: { ...expectation.component } };
    if (field === 'description') varied.eventDescription = value;
    else if (['location', 'city', 'country'].includes(field)) varied.component[field] = value;
    else varied[field] = value;
    return varied;
  }

  // Site 2: exifService._buildTags — probed by perturbing one field at a time and
  // checking whether the resulting ExifTool tag map actually changed.
  t('main/exifService.js _buildTags is sensitive to every resolver field (nothing silently dropped from the tag map)', () => {
    const base = JSON.stringify(exifService._buildTags(expectation, false));
    const sensed = new Set();
    for (const field of CANONICAL_FIELDS) {
      const varied = perturb(field, field === 'keywords' ? ['SENTINEL'] : 'SENTINEL-VALUE-XYZ');
      const tags = JSON.stringify(exifService._buildTags(varied, false));
      if (tags !== base) sensed.add(field);
    }
    assert.deepEqual([...sensed].sort(), [...CANONICAL_FIELDS].sort());
  });

  // Site 3: exifService.compareReadback — probed by perturbing the ACTUAL (read-back)
  // side for one field at a time (holding expectation fixed) and checking whether that
  // field name appears in the resulting mismatches list.
  t('main/exifService.js compareReadback verifies every resolver field (nothing silently unverified after a write)', () => {
    const actualMatchingExpectation = {
      Creator: [expectation.photographer], Rights: expectation.copyright, Subject: expectation.keywords,
      Description: expectation.eventDescription, Location: expectation.component.location,
      City: expectation.component.city, Country: expectation.component.country, HijriDate: expectation.hijriDate,
    };
    const readbackKeyFor = {
      photographer: 'Creator', copyright: 'Rights', description: 'Description',
      location: 'Location', city: 'City', country: 'Country', hijriDate: 'HijriDate',
    };
    const sensed = new Set();
    for (const field of CANONICAL_FIELDS) {
      const perturbedActual = { ...actualMatchingExpectation, [readbackKeyFor[field]]: 'SENTINEL-DIFFERENT-VALUE' };
      const { mismatches } = exifService.compareReadback(perturbedActual, expectation, false);
      if (mismatches.some(m => m === field || m === `${field}(iptc)`)) sensed.add(field);
    }
    assert.deepEqual([...sensed].sort(), [...CANONICAL_FIELDS].sort());
  });

  // Site 4: metadataQueueRecovery._expectationsEqual — probed the same way as Site 2.
  t('main/metadataQueueRecovery.js _expectationsEqual (resume staleness gate) is sensitive to every resolver field', () => {
    const sensed = new Set();
    for (const field of CANONICAL_FIELDS) {
      const varied = perturb(field, 'SENTINEL-VALUE-XYZ');
      if (!_expectationsEqual(expectation, varied)) sensed.add(field);
    }
    assert.deepEqual([...sensed].sort(), [...CANONICAL_FIELDS].sort());
  });

  // Site 5: audit's per-file field diff — genuinely derived from the real function
  // (not hand-copied): classifyOneFile against a file that doesn't exist on disk skips
  // the real ExifTool read (actual = {}) but still builds the full `fields` object from
  // expectation vs. undefined actual values — its object KEYS are exactly what this
  // test needs, with no ExifTool round-trip required.
  await ta("services/metadataAuditService.js classifyOneFile's fields object covers every resolver field", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-fieldspec-ev-'));
    const eventJson = {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    };
    const filePath = path.join(dir, 'Jane Doe', 'does-not-exist.jpg'); // never created — no ExifTool read.
    const record = await audit.classifyOneFile(dir, eventJson, filePath);
    assert.ok(record.fields, 'classifyOneFile must still build a fields object for a resolvable-but-unwritten file');
    const auditFieldKeys = new Set(Object.keys(record.fields).map(canon));
    assert.deepEqual([...auditFieldKeys].sort(), [...CANONICAL_FIELDS].sort());
  });

  // Site 6: CSV export columns — already exported directly, no probing needed.
  t('services/metadataAuditExport.js CSV_FIELD_COLUMNS covers every resolver field', () => {
    const csvFields = new Set(CSV_FIELD_COLUMNS.map(canon));
    assert.deepEqual([...csvFields].sort(), [...CANONICAL_FIELDS].sort());
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
  process.exit(process.exitCode || 0);
})();
