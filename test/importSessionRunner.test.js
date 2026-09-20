'use strict';

// Plain Node fixtures for the multi-event runner — fake dependencies, no Electron, no
// filesystem. Run with: node test/importSessionRunner.test.js
//
// Covers failure isolation (event-local → continue), fatal stops (abort / source
// disconnect / cancelled copy → remaining events not started), abort state surviving
// between events, cleanup-eligibility (copiedFiles only from events that returned a
// summary), retry retention, and that a one-event plan runs through the same runner.

const assert = require('node:assert/strict');
const Runner = require('../renderer/importSessionRunner');

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

const item = (ordinal, name) => ({ eventKey: `/archive/C/${name}`, ordinal, name });
const PLAN3 = () => ({ hasBlocking: false, events: [item(1, 'A'), item(2, 'B'), item(3, 'C')] });

const summaryFor = (name, over = {}) => ({
  copied: 2, skipped: 0, errors: 0, duration: 10,
  copiedFiles: [{ src: `/src/${name}1`, dest: `/dest/${name}1`, size: 1, copyVerified: true }, { src: `/src/${name}2`, dest: `/dest/${name}2`, size: 1, copyVerified: true }],
  ...over,
});

/** Fake deps; `commitImpl(item, ctx)` decides each event's outcome. */
function makeDeps(commitImpl, over = {}) {
  const log = [];
  const deps = {
    log,
    shouldStop: async () => null,
    isSourceAlive: async () => true,
    prepareEvent: async (it) => ({ ok: true, prepared: { it } }),
    commit: async (it, prepared, ctx) => { log.push(['commit', it.name, ctx.index, ctx.importSessionId]); return commitImpl(it, ctx); },
    markInProgress: async (it) => { log.push(['inprogress', it.name]); },
    onEventFailed: async (it) => { log.push(['rollback', it.name]); },
    onEventStart: (it, i, n) => { log.push(['start', it.name, i, n]); },
    onEventEnd: (e) => { log.push(['end', e.name, e.status]); },
    ...over,
  };
  return deps;
}

