/**
 * eventCopyResolver.js — READ-ONLY: the copies of ONE event (local staging and its NAS
 * counterpart) for the Photographer Registry rename preview (AI-FEAT-063, AI-RM-014 Q5e-1).
 *
 * Only reads: stat, event.json and the collection link file (offlineCollectionRegistryService
 * .readLink). Never creates, links, locks or writes anything, and never scans an archive.
 *
 * The NAS counterpart of a staging event is found exactly as archiveSyncService.syncJob routes a
 * sync (same precedence; kept in step by test): no link file → name-identity fallback under the
 * NAS root; unreadable link, provisional link, NAS-root mismatch, missing nasCollectionPath or a
 * path outside the NAS root → NOT reachable (reported, never guessed).
 * An event opened directly on the NAS / archive is that one copy; its staging copy is not derived.
 * Results hold absolute roots for the main-process planner only — never send them to a renderer.
 */

'use strict';

const path = require('path');

const _under = (p, root) => { const r = path.resolve(root); return p === r || p.startsWith(r + path.sep); };

/**
 * @param {string} eventPath
 * @param {{ stagingRoot?: string|null, nasRoot?: string|null, archiveRoots?: string[],
 *           readLink: (collectionPath: string) => Promise<{ ok: boolean, link: object|null, reason?: string }>,
 *           fs?: typeof import('fs').promises }} opts
 * @returns {Promise<{ ok: true, copies: Array<{ copyId: string, kind: 'local-staging'|'nas', root: string|null, reason: string|null }>, notes: string[] }
 *                  | { ok: false, reason: string }>}
 */
async function resolveEventCopies(eventPath, { stagingRoot = null, nasRoot = null, archiveRoots = [], readLink, fs: fsx = require('fs').promises } = {}) {
  if (typeof eventPath !== 'string' || !eventPath || eventPath.length > 4096 || !path.isAbsolute(eventPath)) return { ok: false, reason: 'invalid-event' };
  const ev = path.resolve(eventPath);
  const nasRoots = [nasRoot, ...archiveRoots].filter(Boolean);
  const inStaging = !!stagingRoot && _under(ev, stagingRoot) && ev !== path.resolve(stagingRoot);
  const inNas = !inStaging && nasRoots.some(r => _under(ev, r) && ev !== path.resolve(r));
  if (!inStaging && !inNas) return { ok: false, reason: 'outside-archive-roots' };
  try { await fsx.stat(path.join(ev, 'event.json')); } catch { return { ok: false, reason: 'not-an-event' }; }

  if (inNas) return { ok: true, copies: [{ copyId: 'nas', kind: 'nas', root: ev, reason: null }], notes: ['local-copy-not-determined'] };

  const copies = [{ copyId: 'local', kind: 'local-staging', root: ev, reason: null }];
  const rel = path.relative(path.resolve(stagingRoot), ev).split(path.sep).filter(Boolean);
  if (rel.length !== 2) return { ok: true, copies, notes: ['unexpected-event-depth'] };
  if (!nasRoot) return { ok: true, copies, notes: ['no-nas-configured'] };

  const collectionPath = path.dirname(ev);
  const eventName = path.basename(ev);
  const nas = { copyId: 'nas', kind: 'nas', root: null, reason: null };
  copies.push(nas);
  let res;
  try { res = await readLink(collectionPath); } catch { res = { ok: false, link: null, reason: 'error' }; }
  if (!res.ok && res.reason === 'not-found') nas.root = path.join(nasRoot, path.basename(collectionPath), eventName);
  else if (!res.ok) nas.reason = 'collection-link-unreadable';
  else if (res.link.status === 'provisional') nas.reason = 'collection-not-matched-to-nas';
  else if (res.link.nasRoot && res.link.nasRoot !== nasRoot) nas.reason = 'collection-link-stale';
  else if (!res.link.nasCollectionPath) nas.reason = 'collection-not-matched-to-nas';
  else if (!_under(path.resolve(res.link.nasCollectionPath), res.link.nasRoot || nasRoot)) nas.reason = 'collection-link-outside-nas';
  else nas.root = path.join(res.link.nasCollectionPath, eventName);
  if (nas.root) {
    try { await fsx.stat(nas.root); } catch { nas.reason = 'nas-copy-unreachable'; nas.root = null; }
  }
  return { ok: true, copies, notes: [] };
}

module.exports = { resolveEventCopies };
