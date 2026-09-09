// renderer/eventNamingRules.js
// ── Two DIFFERENT city-naming rules for two different targets ──────────────
// A component is conceptually EventType(s) – Location? – City, with City
// mandatory. This event's naming has TWO distinct targets that need
// DIFFERENT rules for when a component's own city belongs in a name:
//
// 1. The OVERALL EVENT NAME (the single string every component's tokens are
//    concatenated into — real folder name / event.json.eventName / dashboard
//    title) uses shouldAppendCity(): a CONSECUTIVE-RUN rule. When several
//    consecutive components share the same city, that shared city appears
//    only once, after the LAST component of that run — not once per
//    component — because the concatenated string already reads the run in
//    order; repeating the city on every member of the run just duplicates
//    it. A city change starts a new run; non-consecutive reuse of a city
//    (A -> B -> A) is never collapsed, since each occurrence is its own run
//    of length 1. This is the rule that fixes the real reported defect: a
//    multi-component event whose event NAME repeated a shared city once per
//    component instead of once per run.
//
// 2. Each component's own SUB-FOLDER NAME (a physical, standalone directory
//    entry that must be self-describing on its own, without requiring a
//    reader to look at sibling folders or infer position in a sequence)
//    uses shouldAppendCityToSubfolders(): a SINGLE, EVENT-WIDE rule, not a
//    per-component run check. A component's own sub-folder omits the city
//    ONLY when the entire event is one single city end to end (the city is
//    then implied by context and redundant on every folder). The moment an
//    event has ANY city diversity among its components, EVERY sub-folder
//    shows its own city, unconditionally — including consecutive
//    same-city components — because collapsing it there would make an
//    individual folder (e.g. "02-QMZ") impossible to identify by city
//    without inspecting its siblings. This is the ORIGINAL, correct
//    behavior this codebase's own `allSameCity` global flag already
//    produced for sub-folders (verified directly against the real
//    persisted historical event this fix was written against: its
//    sub-folder names already matched this exact rule) -- it was only ever
//    WRONG for the overall event name, never for sub-folders. A prior pass
//    of this fix mistakenly applied the consecutive-run rule to sub-folders
//    too; this correction restores the original, correct, event-wide rule
//    for sub-folders specifically while keeping the consecutive-run fix for
//    the overall name.
//
// Loaded as a plain browser <script> (see renderer/index.html, placed before
// eventCreator.js — same convention as pathUtils.js) and referenced via
// window.EventNamingRules from eventCreator.js; also directly requirable
// from Node for unit tests, with zero window/document dependency either way.

'use strict';

(function () {

  function cityLabel(comp) {
    return comp?.city?.label || '';
  }

  // shouldAppendCity(comps, index) — OVERALL EVENT NAME rule. True when
  // comps[index]'s own city belongs at THIS position: either this is the
  // last component overall, or the very next component's city differs from
  // this one's. Compares only the structured city field — never free-text
  // `location`, which may coincidentally contain city-like text (e.g. a
  // location literally named "Rani Behensaheba (Mundra)" must never affect
  // city-run detection).
  function shouldAppendCity(comps, index) {
    if (!Array.isArray(comps) || index < 0 || index >= comps.length) return false;
    const thisCity = cityLabel(comps[index]);
    if (!thisCity) return false;
    if (index === comps.length - 1) return true;
    const nextCity = cityLabel(comps[index + 1]);
    return nextCity !== thisCity;
  }

  // shouldAppendCityToSubfolders(comps) — SUB-FOLDER NAME rule, ONE decision
  // for the whole event (apply the same result to every component's own
  // folder name). False only when every component shares exactly one city;
  // true the moment there is any city diversity at all.
  function shouldAppendCityToSubfolders(comps) {
    if (!Array.isArray(comps) || comps.length === 0) return false;
    if (comps.length === 1) return true; // a single component always shows its own city
    const firstCity = cityLabel(comps[0]);
    const allSameCity = comps.every((c) => cityLabel(c) === firstCity);
    return !allSameCity;
  }

  const exportsObj = { shouldAppendCity, shouldAppendCityToSubfolders };

  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  } else {
    window.EventNamingRules = exportsObj;
  }

})();
