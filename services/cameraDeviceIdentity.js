/**
 * cameraDeviceIdentity.js — persistent camera identity over Q3 evidence (AI-FEAT-063
 * multi-identifier amendment, AI-RM-014 Q4a). Pure: no Electron, no filesystem.
 *
 * Input is Q3's card grouping (cameraAssessmentModel.assessCameras), whose body groups carry
 * raw identifier nodes in main-process memory. protectCameraGroups() is the privacy
 * boundary: it replaces every raw value with keyed digests (identityKeyring.js) and returns
 * nothing else that could identify the body. Everything downstream — matching, events,
 * suggestions, merge plans — sees digests only.
 *
 * Matching rules:
 *  - A body matches a registered device when one of its TRUSTED identifiers has the same
 *    (namespace, keyId, digest) as the device. Namespaces are never compared with each other
 *    (Canon's EXIF serial and internal serial are different numbers on one body).
 *  - The digest covers namespace + make + value, so different makes never match.
 *  - A match whose model differs from the device's model is a conflict, never a match.
 *  - Identifiers that hit two different registered devices are a conflict for the operator
 *    (an explicit device link resolves it); devices are never merged automatically.
 *  - Model-only, unknown and conflicting evidence never produce a device.
 */

'use strict';

/** Split a Q3 node "ns|value" (value may itself contain "|"). */
function _splitNode(node) {
  const i = node.indexOf('|');
  return { ns: node.slice(0, i), value: node.slice(i + 1) };
}

const _identifierKey = (ns, keyId, digest) => `${ns}|${keyId}|${digest}`;

/**
 * @param {Array<object>} records   Q3 card records
 * @param {{groups: object[], unknown: number[], conflicts: number[], identities: object[]}} result  assessCameras(records)
 * @param {ReturnType<import('./identityKeyring').createKeyring>} keyring
 * @returns {{ cameras: Array<object>, unknownFiles: number, conflictFiles: number }}
 *   cameras[]: { kind: 'body'|'model', make, modelKey, modelDisplay, fileCount (captures: a RAW/JPEG pair counts once),
 *                identifiers?: [{ ns, trusted: true, digests: [{keyId, digest}] }] } — no raw values, no paths.
 */
function protectCameraGroups(records, result, keyring) {
  const cameras = result.groups.map((g) => {
    const idns = g.files.map(i => result.identities[i]);
    const make = idns[0].make.name;
    const modelKey = idns[0].model.key;
    const modelDisplay = idns.map(x => x.model.display).sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    // A RAW/JPEG pair is one photograph: count captures, not files.
    const captures = new Set(g.files.map(i => records[i].pairKey || `file:${i}`)).size;
    const camera = { kind: g.kind, make, modelKey, modelDisplay, fileCount: captures };
    if (g.kind === 'body') {
      camera.identifiers = [...g.nodes].sort().map(_splitNode).map(({ ns, value }) => ({ ns, trusted: true, digests: keyring.digestAll(ns, make, value) }));
    }
    return camera;
  });
  return { cameras, unknownFiles: result.unknown.length, conflictFiles: result.conflicts.length };
}

/** All (ns, keyId, digest) keys of a protected camera's trusted identifiers. */
function cameraIdentifierKeys(camera) {
  return (camera.identifiers || []).filter(i => i.trusted).flatMap(i => i.digests.map(d => _identifierKey(i.ns, d.keyId, d.digest)));
}

/**
 * Match one protected camera against the derived registry state (associationModel).
 * @returns {{ status: 'known'|'new'|'model-only'|'conflict', deviceId?: string, deviceIds?: string[], reason?: string, newIdentifiers?: object[] }}
 */
function matchCamera(camera, state) {
  if (camera.kind !== 'body') return { status: 'model-only' };
  const hits = new Set();
  for (const k of cameraIdentifierKeys(camera)) for (const d of state.identifierIndex.get(k) || []) hits.add(d);
  if (hits.size === 0) return { status: 'new' };
  const deviceIds = [...hits].sort();
  if (deviceIds.length > 1) return { status: 'conflict', reason: 'identifier-spans-devices', deviceIds };
  const device = state.devices.get(deviceIds[0]);
  if (device.modelKey !== camera.modelKey || device.make !== camera.make) return { status: 'conflict', reason: 'model-mismatch', deviceIds };
  if (state.conflictedDevices.has(device.deviceId)) return { status: 'conflict', reason: 'device-in-conflict', deviceIds };
  const known = new Set(device.identifiers.map(i => _identifierKey(i.ns, i.keyId, i.digest)));
  const newIdentifiers = (camera.identifiers || []).flatMap(i => i.digests
    .filter(d => !known.has(_identifierKey(i.ns, d.keyId, d.digest)))
    .map(d => ({ ns: i.ns, keyId: d.keyId, digest: d.digest, trusted: i.trusted })));
  return { status: 'known', deviceId: device.deviceId, newIdentifiers };
}

/** Flatten a protected camera's identifiers into event form ({ns, keyId, digest, trusted}). */
function eventIdentifiers(camera) {
  return (camera.identifiers || []).flatMap(i => i.digests.map(d => ({ ns: i.ns, keyId: d.keyId, digest: d.digest, trusted: i.trusted })));
}

module.exports = { protectCameraGroups, matchCamera, cameraIdentifierKeys, eventIdentifiers, identifierKey: _identifierKey };
