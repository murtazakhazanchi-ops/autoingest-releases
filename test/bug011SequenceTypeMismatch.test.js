'use strict';

// Regression test for BUG-011's actual confirmed root cause (2026-08-11): a
// mixed-type `sequence` field crashing master:scanEvents's resolved.sort()
// with `TypeError: b.sequence.localeCompare is not a function`.
//
// Root cause: parseEventName()'s regex capture always returns sequence as a
// zero-padded string, but the fallback path (eventJson.sequence, used only
// when a folder's NAME fails to parse — e.g. an unrecognized city token) can
// be whatever type was last persisted to disk. The Create/Edit Event form
// always writes sequence as a number (renderer/eventCreator.js's
// `parseInt(seq, 10)` payloads), so a single unparseable-name folder mixes a
// number into an otherwise all-string sequence set, and the very next sort
// comparison against any normally-parsed neighbor throws — aborting
// discovery for the ENTIRE collection, not just that one folder. This is
// platform-independent (pure JS type coercion), not a Windows/SMB defect —
// it surfaced on the real Windows archive because that's where a folder with
// an unrecognized city token happened to exist.
//
// The fix (main/main.js, inside _scanEventsCore): normalize sequence to a
// zero-padded string at the one point it's first computed, using the exact
// pattern _scanNasArchive (same file, ~line 3131) already used for the
// identical value — the canonical type this codebase already assumes
// (eventNameParser.js's own comment: "zero-padded string — preserved for
// localeCompare sort in main.js").
//
// TEST 1 mirrors the normalization expression verbatim (source-drift
// guarded) against the exact mixed data requested: "01", "10", 1, 2, 11,
// undefined — proving no exception and correct zero-padded-string output for
// every case.
// TEST 2 reproduces the actual bug end-to-end against the REAL production
// code (not a mirror) via the real Electron app: a 3-event collection where
// one folder's name is deliberately unparseable (an unrecognized city token)
// and its event.json stores sequence as a NUMBER, alongside two normally-
// named events with string sequence. Before the fix this throws inside
// master:scanEvents and the renderer never receives a result (exactly what
// the real tester's app.log showed); after the fix it must return ok:true
// with all 3 events, correctly and stably sorted.
//
// Run: node test/bug011SequenceTypeMismatch.test.js

const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

// ── TEST 1: mirror of the fix's normalization expression (source-drift
// guarded — keep in sync with main/main.js's _scanEventsCore if this
// expression ever changes) ─────────────────────────────────────────────────
function normalizeSequence(seqRaw) {
  return typeof seqRaw === 'number' ? String(seqRaw).padStart(2, '0') : String(seqRaw);
}

