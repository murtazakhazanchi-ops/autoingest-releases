'use strict';

// Ask AutoIngest Stage 3, Section 27A: model-independent tests for the
// small, pure-logic foundation modules -- modelManifest.js (Section 7/10
// single source of truth), diskSpace.js (Section 14 disk-space safety),
// and errors.js (Section 22 typed error model). No filesystem writes
// beyond a temp dir for the real checkDiskSpace() call, no Electron, no
// network, no model.
//
// Run with: node test/qwenRuntimeFoundations.test.js

const assert = require('node:assert/strict');
const os = require('node:os');

const modelManifest = require('../services/qwenRuntime/modelManifest');
const diskSpace = require('../services/qwenRuntime/diskSpace');
const { ERROR_CODE, QwenRuntimeError, mapUnknownError } = require('../services/qwenRuntime/errors');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('qwenRuntimeFoundations');

  // --- modelManifest.js -----------------------------------------------

  await t('buildManifest(): returns a deeply frozen, internally consistent single source of truth', () => {
    const m = modelManifest.buildManifest();
    assert.ok(Object.isFrozen(m));
    assert.ok(Object.isFrozen(m.identity));
    assert.ok(Object.isFrozen(m.runtimeCompatibility));
    assert.equal(m.modelKey, modelManifest.MODEL_KEY);
    assert.equal(m.contextSize, 24576);
    assert.equal(typeof m.manifestVersion, 'number');
  });

  await t('CONTEXT_SIZE is pinned to the qualified 24576 value, never left implicit', () => {
    assert.equal(modelManifest.CONTEXT_SIZE, 24576);
  });

  await t('chatWrapper config matches the exact Checkpoint 12/14 qualified QwenChatWrapper options', () => {
    const { chatWrapper } = modelManifest.RUNTIME_COMPATIBILITY;
    assert.equal(chatWrapper.variation, '3.5');
    assert.equal(chatWrapper.thoughts, 'discourage');
  });

  await t('download source is honestly NOT_CONFIGURED, never a fabricated URL', () => {
    assert.equal(modelManifest.DOWNLOAD_SOURCE_STATE, 'NOT_CONFIGURED');
    assert.equal(modelManifest.DOWNLOAD_URL, '');
  });

  // --- diskSpace.js ------------------------------------------------------

  await t('requiredFreeBytes(): adds a flat 512 MiB safety margin, not a percentage', () => {
    const expected = 2740937888;
    assert.equal(diskSpace.requiredFreeBytes(expected), expected + diskSpace.SAFETY_MARGIN_BYTES);
    assert.equal(diskSpace.SAFETY_MARGIN_BYTES, 512 * 1024 * 1024);
  });

  await t('requiredFreeBytes(): scales linearly, a flat margin regardless of model size', () => {
    const small = diskSpace.requiredFreeBytes(1000);
    const large = diskSpace.requiredFreeBytes(1000 * 1000 * 1000);
    assert.equal(large - small, 1000 * 1000 * 1000 - 1000, 'the delta between two sizes must equal exactly the size delta -- margin does not scale with size');
  });

  await t('checkDiskSpace(): a real, accessible path returns a genuine statfs-derived sufficient/insufficient verdict', async () => {
    const result = await diskSpace.checkDiskSpace(os.tmpdir(), 1024);
    assert.equal(result.ok, true);
    assert.equal(typeof result.freeBytes, 'number');
    assert.equal(typeof result.sufficient, 'boolean');
    assert.equal(result.requiredBytes, 1024 + diskSpace.SAFETY_MARGIN_BYTES);
  });

  await t('checkDiskSpace(): an impossibly large requirement (larger than any real disk) reports insufficient, never throws', async () => {
    const impossiblyLarge = Number.MAX_SAFE_INTEGER / 2;
    const result = await diskSpace.checkDiskSpace(os.tmpdir(), impossiblyLarge);
    assert.equal(result.ok, true);
    assert.equal(result.sufficient, false);
  });

  await t('checkDiskSpace(): an inaccessible path returns an explicit failure shape, never a raw thrown exception', async () => {
    const result = await diskSpace.checkDiskSpace('/this/path/does/not/exist/at/all/qwen-test', 1024);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.requiredBytes, 1024 + diskSpace.SAFETY_MARGIN_BYTES, 'requiredBytes must still be reported even on failure, for caller diagnostics');
  });

  // --- errors.js -----------------------------------------------------

  await t('QwenRuntimeError: unknown code names fall back to UNKNOWN rather than crashing the constructor', () => {
    const err = new QwenRuntimeError('NOT_A_REAL_CODE', 'test message');
    assert.equal(err.code, ERROR_CODE.UNKNOWN);
    assert.equal(err.name, 'QwenRuntimeError');
    assert.equal(err.message, 'test message');
  });

  await t('QwenRuntimeError: a real code round-trips exactly', () => {
    const err = new QwenRuntimeError('MODEL_LOAD_FAILED', 'boom', { foo: 1 });
    assert.equal(err.code, 'MODEL_LOAD_FAILED');
    assert.deepEqual(err.detail, { foo: 1 });
  });

  await t('mapUnknownError(): an already-typed error passes through unchanged (idempotent)', () => {
    const original = new QwenRuntimeError('CONTEXT_LIMIT', 'ctx');
    assert.equal(mapUnknownError(original), original);
  });

  await t('mapUnknownError(): context-size-shaped native messages map to CONTEXT_LIMIT', () => {
    const mapped = mapUnknownError(new Error('context size exceeded: too many tokens'));
    assert.equal(mapped.code, 'CONTEXT_LIMIT');
  });

  await t('mapUnknownError(): OOM-shaped native messages map to OUT_OF_MEMORY', () => {
    const mapped = mapUnknownError(new Error('Cannot allocate memory'));
    assert.equal(mapped.code, 'OUT_OF_MEMORY');
  });

  await t('mapUnknownError(): ENOENT-shaped native messages map to MODEL_NOT_INSTALLED', () => {
    const mapped = mapUnknownError(new Error('ENOENT: no such file or directory'));
    assert.equal(mapped.code, 'MODEL_NOT_INSTALLED');
  });

  await t('mapUnknownError(): a genuinely unrecognized message falls back to the caller-supplied fallback code', () => {
    const mapped = mapUnknownError(new Error('something totally unforeseen'), ERROR_CODE.INFERENCE_FAILED);
    assert.equal(mapped.code, 'INFERENCE_FAILED');
  });

  await t('mapUnknownError(): an err.cancelled flag maps to INFERENCE_CANCELLED regardless of message text', () => {
    const err = new Error('anything');
    err.cancelled = true;
    const mapped = mapUnknownError(err);
    assert.equal(mapped.code, 'INFERENCE_CANCELLED');
  });

  console.log(`qwenRuntimeFoundations: ${passed} passed`);
}

main();
