/**
 * photographerProfileActions.js — profile actions of the Photographer Registry tab (AI-FEAT-063,
 * AI-RM-014 Q5e-1), plugged into photographerRegistryManager's prepare → confirm → commit path.
 * Electron-free and filesystem-free; names come from the injected getNames().
 *
 *   alias-add / alias-remove  registry search aliases (Q5b builders, append-only observed-remove set)
 *   status                    retire / reactivate a profile (photographer-status-set)
 *   resolve-status            settle a disputed status from the review queue
 *   register                  explicit first registry record for a photographer-list name that has
 *                             none yet — through the store's own ensurePhotographerId (the same
 *                             validated path imports use), never a second photographer list
 * Every builder runs inside the registry write queue with the Q5b profile-revision check, so a
 * profile changed since the preview is refused. Rename is NOT here: renamePreview() is read-only
 * and nothing can apply it (photographerRenameContract.renameGate()).
 *
 * Payloads carry names only: photographer IDs from Q5b results are mapped to names here, and
 * learned-shortcut slugs are never sent.
 */

'use strict';

const P = require('./photographerIdentity');
const N = require('./photographerNameModel');
const Cmd = require('./photographerProfileCommands');
const { renameGate, PREREQUISITES } = require('./photographerRenameContract');

const ACTIONS = new Set(['alias-add', 'alias-remove', 'status', 'register']);
const STATUS_LABEL = { active: 'Active', retired: 'Retired', disputed: 'Needs review' };
const ALIAS_KIND_LABEL = { spelling: 'Other spelling', abbreviation: 'Abbreviation', other: 'Other' };
const BLOCK_TEXT = {
  'not-text': 'Enter some text.',
  'empty-alias': 'Enter an alias with letters or digits.',
  'too-short': 'Too short — use at least 2 characters.',
  'too-long': 'Too long.',
  'invisible-or-control-characters': 'Contains invisible or control characters.',
  'alias-is-official-name': 'This is already one of this photographer\'s official names, so it is found without an alias.',
  'alias-is-official-name-of-another': 'This is an official name of another photographer. Using it as an alias would be misleading.',
  'alias-is-list-name-of-another': 'This is another photographer-list name. Using it as an alias would be misleading.',
  'alias-exists': 'This photographer already has this search alias.',
  'name-exists': 'Another photographer already has this name.',
  'former-name-of-another': 'This is a former name of another photographer.',
  'empty-name': 'Enter a name.',
  'no-letters-or-digits': 'The name needs letters or digits.',
  'control-characters': 'Contains control characters.',
  'invisible-characters': 'Contains invisible characters.',
  'invalid-folder-characters': 'Contains characters that cannot be used in folder names.',
  'trailing-dot-or-space': 'Ends with a dot or space, which Windows folders do not allow.',
  'reserved-windows-name': 'Is a reserved Windows name.',
  'hidden-or-ignored-folder-prefix': 'Starts with a character that hides or skips folders.',
  'looks-like-sequence-prefix': 'Looks like a PCxx sequence prefix.',
  'structural-folder-name': 'Is the name of an AutoIngest structural folder.',
  'qmz-sequence-code': 'Looks like a QMZ sequence code.',
  'too-long-for-folder': 'Too long for a folder name.',
  unchanged: 'This is already the current name.',
};

const _str = (s) => (typeof s === 'string' ? s : null);

/**
 * @param {{ getNames: () => { shippedNames: string[], listNames: string[], learnedShortcuts: object } }} deps
 */
