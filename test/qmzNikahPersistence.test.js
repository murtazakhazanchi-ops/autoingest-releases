'use strict';

// "AutoIngest — Implement Durable QMZ Nikah Sequence Information" — Phase 9's regression list,
// exercised directly against main/qmzService.js (no Electron needed — this module has no
// direct electron dependency; only ../services/logger does, so it is stubbed exactly like the
// sibling qmzMultiRowNikahParsing.test.js / qmzSanitizedFixtureAcceptance.test.js files).
//
// Every workspace used here is a synthetic, disposable temp directory (os.tmpdir()) created
// and destroyed by this file — never a real archive/NAS path (Phase 11).
//
// Run: node test/qmzNikahPersistence.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === '../services/logger' || request.endsWith('/services/logger')) return { log: () => {} };
  return origLoad.call(this, request, ...args);
};
const qmzService = require('../main/qmzService');

let passed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  ok — ${msg}`); }
  else { console.error(`  FAIL — ${msg}`); process.exitCode = 1; }
}

async function withTempRoot(fn) {
  // realpath is required on macOS, where os.tmpdir() lives under /var, itself a symlink to
  // /private/var — qmzService's own source-path hardening (_assertSafeDestinationPath /
  // _validateSourceFile) correctly rejects a source file whose resolved real path "escapes" an
  // unresolved symlinked root, so the test root must be the SAME resolved path the service
  // itself will compare against (this is a test-environment detail, not a product defect).
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'qmz-nikah-test-')));
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  console.log('qmzNikahPersistence (synthetic temp workspaces only, no Electron)');

  // 1. PDF import (createSequence with hasNikah:true) saves Nikah as additionalActivities.
  await withTempRoot(async (root) => {
    const r = await qmzService.createSequence(root, 2, 'Z', '', { hasNikah: true });
    check(r.ok && r.code === '02Z', '1a. createSequence with hasNikah succeeds and folder name is unaffected (02Z)');
    const state = await qmzService.readState(root);
    const rec = state.sequences.find(s => s.code === '02Z');
    check(!!rec, '1b. a state record exists for 02Z');
    check(Array.isArray(rec.additionalActivities) && rec.additionalActivities.includes('Nikah'),
      '1c. 02Z is persisted with additionalActivities: ["Nikah"]');
    const dirExists = await fs.stat(path.join(root, '02Z')).then(s => s.isDirectory()).catch(() => false);
    check(dirExists, '1d. the actual 02Z folder was created on disk, same as without Nikah');
  });

  // Ordinary sequence (no Nikah) must NOT get the field at all (avoid redundant persisted noise).
  await withTempRoot(async (root) => {
    await qmzService.createSequence(root, 1, 'Q');
    const state = await qmzService.readState(root);
    const rec = state.sequences.find(s => s.code === '01Q');
    check(!('additionalActivities' in rec), '1e. an ordinary sequence has no additionalActivities field at all');
  });

  // 2. Reopening (readState on a fresh process-level call) restores it.
  await withTempRoot(async (root) => {
    await qmzService.createSequence(root, 3, 'Z', '', { hasNikah: true });
    // Simulate "close and reopen" — a brand-new readState() call, independent of any in-memory
    // state from the creation above, reading only the persisted qmz-sequences.json on disk.
    const reopened = await qmzService.readState(root);
    const rec = reopened.sequences.find(s => s.code === '03Z');
    check(!!rec?.additionalActivities?.includes('Nikah'), '2. Nikah survives a simulated close/reopen (fresh readState)');
  });

  // 3. Old JSON without the field stays compatible.
  await withTempRoot(async (root) => {
    const legacyState = { version: 1, qmzRoot: root, sequences: [{ code: '01Q', number: 1, letter: 'Q', suffix: '', type: 'Qadam' }] };
    await fs.writeFile(path.join(root, 'qmz-sequences.json'), JSON.stringify(legacyState, null, 2), 'utf8');
    const state = await qmzService.readState(root);
    check(state.sequences.length === 1 && state.sequences[0].code === '01Q',
      '3a. a pre-existing legacy record (written before this feature existed) parses without error');
    check(!('additionalActivities' in state.sequences[0]), '3b. the legacy record has no additionalActivities, as expected');
    // Writing it back out (e.g. via some other edit) must not inject the field either.
    const r = await qmzService.saveState(root, state);
    check(r.ok, '3c. saveState on an unmodified legacy state succeeds');
  });

  // 4. Sharaf-type edit preserves it.
  await withTempRoot(async (root) => {
    await qmzService.createSequence(root, 4, 'Q', '', { hasNikah: true });
    const r = await qmzService.editSequenceType(root, '04Q', 'Z');
    check(r.ok && r.code === '04Z', '4a. editSequenceType succeeds and renames the code as expected');
    const state = await qmzService.readState(root);
    const rec = state.sequences.find(s => s.code === '04Z');
    check(!!rec?.additionalActivities?.includes('Nikah'), '4b. Nikah survives a type edit (04Q→04Z)');
    check(rec.number === 4 && rec.letter === 'Z' && rec.suffix === '', '4c. number/letter/suffix updated correctly alongside the preserved Nikah flag');
  });

  // 5a. Explicit removal persists.
  await withTempRoot(async (root) => {
    await qmzService.createSequence(root, 5, 'M', '', { hasNikah: true });
    const r = await qmzService.removeSequenceNikah(root, '05M');
    check(r.ok, '5a. removeSequenceNikah succeeds');
    const state = await qmzService.readState(root);
    const rec = state.sequences.find(s => s.code === '05M');
    check(!('additionalActivities' in rec), '5b. additionalActivities key is deleted entirely (not left as an empty array)');
    const dirExists = await fs.stat(path.join(root, '05M')).then(s => s.isDirectory()).catch(() => false);
    check(dirExists, '5c. the sequence folder itself is untouched by a Nikah removal');
  });

  // 5d. Idempotent no-op when there is nothing to remove; error on an unknown code.
  await withTempRoot(async (root) => {
    await qmzService.createSequence(root, 6, 'Q'); // no Nikah
    const r1 = await qmzService.removeSequenceNikah(root, '06Q');
    check(r1.ok, '5d. removing Nikah from a sequence that never had it is a no-op success, not an error');
    const r2 = await qmzService.removeSequenceNikah(root, '99Q');
    check(!r2.ok, '5e. removing Nikah from a nonexistent sequence code returns an error');
  });

  // 6/7. Reimport reconciliation — adds when newly identified, never silently erases, never duplicates.
  await withTempRoot(async (root) => {
    // First import: no Nikah identified yet.
    await qmzService.createSequence(root, 7, 'Q');
    let state = await qmzService.readState(root);
    check(!state.sequences.find(s => s.code === '07Q').additionalActivities, '6a. first import without Nikah leaves no field');

    // Reimport of the SAME sequence, this time positively identifying Nikah — must ADD it.
    await qmzService.createSequence(root, 7, 'Q', '', { hasNikah: true });
    state = await qmzService.readState(root);
    let rec = state.sequences.find(s => s.code === '07Q');
    check(rec.additionalActivities?.includes('Nikah'), '6b. a later reimport that positively identifies Nikah adds it');
    check(state.sequences.filter(s => s.code === '07Q').length === 1, '6c. reimport never creates a duplicate record for the same code');

    // A THIRD reimport that does NOT mention Nikah must not silently remove the already-saved one.
    await qmzService.createSequence(root, 7, 'Q'); // hasNikah omitted, as a later PDF without that row would do
    state = await qmzService.readState(root);
    rec = state.sequences.find(s => s.code === '07Q');
    check(rec.additionalActivities?.includes('Nikah'), '7. a reimport that omits Nikah does NOT silently erase a previously saved Nikah flag');

    // 8. Multiple positive identifications (e.g. re-running the same import twice) never duplicate the label.
    await qmzService.createSequence(root, 7, 'Q', '', { hasNikah: true });
    state = await qmzService.readState(root);
    rec = state.sequences.find(s => s.code === '07Q');
    check(rec.additionalActivities.length === 1 && rec.additionalActivities[0] === 'Nikah',
      '8. repeated positive Nikah identification never produces a duplicate "Nikah" label');
  });

  // 9. Folder names/codes are completely unaffected by Nikah, with or without it.
  await withTempRoot(async (root) => {
    const a = await qmzService.createSequence(root, 8, 'Z', '', { hasNikah: true });
    const b = await qmzService.createSequence(root, 9, 'Z', '', { hasNikah: false });
    check(a.code === '08Z' && b.code === '09Z', '9a. codes are formatted identically regardless of Nikah');
    const names = await fs.readdir(root);
    check(names.includes('08Z') && names.includes('09Z'), '9b. both folders exist under their plain Q/M/Z codes');
    // Only sequence-code-shaped directories matter here (qmz-sequences.json itself contains
    // the letter "n" in "sequences" and must not be mistaken for a folder-naming violation).
    const seqLikeDirs = names.filter(n => /^\d{2,3}[a-z]?[A-Z]{1,2}$/.test(n));
    check(seqLikeDirs.every(n => n === '08Z' || n === '09Z'), '10. no separate Nikah-only folder was ever created');
  });

  // 11. Photographer-subfolder creation is unaffected — moveFilesToSequence still works normally
  // on a Nikah-flagged sequence (the subfolder-creation path never reads additionalActivities).
  await withTempRoot(async (root) => {
    await qmzService.createSequence(root, 10, 'Q', '', { hasNikah: true });
    // Realistic source location: every real caller moves files out of an existing
    // subfolder (_Unsequenced/<photographer>, Enroute/<photographer>, or another sequence),
    // never out of the bare qmzRoot itself — matches _qmzAutoQueueMetadata's own callers.
    const srcDir = path.join(root, '_Unsequenced', 'Photographer A');
    await fs.mkdir(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, '_source.jpg');
    await fs.writeFile(srcFile, 'synthetic-test-bytes');
    const r = await qmzService.moveFilesToSequence(root, [srcFile], '10Q', 'Photographer A');
    check(r.ok, `11a. moveFilesToSequence succeeds on a Nikah-flagged sequence (errors: ${JSON.stringify(r.errors)})`);
    const pgDirExists = await fs.stat(path.join(root, '10Q', 'Photographer A')).then(s => s.isDirectory()).catch(() => false);
    check(pgDirExists, '11b. the photographer subfolder is created exactly as it would be for any ordinary sequence');
  });

  // 12/13. Metadata isolation proof — the ONLY QMZ metadata-tagging code path
  // (_qmzAutoQueueMetadata in renderer/renderer.js, reused by both the auto-tag-on-assign flow
  // and the manual "Retry Tagging" button) builds its tag list purely from the sequence's
  // letter via a hardcoded Q/M/Z→type map. This reads the ACTUAL function source and asserts
  // it never references additionalActivities or Nikah — a loud regression guard if a future
  // change ever tries to thread Nikah into automatic photo/video metadata, which Phase 4
  // explicitly forbids.
  {
    const rendererSrc = await fs.readFile(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
    const fnMatch = rendererSrc.match(/async function _qmzAutoQueueMetadata\([^)]*\)\s*\{[\s\S]*?\n\}/);
    check(!!fnMatch, '12a. located the single QMZ metadata-tagging function in renderer.js');
    const fnBody = fnMatch ? fnMatch[0] : '';
    check(!/additionalActivities/.test(fnBody), '12b. the metadata-tagging function never reads additionalActivities');
    check(!/Nikah/.test(fnBody), '12c. the metadata-tagging function never mentions Nikah — tags come only from the Q/M/Z letter map');

    const exifSrc = await fs.readFile(path.join(__dirname, '..', 'main', 'exifService.js'), 'utf8');
    check(!/additionalActivities/.test(exifSrc) && !/Nikah/.test(exifSrc),
      '13. the actual EXIF/IPTC/XMP writer (exifService.js) never references additionalActivities or Nikah at all');
  }

  // 14. Existing (pre-Nikah) QMZ operations remain fully functional, unaffected by any of the above.
  await withTempRoot(async (root) => {
    const created = await qmzService.createSequence(root, 11, 'M'); // no hasNikah argument at all — old call shape
    check(created.ok && created.code === '11M', '14a. createSequence without the new options argument still works exactly as before');
    const edited = await qmzService.editSequenceType(root, '11M', 'Q');
    check(edited.ok && edited.code === '11Q', '14b. editSequenceType still works exactly as before');
    const removed = await qmzService.removeSequence(root, '11Q');
    check(removed.ok, '14c. removeSequence still works exactly as before');
  });

  console.log(`\n${passed} passed`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
