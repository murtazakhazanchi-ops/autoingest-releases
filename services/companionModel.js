/**
 * companionModel.js — pure, Electron-free logic for the menu-bar/tray companion
 * (AI-FEAT-061). Kept separate from companionService.js so it is unit-testable.
 *
 * The snapshot is the ONLY data the companion renderer ever receives. It carries no
 * filesystem paths: a source is addressed by its opaque, main-generated sourceId.
 */

'use strict';

// v2 (Q2) adds sources[].assessment; every v1 field is unchanged.
const SNAPSHOT_SCHEMA_VERSION = 2;

const POPUP_WIDTH = 340;
/** Tall enough for one card's cameras and date assessment; several cards scroll inside the list. */
const POPUP_HEIGHT = 600;
/** Gap between the tray icon and the popup edge. */
const POPUP_MARGIN = 6;

/**
 * Builds the CompanionSnapshot (v2). Q1 detection fields plus, per card, the Q2
 * capture-date assessment view (counts and dates only — never a path). Archive status
 * (Q3) and Backup Intelligence evidence (AI-FEAT-062) are explicitly absent, not guessed.
 *
 * @param {{ cards: Array<{sourceId: string, label: string, labelCollision: boolean, size?: number}>, polledAt: string|null }} latest
 * @param {Date} [now]
 * @param {(sourceId: string) => object|null} [assessmentFor]  path-free assessment view
 */
function buildSnapshot(latest, now = new Date(), assessmentFor = () => null) {
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
      assessment: assessmentFor(c.sourceId) || null,
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

/**
 * Where to anchor the popup. Normally the tray icon itself. When the icon is not on
 * any display — e.g. a menu-bar manager (Vanilla, Bartender) or the notch has pushed
 * it off-screen — fall back to where the icon would sit: the right end of the primary
 * display's menu bar (macOS) or its taskbar corner (Windows).
 *
 * @param {{ trayBounds: {x:number,y:number,width:number,height:number}|null,
 *           displays: Array<{bounds: {x:number,y:number,width:number,height:number}}>,
 *           primary: {bounds: {x:number,y:number,width:number,height:number},
 *                     workArea: {x:number,y:number,width:number,height:number}},
 *           platform: string }} args
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function resolveTrayAnchor({ trayBounds, displays, primary, platform }) {
  const onSomeDisplay = !!trayBounds && trayBounds.width > 0 && trayBounds.height > 0 && displays.some(({ bounds: b }) => {
    const cx = trayBounds.x + trayBounds.width / 2;
    const cy = trayBounds.y + trayBounds.height / 2;
    return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height;
  });
  if (onSomeDisplay) return trayBounds;
  const { bounds: b, workArea: wa } = primary;
  const size = 22;
  if (platform === 'darwin') {
    const menuBarHeight = Math.max(wa.y - b.y, size);
    return { x: b.x + b.width - size, y: b.y, width: size, height: menuBarHeight };
  }
  return { x: wa.x + wa.width - size, y: wa.y + wa.height, width: size, height: size };
}

/**
 * Decides which card attachments are NEW connections, for the automatic popup.
 * Identity is the per-attachment sourceId from sourceMonitorService (a card removed
 * and reinserted gets a fresh id; a card left in place keeps its id across polls).
 * The first observation is a baseline: cards already connected when the companion
 * starts are not connection events.
 */
function createAutoOpenTracker() {
  /** @type {Set<string>|null} */
  let known = null;
  return {
    /**
     * @param {Array<{sourceId: string}>} cards  the current poll's camera cards
     * @returns {string[]} sourceIds that were not present in the previous poll
     */
    observe(cards) {
      const ids = (cards || []).map(c => c && c.sourceId).filter(id => typeof id === 'string' && id);
      if (known === null) {
        known = new Set(ids);
        return [];
      }
      const fresh = ids.filter(id => !known.has(id));
      known = new Set(ids);
      return fresh;
    },
  };
}

/** This computer's local calendar date, 'YYYY-MM-DD' ("today" for the assessment). */
function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HANDOFF_MESSAGES = {
  'busy': 'AutoIngest is busy. Finish the current import or dialog, then try again.',
  'workspace-in-use': 'The workspace already has files in progress. Finish or clear them, then try again.',
  'source-detached': 'This card is no longer connected.',
  'assessment-unavailable': 'The card is still being checked. Try again in a moment.',
  'nothing-selected': 'No files were captured on the selected date.',
  'handoff-in-progress': 'AutoIngest is already opening a card.',
  'workspace-not-opened': 'AutoIngest was not opened, so the card was not handed over. Try again.',
  'workspace-closed': 'The AutoIngest window closed before the card opened.',
  'no-response': 'AutoIngest stopped responding while opening the card. Open AutoIngest and choose the card there.',
  'open-failed': 'The workspace could not read the card.',
};

/** Operator-facing text for a refused / cancelled / failed Review handoff (never a path). */
function handoffMessage(reason) {
  return HANDOFF_MESSAGES[reason] || 'The workspace could not open the card. Open AutoIngest and choose the card there.';
}

/**
 * Popup text for a Review handoff operation in any state.
 * @param {{ state: string, phase?: string, reason?: string|null, selected?: number }} op
 */
function handoffStatusText(op) {
  if (op.state === 'pending') {
    return op.phase === 'waiting-for-workspace' ? 'Opening AutoIngest…' : 'Opening the card in AutoIngest…';
  }
  if (op.state === 'completed') {
    return op.selected ? `Opened in AutoIngest with ${op.selected.toLocaleString()} ${op.selected === 1 ? 'file' : 'files'} selected.` : 'Opened in AutoIngest.';
  }
  return handoffMessage(op.reason);
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  POPUP_WIDTH,
  POPUP_HEIGHT,
  buildSnapshot,
  formatCapacity,
  computePopupPosition,
  resolveTrayAnchor,
  createAutoOpenTracker,
  localDateString,
  handoffMessage,
  handoffStatusText,
};
