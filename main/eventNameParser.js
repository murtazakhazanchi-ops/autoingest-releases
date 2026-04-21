/**
 * eventNameParser.js — Main-process pure function.
 *
 * Parses an event folder name of the form:
 *   {HijriDate} _{Seq}-{token}-{token}-...-{CITY}[-{token}-...-{CITY}]...
 *
 * Classification rules (from the locked M4 spec):
 *   1. CITY has highest priority. Any token matching the cities list → CITY.
 *      If a token matches both cities and locations, CITY wins.
 *   2. Split tokens into components at each CITY occurrence. Each CITY
 *      closes one component; that component's tokens are the ones since
 *      the previous CITY (or since the start).
 *   3. Within a component, scan right-to-left. The token immediately
 *      before the CITY is the LOCATION if it matches the locations list;
 *      otherwise it is an EVENT_TYPE. All remaining tokens are EVENT_TYPES.
 *   4. Unknown tokens (not in any list) are treated as EVENT_TYPES and the
 *      component is flagged `isUnresolved: true`. Parsing does NOT fail.
 *   5. Parsing fails ONLY on invalid prefix (no hijri/seq match) or when
 *      no CITY is found anywhere.
 *
 * This module does NO filesystem access — it's a pure function on
 * string inputs plus three list arrays. The caller (main.js) loads the
 * lists once from listManager and passes them in.
 */

'use strict';

// ── Prefix match: 4-2-2 date + " _" + 2-digit sequence + "-" ──────────────────
const PREFIX_RE = /^(\d{4}-\d{2}-\d{2}) _(\d{2})-(.+)$/;

/**
 * Build a case-insensitive label → canonical-label map from a flat string[]
 * or a tree of { label, children? } nodes. For trees, every node's label
 * (parent and leaf alike) is indexable — event names can reference any
 * level of the hierarchy.
 */
function _buildLabelIndex(data) {
  const out = new Map();
  if (!Array.isArray(data)) return out;

  const visit = (node) => {
    // Flat strings
    if (typeof node === 'string') {
      if (node) out.set(node.toLowerCase(), node);
      return;
    }
    // Tree nodes
    if (node && typeof node === 'object' && node.label) {
      out.set(String(node.label).toLowerCase(), node.label);
      if (Array.isArray(node.children)) node.children.forEach(visit);
    }
  };

  data.forEach(visit);
  return out;
}

/**
 * Parse a single event folder name.
 *
 * @param {string} folderName        The event folder basename.
 * @param {object} lists             { cities, locations, eventTypes }
 * @param {string[]} lists.cities    Flat list of city names.
 * @param {Array}    lists.locations Tree of location nodes (any depth).
 * @param {Array}    lists.eventTypes Tree of event-type nodes (any depth).
 * @returns {{
 *   ok: boolean,
 *   hijriDate?: string,
 *   sequence?: string,
 *   components?: Array<{
 *     eventTypes: string[],
 *     location:   string | null,
 *     city:       string,
 *     isUnresolved: boolean,
 *   }>,
 *   reason?: string
 * }}
 */
function parseEventName(folderName, lists) {
  const m = PREFIX_RE.exec(folderName || '');
  if (!m) {
    return { ok: false, reason: 'Invalid prefix — expected "{YYYY-MM-DD} _{NN}-…"' };
  }
  const [ , hijriDate, sequence, rest ] = m;

  const cityIdx     = _buildLabelIndex(lists.cities     || []);
  const locIdx      = _buildLabelIndex(lists.locations  || []);
  const tokens      = rest.split('-').map(t => t.trim()).filter(Boolean);

  if (tokens.length === 0) {
    return { ok: false, reason: 'No components found after sequence.' };
  }

  // ── Pass 1 — identify city positions ─────────────────────────────────────────
  const cityPositions = [];
  tokens.forEach((tok, i) => {
    if (cityIdx.has(tok.toLowerCase())) cityPositions.push(i);
  });

  if (cityPositions.length === 0) {
    return { ok: false, reason: 'No city found in event name.' };
  }

  // ── Pass 2 — split into components, one per city ────────────────────────────
  const components = [];
  let start = 0;

  for (const cityIdxPos of cityPositions) {
    // Tokens before this city (exclusive) belong to this component
    const compTokens = tokens.slice(start, cityIdxPos);
    const cityLabel  = cityIdx.get(tokens[cityIdxPos].toLowerCase()) || tokens[cityIdxPos];

    let location     = null;
    let isUnresolved = false;

    // Right-to-left: last token before city = location IFF it matches locations list
    const eventTypeTokens = [];
    if (compTokens.length > 0) {
      const tail     = compTokens[compTokens.length - 1];
      const tailKey  = tail.toLowerCase();
      if (locIdx.has(tailKey)) {
        // It's a location
        location = locIdx.get(tailKey);
        // Everything before the tail is event types
        for (let i = 0; i < compTokens.length - 1; i++) {
          const t = compTokens[i];
          eventTypeTokens.push(t);
        }
      } else {
        // Tail is an event type (not a location)
        for (const t of compTokens) {
          eventTypeTokens.push(t);
        }
      }
    }

    // Flag unresolved if any event-type token doesn't match the event-types list.
    // We use the eventTypes index only for this check — unknown tokens are still
    // kept as event types per the spec (never fail the parse on unknowns).
    const etIdx = _buildLabelIndex(lists.eventTypes || []);
    for (const t of eventTypeTokens) {
      if (!etIdx.has(t.toLowerCase())) {
        isUnresolved = true;
        break;
      }
    }

    components.push({
      eventTypes: eventTypeTokens,
      location,
      city: cityLabel,
      isUnresolved,
    });

    start = cityIdxPos + 1;
  }

  // Spec rule 7: it's valid to have no tokens after the last city — no component tail.
  // Spec rule: "DO NOT reorder tokens" — we keep source order throughout.

  return {
    ok: true,
    hijriDate,
    sequence,
    components,
  };
}

module.exports = { parseEventName };
