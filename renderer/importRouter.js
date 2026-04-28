// renderer/importRouter.js
// ── ImportRouter — pure renderer module ──────────────────────────────────────
//
// Builds {src, dest} file jobs for the event-based import flow.
// No IPC. No DOM access. No filesystem I/O. Pure data transformation.
//
// Routing table (single-component event):
//   masterPath / EventName / Photographer / [VIDEO /] filename
//
// Routing table (multi-component event):
//   masterPath / EventName / SubEventId / Photographer / [VIDEO /] filename
//
// Path separator: '/' throughout. main/main.js normalises to the OS-native
// separator via path.normalize() before passing paths to copyFileJobs.
//
// VIDEO detection: extension match against VIDEO_EXTENSIONS.
// ⚠️  Must stay in sync with config/app.config.js VIDEO_EXTENSIONS.
//     Do NOT add extensions here without also updating app.config.js.

'use strict';

const ImportRouter = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────

  /** Must match config/app.config.js VIDEO_EXTENSIONS exactly. */
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov']);

  // Safe dev-mode flag — process may be restricted in sandboxed renderer.
  const IS_DEV = (function () {
    try { return typeof process === 'undefined' || process.env.NODE_ENV !== 'production'; }
    catch (_) { return true; }
  })();

  // ── Dev-only logging ───────────────────────────────────────────────────────

  function _devLog(...args) {
    if (IS_DEV) console.log('[ImportRouter]', ...args);
  }

  function _devWarn(...args) {
    if (IS_DEV) console.warn('[ImportRouter]', ...args);
  }

  function _devError(...args) {
    if (IS_DEV) console.error('[ImportRouter]', ...args);
  }

  // ── Pure helpers ───────────────────────────────────────────────────────────

  /** Returns lowercase extension with leading dot, or '' if none. */
  function extOf(filename) {
    const i = filename.lastIndexOf('.');
    return i >= 0 ? filename.slice(i).toLowerCase() : '';
  }

  /**
   * Cross-platform basename — works on macOS ('/') and Windows ('\') paths
   * without requiring Node's path module in the renderer.
   */
  function basename(p) {
    return (p || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p;
  }

  // Part 5: Normalize subEventId — trim, coerce to string, reject empty.
  function _normalizeSubEventId(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
  }

  // ── Part 1: Shared routing base ────────────────────────────────────────────
  //
  // Single source of truth for directory path construction.
  // Returns the base directory path (no filename, no VIDEO segment).
  // Returns null when subEventId is missing in multi-component mode (caller skips).
  //
  // ctx: { masterPath: string, eventName: string, photographer: string, isMulti: boolean }
  function _buildDestBase(group, ctx) {
    const { masterPath, eventName, photographer, isMulti } = ctx;
    const subEventId = _normalizeSubEventId(group.subEventId);

    if (!isMulti && subEventId) {
      console.error('[IMPORT] Unexpected subEventId in single-component event', subEventId);
    }

    if (isMulti) {
      // Multi-component: subEventId is required — null means the group is unmapped.
      if (!subEventId) return null;
      return `${masterPath}/${eventName}/${subEventId}/${photographer}`;
    }
    return `${masterPath}/${eventName}/${photographer}`;
  }

  // ── Part 3: Structured validation ─────────────────────────────────────────
  //
  // Returns { errors, warnings } with { code, message } entries.
  // Errors are blocking; warnings are surfaced to the user but do not block.

  /**
   * @param {{ groups: object[], eventData: object }} params
   * @returns {{ errors: Array<{code:string, message:string}>, warnings: Array<{code:string, message:string}> }}
   */
  function validateGroups({ groups, eventData }) {
    const errors   = [];
    const warnings = [];

    if (!eventData) {
      errors.push({ code: 'NO_EVENT_DATA', message: 'No active event selected.' });
      return { errors, warnings };
    }

    if (!Array.isArray(groups) || groups.length === 0) {
      errors.push({ code: 'NO_GROUPS', message: 'No file groups created. Assign files to groups before importing.' });
      return { errors, warnings };
    }

    const { event } = eventData;

    // Invalid event name guard
    if (!event || !event.name) {
      errors.push({ code: 'INVALID_EVENT_NAME', message: 'Event name is missing or invalid.' });
      return { errors, warnings };
    }

    const isMulti = event.components.length > 1;

    // Blocking: groups with no subEventId in multi-component mode
    if (isMulti) {
      for (const g of groups) {
        if (!_normalizeSubEventId(g.subEventId)) {
          const count = g.files ? g.files.size : 0;
          errors.push({
            code:    'MISSING_SUBEVENT',
            message: `Group ${g.id} has no sub-event assigned (${count} file${count === 1 ? '' : 's'})`,
          });
        }
      }
    }

    // Non-blocking: duplicate subEvent assignments across groups
    const subEventUsage = new Map(); // subEventId → group ids[]
    for (const g of groups) {
      const sid = _normalizeSubEventId(g.subEventId);
      if (!sid) continue;
      if (!subEventUsage.has(sid)) subEventUsage.set(sid, []);
      subEventUsage.get(sid).push(g.id);
    }
    for (const [sid, gIds] of subEventUsage) {
      if (gIds.length > 1) {
        warnings.push({
          code:    'DUPLICATE_SUBEVENT',
          message: `Sub-event "${sid}" is assigned to multiple groups: ${gIds.map(id => `Group ${id}`).join(', ')}`,
        });
      }
    }

    // Non-blocking: unresolved event-type tokens in the event name
    const unresolvedComponents = (event.components || []).filter(c => c.isUnresolved);
    if (unresolvedComponents.length > 0) {
      const tokens = unresolvedComponents.map(c => {
        // eventType is the string form; fall back to eventTypes array if needed
        return c.eventType || (Array.isArray(c.eventTypes) ? c.eventTypes.join(' ') : '?');
      });
      warnings.push({
        code:    'UNRESOLVED_TOKENS',
        message: `Event name contains unrecognized tokens: ${tokens.join(', ')}`,
      });
    }

    return { errors, warnings };
  }

  // ── Part 4: Summary stats ──────────────────────────────────────────────────
  // Computed from in-memory jobs only — no filesystem access.

  function _buildSummary({ groups, fileJobs, skippedSrcs }) {
    const subEventsSeen = new Set();
    for (const g of groups) {
      const sid = _normalizeSubEventId(g.subEventId);
      if (sid) subEventsSeen.add(sid);
    }

    let videoFiles = 0;
    let imageFiles = 0;
    for (const job of fileJobs) {
      if (VIDEO_EXTENSIONS.has(extOf(basename(job.src)))) videoFiles++;
      else imageFiles++;
    }

    return {
      totalFiles:     fileJobs.length + skippedSrcs.length,
      totalGroups:    groups.length,
      totalSubEvents: subEventsSeen.size,
      videoFiles,
      imageFiles,
    };
  }

  // ── Part 1+2: simulateImport ───────────────────────────────────────────────
  //
  // Runs routing and returns jobs + summary without any I/O.
  // Both buildFileJobs and any preview UI call this — it is the single
  // source of routing truth. After computing each dest path, a dev-mode
  // consistency assertion re-derives the base independently from
  // _buildDestBase to catch any future divergence in the loop body.

  /**
   * @param {{ groups: object[], eventData: object, photographer: string }} params
   * @returns {{ fileJobs: Array<{src:string,dest:string}>, skippedSrcs: string[], summary: object }}
   */
  function simulateImport({ groups, eventData, photographer }) {
    const emptySummary = { totalFiles: 0, totalGroups: 0, totalSubEvents: 0, videoFiles: 0, imageFiles: 0 };

    if (!eventData || !photographer || !Array.isArray(groups)) {
      return { fileJobs: [], skippedSrcs: [], summary: emptySummary };
    }

    const { coll, event } = eventData;
    const masterPath = coll._masterPath;
    const eventName  = event.name;
    const isMulti    = event.components.length > 1;

    // ctx is built ONCE here and reused for every _buildDestBase call — not inside loops.
    const ctx = { masterPath, eventName, photographer, isMulti };

    _devLog(`simulateImport start — ${groups.length} groups, isMulti=${isMulti}, photographer="${photographer}"`);

    const fileJobs    = [];
    const skippedSrcs = [];

    for (const group of groups) {
      // Part 6: defensive guard — skip malformed group entries
      if (!group || typeof group !== 'object') {
        _devWarn('skipping invalid group entry in groups array');
        continue;
      }

      const baseDir = _buildDestBase(group, ctx);

      if (baseDir === null) {
        // Multi-component group with no valid subEventId — excluded from import.
        // G4 validation (renderer.js) blocks the import before this point;
        // this is a safety net for callers that skip validation.
        const fileCount = group.files ? group.files.size : 0;
        _devWarn(`Group ${group.id} has no valid subEventId in multi mode — skipping ${fileCount} files`);
        for (const src of (group.files || [])) skippedSrcs.push(src);
        continue;
      }

      for (const src of (group.files || [])) {
        const filename = basename(src);
        const isVideo  = VIDEO_EXTENSIONS.has(extOf(filename));
        const dest     = isVideo
          ? `${baseDir}/VIDEO/${filename}`
          : `${baseDir}/${filename}`;

        // Part 2: consistency assertion — re-derive base independently to
        // catch any future edits that add routing logic outside _buildDestBase.
        if (IS_DEV) {
          const expectedBase = _buildDestBase(group, ctx);
          const expectedDest = isVideo
            ? `${expectedBase}/VIDEO/${filename}`
            : `${expectedBase}/${filename}`;
          if (expectedDest !== dest) {
            _devError(`routing consistency mismatch for "${filename}": got "${dest}", expected "${expectedDest}"`);
          }
        }

        fileJobs.push({ src, dest });
      }
    }

    const summary = _buildSummary({ groups, fileJobs, skippedSrcs });

    _devLog(`simulateImport end — ${fileJobs.length} jobs (${summary.videoFiles} video, ${summary.imageFiles} image), ${skippedSrcs.length} skipped`);

    return { fileJobs, skippedSrcs, summary };
  }

  // ── buildFileJobs (public, backward-compatible) ────────────────────────────
  //
  // Delegates entirely to simulateImport. Returns only {fileJobs, skippedSrcs}
  // to preserve the existing call signature used by renderer.js G4/G5.

  /**
   * @param {{ groups: object[], eventData: object, photographer: string }} params
   * @returns {{ fileJobs: Array<{src:string,dest:string}>, skippedSrcs: string[] }}
   */
  function buildFileJobs({ groups, eventData, photographer }) {
    const { fileJobs, skippedSrcs } = simulateImport({ groups, eventData, photographer });
    return { fileJobs, skippedSrcs };
  }

  // ── Expose ─────────────────────────────────────────────────────────────────

  return { buildFileJobs, simulateImport, validateGroups };

})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = ImportRouter;
