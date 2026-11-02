/**
 * cameraAssessmentModel.js — groups a card's files by camera (AI-FEAT-061 Q3).
 * Pure: no Electron, no filesystem, no clock.
 *
 * A record is { path, name, type, pairKey, evidence, identity } where identity comes from
 * cameraIdentityEvidence.fileIdentity() and pairKey/evidence from the Q2 date model.
 *
 * Rules:
 *  - Body identity needs a trusted identifier plus make/model. Identifiers are only
 *    compared within their namespace. Several trusted identifiers seen together on one
 *    camera-original (not editor-rewritten) file belong to one body, so a file carrying
 *    only one of them (e.g. an export that lost its maker notes) still joins that body.
 *  - An identifier seen with two different models is a conflict: those files are counted
 *    as conflicting, never assigned. An edited file whose identifiers no camera-original
 *    file links is unconfirmed: it stays "body not identified".
 *  - RAW/JPEG pair (Q2 pairing: same folder + stem, dates agree) members may inherit the
 *    other member's make/model and identifiers when nothing disagrees — recorded as
 *    derived ("inherited") evidence. Disagreeing members are a conflict.
 *  - Files with make/model but no body identifier stay a separate "body not identified"
 *    group per model; they are never merged into an identified body of that model.
 *  - Files without make/model are "unknown camera".
 * The summary for the popup carries names, counts and opaque keys — never identifiers.
 */

'use strict';

/** Union-find over identifier nodes ("ns|value"). */
function _dsu() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union };
}

const _node = (x) => `${x.ns}|${x.value}`;
const _modelId = (idn) => `${idn.make.name}|${idn.model.key}`;

/** RAW/JPEG pair inheritance; returns new identities by record index. */
function _inheritWithinPairs(records, identities) {
  const out = identities.map(x => ({ ...x, inherited: false }));
  const pairs = new Map();
  records.forEach((r, i) => {
    if (!r.pairKey || r.evidence?.reason === 'pair-inconsistent') return; // only reliable Q2 pairs
    if (!pairs.has(r.pairKey)) pairs.set(r.pairKey, []);
    pairs.get(r.pairKey).push(i);
  });
  for (const members of pairs.values()) {
    if (members.length < 2) continue;
    const ids = members.map(i => out[i]);
    const models = new Set(ids.filter(x => x.model).map(_modelId));
    const trusted = new Map();
    let clash = models.size > 1 || ids.some(x => x.conflict);
    for (const x of ids) for (const t of x.identifiers.filter(y => y.trusted)) {
      if (trusted.has(t.ns) && trusted.get(t.ns).value !== t.value) clash = true;
      if (!trusted.has(t.ns)) trusted.set(t.ns, t);
    }
    if (clash) { for (const i of members) out[i] = { ...out[i], conflict: out[i].conflict || 'pair-identity-mismatch' }; continue; }
    const donor = ids.find(x => x.model) || null;
    for (const i of members) {
      const x = out[i];
      const missing = [...trusted.values()].filter(t => !x.identifiers.some(y => y.ns === t.ns));
      const needsModel = !x.model && donor;
      if (!missing.length && !needsModel) continue;
      out[i] = {
        ...x,
        make: x.make || donor.make, model: x.model || donor.model,
        identifiers: [...x.identifiers, ...missing.map(t => ({ ...t, inherited: true }))],
        level: (x.model || donor) && (x.identifiers.some(y => y.trusted) || missing.length) ? 'body' : (x.model || donor ? 'model' : 'unknown'),
        inherited: true,
      };
    }
  }
  return out;
}

/**
 * @param {Array<object>} records
 * @returns {{ groups: Array<object>, unknown: number[], conflicts: number[], identities: object[] }}
 *   groups[].files are record indexes; body groups keep their identifier nodes (main only).
 */
