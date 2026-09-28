'use strict';

// Plain Node fixtures for the multi-event ImportSession model — no framework, no DOM,
// no Electron, no filesystem. Run with: node test/importSession.test.js
//
// Covers: file→event ownership + exclusivity, event switching (A→B→A) with isolated
// GroupManager state, stable ordinals, post-run cleanup, reset
// boundaries, deterministic per-event plans (routing incl. VIDEO), cross-event isolation
// of the metadata-bearing group payload, validation, and source-agnostic behaviour.

// ImportRouter logs every routing pass in non-production mode; keep test output readable.
process.env.NODE_ENV = 'production';

const assert = require('node:assert/strict');
const ImportSession = require('../renderer/importSession');
const GroupManager = require('../renderer/groupManager');

let passed = 0;
function t(name, fn) {
  ImportSession.reset();
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const comp = (types, city, folderName, extra = {}) => ({
  eventTypes: types.map(label => ({ label })),
  city: { label: city },
  location: null,
  folderName,
  additionalKeywords: [],
  ...extra,
});

function eventData(name, comps, collName = 'Coll1') {
  return {
    coll: { name: collName, _masterPath: `/archive/${collName}` },
    event: { name, displayName: name, components: comps },
    idx: 0,
    collectionPath: `/archive/${collName}`,
    eventPath: `/archive/${collName}/${name}`,
  };
}

const EVENT_A = () => eventData('1448-03-01_EventA', [
  comp(['Waaz'], 'Surat', '01-Waaz-Surat'),
  comp(['Ziyafat'], 'Surat', '02-Ziyafat-Surat'),
]);
const EVENT_B = () => eventData('1448-03-02_EventB', [
  comp(['Safar'], 'Mumbai', '01-Safar-Mumbai'),
  comp(['Majlis'], 'Mumbai', '02-Majlis-Mumbai'),
]);
const EVENT_C_SINGLE = () => eventData('1448-03-03_EventC', [comp(['Jashn'], 'Pune', null)]);

/** Assign paths to a NEW group of the Current Event, mapped to `subEventId`. */
function groupInto(paths, subEventId) {
  const gid = GroupManager.createGroup();
  GroupManager.assignFiles(paths, gid);
  GroupManager.setSubEvent(gid, subEventId);
  return gid;
}

console.log('importSession');

// ── Assignment / ownership ───────────────────────────────────────────────────

t('a file assigned to a group becomes owned by the Current Event', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/A001.ARW'], '01-Waaz-Surat');
  const owner = ImportSession.ownerOf('/src/A001.ARW');
  assert.equal(owner.key, ImportSession.keyOf(EVENT_A().eventPath));
  assert.equal(owner.ordinal, 1);
});

t('ownership persists after the Current Event changes to B', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/A001.ARW'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B());
  assert.equal(ImportSession.ownerOf('/src/A001.ARW').ordinal, 1);
  assert.equal(ImportSession.isOwnedByCurrent('/src/A001.ARW'), false);
});

t('reassigning A→B moves ownership and removes it from A (never owned twice)', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/X.ARW', '/src/Y.ARW'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B());
  groupInto(['/src/X.ARW'], '01-Safar-Mumbai');
  assert.equal(ImportSession.ownerOf('/src/X.ARW').ordinal, 2);
  const a = ImportSession.getWorkspace(EVENT_A().eventPath);
  assert.equal(a.groups.getFileGroupMap().has('/src/X.ARW'), false);
  assert.equal(a.groups.getFileGroupMap().has('/src/Y.ARW'), true);
  const owners = ImportSession.listWorkspaces().filter(ws => ws.groups.getFileGroupMap().has('/src/X.ARW'));
  assert.equal(owners.length, 1);
  assert.deepEqual(ImportSession.takeLastClaim(), { reassigned: 1, fromOrdinals: [1] });
});

t('reassigning the last file out of A removes its now-empty group (no empty groups)', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/only.ARW'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B());
  groupInto(['/src/only.ARW'], '01-Safar-Mumbai');
  assert.equal(ImportSession.getWorkspace(EVENT_A().eventPath), null, 'A owns nothing and is not current → pruned');
});