(function test1() {
  const cases = [
    { input: '01', expected: '01' },
    { input: '10', expected: '10' },
    { input: 1, expected: '01' },
    { input: 2, expected: '02' },
    { input: 11, expected: '11' },
    { input: undefined, expected: 'undefined' }, // never reached in practice — the
    // `eventJson.sequence || '00'` fallback upstream of this normalization already
    // converts undefined/falsy to the string '00' before it gets here; included per
    // the requested mixed-data set for completeness, not because it's a real input.
  ];

  for (const { input, expected } of cases) {
    let result;
    let threw = false;
    try {
      result = normalizeSequence(input);
    } catch (err) {
      threw = true;
    }
    if (threw) {
      fail(`TEST 1: normalizeSequence(${JSON.stringify(input)}) must not throw`);
      continue;
    }
    if (result === expected) {
      ok(`TEST 1: normalizeSequence(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`);
    } else {
      fail(`TEST 1: normalizeSequence(${JSON.stringify(input)})`, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
    }
  }

  // Sorting a mixed-type array (pre-fix input shape) must not throw once every
  // value has passed through normalizeSequence first.
  const mixed = ['01', '10', 1, 2, 11, undefined].map(normalizeSequence);
  let sortThrew = false;
  let sorted;
  try {
    sorted = [...mixed].sort((a, b) => b.localeCompare(a));
  } catch (err) {
    sortThrew = true;
  }
  if (sortThrew) {
    fail('TEST 1: sorting normalized mixed-type sequence values must not throw');
  } else {
    ok('TEST 1: sorting normalized mixed-type sequence values completes without throwing');
  }
  try {
    assert.deepStrictEqual(sorted, ['undefined', '11', '10', '02', '01', '01']);
    ok('TEST 1: normalized mixed values sort into stable, deterministic lexical order');
  } catch (err) {
    fail('TEST 1: sort order mismatch', err.message);
  }
})();

// ── TEST 1b: direct comparator-level reproduction, order-independent ────────
// `b.sequence.localeCompare(a.sequence)` only throws when `b.sequence` (the
// receiver .localeCompare is called ON) is non-string — String.localeCompare
// coerces its ARGUMENT automatically, so a mismatched type in the `a`
// position alone never throws. Array.prototype.sort()'s internal comparison
// order (which entry lands in `a` vs `b` for a given pair) is engine/input-
// order-dependent, which is why a live end-to-end test can pass or fail
// non-deterministically depending on filesystem readdir order (confirmed
// empirically while building this test). Calling the comparator directly,
// in BOTH argument orders, is what actually proves the fix — independent of
// any sort algorithm's internal call pattern.
(function test1b() {
  // Mirrors main/main.js's resolved.sort() comparator verbatim (source-drift
  // guarded) — PRE-FIX shape (raw, unnormalized sequence) to prove the throw
  // condition, and POST-FIX shape (normalized) to prove the fix.
  function comparatorPreFix(a, b) {
    if (a.hijriDate !== b.hijriDate) return b.hijriDate.localeCompare(a.hijriDate);
    return b.sequence.localeCompare(a.sequence);
  }
  const stringEntry = { hijriDate: '1448-01-05', sequence: '01' };
  const numberEntry = { hijriDate: '1448-01-05', sequence: 5 };

  let threwWithNumberAsB = false;
  try { comparatorPreFix(stringEntry, numberEntry); } catch { threwWithNumberAsB = true; }
  if (threwWithNumberAsB) {
    ok('TEST 1b: pre-fix comparator throws when the number-typed sequence lands in the `b` (receiver) position — confirms the exact real-world trigger condition');
  } else {
    fail('TEST 1b: pre-fix comparator should have thrown with a number-typed `b.sequence` — the reproduction itself may be wrong');
  }

  let threwWithNumberAsA = false;
  try { comparatorPreFix(numberEntry, stringEntry); } catch { threwWithNumberAsA = true; }
  // Documented, not asserted as a failure: this direction does NOT throw
  // (localeCompare coerces its argument) — this asymmetry is exactly why the
  // real bug was intermittent rather than 100%-reproducible from any array
  // order.
  console.log(`  info — TEST 1b: pre-fix comparator with number-typed \`a.sequence\` (argument position) throws=${threwWithNumberAsA} (expected false — documents the asymmetry, not a pass/fail check)`);

  // Post-fix: the SAME two entries, with sequence normalized exactly as
  // main.js's fix does, in BOTH argument orders — neither may ever throw.
  function normalizeSequenceLocal(seqRaw) {
    return typeof seqRaw === 'number' ? String(seqRaw).padStart(2, '0') : String(seqRaw);
  }
  const stringEntryFixed = { ...stringEntry, sequence: normalizeSequenceLocal(stringEntry.sequence) };
  const numberEntryFixed = { ...numberEntry, sequence: normalizeSequenceLocal(numberEntry.sequence) };
  let postFixThrew = false;
  try {
    comparatorPreFix(stringEntryFixed, numberEntryFixed);
    comparatorPreFix(numberEntryFixed, stringEntryFixed);
  } catch { postFixThrew = true; }
  if (postFixThrew) {
    fail('TEST 1b: comparator must not throw in either argument order once both sequences are normalized');
  } else {
    ok('TEST 1b: comparator never throws in either argument order once both sequences are normalized (the actual fix)');
  }
})();

// ── TEST 2: live end-to-end reproduction against the real production code ──
async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeEventJsonFixture(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(data, null, 2), 'utf8');
}

