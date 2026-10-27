/**
 * companionPreload.js — preload for the menu-bar/tray companion popup ONLY
 * (AI-FEAT-061 Q1). Deliberately separate from main/preload.js: the popup gets
 * none of the main window's API, and the main window gets none of this one.
 *
 * Nothing here accepts a path or arbitrary payload; main validates the sender of
 * every companion:* call (services/companionService.js).
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  getSnapshot:    () => ipcRenderer.invoke('companion:getSnapshot'),
  openAutoIngest: () => ipcRenderer.invoke('companion:openAutoIngest'),
  hide:           () => ipcRenderer.invoke('companion:hide'),
  quit:           () => ipcRenderer.invoke('companion:quit'),
  /** @param {(snapshot: object) => void} cb @returns {() => void} unsubscribe */
  onSnapshot: (cb) => {
    const listener = (_e, snapshot) => cb(snapshot);
    ipcRenderer.on('companion:snapshot', listener);
    return () => ipcRenderer.removeListener('companion:snapshot', listener);
  },
});
