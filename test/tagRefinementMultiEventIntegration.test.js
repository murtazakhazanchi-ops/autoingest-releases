'use strict';

// Integration regression suite for the intersection of Multi-Event Import
// (renderer/importSession.js) and Per-Photo Tag Refinement (renderer/tagRefinementManager.js).
//
// Background: RC.1's Multi-Event Import gives every event its own GroupManager instance, so
// two different events' first groups are both legitimately "group-1". The validated
// refinement feature originally kept ONE global TagRefinementManager singleton, which meant
// those two independent groups (and the single reserved EVENT_SCOPE key) collided in it —
// confirmed live: refining Event A's group-1 made an untouched Event B's group-1 immediately
// report Event A's data as its own, and touching Event B's group-1 could delete Event A's
// records. Fixed by making TagRefinementManager instantiable exactly like GroupManager, with
// one instance per event workspace, wired together at workspace creation (see importSession.js
// _newInstances/_bindTo/_claim/release/buildPlan).
//
// Plain Node fixtures — no framework, no DOM, no Electron, no filesystem.
// Run with: node test/tagRefinementMultiEventIntegration.test.js

process.env.NODE_ENV = 'production'; // ImportRouter logs every routing pass otherwise

const assert = require('node:assert/strict');
const ImportSession = require('../renderer/importSession');
const GroupManager = require('../renderer/groupManager');
const TagRefinementManager = require('../renderer/tagRefinementManager');

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

// ── Fixtures (mirrors test/importSession.test.js) ───────────────────────────

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

// Two multi-component events — each independently starts group numbering at "group-1".
const EVENT_A = () => eventData('1448-03-01_EventA', [
  comp(['Waaz'], 'Surat', '01-Waaz-Surat'),
  comp(['Ziyafat'], 'Surat', '02-Ziyafat-Surat'),
]);
const EVENT_B = () => eventData('1448-03-02_EventB', [
  comp(['Safar'], 'Mumbai', '01-Safar-Mumbai'),
  comp(['Majlis'], 'Mumbai', '02-Majlis-Mumbai'),
]);
// Two single-component events — both use the reserved EVENT_SCOPE key.
const EVENT_SINGLE_A = () => eventData('1448-03-04_SingleA', [comp(['Jashn'], 'Pune', null)]);
const EVENT_SINGLE_B = () => eventData('1448-03-05_SingleB', [comp(['Majlis'], 'Delhi', null)]);

const NONE = { eventTypes: [], additionalKeywords: [] };
const SUB = (t1) => ({ eventTypes: [t1], additionalKeywords: [] });

/** Assign paths to a NEW group of the Current Event, mapped to `subEventId`. */
function groupInto(paths, subEventId) {
  const gid = GroupManager.createGroup();
  GroupManager.assignFiles(paths, gid);
  GroupManager.setSubEvent(gid, subEventId);
  return gid;
}

/** The real buildPlan() payload's fileTagRefinements, flattened by absolute source path, for one event. */
function planRefinementsFor(plan, eventPath) {
  const item = plan.events.find(e => e.eventPath === eventPath);
  if (!item) return null;
  const out = {};
  for (const g of item.groups) for (const [p, v] of Object.entries(g.fileTagRefinements || {})) out[p] = v;
  return out;
}

console.log('tagRefinementMultiEventIntegration');

// ── 1. Independent group-1 scopes across two events (Scenario A) ────────────

t('two events\' independently-numbered group-1 do not collide — refining A leaves B at zero', () => {
  ImportSession.switchTo(EVENT_A());
  const gA = groupInto(['/cardA/p1.cr2'], '01-Waaz-Surat');
  const uidA = GroupManager.getGroups()[0].uid;
  assert.equal(uidA, 'group-1');
  TagRefinementManager.setOverride(uidA, ['/cardA/p1.cr2'], NONE);

  ImportSession.switchTo(EVENT_B());
  const gB = groupInto(['/cardB/p9.cr2'], '01-Safar-Mumbai');
  const uidB = GroupManager.getGroups()[0].uid;
  assert.equal(uidB, 'group-1', 'Event B also legitimately starts at group-1');
  assert.equal(TagRefinementManager.groupRefinementCount(uidB), 0, 'B must not inherit A\'s count merely by sharing the uid string');
  assert.equal(TagRefinementManager.serializeGroupForImport(uidB), null);
  assert.equal(TagRefinementManager.getOverride(uidB, '/cardA/p1.cr2'), null, 'B cannot see A\'s file at all');

  // Clearing/removing B's group must not touch A.
  GroupManager.removeGroup(gB);
  ImportSession.switchTo(EVENT_A());
  assert.deepEqual(TagRefinementManager.getOverride(GroupManager.getGroups()[0].uid, '/cardA/p1.cr2'), NONE,
    'A\'s refinement survives B\'s group-1 removal untouched');
});