t('assignDirect gives a single-component event ownership without groups', () => {
  ImportSession.switchTo(EVENT_C_SINGLE());
  const r = ImportSession.assignDirect(['/src/c1.jpg', '/src/c2.jpg']);
  assert.deepEqual(r, { assigned: 2, reassigned: 0 });
  assert.equal(ImportSession.ownerOf('/src/c1.jpg').ordinal, 1);
  assert.equal(ImportSession.hasAssignments(), true);
});

t('assignDirect reassigns from another event and reports it', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/m.jpg'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_C_SINGLE());
  const r = ImportSession.assignDirect(['/src/m.jpg']);
  assert.deepEqual(r, { assigned: 1, reassigned: 1 });
  assert.equal(ImportSession.ownerOf('/src/m.jpg').ordinal, 2);
});

t('assignDirect leaves a file that is already in a current-event group in its group', () => {
  const md = eventData('1448-03-04_Meta', [comp(['Waaz', 'Ziyafat'], 'Surat', null)]);
  ImportSession.switchTo(md);
  const gid = GroupManager.createGroup();
  GroupManager.assignFiles(['/src/g.jpg'], gid);
  assert.deepEqual(ImportSession.assignDirect(['/src/g.jpg']), { assigned: 0, reassigned: 0 });
  assert.equal(ImportSession.getCurrent().directFiles.size, 0);
});

t('release removes ownership from whichever event holds the file', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg', '/src/b.jpg'], '01-Waaz-Surat');
  ImportSession.release(['/src/a.jpg']);
  assert.equal(ImportSession.ownerOf('/src/a.jpg'), null);
  assert.equal(ImportSession.ownerOf('/src/b.jpg').ordinal, 1);
});

t('UI selection is not ownership — a Set the caller clears has no effect on assignments', () => {
  const selectedFiles = new Set(['/src/sel.jpg']);
  ImportSession.switchTo(EVENT_C_SINGLE());
  ImportSession.assignDirect([...selectedFiles]);
  selectedFiles.clear();
  assert.equal(ImportSession.ownerOf('/src/sel.jpg').ordinal, 1);
});

// ── Event switching / isolated per-event state ───────────────────────────────

t('A→B→A restores Event A groups and component mappings exactly', () => {
  ImportSession.switchTo(EVENT_A());
  const g1 = groupInto(['/src/a1.jpg', '/src/a2.jpg'], '01-Waaz-Surat');
  const g2 = groupInto(['/src/a3.jpg'], '02-Ziyafat-Surat');

  ImportSession.switchTo(EVENT_B());
  groupInto(['/src/b1.jpg'], '01-Safar-Mumbai');

  ImportSession.switchTo(EVENT_A());
  const groups = GroupManager.getGroups();
  assert.equal(groups.length, 2);
  assert.deepEqual([...groups.find(g => g.id === g1).files].sort(), ['/src/a1.jpg', '/src/a2.jpg']);
  assert.equal(groups.find(g => g.id === g1).subEventId, '01-Waaz-Surat');
  assert.equal(groups.find(g => g.id === g2).subEventId, '02-Ziyafat-Surat');
});

t('Event B has independent groups — its G1 is unrelated to A’s G1', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a1.jpg'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B());
  assert.equal(GroupManager.hasGroups(), false, 'B starts with no groups');
  const gid = groupInto(['/src/b1.jpg'], '01-Safar-Mumbai');
  assert.equal(gid, 1);
  assert.equal(GroupManager.getGroups()[0].subEventId, '01-Safar-Mumbai');
  ImportSession.switchTo(EVENT_A());
  assert.equal(GroupManager.getGroups()[0].subEventId, '01-Waaz-Surat');
});

t('switching to an event that owns nothing prunes the outgoing empty workspace', () => {
  ImportSession.switchTo(EVENT_A());       // owns nothing
  ImportSession.switchTo(EVENT_B());
  assert.equal(ImportSession.getWorkspace(EVENT_A().eventPath), null);
});

