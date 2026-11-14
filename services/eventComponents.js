/**
 * eventComponents.js — event.json components in the shape the import transaction expects
 * (AI-FEAT-064 EQI-2.1). Pure.
 *
 * The same normalization EventCreator's loadEventFromDisk() applies in the main window
 * (renderer/eventCreator.js), so a companion import passes the transaction exactly the
 * `liveComps` a main-window import would: types → eventTypes [{label}], location/city → {label},
 * additionalKeywords → {label, keywordId, useInFolderName, folderPlacement}.
 */

'use strict';

/**
 * @param {unknown} json  parsed event.json (or the IPC-wrapped { data } shape)
 * @returns {object[]|null} UI-format components, or null when event.json has none
 */
function componentsFromEventJson(json) {
  let doc = json;
  if (doc && typeof doc === 'object' && 'data' in doc && !Array.isArray(doc.components)) doc = doc.data;
  if (!doc || !Array.isArray(doc.components) || doc.components.length === 0) return null;
  return doc.components.map((c, i) => ({
    id:         typeof c.id === 'number' ? c.id : (i + 1),
    eventTypes: Array.isArray(c.types) ? c.types.map(t => ({ label: t })) : [],
    location:   c.location ? { label: c.location } : null,
    city:       c.city    ? { label: c.city }    : null,
    country:    c.country || '',
    folderName: c.folderName ?? null,
    additionalKeywords: Array.isArray(c.additionalKeywords)
      ? c.additionalKeywords.map(kw =>
          typeof kw === 'string'
            ? { label: kw, keywordId: null, useInFolderName: false }
            : { label: kw.label || '', keywordId: kw.keywordId || null, useInFolderName: !!kw.useInFolderName, folderPlacement: kw.folderPlacement || null })
      : [],
  }));
}

/** Display labels for the companion (event types; "location, city" places). Names only. */
function labelsOf(components) {
  const types = [], places = [];
  const add = (arr, v) => { if (typeof v === 'string' && v.trim() && !arr.includes(v.trim())) arr.push(v.trim()); };
  for (const c of components || []) {
    for (const t of c.eventTypes || []) add(types, t && t.label);
    add(places, [c.location && c.location.label, c.city && c.city.label].filter(Boolean).join(', '));
  }
  return { types, places };
}

module.exports = { componentsFromEventJson, labelsOf };