// ── 2. Independent EVENT_SCOPE across two events (Scenario B) ───────────────

t('EVENT_SCOPE is isolated per event workspace — refining A leaves B at zero, and B cannot change A', () => {
  ImportSession.switchTo(EVENT_SINGLE_A());
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardA/s1.cr2'], NONE);

  ImportSession.switchTo(EVENT_SINGLE_B());
  assert.equal(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardA/s1.cr2'), null, 'B sees none of A\'s EVENT_SCOPE data');
  assert.equal(TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE), 0);

  // B independently refines its own file — Use All / subset / Reset all operate on B only.
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardB/s2.cr2'], SUB('Majlis'));
  TagRefinementManager.resetToDefault(TagRefinementManager.EVENT_SCOPE, ['/cardB/s2.cr2']);
  assert.equal(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardB/s2.cr2'), null);

  // Clearing B's EVENT_SCOPE entirely must not touch A.
  TagRefinementManager.clearGroup(TagRefinementManager.EVENT_SCOPE);
  ImportSession.switchTo(EVENT_SINGLE_A());
  assert.deepEqual(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardA/s1.cr2'), NONE,
    'A\'s EVENT_SCOPE refinement is untouched by B\'s Reset/clear');
});

// ── 3. Switch away/back restores workspace state ─────────────────────────────

t('switching Current Event A→B→A restores A\'s groups AND refinement state exactly', () => {
  ImportSession.switchTo(EVENT_A());
  const gA = groupInto(['/cardA/p1.cr2', '/cardA/p2.cr2'], '01-Waaz-Surat');
  const uidA = GroupManager.getGroups()[0].uid;
  TagRefinementManager.setOverride(uidA, ['/cardA/p1.cr2'], SUB('Waaz'));
  TagRefinementManager.setOverride(uidA, ['/cardA/p2.cr2'], NONE);

  ImportSession.switchTo(EVENT_B());
  assert.equal(GroupManager.hasGroups(), false, 'B starts with no groups of its own');
  assert.equal(TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE), 0);

  ImportSession.switchTo(EVENT_A());
  assert.equal(GroupManager.getGroups().length, 1);
  assert.equal(GroupManager.getGroups()[0].uid, uidA, 'same instance/uid — not recreated');
  assert.deepEqual(TagRefinementManager.getOverride(uidA, '/cardA/p1.cr2'), SUB('Waaz'));
  assert.deepEqual(TagRefinementManager.getOverride(uidA, '/cardA/p2.cr2'), NONE);
});

// ── 4. Removing a group in B cannot alter A (Follow-up B across events, Scenario F) ──

t('Follow-up B stable-uid behavior holds INSIDE one workspace, and is independent across workspaces', () => {
  ImportSession.switchTo(EVENT_A());
  const g1 = groupInto(['/cardA/a1.cr2'], '01-Waaz-Surat');
  const g2 = groupInto(['/cardA/a2.cr2'], '02-Ziyafat-Surat');
  const uid1 = GroupManager.getGroups().find(g => g.id === g1).uid;
  const uid2 = GroupManager.getGroups().find(g => g.id === g2).uid;
  TagRefinementManager.setOverride(uid1, ['/cardA/a1.cr2'], NONE);
  TagRefinementManager.setOverride(uid2, ['/cardA/a2.cr2'], SUB('Ziyafat'));

  ImportSession.switchTo(EVENT_B());
  const gB1 = groupInto(['/cardB/b1.cr2'], '01-Safar-Mumbai');
  const gB2 = groupInto(['/cardB/b2.cr2'], '02-Majlis-Mumbai');
  const uidB1 = GroupManager.getGroups().find(g => g.id === gB1).uid;
  TagRefinementManager.setOverride(uidB1, ['/cardB/b1.cr2'], SUB('Safar'));

  // Remove B's FIRST group (renumbers B's survivor) — must not touch A at all, and the
  // REMOVED group's own refinement state must be gone (the per-workspace onGroupRemoved
  // wiring — Follow-up B's cleanup hook, attached at THIS workspace's creation).
  GroupManager.removeGroup(gB1);
  assert.equal(TagRefinementManager.serializeGroupForImport(uidB1), null, 'removed group\'s own refinement state is gone (onGroupRemoved wiring fired)');
  const survivorB = GroupManager.getGroups()[0];
  assert.equal(survivorB.label, 'G1', 'B\'s survivor renumbered to display G1');
  assert.deepEqual(TagRefinementManager.getOverride(survivorB.uid, '/cardB/b2.cr2'), null, 'B\'s survivor never had its own refinement — unaffected');

  ImportSession.switchTo(EVENT_A());
  assert.deepEqual(TagRefinementManager.getOverride(uid1, '/cardA/a1.cr2'), NONE, 'A unaffected by anything done in B');
  assert.deepEqual(TagRefinementManager.getOverride(uid2, '/cardA/a2.cr2'), SUB('Ziyafat'));
  assert.equal(GroupManager.getGroups().length, 2, 'A\'s own groups (both) untouched');

  // Now remove A's OWN middle-equivalent group (first of two) to prove Follow-up B still
  // works correctly INSIDE this workspace after all the cross-event activity above.
  GroupManager.removeGroup(g1);
  const survivorA = GroupManager.getGroups()[0];
  assert.equal(survivorA.uid, uid2, 'A\'s survivor keeps its own stable uid after A\'s own removal');
  assert.deepEqual(TagRefinementManager.getOverride(survivorA.uid, '/cardA/a2.cr2'), SUB('Ziyafat'));
});

