'use strict';

// Ask AutoIngest Phase A.2 — opaque source handles (Track 2.A, Product Owner
// directive: "The model should generate semantic content. The application
// should attach technical IDs after generation wherever deterministic
// attachment is possible.").
//
// Structural fix, not a prompt instruction: the model's entire input never
// contains a raw AI-FEAT-*/AI-WF-*/DEC-*/BUG-*/PM-*/AI-MEM-* identifier
// anywhere. Every legitimate source is assigned a short opaque handle
// ("S1".."SN") before the prompt is built; the JSON-schema-constrained
// grammar's sourceIds enums are restricted to exactly that handle set, so a
// fabricated reference is impossible at the DECODING level, not merely
// discouraged at the prompt level. The application resolves handles back to
// real IDs/paths after generation -- the model never needs to know or
// reproduce the real ID at all.

function assignHandles(evidencePackage) {
  const ids = evidencePackage.legitimateSourceIds || [];
  const handleById = new Map();
  const idByHandle = new Map();
  const displayNameByHandle = new Map();
  ids.forEach((id, i) => {
    const handle = `S${i + 1}`;
    handleById.set(id, handle);
    idByHandle.set(handle, id);
    // best-effort display name lookup across every field shape the evidence
    // package already exposes -- never re-derives from ctx, this module has
    // no engine access and must not gain any
    let displayName = id;
    if (evidencePackage.primary && evidencePackage.primary.id === id) displayName = evidencePackage.primary.displayName;
    const src = (evidencePackage.sources || []).find((s) => s.id === id);
    if (src) displayName = src.displayName;
    const rel = (evidencePackage.relatedCapabilities || []).find((r) => r.id === id);
    if (rel) displayName = rel.displayName;
    const nb = [...(evidencePackage.admittedNeighborhood || []), ...(evidencePackage.visibleNotAdmitted || [])].find((m) => m.id === id);
    if (nb) displayName = nb.displayName;
    const hist = [...(evidencePackage.historical.admitted || []), ...(evidencePackage.historical.notAdmitted || [])].find((h) => h.id === id);
    if (hist) displayName = hist.displayName;
    displayNameByHandle.set(handle, displayName);
  });
  return { handleById, idByHandle, displayNameByHandle, validHandles: Array.from(idByHandle.keys()) };
}

function idFor(handleMap, handle) {
  return handleMap.idByHandle.get(handle) || null;
}

module.exports = { assignHandles, idFor };