t('grouping done before the session bound a workspace is adopted, not lost', () => {
  const gid = GroupManager.createGroup();   // facade bound to the detached instance
  GroupManager.assignFiles(['/src/early.jpg'], gid);
  ImportSession.switchTo(EVENT_A());
  assert.equal(ImportSession.ownerOf('/src/early.jpg').ordinal, 1);
});

t('switchTo requires an event path', () => {
  assert.throws(() => ImportSession.switchTo({}), /eventPath/);
});

// ── Ordinals ─────────────────────────────────────────────────────────────────

t('ordinals are assigned in first-participation order', () => {
  ImportSession.switchTo(EVENT_B());
  groupInto(['/src/b.jpg'], '01-Safar-Mumbai');
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg'], '01-Waaz-Surat');
  assert.equal(ImportSession.ownerOf('/src/b.jpg').ordinal, 1);
  assert.equal(ImportSession.ownerOf('/src/a.jpg').ordinal, 2);
});

t('an event that leaves the session keeps its ordinal and others are not renumbered', () => {
  ImportSession.switchTo(EVENT_A()); groupInto(['/src/a.jpg'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B()); groupInto(['/src/b.jpg'], '01-Safar-Mumbai');
  ImportSession.switchTo(EVENT_C_SINGLE()); ImportSession.assignDirect(['/src/c.jpg']);
  ImportSession.completeEvents([EVENT_A().eventPath]);
  assert.equal(ImportSession.ownerOf('/src/b.jpg').ordinal, 2);
  assert.equal(ImportSession.ownerOf('/src/c.jpg').ordinal, 3);
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a2.jpg'], '01-Waaz-Surat');
  assert.equal(ImportSession.ownerOf('/src/a2.jpg').ordinal, 1, 'A gets E1 back, not E4');
});

// ── Summary / participation ──────────────────────────────────────────────────

t('getSummary reports per-event counts, assigned total and unassigned-in-view', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/s/1', '/s/2', '/s/3'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_C_SINGLE());
  ImportSession.assignDirect(['/s/4', '/s/5']);
  const s = ImportSession.getSummary(['/s/1', '/s/2', '/s/3', '/s/4', '/s/5', '/s/6', '/s/7']);
  assert.deepEqual(s.events.map(e => [e.ordinal, e.fileCount, e.isCurrent]), [[1, 3, false], [2, 2, true]]);
  assert.equal(s.assignedTotal, 5);
  assert.equal(s.unassignedInView, 2);
});

t('isParticipating is true only for events that own files (drives the edit block)', () => {
  ImportSession.switchTo(EVENT_A());
  assert.equal(ImportSession.isParticipating(EVENT_A().eventPath), false);
  groupInto(['/s/1'], '01-Waaz-Surat');
  assert.equal(ImportSession.isParticipating(EVENT_A().eventPath), true);
  assert.equal(ImportSession.isParticipating(EVENT_B().eventPath), false);
  assert.equal(ImportSession.participatingCount(), 1);
});

// ── Post-run cleanup ─────────────────────────────────────────────────────────

t('completeEvents clears completed events but preserves failed/not-started ones intact', () => {
  ImportSession.switchTo(EVENT_A()); const ga = groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B()); groupInto(['/s/b'], '01-Safar-Mumbai');
  ImportSession.switchTo(EVENT_C_SINGLE()); ImportSession.assignDirect(['/s/c']);
  ImportSession.completeEvents([EVENT_A().eventPath]);          // A succeeded; B, C failed / not started
  assert.equal(ImportSession.ownerOf('/s/a'), null, 'completed event cannot be re-imported');
  assert.equal(ImportSession.ownerOf('/s/b').ordinal, 2);
  assert.equal(ImportSession.ownerOf('/s/c').ordinal, 3);
  assert.equal(ImportSession.getWorkspace(EVENT_B().eventPath).groups.getGroups()[0].subEventId, '01-Safar-Mumbai');
  assert.equal(typeof ga, 'number');
});

t('completing the Current Event leaves an empty, usable workspace bound to the facades', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.completeEvents([EVENT_A().eventPath]);
  assert.equal(ImportSession.getCurrentKey(), ImportSession.keyOf(EVENT_A().eventPath));
  assert.equal(GroupManager.hasGroups(), false);
  groupInto(['/s/next'], '02-Ziyafat-Surat');
  assert.equal(ImportSession.ownerOf('/s/next').ordinal, 1);
});