// ── 5. Moving file A→B clears A override and starts B Default (Scenario D) ──

t('a file claimed by another event stops carrying its old refinement, in every state (unrefined/subset/explicit-None)', () => {
  ImportSession.switchTo(EVENT_A());
  // A "stay-behind" file (keep.cr2) is left in A's group so the group survives the claim
  // below non-empty — isolates _claim()'s own per-file clearFiles from the (separate,
  // unrelated) whole-scope clearGroup that fires only when a source group empties out
  // entirely and gets auto-removed. Both mechanisms must independently hold.
  const gA = groupInto(['/cardA/keep.cr2', '/cardA/u.cr2', '/cardA/s.cr2', '/cardA/n.cr2'], '01-Waaz-Surat');
  const uidA = GroupManager.getGroups()[0].uid;
  TagRefinementManager.setOverride(uidA, ['/cardA/keep.cr2'], SUB('Waaz'));
  // u.cr2 stays unrefined (Default); s.cr2 gets a subset; n.cr2 gets explicit No Tags.
  TagRefinementManager.setOverride(uidA, ['/cardA/s.cr2'], SUB('Waaz'));
  TagRefinementManager.setOverride(uidA, ['/cardA/n.cr2'], NONE);

  ImportSession.switchTo(EVENT_B());
  const gB = groupInto(['/cardB/existing.cr2'], '01-Safar-Mumbai'); // pre-existing B group to claim into
  const uidB = GroupManager.getGroups()[0].uid;
  GroupManager.assignFiles(['/cardA/u.cr2', '/cardA/s.cr2', '/cardA/n.cr2'], GroupManager.getGroups()[0].id);
  TagRefinementManager.clearFiles(['/cardA/u.cr2', '/cardA/s.cr2', '/cardA/n.cr2']); // mirrors renderer.js's ctx/drag/Cmd+G call sequence

  for (const f of ['/cardA/u.cr2', '/cardA/s.cr2', '/cardA/n.cr2']) {
    assert.equal(TagRefinementManager.getOverride(uidB, f), null, `${f} starts at Default in B — no A tags carried over`);
  }

  // A's own workspace no longer owns these files, and — critically — A's SURVIVING group
  // (still holding keep.cr2) must not still be internally carrying the departed files'
  // stale overrides in its own scope map (this is what _claim()'s per-file clearFiles is
  // specifically responsible for; the group never emptied, so no auto-clearGroup masks it).
  ImportSession.switchTo(EVENT_A());
  assert.equal(GroupManager.getGroupForFile('/cardA/s.cr2'), null, 'A no longer owns the moved file');
  assert.ok(GroupManager.getGroupForFile('/cardA/keep.cr2'), 'A\'s group survives (non-empty)');
  const serializedA = TagRefinementManager.serializeGroupForImport(uidA);
  assert.deepEqual(Object.keys(serializedA).sort(), ['/cardA/keep.cr2'],
    `A's surviving group's own scope must carry ONLY its remaining member — got ${JSON.stringify(serializedA)}`);

  // The operator may now explicitly refine the file for B.
  ImportSession.switchTo(EVENT_B());
  TagRefinementManager.setOverride(uidB, ['/cardA/s.cr2'], SUB('Safar'));
  assert.deepEqual(TagRefinementManager.getOverride(uidB, '/cardA/s.cr2'), SUB('Safar'), 'B-specific refinement applies cleanly');
});

