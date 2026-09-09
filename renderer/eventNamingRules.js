// renderer/eventNamingRules.js
// ── Consecutive-city-run naming rule ────────────────────────────────────────
// A component is conceptually EventType(s) – Location? – City, with City
// mandatory. When several CONSECUTIVE components share the same city, that
// city must appear only once — after the LAST component of that run — not
// once per component. A city change starts a new run; non-consecutive reuse
// of a city (A → B → A) is never collapsed, since each occurrence is its own
// run of length 1.
//
// This replaces the previous `allSameCity` approach (a single boolean asking
// "do ALL components in the whole event share one city?"), which degraded
// correctly only when every component shared one city, or when no two
// consecutive components ever shared a city — and produced a duplicated city
// suffix on every run of 2+ consecutive same-city components otherwise (the
// real, observed defect this file fixes; see the fix commit / bug record for
// the concrete example).
//
// Loaded as a plain browser <script> (see renderer/index.html, placed before
// eventCreator.js — same convention as pathUtils.js) and referenced via
// window.EventNamingRules from eventCreator.js; also directly requirable
// from Node for unit tests, with zero window/document dependency either way.

'use strict';

(function () {

  // shouldAppendCity(comps, index) — true when comps[index]'s own city
  // belongs at THIS position in the name: either this is the last component
  // overall, or the very next component's city differs from this one's.
  // Compares only the structured city field (comp.city?.label) — never
  // free-text `location`, which may coincidentally contain city-like text
  // (e.g. a location literally named "Rani Behensaheba (Mundra)" must never
  // affect city-run detection).
  function shouldAppendCity(comps, index) {
    if (!Array.isArray(comps) || index < 0 || index >= comps.length) return false;
    const thisCity = comps[index]?.city?.label || '';
    if (!thisCity) return false;
    if (index === comps.length - 1) return true;
    const nextCity = comps[index + 1]?.city?.label || '';
    return nextCity !== thisCity;
  }

  const exportsObj = { shouldAppendCity };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.EventNamingRules = exportsObj;
  }

})();