// ── Reset boundaries ─────────────────────────────────────────────────────────

t('reset clears every workspace, ordinal and binding (source change / eject / new session)', () => {
  ImportSession.switchTo(EVENT_A()); groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B()); groupInto(['/s/b'], '01-Safar-Mumbai');
  ImportSession.reset();
  assert.equal(ImportSession.hasAssignments(), false);
  assert.equal(ImportSession.ownerOf('/s/a'), null);
  assert.equal(GroupManager.hasGroups(), false);
  ImportSession.switchTo(EVENT_B()); groupInto(['/s/b2'], '01-Safar-Mumbai');
  assert.equal(ImportSession.ownerOf('/s/b2').ordinal, 1, 'ordinals restart with the new session');
});

// ── Plan: routing, VIDEO, unassigned, isolation ──────────────────────────────

function buildFixturePlan(photographer = 'PhotogX', extra = {}) {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/A001.ARW'], '01-Waaz-Surat');
  groupInto(['/src/A002.JPG', '/src/A003.MP4'], '02-Ziyafat-Surat');
  ImportSession.switchTo(EVENT_B());
  groupInto(['/src/B001.ARW', '/src/B002.JPG'], '01-Safar-Mumbai');
  groupInto(['/src/B003.MOV'], '02-Majlis-Mumbai');
  return ImportSession.buildPlan({
    photographer,
    viewPaths: ['/src/A001.ARW', '/src/A002.JPG', '/src/A003.MP4', '/src/B001.ARW', '/src/B002.JPG', '/src/B003.MOV', '/src/UNASSIGNED.JPG'],
    ...extra,
  });
}

t('one plan routes every assigned file to its own event/component/photographer/VIDEO folder', () => {
  const plan = buildFixturePlan();
  assert.equal(plan.hasBlocking, false, JSON.stringify(plan.errors));
  const byEvent = Object.fromEntries(plan.events.map(e => [e.name, e.fileJobs.map(j => [j.src, j.dest])]));
  assert.deepEqual(byEvent['1448-03-01_EventA'], [
    ['/src/A001.ARW', '/archive/Coll1/1448-03-01_EventA/01-Waaz-Surat/PhotogX/A001.ARW'],
    ['/src/A002.JPG', '/archive/Coll1/1448-03-01_EventA/02-Ziyafat-Surat/PhotogX/A002.JPG'],
    ['/src/A003.MP4', '/archive/Coll1/1448-03-01_EventA/02-Ziyafat-Surat/PhotogX/VIDEO/A003.MP4'],
  ]);
  assert.deepEqual(byEvent['1448-03-02_EventB'], [
    ['/src/B001.ARW', '/archive/Coll1/1448-03-02_EventB/01-Safar-Mumbai/PhotogX/B001.ARW'],
    ['/src/B002.JPG', '/archive/Coll1/1448-03-02_EventB/01-Safar-Mumbai/PhotogX/B002.JPG'],
    ['/src/B003.MOV', '/archive/Coll1/1448-03-02_EventB/02-Majlis-Mumbai/PhotogX/VIDEO/B003.MOV'],
  ]);
});

t('the unassigned file is in no event’s jobs and is counted as unassigned', () => {
  const plan = buildFixturePlan();
  const allSrcs = plan.events.flatMap(e => e.fileJobs.map(j => j.src));
  assert.equal(allSrcs.includes('/src/UNASSIGNED.JPG'), false);
  assert.equal(allSrcs.length, 6);
  assert.equal(plan.totals.assigned, 6);
  assert.equal(plan.totals.routed, 6);
  assert.equal(plan.totals.unassignedInView, 1);
});

t('plan events are ordered by ordinal and carry photographer per event item', () => {
  const plan = buildFixturePlan('PhotogX');
  assert.deepEqual(plan.events.map(e => e.ordinal), [1, 2]);
  assert.ok(plan.events.every(e => e.photographer === 'PhotogX'));
});

