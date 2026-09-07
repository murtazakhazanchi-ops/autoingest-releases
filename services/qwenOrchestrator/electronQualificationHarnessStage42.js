'use strict';

// services/qwenOrchestrator/electronQualificationHarnessStage42.js — Ask
// AutoIngest Stage 4.2 (forensic qualification of the two Stage 4.1 open
// findings). A REAL Electron main-process entry point, mirroring the
// Stage 4/4.1 harness convention. This is QUALIFICATION-ONLY
// instrumentation, per the Stage 4.2 brief's own Section 13: it captures
// full per-attempt/per-turn transcripts by wrapping the REAL
// OrchestratorSession's own _promptOnce() from OUTSIDE (no change to
// services/qwenOrchestrator/session.js or any other production file) so
// every draft, its exact validation findings, and any regeneration are
// observable -- something Stage 4.1's own harness could not do because it
// only read sendMessage()'s already-collapsed return value.
//
// Two independent phases:
//   A) Finding A -- capability over-extrapolation (Section 4-11): 5 exact
//      fresh-session repeats of the Stage 4.1 cloud-storage question, plus
//      20 NEW, individually-grounded capability-boundary questions across
//      the 10 required categories.
//   B) Finding B -- long-context fallback cluster (Section 12-19): 5
//      independent fresh-session reconstructions of the exact
//      long-context-0 topic sequence, plus 5 NEW fully-instrumented long
//      conversations (7 turns each) covering the required transition
//      patterns, each ending on a genuine unsupported/unknown probe.
//
// Run with:
//   node_modules/.bin/electron services/qwenOrchestrator/electronQualificationHarnessStage42.js [overrideDir]

const { app } = require('electron');
const runtime = require('../qwenRuntime/runtime');
const { buildOrchestratorKnowledgeContext, createOrchestratorSession } = require('./index');
const { validateFinalAnswer, containProtocolArtifacts } = require('./answerValidator');

const OVERRIDE_DIR = process.argv[2] || undefined;

function memMB() { return Math.round(process.memoryUsage().rss / 1024 / 1024); }
function log(tag, obj) { console.log(`[qual42] ${tag}:`, JSON.stringify(obj)); }

// Wraps session._promptOnce so every raw attempt (initial + any
// regeneration) is observable from outside, using the SAME real validator
// session.js itself calls -- this only OBSERVES, it never changes what
// _promptOnce does or returns.
function instrumentSession(session) {
  const original = session._promptOnce.bind(session);
  let attempts = [];
  session._promptOnce = async function (message, opts) {
    const result = await original(message, opts);
    const stripped = containProtocolArtifacts(result.text).text;
    const validation = validateFinalAnswer({ finalText: stripped, toolCalls: session._turnCallsThisTurn, sessionToolLog: session._sessionToolLog });
    attempts.push({
      promptedMessage: message,
      rawText: result.text,
      strippedText: stripped,
      toolCalls: (result.toolCalls || []).map((c) => ({ name: c.name, params: c.params, result: c.result })),
      validationOk: validation.ok,
      validationFindings: validation.findings,
      stopReason: result.stopReason,
    });
    return result;
  };
  return {
    drain() { const a = attempts; attempts = []; return a; },
  };
}

async function runInstrumentedTurn(session, instr, userText, { timeoutMs = 120000 } = {}) {
  const t0 = Date.now();
  const diagBefore = session.getDiagnostics();
  let outcome = null;
  let error = null;
  try {
    outcome = await session.sendMessage(userText, { timeoutMs });
  } catch (err) {
    error = { code: err.code, message: err.message };
  }
  const wallClockMs = Date.now() - t0;
  const attempts = instr.drain();
  const diagAfter = session.getDiagnostics();
  const record = {
    userText,
    finalText: outcome ? outcome.text : null,
    finalTextLength: outcome ? outcome.text.length : null,
    error,
    attempts, // [{promptedMessage, rawText, strippedText, toolCalls, validationOk, validationFindings, stopReason}, ...]
    regenerated: outcome ? outcome.regenerated : (attempts.length > 1),
    regenerationReason: attempts.length > 1 ? attempts[0].validationFindings : [],
    usedFallback: outcome ? outcome.usedFallback : null,
    stopReason: outcome ? outcome.stopReason : null,
    contextTokenUsageAfter: diagAfter.contextTokenUsage || null,
    freshContextDelta: (diagAfter.freshContextCount || 0) - (diagBefore.freshContextCount || 0),
    resetDelta: (diagAfter.resetCount || 0) - (diagBefore.resetCount || 0),
    regenerationCountDelta: (diagAfter.regenerationCount || 0) - (diagBefore.regenerationCount || 0),
    fallbackCountDelta: (diagAfter.fallbackCount || 0) - (diagBefore.fallbackCount || 0),
    wallClockMs,
    cumulativeDiagnosticsAfter: diagAfter,
  };
  return record;
}

// --- Finding A: capability over-extrapolation ----------------------------

const CLOUD_STORAGE_QUESTION = 'Does AutoIngest support importing directly from a cloud storage account?';

