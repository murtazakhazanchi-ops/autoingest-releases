'use strict';

// LIVE lifecycle validation of durable metadata intent — real Electron app, real IPC, real
// exiftool-vendored, real persistent queue, real crash/restart, real Local First import + sync,
// real photographer-folder rename. Invariant under test:
//
//   A persisted explicit metadata decision stays reconstructable throughout the archive lifecycle
//   WITHOUT renderer state or the original source card.
//
// A = Default, B = explicit subset, C = explicit No Tags — RAW/XMP and JPG, single-component
// (EVENT_SCOPE-style) and multi-component (group-style), plus legacy MetaPicker + refinement.
// Every fixture's source directory is DELETED after import, before any later workflow runs.
//
// Run:  node test/metadataIntentDurabilityLive.test.js            (Playwright launches Electron)
// Optional: TAGINTENT_ONLY=repair,reapply  (comma list of section ids) to run a subset.

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const ONLY = process.env.TAGINTENT_ONLY ? process.env.TAGINTENT_ONLY.split(',').map(s => s.trim()) : null;

let failures = 0;
const log = (...a) => console.log('[intent-live]', ...a);
const check = (cond, msg) => { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } };
const J = x => JSON.stringify(x);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = p => fsp.mkdtemp(path.join(os.tmpdir(), p));
const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
const same = (a, b) => !!a && J([...a].sort()) === J([...b].sort());

const et = new ExifTool();
// Minimal valid JPEG so ExifTool can really embed XMP/IPTC.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const writeRaw = async (p, tag) => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.from('not-a-real-raw-' + tag + '-' + path.basename(p))); };
const writeJpg = async p => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, JPEG); };

