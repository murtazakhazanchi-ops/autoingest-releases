/**
 * companionPreload.js — preload for the menu-bar/tray companion popup ONLY
 * (AI-FEAT-061 Q1). Deliberately separate from main/preload.js: the popup gets
 * none of the main window's API, and the main window gets none of this one.
 *
 * Nothing here accepts a path or arbitrary payload: a card is addressed only by its
 * opaque sourceId. Main validates the sender and every field of each companion:* call
 * (services/companionService.js).
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  getSnapshot:    () => ipcRenderer.invoke('companion:getSnapshot'),
  openAutoIngest: () => ipcRenderer.invoke('companion:openAutoIngest'),
  hide:           () => ipcRenderer.invoke('companion:hide'),
  quit:           () => ipcRenderer.invoke('companion:quit'),
  // Q2 — capture-date assessment
  selectDate:     (sourceId, date, untilTime = null) => ipcRenderer.invoke('companion:selectDate', { sourceId, date, untilTime }),
  reviewSelected: (sourceId) => ipcRenderer.invoke('companion:reviewSelected', { sourceId }),
  reviewEarlier:  (sourceId) => ipcRenderer.invoke('companion:reviewEarlier', { sourceId }),
  /** @param {(snapshot: object) => void} cb @returns {() => void} unsubscribe */
  onSnapshot: (cb) => {
    const listener = (_e, snapshot) => cb(snapshot);
    ipcRenderer.on('companion:snapshot', listener);
    return () => ipcRenderer.removeListener('companion:snapshot', listener);
  },
});
