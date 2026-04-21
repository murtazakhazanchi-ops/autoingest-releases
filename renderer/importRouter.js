// renderer/importRouter.js
// ── ImportRouter — pure module ───────────────────────────────────────────────
// Builds the fileJobs array for the event-based import flow (G3).
//
// This module is a pure data transformation — no IPC, no DOM access.
// It takes the current GroupManager state and EventCreator's active event
// data and produces [{src, dest}] jobs ready for window.api.importFileJobs().
//
// Routing table:
//
//   Single-component event (event.components.length === 1):
//     masterPath / EventName / Photographer / filename
//     masterPath / EventName / Photographer / VIDEO / filename   ← video files
//
//   Multi-component event (event.components.length > 1):
//     masterPath / EventName / SubEventId / Photographer / filename
//     masterPath / EventName / SubEventId / Photographer / VIDEO / filename
//
// Path separator: forward slash is used throughout. main/main.js normalises
// all dest paths with path.normalize() before passing them to copyFileJobs,
// so Windows backslash conversion is handled automatically in the main process.
//
// VIDEO detection: extension match against VIDEO_EXTENSIONS below.
// ⚠️  Must stay in sync with config/app.config.js VIDEO_EXTENSIONS.
//     Do NOT add extensions here without also updating app.config.js.

'use strict';

const ImportRouter = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────

  /** Must match config/app.config.js VIDEO_EXTENSIONS exactly. */
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov']);

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Returns the lowercase extension including the leading dot, or '' if none. */
  function extOf(filename) {
    const i = filename.lastIndexOf('.');
    return i >= 0 ? filename.slice(i).toLowerCase() : '';
  }

  /**
   * Cross-platform basename — works on both macOS ('/') and Windows ('\') paths
   * without requiring access to Node's path module in the renderer.
   */
  function basename(p) {
    return (p || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build the fileJobs array for the event-based import flow.
   *
   * @param {object}   params
   * @param {object[]} params.groups       — GroupManager.getGroups()
   *                                         Each group: { id, files: Set<srcPath>, subEventId: string|null }
   * @param {object}   params.eventData    — EventCreator.getActiveEventData()
   *                                         Shape: { coll: { name, _masterPath, ... }, event: { name, components[] }, idx }
   * @param {string}   params.photographer — Photographer folder name (pre-trimmed by caller)
   *
   * @returns {{ fileJobs: Array<{src: string, dest: string}>, skippedSrcs: string[] }}
   *
   *   fileJobs    — Routed copy jobs. dest uses '/' as separator; main process
   *                 normalises to the OS-native separator before copying.
   *   skippedSrcs — Source paths excluded from the import:
   *                   • Files not assigned to any group (unassigned)
   *                   • Files in groups that have no subEventId in multi-component events
   *                 Callers (G4/G5) surface these to the user as warnings.
   *                 Per the locked spec, unassigned files are NEVER imported.
   */
  function buildFileJobs({ groups, eventData, photographer }) {
    if (!eventData || !photographer || !Array.isArray(groups)) {
      return { fileJobs: [], skippedSrcs: [] };
    }

    const { coll, event } = eventData;
    const masterPath = coll._masterPath;  // e.g. /archive/1447-10-03 _Surat Safar
    const eventName  = event.name;        // e.g. 1447-12-03 _01-Fajr Namaz-Mazar Saifee-Surat
    const isMulti    = event.components.length > 1;

    const fileJobs    = [];
    const skippedSrcs = [];

    for (const group of groups) {
      // Multi-component: groups without a subEventId assignment are excluded.
      // G4 validation blocks the import if any group is missing a subEvent,
      // so this path is a safety net for the rare case where buildFileJobs is
      // called before G4 validation completes.
      if (isMulti && !group.subEventId) {
        for (const src of group.files) skippedSrcs.push(src);
        continue;
      }

      for (const src of group.files) {
        const filename = basename(src);
        const isVideo  = VIDEO_EXTENSIONS.has(extOf(filename));

        let dest;

        if (isMulti) {
          // archiveRoot / Collection / Event / SubEvent / Photographer / [VIDEO /] file
          dest = isVideo
            ? `${masterPath}/${eventName}/${group.subEventId}/${photographer}/VIDEO/${filename}`
            : `${masterPath}/${eventName}/${group.subEventId}/${photographer}/${filename}`;
        } else {
          // archiveRoot / Collection / Event / Photographer / [VIDEO /] file
          dest = isVideo
            ? `${masterPath}/${eventName}/${photographer}/VIDEO/${filename}`
            : `${masterPath}/${eventName}/${photographer}/${filename}`;
        }

        fileJobs.push({ src, dest });
      }
    }

    return { fileJobs, skippedSrcs };
  }

  // ── Expose ─────────────────────────────────────────────────────────────────

  return { buildFileJobs };

})();

// Node.js / test compatibility — exports the module when required directly.
// Has no effect in the browser (where `module` is undefined).
if (typeof module !== 'undefined') module.exports = ImportRouter;