t('metadata-bearing payload is per event: each event’s groups contain ONLY its own files', () => {
  const plan = buildFixturePlan();
  const [a, b] = plan.events;
  const aFiles = a.groups.flatMap(g => g.files).sort();
  const bFiles = b.groups.flatMap(g => g.files).sort();
  assert.deepEqual(aFiles, ['/src/A001.ARW', '/src/A002.JPG', '/src/A003.MP4']);
  assert.deepEqual(bFiles, ['/src/B001.ARW', '/src/B002.JPG', '/src/B003.MOV']);
  assert.equal(aFiles.some(f => bFiles.includes(f)), false);
  assert.deepEqual(a.groups.map(g => g.subEventId).sort(), ['01-Waaz-Surat', '02-Ziyafat-Surat']);
  assert.deepEqual(b.groups.map(g => g.subEventId).sort(), ['01-Safar-Mumbai', '02-Majlis-Mumbai']);
  assert.deepEqual(a.routingEventData.event.components.map(c => c.folderName), ['01-Waaz-Surat', '02-Ziyafat-Surat']);
  assert.deepEqual(b.routingEventData.event.components.map(c => c.folderName), ['01-Safar-Mumbai', '02-Majlis-Mumbai']);
});

t('the plan is deeply frozen and later session changes cannot alter it', () => {
  const plan = buildFixturePlan();
  const before = JSON.stringify(plan.events.map(e => e.fileJobs));
  ImportSession.release(['/src/A001.ARW']);
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/NEW.JPG'], '01-Waaz-Surat');
  assert.equal(JSON.stringify(plan.events.map(e => e.fileJobs)), before);
  assert.throws(() => { 'use strict'; plan.events[0].fileJobs.push({}); }, TypeError);
});

t('building a plan is deterministic — same session state, same plan', () => {
  const p1 = buildFixturePlan();
  const s1 = JSON.stringify(p1.events.map(e => [e.eventKey, e.fileJobs, e.groups]));
  const p2 = ImportSession.buildPlan({ photographer: 'PhotogX' });
  assert.equal(JSON.stringify(p2.events.map(e => [e.eventKey, e.fileJobs, e.groups])), s1);
});

t('single-component event: all owned files route to eventPath/photographer, video in VIDEO', () => {
  ImportSession.switchTo(EVENT_C_SINGLE());
  ImportSession.assignDirect(['/src/c1.jpg', '/src/c2.MP4']);
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.deepEqual(plan.events[0].fileJobs.map(j => j.dest), [
    '/archive/Coll1/1448-03-03_EventC/P/c1.jpg',
    '/archive/Coll1/1448-03-03_EventC/P/VIDEO/c2.MP4',
  ]);
  assert.deepEqual(plan.events[0].groups.map(g => g.subEventId), [null]);
});

t('a one-event session yields a one-event plan (single event generalises)', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg'], '01-Waaz-Surat');
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.equal(plan.events.length, 1);
  assert.equal(plan.hasBlocking, false);
});

t('metadata-grouping single-component event mirrors legacy: ungrouped owned files get empty keyword set', () => {
  const md = eventData('1448-03-05_Meta', [comp(['Waaz', 'Ziyafat'], 'Surat', null)]);
  ImportSession.switchTo(md);
  const gid = GroupManager.createGroup();
  GroupManager.assignFiles(['/src/g.jpg'], gid);
  GroupManager.setMetadataTags(gid, ['Waaz']);
  ImportSession.assignDirect(['/src/u.jpg']);
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  const groups = plan.events[0].groups;
  assert.deepEqual(groups.map(g => [g.id, g.metadataTags, g.files]), [[1, ['Waaz'], ['/src/g.jpg']], [-1, [], ['/src/u.jpg']]]);
});

t('metadata-grouping: a group with no keyword assignment is a non-blocking warning', () => {
  const md = eventData('1448-03-05_Meta', [comp(['Waaz', 'Ziyafat'], 'Surat', null)]);
  ImportSession.switchTo(md);
  const gid = GroupManager.createGroup();
  GroupManager.assignFiles(['/src/g.jpg'], gid);
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.equal(plan.hasBlocking, false);
  assert.equal(plan.warnings[0].code, 'UNTAGGED_GROUPS');
});

