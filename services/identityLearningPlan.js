/**
 * identityLearningPlan.js — what one committed import teaches the registry (AI-FEAT-063,
 * AI-RM-014 Q4a). Pure: returns event descriptors ({type, payload}); it writes nothing.
 * Q4c will call it after a successful import commit; Q4a only defines and tests it.
 *
 * Inputs are deliberately narrow: protected cameras (cameraDeviceIdentity.protectCameraGroups),
 * the derived registry state, the photographer's ID, an import ID and the day. Names, file
 * names, card labels, lens serials and Artist values are not accepted, so they can never
 * become association evidence.
 *
 * Rules:
 *  - Choosing a photographer for an import is an OBSERVATION, never a camera confirmation.
 *  - Exactly one camera in the import, identified as a body → `import-observed`.
 *  - Exactly one camera, model-only → `model-observed` (a weak hint, never a device).
 *  - Two or more cameras, or any conflicting files alongside a body → one `import-cooccurred`
 *    listing them; no camera gets an association from it.
 *  - Model-only files of the SAME model as an identified body in the import are ambiguous
 *    (e.g. Canon video with an all-zero serial): they are not counted as another camera,
 *    and they do not strengthen anything.
 *  - Unknown-camera files carry no evidence and are ignored.
 *  - New bodies are registered as devices; identifiers co-observed with a known body are
 *    added to it. Conflicting bodies register nothing.
 */

'use strict';

const crypto = require('crypto');
const { matchCamera, eventIdentifiers } = require('./cameraDeviceIdentity');
const { isUuid } = require('./photographerIdentity');

/**
 * @param {{ cameras: object[], unknownFiles: number, conflictFiles: number }} protectedCard
 * @param {ReturnType<import('./associationModel').deriveRegistryState>} state
 * @param {{ photographerId: string, importId: string, day: string, newDeviceId?: () => string }} ctx
 * @returns {{ events: Array<{type: string, payload: object}>, outcomes: object[], observation: 'single-body'|'single-model'|'multiple-cameras'|'none' }}
 */
function planImportLearning(protectedCard, state, { photographerId, importId, day, newDeviceId = crypto.randomUUID } = {}) {
  if (!isUuid(photographerId)) throw new Error('photographerId must be a UUID');
  if (typeof importId !== 'string' || !importId) throw new Error('importId required');
  const cameras = protectedCard.cameras || [];
  const events = [];
  const outcomes = [];

  const bodies = [];
  for (const cam of cameras.filter(c => c.kind === 'body')) {
    const m = matchCamera(cam, state);
    if (m.status === 'new') {
      const deviceId = newDeviceId();
      events.push({ type: 'device-registered', payload: { deviceId, make: cam.make, modelKey: cam.modelKey, modelDisplay: cam.modelDisplay, identifiers: eventIdentifiers(cam) } });
      bodies.push({ cam, deviceId, status: 'new' });
    } else if (m.status === 'known') {
      if (m.newIdentifiers.length) events.push({ type: 'device-identifiers-added', payload: { deviceId: m.deviceId, identifiers: m.newIdentifiers, basis: 'co-observed' } });
      bodies.push({ cam, deviceId: m.deviceId, status: 'known' });
    } else {
      bodies.push({ cam, deviceId: null, status: 'conflict', reason: m.reason });
    }
  }
  const bodyModels = new Set(bodies.map(b => `${b.cam.make}|${b.cam.modelKey}`));
  const models = cameras.filter(c => c.kind === 'model');
  const countedModels = models.filter(c => !bodyModels.has(`${c.make}|${c.modelKey}`));
  const ambiguousModels = models.filter(c => bodyModels.has(`${c.make}|${c.modelKey}`));

  for (const b of bodies) outcomes.push({ kind: 'body', status: b.status, deviceId: b.deviceId, reason: b.reason || null, fileCount: b.cam.fileCount });
  for (const c of countedModels) outcomes.push({ kind: 'model', status: 'model-only', make: c.make, modelKey: c.modelKey, fileCount: c.fileCount });
  for (const c of ambiguousModels) outcomes.push({ kind: 'model', status: 'ambiguous-same-model', make: c.make, modelKey: c.modelKey, fileCount: c.fileCount });

  const cameraCount = bodies.length + countedModels.length;
  const conflictFiles = protectedCard.conflictFiles || 0;
  let observation = 'none';
  if (cameraCount === 1 && bodies.length === 1 && bodies[0].deviceId && conflictFiles === 0) {
    events.push({ type: 'import-observed', payload: { importId, photographerId, deviceId: bodies[0].deviceId, fileCount: bodies[0].cam.fileCount, day } });
    observation = 'single-body';
  } else if (cameraCount === 1 && countedModels.length === 1 && conflictFiles === 0) {
    const c = countedModels[0];
    events.push({ type: 'model-observed', payload: { importId, photographerId, make: c.make, modelKey: c.modelKey, fileCount: c.fileCount, day } });
    observation = 'single-model';
  } else if (cameraCount >= 2 || (cameraCount === 1 && conflictFiles > 0)) {
    const listed = [
      ...bodies.map(b => (b.deviceId ? { deviceId: b.deviceId, fileCount: b.cam.fileCount } : { make: b.cam.make, modelKey: b.cam.modelKey, fileCount: b.cam.fileCount })),
      ...countedModels.map(c => ({ make: c.make, modelKey: c.modelKey, fileCount: c.fileCount })),
    ];
    events.push({ type: 'import-cooccurred', payload: { importId, photographerId, cameras: listed, conflictFiles, day } });
    observation = 'multiple-cameras';
  }
  return { events, outcomes, observation };
}

module.exports = { planImportLearning };
