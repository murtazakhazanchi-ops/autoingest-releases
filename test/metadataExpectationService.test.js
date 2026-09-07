'use strict';

// Plain Node fixtures for the pure metadata expectation resolver — no framework,
// no I/O, no Electron. Run with: node test/metadataExpectationService.test.js

const assert = require('node:assert/strict');
const { resolveExpectedMetadata, METADATA_CONTRACT_VERSION, RESOLVER_VERSION } = require('../services/metadataExpectationService');

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

console.log('metadataExpectationService');

t('standard single-component event resolves via group match', () => {
  const evidence = {
    filePath: '/archive/Event/PG-John/photo.jpg',
    photographer: 'John',
    hijriDate: '1448-01-16',
    eventDescription: 'Urs Majlis',
    groups: [{ id: 'root', subEventId: null, files: ['/archive/Event/PG-John/photo.jpg'] }],
    diskComponents: [{ location: 'Hall A', city: 'London', country: 'UK', types: ['Majlis'], folderName: null }],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.equal(r.status, 'resolved');
  assert.deepEqual(r.keywords, ['Majlis', 'Hall A', 'London', 'UK']);
  assert.equal(r.photographer, 'John');
  assert.equal(r.hijriDate, '1448-01-16');
  assert.equal(r.eventDescription, 'Urs Majlis');
  assert.equal(r.metadataContractVersion, METADATA_CONTRACT_VERSION);
  assert.equal(r.resolverVersion, RESOLVER_VERSION);
});

t('single-component event with no group match still resolves via defensive fallback', () => {
  const evidence = {
    filePath: '/archive/Event/PG-John/photo.jpg',
    groups: [], // group reconstruction failed to match this file
    diskComponents: [{ location: 'Hall A', city: 'London', country: 'UK', types: ['Majlis'] }],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.equal(r.status, 'resolved');
  assert.equal(r.evidenceSource[0], 'fallback:base-component');
});

t('multi-component event with no matching group is ambiguous, not guessed', () => {
  const evidence = {
    filePath: '/archive/Event/Comp-A/PG-John/photo.jpg',
    groups: [],
    diskComponents: [
      { folderName: 'Comp-A', location: 'Hall A', city: 'London', country: 'UK', types: ['Majlis'] },
      { folderName: 'Comp-B', location: 'Hall B', city: 'London', country: 'UK', types: ['Ziyafat'] },
    ],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.ambiguityReason, 'component-unresolved-multi-event');
});

t('event with zero components is ambiguous (no-components-in-event)', () => {
  const r = resolveExpectedMetadata({ filePath: '/x', groups: [], diskComponents: [] });
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.ambiguityReason, 'no-components-in-event');
});

t('QMZ evidence with a resolved component ignores isMulti split-tag logic', () => {
  const evidence = {
    filePath: '/archive/Event/01Q/PG-John/photo.jpg',
    photographer: 'John',
    hijriDate: '1448-01-16',
    eventDescription: 'Urs Majlis',
    qmzComponent: { location: 'Hall A', city: 'London', country: 'UK', types: ['Majlis', 'Ziyafat'] },
    qmzExplicitTags: ['Qadam'],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.equal(r.status, 'resolved');
  assert.deepEqual(r.keywords, ['Qadam', 'Hall A', 'London', 'UK']);
  assert.equal(r.evidenceSource[0], 'qmz:explicit-component');
});

t('QMZ evidence with a null component is ambiguous (qmz-component-unresolved)', () => {
  const r = resolveExpectedMetadata({ filePath: '/x', qmzComponent: null, qmzExplicitTags: ['Qadam'] });
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.ambiguityReason, 'qmz-component-unresolved');
});

t('keywords dedupe case-insensitively without losing distinct values', () => {
  const evidence = {
    filePath: '/x',
    qmzComponent: { location: 'London', city: 'london', country: 'UK', types: ['Majlis'] },
    qmzExplicitTags: ['Majlis', 'majlis'],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.deepEqual(r.keywords, ['Majlis', 'London', 'UK']);
});

t('explicit metadataGroups tag assignment overrides derived type-split logic', () => {
  const evidence = {
    filePath: '/archive/Event/photo.jpg',
    groups: [{ id: 'g1', subEventId: null, files: ['/archive/Event/photo.jpg'], metadataTags: ['Custom Tag'] }],
    diskComponents: [{ location: '', city: 'London', country: 'UK', types: ['Majlis', 'Ziyafat'] }],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.deepEqual(r.keywords, ['Custom Tag', 'London', 'UK']);
});

t('multi-component event, single-tag split, ambiguous 0/2+ tag counts suppress type keyword', () => {
  const evidence = {
    filePath: '/archive/Event/Comp-A/photo.jpg',
    groups: [{ id: 'Comp-A', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/photo.jpg'] }],
    diskComponents: [
      { folderName: 'Comp-A', location: '', city: 'London', country: 'UK', types: ['Majlis', 'Ziyafat'] },
      { folderName: 'Comp-B', location: '', city: 'London', country: 'UK', types: ['Qadam'] },
    ],
  };
  const r = resolveExpectedMetadata(evidence);
  // isMulti=true → all type tags included (not suppressed) for a multi-component event.
  assert.deepEqual(r.keywords, ['Majlis', 'Ziyafat', 'London', 'UK']);
});

// ── Per-Photo Tag Refinement ────────────────────────────────────────────────

t('default (no refinement) resolution includes all component Additional Keywords', () => {
  const evidence = {
    filePath: '/archive/Event/Comp-A/photo.jpg',
    groups: [{ id: 'g1', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/photo.jpg'] }],
    diskComponents: [
      { folderName: 'Comp-A', location: '', city: 'London', country: 'UK', types: ['Waaz', 'Majlis'],
        additionalKeywords: [{ label: 'Children', keywordId: 'k1' }, { label: 'Outdoor', keywordId: 'k2' }] },
      { folderName: 'Comp-B', location: '', city: 'London', country: 'UK', types: ['Ziyafat'] },
    ],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.deepEqual(r.keywords, ['Waaz', 'Majlis', 'Children', 'Outdoor', 'London', 'UK']);
});

t('refined file receives only its selected Event Types + Additional Keywords', () => {
  const evidence = {
    filePath: '/archive/Event/Comp-A/photo.jpg',
    groups: [{
      id: 'g1', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/photo.jpg'],
      fileTagRefinements: {
        [require('path').normalize('/archive/Event/Comp-A/photo.jpg')]: { eventTypes: ['Waaz'], additionalKeywords: ['Children'] },
      },
    }],
    diskComponents: [
      { folderName: 'Comp-A', location: '', city: 'London', country: 'UK', types: ['Waaz', 'Majlis', 'Ziyafat'],
        additionalKeywords: [{ label: 'Children' }, { label: 'Outdoor' }, { label: 'Procession' }] },
    ],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.deepEqual(r.keywords, ['Waaz', 'Children', 'London', 'UK']);
  assert.ok(r.evidenceSource.includes('tagRefinements:explicit-override'));
});

t('explicit-empty refinement produces no refinable tags but keeps contextual metadata', () => {
  const evidence = {
    filePath: '/archive/Event/Comp-A/photo.jpg',
    photographer: 'John',
    hijriDate: '1448-01-16',
    groups: [{
      id: 'g1', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/photo.jpg'],
      fileTagRefinements: { '/archive/Event/Comp-A/photo.jpg': { eventTypes: [], additionalKeywords: [] } },
    }],
    diskComponents: [
      { folderName: 'Comp-A', location: 'Hall A', city: 'London', country: 'UK', types: ['Waaz', 'Majlis'],
        additionalKeywords: [{ label: 'Children' }] },
    ],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.deepEqual(r.keywords, ['Hall A', 'London', 'UK']);
  assert.equal(r.photographer, 'John');
  assert.equal(r.hijriDate, '1448-01-16');
  assert.equal(r.copyright, '© Aljamea-tus-Saifiyah');
});

t('no fileTagRefinements entry for a file falls through to full component defaults (reset-to-default equivalent)', () => {
  const diskComponents = [
    { folderName: 'Comp-A', location: '', city: 'London', country: 'UK', types: ['Waaz', 'Majlis'],
      additionalKeywords: [{ label: 'Children' }] },
    { folderName: 'Comp-B', location: '', city: 'London', country: 'UK', types: ['Ziyafat'] },
  ];
  const withOverride = resolveExpectedMetadata({
    filePath: '/archive/Event/Comp-A/a.jpg',
    groups: [{
      id: 'g1', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/a.jpg', '/archive/Event/Comp-A/b.jpg'],
      fileTagRefinements: { '/archive/Event/Comp-A/a.jpg': { eventTypes: ['Waaz'], additionalKeywords: [] } },
    }],
    diskComponents,
  });
  const withoutOverride = resolveExpectedMetadata({
    filePath: '/archive/Event/Comp-A/b.jpg', // no entry in fileTagRefinements — inherits
    groups: [{
      id: 'g1', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/a.jpg', '/archive/Event/Comp-A/b.jpg'],
      fileTagRefinements: { '/archive/Event/Comp-A/a.jpg': { eventTypes: ['Waaz'], additionalKeywords: [] } },
    }],
    diskComponents,
  });
  assert.deepEqual(withOverride.keywords, ['Waaz', 'London', 'UK']);
  assert.deepEqual(withoutOverride.keywords, ['Waaz', 'Majlis', 'Children', 'London', 'UK']);
});

t('Additional Keywords useInFolderName/folderPlacement never affect resolved keywords (metadata-only)', () => {
  const evidence = {
    filePath: '/archive/Event/Comp-A/photo.jpg',
    groups: [{ id: 'g1', subEventId: 'Comp-A', files: ['/archive/Event/Comp-A/photo.jpg'] }],
    diskComponents: [
      { folderName: 'Comp-A', location: '', city: 'London', country: 'UK', types: ['Waaz'],
        additionalKeywords: [{ label: 'Children', keywordId: 'k1', useInFolderName: true, folderPlacement: { order: 0 } }] },
    ],
  };
  const r = resolveExpectedMetadata(evidence);
  assert.deepEqual(r.keywords, ['Waaz', 'Children', 'London', 'UK']);
  // folderName on the resolved component is untouched by additionalKeywords/useInFolderName.
  assert.equal(r.component.folderName, 'Comp-A');
});

t('legacy metadataGroups override (single-component) still includes Additional Keywords by default, Event Type override unchanged', () => {
  const evidence = {
    filePath: '/archive/Event/photo.jpg',
    groups: [{ id: 'g1', subEventId: null, files: ['/archive/Event/photo.jpg'], metadataTags: ['Custom Tag'] }],
    diskComponents: [{ location: '', city: 'London', country: 'UK', types: ['Majlis', 'Ziyafat'],
      additionalKeywords: [{ label: 'Outdoor' }] }],
  };
  const r = resolveExpectedMetadata(evidence);
  // Event Type resolution is still fully governed by the legacy explicit override (unchanged
  // behavior); Additional Keywords are a separate category and still apply by default.
  assert.deepEqual(r.keywords, ['Custom Tag', 'Outdoor', 'London', 'UK']);
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