// ── Validation spans ALL events and names the event ──────────────────────────

t('a missing sub-event mapping in Event B blocks and names Event B while A is current', () => {
  ImportSession.switchTo(EVENT_B());
  const gb = GroupManager.createGroup();
  GroupManager.assignFiles(['/src/b.jpg'], gb);                 // no sub-event
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg'], '01-Waaz-Surat');
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.equal(plan.hasBlocking, true);
  const err = plan.errors.find(e => e.code === 'MISSING_SUBEVENT');
  assert.equal(err.eventName, '1448-03-02_EventB');
  assert.equal(err.ordinal, 1);
  assert.equal(plan.errors.some(e => e.eventName === '1448-03-01_EventA'), false);
});

t('a stale sub-event id (component no longer exists on disk) is blocking', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg'], '02-Ziyafat-Surat');
  const key = ImportSession.keyOf(EVENT_A().eventPath);
  const fresh = new Map([[key, { components: [comp(['Waaz'], 'Surat', '01-Waaz-Surat'), comp(['Other'], 'Surat', '02-Other-Surat')], subEventIds: ['01-Waaz-Surat', '02-Other-Surat'] }]]);
  const plan = ImportSession.buildPlan({ photographer: 'P', fresh });
  assert.equal(plan.errors[0].code, 'STALE_SUBEVENT');
  assert.equal(plan.events[0].fileJobs.length, 0, 'nothing is routed for an invalid event');
});

t('an event that can no longer be read from disk is blocking', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg'], '01-Waaz-Surat');
  const plan = ImportSession.buildPlan({ photographer: 'P', fresh: new Map([[ImportSession.keyOf(EVENT_A().eventPath), null]]) });
  assert.equal(plan.errors[0].code, 'EVENT_UNREADABLE');
});

t('incomplete component (no city) is blocking; duplicate sub-event mapping is a warning', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a1.jpg'], '01-Waaz-Surat');
  groupInto(['/src/a2.jpg'], '01-Waaz-Surat');
  let plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.equal(plan.hasBlocking, false);
  assert.equal(plan.warnings[0].code, 'DUPLICATE_SUBEVENT');
  const key = ImportSession.keyOf(EVENT_A().eventPath);
  plan = ImportSession.buildPlan({ photographer: 'P', fresh: new Map([[key, { components: [comp(['Waaz'], '', '01-Waaz-Surat'), comp(['Zi'], 'Surat', '02-Zi-Surat')] }]]) });
  assert.ok(plan.errors.some(e => e.code === 'INCOMPLETE_COMPONENT'));
});

t('no photographer yet → validation runs, nothing is routed and no false NO_FILES error', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/src/a.jpg'], '01-Waaz-Surat');
  const plan = ImportSession.buildPlan({ photographer: null });
  assert.equal(plan.hasBlocking, false);
  assert.equal(plan.events[0].fileJobs.length, 0);
  assert.equal(plan.totals.assigned, 1);
});

t('a session with no assignments builds an empty plan', () => {
  ImportSession.switchTo(EVENT_A());
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.equal(plan.events.length, 0);
  assert.equal(plan.totals.assigned, 0);
});

// ── Source-agnostic ──────────────────────────────────────────────────────────

function runSourceScenario(paths) {
  ImportSession.reset();
  ImportSession.switchTo(EVENT_A());
  groupInto([paths.a1], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B());
  groupInto([paths.b1], '01-Safar-Mumbai');
  ImportSession.switchTo(EVENT_A());
  const plan = ImportSession.buildPlan({ photographer: 'P', viewPaths: [paths.a1, paths.b1] });
  return plan.events.map(e => [e.ordinal, e.fileJobs.map(j => j.dest)]);
}

t('camera-card-style paths and ordinary-folder paths behave identically', () => {
  const card   = runSourceScenario({ a1: '/Volumes/EOS_DIGITAL/DCIM/100CANON/A001.CR3', b1: '/Volumes/EOS_DIGITAL/DCIM/100CANON/B001.CR3' });
  const folder = runSourceScenario({ a1: '/Users/op/ImportFolder/EventPhotos/A001.CR3',   b1: '/Users/op/ImportFolder/EventPhotos/B001.CR3' });
  assert.deepEqual(card, folder);
  assert.equal(card[0][1][0], '/archive/Coll1/1448-03-01_EventA/01-Waaz-Surat/P/A001.CR3');
});

