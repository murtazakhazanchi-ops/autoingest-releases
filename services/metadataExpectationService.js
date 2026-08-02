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
 *   1. Explicit per-file metadataGroups assignment ("metadata grouping mode").
 *   2. Explicit QMZ context (qmzComponent) — a directly-known, already-resolved
 *      component for the file being processed right now.
 *   3. event.json diskComponents, selected via group.subEventId <-> component.folderName.
 *   4. Photographer has its own short ladder: per-file override (evidence.photographer,
 *      set by the caller from a per-file source) > unresolved.
 *   5. Generic filesystem structure — not implemented here; no current caller needs it,
 *      and adding it would reintroduce the guessing this module exists to eliminate.
 */

const path = require('path');

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

/**
 * @param {{component:object|null, isMulti:boolean, explicitTags?:string[]}} args
 * @returns {string[]}
 */
function _buildKeywords({ component, isMulti, explicitTags }) {
  const kw = [];
  if (component) {
    const location = (typeof component.location === 'string' ? component.location : '') || '';
    const city     = (typeof component.city     === 'string' ? component.city     : '') || '';
    const country  = (typeof component.country  === 'string' ? component.country  : '') || '';

    if (Array.isArray(explicitTags)) {
      kw.push(...explicitTags);
    } else {
      const typeArr = Array.isArray(component.types) ? component.types : [];
      const allTags = typeArr.join(',').split(',').map(t => t.trim()).filter(Boolean);
      if (isMulti) {
        kw.push(...allTags);
      } else if (allTags.length === 1) {
        kw.push(allTags[0]);
      }
      // 0 or 2+ split tags on a single-component event → ambiguous, suppressed.
    }

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

  let component, isMulti, explicitTags;

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

    explicitTags = Array.isArray(group?.metadataTags) ? group.metadataTags : undefined;
    if (explicitTags !== undefined) evidenceSource.push('metadataGroups:explicit-tags');
  }

  const keywords = _buildKeywords({ component, isMulti, explicitTags });

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
