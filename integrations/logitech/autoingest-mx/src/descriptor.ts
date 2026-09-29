/**
 * descriptor.ts — Discovers and validates AutoIngest's Phase 2 control
 * transport descriptor (<userData>/mx-control.json).
 *
 * This module owns ONLY discovery/validation — it never opens a socket and
 * never assumes AutoIngest is running. Every failure mode here (missing
 * file, invalid JSON, wrong shape, stale pid) is surfaced as a typed
 * DescriptorError so AutoIngestClient can treat it as an ordinary
 * "AutoIngest unavailable" state, not a crash.
 *
 * userData folder name: AutoIngest's Electron main process never calls
 * app.setName(), so app.getPath('userData') resolves from app.getName(),
 * which itself resolves from:
 *   - the top-level "name" in package.json ("auto-ingest") for an
 *     unpackaged/dev run (`electron .` / `npm start`) — confirmed
 *     empirically against the real running app, not assumed.
 *   - electron-builder's "productName" ("AutoIngest") for a packaged build,
 *     which electron-builder writes into the built app's own metadata.
 * Both are tried, in that order (dev first, since Phase 3A targets a dev
 * run), so this plugin works against either without hardcoding a path tied
 * to one developer's machine or username.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Descriptor {
  port: number;
  token: string;
  pid: number;
  protocolVersion: number;
}

export type DescriptorErrorCode =
  | 'missing'
  | 'invalid-json'
  | 'invalid-shape'
  | 'stale-pid'
  | 'unreadable';

export class DescriptorError extends Error {
  constructor(
    public readonly code: DescriptorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DescriptorError';
  }
}

const APP_NAME_DEV = 'auto-ingest'; // package.json "name" — unpackaged/dev run
const APP_NAME_PACKAGED = 'AutoIngest'; // electron-builder "productName" — packaged build
const DESCRIPTOR_FILENAME = 'mx-control.json';

/**
 * Candidate AutoIngest userData directories for the current OS, most
 * likely (dev run) first. Exported for tests; not part of the public
 * client API surface.
 *
 * @param homeOverride Test-only seam — supplies a fake home directory
 *   instead of the real os.homedir(), so tests can point discovery at an
 *   isolated synthetic location without monkey-patching Node's os module
 *   or ever touching real user settings.
 */
export function candidateUserDataDirs(homeOverride?: string): string[] {
  const home = homeOverride ?? os.homedir();
  const names = [APP_NAME_DEV, APP_NAME_PACKAGED];

  if (process.platform === 'darwin') {
    return names.map((n) => path.join(home, 'Library', 'Application Support', n));
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return names.map((n) => path.join(appData, n));
  }
  // Linux is not an official Node SDK target per current Logitech docs, but
  // this keeps discovery from throwing outright if ever run there in dev.
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return names.map((n) => path.join(xdgConfig, n));
}

/** True if `pid` refers to a currently-running process this user can see. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: process exists but is owned by another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Validates the parsed JSON has exactly the shape Phase 2's transport writes. */
export function isValidDescriptorShape(data: unknown): data is Descriptor {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.port === 'number' &&
    Number.isInteger(d.port) &&
    d.port > 0 &&
    d.port < 65536 &&
    typeof d.token === 'string' &&
    d.token.length > 0 &&
    typeof d.pid === 'number' &&
    Number.isInteger(d.pid) &&
    d.pid > 0 &&
    typeof d.protocolVersion === 'number'
  );
}

/** Finds the first candidate descriptor path that actually exists on disk. */
export async function findDescriptorPath(homeOverride?: string): Promise<string | null> {
  for (const dir of candidateUserDataDirs(homeOverride)) {
    const candidate = path.join(dir, DESCRIPTOR_FILENAME);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Reads and validates a descriptor file at a known path. Throws
 * DescriptorError (never a raw fs/JSON error) for every failure mode.
 */
export async function readDescriptor(descriptorPath: string): Promise<Descriptor> {
  let raw: string;
  try {
    raw = await fs.readFile(descriptorPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new DescriptorError('missing', 'Descriptor file does not exist');
    throw new DescriptorError('unreadable', `Cannot read descriptor: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new DescriptorError('invalid-json', 'Descriptor file is not valid JSON');
  }

  if (!isValidDescriptorShape(data)) {
    throw new DescriptorError('invalid-shape', 'Descriptor is missing required fields');
  }

  if (!isProcessAlive(data.pid)) {
    throw new DescriptorError('stale-pid', `Descriptor pid ${data.pid} is not a running process`);
  }

  return data;
}

/**
 * Full discovery: find the descriptor across every candidate userData
 * location, then read and validate it. This is the single entry point
 * AutoIngestClient calls on every (re)connect attempt.
 */
export async function discoverDescriptor(homeOverride?: string): Promise<Descriptor> {
  const descriptorPath = await findDescriptorPath(homeOverride);
  if (!descriptorPath) {
    throw new DescriptorError('missing', 'AutoIngest control descriptor not found — is AutoIngest running?');
  }
  return readDescriptor(descriptorPath);
}
