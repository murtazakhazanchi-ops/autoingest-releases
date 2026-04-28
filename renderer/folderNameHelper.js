// Pure helpers for stable component folder naming.
// No DOM, no IPC — safe to import in tests and in the renderer IIFE.

const UNSAFE_CHARS = /[/\\:*?"<>|]/g;

function sanitizeForFolder(name) {
  if (!name) return '';
  return name
    .replace(UNSAFE_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Derive a component subfolder name from a UI-format component.
 * The result is deterministic for a given (comp, idx, allSameCity) triple.
 * City is included only when allSameCity is false (components have mixed cities).
 *
 * @param {{ eventTypes: {label:string}[], city: {label:string}|null, location: {label:string}|null }} comp
 * @param {number} idx  0-based position in the sorted-by-id component list
 * @param {boolean} allSameCity
 * @returns {string}
 */
export function buildFolderName(comp, idx, allSameCity = false) {
  const indexPart    = String(idx + 1).padStart(2, '0');
  const typePart     = sanitizeForFolder(
    (comp.eventTypes || []).map(t => t.label).join('-')
  );
  const locationPart = comp.location?.label
    ? '-' + sanitizeForFolder(comp.location.label)
    : '';
  const cityPart     = (!allSameCity && comp.city?.label)
    ? '-' + sanitizeForFolder(comp.city.label)
    : '';
  return `${indexPart}-${typePart}${locationPart}${cityPart}`;
}

/**
 * Ensure a disk-format component has a folderName.
 * If one is already present it is NEVER overwritten — the existing name is canonical.
 * Returns a new object (does not mutate the original).
 *
 * @param {{ types:string[], city:string, location:string|null, isUnresolved:boolean, folderName?:string }} diskComp
 * @param {number} idx  0-based position in the sorted-by-id component list
 * @param {boolean} allSameCity
 * @returns {typeof diskComp & { folderName: string }}
 */
export function ensureFolderName(diskComp, idx, allSameCity = false) {
  if (diskComp.folderName != null) return diskComp;
  const fakeUIComp = {
    eventTypes: (diskComp.types || []).map(t => ({ label: t })),
    location:   diskComp.location ? { label: diskComp.location } : null,
    city:       diskComp.city     ? { label: diskComp.city }     : null,
  };
  return { ...diskComp, folderName: buildFolderName(fakeUIComp, idx, allSameCity) };
}