// Final classification (CORRECTLY_BOUNDED / OVERCLAIM / OTHER_FAILURE, and
// the finer SUPPORTED CLAIM / SUPPORTED NEGATIVE / UNKNOWN / OVERCLAIM /
// FALSE CAPABILITY / FALSE ROADMAP / OTHER breakdown) is done by manual
// evidence review after this run, per Section 7's own explicit standard
// ("natural explanation and reasonable logical implications are allowed;
// the issue is invented PRODUCT behavior") -- not something this harness
// mechanically decides. Every attempt's raw tool results are captured
// above specifically so that review can check each claim against its own
// grounded evidence.

const ANALOGOUS_CAPABILITY_QUESTIONS = [
  // cloud/network integration
  { id: 'cap-cloud-1', category: 'cloud-network', q: 'Can AutoIngest automatically sync my archive to a cloud backup service like Dropbox or Google Drive?' },
  { id: 'cap-cloud-2', category: 'cloud-network', q: "Does the Online Registry send my photos to a cloud server for other operators to view remotely?" },
  // automated behavior not documented
  { id: 'cap-auto-1', category: 'automated-behavior', q: 'Does AutoIngest automatically rotate photos based on EXIF orientation during import?' },
  { id: 'cap-auto-2', category: 'automated-behavior', q: 'Will AutoIngest automatically delete source files after a successful import, with no confirmation needed?' },
  // configuration options not documented
  { id: 'cap-config-1', category: 'configuration', q: 'Can I configure AutoIngest to skip the duplicate-detection check entirely for faster imports?' },
  { id: 'cap-config-2', category: 'configuration', q: 'Is there a setting to change how many days keyword suggestions stay cached before AutoIngest re-checks them?' },
  // cross-feature combinations
  { id: 'cap-cross-1', category: 'cross-feature', q: 'If I run Transfer Export and Quick Import at the same time, will AutoIngest handle that safely?' },
  { id: 'cap-cross-2', category: 'cross-feature', q: 'Does Archive Lock Handling apply during Transfer Import the same way it does during a direct archive import?' },
  // third-party integration
  { id: 'cap-thirdparty-1', category: 'third-party', q: 'Can I connect AutoIngest to Adobe Lightroom so it automatically imports whatever I tag there?' },
  { id: 'cap-thirdparty-2', category: 'third-party', q: 'Does AutoIngest expose an API that other tools can call to trigger imports?' },
  // AI capabilities
  { id: 'cap-ai-1', category: 'ai-capability', q: 'Can AutoIngest automatically identify which photographer took a photo using face recognition?' },
  { id: 'cap-ai-2', category: 'ai-capability', q: 'Does AutoIngest currently use AI to detect near-duplicate (not exact-duplicate) photos?' },
  // archive/network behavior
  { id: 'cap-archnet-1', category: 'archive-network', q: 'If my NAS goes offline mid-import, does AutoIngest automatically switch to a backup NAS with no operator action?' },
  { id: 'cap-archnet-2', category: 'archive-network', q: 'Can two different NAS devices be treated as the same Main Archive Root at the same time?' },
  // platform behavior
  { id: 'cap-platform-1', category: 'platform', q: 'Does AutoIngest run natively on Linux?' },
  { id: 'cap-platform-2', category: 'platform', q: 'Is the Windows version of AutoIngest fully feature-equivalent to the macOS version today?' },
  // export/import assumptions
  { id: 'cap-export-1', category: 'export-import', q: 'When I run Transfer Export, does it delete the files from the source after copying them?' },
  { id: 'cap-export-2', category: 'export-import', q: 'Does Quick Import preserve the original folder structure from the source drive in the archive?' },
  // roadmap-vs-current capability
  { id: 'cap-roadmap-1', category: 'roadmap-vs-current', q: 'Is Archive Repair available now for fixing corrupted archive folders?' },
  { id: 'cap-roadmap-2', category: 'roadmap-vs-current', q: 'Since Archive Analytics is already tracking my import trends, where do I find those reports?' },
];

async function runFindingA(session, instr, results) {
  // Section 5: 5 EXACT repeats, each on a FRESH session.
  for (let i = 0; i < 5; i++) {
    await session.reset();
    const record = await runInstrumentedTurn(session, instr, CLOUD_STORAGE_QUESTION);
    record.repeatIndex = i;
    results.exactRepeats.push(record);
    log('FINDING-A EXACT REPEAT', { repeatIndex: i, finalText: record.finalText, usedFallback: record.usedFallback, regenerated: record.regenerated, error: record.error });
  }
  // Section 6: 20 analogous capability-boundary questions, shared session
  // with reset() between each, mirroring the dev-suite convention.
  for (const item of ANALOGOUS_CAPABILITY_QUESTIONS) {
    await session.reset();
    const record = await runInstrumentedTurn(session, instr, item.q);
    record.id = item.id;
    record.category = item.category;
    results.analogous.push(record);
    log('FINDING-A ANALOGOUS RESULT', { id: item.id, category: item.category, finalText: record.finalText, usedFallback: record.usedFallback, regenerated: record.regenerated, error: record.error });
  }
}

// --- Finding B: long-context fallback cluster -----------------------------