(async () => {
  console.log('importSessionRunner');

  await t('all events succeed: run in ordinal order, all completed, all cleared', async () => {
    const deps = makeDeps((it) => summaryFor(it.name));
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.status, 'completed');
    assert.deepEqual(r.events.map(e => [e.name, e.status]), [['A', 'completed'], ['B', 'completed'], ['C', 'completed']]);
    assert.equal(r.completedKeys.length, 3);
    assert.equal(r.retainedKeys.length, 0);
    assert.equal(r.totals.copied, 6);
    assert.deepEqual(deps.log.filter(l => l[0] === 'commit').map(l => l[1]), ['A', 'B', 'C']);
  });

  await t('every commit of one run shares one importSessionId (Deep Verify accumulation)', async () => {
    const deps = makeDeps((it) => summaryFor(it.name));
    const r = await Runner.run(PLAN3(), deps);
    const ids = new Set(deps.log.filter(l => l[0] === 'commit').map(l => l[3]));
    assert.equal(ids.size, 1);
    assert.equal([...ids][0], r.importSessionId);
  });

  await t('two runs get different importSessionIds', async () => {
    const a = await Runner.run(PLAN3(), makeDeps((it) => summaryFor(it.name)));
    const b = await Runner.run(PLAN3(), makeDeps((it) => summaryFor(it.name)));
    assert.notEqual(a.importSessionId, b.importSessionId);
  });

  await t('event-local failure (lock busy) in B: A and C still complete; B retained for retry', async () => {
    const deps = makeDeps((it) => {
      if (it.name === 'B') throw new Error("Error invoking remote method 'import:commitTransaction': Error: Archive folder is busy — locked by Mac-2. Please retry.");
      return summaryFor(it.name);
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.status, 'partial');
    assert.deepEqual(r.events.map(e => [e.name, e.status]), [['A', 'completed'], ['B', 'failed'], ['C', 'completed']]);
    assert.equal(r.events[1].fatal, false);
    assert.match(r.events[1].error, /^Archive folder is busy/, 'IPC wrapper is stripped');
    assert.deepEqual(r.completedKeys, [item(1, 'A').eventKey, item(3, 'C').eventKey]);
    assert.deepEqual(r.retainedKeys, [item(2, 'B').eventKey]);
    assert.ok(deps.log.some(l => l[0] === 'rollback' && l[1] === 'B'));
  });

  await t('event.json transaction failure is event-local too', async () => {
    const deps = makeDeps((it) => { if (it.name === 'A') throw new Error('Event finalization failed (EACCES): denied'); return summaryFor(it.name); });
    const r = await Runner.run(PLAN3(), deps);
    assert.deepEqual(r.events.map(e => e.status), ['failed', 'completed', 'completed']);
  });

  await t('prepare failure (e.g. local mirror) is event-local: reported failed, run continues', async () => {
    const deps = makeDeps((it) => summaryFor(it.name), {
      prepareEvent: async (it) => it.name === 'B' ? { ok: false, error: 'Local staging setup failed: disk full' } : { ok: true, prepared: {} },
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.deepEqual(r.events.map(e => e.status), ['completed', 'failed', 'completed']);
    assert.equal(r.events[1].error, 'Local staging setup failed: disk full');
    assert.equal(deps.log.some(l => l[0] === 'commit' && l[1] === 'B'), false, 'B never reached commit');
  });

  await t('cancelled copy (abort / source loss) during B is fatal: C is not started', async () => {
    const deps = makeDeps((it) => {
      if (it.name === 'B') throw new Error('Import was cancelled — 3 of 10 files copied before cancellation. Retry to import the remaining files.');
      return summaryFor(it.name);
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.status, 'aborted');
    assert.deepEqual(r.events.map(e => [e.name, e.status]), [['A', 'completed'], ['B', 'failed'], ['C', 'not-started']]);
    assert.equal(r.events[1].fatal, true);
    assert.deepEqual(r.retainedKeys, [item(2, 'B').eventKey, item(3, 'C').eventKey]);
    assert.equal(deps.log.some(l => l[0] === 'commit' && l[1] === 'C'), false);
  });

  await t('abort BETWEEN events: remaining events never start (abort state is not reset by the next event)', async () => {
    let abort = false;
    const deps = makeDeps((it) => { if (it.name === 'A') abort = true; return summaryFor(it.name); }, {
      shouldStop: async () => (abort ? 'aborted' : null),
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.deepEqual(r.events.map(e => [e.name, e.status]), [['A', 'completed'], ['B', 'not-started'], ['C', 'not-started']]);
    assert.equal(r.events[1].reason, 'aborted');
    assert.equal(r.status, 'aborted');
    assert.deepEqual(deps.log.filter(l => l[0] === 'commit').map(l => l[1]), ['A']);
  });

  await t('source disconnected between events stops the run', async () => {
    let gone = false;
    const deps = makeDeps((it) => { if (it.name === 'A') gone = true; return summaryFor(it.name); }, {
      shouldStop: async () => (gone ? 'source-disconnected' : null),
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.fatal, 'source-disconnected');
    assert.deepEqual(r.events.map(e => e.status), ['completed', 'not-started', 'not-started']);
  });

  await t('an otherwise event-local-looking error becomes fatal when the source is no longer readable', async () => {
    const deps = makeDeps((it) => { if (it.name === 'B') throw new Error('EIO: i/o error, read'); return summaryFor(it.name); }, {
      isSourceAlive: async () => false,
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.fatal, 'source-disconnected');
    assert.deepEqual(r.events.map(e => e.status), ['completed', 'failed', 'not-started']);
    assert.equal(r.events[1].fatal, true);
  });

  await t('an abort requested DURING an event that fails with a generic error is treated as fatal', async () => {
    let abort = false;
    const deps = makeDeps((it) => { if (it.name === 'B') { abort = true; throw new Error('something else'); } return summaryFor(it.name); }, {
      shouldStop: async () => (abort ? 'aborted' : null),
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.deepEqual(r.events.map(e => e.status), ['completed', 'failed', 'not-started']);
  });

  await t('per-file errors inside a committed transaction: completed-with-errors, retained, never reported as success', async () => {
    const deps = makeDeps((it) => it.name === 'B' ? summaryFor('B', { copied: 1, errors: 1 }) : summaryFor(it.name));
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.events[1].status, 'completed-with-errors');
    assert.deepEqual(r.completedKeys, [item(1, 'A').eventKey, item(3, 'C').eventKey]);
    assert.deepEqual(r.retainedKeys, [item(2, 'B').eventKey]);
    assert.equal(r.status, 'completed-with-errors');
    assert.equal(r.totals.errors, 1);
  });

  await t('cleanup eligibility is the union of copiedFiles ONLY from events that returned a summary', async () => {
    const deps = makeDeps((it) => { if (it.name === 'B') throw new Error('Archive folder is busy'); return summaryFor(it.name); });
    const r = await Runner.run(PLAN3(), deps);
    const srcs = r.copiedFiles.map(f => f.src).sort();
    assert.deepEqual(srcs, ['/src/A1', '/src/A2', '/src/C1', '/src/C2']);
    assert.equal(srcs.some(s => s.startsWith('/src/B')), false, 'failed event contributes nothing');
  });

  await t('not-started events contribute no cleanup-eligible files', async () => {
    const deps = makeDeps((it) => { if (it.name === 'B') throw new Error('Import was cancelled — 0 of 1'); return summaryFor(it.name); });
    const r = await Runner.run(PLAN3(), deps);
    assert.deepEqual(r.copiedFiles.map(f => f.src).sort(), ['/src/A1', '/src/A2']);
  });

  await t('a one-event plan runs through the same runner', async () => {
    const r = await Runner.run({ hasBlocking: false, events: [item(1, 'Only')] }, makeDeps((it) => summaryFor(it.name)));
    assert.equal(r.status, 'completed');
    assert.equal(r.events.length, 1);
  });

  await t('all events failing event-locally reports failed', async () => {
    const r = await Runner.run(PLAN3(), makeDeps(() => { throw new Error('Archive folder is busy'); }));
    assert.equal(r.status, 'failed');
    assert.equal(r.completedKeys.length, 0);
    assert.equal(r.retainedKeys.length, 3);
  });

  await t('lifecycle callbacks fire in order with index/total for progress labelling', async () => {
    const deps = makeDeps((it) => summaryFor(it.name));
    await Runner.run({ hasBlocking: false, events: [item(1, 'A'), item(2, 'B')] }, deps);
    assert.deepEqual(deps.log.filter(l => l[0] === 'start'), [['start', 'A', 0, 2], ['start', 'B', 1, 2]]);
    assert.deepEqual(deps.log.map(l => l[0]).slice(0, 4), ['start', 'inprogress', 'commit', 'end']);
  });

  await t('a throwing UI callback (onEventStart/onEventEnd) never aborts the run or skips later events', async () => {
    const deps = makeDeps((it) => summaryFor(it.name), {
      onEventStart: () => { throw new Error('DOM exploded'); },
      onEventEnd: () => { throw new Error('DOM exploded again'); },
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.equal(r.status, 'completed');
    assert.deepEqual(r.events.map(e => e.status), ['completed', 'completed', 'completed']);
    assert.equal(r.completedKeys.length, 3, 'session cleanup data is still produced');
  });

  await t('a throwing UI callback during a not-started event does not break aggregation', async () => {
    let abort = false;
    const deps = makeDeps((it) => { if (it.name === 'A') abort = true; return summaryFor(it.name); }, {
      shouldStop: async () => (abort ? 'aborted' : null),
      onEventEnd: () => { throw new Error('boom'); },
    });
    const r = await Runner.run(PLAN3(), deps);
    assert.deepEqual(r.events.map(e => e.status), ['completed', 'not-started', 'not-started']);
    assert.equal(r.status, 'aborted');
  });

  await t('a plan with blocking validation errors is refused before any work', async () => {
    const deps = makeDeps(() => summaryFor('x'));
    await assert.rejects(() => Runner.run({ hasBlocking: true, events: [item(1, 'A')] }, deps), /blocking/);
    assert.equal(deps.log.length, 0);
  });

  console.log(`${passed} passed`);
})();