t('Windows-style source paths are owned and routed the same way', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['E:\\DCIM\\100CANON\\A001.CR3'], '01-Waaz-Surat');
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.equal(plan.events[0].fileJobs[0].dest, '/archive/Coll1/1448-03-01_EventA/01-Waaz-Surat/P/A001.CR3');
});

t('the model is independent of source type — nothing in the session references it', () => {
  const src = require('node:fs').readFileSync(require.resolve('../renderer/importSession'), 'utf8');
  assert.equal(/memory-card|external-drive|local-folder|DCIM|\bcard\b/i.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), false);
});

// ── Legacy-path eligibility / edit guard / pending-sync flags ────────────────

t('isLegacyEligible: a one-event session that uses groups only is eligible (legacy path runs unchanged)', () => {
  assert.equal(ImportSession.isLegacyEligible(), true, 'empty session');
  ImportSession.switchTo(EVENT_A());
  groupInto(['/s/a'], '01-Waaz-Surat');
  assert.equal(ImportSession.isLegacyEligible(), true);
});

t('isLegacyEligible flips to false once files are owned by a NON-current event', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B());
  assert.equal(ImportSession.isLegacyEligible(), false);
  ImportSession.switchTo(EVENT_A());
  assert.equal(ImportSession.isLegacyEligible(), true, 'back on the only participating event');
});

t('isLegacyEligible is false as soon as any file is assigned directly', () => {
  ImportSession.switchTo(EVENT_C_SINGLE());
  ImportSession.assignDirect(['/s/c']);
  assert.equal(ImportSession.isLegacyEligible(), false);
});

t('isParticipatingByName matches collection + event name (edit guard for the picker)', () => {
  ImportSession.switchTo(EVENT_A());
  assert.equal(ImportSession.isParticipatingByName('Coll1', '1448-03-01_EventA'), false, 'owns nothing yet');
  groupInto(['/s/a'], '01-Waaz-Surat');
  assert.equal(ImportSession.isParticipatingByName('Coll1', '1448-03-01_EventA'), true);
  assert.equal(ImportSession.isParticipatingByName('Coll1', '1448-03-02_EventB'), false);
  assert.equal(ImportSession.isParticipatingByName('Other', '1448-03-01_EventA'), false);
});

t('an event with zero assignments stays editable (participation, not presence, blocks editing)', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.release(['/s/a']);
  assert.equal(ImportSession.isParticipating(EVENT_A().eventPath), false);
});

t('plan items carry each event’s pending-sync / local-staging flags for import-method rules', () => {
  ImportSession.switchTo({ ...EVENT_A(), isPendingSync: true });
  groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.switchTo({ ...EVENT_B(), wasLocalStagingEvent: true });
  groupInto(['/s/b'], '01-Safar-Mumbai');
  const plan = ImportSession.buildPlan({ photographer: 'P' });
  assert.deepEqual(plan.events.map(e => [e.isPendingSync, e.wasLocalStagingEvent]), [[true, false], [false, true]]);
});

t('a photographer-less plan can still be built per event, then rebuilt with one photographer applied to every event', () => {
  ImportSession.switchTo(EVENT_A()); groupInto(['/s/a'], '01-Waaz-Surat');
  ImportSession.switchTo(EVENT_B()); groupInto(['/s/b'], '01-Safar-Mumbai');
  const pre = ImportSession.buildPlan({ photographer: null });
  assert.equal(pre.events.every(e => e.photographer === null && e.fileJobs.length === 0), true);
  const final = ImportSession.buildPlan({ photographer: 'Solo' });
  assert.equal(final.events.every(e => e.photographer === 'Solo' && e.fileJobs.length === 1), true);
  assert.ok(final.events[0].fileJobs[0].dest.includes('/Solo/') && final.events[1].fileJobs[0].dest.includes('/Solo/'));
});

console.log(`${passed} passed`);