function assessCameras(records) {
  const identities = _inheritWithinPairs(records, records.map(r => r.identity));
  const dsu = _dsu();
  const nodeModels = new Map(); // node -> Set(modelId)
  identities.forEach((idn) => {
    if (idn.level !== 'body' || idn.conflict) return;
    const nodes = idn.identifiers.filter(x => x.trusted).map(_node);
    for (const n of nodes) {
      if (!nodeModels.has(n)) nodeModels.set(n, new Set());
      nodeModels.get(n).add(_modelId(idn));
    }
    // Co-observed identifiers belong to one body — only on camera-original files.
    if (!idn.edited && !idn.inherited) for (let k = 1; k < nodes.length; k++) dsu.union(nodes[0], nodes[k]);
  });
  const badNodes = new Set([...nodeModels].filter(([, m]) => m.size > 1).map(([n]) => n));

  const groups = new Map();
  const unknown = [], conflicts = [];
  identities.forEach((idn, i) => {
    if (idn.conflict) { conflicts.push(i); return; }
    if (idn.level === 'unknown') { unknown.push(i); return; }
    if (idn.level === 'model') {
      const key = `model|${_modelId(idn)}`;
      if (!groups.has(key)) groups.set(key, { kind: 'model', modelId: _modelId(idn), files: [], nodes: new Set() });
      groups.get(key).files.push(i);
      return;
    }
    const nodes = idn.identifiers.filter(x => x.trusted).map(_node);
    if (nodes.some(n => badNodes.has(n))) { conflicts.push(i); return; }
    const roots = new Set(nodes.map(n => dsu.find(n)));
    if (roots.size > 1) {
      // Identifiers no camera-original file links. On an editor-rewritten file that is
      // unconfirmed, not contradictory: the body stays unidentified. On an original it
      // cannot happen (its identifiers were linked above).
      const key = `model|${_modelId(idn)}`;
      if (!groups.has(key)) groups.set(key, { kind: 'model', modelId: _modelId(idn), files: [], nodes: new Set() });
      groups.get(key).files.push(i);
      return;
    }
    const key = `body|${_modelId(idn)}|${[...roots][0]}`;
    if (!groups.has(key)) groups.set(key, { kind: 'body', modelId: _modelId(idn), files: [], nodes: new Set() });
    const g = groups.get(key);
    g.files.push(i);
    nodes.forEach(n => g.nodes.add(n));
  });
  return { groups: [...groups.values()], unknown, conflicts, identities };
}

function _counts(records, files) {
  const c = { photo: 0, raw: 0, video: 0 };
  for (const i of files) c[records[i].type] = (c[records[i].type] || 0) + 1;
  return c;
}

/**
 * Path- and identifier-free summary for the popup.
 * @param {Array<object>} records
 * @param {ReturnType<typeof assessCameras>} result
 * @param {(ref: string) => string} keyFor  opaque key for a group reference (session-scoped)
 */
function summarizeCameras(records, result, keyFor) {
  const { groups, unknown, conflicts, identities } = result;
  const byModel = new Map();
  for (const g of groups) if (g.kind === 'body') byModel.set(g.modelId, (byModel.get(g.modelId) || 0) + 1);
  // Order: models by total files; within a model, identified bodies by size (A = largest),
  // then that model's unidentified files; ties by name, then earliest capture.
  const firstCapture = (g) => g.files.map(i => records[i].evidence?.date && `${records[i].evidence.date} ${records[i].evidence.time}`).filter(Boolean).sort()[0] || '';
  const modelTotal = new Map();
  for (const g of groups) modelTotal.set(g.modelId, (modelTotal.get(g.modelId) || 0) + g.files.length);
  const sorted = [...groups].sort((a, b) =>
    modelTotal.get(b.modelId) - modelTotal.get(a.modelId) || a.modelId.localeCompare(b.modelId) ||
    (a.kind === b.kind ? 0 : a.kind === 'body' ? -1 : 1) ||
    b.files.length - a.files.length || firstCapture(a).localeCompare(firstCapture(b)));
  const labelNext = new Map();
  const cameras = sorted.map((g) => {
    const idns = g.files.map(i => identities[i]);
    // Prefer a maker-model display name (e.g. Canon "EOS R6 Mark II" over "EOS R6m2").
    const display = idns.map(x => x.model.display).sort((a, b) => b.length - a.length)[0];
    let bodyLabel = null;
    if (g.kind === 'body' && byModel.get(g.modelId) > 1) {
      const n = labelNext.get(g.modelId) || 0;
      labelNext.set(g.modelId, n + 1);
      bodyLabel = String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : '');
    }
    const ref = g.kind === 'body' ? `body|${g.modelId}|${[...g.nodes].sort().join(',')}` : `model|${g.modelId}`;
    return {
      key: keyFor(ref),
      make: idns[0].make.name,
      display,
      status: g.kind === 'body' ? 'body-identified' : 'body-not-identified',
      bodyLabel,
      files: g.files.length,
      counts: _counts(records, g.files),
      inheritedFiles: g.files.filter(i => identities[i].inherited).length,
    };
  });
  return {
    cameras,
    unknownFiles: unknown.length,
    conflictFiles: conflicts.length,
    totalFiles: records.length,
  };
}

module.exports = { assessCameras, summarizeCameras };
