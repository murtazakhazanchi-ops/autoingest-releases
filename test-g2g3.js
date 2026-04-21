/**
 * test-g2g3.js — smoke tests for G2 (copyFileJobs) and G3 (buildFileJobs)
 *
 * Run from the project root:
 *   node test-g2g3.js
 *
 * No test framework needed — plain assertions, exit 0 on pass, exit 1 on fail.
 */

'use strict';

const fs   = require('fs');
const fsp  = require('fs').promises;
const path = require('path');
const os   = require('os');

// ── Tiny assertion helpers ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    console.error(`      expected: ${JSON.stringify(b)}`);
    console.error(`      received: ${JSON.stringify(a)}`);
    failed++;
  }
}

// ── G3: buildFileJobs ─────────────────────────────────────────────────────────
// Load importRouter.js in Node by eval-ing it (it uses a browser-global IIFE pattern).

console.log('\n═══ G3: ImportRouter.buildFileJobs ═══\n');

{
  const ImportRouter = require('./renderer/importRouter');

  // ── Fixture helpers ───────────────────────────────────────────────────────

  const MASTER = '/archive/1447-10-03 _Surat Safar';

  function makeGroup(id, filePaths, subEventId = null) {
    return { id, label: `G${id}`, colorIdx: 0, files: new Set(filePaths), subEventId };
  }

  function makeEventData(eventName, numComponents, masterPath = MASTER) {
    const components = Array.from({ length: numComponents }, (_, i) => ({
      eventTypes: [{ id: 'Fajr Namaz', label: 'Fajr Namaz' }],
      location:   { id: 'Mazar Saifee', label: 'Mazar Saifee' },
      city:       { id: 'Surat', label: 'Surat' },
    }));
    return {
      coll:  { name: path.basename(masterPath), _masterPath: masterPath, events: [], hijriDate: '1447-10-03' },
      event: { name: eventName, components },
      idx:   0,
    };
  }

  // ── Test 1: single-component, photo file ──────────────────────────────────

  {
    const groups    = [makeGroup(1, ['/card/DCIM/IMG_001.CR3'])];
    const eventData = makeEventData('1447-10-03 _01-Fajr Namaz-Mazar Saifee-Surat', 1);
    const { fileJobs, skippedSrcs } = ImportRouter.buildFileJobs({
      groups, eventData, photographer: 'Ahmed'
    });

    assert(fileJobs.length === 1, 'single-component photo: 1 job produced');
    assert(skippedSrcs.length === 0, 'single-component photo: 0 skipped');
    assertEqual(
      fileJobs[0].src,  '/card/DCIM/IMG_001.CR3',
      'single-component photo: src preserved'
    );
    assertEqual(
      fileJobs[0].dest,
      `${MASTER}/1447-10-03 _01-Fajr Namaz-Mazar Saifee-Surat/Ahmed/IMG_001.CR3`,
      'single-component photo: dest path correct'
    );
  }

  // ── Test 2: single-component, VIDEO file ─────────────────────────────────

  {
    const groups    = [makeGroup(1, ['/card/DCIM/CLIP_001.MP4'])];
    const eventData = makeEventData('1447-10-03 _01-Ziyarat-Surat', 1);
    const { fileJobs } = ImportRouter.buildFileJobs({
      groups, eventData, photographer: 'Hussain'
    });

    assert(fileJobs.length === 1, 'single-component video: 1 job produced');
    assertEqual(
      fileJobs[0].dest,
      `${MASTER}/1447-10-03 _01-Ziyarat-Surat/Hussain/VIDEO/CLIP_001.MP4`,
      'single-component video: routes to VIDEO/ subfolder'
    );
  }

  // ── Test 3: single-component, .mov file ──────────────────────────────────

  {
    const groups    = [makeGroup(1, ['/card/PRIVATE/AVCHD/BDMV/STREAM/00001.MTS'.replace('MTS','MOV')])];
    const eventData = makeEventData('1447-10-03 _01-Ziyarat-Surat', 1);
    const { fileJobs } = ImportRouter.buildFileJobs({
      groups, eventData, photographer: 'Hussain'
    });
    const dest = fileJobs[0]?.dest || '';
    assert(dest.includes('/VIDEO/'), 'single-component .mov: routes to VIDEO/ subfolder');
  }

  // ── Test 4: multi-component, all groups assigned ──────────────────────────

  {
    const subEvent1 = '01-Fajr Namaz-Mazar Saifee-Surat';
    const subEvent2 = '02-Ziyarat-Mazar Saifee-Surat';
    const groups = [
      makeGroup(1, ['/card/IMG_001.CR3', '/card/IMG_002.CR3'], subEvent1),
      makeGroup(2, ['/card/IMG_003.CR3'],                      subEvent2),
    ];
    const eventData = makeEventData('1447-10-03 _01-Fajr Namaz-Ziyarat-Mazar Saifee-Surat', 2);
    const { fileJobs, skippedSrcs } = ImportRouter.buildFileJobs({
      groups, eventData, photographer: 'Ahmed'
    });

    assert(fileJobs.length === 3, 'multi-component: 3 jobs produced (2+1)');
    assert(skippedSrcs.length === 0, 'multi-component: 0 skipped');

    const g1Jobs = fileJobs.filter(j => j.dest.includes(subEvent1));
    const g2Jobs = fileJobs.filter(j => j.dest.includes(subEvent2));
    assert(g1Jobs.length === 2, 'multi-component: group 1 → 2 files in subEvent1 dir');
    assert(g2Jobs.length === 1, 'multi-component: group 2 → 1 file in subEvent2 dir');

    const expectedDest1 = `${MASTER}/1447-10-03 _01-Fajr Namaz-Ziyarat-Mazar Saifee-Surat/${subEvent1}/Ahmed/IMG_001.CR3`;
    assertEqual(g1Jobs[0].dest, expectedDest1, 'multi-component: full dest path for group 1 correct');
  }

  // ── Test 5: multi-component, one group missing subEvent → skipped ─────────

  {
    const groups = [
      makeGroup(1, ['/card/IMG_001.CR3'], '01-Fajr Namaz-Surat'),
      makeGroup(2, ['/card/IMG_002.CR3'], null), // missing → should be skipped
    ];
    const eventData = makeEventData('1447-10-03 _01-Fajr Namaz-Surat', 2);
    const { fileJobs, skippedSrcs } = ImportRouter.buildFileJobs({
      groups, eventData, photographer: 'Ahmed'
    });

    assert(fileJobs.length === 1,    'multi-component: group without subEvent excluded from jobs');
    assert(skippedSrcs.length === 1, 'multi-component: unassigned file tracked in skippedSrcs');
    assert(skippedSrcs[0] === '/card/IMG_002.CR3', 'multi-component: correct src in skippedSrcs');
  }

  // ── Test 6: guard — empty groups returns empty ────────────────────────────

  {
    const eventData = makeEventData('1447-10-03 _01-Fajr Namaz-Surat', 1);
    const { fileJobs, skippedSrcs } = ImportRouter.buildFileJobs({
      groups: [], eventData, photographer: 'Ahmed'
    });
    assert(fileJobs.length === 0,    'empty groups: 0 jobs');
    assert(skippedSrcs.length === 0, 'empty groups: 0 skipped');
  }

  // ── Test 7: guard — missing photographer returns empty ───────────────────

  {
    const eventData = makeEventData('1447-10-03 _01-Fajr Namaz-Surat', 1);
    const { fileJobs } = ImportRouter.buildFileJobs({
      groups: [makeGroup(1, ['/card/IMG_001.CR3'])],
      eventData,
      photographer: '',
    });
    assert(fileJobs.length === 0, 'missing photographer: 0 jobs (guard returns early)');
  }

  // ── Test 8: Windows-style src path — basename extraction ─────────────────

  {
    const groups    = [makeGroup(1, ['D:\\DCIM\\IMG_WIN.CR3'])];
    const eventData = makeEventData('1447-10-03 _01-Fajr Namaz-Surat', 1);
    const { fileJobs } = ImportRouter.buildFileJobs({
      groups, eventData, photographer: 'Ahmed'
    });
    // basename of 'D:\DCIM\IMG_WIN.CR3' should be 'IMG_WIN.CR3'
    assert(
      fileJobs[0]?.dest.endsWith('/IMG_WIN.CR3'),
      'Windows src path: basename extracted correctly from backslash path'
    );
  }
}