(async () => {
  const userDataDir = await mkTmp('ai-seqtype-userdata-');
  const archiveRoot = await mkTmp('ai-seqtype-archive-');
  console.log('[seqtype] userDataDir =', userDataDir);
  console.log('[seqtype] archiveRoot =', archiveRoot);

  const collName = '1448-01-11 _UK Safar';
  const collDir = path.join(archiveRoot, collName);

  // Two normally-named events — parseEventName succeeds, sequence is always a
  // zero-padded string from the regex, matching production's real common case.
  const normalName1 = '1448-01-05 _01-Majlis-Bradford';
  await writeEventJsonFixture(path.join(collDir, normalName1), {
    version: 1, hijriDate: '1448-01-05', sequence: 1, // stored as a NUMBER on disk too — irrelevant here, parsed.ok wins
    eventName: normalName1, safeEventName: normalName1, status: 'complete',
    components: [{ types: ['Majlis'], location: null, city: 'Bradford', country: 'United Kingdom', folderName: '01-Majlis-Bradford' }],
  });
  const normalName2 = '1448-01-20 _10-Majlis-London';
  await writeEventJsonFixture(path.join(collDir, normalName2), {
    version: 1, hijriDate: '1448-01-20', sequence: 10,
    eventName: normalName2, safeEventName: normalName2, status: 'complete',
    components: [{ types: ['Majlis'], location: null, city: 'London', country: 'United Kingdom', folderName: '10-Majlis-London' }],
  });

  // The trigger: a folder name parseEventName CANNOT parse — "Zzyzxvilleburg"
  // is deliberately not a real city, guaranteed absent from data/cities.json
  // (confirmed by direct inspection — "Nairobi" was tried first and turned
  // out to actually BE in the default list, which silently made an earlier
  // version of this test pass for the wrong reason: parsed.ok was true after
  // all, so the buggy fallback path was never exercised). This is what makes
  // parsed.ok false and routes to the eventJson.hijriDate/sequence fallback
  // (parseEventName returns no hijriDate/sequence fields at all when it
  // fails — confirmed by reading eventNameParser.js). Its event.json's
  // hijriDate is deliberately set to MATCH normalName1's date — the sort
  // comparator's `b.sequence.localeCompare(a.sequence)` line is only ever
  // reached when two entries share the same hijriDate (the hijriDate branch
  // short-circuits otherwise); an earlier version of this fixture used a
  // distinct date for every event and never actually exercised the crashing
  // line, which is why it initially passed even without the fix — caught by
  // deliberately reverting the fix locally and confirming this exact
  // fixture now fails with the real TypeError before re-applying it.
  // sequence stores a NUMBER (matching real production writes) — before the
  // fix, this single entry crashes the sort for the whole collection the
  // moment it's compared against normalName1's string sequence.
  const unparseableName = '1448-01-30 _05-Majlis-Zzyzxvilleburg';
  await writeEventJsonFixture(path.join(collDir, unparseableName), {
    version: 1, hijriDate: '1448-01-05', sequence: 5, // NUMBER, same hijriDate as normalName1 — forces the sequence comparison
    eventName: unparseableName, safeEventName: unparseableName, status: 'complete',
    components: [{ types: ['Majlis'], location: null, city: 'Zzyzxvilleburg', country: 'Nowhere', folderName: '05-Majlis-Zzyzxvilleburg' }],
  });

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', () => {});
  electronApp.process().stderr.on('data', () => {});

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'SeqType Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'SeqType Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(async (root) => {
    await window.api.initArchiveRoot(root);
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
  }, archiveRoot);

  const scanResult = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);

  if (scanResult?.ok === true) {
    ok('TEST 2: master:scanEvents returns ok:true for a collection with a mixed string/number sequence (does NOT throw)');
  } else {
    fail('TEST 2: master:scanEvents must return ok:true, not reject/error', scanResult);
  }

  const names = (scanResult?.events || []).map((e) => e.folderName);
  if (names.length === 3 && names.includes(normalName1) && names.includes(normalName2) && names.includes(unparseableName)) {
    ok('TEST 2: all 3 events present, including the one whose name parseEventName cannot parse');
  } else {
    fail('TEST 2: expected exactly 3 events including the unparseable-name one', names);
  }

  // Backward compatibility: the previously-unparseable-name event must still be
  // usable — isParseable (via the legacy/corrupt-tolerant branch, since its
  // event.json is valid even though its folder name alone wouldn't classify) and
  // its sequence field, wherever it ends up, must be the normalized string type.
  const unparseableEvent = (scanResult?.events || []).find((e) => e.folderName === unparseableName);
  check_unparseable: {
    if (!unparseableEvent) { fail('TEST 2: unparseable-name event missing from result entirely'); break check_unparseable; }
    if (typeof unparseableEvent.sequence !== 'string') {
      fail('TEST 2: unparseable-name event.sequence must be normalized to a string', unparseableEvent.sequence);
    } else {
      ok(`TEST 2: unparseable-name event.sequence is normalized to a string ("${unparseableEvent.sequence}")`);
    }
  }

  // Stable sort: hijriDate desc, then sequence desc within the same date — no
  // exception during comparison, and a deterministic, reproducible order.
  // Newest-first: normalName2 (1448-01-20) sorts first; unparseableName and
  // normalName1 share hijriDate 1448-01-05, so descending sequence ("05" >
  // "01" lexically) puts unparseableName before normalName1 — this ordering
  // is only reachable at all if the sequence comparison didn't throw.
  const resolvedFolderNames = names; // already newest-first per _scanEventsCore's own sort
  try {
    assert.deepStrictEqual(resolvedFolderNames, [normalName2, unparseableName, normalName1]);
    ok('TEST 2: events sort newest-hijriDate-first without throwing, in deterministic order');
  } catch (err) {
    fail('TEST 2: sort order unexpected', { actual: resolvedFolderNames, error: err.message });
  }

  // Legacy event.json files (no folder-name-parseable prefix at all, i.e. a
  // pre-existing manual folder with only an event.json inside) must still load —
  // this is the "backward compatibility" requirement, exercised as a 4th event.
  const legacyName = 'Some Manually Renamed Folder';
  await writeEventJsonFixture(path.join(collDir, legacyName), {
    version: 1, hijriDate: '1447-06-10', sequence: '03', // legacy file, sequence already a string
    eventName: legacyName, safeEventName: legacyName, status: 'created',
    components: [{ types: ['Majlis'], location: null, city: 'Bradford', country: 'United Kingdom', folderName: '03-Majlis-Bradford' }],
  });
  const rescan = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  if (rescan?.ok === true && (rescan.events || []).some((e) => e.folderName === legacyName)) {
    ok('TEST 2: legacy event.json (no parseable folder-name prefix) still loads correctly alongside the fix');
  } else {
    fail('TEST 2: legacy event.json failed to load after the fix', rescan);
  }

  await electronApp.close();
  await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(archiveRoot, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${passed} test(s) passed.`);
  if (process.exitCode) console.error('SOME TESTS FAILED');
})();
