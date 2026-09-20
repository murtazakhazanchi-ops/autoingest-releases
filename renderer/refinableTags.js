'use strict';

// Shared refinable-tag model for Per-Photo Tag Refinement — the ONE place that decides:
//
//   (a) AVAILABLE tags — which Event Types / Additional Keywords a component offers
//       as refinable choices (drives Refine Tags eligibility and the panel's chips).
//   (b) DEFAULT (effective) tags — which of those the metadata pipeline actually
//       inherits for a file that carries no per-file override.
//
// These are deliberately separate concepts. A single-component event with 2+ Event
// Types (e.g. Ziyarat + Waaz) makes BOTH available, but its default inherits NEITHER:
// the resolver intentionally suppresses ambiguous Event Types on a single-component
// event (see defaultEventTypeTokens). The Tag Refinement UI must show that truth
// rather than assume "available = inherited".
//
// Dual-exported (CJS module.exports for services/metadataExpectationService.js, and
// window.RefinableTags for the renderer's own <script>-tag load) using the exact
// pattern renderer/pathUtils.js and renderer/photographerSequenceUtils.js already
// established. The resolver and the panel both call defaultEventTypeTokens(), so the
// panel's notion of "default" cannot drift from what the pipeline really writes.
//
// Wrapped in an IIFE (no top-level let/const) so a classic-script renderer reload never
// throws "already declared".
(function () {
  const _labelOf = x => (typeof x === 'string' ? x : (x && typeof x.label === 'string' ? x.label : ''));

  function _uniq(arr) {
    const seen = new Set();
    return arr.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
  }

  // Raw Event Type label list for either component shape: UI-format
  // (EventCreator.getEventComps(): eventTypes:[{label}]) or disk-format (event.json:
  // types:[string]).
  function _rawTypeLabels(component) {
    if (!component) return [];
    if (Array.isArray(component.eventTypes)) return component.eventTypes.map(_labelOf);
    if (Array.isArray(component.types)) return component.types.map(_labelOf);
    return [];
  }

  /**
   * Refinable tags a component makes AVAILABLE (blank/duplicate labels dropped).
   * @param {object|null} component UI-format or disk-format component
   * @returns {{ eventTypes: string[], additionalKeywords: string[] }}
   */
  function availableTags(component) {
    const clean = arr => _uniq(arr.map(s => s.trim()).filter(Boolean));
    return {
      eventTypes: clean(_rawTypeLabels(component)),
      additionalKeywords: clean(component && Array.isArray(component.additionalKeywords)
        ? component.additionalKeywords.map(_labelOf) : []),
    };
  }

  /** Total refinable tags a component offers — the single eligibility input (>= 1). */
  function countRefinable(component) {
    const a = availableTags(component);
    return a.eventTypes.length + a.additionalKeywords.length;
  }

  /** Event Type labels → individual, trimmed, non-empty comma-split tokens. */
  function splitTypeTokens(labels) {
    return (Array.isArray(labels) ? labels : []).join(',').split(',').map(t => t.trim()).filter(Boolean);
  }

  /**
   * The Event Type keywords the pipeline resolves for a file with NO per-file
   * refinement override. Consumed by metadataExpectationService._buildKeywords (the
   * writer) and by effectiveDefaults() (the panel) — the single source of truth.
   *
   *   explicitTags is an array   → exactly those (legacy group.metadataTags / MetaPicker)
   *   multi-component            → every comma-split tag
   *   single-component, 1 tag    → that tag
   *   single-component, 0 or 2+  → none (deliberately suppressed as ambiguous)
   *
   * @param {{ typeLabels:string[], isMulti:boolean, explicitTags?:string[] }} args
   * @returns {string[]}
   */
  function defaultEventTypeTokens({ typeLabels, isMulti, explicitTags }) {
    if (Array.isArray(explicitTags)) return [...explicitTags];
    const tokens = splitTypeTokens(typeLabels);
    if (isMulti) return tokens;
    if (tokens.length === 1) return [tokens[0]];
    return [];
  }

  /**
   * Which AVAILABLE tags a no-override file inherits — what a refinement panel should
   * show as "checked" for an untouched file. Event Type chips are matched token-wise: a
   * chip is inherited only when every comma-split token of its label is inherited.
   * Additional Keywords always inherit in full (the legacy metadataTags mechanism never
   * touches that category).
   *
   * @param {{ component:object|null, isMulti:boolean, explicitTags?:string[] }} args
   * @returns {{ eventTypes: string[], additionalKeywords: string[] }}
   */
  function effectiveDefaults({ component, isMulti, explicitTags }) {
    const avail = availableTags(component);
    const inherited = new Set(
      defaultEventTypeTokens({ typeLabels: _rawTypeLabels(component), isMulti, explicitTags })
        .map(tok => tok.trim().toLowerCase())
    );
    const eventTypes = avail.eventTypes.filter(label => {
      const toks = splitTypeTokens([label]);
      return toks.length > 0 && toks.every(tok => inherited.has(tok.toLowerCase()));
    });
    return { eventTypes, additionalKeywords: [...avail.additionalKeywords] };
  }

  const exportsObj = { availableTags, countRefinable, splitTypeTokens, defaultEventTypeTokens, effectiveDefaults };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.RefinableTags = exportsObj;
  }
})();
