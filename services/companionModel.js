/**
 * companionModel.js — pure, Electron-free logic for the menu-bar/tray companion
 * (AI-FEAT-061). Kept separate from companionService.js so it is unit-testable.
 *
 * The snapshot is the ONLY data the companion renderer ever receives. It carries no
 * filesystem paths: a source is addressed by its opaque, main-generated sourceId.
 */

'use strict';

const SNAPSHOT_SCHEMA_VERSION = 1;

const POPUP_WIDTH = 340;
const POPUP_HEIGHT = 320;
/** Gap between the tray icon and the popup edge. */
const POPUP_MARGIN = 6;

/**
 * Builds the Q1 subset of the CompanionSnapshot v1 contract.
 * Q1 reports detection only; scan counts (Q2), archive status (Q3) and
 * Backup Intelligence evidence (AI-FEAT-062) are explicitly absent, not guessed.
 *
 * @param {{ cards: Array<{sourceId: string, label: string, labelCollision: boolean, size?: number}>, polledAt: string|null }} latest
 * @param {Date} [now]
 */
function buildSnapshot(latest, now = new Date()) {
  const cards = (latest && Array.isArray(latest.cards)) ? latest.cards : [];
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    polledAt: (latest && latest.polledAt) || null,
    capabilities: { contentIdentity: false, verificationReceipts: false, sourceHistory: false },
    sources: cards.map(c => ({
      sourceId: c.sourceId,
      kind: 'camera-card',
      label: typeof c.label === 'string' && c.label ? c.label : 'Unnamed card',
      labelCollision: !!c.labelCollision,
      // Only shown when two attached cards share a label; capacity is a hint, never an identity.
      disambiguator: c.labelCollision ? formatCapacity(c.size) : null,
      evidence: { detected: { confidence: 'certain' } },
    })),
    archive: null,
    importSession: { state: 'unknown' },
  };
}

/** @param {number} bytes */
function formatCapacity(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const gb = bytes / 1e9;
  return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`;
}

/**
 * Where to place the popup for a tray icon.
 * macOS: hang below the menu-bar icon. Windows: sit above (or beside) the taskbar icon.
 * Always clamped inside the display's work area.
 *
 * @param {{ trayBounds: {x:number,y:number,width:number,height:number},
 *           workArea: {x:number,y:number,width:number,height:number},
 *           platform: string, width?: number, height?: number }} args
 * @returns {{ x: number, y: number }}
 */
function computePopupPosition({ trayBounds, workArea, platform, width = POPUP_WIDTH, height = POPUP_HEIGHT }) {
  const centerX = trayBounds.x + trayBounds.width / 2;
  let x = Math.round(centerX - width / 2);
  let y;
  if (platform === 'darwin') {
    y = Math.round(trayBounds.y + trayBounds.height + POPUP_MARGIN);
  } else {
    const trayIsInTopHalf = trayBounds.y < workArea.y + workArea.height / 2;
    y = trayIsInTopHalf
      ? Math.round(trayBounds.y + trayBounds.height + POPUP_MARGIN)
      : Math.round(trayBounds.y - height - POPUP_MARGIN);
  }
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  x = Math.min(Math.max(x, workArea.x), maxX);
  y = Math.min(Math.max(y, workArea.y), maxY);
  return { x, y };
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  POPUP_WIDTH,
  POPUP_HEIGHT,
  buildSnapshot,
  formatCapacity,
  computePopupPosition,
};
