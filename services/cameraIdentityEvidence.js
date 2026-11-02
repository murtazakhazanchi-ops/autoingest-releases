/**
 * cameraIdentityEvidence.js — what one file's metadata says about the camera that made
 * it (AI-FEAT-061 Q3). Pure: no Electron, no filesystem.
 *
 * Input: grouped identity tags ("IFD0:Make", "Sony:InternalSerialNumber", …) from
 * captureDateReader. Output: make/model with the tag that supplied each, the body
 * identifiers found, and a level:
 *   body    — make + model + at least one TRUSTED body identifier
 *   model   — make + model, no trusted body identifier
 *   unknown — no usable model
 *
 * Identifiers are namespaced by their metadata origin and only ever compared within the
 * same namespace. Mappings are measured on real camera files (Q3 discovery, 2026-11):
 *   exif.bodySerial   ExifIFD:SerialNumber (EXIF BodySerialNumber) — Canon originals and
 *                     exports, Canon video, DJI; standard, trusted for any maker
 *   dng.cameraSerial  IFD0:CameraSerialNumber — DNG standard, trusted
 *   canon.internal    Canon:InternalSerialNumber / InternalSerialNumber2 — a DIFFERENT
 *                     value from the EXIF serial; trusted
 *   sony.internal     Sony:InternalSerialNumber — Sony has no EXIF body serial; trusted
 *   nikon.serial      Nikon:SerialNumber, and for Nikon only ExifIFD/XMP-aux SerialNumber
 *                     (Adobe exports copy the same value — measured); trusted
 * Anything else (Fujifilm/Olympus/Panasonic/Pentax maker-note serials, XMP-aux serials of
 * other makers, older Canon maker serials) is recorded but UNVERIFIED: it never makes a
 * body identity on its own, because no real files have confirmed what it means.
 *
 * Never camera identity: lens serials, Artist, Owner, Copyright, card labels, file-name
 * prefixes. They are not read at all.
 */

'use strict';

const MAKE_ALIASES = [
  [/^canon/i, 'Canon'], [/^sony/i, 'Sony'], [/^nikon/i, 'Nikon'], [/^fuji/i, 'Fujifilm'],
  [/^olympus/i, 'Olympus'], [/^om digital/i, 'OM System'], [/^panasonic/i, 'Panasonic'], [/^leica/i, 'Leica'],
  [/^(pentax|ricoh)/i, 'Pentax'], [/^dji/i, 'DJI'], [/^gopro/i, 'GoPro'], [/^apple/i, 'Apple'],
  [/^samsung/i, 'Samsung'], [/^xiaomi/i, 'Xiaomi'], [/^google/i, 'Google'], [/^hasselblad/i, 'Hasselblad'], [/^sigma/i, 'Sigma'],
];
/** Makers whose cameras may keep a body identifier only in maker notes (exifr cannot read those). */
const MAKER_NOTE_MAKES = new Set(['Canon', 'Sony', 'Nikon', 'Fujifilm', 'Olympus', 'OM System', 'Panasonic', 'Leica', 'Pentax', 'Sigma', 'Hasselblad']);
/** Maker-note groups ExifTool uses, for a make when no Make tag exists (e.g. Panasonic camcorder MP4). */
const GROUP_MAKES = { Canon: 'Canon', Sony: 'Sony', Nikon: 'Nikon', FujiFilm: 'Fujifilm', Olympus: 'Olympus', Panasonic: 'Panasonic', Pentax: 'Pentax' };
const MAKE_SOURCES = ['IFD0', 'Keys', 'UserData', 'XMP-tiff', 'ItemList', 'QuickTime'];
const MODEL_SOURCES = ['IFD0', 'Keys', 'UserData', 'XMP-tiff', 'ItemList', 'QuickTime', 'Panasonic', 'Nikon', 'Sony', 'Canon', 'FujiFilm', 'Olympus'];
/** Software that rewrites files (exports/edits): their identifiers are not co-observation evidence. */
const EDITOR_RE = /adobe|photoshop|lightroom|camera raw|capture one|gimp|snapseed|affinity|luminar|darktable|rawtherapee|dxo|on1|pixelmator|picasa|photos\b|windows photo|paint\.net|acdsee|faststone|irfanview/i;
const PLACEHOLDER_RE = /^(0+|unknown|n\/a|none|-+)$/i;

const TRUSTED = new Set(['exif.bodySerial', 'dng.cameraSerial', 'canon.internal', 'sony.internal', 'nikon.serial']);

function normalizeMake(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const [re, name] of MAKE_ALIASES) if (re.test(s)) return name;
  return s.replace(/\s+(corporation|corp\.?|co\.?,? ?ltd\.?|inc\.?|imaging.*)$/i, '').trim();
}

/** Grouping key for a model: case/space/dash-insensitive, maker word removed. */
function modelKey(make, model) {
  let m = String(model || '').toUpperCase();
  if (make) m = m.replace(new RegExp(`^${make.toUpperCase()}\\s+`), '');
  return m.replace(/^(NIKON|CANON|SONY|FUJIFILM|PANASONIC)\s+/, '').replace(/[\s_-]+/g, '');
}

/** Human name: "NIKON D750" → "Nikon D750", "ILCE-7M3" → "Sony ILCE-7M3". */
function displayName(make, model, makerModelId) {
  const m = String(makerModelId || model || '').trim();
  if (!make) return m;
  const stripped = m.replace(new RegExp(`^(${make}|${make.toUpperCase()}|NIKON|CANON|SONY|FUJIFILM)\\s+`, 'i'), '');
  return `${make} ${stripped}`.trim();
}