async function launch(userData, tag) {
  const app = await electron.launch({ args: [REPO, '--user-data-dir=' + userData, '--no-sandbox'], cwd: REPO, timeout: 90000 });
  let win = await app.firstWindow({ timeout: 90000 });
  await win.waitForTimeout(1500);
  const st = await win.evaluate(() => { const v = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; }; return { welcome: v('splashWelcome'), select: v('splashSelect'), create: v('splashCreate') }; });
  const mainP = app.waitForEvent('window', { timeout: 60000 });
  if (st.create) { await win.fill('#splashInputName', 'Intent ' + tag); await win.fill('#splashInputRole', 'QA'); await win.click('#splashCreateStartBtn'); }
  else if (st.select) {
    const has = await win.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (has) { await win.click('.splash-user-item'); await win.click('#splashSelectStartBtn'); }
    else { await win.click('#splashNewProfileBtn'); await win.fill('#splashInputName', 'Intent ' + tag); await win.fill('#splashInputRole', 'QA'); await win.click('#splashCreateStartBtn'); }
  } else if (st.welcome) await win.click('#splashContinueBtn');
  win = await mainP; await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500);
  await win.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  return { app, win };
}
const api = (win, name, ...args) => win.evaluate(({ name, args }) => window.api[name](...args), { name, args });
const queueDir = ud => path.join(ud, 'metadata-queue');
async function waitBatchDone(ud, batchId, timeout = 90000) {
  const m = path.join(queueDir(ud), batchId + '.manifest.json'); const t0 = Date.now(); let seen = false;
  while (Date.now() - t0 < timeout) { const ex = fs.existsSync(m); if (ex) seen = true; if (!ex && (seen || Date.now() - t0 > 4000)) return true; await sleep(400); }
  return false;
}
async function readKw(file) {
  const ext = path.extname(file).toLowerCase(); const raw = ['.cr2', '.cr3', '.nef', '.arw', '.dng'].includes(ext);
  const target = raw ? file.slice(0, -ext.length) + '.xmp' : file;
  let isFile = false; try { isFile = fs.statSync(target).isFile(); } catch { /* absent */ }
  if (!isFile) return { exists: false, subject: null, target };
  const tags = await et.read(target);
  return { exists: true, subject: asArr(tags.Subject).map(String), city: tags.City ?? null, target };
}
const readJson = async p => JSON.parse(await fsp.readFile(p, 'utf8'));
async function poll(fn, ms = 25000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(500); } return v; }

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
const PHOTOG = 'Jane Doe';
const EMPTY = { eventTypes: [], additionalKeywords: [] }, SUB = { eventTypes: ['Ziyarat'], additionalKeywords: [] };
const COMP_EV = { id: 1, folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [{ label: 'Quran Tilawat', keywordId: 'k1' }] };
const COMP_G2 = { id: 2, folderName: 'Waaz-Majlis-Hall B', location: 'Hall B', city: 'Surat', country: 'India', types: ['Waaz', 'Majlis'], additionalKeywords: [{ label: 'Children', keywordId: 'k2' }] };
const COMP_META = { id: 1, folderName: 'Ziyarat-Waaz-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat', 'Waaz'], additionalKeywords: [{ label: 'Quran Tilawat', keywordId: 'k1' }] };
const ctxA = ['Hall A', 'Surat', 'India'], ctxB = ['Hall B', 'Surat', 'India'];
const NAME = { A: 'default', B: 'subset', C: 'none' };
function plan(kind) {
  const abc = (prefix, g, exp) => ['A', 'B', 'C'].flatMap(k => ['cr2', 'jpg'].map(ext => ({ name: `${prefix}${k}_${NAME[k]}.${ext}`, kind: k, ext, group: g, expect: exp[k] })));
  if (kind === 'EV') return { comps: [COMP_EV], multi: false, files: abc('', 0, { A: ['Ziyarat', 'Quran Tilawat', ...ctxA], B: ['Ziyarat', ...ctxA], C: [...ctxA] }), override: { B: SUB, C: EMPTY } };
  if (kind === 'GRP') return { comps: [COMP_EV, COMP_G2], multi: true,
    files: [...abc('G1_', 1, { A: ['Ziyarat', 'Quran Tilawat', ...ctxA], B: ['Ziyarat', ...ctxA], C: [...ctxA] }), ...abc('G2_', 2, { A: ['Waaz', 'Majlis', 'Children', ...ctxB], B: ['Waaz', ...ctxB], C: [...ctxB] })],
    override: { 1: { B: SUB, C: EMPTY }, 2: { B: { eventTypes: ['Waaz'], additionalKeywords: [] }, C: EMPTY } } };
  if (kind === 'META') return { comps: [COMP_META], multi: false,
    files: ['A', 'B', 'C'].flatMap(k => ['cr2', 'jpg'].map(ext => ({ name: `M_${k}_${NAME[k]}.${ext}`, kind: k, ext, group: k === 'C' ? 2 : 1, expect: k === 'A' ? ['Waaz', 'Quran Tilawat', ...ctxA] : k === 'B' ? ['Ziyarat', ...ctxA] : [...ctxA] }))),
    override: { B: SUB, C: EMPTY } };
  throw new Error(kind);
}
async function importScenario(win, ud, root, kind, label, { obstruct = [], deleteSource = true } = {}) {
  const P = plan(kind); const coll = 'Coll_' + label; const evDir = path.join(root, coll, `1448-01-01 _01-${label}`);
  await api(win, 'writeEventJson', evDir, { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: label, components: P.comps });
  const src = await mk('fx-src-' + label + '-'); const files = []; let i = 0;
  for (const f of P.files) {
    const s = path.join(src, f.name); if (f.ext === 'jpg') await writeJpg(s); else await writeRaw(s, i++);
    const comp = P.multi ? P.comps[f.group - 1].folderName : null;
    files.push({ ...f, src: s, dest: P.multi ? path.join(evDir, comp, PHOTOG, f.name) : path.join(evDir, PHOTOG, f.name), comp });
  }
  const ovFor = f => (kind === 'GRP' ? P.override[f.group][f.kind] : P.override[f.kind]);
  const mkGroup = (id, sub, tags, gf) => { const fr = {}; for (const f of gf) { const o = ovFor(f); if (o) fr[f.src] = o; } return { id, subEventId: sub, ...(tags !== undefined ? { metadataTags: tags } : {}), files: gf.map(f => f.src), fileTagRefinements: Object.keys(fr).length ? fr : null }; };
  const groups = kind === 'EV' ? [mkGroup(0, null, undefined, files)]
    : kind === 'GRP' ? [1, 2].map(g => mkGroup(g, P.comps[g - 1].folderName, null, files.filter(f => f.group === g)))
    : [mkGroup(1, null, ['Waaz'], files.filter(f => f.group === 1)), mkGroup(2, null, [], files.filter(f => f.group === 2))];
  for (const f of files) if (obstruct.includes(f.name) && f.ext === 'cr2') await fsp.mkdir(f.dest.slice(0, -4) + '.xmp', { recursive: true });
  const res = await win.evaluate(({ jobs, evDir, ctx }) => window.api.commitImportTransaction(jobs, evDir, ctx),
    { jobs: files.map(f => ({ src: f.src, dest: f.dest })), evDir, ctx: { groups, photographer: PHOTOG, liveComps: null, subEventNames: null, collName: coll, source: 'live', importedBy: 'live' } });
  const done = res.metadataBatchId ? await waitBatchDone(ud, res.metadataBatchId) : false;
  if (deleteSource) await fsp.rm(src, { recursive: true, force: true });                          // the SD card is gone from here on
  return { P, evDir, files, groups, res, done, batchId: res.metadataBatchId, src };
}
const stateOf = async files => { const o = {}; for (const f of files) o[f.name] = await readKw(f.dest); return o; };
const bad = (files, st) => files.filter(f => !same(st[f.name].subject, f.expect)).map(f => `${f.name}: expect ${J(f.expect)} got ${J(st[f.name].subject)}`);
async function auditRows(win, evDir) {
  const a = await api(win, 'runMetadataAudit', { type: 'event', rootPath: evDir });
  for (let i = 0; i < 80; i++) { await sleep(400); const s = await api(win, 'getMetadataAuditStatus', a.jobId); if (s && s.running === false && s.completedAt) break; }
  const rep = await api(win, 'getMetadataAuditReport', a.jobId, 0, 500, null);
  return { jobId: a.jobId, rows: rep.items };
}
const want = id => !ONLY || ONLY.includes(id);
async function section(id, title, fn) {
  if (!want(id)) return;
  log(`════ ${id}: ${title} ════`);
  try { await fn(); } catch (e) { failures++; log(`FAIL — ${id} threw: ${e.stack || e.message}`); }
}

