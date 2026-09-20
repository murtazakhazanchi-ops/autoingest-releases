'use strict';

/**
 * metadataExpectationService.js — the only place metadata expectations are computed.
 *
 * Pure and synchronous: never touches the filesystem, never calls ExifTool. Callers
 * (Standard Import, QMZ, Reapply, Transfer verification, Audit) are responsible for
 * reading event.json and pre-extracting its fields into the evidence object — the
 * resolver only decides what should exist, never how to obtain it from disk.
 *
 * Evidence hierarchy (strongest wins; a tie/contradiction between equally-strong
 * sources returns status:'ambiguous', never an inferred guess):
 *   0. Explicit per-file Tag Refinement override (group.fileTagRefinements, keyed by
 *      normalized absolute source path) — a per-file override of the Event Type /
 *      Additional Keyword categories, layered on top of an already-resolved component.
 *      Applies to multi-component groups AND to the single import payload group
 *      (id:0) a single-component event builds. Independent of, and checked ahead of,
 *      tier 1. No entry = "inherit the pipeline default" (tiers 1/3), NOT "all tags":
 *      a single-component event with 2+ Event Types deliberately defaults to none.
 *   1. Explicit per-file metadataGroups assignment ("metadata grouping mode").
 *   2. Explicit QMZ context (qmzComponent) — a directly-known, already-resolved
 *      component for the file being processed right now.
 *   3. event.json diskComponents, selected via group.subEventId <-> component.folderName.
 *      Default keywords derived here include every configured Additional Keyword label
 *      on the component, not just Event Types — see _buildKeywords.
 *   4. Photographer has its own short ladder: per-file override (evidence.photographer,
 *      set by the caller from a per-file source) > unresolved.
 *   5. Generic filesystem structure — not implemented here; no current caller needs it,
 *      and adding it would reintroduce the guessing this module exists to eliminate.
 */

const path = require('path');
const { defaultEventTypeTokens } = require('../renderer/refinableTags');

const METADATA_CONTRACT_VERSION = 1;
const RESOLVER_VERSION = 1;

const COPYRIGHT = '© Aljamea-tus-Saifiyah';

function _emptyFields() {
  return {
    photographer: null, component: null, keywords: [],
    hijriDate: null, eventDescription: null, copyright: COPYRIGHT,
  };
}

// component: disk-format component object ({ location, city, country, types, folderName }) or null.
function _resolveComponentFromGroups(filePath, groups, diskComponents) {
  if (!Array.isArray(groups) || !Array.isArray(diskComponents)) return { component: null, group: null };
  const srcNorm = path.normalize(filePath);
  for (const group of groups) {
    const files = Array.isArray(group.files) ? group.files : [];
    if (!files.some(f => path.normalize(f) === srcNorm)) continue;
    if (!group.subEventId) return { component: diskComponents[0] || null, group };
    return { component: diskComponents.find(c => c.folderName === group.subEventId) || null, group };
  }
  return { component: null, group: null };
}

// Every configured Additional Keyword label on a component — the default (non-refined)
// contribution of this category to keywords. useInFolderName/folderPlacement are a
// separate, untouched concern (folder naming, see renderer/folderNameHelper.js) — only
// .label feeds metadata.
function _additionalKeywordLabels(component) {
  if (!component || !Array.isArray(component.additionalKeywords)) return [];
  return component.additionalKeywords
    .map(k => (k && typeof k.label === 'string') ? k.label.trim() : '')
    .filter(Boolean);
}

/**
 * @param {{
 *   component:object|null, isMulti:boolean, explicitTags?:string[],
 *   eventTypeOverride?:string[], additionalKeywordOverride?:string[],
 * }} args
 * @returns {string[]}
 */
