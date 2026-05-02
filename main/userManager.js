'use strict';

/**
 * userManager.js — Operator identity store for import attribution.
 *
 * Stores profiles in userData/users.json using the same atomic tmp→rename
 * write pattern as importIndex.json and settings.json.
 *
 * lastActiveUserId is stored via services/settings.js so all persisted
 * preferences stay in one file.
 *
 * No passwords, emails, photos, or sensitive identity data are stored.
 */

const fs     = require('fs');
const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');

let _usersPath = null;
let _users     = null;   // null = not loaded; [] = loaded (possibly empty)

function _resolvePath() {
  if (_usersPath) return _usersPath;
  const { app } = require('electron');
  _usersPath = path.join(app.getPath('userData'), 'users.json');
  return _usersPath;
}

function _load() {
  if (_users !== null) return;
  const p = _resolvePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    _users = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[userManager] Load failed, starting empty:', err.message);
    }
    _users = [];
  }
}

async function _save() {
  const p   = _resolvePath();
  const tmp = p + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(_users, null, 2), 'utf8');
    await fsp.rename(tmp, p);
  } catch (err) {
    console.error('[userManager] Save failed:', err.message);
    try { await fsp.unlink(tmp); } catch {}
    throw err;
  }
}

function _slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
}

function _autoInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function _generateId(name) {
  const slug   = _slugify(name);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `user_${slug}_${suffix}`;
}

/**
 * Returns a shallow copy of all user profiles, sorted by lastUsedAt descending.
 * @returns {Array<Object>}
 */
function listUsers() {
  _load();
  return [..._users].sort((a, b) => {
    const ta = a.lastUsedAt || a.createdAt || '';
    const tb = b.lastUsedAt || b.createdAt || '';
    return tb.localeCompare(ta);
  });
}

/**
 * Creates a new user profile.
 * @param {{ name: string, role?: string|null, initials?: string|null }} profile
 * @returns {Promise<Object>} The created user (copy, no internal reference)
 */
async function createUser({ name, role = null, initials = null }) {
  _load();
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Full name is required.');

  const nameLower = trimmed.toLowerCase();
  if (_users.some(u => u.name.toLowerCase() === nameLower)) {
    throw new Error(`A profile named "${trimmed}" already exists. Please choose a different name.`);
  }

  const now  = new Date().toISOString();
  const user = {
    id:         _generateId(trimmed),
    name:       trimmed,
    role:       (typeof role === 'string' && role.trim()) ? role.trim() : null,
    initials:   (typeof initials === 'string' && initials.trim())
                  ? initials.trim().toUpperCase()
                  : _autoInitials(trimmed),
    createdAt:  now,
    lastUsedAt: now,
  };

  _users.push(user);
  await _save();
  return { ...user };
}

/**
 * Sets the active user by ID. Updates lastUsedAt and persists lastActiveUserId.
 * @param {string} id
 * @returns {Promise<Object>} The activated user (copy)
 */
async function setActiveUser(id) {
  _load();
  const user = _users.find(u => u.id === id);
  if (!user) throw new Error(`No profile found with id "${id}".`);

  user.lastUsedAt = new Date().toISOString();
  await _save();

  const { setLastActiveUserId } = require('../services/settings');
  await setLastActiveUserId(id);

  return { ...user };
}

/**
 * Returns the currently active user profile, or null if none is set / resolvable.
 * @returns {Object|null}
 */
function getActiveUser() {
  _load();
  const { getLastActiveUserId } = require('../services/settings');
  const lastId = getLastActiveUserId();
  if (!lastId) return null;
  const user = _users.find(u => u.id === lastId);
  return user ? { ...user } : null;
}

module.exports = { listUsers, createUser, setActiveUser, getActiveUser };
