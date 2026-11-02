'use strict';

// AI-FEAT-061 Q3 — LOCAL, read-only verification of camera identification on REAL camera
// media (an inserted card, bounded archive folders). Not a CI test: real media cannot be
// committed (serial numbers). With no folder arguments it exits as skipped.
//
// For each folder it runs the real Q3 pipeline (fileBrowser discovery, shared ExifTool pool,
// exifr, cardAssessmentService, cameraAssessmentModel) and prints names, counts and checks
// only — never an identifier value. It also proves the folder is unchanged afterwards.
//
// Run: node test/companionQ3RealMedia.local.js <folder> [<folder> …]

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { scanMediaRecursive } = require('../main/fileBrowser');
const { readCaptureMetadata, readIdentityTags } = require('../services/captureDateReader');
const { createCardAssessor } = require('../services/cardAssessmentService');
const { summarizeCameras } = require('../services/cameraAssessmentModel');
const exifService = require('../main/exifService');

const roots = process.argv.slice(2);
if (!roots.length) { console.log('companionQ3RealMedia: skipped (no media folders given)'); process.exit(0); }

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok' : 'FAIL'} — ${msg}`); if (!ok) failures++; };

async function snapshot(dir) {
  const out = {};
  async function walk(d) {
    let es; try { es = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!e.name.startsWith('.')) await walk(p); } else { const st = await fsp.stat(p); out[p] = `${st.size}:${st.mtimeMs}`; } }
  }
  await walk(dir);
  return out;
}

async function assess(root) {
  const a = createCardAssessor({
    listMedia: scanMediaRecursive, readTags: readCaptureMetadata, readIdentity: readIdentityTags,
    statMount: async (mp) => { try { const st = await fsp.stat(mp); return { dev: st.dev, ino: st.ino }; } catch { return null; } },
  });
  a.sync([{ sourceId: 'src-1', mountpoint: root, label: 'real' }]);
  while (!['complete', 'error'].includes(a.get('src-1').state)) await new Promise(r => setTimeout(r, 50));
  const job = a.get('src-1');
  const diag = a.getDiagnostics();
  a.shutdown();
  return { job, identityReads: diag.identityReads, ms: job.finishedAt - job.startedAt };
}

(async () => {
  const secret = crypto.randomBytes(16);
  for (const root of roots) {
    console.log(`\n# ${path.basename(root)}`);
    const before = await snapshot(root);
    const { job, identityReads, ms } = await assess(root);
    if (job.state !== 'complete') { check(false, `assessment ${job.state}`); continue; }
    const recs = job.records;
    const res = job.cameras;
    const sum = summarizeCameras(recs, res, (ref) => crypto.createHmac('sha256', secret).update(ref).digest('hex').slice(0, 12));
    console.log(`  ${recs.length} files in ${ms} ms, ${identityReads} maker-note follow-up reads`);
    for (const c of sum.cameras) {
      console.log(`  · ${c.display}${c.bodyLabel ? ` (Body ${c.bodyLabel})` : ''} — ${c.files} files ${JSON.stringify(c.counts)} — ${c.status}${c.inheritedFiles ? `, ${c.inheritedFiles} inherited from RAW/JPEG pair` : ''}`);
    }
    console.log(`  · unknown ${sum.unknownFiles} · conflicting ${sum.conflictFiles}`);

    // Every file counted once.
    check(sum.cameras.reduce((n, c) => n + c.files, 0) + sum.unknownFiles + sum.conflictFiles === recs.length, 'every file counted exactly once');

    // Canon: EXIF body serial and Canon internal serial are different values on every file carrying both.
    const canonBoth = res.identities.filter(x => x.make?.name === 'Canon' && x.identifiers.some(i => i.ns === 'exif.bodySerial') && x.identifiers.some(i => i.ns === 'canon.internal'));
    if (canonBoth.length) check(canonBoth.every(x => x.identifiers.find(i => i.ns === 'exif.bodySerial').value !== x.identifiers.find(i => i.ns === 'canon.internal').value),
      `Canon namespaces distinct on all ${canonBoth.length} files carrying both identifiers`);

    // Each body group: one value per trusted namespace (e.g. Sony internal serial stable across the body's files).
    for (const g of res.groups.filter(x => x.kind === 'body')) {
      const perNs = new Map();
      for (const n of g.nodes) { const ns = n.split('|')[0]; perNs.set(ns, (perNs.get(ns) || 0) + 1); }
      const label = sum.cameras.find(c => c.files === g.files.length && c.status === 'body-identified');
      check([...perNs.values()].every(v => v === 1), `${label ? label.display + (label.bodyLabel ? ' ' + label.bodyLabel : '') : 'body'}: one value per namespace (${[...perNs.keys()].join(', ')}) across ${g.files.length} files`);
    }

    // Same-model bodies are distinguished, never merged.
    const models = new Map();
    for (const c of sum.cameras.filter(x => x.status === 'body-identified')) models.set(c.display, (models.get(c.display) || 0) + 1);
    for (const [m, n] of models) if (n > 1) console.log(`  · ${m}: ${n} distinct bodies of one model`);

    // Nikon: maker-note serial and Adobe-copied EXIF/XMP serial resolved as one namespace.
    const nikonPairs = res.identities.filter((x, i) => x.make?.name === 'Nikon' && recs[i].pairKey);
    if (nikonPairs.length) check(nikonPairs.every(x => x.identifiers.every(i => i.ns === 'nikon.serial')), `Nikon pair members use the single nikon.serial namespace (${nikonPairs.length} files)`);

    // RAW/JPEG pairs: inherited where reliable and consistent; disagreements are conflicts.
    const pairs = recs.filter(r => r.pairKey).length;
    if (pairs) console.log(`  · ${pairs} files in RAW/JPEG pairs; ${res.identities.filter(x => x.inherited).length} inherited identity; ${res.identities.filter(x => x.conflict === 'pair-identity-mismatch').length} in disagreeing pairs`);

    // Privacy and safety.
    const values = new Set(res.identities.flatMap(x => x.identifiers.map(i => i.value)));
    const json = JSON.stringify(sum);
    check(![...values].some(v => json.includes(v)), `no identifier value in the popup summary (${values.size} identifiers checked)`);
    const after = await snapshot(root);
    check(JSON.stringify(after) === JSON.stringify(before), `source unchanged (${Object.keys(before).length} files)`);
  }
  await exifService.shutdown();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
