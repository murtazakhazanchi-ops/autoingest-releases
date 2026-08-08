'use strict';

// Wrapped in an IIFE (no top-level let/const) so this file is safe to load more
// than once in the same JS realm — a bare `const api = ...` at the top level
// throws "already declared" on a second execution and, in a classic-script
// renderer where every <script> shares one global scope, that SyntaxError
// aborts this file entirely, leaving window.PathUtils unset and cascading
// into a ReferenceError in every script that depends on it (eventCreator.js).
(function () {
  // A path is "Windows/UNC-shaped" if it's a UNC root (\\server\share\...) or
  // has a drive letter (C:\...). Renderer code has no process.platform to key
  // off (nodeIntegration is disabled), so shape is the only available signal.
  const WINDOWS_SHAPED = /^(\\\\|[a-zA-Z]:[\\/])/;

  // Windows-safe "is childPath located under rootPath" check. A literal
  // `somePath.startsWith(root + '/')` breaks on Windows/UNC paths, which use
  // backslash separators (e.g. \\server\share\1448\...) — the appended '/'
  // never matches, so a genuinely-nested path silently fails the check. This
  // normalizes both sides to forward slashes and strips trailing separators.
  // Case-insensitivity is applied ONLY when either path is Windows/UNC-shaped
  // (Windows local paths and SMB/UNC shares are not case-sensitive, regardless
  // of the host OS mounting them) — never for POSIX-shaped paths, since this
  // helper is also used against Local Staging paths that may live on a
  // genuinely case-sensitive filesystem (Linux, case-sensitive-formatted APFS),
  // where treating two differently-cased directories as the same one would be
  // a real false-positive containment match.
  function isPathUnderRoot(childPath, rootPath) {
    if (!childPath || !rootPath) return false;
    const caseInsensitive = WINDOWS_SHAPED.test(childPath) || WINDOWS_SHAPED.test(rootPath);
    function norm(p) {
      const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
      return caseInsensitive ? slashed.toLowerCase() : slashed;
    }
    return norm(childPath).startsWith(norm(rootPath) + '/');
  }

  const exportsObj = { isPathUnderRoot };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.PathUtils = exportsObj;
  }
})();