function _buildKeywords({ component, isMulti, explicitTags, eventTypeOverride, additionalKeywordOverride }) {
  const kw = [];
  if (component) {
    const location = (typeof component.location === 'string' ? component.location : '') || '';
    const city     = (typeof component.city     === 'string' ? component.city     : '') || '';
    const country  = (typeof component.country  === 'string' ? component.country  : '') || '';

    // Event Type tags — Tag Refinement override wins over the legacy metadataGroups
    // override, which wins over the derived type-split default. The default/legacy
    // branches live in renderer/refinableTags.js (defaultEventTypeTokens) so the Tag
    // Refinement panel's notion of "what an untouched file inherits" is the very same
    // function that decides what is written here — including the deliberate rule that a
    // single-component event with 0 or 2+ split tags suppresses Event Types as ambiguous.
    if (Array.isArray(eventTypeOverride)) {
      kw.push(...eventTypeOverride);
    } else {
      kw.push(...defaultEventTypeTokens({ typeLabels: component.types, isMulti, explicitTags }));
    }

    // Additional Keyword tags — a separate refinable category, independent of the
    // Event Type branch above (the legacy metadataGroups override never touches this
    // category, so it always falls through to the component's full configured list
    // unless a Tag Refinement override explicitly narrows it).
    kw.push(...(Array.isArray(additionalKeywordOverride) ? additionalKeywordOverride : _additionalKeywordLabels(component)));

    if (location) kw.push(location);
    if (city)     kw.push(city);
    if (country)  kw.push(country);
  }

  const seen = new Set();
  return kw.filter(k => {
    const key = (k || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {{
 *   filePath: string,
 *   photographer?: string|null,
 *   hijriDate?: string|null,
 *   eventDescription?: string|null,
 *   groups?: object[],            // standard/reapply evidence (tier 1 + 3)
 *   diskComponents?: object[],
 *   qmzComponent?: object|null,   // QMZ evidence (tier 2) — presence of this key (even null)
 *   qmzExplicitTags?: string[],   // signals QMZ-shaped evidence, mutually exclusive with groups/diskComponents
 * }} evidence
 * @returns {{
 *   status: 'resolved'|'ambiguous',
 *   metadataContractVersion: number, resolverVersion: number,
 *   photographer: string|null, component: object|null, keywords: string[],
 *   hijriDate: string|null, eventDescription: string|null, copyright: string,
 *   ambiguityReason: string|null, evidenceSource: string[],
 * }}
 */
function resolveExpectedMetadata(evidence) {
  const { filePath, photographer, hijriDate, eventDescription } = evidence;
  const evidenceSource = [];

  let component, isMulti, explicitTags, eventTypeOverride, additionalKeywordOverride;

  if (Object.prototype.hasOwnProperty.call(evidence, 'qmzComponent')) {
    // Tier 2 — explicit QMZ context. QMZ already knows exactly which component
    // applies; it is not routed through the groups/diskComponents matcher.
    component = evidence.qmzComponent || null;
    isMulti = false;
    explicitTags = Array.isArray(evidence.qmzExplicitTags) ? evidence.qmzExplicitTags : undefined;
    evidenceSource.push('qmz:explicit-component');
    if (!component) {
      return {
        status: 'ambiguous', ambiguityReason: 'qmz-component-unresolved',
        ..._emptyFields(), metadataContractVersion: METADATA_CONTRACT_VERSION, resolverVersion: RESOLVER_VERSION,
        evidenceSource,
      };
    }
  } else {
    // Tier 1 + Tier 3 — metadataGroups / event.json diskComponents.
    const diskComponents = Array.isArray(evidence.diskComponents) ? evidence.diskComponents : [];
    isMulti = diskComponents.length > 1;
    const resolved = _resolveComponentFromGroups(filePath, evidence.groups, diskComponents);
    component = resolved.component;
    const group = resolved.group;

    if (!component && !isMulti && diskComponents.length > 0) {
      // Defensive fallback: a single-component event must always resolve to its one
      // component even if group reconstruction failed to match this file explicitly.
      component = diskComponents[0];
      evidenceSource.push('fallback:base-component');
    } else if (component) {
      evidenceSource.push(group && group.subEventId ? 'event.json:diskComponents(matched)' : 'event.json:diskComponents(default)');
    }

    if (!component) {
      return {
        status: 'ambiguous',
        ambiguityReason: isMulti ? 'component-unresolved-multi-event' : 'no-components-in-event',
        ..._emptyFields(), metadataContractVersion: METADATA_CONTRACT_VERSION, resolverVersion: RESOLVER_VERSION,
        evidenceSource,
      };
    }

    // Tier 0 — per-file Tag Refinement override. Lives on the already-resolved group
    // (group.fileTagRefinements, keyed by normalized absolute source path) rather than
    // as a separate evidence field — it is a finer-grained layer on top of the same
    // group→component match, not an independent evidence source. Absent (or no entry
    // for this file) means inherit the pipeline default.
    const fileOverride = (group && group.fileTagRefinements && typeof group.fileTagRefinements === 'object')
      ? group.fileTagRefinements[path.normalize(filePath)]
      : undefined;
    if (fileOverride) {
      eventTypeOverride = Array.isArray(fileOverride.eventTypes) ? fileOverride.eventTypes : undefined;
      additionalKeywordOverride = Array.isArray(fileOverride.additionalKeywords) ? fileOverride.additionalKeywords : undefined;
      evidenceSource.push('tagRefinements:explicit-override');
    }

    explicitTags = Array.isArray(group?.metadataTags) ? group.metadataTags : undefined;
    if (explicitTags !== undefined) evidenceSource.push('metadataGroups:explicit-tags');
  }

  const keywords = _buildKeywords({ component, isMulti, explicitTags, eventTypeOverride, additionalKeywordOverride });

  return {
    status: 'resolved',
    metadataContractVersion: METADATA_CONTRACT_VERSION,
    resolverVersion: RESOLVER_VERSION,
    photographer: photographer || null,
    component: component
      ? {
          location: component.location || '', city: component.city || '', country: component.country || '',
          types: Array.isArray(component.types) ? component.types : [], folderName: component.folderName || null,
        }
      : null,
    keywords,
    hijriDate: hijriDate || null,
    eventDescription: eventDescription || null,
    copyright: COPYRIGHT,
    ambiguityReason: null,
    evidenceSource,
  };
}

module.exports = { resolveExpectedMetadata, METADATA_CONTRACT_VERSION, RESOLVER_VERSION };