// ── 6. buildPlan() consumes the correct per-event workspace manager ─────────

t('buildPlan() serializes each event\'s OWN refinement intent — never the facade\'s, never another event\'s', () => {
  ImportSession.switchTo(EVENT_A());
  const gA = groupInto(['/cardA/p1.cr2', '/cardA/p2.cr2'], '01-Waaz-Surat');
  TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, ['/cardA/p1.cr2'], NONE);

  ImportSession.switchTo(EVENT_B());
  const gB = groupInto(['/cardB/p9.cr2', '/cardB/p10.cr2'], '01-Safar-Mumbai');
  TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, ['/cardB/p9.cr2'], SUB('Safar'));

  // Current Event is B when the plan is built — the facade reflects B. The plan must still
  // get A's own intent right from A's own (unbound-at-build-time) instance.
  const plan = ImportSession.buildPlan({ photographer: 'Jane Doe' });
  assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));

  const refA = planRefinementsFor(plan, EVENT_A().eventPath);
  const refB = planRefinementsFor(plan, EVENT_B().eventPath);
  assert.deepEqual(refA['/cardA/p1.cr2'], NONE, 'A\'s plan item carries A\'s own explicit-empty override');
  assert.equal(refA['/cardA/p2.cr2'], undefined, 'A\'s unrefined file carries no entry (Default)');
  assert.deepEqual(refB['/cardB/p9.cr2'], SUB('Safar'), 'B\'s plan item carries B\'s own subset override');
  assert.equal(refB['/cardB/p10.cr2'], undefined);
  assert.equal(refA['/cardB/p9.cr2'], undefined, 'A\'s plan item never contains B\'s file at all');
  assert.equal(refB['/cardA/p1.cr2'], undefined, 'B\'s plan item never contains A\'s file at all');
});

t('buildPlan() correctly serializes independent EVENT_SCOPE intent per single-component event', () => {
  ImportSession.switchTo(EVENT_SINGLE_A());
  ImportSession.assignDirect(['/cardA/only1.cr2', '/cardA/only2.cr2']);
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardA/only1.cr2'], NONE);

  ImportSession.switchTo(EVENT_SINGLE_B());
  ImportSession.assignDirect(['/cardB/only1.cr2']);
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardB/only1.cr2'], SUB('Majlis'));

  const plan = ImportSession.buildPlan({ photographer: 'Jane Doe' });
  const refA = planRefinementsFor(plan, EVENT_SINGLE_A().eventPath);
  const refB = planRefinementsFor(plan, EVENT_SINGLE_B().eventPath);
  assert.deepEqual(refA['/cardA/only1.cr2'], NONE);
  assert.equal(refA['/cardA/only2.cr2'], undefined);
  assert.deepEqual(refB['/cardB/only1.cr2'], SUB('Majlis'));
  assert.equal(refA['/cardB/only1.cr2'], undefined);
  assert.equal(refB['/cardA/only1.cr2'], undefined);
});

// ── 7. Workspace release destroys its refinement state ──────────────────────

t('release() clears a file\'s refinement from its owning workspace, same as a cross-event claim', () => {
  ImportSession.switchTo(EVENT_A());
  const gA = groupInto(['/cardA/p1.cr2'], '01-Waaz-Surat');
  TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, ['/cardA/p1.cr2'], NONE);
  const uidA = GroupManager.getGroups()[0].uid;

  ImportSession.release(['/cardA/p1.cr2']);
  assert.equal(TagRefinementManager.getOverride(uidA, '/cardA/p1.cr2'), null, 'released file\'s refinement is gone');
});

t('completeEvents() on the Current Event replaces its workspace — no refinement state survives into the fresh one', () => {
  ImportSession.switchTo(EVENT_A());
  const gA = groupInto(['/cardA/p1.cr2'], '01-Waaz-Surat');
  const uidA = GroupManager.getGroups()[0].uid;
  TagRefinementManager.setOverride(uidA, ['/cardA/p1.cr2'], NONE);

  ImportSession.completeEvents([EVENT_A().eventPath]);
  // Same event key re-entered — must be a genuinely fresh workspace.
  assert.equal(GroupManager.hasGroups(), false);
  assert.equal(TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE), 0);
  assert.equal(TagRefinementManager.serializeGroupForImport(uidA), null, 'old uid is not reachable from the fresh workspace\'s instance');
});

// ── 8. New workspace after destruction/recreation gets zero inherited state (Scenario E) ──