function createProfileActions({ getNames }) {
  const names = () => {
    try { const n = getNames() || {}; return { shippedNames: n.shippedNames || [], listNames: n.listNames || [], learnedShortcuts: n.learnedShortcuts || {} }; }
    catch { return { shippedNames: [], listNames: [], learnedShortcuts: {} }; }
  };
  const nameOf = (snap, id) => {
    const p = snap.view.photographers.find(x => x.key === snap.state.photographerCanonical(id));
    return p ? p.name : 'Unknown photographer';
  };
  const profileOf = (snap, key) => snap.view.photographers.find(x => x.key === key) || null;

  function _aliasChecks(snap, photographerId, text) {
    const norm = P.normalizeName(Cmd.previewStoredName(text) || '');
    const blocking = [];
    const warnings = [];
    if (!norm) return { blocking, warnings };
    // A list name (with or without a registry record) of someone else is misleading as an alias.
    const ownList = new Set((profileOf(snap, photographerId) || { listNames: [] }).listNames.map(P.normalizeName));
    if (names().listNames.some(n => P.normalizeName(n) === norm && !ownList.has(norm))) blocking.push({ kind: 'alias-is-list-name-of-another' });
    const others = snap.view.photographers.filter(p => p.key !== photographerId && p.learnedShortcuts.some(s => P.normalizeName(s.text) === norm));
    if (others.length) warnings.push({ kind: 'matches-learned-shortcut', names: others.map(p => p.name) });
    return { blocking, warnings };
  }

  /** Resolve a request against the snapshot into a plan (IDs stay in the main process). */
  function resolve(snap, req, I) {
    const key = I.photographerKeyOf(req.photographer);
    if (!key) return { reason: 'stale-view' };
    const prof = profileOf(snap, key);
    if (!prof) return { reason: 'stale-view' };
    const { shippedNames } = names();
    if (req.action === 'register') {
      if (prof.identity !== 'pending-first-use' || prof.listNames.length !== 1) return { reason: 'not-available-for-state' };
      return { kind: 'register', focusPhotographerKey: null, args: { name: prof.listNames[0] } };
    }
    if (!prof.photographerId) return { reason: prof.identity === 'ambiguous' ? 'ambiguous-profile' : 'registration-required' };
    const base = { shippedNames, photographerId: prof.photographerId, expectedRevision: Cmd.getProfileRevision(snap.events, { shippedNames, photographerId: prof.photographerId }) };
    if (req.action === 'alias-add') {
      const kind = Object.prototype.hasOwnProperty.call(ALIAS_KIND_LABEL, req.kind) ? req.kind : 'other';
      const extra = _aliasChecks(snap, key, req.alias);
      if (extra.blocking.length) return { reason: 'alias-rejected', blocking: extra.blocking.map(b => ({ kind: b.kind, text: BLOCK_TEXT[b.kind], names: [] })) };
      return { kind: 'profile', builder: 'alias-add', focusPhotographerKey: key, args: { ...base, alias: req.alias, kind }, extraWarnings: extra.warnings };
    }
    if (req.action === 'alias-remove') return { kind: 'profile', builder: 'alias-remove', focusPhotographerKey: key, args: { ...base, alias: req.alias } };
    if (req.action === 'status') {
      if (req.status !== 'active' && req.status !== 'retired') return { reason: 'invalid-status' };
      return { kind: 'profile', builder: 'status', focusPhotographerKey: key, args: { ...base, status: req.status } };
    }
    return { reason: 'unsupported-action' };
  }

  /** Settling a disputed status from the review queue is a status decision with full `resolves`. */
  function resolveStatusReview(snap, conflict, outcome) {
    if (outcome !== 'active' && outcome !== 'retired') return { reason: 'unsupported-action' };
    const { shippedNames } = names();
    const photographerId = conflict.photographerId;
    return {
      kind: 'profile', builder: 'status', focusPhotographerKey: null, settling: true,
      args: { shippedNames, photographerId, status: outcome, expectedRevision: Cmd.getProfileRevision(snap.events, { shippedNames, photographerId }) },
    };
  }

  function build(plan, events, extra) {
    const args = { ...plan.args, ...extra };
    if (plan.builder === 'alias-add') return Cmd.buildAliasAddEvent(events, args);
    if (plan.builder === 'alias-remove') return Cmd.buildAliasRemoveEvent(events, args);
    // A disputed status differs from both outcomes, so settling it always records a decision
    // whose `resolves` lists every status event the operator saw.
    if (plan.builder === 'status') return Cmd.buildStatusEvent(events, args);
    return { ok: false, reason: 'unsupported-action' };
  }

  /** Turn a Q5b refusal into names-only details. */
  function refusalDetails(snap, res) {
    const out = {};
    if (Array.isArray(res.blocking)) out.blocking = res.blocking.map(b => ({ kind: b.kind, text: BLOCK_TEXT[b.kind] || 'Not allowed.', names: (b.photographerIds || []).map(id => nameOf(snap, id)) }));
    return out;
  }

  function preview(snap, plan, result) {
    if (plan.kind === 'register') {
      return {
        title: 'Create a registry record for this photographer?',
        camera: null,
        rows: [{ label: plan.args.name, current: 'No registry record yet', proposed: 'Registered' }],
        consequences: [
          'A permanent registry identity is created for this photographer-list name, so aliases and status can be recorded for it.',
          'The photographer list, its spelling and existing archives are not changed. Imports would create the same record on first use.',
        ],
        caveat: null,
      };
    }
    const who = nameOf(snap, result.photographerId);
    if (plan.builder === 'status') {
      const from = STATUS_LABEL[result.from] || 'Active';
      const retiring = result.status === 'retired';
      return {
        title: plan.settling ? 'Settle this profile\'s status?' : retiring ? 'Retire this photographer profile?' : 'Reactivate this photographer profile?',
        camera: null,
        rows: [{ label: who, current: from, proposed: STATUS_LABEL[result.status] }],
        consequences: retiring
          ? ['Retired is a registry status, not a deletion. The photographer stays in the photographer list and in every archive, with all names, aliases, cameras and history.',
            'AutoIngest stops suggesting this photographer from camera evidence. It can be reactivated at any time.',
            'Import autocomplete and photographer selection are not changed.']
          : ['Camera-based suggestions for this photographer resume. Names, aliases, cameras and history are unchanged.'],
        caveat: null,
      };
    }
    const add = plan.builder === 'alias-add';
    const warnings = [...(result.warnings || []).map(w => (w.kind === 'shared-search-alias'
      ? `Also a search alias of ${w.photographerIds.map(id => nameOf(snap, id)).join(', ')}. Searching for it will show all of them and select none.` : null)),
    ...(plan.extraWarnings || []).map(w => (w.kind === 'matches-learned-shortcut' ? `Operators have typed this as a shortcut for ${w.names.join(', ')}. That shortcut is unchanged.` : null))].filter(Boolean);
    return {
      title: add ? 'Add this search alias?' : 'Remove this search alias?',
      camera: null,
      rows: [{ label: who, current: add ? 'Not an alias' : `Alias “${result.alias}”`, proposed: add ? `Alias “${result.alias}” (${ALIAS_KIND_LABEL[result.kind] || 'Other'})` : 'Removed from active aliases' }],
      consequences: [
        add ? 'The registry search finds this photographer by this text. It is never a name, never a folder name, and never chooses a photographer.'
          : 'The alias stops matching in registry search. Its addition and removal stay in the profile history.',
        'Import autocomplete and learned typing shortcuts are not changed.',
        ...warnings,
      ],
      caveat: null,
    };
  }

  function message(snap, plan, result) {
    if (plan.kind === 'register') return result && result.via === 'new' ? `Saved. ${plan.args.name} now has a registry record.` : `${plan.args.name} already had a registry record. Nothing new was written.`;
    const who = nameOf(snap, result.photographerId);
    if (plan.builder === 'alias-add') return `Saved. “${result.alias}” is now a search alias of ${who}.`;
    if (plan.builder === 'alias-remove') return `Saved. “${result.alias}” is no longer a search alias of ${who}.`;
    return result.status === 'retired' ? `Saved. ${who} is retired. Nothing was deleted.` : `Saved. ${who} is active again.`;
  }

  /**
   * READ-ONLY rename preview: validation, exact stored spelling, collisions, ambiguous aliases and
   * (when given) the current-event folder plan. Nothing can apply it.
   */
  function renamePreview(snap, key, proposed, folderPlan) {
    const prof = profileOf(snap, key);
    if (!prof) return { ok: false, reason: 'stale-view' };
    if (!prof.photographerId) return { ok: false, reason: prof.identity === 'ambiguous' ? 'ambiguous-profile' : 'registration-required' };
    const n = names();
    const raw = typeof proposed === 'string' ? proposed.slice(0, 200) : '';
    const check = Cmd.checkProposedName(raw, { events: snap.events, shippedNames: n.shippedNames, listNames: n.listNames, learnedShortcuts: n.learnedShortcuts, selfPhotographerId: prof.photographerId });
    const stored = check.preview.storedName;
    const blocking = check.blocking.map(b => ({ kind: b.kind, text: BLOCK_TEXT[b.kind] || 'Not allowed.', name: _str(b.name) }));
    if (stored && stored === prof.name) blocking.push({ kind: 'unchanged', text: BLOCK_TEXT.unchanged, name: null });
    const warnings = [];
    for (const w of check.warnings) {
      if (w.kind === 'similar-name') warnings.push({ kind: w.kind, text: `Similar to the list name “${w.name}”.` });
      else if (w.kind === 'matches-search-alias' || w.kind === 'matches-ambiguous-search-alias') warnings.push({ kind: w.kind, text: w.kind === 'matches-ambiguous-search-alias' ? 'Operators have typed this as a shortcut for several photographers.' : 'Operators have typed this as a typing shortcut before.' });
      else if (w.kind === 'matches-registry-search-alias') warnings.push({ kind: w.kind, text: `This is a registry search alias of ${w.photographerIds.map(id => nameOf(snap, id)).join(', ')}.` });
    }
    const ambiguousAliases = prof.searchAliases.filter(a => a.sharedWith.length).map(a => ({ text: a.text, sharedWith: a.sharedWith.map(id => nameOf(snap, id)) }));
    const gate = renameGate();
    return {
      ok: true,
      previewOnly: true,
      canApply: false,
      notice: 'Preview only — applying photographer name changes will be available after archive safety checks are completed.',
      unmet: gate.unmet.map(id => ({ id, title: (PREREQUISITES.find(p => p.id === id) || {}).title || id })),
      currentName: prof.name,
      originalName: prof.originalName,
      formerNames: [...prof.formerNames],
      proposed: { typed: raw, storedName: _str(stored), listSpelling: _str(check.preview.listSpelling), recapitalised: (check.preview.notes || []).includes('photographer-list-would-recapitalise') },
      valid: check.ok && !blocking.length,
      blocking, warnings, ambiguousAliases,
      folders: folderPlan,
    };
  }

  return { ACTIONS, resolve, resolveStatusReview, build, refusalDetails, preview, message, renamePreview };
}

module.exports = { createProfileActions, STATUS_LABEL };
