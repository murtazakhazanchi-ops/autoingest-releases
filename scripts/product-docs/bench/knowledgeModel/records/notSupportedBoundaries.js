'use strict';

// Candidate C Knowledge Model — NOT_SUPPORTED boundary records. Experimental
// only. Mechanically reshaped from lib/statusResolution.js's KNOWN_BOUNDARIES
// table (Stage 1/Stage 2 hard-override boundaries) into this checkpoint's
// dimensional schema. No new claims are made beyond what that table already
// establishes — the citation field of each source boundary becomes this
// record's provenance, verbatim. extractionTier is 'registry-reshaped'
// because the underlying fact-finding (repository grep/read for each
// boundary) was already done by Stage 1/Stage 2 and is cited unchanged, not
// because it lacks a real citation.

const { STATUS, EXTRACTION_TIERS } = require('../schema');

const RECORDS = [
  {
    id: 'KM-not-supported-face-recognition',
    featureId: null,
    matchKeys: ['face-recognition'], // statusResolution.js KNOWN_BOUNDARIES id(s) this record answers for -- retrieval-only lookup metadata, not part of the core dimensional schema.
    title: 'Face Recognition / Facial Identification',
    aliases: ['face recognition', 'facial recognition', 'face detection', 'recognize faces', 'recognize people'],
    purpose: 'Not applicable — this capability does not exist in AutoIngest.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest has no face-recognition or facial-identification capability.',
    recovery: null,
    relationships: [],
    limitations: ['No face or facial-identification capability exists, planned or implemented.'],
    status: STATUS.NOT_SUPPORTED,
    technicalDetail: null,
    provenance: [
      { claim: 'not-supported boundary', source: 'scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES id=face-recognition', type: 'code', confidence: 'high' },
      { claim: 'not-supported boundary', source: '00_PROJECT_VISION.md (scopes AutoIngest to structured archival ingestion, not photo analysis)', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
  {
    id: 'KM-not-supported-ai-auto-tagging',
    featureId: null,
    matchKeys: ['ai-auto-tagging'],
    title: 'AI Auto-Tagging / Image Recognition',
    aliases: ['auto-tag', 'autotag', 'ai tagging', 'image recognition', 'object detection'],
    purpose: 'Not applicable — this capability does not exist in AutoIngest.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest has no AI-based image recognition or automatic content tagging. AI-FEAT-056 (AI Archive Intelligence) is Planned with no finalized scope; its name must not be read as implying this capability exists or is scoped to include it.',
    recovery: null,
    relationships: [{ type: 'distinctFrom', targetId: 'AI-FEAT-056', note: 'AI-FEAT-056 is Planned, unscoped, and must not be assumed to include auto-tagging.' }],
    limitations: ['No AI-based image recognition or auto-tagging exists, planned or implemented with defined scope.'],
    status: STATUS.NOT_SUPPORTED,
    technicalDetail: null,
    provenance: [
      { claim: 'not-supported boundary', source: 'scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES id=ai-auto-tagging', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
  {
    id: 'KM-not-supported-photo-editing',
    featureId: null,
    matchKeys: ['photo-editing'],
    title: 'Photo Editing / Retouching',
    aliases: ['edit photo', 'retouch', 'photo editing', 'crop photo', 'photo editor'],
    purpose: 'Not applicable — this capability does not exist in AutoIngest.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest does not edit, retouch, or otherwise modify photo content.',
    recovery: null,
    relationships: [],
    limitations: ['No photo editing capability of any kind.'],
    status: STATUS.NOT_SUPPORTED,
    technicalDetail: null,
    provenance: [
      { claim: 'not-supported boundary', source: 'scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES id=photo-editing', type: 'code', confidence: 'high' },
      { claim: 'not-supported boundary', source: '00_PROJECT_VISION.md ("built for structured archival workflows, not general-purpose photo management")', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
  {
    id: 'KM-not-supported-cloud-storage',
    featureId: null,
    matchKeys: ['cloud-storage'],
    title: 'Cloud Backup / Cloud Storage / Cloud Sync',
    aliases: ['cloud backup', 'cloud storage', 'cloud sync', 'upload to cloud', 'client gallery', 'website upload', 'back up to the cloud'],
    purpose: 'Not applicable — this capability does not exist in AutoIngest.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest has no cloud storage, cloud backup, or external website/gallery upload capability. All storage roots (Active Archive Root, Main Archive Root, Transfer Drive, local staging) are local disk or NAS-based.',
    recovery: null,
    relationships: [{ type: 'distinctFrom', targetId: 'KM-transfer-export', note: 'Transfer Export moves data to a local Transfer Drive, not to any cloud destination.' }],
    limitations: ['No fallback to a remote/cloud service when local storage is unavailable.'],
    status: STATUS.NOT_SUPPORTED,
    technicalDetail: null,
    provenance: [
      { claim: 'not-supported boundary', source: 'scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES id=cloud-storage', type: 'code', confidence: 'high' },
      { claim: 'not-supported boundary', source: 'DEC-003 Local-First and On-Premises Architecture', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
  {
    id: 'KM-not-supported-linux',
    featureId: null,
    matchKeys: ['linux'],
    title: 'Linux Support',
    aliases: ['linux', 'ubuntu', 'linux version'],
    purpose: 'Not applicable — this capability does not exist in AutoIngest.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest does not support Linux. It is an Electron-based desktop application for macOS and Windows only.',
    recovery: null,
    relationships: [],
    limitations: ['No Linux build, planned or implemented.'],
    status: STATUS.NOT_SUPPORTED,
    technicalDetail: null,
    provenance: [
      { claim: 'not-supported boundary', source: 'scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES id=linux', type: 'code', confidence: 'high' },
      { claim: 'not-supported boundary', source: '00_PROJECT_VISION.md ("an Electron-based desktop application for macOS and Windows")', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
  {
    id: 'KM-not-supported-multi-user-roles',
    featureId: 'AI-FEAT-002',
    matchKeys: ['multi-user-roles'],
    title: 'Multiple Concurrent User Accounts / Role-Based Access',
    aliases: ['multiple users log in', 'concurrent users', 'user roles', 'role-based access', 'multiple accounts at once', 'different people log in with their own roles'],
    purpose: 'Not applicable as described — AutoIngest tracks a single active operator identity, not concurrent roles or accounts.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest does not support multiple concurrent user accounts or role-based access. Operator profiles are single-active-user.',
    recovery: null,
    relationships: [{ type: 'relatedTo', targetId: 'AI-FEAT-048', note: 'Realtime Team Presence shows multiple operators as online/present simultaneously, which is a different capability from concurrent role-based accounts within one AutoIngest install.' }],
    limitations: ['AutoIngest tracks only one active operator at a time — there is no concurrent multi-account state.'],
    status: STATUS.NOT_SUPPORTED,
    technicalDetail: 'services/settings.js exposes getLastActiveUserId(), which returns a single value, confirming single-active-user state rather than concurrent role-based accounts.',
    provenance: [
      { claim: 'not-supported boundary', source: 'scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES id=multi-user-roles', type: 'code', confidence: 'high' },
      { claim: 'technical detail: single-active-user', source: 'services/settings.js getLastActiveUserId()', type: 'code', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
  {
    id: 'KM-online-registry-boundaries',
    featureId: 'AI-FEAT-048',
    matchKeys: ['registry-media-storage', 'registry-not-source-of-truth', 'registry-conflict-detection', 'registry-activity-scope', 'registry-presence-not-activity'],
    title: 'Online Registry — Presence vs. Activity vs. Conflict Detection Scope',
    aliases: ['online registry', 'presence', 'who else is online', 'conflict warning', 'conflict detection'],
    purpose: 'Lets operators see who else is online and, for Import/Transfer operations, what they are actively doing — a lightweight coordination signal, not a data channel or a conflict-prevention system.',
    operatorWorkflow: ['Operators with the same archive connected see other connected operators listed as present.', 'During Import or Transfer/Sync, other operators can see that activity in real time.'],
    preconditions: ['Realtime relay/registry connectivity available.'],
    actions: [{ label: 'View online presence', description: 'See which other operators are currently connected.' }],
    behavior: 'Presence (a device/operator being connected) is tracked separately from activity. Real-time activity/progress visibility is published only for Import and Transfer/Sync operations — QMZ sorting, metadata audit/repair, and other operations do not publish activity and are never visible as live activity to other operators. Seeing someone else online does not by itself mean they are editing your files.',
    recovery: null,
    relationships: [
      { type: 'distinctFrom', targetId: 'KM-not-supported-cloud-storage', note: 'No photographs or media files ever pass through the registry/relay — only small, size-capped presence/activity/status messages.' },
    ],
    limitations: [
      'The Online Registry never stores, transmits, or provides access to photograph or media file bytes.',
      'The Online Registry never replaces or overrides the archive as the source of truth; event.json remains authoritative even when the relay is degraded or unavailable.',
      'AutoIngest does not currently provide active conflict detection or conflict warnings — a conflict:warning message type is wired into the client/server protocol but has no confirmed emitting code path anywhere in the repository (dormant, not active).',
      'Activity visibility is limited to Import and Transfer/Sync operations only.',
      'Presence alone does not stop or warn you from also working on the same event as someone else.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'services/realtimeOperationsService.js\'s activity-emission call sites are limited to Import and Transfer/Sync flows only; the conflict:warning protocol message type exists but is never emitted by any code path in the repository.',
    provenance: [
      { claim: 'presence/activity/conflict boundaries', source: 'AI-WF-006 (See Who Else Is Online and What They\'re Working On); scripts/product-docs/lib/statusResolution.js KNOWN_BOUNDARIES ids=registry-media-storage,registry-not-source-of-truth,registry-conflict-detection,registry-activity-scope,registry-presence-not-activity', type: 'doc', confidence: 'high' },
      { claim: 'activity emission scope', source: 'services/realtimeOperationsService.js (activity-emission call sites)', type: 'code', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
];

module.exports = { RECORDS };
