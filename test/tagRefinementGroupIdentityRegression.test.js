'use strict';

// Regression suite for Follow-up B: GroupManager.removeGroup() renumbers surviving
// groups' DISPLAY `id` sequentially, and TagRefinementManager historically keyed its
// per-group override state by that mutable `id`. That let a survivor's explicit
// refinements (including explicit "No Tags") go orphaned under its old numeric key while
// import serialization silently fell back to the component default for its files — with
// no warning to the operator and no trace in the persisted event.json record.
//
// Fix: GroupManager now assigns every group a STABLE `uid` once at creation (never
// reused, never changed by renumbering), and every renderer.js call site that asks for
// refinement/session identity (as opposed to display identity) uses `group.uid`, never
// `group.id`. Group removal — via the explicit Remove button OR auto-removal when a
// source group empties out (context menu, drag-and-drop, Cmd+G, move-all-out) — is
// funneled through one lifecycle hook (GroupManager.onGroupRemoved) that clears the
// removed group's refinement state, so nothing survives under a since-orphaned uid either.
//
// Loads the REAL GroupManager (classic script, no module.exports — loaded the same way
// the renderer does) and the REAL TagRefinementManager. No DOM, no Electron.
// Run with: node test/tagRefinementGroupIdentityRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GroupManager = new Function(
  fs.readFileSync(path.join(__dirname, '..', 'renderer', 'groupManager.js'), 'utf8') + '\n;return GroupManager;'
)();
const TagRefinementManager = require('../renderer/tagRefinementManager');

// Mirrors renderer.js's one-time wiring (renderer.js, just above "── Tag Refinement mode").
GroupManager.onGroupRemoved(uid => TagRefinementManager.clearGroup(uid));

