/**
 * Plain-script unit tests for src/descriptor.ts — no test framework,
 * mirroring AutoIngest's own test/*.test.js convention (see
 * test/tagRefinementManager.test.js). No real filesystem location outside
 * an isolated os.tmpdir() subdirectory is ever touched; real user
 * settings/AutoIngest data are never read.
 *
 * Run: npx tsx test/descriptor.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  candidateUserDataDirs,
  discoverDescriptor,
  DescriptorError,
  findDescriptorPath,
  isValidDescriptorShape,
  readDescriptor,
} from '../src/descriptor.js';

let passed = 0;
let failed = 0;

async function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL — ${name}`);
    console.error(err);
  }
}

async function mkTmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-mx-plugin-descriptor-test-'));
}

const VALID: Record<string, unknown> = { port: 51000, token: 'a'.repeat(64), pid: process.pid, protocolVersion: 1 };

console.log('descriptor.ts');

await t('candidateUserDataDirs derives both dev ("auto-ingest") and packaged ("AutoIngest") names, never a hardcoded username', () => {
  const dirs = candidateUserDataDirs('/Users/some-fake-home');
  assert.equal(dirs.length, 2);
  assert.ok(dirs[0]!.includes('/Users/some-fake-home/'), 'uses the supplied home, not the real one');
  assert.ok(dirs[0]!.endsWith('auto-ingest'), 'dev name first');
  assert.ok(dirs[1]!.endsWith('AutoIngest'), 'packaged name second');
});

await t('isValidDescriptorShape accepts a well-formed descriptor', () => {
  assert.equal(isValidDescriptorShape(VALID), true);
});

await t('isValidDescriptorShape rejects missing fields', () => {
  assert.equal(isValidDescriptorShape({ port: 51000, token: 'x' }), false);
});

await t('isValidDescriptorShape rejects a non-numeric port', () => {
  assert.equal(isValidDescriptorShape({ ...VALID, port: '51000' }), false);
});

await t('isValidDescriptorShape rejects an out-of-range port', () => {
  assert.equal(isValidDescriptorShape({ ...VALID, port: 99999 }), false);
});

await t('isValidDescriptorShape rejects a blank token', () => {
  assert.equal(isValidDescriptorShape({ ...VALID, token: '' }), false);
});

await t('isValidDescriptorShape rejects null/non-object input', () => {
  assert.equal(isValidDescriptorShape(null), false);
  assert.equal(isValidDescriptorShape('a string'), false);
  assert.equal(isValidDescriptorShape(42), false);
});

await t('readDescriptor: valid descriptor with a real, live pid parses successfully', async () => {
  const dir = await mkTmpHome();
  const p = path.join(dir, 'mx-control.json');
  await fs.writeFile(p, JSON.stringify(VALID));
  const d = await readDescriptor(p);
  assert.equal(d.port, 51000);
  assert.equal(d.pid, process.pid);
});

await t('readDescriptor: missing file throws DescriptorError("missing")', async () => {
  const dir = await mkTmpHome();
  await assert.rejects(
    () => readDescriptor(path.join(dir, 'nope.json')),
    (err: unknown) => err instanceof DescriptorError && err.code === 'missing',
  );
});

await t('readDescriptor: invalid JSON throws DescriptorError("invalid-json")', async () => {
  const dir = await mkTmpHome();
  const p = path.join(dir, 'mx-control.json');
  await fs.writeFile(p, '{ this is not json');
  await assert.rejects(
    () => readDescriptor(p),
    (err: unknown) => err instanceof DescriptorError && err.code === 'invalid-json',
  );
});

await t('readDescriptor: valid JSON but wrong shape throws DescriptorError("invalid-shape")', async () => {
  const dir = await mkTmpHome();
  const p = path.join(dir, 'mx-control.json');
  await fs.writeFile(p, JSON.stringify({ foo: 'bar' }));
  await assert.rejects(
    () => readDescriptor(p),
    (err: unknown) => err instanceof DescriptorError && err.code === 'invalid-shape',
  );
});

await t('readDescriptor: a syntactically valid descriptor whose pid is not running throws DescriptorError("stale-pid")', async () => {
  const dir = await mkTmpHome();
  const p = path.join(dir, 'mx-control.json');
  // PID 999999 is exceedingly unlikely to be a real running process.
  await fs.writeFile(p, JSON.stringify({ ...VALID, pid: 999999 }));
  await assert.rejects(
    () => readDescriptor(p),
    (err: unknown) => err instanceof DescriptorError && err.code === 'stale-pid',
  );
});

await t('findDescriptorPath: returns null when no candidate directory has a descriptor (fake, isolated home)', async () => {
  const fakeHome = await mkTmpHome();
  const found = await findDescriptorPath(fakeHome);
  assert.equal(found, null);
});

await t('findDescriptorPath: finds a descriptor placed at the "dev" (auto-ingest) candidate path', async () => {
  const fakeHome = await mkTmpHome();
  const devDir = path.join(fakeHome, 'Library', 'Application Support', 'auto-ingest');
  await fs.mkdir(devDir, { recursive: true });
  await fs.writeFile(path.join(devDir, 'mx-control.json'), JSON.stringify(VALID));
  const found = await findDescriptorPath(fakeHome);
  assert.equal(found, path.join(devDir, 'mx-control.json'));
});

await t('findDescriptorPath: falls back to the "packaged" (AutoIngest) candidate path when dev is absent', async () => {
  const fakeHome = await mkTmpHome();
  const packagedDir = path.join(fakeHome, 'Library', 'Application Support', 'AutoIngest');
  await fs.mkdir(packagedDir, { recursive: true });
  await fs.writeFile(path.join(packagedDir, 'mx-control.json'), JSON.stringify(VALID));
  const found = await findDescriptorPath(fakeHome);
  assert.equal(found, path.join(packagedDir, 'mx-control.json'));
});

await t('discoverDescriptor: end-to-end, missing descriptor is a normal DescriptorError, not a thrown generic error', async () => {
  const fakeHome = await mkTmpHome();
  await assert.rejects(
    () => discoverDescriptor(fakeHome),
    (err: unknown) => err instanceof DescriptorError && err.code === 'missing',
  );
});

await t('discoverDescriptor: end-to-end, a valid descriptor resolves with its real fields intact', async () => {
  const fakeHome = await mkTmpHome();
  const devDir = path.join(fakeHome, 'Library', 'Application Support', 'auto-ingest');
  await fs.mkdir(devDir, { recursive: true });
  await fs.writeFile(path.join(devDir, 'mx-control.json'), JSON.stringify(VALID));
  const d = await discoverDescriptor(fakeHome);
  assert.deepEqual(d, VALID);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
