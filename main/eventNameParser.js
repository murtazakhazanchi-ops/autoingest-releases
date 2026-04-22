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
 *   3. Within a component, check if the last token before the CITY matches
 *      the locations list:
 *      - Case A (location found): ONE component — location = last token,
 *        event types = all preceding tokens.
 *      - Case B (no location): ONE component PER preceding token — each
 *        token becomes its own component sharing the same city, location=null.
 *   4. Unknown tokens (not in any list) are treated as EVENT_TYPEs and the
 *      component is flagged `isUnresolved: true`. Parsing does NOT fail on
 *      unknowns — only on invalid prefix or missing city.
 *   5. Parsing fails ONLY on invalid prefix (no hijri/seq match) or when
 *      no CITY is found anywhere.
 *
 * Output shape (backward-compatible fields kept alongside new ones):
 *   { ok, valid, hijriDate, sequence, components[], hasUnresolved }
 *   component: { eventType, eventTypes, location, city, raw, isUnresolved }
 *
 * No filesystem access. No dependencies. Pure function.
 */

'use strict';

// Prefix: 4-2-2 hijri date + " _" + 2-digit zero-padded sequence + "-"
const PREFIX_RE = /^(\d{4}-\d{2}-\d{2}) _(\d{2})-(.+)$/;

/**
 * Build a case-insensitive label → canonical-label map.
 * Accepts flat string[] or tree of { label, children? } nodes.
 * Every node at every depth is indexable (event names reference any level).
 */
function _buildLabelIndex(data) {
  const out = new Map();
  if (!Array.isArray(data)) return out;

  const visit = (node) => {
    if (typeof node === 'string') {
      if (node) out.set(node.toLowerCase(), node);
      return;
    }
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
 * @param {string} folderName
 * @param {{ cities?: string[], locations?: Array, eventTypes?: Array }} [lists]
 * @returns {{
 *   ok:            boolean,
 *   valid:         boolean,
 *   hijriDate?:    string,
 *   sequence?:     string,
 *   hasUnresolved?: boolean,
 *   components?:   Array<{
 *     eventType:    string,
 *     eventTypes:   string[],
 *     location:     string | null,
 *     city:         string,
 *     raw:          string[],
 *     isUnresolved: boolean,
 *   }>,
 *   reason?: string
 * }}
 */
function parseEventName(folderName, lists) {
  // Safe normalization — never crash when lists is missing or partial
  const _lists     = lists || {};
  const cities     = _lists.cities     || [];
  const locations  = _lists.locations  || [];
  const eventTypes = _lists.eventTypes || [];

  // Dev-mode warning when vocabulary data is absent (silent in production)
  if (process.env.NODE_ENV !== 'production') {
    if (!cities.length || !eventTypes.length) {
      console.warn('[eventNameParser] lists not provided or empty — all unknown tokens will be unresolved');
    }
  }

  const m = PREFIX_RE.exec(folderName || '');
  if (!m) {
    return { ok: false, valid: false, reason: 'Invalid prefix — expected "{YYYY-MM-DD} _{NN}-…"' };
  }
  const [ , hijriDate, sequence, rest ] = m;

  // Build all indexes once per call — never rebuilt inside loops (Part 6)
  const cityIdx = _buildLabelIndex(cities);
  const locIdx  = _buildLabelIndex(locations);
  const etIdx   = _buildLabelIndex(eventTypes);

  const tokens = rest.split('-').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, valid: false, reason: 'No components found after sequence.' };
  }

  // Pass 1 — find city anchors (cities have highest classification priority;
  // a token matching both cities and locations is always treated as a city)
  const cityPositions = [];
  tokens.forEach((tok, i) => {
    if (cityIdx.has(tok.toLowerCase())) cityPositions.push(i);
  });

  if (cityPositions.length === 0) {
    return { ok: false, valid: false, reason: 'No city found in event name.' };
  }

  // Pass 2 — build components, one city anchor per iteration
  const components = [];
  let start = 0;

  for (const cityIdxPos of cityPositions) {
    const compTokens = tokens.slice(start, cityIdxPos);
    const cityLabel  = cityIdx.get(tokens[cityIdxPos].toLowerCase()) || tokens[cityIdxPos];

    if (compTokens.length === 0) {
      // Degenerate: city at start or two adjacent cities — emit an empty component
      components.push({
        eventType:    '',
        eventTypes:   [],
        location:     null,
        city:         cityLabel,
        raw:          [cityLabel],
        isUnresolved: false,
      });
    } else {
      const tail    = compTokens[compTokens.length - 1];
      const tailKey = tail.toLowerCase();

      if (locIdx.has(tailKey)) {
        // Case A — last token before city is a location → ONE component
        const location     = locIdx.get(tailKey);
        const etTokens     = compTokens.slice(0, -1);
        const isUnresolved = etTokens.some(t => !etIdx.has(t.toLowerCase()));
        components.push({
          eventType:    etTokens.join(' '),
          eventTypes:   etTokens,
          location,
          city:         cityLabel,
          raw:          [...compTokens, cityLabel],
          isUnresolved,
        });
      } else {
        // Case B — no location: each preceding token becomes its own component
        // sharing the same city. Unknown tokens stay as unresolved EVENT_TYPEs;
        // the spec forbids failing the parse on unknowns.
        for (const tok of compTokens) {
          components.push({
            eventType:    tok,
            eventTypes:   [tok],
            location:     null,
            city:         cityLabel,
            raw:          [tok, cityLabel],
            isUnresolved: !etIdx.has(tok.toLowerCase()),
          });
        }
      }
    }

    start = cityIdxPos + 1;
  }

  // Post-loop edge case guards
  if (components.length === 0) {
    return { ok: false, valid: false, reason: 'No components parsed.' };
  }
  if (components.every(c => !c.city)) {
    return { ok: false, valid: false, reason: 'No city detected.' };
  }

  const hasUnresolved = components.some(c => c.isUnresolved);

  return {
    ok:          true,
    valid:       true,
    hijriDate,
    sequence,          // zero-padded string — preserved for localeCompare sort in main.js
    components,
    hasUnresolved,
  };
}

module.exports = { parseEventName };

// ── Self-test (only when run directly: node main/eventNameParser.js) ──────────
if (require.main === module) {
  const _testLists = {
    cities:     ['Mumbai', 'Surat'],
    locations:  [{ label: 'Saifee Masjid' }],
    eventTypes: [{ label: 'Majlis' }, { label: 'Juloos' }],
  };

  const _cases = [
    '1447-09-12 _01-Majlis-Saifee Masjid-Mumbai',  // Case A: location present
    '1447-09-12 _02-Majlis-Juloos-Mumbai',           // Case B: shared city, 2 components
    '1447-09-12 _03-Majlis-Mumbai-Juloos-Surat',     // Case C: two cities
  ];

  for (const name of _cases) {
    console.log('\nInput:', name);
    console.log(JSON.stringify(parseEventName(name, _testLists), null, 2));
  }
}