function _first(id, tag, groups) {
  for (const g of groups) {
    const v = id[`${g}:${tag}`];
    if (v != null && String(v).trim() !== '') return { value: String(v).trim(), sourceTag: `${g}:${tag}` };
  }
  for (const [k, v] of Object.entries(id)) {
    if (k.endsWith(`:${tag}`) && v != null && String(v).trim() !== '') return { value: String(v).trim(), sourceTag: k };
  }
  return null;
}

function _namespace(group, tag, make) {
  if (tag === 'CameraSerialNumber') return 'dng.cameraSerial';
  if (make === 'Nikon' && tag === 'SerialNumber' && ['Nikon', 'ExifIFD', 'XMP-aux'].includes(group)) return 'nikon.serial';
  if (group === 'ExifIFD' && tag === 'SerialNumber') return 'exif.bodySerial';
  if (group === 'Canon' && /^InternalSerialNumber2?$/.test(tag)) return 'canon.internal';
  if (group === 'Sony' && tag === 'InternalSerialNumber') return 'sony.internal';
  if (group === 'XMP-aux' && tag === 'SerialNumber') return 'xmp.auxSerial';
  return `${group.toLowerCase()}.${tag.charAt(0).toLowerCase()}${tag.slice(1)}`;
}

/**
 * @param {Record<string, unknown>|null} id  grouped identity tags
 * @returns {{ level: 'body'|'model'|'unknown',
 *   make: {raw: string, name: string, sourceTag: string}|null,
 *   model: {raw: string, key: string, display: string, sourceTag: string}|null,
 *   identifiers: Array<{ns: string, value: string, sourceTag: string, trusted: boolean}>,
 *   edited: boolean, conflict: string|null }}
 */
function fileIdentity(id) {
  const tags = id && typeof id === 'object' ? id : {};
  let make = null;
  const mk = _first(tags, 'Make', MAKE_SOURCES);
  if (mk) make = { raw: mk.value, name: normalizeMake(mk.value), sourceTag: mk.sourceTag };
  const md = _first(tags, 'Model', MODEL_SOURCES);
  if (!make && md) {
    const g = md.sourceTag.split(':')[0];
    if (GROUP_MAKES[g]) make = { raw: '', name: GROUP_MAKES[g], sourceTag: `${g} (maker-note group)` };
  }
  let model = null;
  if (md) {
    const makerId = _first(tags, 'CanonModelID', ['Canon']) || _first(tags, 'SonyModelID', ['Sony']);
    // A maker model id is a better display name ("EOS R6 Mark II" vs "EOS R6m2") unless it is
    // a list of regional names ("EOS Rebel T6i / 750D / Kiss X8i") — then the EXIF model reads better.
    const usableMakerId = makerId && !/^unknown/i.test(makerId.value) && !makerId.value.includes('/') ? makerId.value : null;
    model = { raw: md.value, key: modelKey(make && make.name, md.value), display: displayName(make && make.name, md.value, usableMakerId), sourceTag: md.sourceTag };
  } else {
    const enc = _first(tags, 'Encoder', ['ItemList', 'Keys', 'UserData', 'QuickTime']);
    // e.g. DJI Osmo Pocket MP4: no Make/Model, only "DJI OsmoPocket3" as encoder.
    if (enc && /^(dji|gopro|insta360)\b/i.test(enc.value)) {
      const encMake = normalizeMake(enc.value.split(/\s+/)[0]);
      make = make || { raw: '', name: encMake, sourceTag: `${enc.sourceTag} (encoder)` };
      model = { raw: enc.value, key: modelKey(encMake, enc.value), display: enc.value, sourceTag: `${enc.sourceTag} (encoder)` };
    }
  }
  const makeName = make && make.name;
  const identifiers = [];
  for (const [key, raw] of Object.entries(tags)) {
    const i = key.indexOf(':');
    const group = key.slice(0, i), tag = key.slice(i + 1);
    if (!/^(SerialNumber|CameraSerialNumber|InternalSerialNumber2?)$/.test(tag)) continue;
    const value = String(raw).trim();
    if (value.length < 3 || PLACEHOLDER_RE.test(value)) continue;
    const ns = _namespace(group, tag, makeName);
    if (!identifiers.some(x => x.ns === ns && x.value === value)) {
      identifiers.push({ ns, value, sourceTag: key, trusted: TRUSTED.has(ns) });
    }
  }
  // Two different values in one trusted namespace on one file: never pick one.
  let conflict = null;
  const seen = new Map();
  for (const x of identifiers) {
    if (!x.trusted) continue;
    if (seen.has(x.ns) && seen.get(x.ns) !== x.value) conflict = 'identifier-mismatch';
    seen.set(x.ns, x.value);
  }
  const software = _first(tags, 'Software', ['IFD0', 'XMP-xmp']);
  const edited = !!(software && EDITOR_RE.test(software.value));
  const hasModel = !!(model && makeName);
  const level = !hasModel ? 'unknown' : identifiers.some(x => x.trusted) ? 'body' : 'model';
  return { level, make, model: hasModel ? model : null, identifiers, edited, conflict };
}

/**
 * Should this photo get an ExifTool maker-note read? Only when exifr was all that ran,
 * no trusted body identifier was found, and the maker is one that keeps identifiers in
 * maker notes (phones etc. never carry one).
 */
function needsMakerNoteRead(identity, makerNotesRead) {
  return !makerNotesRead && identity.level !== 'body' && !!identity.make && MAKER_NOTE_MAKES.has(identity.make.name);
}

module.exports = { fileIdentity, needsMakerNoteRead, normalizeMake, modelKey, displayName, TRUSTED, MAKER_NOTE_MAKES };