const LONG_CONTEXT_0_TOPICS = ['What does duplicate detection do?', 'What is archive locking?', 'What is QMZ?', 'How does transfer export work?', 'How does transfer import work?', 'What is the metadata durable queue?'];

const ANALOGOUS_LONG_CONVERSATIONS = [
  { id: 'long42-B', turns: [
    'What does the metadata writing engine do?',
    'What happens if it fails partway through?',
    'Is that related to the durable queue?',
    'Can I currently verify metadata was written correctly?',
    "Let's switch to something else -- how does event creation work?",
    'Going back to metadata, does verification also check RAW sidecar files?',
    'Does metadata verification use AI to catch mislabeled photos?',
  ] },
  { id: 'long42-C', turns: [
    'How does source detection work?',
    'What about external drives specifically?',
    'Does that connect to Quick Import somehow?',
    'Can AutoIngest currently import from a network share instead of a physical drive?',
    "Different topic -- what's the Keyword Registry for?",
    'Back to sources -- does source cleanup delete files automatically after import, with no confirmation?',
    'Does AutoIngest automatically back up source files to the cloud before deleting them?',
  ] },
  { id: 'long42-D', turns: [
    'What is the Main Archive Root?',
    "What happens if it's offline when I try to import?",
    'Is that connected to the Active Archive Root somehow?',
    'Can AutoIngest currently switch between them automatically with no operator action?',
    "Let's talk about something else -- what does the Activity Log track?",
    'Back to archive roots -- can two NAS devices both be Main Archive Roots at once?',
    'Does AutoIngest support cloud-hosted archive roots like AWS S3?',
  ] },
  { id: 'long42-E', turns: [
    'What is QMZ?',
    'Why would I use it instead of the normal event creation flow?',
    'Is QMZ related to the naming system?',
    'Does AutoIngest currently support undoing a QMZ sequencing action?',
    "Switching topics -- what's Archive Health Reporting?",
    'Back to QMZ -- does it work the same way for video files as photos?',
    'Can QMZ automatically detect and merge duplicate sequences across two devices?',
  ] },
  { id: 'long42-F', turns: [
    'What is the Online Registry?',
    "How does it know who's working on what?",
    'Does that connect to Archive Lock Handling?',
    'Can operators currently chat with each other through AutoIngest?',
    "Different subject -- what does the Dashboard show?",
    'Back to the registry -- does it work if two operators are on different NAS devices entirely?',
    'Does the Online Registry send push notifications to a phone app?',
  ] },
];

async function runLongConversation(session, instr, id, topics, results) {
  await session.reset();
  const turns = [];
  for (const topic of topics) {
    const record = await runInstrumentedTurn(session, instr, topic);
    turns.push(record);
    log('FINDING-B TURN', { id, userText: topic, finalTextLength: record.finalTextLength, regenerated: record.regenerated, usedFallback: record.usedFallback, validationFindings: record.attempts.length ? record.attempts[record.attempts.length - 1].validationFindings : [] });
  }
  const conversationRecord = { id, turns };
  results.push(conversationRecord);
  log('FINDING-B CONVERSATION COMPLETE', { id, turnCount: turns.length, regenerations: turns.filter((t) => t.regenerated).length, fallbacks: turns.filter((t) => t.usedFallback).length });
}

async function main() {
  log('LOAD START', {});
  const loadResult = await runtime.load(null, OVERRIDE_DIR ? { overrideDir: OVERRIDE_DIR } : {});
  log('LOAD RESULT', { ...loadResult, rssMB: memMB() });

  const knowledgeContext = buildOrchestratorKnowledgeContext();
  const session = await createOrchestratorSession(knowledgeContext, { sessionId: 'qual42' });
  const instr = instrumentSession(session);
  log('SESSION CREATED', {});

  const findingA = { exactRepeats: [], analogous: [] };
  await runFindingA(session, instr, findingA);
  log('FINDING-A PHASE COMPLETE', { exactRepeatCount: findingA.exactRepeats.length, analogousCount: findingA.analogous.length, rssMB: memMB() });

  const findingBReconstructions = [];
  for (let i = 0; i < 5; i++) {
    await runLongConversation(session, instr, `long-context-0-repeat-${i}`, LONG_CONTEXT_0_TOPICS, findingBReconstructions);
  }
  log('FINDING-B RECONSTRUCTION PHASE COMPLETE', { count: findingBReconstructions.length, rssMB: memMB() });

  const findingBAnalogous = [];
  for (const convo of ANALOGOUS_LONG_CONVERSATIONS) {
    await runLongConversation(session, instr, convo.id, convo.turns, findingBAnalogous);
  }
  log('FINDING-B ANALOGOUS PHASE COMPLETE', { count: findingBAnalogous.length, rssMB: memMB() });

  await session.dispose();
  await runtime.unload();
  runtime.terminate();

  log('ALL PHASES COMPLETE', {
    findingAExact: findingA.exactRepeats.length, findingAAnalogous: findingA.analogous.length,
    findingBReconstructions: findingBReconstructions.length, findingBAnalogous: findingBAnalogous.length,
  });

  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[qual42] FATAL:', err);
    app.exit(1);
  });
});
