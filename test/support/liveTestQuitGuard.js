'use strict';
// External-Quit guard for live-test app instances (Electron main process). Used by
// liveTestPreload.js for dev launches; a packaged TEST build may load it from its test-only
// drivelist patch. Never part of a production build (test/ is outside package.json build.files).
//
// While a live test runs, a real macOS Quit (Cmd+Q delivered to the focused test window, Dock
// "Quit", a Quit AppleEvent) reaches the test app and shuts it down cleanly mid-run. Every quit
// the app or the test issues goes through JS app.quit()/app.exit() (Playwright's
// ElectronApplication.close() also calls app.quit()), so a 'before-quit' that arrives before any
// JS quit call came from outside. That one is cancelled (preventDefault, before main.js's own
// listeners run, so no shutdown work starts) and recorded; the harness reports the count.
// Crashes, SIGKILL restarts, renderer and child-process deaths do not pass through 'before-quit'
// and are not touched. If the event cannot be cancelled the quit proceeds and is recorded as
// unguarded, never silently dropped.

/**
 * @param {import('electron').App} app
 * @param {(entry: object) => void} record  appends one diagnostic entry to the run's log
 * @returns {{ state: { deliberate: object|null, blocked: number, unguarded: number }, isActive: () => boolean }}
 */
function installQuitGuard(app, record) {
  const state = { deliberate: null, blocked: 0, unguarded: 0 };
  const callerOf = () => (new Error().stack || '').split('\n').slice(3, 6).map(s => s.trim()).join(' | ');
  const origQuit = app.quit;
  const origExit = app.exit;
  const origEmit = app.emit;
  if (typeof origEmit !== 'function') throw new Error('app.emit unavailable');

  app.quit = function quit(...args) {
    if (!state.deliberate) { state.deliberate = { via: 'app.quit', at: new Date().toISOString() }; record({ type: 'deliberate-quit', via: 'app.quit', caller: callerOf() }); }
    return origQuit.apply(this, args);
  };
  app.exit = function exit(...args) {
    if (!state.deliberate) state.deliberate = { via: 'app.exit', at: new Date().toISOString() };
    record({ type: 'deliberate-exit', code: args[0] === undefined ? 0 : args[0], caller: callerOf() });
    return origExit.apply(this, args);
  };
  function guardedEmit(event, ...rest) {
    if (event !== 'before-quit' || state.deliberate) return origEmit.call(this, event, ...rest);
    const { BrowserWindow } = require('electron');
    const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    const focused = BrowserWindow.getFocusedWindow();
    const context = {
      uptimeSec: Math.round(process.uptime()),
      windows: wins.length,
      focusedWindow: focused ? (focused.webContents.getURL().split('/').pop() || 'blank') : null,   // page file name only, never a path or title
      appFocused: wins.some(w => w.isFocused()),
      likelySource: 'macOS Quit not issued by app or test JS (Cmd+Q to the focused window, Dock Quit, or a Quit AppleEvent)',
    };
    const ev = rest[0];
    if (!ev || typeof ev.preventDefault !== 'function') {
      state.unguarded++;
      record({ type: 'external-quit-unguarded', ...context });
      console.error('[live-iso] EXTERNAL QUIT could not be cancelled — letting it proceed', JSON.stringify(context));
      return origEmit.call(this, event, ...rest);
    }
    ev.preventDefault();
    state.blocked++;
    record({ type: 'external-quit-blocked', n: state.blocked, ...context });
    console.error('[live-iso] EXTERNAL QUIT BLOCKED', JSON.stringify(context));
    return true;
  }
  app.emit = guardedEmit;
  return { state, isActive: () => app.emit === guardedEmit };
}

module.exports = { installQuitGuard };