t('a brand-new workspace, even if its first group is again "group-1", inherits zero state from a destroyed workspace', () => {
  ImportSession.switchTo(EVENT_A());
  groupInto(['/cardA/p1.cr2'], '01-Waaz-Surat');
  TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, ['/cardA/p1.cr2'], NONE);
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardA/e1.cr2'], SUB('Waaz'));

  // Discard the whole session (source change / eject / new import from scratch).
  ImportSession.reset();

  ImportSession.switchTo(EVENT_B());
  groupInto(['/cardB/q1.cr2'], '01-Safar-Mumbai');
  assert.equal(GroupManager.getGroups()[0].uid, 'group-1', 'fresh session, fresh instance — same uid string is fine');
  assert.equal(TagRefinementManager.groupRefinementCount(GroupManager.getGroups()[0].uid), 0);
  assert.equal(TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE), 0);
  assert.equal(TagRefinementManager.serializeGroupForImport('group-1'), null);
});

// ── 9/10. Explicit No Tags / Default remain correct per event (folded into the above,
//          plus one more direct assertion of the tri-state contract across events) ──

t('explicit No Tags and Default are distinct states, independently, in two different events', () => {
  ImportSession.switchTo(EVENT_SINGLE_A());
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardA/none.cr2'], NONE);
  // /cardA/default.cr2 is intentionally never touched.

  ImportSession.switchTo(EVENT_SINGLE_B());
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardB/subset.cr2'], SUB('Majlis'));

  ImportSession.switchTo(EVENT_SINGLE_A());
  assert.deepEqual(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardA/none.cr2'), NONE, 'A: explicit No Tags is a present record');
  assert.equal(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardA/default.cr2'), null, 'A: untouched file has NO record (Default = absence)');

  ImportSession.switchTo(EVENT_SINGLE_B());
  assert.deepEqual(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardB/subset.cr2'), SUB('Majlis'));
  assert.equal(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/cardA/none.cr2'), null, 'B never sees A\'s record at all — not even as absence-of-override confusion');
});

// ── Scenario C: mixed event shapes in the same session ───────────────────────

t('Scenario C: one single-component (EVENT_SCOPE) event and one multi-component (group) event coexist correctly', () => {
  ImportSession.switchTo(EVENT_SINGLE_A());
  ImportSession.assignDirect(['/cardA/s1.cr2', '/cardA/s2.cr2']);
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/cardA/s1.cr2'], NONE);

  ImportSession.switchTo(EVENT_B());
  const gB = groupInto(['/cardB/g1.cr2', '/cardB/g2.cr2'], '01-Safar-Mumbai');
  TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, ['/cardB/g1.cr2'], SUB('Safar'));

  // Repeated switching back and forth must not disturb either.
  for (let i = 0; i < 3; i++) {
    ImportSession.switchTo(EVENT_SINGLE_A());
    ImportSession.switchTo(EVENT_B());
  }

  const plan = ImportSession.buildPlan({ photographer: 'Jane Doe' });
  assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
  const refA = planRefinementsFor(plan, EVENT_SINGLE_A().eventPath);
  const refB = planRefinementsFor(plan, EVENT_B().eventPath);
  assert.deepEqual(refA['/cardA/s1.cr2'], NONE);
  assert.equal(refA['/cardA/s2.cr2'], undefined);
  assert.deepEqual(refB['/cardB/g1.cr2'], SUB('Safar'));
  assert.equal(refB['/cardB/g2.cr2'], undefined);

  const itemA = plan.events.find(e => e.eventPath === EVENT_SINGLE_A().eventPath);
  const itemB = plan.events.find(e => e.eventPath === EVENT_B().eventPath);
  assert.equal(itemA.isMulti, false);
  assert.equal(itemB.isMulti, true);
});

// ── Active refinement scope cannot retarget across events ────────────────────

t('active refinement scope does not survive a Change Event — no pending edits can land on another event\'s group', () => {
  ImportSession.switchTo(EVENT_A());
  const gA = groupInto(['/cardA/p1.cr2'], '01-Waaz-Surat');
  const uidA = GroupManager.getGroups()[0].uid;
  TagRefinementManager.enter(uidA); // renderer.js's .gc-refine-trigger handler
  assert.equal(TagRefinementManager.getActiveGroupId(), uidA);

  ImportSession.switchTo(EVENT_B());
  // The facade is now bound to B's (fresh, unentered) instance — active scope is B's, not A's.
  assert.equal(TagRefinementManager.isActive(), false, 'B\'s instance was never entered — switching Current Event does not carry "active" across');

  ImportSession.switchTo(EVENT_A());
  // A's own instance still remembers its own active scope — untouched by the detour through B.
  assert.equal(TagRefinementManager.getActiveGroupId(), uidA);
  TagRefinementManager.exit();
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