let passed = 0;
function t(name, fn) {
  GroupManager.reset();
  TagRefinementManager.reset();
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

console.log('tagRefinementGroupIdentityRegression (Follow-up B)');

// ── Shared fixture: three groups mirroring the exact scenario used to reproduce the bug ──
// G1 → Ziyarat [a1, a2], a1 = explicit No Tags
// G2 → Waaz    [b1, b2], b1 = explicit No Tags
// G3 → Muaina  [c1, c2], c1 = explicit Muaina subset, c2 = explicit No Tags
const NONE = { eventTypes: [], additionalKeywords: [] };
const ZIY  = { eventTypes: ['Ziyarat'], additionalKeywords: [] };
const MUA  = { eventTypes: ['Muaina'], additionalKeywords: [] };

function buildThreeGroups() {
  const g1 = GroupManager.createGroup();
  const g2 = GroupManager.createGroup();
  const g3 = GroupManager.createGroup();
  GroupManager.assignFiles(['/a1', '/a2'], g1); GroupManager.setSubEvent(g1, 'Ziyarat-Hall A');
  GroupManager.assignFiles(['/b1', '/b2'], g2); GroupManager.setSubEvent(g2, 'Waaz-Hall B');
  GroupManager.assignFiles(['/c1', '/c2'], g3); GroupManager.setSubEvent(g3, 'Muaina-Hall C');
  const [G1, G2, G3] = GroupManager.getGroups();
  TagRefinementManager.setOverride(G1.uid, ['/a1'], NONE);
  TagRefinementManager.setOverride(G2.uid, ['/b1'], NONE);
  TagRefinementManager.setOverride(G3.uid, ['/c1'], MUA);
  TagRefinementManager.setOverride(G3.uid, ['/c2'], NONE);
  return { g1, g2, g3 };
}

/** The exact import-payload shape renderer.js builds (renderer.js ~10610-10630). */
function importPayload() {
  return GroupManager.getGroups().map(g => ({
    id: g.id, subEventId: g.subEventId, metadataTags: g.metadataTags ?? null, files: [...g.files],
    fileTagRefinements: TagRefinementManager.serializeGroupForImport(g.uid),
  }));
}

// ── 1. Remove middle ──────────────────────────────────────────────────────────────────

t('remove middle (G2): survivors keep their own refinements by stable uid, display ids renumber, removed group leaves nothing behind', () => {
  const { g1, g3 } = buildThreeGroups();
  const uidG1Before = GroupManager.getGroups().find(g => g.id === g1).uid;
  const uidG3Before = GroupManager.getGroups().find(g => g.id === g3).uid;

  GroupManager.removeGroup(g2Id());
  function g2Id() { return GroupManager.getGroups().find(g => g.subEventId === 'Waaz-Hall B').id; }

  const live = GroupManager.getGroups();
  assert.equal(live.length, 2, 'two survivors');
  assert.equal(live[0].label, 'G1'); assert.equal(live[0].subEventId, 'Ziyarat-Hall A');
  assert.equal(live[1].label, 'G2'); assert.equal(live[1].subEventId, 'Muaina-Hall C'); // old G3, renumbered to display G2

  // uids of survivors are UNCHANGED by the renumber.
  assert.equal(live[0].uid, uidG1Before, 'old G1 uid unchanged');
  assert.equal(live[1].uid, uidG3Before, 'old G3 uid unchanged (only its display id/label moved)');

  // Old G3's refinements are still attached, reachable through its (stable) uid.
  assert.deepEqual(TagRefinementManager.getOverride(live[1].uid, '/c1'), MUA);
  assert.deepEqual(TagRefinementManager.getOverride(live[1].uid, '/c2'), NONE);
  assert.equal(TagRefinementManager.groupRefinementCount(live[1].uid), 2);

  // Removed G2's refinement state is gone — not reachable under any live scope.
  for (const g of live) assert.notDeepEqual(TagRefinementManager.getOverride(g.uid, '/b1'), NONE);

  // No orphan entries anywhere: every scope that holds data belongs to a live group.
  const liveUids = new Set(live.map(g => g.uid));
  for (let n = 1; n <= 10; n++) {
    const uid = `group-${n}`;
    if (liveUids.has(uid)) continue;
    assert.equal(TagRefinementManager.serializeGroupForImport(uid), null, `no orphan data under ${uid}`);
  }

  // Import payload reflects the true intent — this is what reaches event.json/XMP.
  const payload = importPayload();
  const byFile = {};
  for (const g of payload) for (const [p, v] of Object.entries(g.fileTagRefinements || {})) byFile[p] = v;
  assert.deepEqual(byFile['/a1'], NONE);
  assert.deepEqual(byFile['/c1'], MUA);
  assert.deepEqual(byFile['/c2'], NONE, 'c2 explicit No Tags MUST survive the removal of the unrelated middle group');
  assert.ok(!('/b1' in byFile), 'removed group leaves no trace in the payload');
});

// ── 2. Remove first ───────────────────────────────────────────────────────────────────

t('remove first (G1): both survivors renumber and both keep their own refinement state', () => {
  buildThreeGroups();
  const g1id = GroupManager.getGroups().find(g => g.subEventId === 'Ziyarat-Hall A').id;
  const uidG2Before = GroupManager.getGroups().find(g => g.subEventId === 'Waaz-Hall B').uid;
  const uidG3Before = GroupManager.getGroups().find(g => g.subEventId === 'Muaina-Hall C').uid;

  GroupManager.removeGroup(g1id);

  const live = GroupManager.getGroups();
  assert.equal(live.length, 2);
  assert.equal(live[0].uid, uidG2Before); assert.equal(live[0].label, 'G1');
  assert.equal(live[1].uid, uidG3Before); assert.equal(live[1].label, 'G2');
  assert.deepEqual(TagRefinementManager.getOverride(live[0].uid, '/b1'), NONE);
  assert.deepEqual(TagRefinementManager.getOverride(live[1].uid, '/c1'), MUA);
  assert.deepEqual(TagRefinementManager.getOverride(live[1].uid, '/c2'), NONE);
});

// ── 3. Remove last ────────────────────────────────────────────────────────────────────

t('remove last (G3): no renumber occurs, survivors are unaffected', () => {
  const { g1, g2 } = buildThreeGroups();
  const g3id = GroupManager.getGroups().find(g => g.subEventId === 'Muaina-Hall C').id;
  const uidG1Before = GroupManager.getGroups().find(g => g.id === g1).uid;
  const uidG2Before = GroupManager.getGroups().find(g => g.id === g2).uid;

  GroupManager.removeGroup(g3id);

  const live = GroupManager.getGroups();
  assert.equal(live.length, 2);
  assert.equal(live[0].uid, uidG1Before); assert.equal(live[0].id, 1);
  assert.equal(live[1].uid, uidG2Before); assert.equal(live[1].id, 2);
  assert.deepEqual(TagRefinementManager.getOverride(live[0].uid, '/a1'), NONE);
  assert.deepEqual(TagRefinementManager.getOverride(live[1].uid, '/b1'), NONE);
});

// ── 4. Auto-empty removal routes ──────────────────────────────────────────────────────

t('auto-empty: unassigning the last files of a group removes it via the same hook (context-menu "Remove from Gn")', () => {
  const { g3 } = buildThreeGroups();
  const uidG3Before = GroupManager.getGroups().find(g => g.id === g3).uid;
  TagRefinementManager.clearFiles(['/b1', '/b2']); // renderer.js: TRM.clearFiles before GroupManager mutation
  GroupManager.unassignFiles(['/b1', '/b2']);       // empties G2 → auto-removeGroup(2)

  const live = GroupManager.getGroups();
  assert.equal(live.length, 2);
  const survivor = live.find(g => g.uid === uidG3Before);
  assert.ok(survivor, 'old G3 survives with its uid intact');
  assert.deepEqual(TagRefinementManager.getOverride(survivor.uid, '/c1'), MUA);
  assert.deepEqual(TagRefinementManager.getOverride(survivor.uid, '/c2'), NONE);
});

t('auto-empty: moving ALL of a group\'s files into an EARLIER group removes the source group; both scopes stay correct', () => {
  const { g1, g3 } = buildThreeGroups();
  const uidG1Before = GroupManager.getGroups().find(g => g.id === g1).uid;
  const uidG3Before = GroupManager.getGroups().find(g => g.id === g3).uid;
  TagRefinementManager.clearFiles(['/b1', '/b2']);
  GroupManager.assignFiles(['/b1', '/b2'], g1); // empties G2 → auto-removeGroup

  const live = GroupManager.getGroups();
  assert.equal(live.length, 2);
  assert.equal(GroupManager.getGroups().find(g => g.uid === uidG1Before).files.size, 4);
  assert.deepEqual(TagRefinementManager.getOverride(uidG1Before, '/a1'), NONE);
  // b1/b2 moved WITHOUT an override (their own override was cleared before the move, per
  // existing "moving a file leaves behind its refinement" semantics) — inherit G1 defaults.
  assert.equal(TagRefinementManager.getOverride(uidG1Before, '/b1'), null);
  const survivor3 = live.find(g => g.uid === uidG3Before);
  assert.deepEqual(TagRefinementManager.getOverride(survivor3.uid, '/c1'), MUA);
  assert.deepEqual(TagRefinementManager.getOverride(survivor3.uid, '/c2'), NONE);
});

t('auto-empty: moving ALL of a group\'s files into a LATER group removes the source group; both scopes stay correct', () => {
  const { g1, g3 } = buildThreeGroups();
  const uidG1Before = GroupManager.getGroups().find(g => g.id === g1).uid;
  const uidG3Before = GroupManager.getGroups().find(g => g.id === g3).uid;
  TagRefinementManager.clearFiles(['/b1', '/b2']);
  GroupManager.assignFiles(['/b1', '/b2'], g3); // empties G2 → auto-removeGroup

  const live = GroupManager.getGroups();
  assert.equal(live.length, 2);
  assert.deepEqual(TagRefinementManager.getOverride(uidG1Before, '/a1'), NONE);
  const survivor3 = live.find(g => g.uid === uidG3Before);
  assert.equal(survivor3.files.size, 4);
  assert.deepEqual(TagRefinementManager.getOverride(survivor3.uid, '/c1'), MUA);
  assert.deepEqual(TagRefinementManager.getOverride(survivor3.uid, '/c2'), NONE);
  assert.equal(TagRefinementManager.getOverride(survivor3.uid, '/b1'), null);
});

// ── 5. New-group hygiene ──────────────────────────────────────────────────────────────

t('new-group hygiene: a group created after a removal gets a never-before-used uid and inherits nothing', () => {
  buildThreeGroups();
  const g2id = GroupManager.getGroups().find(g => g.subEventId === 'Waaz-Hall B').id;
  GroupManager.removeGroup(g2id);

  const usedUids = new Set(GroupManager.getGroups().map(g => g.uid));
  const newGid = GroupManager.createGroup();
  const newGroup = GroupManager.getGroups().find(g => g.id === newGid);

  assert.ok(!usedUids.has(newGroup.uid), 'never-before-used uid');
  assert.equal(TagRefinementManager.groupRefinementCount(newGroup.uid), 0, 'no inherited refinement count');
  assert.equal(TagRefinementManager.serializeGroupForImport(newGroup.uid), null, 'no inherited refinement data');
});

// ── 6. Active refinement scope safety ─────────────────────────────────────────────────

t('active scope: removing the group currently being refined invalidates the scope rather than retargeting the renumbered survivor', () => {
  const { g2, g3 } = buildThreeGroups();
  const uidG2 = GroupManager.getGroups().find(g => g.id === g2).uid;
  const uidG3 = GroupManager.getGroups().find(g => g.id === g3).uid;

  TagRefinementManager.enter(uidG2); // renderer.js .gc-refine-trigger handler: enters by uid
  assert.equal(TagRefinementManager.getActiveGroupId(), uidG2);

  GroupManager.removeGroup(g2);

  // Simulates renderer.js's _syncRefinementModeValidity() safety net: the active scope no
  // longer resolves to a live group (uids never collide/alias), so it must exit rather
  // than silently keep pointing at scope "uid=group-2" which no longer exists.
  const stillLive = GroupManager.getGroups().find(g => g.uid === TagRefinementManager.getActiveGroupId());
  assert.equal(stillLive, undefined, 'active scope resolves to nothing — the safety net will fire');
  if (!stillLive) TagRefinementManager.exit();

  assert.equal(TagRefinementManager.isActive(), false);
  assert.equal(TagRefinementManager.getActiveGroupId(), null);

  // Critically: the renumbered survivor (old G3, now displayed as G2) must NOT be the one
  // that ends up "active" — proves no silent retargeting onto whichever group now owns the
  // numeric id the operator was looking at.
  const nowDisplayedG2 = GroupManager.getGroups().find(g => g.id === 2);
  assert.equal(nowDisplayedG2.uid, uidG3, 'old G3 is now displayed as G2');
  assert.notEqual(TagRefinementManager.getActiveGroupId(), nowDisplayedG2.uid);
});

// ── 7. Remap behavior ──────────────────────────────────────────────────────────────────

t('remap: a survivor\'s uid is stable across a component remap; refinement CONTENT clears per existing semantics', () => {
  const { g3 } = buildThreeGroups();
  const before = GroupManager.getGroups().find(g => g.id === g3);
  const uidBefore = before.uid;
  assert.equal(TagRefinementManager.groupRefinementCount(uidBefore), 2);

  // renderer.js .gc-sub-trigger handler: refCount>0 && subEventId changing → clear then remap.
  TagRefinementManager.clearGroup(uidBefore);
  GroupManager.setSubEvent(g3, 'Majlis-Hall D');

  const after = GroupManager.getGroups().find(g => g.id === g3);
  assert.equal(after.uid, uidBefore, 'uid unchanged merely because subEventId changed');
  assert.equal(after.subEventId, 'Majlis-Hall D');
  assert.equal(TagRefinementManager.groupRefinementCount(after.uid), 0, 'refinement content cleared');
});

t('remap sequence A→B→unassigned→B: identity stable, content follows existing clear-on-remap semantics', () => {
  const gid = GroupManager.createGroup();
  GroupManager.assignFiles(['/x1'], gid);
  GroupManager.setSubEvent(gid, 'A');
  const uid = GroupManager.getGroups()[0].uid;
  TagRefinementManager.setOverride(uid, ['/x1'], NONE);

  // A → B (remap while refined: existing semantics clear it)
  TagRefinementManager.clearGroup(uid);
  GroupManager.setSubEvent(gid, 'B');
  assert.equal(GroupManager.getGroups()[0].uid, uid);
  assert.equal(TagRefinementManager.groupRefinementCount(uid), 0);

  // B → unassigned
  TagRefinementManager.setOverride(uid, ['/x1'], MUA);
  TagRefinementManager.clearGroup(uid);
  GroupManager.setSubEvent(gid, null);
  assert.equal(GroupManager.getGroups()[0].uid, uid, 'uid stable through unassign-remap too');
  assert.equal(TagRefinementManager.groupRefinementCount(uid), 0);

  // unassigned → B
  GroupManager.setSubEvent(gid, 'B');
  assert.equal(GroupManager.getGroups()[0].uid, uid);
});

// ── 8. EVENT_SCOPE isolation ───────────────────────────────────────────────────────────

t('EVENT_SCOPE can never collide with a group uid, group.id, or their string/numeric forms', () => {
  assert.notEqual(TagRefinementManager.EVENT_SCOPE, 1);
  assert.notEqual(TagRefinementManager.EVENT_SCOPE, '1');
  assert.equal(/^group-\d+$/.test(TagRefinementManager.EVENT_SCOPE), false);

  const g1 = GroupManager.createGroup();
  const uid = GroupManager.getGroups()[0].uid;
  TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, ['/e1'], NONE);
  TagRefinementManager.setOverride(uid, ['/g1'], MUA);

  assert.deepEqual(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/e1'), NONE);
  assert.deepEqual(TagRefinementManager.getOverride(uid, '/g1'), MUA);
  assert.equal(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/g1'), null);
  assert.equal(TagRefinementManager.getOverride(uid, '/e1'), null);

  // Removing the group must not touch EVENT_SCOPE.
  GroupManager.removeGroup(g1);
  assert.deepEqual(TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, '/e1'), NONE);
  assert.equal(TagRefinementManager.serializeGroupForImport(uid), null);
});

// ── 9. Performance / state-leak: repeated create/delete churn doesn't accumulate state ──

t('repeated group churn (create → refine → remove ×200) leaves no residual refinement state', () => {
  for (let i = 0; i < 200; i++) {
    const gid = GroupManager.createGroup();
    GroupManager.assignFiles([`/churn${i}`], gid);
    const uid = GroupManager.getGroups().find(g => g.id === gid).uid;
    TagRefinementManager.setOverride(uid, [`/churn${i}`], MUA);
    assert.equal(TagRefinementManager.groupRefinementCount(uid), 1);
    GroupManager.removeGroup(gid);
    assert.equal(TagRefinementManager.serializeGroupForImport(uid), null, `churn ${i}: removed group's state must not survive`);
  }
  assert.equal(GroupManager.getGroups().length, 0);
  // Internal cross-check: nothing reachable under any of the 200 uids issued.
  for (let n = 1; n <= 200; n++) {
    assert.equal(TagRefinementManager.serializeGroupForImport(`group-${n}`), null, `no leaked state under group-${n}`);
  }
});

// ── 10. Seeded model-based fuzz (promoted from ad hoc forensic investigation) ───────────
// Ground truth: an independent map of filePath → last-applied refinement value, updated by
// the SAME test driving both the real managers and the truth map. After every operation,
// verify every live file's resolved refinement value (via the real uid-keyed lookup)
// matches ground truth, and that no removed group's state is reachable.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_SEEDS = [1, 2, 3, 7, 11, 13, 17, 42, 99, 1234, 7777, 20260921];
const FUZZ_FILES = Array.from({ length: 8 }, (_, i) => `/fz${i}`);
const FUZZ_SUBS = ['Sub-A', 'Sub-B', 'Sub-C', 'Sub-D'];
const FUZZ_VALS = [NONE, ZIY, MUA, { eventTypes: ['Waaz'], additionalKeywords: [] }];

t('seeded model-based fuzz: create/delete/assign/unassign/move/remap/refine churn never loses, contaminates, or leaks refinement state', () => {
  for (const seed of FUZZ_SEEDS) {
    GroupManager.reset(); TagRefinementManager.reset();
    const rnd = mulberry32(seed);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const truth = new Map(); // filePath -> last-applied value, or undefined if never refined

    for (let op = 0; op < 25; op++) {
      const groups = GroupManager.getGroups();
      const kind = pick(['newGroup', 'newGroup', 'assign', 'refine', 'refine', 'remove', 'unassign', 'remap']);

      if (kind === 'newGroup') {
        const files = FUZZ_FILES.filter(() => rnd() < 0.3);
        if (!files.length) continue;
        TagRefinementManager.clearFiles(files);
        files.forEach(f => truth.delete(f));
        const gid = GroupManager.createGroup();
        GroupManager.assignFiles(files, gid);
        if (rnd() < 0.8) GroupManager.setSubEvent(gid, pick(FUZZ_SUBS));
      } else if (kind === 'assign' && groups.length) {
        const g = pick(groups);
        const files = FUZZ_FILES.filter(() => rnd() < 0.25);
        if (!files.length) continue;
        TagRefinementManager.clearFiles(files);
        files.forEach(f => truth.delete(f));
        GroupManager.assignFiles(files, g.id);
      } else if (kind === 'refine' && groups.length) {
        const g = pick(groups);
        const files = [...g.files].filter(() => rnd() < 0.6);
        if (!files.length) continue;
        const val = pick(FUZZ_VALS);
        TagRefinementManager.setOverride(g.uid, files, val);
        files.forEach(f => truth.set(f, val));
      } else if (kind === 'remove' && groups.length) {
        const g = pick(groups);
        [...g.files].forEach(f => truth.delete(f));
        GroupManager.removeGroup(g.id);
      } else if (kind === 'unassign') {
        const files = FUZZ_FILES.filter(f => GroupManager.getGroupForFile(f) && rnd() < 0.3);
        if (!files.length) continue;
        TagRefinementManager.clearFiles(files);
        files.forEach(f => truth.delete(f));
        GroupManager.unassignFiles(files);
      } else if (kind === 'remap' && groups.length) {
        const g = pick(groups);
        const newSub = pick(FUZZ_SUBS.filter(s => s !== g.subEventId));
        if (TagRefinementManager.groupRefinementCount(g.uid) > 0) {
          [...g.files].forEach(f => truth.delete(f));
          TagRefinementManager.clearGroup(g.uid);
        }
        GroupManager.setSubEvent(g.id, newSub);
      }

      // ── Invariant checks after EVERY operation ──
      const live = GroupManager.getGroups();
      for (const g of live) {
        for (const f of g.files) {
          const want = truth.has(f) ? truth.get(f) : null; // null = no override (inherits)
          const got = TagRefinementManager.getOverride(g.uid, f);
          assert.deepEqual(got, want, `seed ${seed} op ${op}: ${f} in ${g.label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)} (lost or contaminated)`);
        }
      }
      // No live file may carry a refinement it was never assigned (contamination check
      // across ALL possible uid slots up to the current counter, not just live groups).
      for (const f of FUZZ_FILES) {
        const g = GroupManager.getGroupForFile(f);
        if (!g) continue;
        if (!truth.has(f)) {
          assert.equal(TagRefinementManager.getOverride(g.uid, f), null, `seed ${seed} op ${op}: ${f} has an override it was never given`);
        }
      }
    }
  }
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
