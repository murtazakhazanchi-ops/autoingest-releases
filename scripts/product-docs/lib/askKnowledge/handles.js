'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation, Section
// 13 (session-handle architecture). Productionized, unchanged in design,
// from the Checkpoint 9 prototype (bench/orchestrator/knowledgeAccessC9.js's
// own `HandleSession`, verified byte-compatible in behavior through C14) --
// this is exactly the "search result -> H1/H2/H3..." handle model the
// Stage 2 brief itself describes, not a new design invented here.
//
// Requirements from the brief, all satisfied by this class: handles scoped
// to one assistant session (one instance per conversation, never shared or
// persisted); deterministic mapping (a Map, not a hash/random id); invalid
// handles rejected safely (resolve() returns null, never throws, and every
// caller in this module tree treats null as a distinct PROTOCOL-ERROR shape
// -- never "not found" or "unsupported"); handles never interpreted as
// capability truth (nothing in this file inspects what a handle points to);
// no repository ID leakage (the handle string itself, e.g. "H3", carries no
// AI-FEAT-###/AI-WF-###/KM-### information -- see leakBoundary.js's own
// HANDLE_SHAPE_RE for the structural leak-detection counterpart).
//
// Stage 2 does not create the Qwen session -- this class is instantiated
// and tested independently, by whatever future caller eventually owns one
// HandleSession per conversation (out of this stage's scope).

class HandleSession {
  constructor() {
    this._byHandle = new Map(); // handle -> realId
    this._byRealId = new Map(); // realId -> handle
    this._counter = 0;
    // Same "second-and-later distinct search" signal Checkpoint 9 found
    // necessary (see that file's own header): a caller that searches again
    // with different query text has itself signaled the first attempt was
    // insufficient. Tracked per session, not per query -- a structural
    // fact about the conversation, not a content judgment.
    this._distinctSearchQueries = new Set();
  }

  // Idempotent within a session: searching for the same real subject twice
  // returns the SAME handle, so an earlier turn's handle stays valid for
  // read/capability/relationship calls without re-searching.
  issue(realId) {
    if (this._byRealId.has(realId)) return this._byRealId.get(realId);
    this._counter += 1;
    const handle = `H${this._counter}`;
    this._byHandle.set(handle, realId);
    this._byRealId.set(realId, handle);
    return handle;
  }

  // Returns the real id, or null if this handle was never issued in THIS
  // session. null is a PROTOCOL error for every caller in this module tree,
  // never evidence about capability or knowledge state.
  resolve(handle) {
    return this._byHandle.get(String(handle || '')) || null;
  }

  // True when a DIFFERENT search query was already issued earlier in this
  // same session -- i.e. this is a repeat/retry search, not the first
  // attempt.
  noteSearchAndCheckRepeat(query) {
    const norm = String(query || '').trim().toLowerCase();
    const isRepeat = this._distinctSearchQueries.size > 0 && !this._distinctSearchQueries.has(norm);
    this._distinctSearchQueries.add(norm);
    return isRepeat;
  }

  // Diagnostic only (tests, corpus audits) -- never consumed by any tool
  // operation's own decision logic.
  size() {
    return this._byHandle.size;
  }
}

module.exports = { HandleSession };
