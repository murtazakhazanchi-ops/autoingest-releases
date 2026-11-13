/**
 * photographerMatch.js — search ranking for the companion's photographer combobox (AI-FEAT-064
 * EQI-1.1). Pure; the popup loads it as a script, tests require it.
 *
 * Only ever ranks EXISTING names from the app's photographer list — it never creates or completes
 * a name, and typed text alone is never a selection.
 *
 * Ranking (case-, accent- and punctuation-insensitive):
 *   0  the whole name equals the query
 *   1  the name starts with the query
 *   2  every query word is the start of a word in the name — so a stored initial or prefix
 *      can be left out: "Murtaza Kha" → "M Murtaza Khazanchi"
 *   3  every query word occurs somewhere in the name
 * Ties keep the list's own (alphabetical) order.
 */

'use strict';

(function (root) {
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

  /**
   * @param {string[]} names  the photographer list (already de-duplicated and sorted)
   * @param {string} query
   * @param {number} [limit]
   * @returns {string[]} matching names, best first ([] for an empty query)
   */
  function matchPhotographers(names, query, limit = 50) {
    const q = words(query);
    if (!q.length || !Array.isArray(names)) return [];
    const qJoined = q.join(' ');
    const ranked = [];
    names.forEach((name, i) => {
      const w = words(name);
      if (!w.length) return;
      const joined = w.join(' ');
      let rank = -1;
      if (joined === qJoined) rank = 0;
      else if (joined.startsWith(qJoined)) rank = 1;
      else if (q.every(t => w.some(x => x.startsWith(t)))) rank = 2;
      else if (q.every(t => joined.includes(t))) rank = 3;
      if (rank >= 0) ranked.push({ name, rank, i });
    });
    ranked.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return ranked.slice(0, limit).map(r => r.name);
  }

  const api = { matchPhotographers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotographerMatch = api;
}(typeof window !== 'undefined' ? window : globalThis));