(async () => {
  const ud = await mk('intent-ud-'), root = await mk('intent-root-');
  let { app, win } = await launch(ud, 'main');
  await api(win, 'setMainArchiveRoot', root);
  const pageErrors = []; win.on('pageerror', e => pageErrors.push(e.message));

  // ═══ 1. initial import + Audit ═══════════════════════════════════════════════════════════════
  await section('initial', 'initial import (EVENT_SCOPE / group / MetaPicker+refinement × RAW/JPG) then Audit — source deleted', async () => {
    for (const kind of ['EV', 'GRP', 'META']) {
      const sc = await importScenario(win, ud, root, kind, 'I' + kind);
      const problems = bad(sc.files, await stateOf(sc.files));
      check(sc.done && problems.length === 0, `${kind}: initial import writes A/B/C exactly (${sc.files.length} files RAW+JPG)${problems.length ? ' — ' + problems.join(' | ') : ''}`);
      const ev = await readJson(path.join(sc.evDir, 'event.json'));
      check(Array.isArray(ev.tagRefinements) && ev.tagRefinements.some(b => b.eventTypes.length === 0 && b.additionalKeywords.length === 0), `${kind}: event.json holds the explicit-empty record`);
      check(ev.tagRefinements.flatMap(b => b.relPaths).every(r => !r.includes('\\') && !r.startsWith('/')), `${kind}: persisted keys are canonical "/" event-relative paths`);
      if (kind === 'META') check(Array.isArray(ev.metadataGroups) && ev.metadataGroups.some(g => g.metadataTags.length === 0), `${kind}: metadataGroups keeps the explicit [] (Tier 1) record`);
      const { rows } = await auditRows(win, sc.evDir);
      const notClean = rows.filter(r => r.status !== 'complete');
      check(rows.length === sc.files.length && notClean.length === 0, `${kind}: Audit is CLEAN for correctly refined + MetaPicker files (${rows.length} rows)${notClean.length ? ' — ' + notClean.map(r => path.basename(r.filePath) + ':' + r.status + J(r.keywords?.missing) + J(r.keywords?.unexpected)).join(' ') : ''}`);
    }
  });

  // ═══ 2. same-session retry ═══════════════════════════════════════════════════════════════════
  await section('retry', 'same-session metadata:retry (real write failure, then real retry)', async () => {
    const sc = await importScenario(win, ud, root, 'EV', 'RETRY', { obstruct: ['B_subset.cr2', 'C_none.cr2'], deleteSource: false });
    await sleep(4000);
    for (const f of sc.files) if (['B_subset.cr2', 'C_none.cr2'].includes(f.name)) await fsp.rm(f.dest.slice(0, -4) + '.xmp', { recursive: true, force: true });
    await api(win, 'retryMetadata', sc.batchId); await sleep(6000);
    const raws = sc.files.filter(f => f.ext === 'cr2'); const problems = bad(raws, await stateOf(raws));
    check(problems.length === 0, `retry re-applies the frozen expectation (B subset + C explicit None intact)${problems.length ? ' — ' + problems.join(' | ') : ''}`);
  });

  // ═══ 3. Repair ═══════════════════════════════════════════════════════════════════════════════
  await section('repair', 'Audit → Repair with an UNRELATED broken field (source deleted)', async () => {
    for (const kind of ['EV', 'META']) {
      const sc = await importScenario(win, ud, root, kind, 'R' + kind);
      const before = await stateOf(sc.files);
      for (const f of sc.files.filter(f => f.kind !== 'A' || kind === 'META')) await et.write(before[f.name].target, { 'XMP-photoshop:City': 'Wrongville' }, { writeArgs: ['-overwrite_original'] });
      const { jobId, rows } = await auditRows(win, sc.evDir);
      const partial = rows.filter(r => r.status === 'partial');
      check(partial.length > 0 && partial.every(r => r.keywords.compliant === true), `${kind}: Audit flags ONLY the unrelated field (${partial.length} partial, keywords compliant on all)`);
      const run = await api(win, 'runMetadataRepair', jobId); await sleep(2500);
      const after = await stateOf(sc.files);
      check(sc.files.every(f => same(after[f.name].subject, before[f.name].subject) && J(after[f.name].subject) === J(before[f.name].subject)), `${kind}: Repair leaves EVERY Subject byte-identical (order included)`);
      const cities = await Promise.all(sc.files.map(async f => (await readKw(f.dest)).city));
      check(cities.every(c => c === 'Surat'), `${kind}: the unrelated broken field (City) was repaired on every file`);
      const C = after[sc.files.find(f => f.kind === 'C').name].subject;
      check(!C.includes('Ziyarat') && !C.includes('Quran Tilawat') && !C.includes('Waaz'), `${kind}: explicit No Tags is NOT restored by Repair`);
      check(bad(sc.files, after).length === 0, `${kind}: A/B/C still exactly match operator intent after Repair`);
      check(run && run.ok, `${kind}: repair reported ok`);
    }
  });

  // ═══ 4. Reapply ══════════════════════════════════════════════════════════════════════════════
  await section('reapply', 'Reapply Metadata with the source/card unavailable', async () => {
    for (const kind of ['EV', 'GRP', 'META']) {
      const sc = await importScenario(win, ud, root, kind, 'P' + kind);
      check(!fs.existsSync(sc.src), `${kind}: setup — source directory is gone`);
      const r = await api(win, 'reapplyEventMetadata', sc.evDir);
      if (r.batchId) await waitBatchDone(ud, r.batchId); await sleep(800);
      const problems = bad(sc.files, await stateOf(sc.files));
      check(r.ok && problems.length === 0, `${kind}: Reapply preserves Default / subset / explicit None (Tier 0 > Tier 1)${problems.length ? ' — ' + problems.join(' | ') : ''}`);
    }
  });

  // ═══ 5. photographer-folder rename ═══════════════════════════════════════════════════════════
  await section('rename', 'real AutoIngest photographer-folder rename remaps durable intent', async () => {
    for (const kind of ['EV', 'META']) {
      const sc = await importScenario(win, ud, root, kind, 'N' + kind);
      const res = await api(win, 'applyPhotographerSequence', { localEventPath: sc.evDir, scopedOrdered: [{ scopeKey: '__eventRoot__', ordered: [{ canonical: PHOTOG, sequence: 1 }] }] });
      check(res.ok && res.renames.some(r => r.from === PHOTOG), `${kind}: the real rename ran (${J((res.renames || []).map(r => `${r.from}→${r.to}`))})`);
      const newFolder = res.renames.find(r => r.from === PHOTOG).to;
      check(fs.existsSync(path.join(sc.evDir, newFolder)) && !fs.existsSync(path.join(sc.evDir, PHOTOG)), `${kind}: folder renamed on disk`);
      const ev = await readJson(path.join(sc.evDir, 'event.json'));
      const keys = [...(ev.tagRefinements || []), ...(ev.metadataGroups || [])].flatMap(b => b.relPaths);
      check(keys.length > 0 && keys.every(k => k.startsWith(newFolder + '/')), `${kind}: BOTH tagRefinements and metadataGroups keys remapped to "${newFolder}/…" (${keys.length} keys)`);
      const moved = sc.files.map(f => ({ ...f, dest: f.dest.replace(path.join(sc.evDir, PHOTOG), path.join(sc.evDir, newFolder)) }));
      const { rows } = await auditRows(win, sc.evDir);
      check(rows.length === moved.length && rows.every(r => r.status === 'complete'), `${kind}: Audit still resolves every file after the rename`);
      const r = await api(win, 'reapplyEventMetadata', sc.evDir); if (r.batchId) await waitBatchDone(ud, r.batchId); await sleep(800);
      const problems = bad(moved, await stateOf(moved));
      check(problems.length === 0, `${kind}: Reapply after the rename still preserves every decision${problems.length ? ' — ' + problems.join(' | ') : ''}`);
    }
  });

  // ═══ 6. multiple imports ═════════════════════════════════════════════════════════════════════
  await section('multi', 'multiple imports into one event: refined→refined, refined→Default, explicit None, same-size skip, collision rename', async () => {
    const coll = 'Coll_MULTI', evDir = path.join(root, coll, '1448-01-01 _01-MULTI');
    await api(win, 'writeEventJson', evDir, { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'MULTI', components: [COMP_EV] });
    const srcDir = await mk('fx-src-MULTI-'); const S = {};
    const imp = async (photog, entries) => {                                   // entries: [{ name, src?, override }]
      const files = [];
      for (const e of entries) { const s = e.src || path.join(srcDir, e.name); if (!e.src) await writeRaw(s, e.name + (e.content || '')); files.push({ ...e, src: s, dest: path.join(evDir, photog, e.dest || e.name) }); }
      const fr = {}; for (const f of files) if (f.override) fr[f.src] = f.override;
      const res = await win.evaluate(({ jobs, evDir, ctx }) => window.api.commitImportTransaction(jobs, evDir, ctx),
        { jobs: files.map(f => ({ src: f.src, dest: f.dest })), evDir, ctx: { groups: [{ id: 0, subEventId: null, files: files.map(f => f.src), fileTagRefinements: Object.keys(fr).length ? fr : null }], photographer: photog, liveComps: null, subEventNames: null, collName: coll, source: 'live', importedBy: 'live' } });
      if (res.metadataBatchId) await waitBatchDone(ud, res.metadataBatchId);
      await sleep(1500);
      return { files, res };
    };
    const recs = async () => { const ev = await readJson(path.join(evDir, 'event.json')); const m = new Map(); for (const b of ev.tagRefinements || []) for (const r of b.relPaths) m.set(r, b); return { m, ev }; };
    const isEmpty = b => b && b.eventTypes.length === 0 && b.additionalKeywords.length === 0;

    const i1 = await imp(PHOTOG, [{ name: 'J1_none.cr2', override: EMPTY }, { name: 'J2_sub.cr2', override: SUB }, { name: 'J3_def.cr2' }]);
    S.j1 = i1.files[0]; S.j2 = i1.files[1]; S.j3 = i1.files[2];
    let r = await recs();
    check(isEmpty(r.m.get(`${PHOTOG}/J1_none.cr2`)) && r.m.get(`${PHOTOG}/J2_sub.cr2`)?.eventTypes[0] === 'Ziyarat', 'import 1 records: J1 explicit-empty, J2 subset');

    await imp('John Roe', [{ name: 'R1_none.cr2', override: EMPTY }, { name: 'R2_def.cr2' }]);
    r = await recs();
    check(isEmpty(r.m.get(`${PHOTOG}/J1_none.cr2`)), 'import 1 record J1 (explicit-empty) SURVIVES import 2 (previously replaced wholesale)');
    check(isEmpty(r.m.get('John Roe/R1_none.cr2')), 'import 2 adds its own explicit-empty record');
    check(r.m.has(`${PHOTOG}/J2_sub.cr2`) && r.m.get(`${PHOTOG}/J2_sub.cr2`).eventTypes[0] === 'Ziyarat', 'import 1 record J2 (subset) also survives import 2');

    // same photographer folder, same bytes ⇒ same-size SKIP; the new override becomes this import's intent (refined → refined)
    await imp(PHOTOG, [{ name: 'J2_sub.cr2', src: S.j2.src, dest: 'J2_sub.cr2', override: EMPTY }]);

    const i3 = await imp(PHOTOG, [{ name: 'J1_none.cr2', src: S.j1.src, dest: 'J1_none.cr2' }]);        // same-size skip, now with NO override ⇒ refined → Default
    r = await recs();
    check(!r.m.has(`${PHOTOG}/J1_none.cr2`), 'refined → Default (same-size skip, no override): that file\'s record is REMOVED');
    check(r.m.has('John Roe/R1_none.cr2') && r.m.has(`${PHOTOG}/J2_sub.cr2`) === true, 'every unrelated record survives (R1 explicit-empty, J2 updated)');
    check(isEmpty(r.m.get(`${PHOTOG}/J2_sub.cr2`)), 'refined → refined via same-size skip: J2 subset became explicit None');

    const dupSrc = path.join(srcDir, 'dup.cr2'); await writeRaw(dupSrc, 'x'.repeat(40));
    await writeRaw(path.join(evDir, PHOTOG, 'dup.cr2'), 'OLD');
    await imp(PHOTOG, [{ name: 'dup.cr2', src: dupSrc, dest: 'dup.cr2', override: EMPTY }]);
    r = await recs();
    check(fs.existsSync(path.join(evDir, PHOTOG, 'dup_1.cr2')) && isEmpty(r.m.get(`${PHOTOG}/dup_1.cr2`)) && !r.m.has(`${PHOTOG}/dup.cr2`), 'collision rename: explicit-empty record is keyed by the ACTUAL destination (dup_1.cr2)');

    const allKeys = [...r.m.keys()].flatMap(k => [k]); const dupKeys = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);
    check(dupKeys.length === 0, 'no relPath appears in two buckets');
    // The rewritten metadata agrees with the records (skip-verification re-applied this import's intent):
    const j1 = await poll(async () => { const k = await readKw(S.j1.dest); return same(k.subject, ['Ziyarat', 'Quran Tilawat', ...ctxA]) ? k : null; });
    check(!!j1, 'J1 (returned to Default) now carries the default keywords — record and metadata agree');
    const j2 = await poll(async () => { const k = await readKw(S.j2.dest); return same(k.subject, ctxA) ? k : null; });
    check(!!j2, 'J2 (refined → explicit None) now carries no refinable tags — record and metadata agree');
  });

  // ═══ 7. transfer verification ════════════════════════════════════════════════════════════════
  // Validated with the real verification service in test/metadataIntentLifecycle.test.js (real ExifTool,
  // no source): correctly refined files verify COMPLETE via buildEventEvidenceContext.

  // ═══ 8. Local First: real IPC import into staging, then the real sync into an existing archive event.json ═══
  await section('localfirst', 'Local First: real staging import → real syncJob into an EXISTING archive event.json', async () => {
    const stagingRoot = await mk('intent-staging-'); const nasRoot = root;
    await api(win, 'setLocalStagingRoot', stagingRoot); await api(win, 'setNasRoot', nasRoot);
    const coll = 'Coll_LF', evName = '1448-01-01 _01-LF', archiveEv = path.join(nasRoot, coll, evName);
    await api(win, 'writeEventJson', archiveEv, { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'LF', components: [COMP_EV] });
    // archive already holds intent for an OLDER import (archive-only) + a stale record for a path staging will re-create as Default
    await fsp.mkdir(path.join(archiveEv, 'Earlier Photog'), { recursive: true }); await writeJpg(path.join(archiveEv, 'Earlier Photog', 'old.jpg'));
    await writeJpg(path.join(archiveEv, PHOTOG, 'clash.jpg'));
    await fsp.appendFile(path.join(archiveEv, PHOTOG, 'clash.jpg'), Buffer.alloc(64));                                     // archive's own clash.jpg: different size ⇒ conflict rename
    const seeded = await readJson(path.join(archiveEv, 'event.json'));
    seeded.tagRefinements = [{ eventTypes: [], additionalKeywords: [], relPaths: ['Earlier Photog/old.jpg', `${PHOTOG}/stale_default.jpg`] }];
    await fsp.writeFile(path.join(archiveEv, 'event.json'), JSON.stringify(seeded, null, 2));

    const mirror = await api(win, 'ensureLocalMirror', { collectionName: coll, eventName: evName, eventPath: archiveEv, eventJsonPath: path.join(archiveEv, 'event.json') });
    check(mirror && mirror.ok, `ensureLocalMirror ok (${mirror && (mirror.reason || mirror.localEventPath)})`);
    const localEv = mirror.localEventPath;
    const src = await mk('fx-src-LF-'); const mkf = async (name, ov) => { const s = path.join(src, name); await writeJpg(s); return { name, src: s, dest: path.join(localEv, PHOTOG, name), ov }; };
    const files = [await mkf('a_default.jpg', null), await mkf('b_subset.jpg', SUB), await mkf('c_none.jpg', EMPTY), await mkf('clash.jpg', EMPTY), await mkf('stale_default.jpg', null)];
    const fr = {}; for (const f of files) if (f.ov) fr[f.src] = f.ov;
    const res = await win.evaluate(({ jobs, ev, ctx }) => window.api.commitImportTransaction(jobs, ev, ctx),
      { jobs: files.map(f => ({ src: f.src, dest: f.dest })), ev: localEv, ctx: { groups: [{ id: 0, subEventId: null, files: files.map(f => f.src), fileTagRefinements: fr }], photographer: PHOTOG, liveComps: null, subEventNames: null, collName: coll, source: 'live', importedBy: 'live', importMode: 'local-first' } });
    if (res.metadataBatchId) await waitBatchDone(ud, res.metadataBatchId);
    await sleep(1500);
    const stagingDoc = await readJson(path.join(localEv, 'event.json'));
    check((stagingDoc.tagRefinements || []).some(b => b.relPaths.includes(`${PHOTOG}/c_none.jpg`)), 'the real Local First import wrote intent into the STAGING event.json');

    const sync = require('../services/archiveSyncService');
    const result = await sync.syncJob({ localEventPath: localEv, files: files.map(f => `${PHOTOG}/${f.name}`) }, { nasRoot, stagingRoot });
    check(result.ok && result.renamedConflicts === 1, `real syncJob succeeded (${J(result.errors)}), 1 conflict rename`);
    const arch = await readJson(path.join(archiveEv, 'event.json'));
    const m = new Map(); for (const b of arch.tagRefinements || []) for (const r of b.relPaths) m.set(r, b);
    check(isEmptyRec(m.get('Earlier Photog/old.jpg')), 'archive-only record SURVIVES the sync');
    check(m.get(`${PHOTOG}/b_subset.jpg`)?.eventTypes[0] === 'Ziyarat', 'copied file: staging subset lands in the archive');
    check(isEmptyRec(m.get(`${PHOTOG}/c_none.jpg`)), 'copied file: staging explicit-empty lands in the archive');
    check(isEmptyRec(m.get(`${PHOTOG}/clash_1.jpg`)) && !m.has(`${PHOTOG}/clash.jpg`), 'conflict rename: intent mapped to the ACTUAL archive destination (clash_1.jpg)');
    check(!m.has(`${PHOTOG}/stale_default.jpg`), 'copied file with staging absence (Default) removed its prior archive record');
    check(!m.has(`${PHOTOG}/a_default.jpg`), 'Default copied file gets no record');
    // real metadata + Audit on the ARCHIVE side, keys as the sync wrote them
    const { rows } = await auditRows(win, archiveEv);
    const byName = Object.fromEntries(rows.map(r => [path.basename(r.filePath), r]));
    for (const n of ['a_default.jpg', 'b_subset.jpg', 'c_none.jpg', 'clash_1.jpg', 'stale_default.jpg'])
      check(byName[n] && byName[n].status === 'complete', `archive Audit after sync: ${n} is complete${byName[n] && byName[n].status !== 'complete' ? ' — ' + byName[n].status + J(byName[n].keywords?.missing) + J(byName[n].keywords?.unexpected) : ''}`);
  });
  function isEmptyRec(b) { return !!b && b.eventTypes.length === 0 && b.additionalKeywords.length === 0; }

  // ═══ 9. crash / restart / resume (real SIGKILL, real relaunch on the same userData) ══════════
  async function crashRun(label, N, mutateBeforeRelaunch) {
    const cud = await mk('intent-crash-ud-'), croot = await mk('intent-crash-root-');
    let c = await launch(cud, label); await api(c.win, 'setMainArchiveRoot', croot);
    const kindOf = i => ['A', 'B', 'C'][i % 3]; const exp = { A: ['Ziyarat', 'Quran Tilawat', ...ctxA], B: ['Ziyarat', ...ctxA], C: [...ctxA] };
    const evDir = path.join(croot, 'CollCrash', `1448-01-01 _01-${label}`);
    await api(c.win, 'writeEventJson', evDir, { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: label, components: [COMP_EV] });
    const src = await mk('fx-src-crash-'); const files = [];
    for (let i = 0; i < N; i++) { const name = `X${String(i).padStart(3, '0')}_${kindOf(i)}.cr2`; const s = path.join(src, name); await writeRaw(s, i); files.push({ kind: kindOf(i), name, src: s, dest: path.join(evDir, PHOTOG, name) }); }
    const ov = { B: SUB, C: EMPTY }; const fr = {}; for (const f of files) if (ov[f.kind]) fr[f.src] = ov[f.kind];
    const res = await c.win.evaluate(({ jobs, evDir, ctx }) => window.api.commitImportTransaction(jobs, evDir, ctx),
      { jobs: files.map(f => ({ src: f.src, dest: f.dest })), evDir, ctx: { groups: [{ id: 0, subEventId: null, files: files.map(f => f.src), fileTagRefinements: fr }], photographer: PHOTOG, liveComps: null, subEventNames: null, collName: 'CollCrash', source: 'live', importedBy: 'live' } });
    const batchId = res.metadataBatchId; const jpath = path.join(queueDir(cud), batchId + '.journal.jsonl');
    let completes = 0; for (let t = 0; t < 600 && completes < 50; t++) { try { completes = (await fsp.readFile(jpath, 'utf8')).split('\n').filter(l => l.includes('"complete"')).length; } catch { completes = 0; } await sleep(25); }
    process.kill(c.app.process().pid, 'SIGKILL'); await sleep(2500);
    await fsp.rm(src, { recursive: true, force: true });                                                           // card gone before the app even restarts
    const journal = (await fsp.readFile(jpath, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    const st0 = new Map(); for (const j of journal) st0.set(j.dest, j.status);
    const interrupted = files.filter(f => st0.get(f.dest) !== 'complete');
    check(interrupted.length > 10 && ['A', 'B', 'C'].every(k => interrupted.some(f => f.kind === k)), `${label}: a REAL interruption left ${interrupted.length}/${N} files unfinished across A/B/C (killed after ${completes} complete)`);
    if (mutateBeforeRelaunch) await mutateBeforeRelaunch(evDir);
    c = await launch(cud, label + '-restart');                                                                     // the app's own startup recovery runs
    await poll(async () => !fs.existsSync(path.join(queueDir(cud), batchId + '.manifest.json')), 90000); await sleep(2000);
    const cj = path.join(queueDir(cud), 'compacted', batchId + '.journal.jsonl');
    const after = fs.existsSync(cj) ? (await fsp.readFile(cj, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const last = f => [...after].reverse().find(j => j.dest === f.dest)?.status;
    const out = { files, interrupted, last, exp, evDir, cud, close: async () => { await c.app.close().catch(() => {}); } };
    return out;
  }
  await section('crash', 'real crash → restart → resume: unchanged refined intent is accepted', async () => {
    const c = await crashRun('CR1', 300);
    const byKind = k => c.interrupted.filter(f => f.kind === k);
    const staleRefined = c.interrupted.filter(f => f.kind !== 'A' && c.last(f) === 'stale');
    check(staleRefined.length === 0, `B/C are NOT stale merely for being refined / explicit None (0 of ${byKind('B').length + byKind('C').length} stale)`);
    check(c.interrupted.every(f => c.last(f) === 'complete'), 'every interrupted file completed on resume');
    const wrong = []; for (const f of c.interrupted) { const k = await readKw(f.dest); if (!same(k.subject, c.exp[f.kind])) wrong.push(f.name + J(k.subject)); }
    check(wrong.length === 0, `resumed metadata is exactly the operator's intent for all ${c.interrupted.length} interrupted files (A default / B subset / C none)${wrong.length ? ' — ' + wrong.slice(0, 3).join(' ') : ''}`);
    const ev = await readJson(path.join(c.evDir, 'event.json'));
    check(ev.metadataState && ev.metadataState.counts && ev.metadataState.counts.stale === 0, `event metadataState reports 0 stale (${J(ev.metadataState && ev.metadataState.counts)})`);
    await c.close();
  });
  await section('crashchange', 'real crash → genuine intent change before restart → correctly detected as STALE', async () => {
    const c = await crashRun('CR2', 240, async evDir => {                                          // operator changes their mind while the app is down
      const ej = await readJson(path.join(evDir, 'event.json'));
      const bRel = new Set(ej.tagRefinements.filter(b => b.eventTypes.length).flatMap(b => b.relPaths));
      ej.tagRefinements = [{ eventTypes: [], additionalKeywords: [], relPaths: [...bRel] }];       // every B → explicit None; every C record REMOVED (back to Default)
      await fsp.writeFile(path.join(evDir, 'event.json'), JSON.stringify(ej, null, 2));
    });
    const stale = k => c.interrupted.filter(f => f.kind === k && c.last(f) === 'stale').length;
    const total = k => c.interrupted.filter(f => f.kind === k).length;
    check(stale('B') === total('B') && total('B') > 0, `genuinely changed B intent is detected stale (${stale('B')}/${total('B')})`);
    check(stale('C') === total('C') && total('C') > 0, `genuinely changed C intent is detected stale (${stale('C')}/${total('C')})`);
    check(stale('A') === 0 && c.interrupted.filter(f => f.kind === 'A').every(f => c.last(f) === 'complete'), 'unchanged Default files still resume normally (0 stale)');
    const wrote = []; for (const f of c.interrupted.filter(f => f.kind !== 'A')) if ((await readKw(f.dest)).exists) wrote.push(f.name);
    check(wrote.length <= 3, `stale files are NOT written (${wrote.length} pre-crash writes at most)`);
    await c.close();
  });

  check(pageErrors.length === 0, `no renderer page errors (${J(pageErrors)})`);
  await et.end().catch(() => {});
  await app.close().catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('[intent-live] FATAL', e.stack || e.message); process.exit(1); });
