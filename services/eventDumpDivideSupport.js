/**
 * eventDumpDivideSupport.js — main-process helpers for the companion's Divide Photos Between Events
 * (AI-FEAT-064 EQI-2): camera grouping of a card's records, small thumbnails, and the durable plan
 * record. Used by companionService.js only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');
const { summarizeCameras } = require('./cameraAssessmentModel');

/**
 * EQI-2: which camera each record of a card came from — the same opaque per-session keys and the
 * same display labels as the Q3 camera summary (never an identifier). Unknown / conflicting
 * camera information → null (no camera).
 */
function cameraGrouping(job, cameraKey) {
  const labels = new Map();
  const byIndex = new Map();
  if (!job || !job.cameras || !Array.isArray(job.cameras.groups)) return { cameraOf: () => null, labels };
  if (!job.cameraSummary) job.cameraSummary = summarizeCameras(job.records, job.cameras, cameraKey);
  for (const c of job.cameraSummary.cameras) labels.set(c.key, c.bodyLabel ? `${c.display} · Body ${c.bodyLabel}` : c.display);
  for (const g of job.cameras.groups) {
    const ref = g.kind === 'body' ? `body|${g.modelId}|${[...g.nodes].sort().join(',')}` : `model|${g.modelId}`;
    const key = cameraKey(ref);
    for (const i of g.files) byIndex.set(i, key);
  }
  return { cameraOf: (i) => byIndex.get(i) || null, labels };
}

/** EQI-2: a small JPEG data-URL thumbnail (macOS/Windows shell thumbnailer; RAW via its preview). */
async function thumbnail(filePath) {
  let img = null;
  if (typeof nativeImage.createThumbnailFromPath === 'function' && process.platform !== 'linux') {
    try { img = await nativeImage.createThumbnailFromPath(filePath, { width: 176, height: 176 }); } catch { img = null; }
  }
  if (!img || img.isEmpty()) {
    try { img = nativeImage.createFromPath(filePath); } catch { img = null; }
    if (!img || img.isEmpty()) return null;
    img = img.resize({ width: 176, quality: 'good' });
  }
  return `data:image/jpeg;base64,${img.toJPEG(72).toString('base64')}`;
}

/**
 * EQI-2: durable record of each division plan (what was assigned where, and the outcome) in the
 * app's own profile: event folder names, photographer names, file names and sizes — no card path.
 */
function journalWriter(dir, log) {
  return (rec) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${rec.id}.json`);
      let prev = {};
      try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { prev = {}; }
      const next = { ...prev, ...rec, history: [...(prev.history || []), { at: rec.at, state: rec.state }] };
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, file);
      const all = fs.readdirSync(dir).filter(f => /^plan-.*\.json$/.test(f)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 100))) fs.rmSync(path.join(dir, old), { force: true });
    } catch (err) {
      log(`[event-divide] plan record not written: ${err && err.code ? err.code : 'error'}`);
    }
  };
}

module.exports = { cameraGrouping, thumbnail, journalWriter };
