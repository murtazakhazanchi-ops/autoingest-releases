#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const SRC  = '/Users/funun_pa/Downloads';
const DEST = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

function tabDepth(line) {
  let n = 0;
  while (line[n] === '\t') n++;
  return n;
}

// ── CITIES ────────────────────────────────────────────────────────────────────
function parseCities() {
  const lines = fs.readFileSync(path.join(SRC, 'Cities.json'), 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === 'Cities') continue;
    out.push(t);
  }
  return out;
}

// ── PHOTOGRAPHERS ─────────────────────────────────────────────────────────────
function parsePhotographers() {
  const lines = fs.readFileSync(path.join(SRC, 'Photographers.json'), 'utf8').split('\n');
  const seen  = new Set();
  const out   = [];
  for (const line of lines) {
    const name = line.trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// ── EVENTS ────────────────────────────────────────────────────────────────────
function parseEvents() {
  const lines = fs.readFileSync(path.join(SRC, 'events.json'), 'utf8').split('\n');

  let minDepth = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    minDepth = Math.min(minDepth, tabDepth(line));
  }

  const result = [];
  let currentCat   = null;
  let currentEvent = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const depth = tabDepth(line) - minDepth;
    const label = line.trim();

    if (depth === 0) {
      currentCat   = { label, children: [] };
      currentEvent = null;
      result.push(currentCat);
    } else if (depth === 1) {
      currentEvent = { label };
      if (currentCat) currentCat.children.push(currentEvent);
    } else if (depth >= 2) {
      if (currentEvent) {
        if (!currentEvent.children) currentEvent.children = [];
        currentEvent.children.push({ label });
      }
    }
  }

  return result;
}

// ── LOCATIONS ─────────────────────────────────────────────────────────────────
function parseLocations() {
  const lines = fs.readFileSync(path.join(SRC, 'locations.json'), 'utf8').split('\n');

  let minDepth = Infinity;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === 'Locations') continue;
    minDepth = Math.min(minDepth, tabDepth(line));
  }

  const result          = [];
  let   currentLocation = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t === 'Locations') continue;

    const depth = tabDepth(line) - minDepth;

    if (depth === 0) {
      currentLocation = { label: t };
      result.push(currentLocation);
    } else if (depth === 1) {
      if (currentLocation) {
        if (!currentLocation.children) currentLocation.children = [];
        currentLocation.children.push({ label: t });
      }
    }
  }

  return result;
}

// ── WRITE ─────────────────────────────────────────────────────────────────────
const cities        = parseCities();
const photographers = parsePhotographers();
const events        = parseEvents();
const locations     = parseLocations();

fs.writeFileSync(path.join(DEST, 'cities.json'),        JSON.stringify(cities,        null, 2));
fs.writeFileSync(path.join(DEST, 'photographers.json'), JSON.stringify(photographers, null, 2));
fs.writeFileSync(path.join(DEST, 'event-types.json'),   JSON.stringify(events,        null, 2));
fs.writeFileSync(path.join(DEST, 'locations.json'),     JSON.stringify(locations,     null, 2));

// Spot-check
const shaadi = events.find(c => c.label.startsWith('10'))
                     ?.children.find(e => e.label === 'Shaadi');
const kaaba  = locations.find(l => l.label === 'Kaaba');
const jamrat = locations.find(l => l.label === 'Jamrat');

console.log('✓ cities:        ', cities.length, 'entries');
console.log('✓ photographers: ', photographers.length, 'entries (after dedup)');
console.log('✓ event-types:   ', events.length, 'categories,',
  events.reduce((s, c) => s + c.children.length, 0), 'events');
console.log('✓ locations:     ', locations.length, 'entries');
console.log('');
console.log('spot-checks:');
console.log('  Shaadi sub-events:', shaadi?.children?.map(c => c.label).join(', ') || 'NOT FOUND');
console.log('  Kaaba children:  ', kaaba?.children?.map(c => c.label).join(', ') || 'NOT FOUND');
console.log('  Jamrat children: ', jamrat?.children?.map(c => c.label).join(', ') || 'NOT FOUND');