// ── G2: copyFileJobs ──────────────────────────────────────────────────────────

console.log('\n═══ G2: copyFileJobs ═══\n');

async function testCopyFileJobs() {
  // Create a temp directory for this run
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-g2-test-'));

  try {
    // ── Fixture: create 5 source files ────────────────────────────────────

    const srcDir = path.join(tmpRoot, 'src');
    await fsp.mkdir(srcDir, { recursive: true });

    const sourceFiles = [
      { name: 'IMG_001.JPG', content: 'jpeg-data-aaa', destSub: 'Event/Ahmed' },
      { name: 'IMG_002.CR3', content: 'raw-data-bbb',  destSub: 'Event/Ahmed' },
      { name: 'CLIP_001.MP4',content: 'video-data-ccc',destSub: 'Event/Ahmed/VIDEO' },
      { name: 'IMG_003.JPG', content: 'jpeg-data-ddd', destSub: 'Event/Sub1/Ahmed' },
      { name: 'IMG_004.JPG', content: 'jpeg-data-eee', destSub: 'Event/Sub2/Ahmed' },
    ];

    const fileJobs = [];
    for (const f of sourceFiles) {
      const srcPath  = path.join(srcDir, f.name);
      await fsp.writeFile(srcPath, f.content, 'utf8');
      const destDir  = path.join(tmpRoot, 'dest', f.destSub);
      fileJobs.push({ src: srcPath, dest: path.join(destDir, f.name) });
    }

    // ── Import copyFileJobs ────────────────────────────────────────────────

    // Temporarily stub the logger so we don't need services/logger.js
    const loggerPath = path.join(__dirname, 'services/logger.js');
    const origLogger = require.cache[require.resolve(loggerPath)];
    require.cache[require.resolve(loggerPath)] = {
      id: require.resolve(loggerPath),
      filename: require.resolve(loggerPath),
      loaded: true,
      exports: { log: () => {} },
    };

    const { copyFileJobs } = require('./main/fileManager');

    const progressEvents = [];
    const result = await copyFileJobs(fileJobs, (p) => progressEvents.push(p));

    // Restore logger cache
    if (origLogger) require.cache[require.resolve(loggerPath)] = origLogger;
    else delete require.cache[require.resolve(loggerPath)];

    // ── Assertions ─────────────────────────────────────────────────────────

    assert(result.copied  === 5, `copyFileJobs: copied=5 (got ${result.copied})`);
    assert(result.skipped === 0, `copyFileJobs: skipped=0 (got ${result.skipped})`);
    assert(result.errors  === 0, `copyFileJobs: errors=0 (got ${result.errors})`);
    assert(result.copiedFiles.length === 5, 'copyFileJobs: copiedFiles array has 5 entries');
    assert(typeof result.duration === 'number' && result.duration >= 0, 'copyFileJobs: duration is a non-negative number');

    // Verify each file landed in the correct directory
    for (const f of sourceFiles) {
      const destDir  = path.join(tmpRoot, 'dest', f.destSub);
      const destPath = path.join(destDir, f.name);
      let stat;
      try { stat = await fsp.stat(destPath); } catch { stat = null; }
      assert(stat && stat.isFile(), `copyFileJobs: ${f.destSub}/${f.name} exists at dest`);

      if (stat) {
        const content = await fsp.readFile(destPath, 'utf8');
        assert(content === f.content, `copyFileJobs: ${f.name} content matches source`);
      }
    }

    // Verify VIDEO/ subdirectory was auto-created
    const videoDir = path.join(tmpRoot, 'dest', 'Event', 'Ahmed', 'VIDEO');
    let videoDirStat;
    try { videoDirStat = await fsp.stat(videoDir); } catch { videoDirStat = null; }
    assert(videoDirStat && videoDirStat.isDirectory(), 'copyFileJobs: VIDEO/ subdirectory auto-created');

    // ── Test 2: re-running same jobs → all skipped ────────────────────────

    const result2 = await copyFileJobs(fileJobs, () => {});
    assert(result2.copied  === 0, 'copyFileJobs (re-run): 0 copied (all already exist same size)');
    assert(result2.skipped === 5, 'copyFileJobs (re-run): 5 skipped (exact duplicates)');
    assert(result2.errors  === 0, 'copyFileJobs (re-run): 0 errors');

    // ── Test 3: empty jobs array → early return ───────────────────────────

    const result3 = await copyFileJobs([], () => {});
    assert(result3.copied  === 0, 'copyFileJobs (empty): 0 copied');
    assert(result3.skipped === 0, 'copyFileJobs (empty): 0 skipped');

    // ── Test 4: rename on size conflict ───────────────────────────────────

    // Write a different-content file to a new src path but same filename as IMG_001.JPG
    const conflictSrc = path.join(srcDir, 'IMG_001_conflict.JPG');
    await fsp.writeFile(conflictSrc, 'different-content-XYZ', 'utf8');

    const dest1 = path.join(tmpRoot, 'dest', 'Event', 'Ahmed', 'IMG_001.JPG');
    const conflictJob = [{ src: conflictSrc, dest: dest1 }];
    const result4 = await copyFileJobs(conflictJob, () => {});

    assert(result4.copied  === 1, 'copyFileJobs (rename conflict): copied=1');
    assert(result4.skipped === 0, 'copyFileJobs (rename conflict): skipped=0');
    assert(result4.errors  === 0, 'copyFileJobs (rename conflict): errors=0');

    // The renamed file should exist (e.g. IMG_001_1.JPG)
    const renamedPath = path.join(tmpRoot, 'dest', 'Event', 'Ahmed', 'IMG_001_1.JPG');
    let renamedStat;
    try { renamedStat = await fsp.stat(renamedPath); } catch { renamedStat = null; }
    assert(renamedStat && renamedStat.isFile(), 'copyFileJobs (rename conflict): renamed file exists as IMG_001_1.JPG');

    if (renamedStat) {
      const content = await fsp.readFile(renamedPath, 'utf8');
      assert(content === 'different-content-XYZ', 'copyFileJobs (rename conflict): renamed file content correct');
    }

  } finally {
    // Cleanup temp dir
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

testCopyFileJobs()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n  ⚠️  Some tests failed. Fix before proceeding to G4.\n');
      process.exit(1);
    } else {
      console.log('\n  🎉 All tests passed. G2 + G3 are solid.\n');
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('\n  💥 Test runner threw an unexpected error:\n', err);
    process.exit(1);
  });
