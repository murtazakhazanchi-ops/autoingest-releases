/**
 * operatorActivity.js — "is the operator in the middle of something?" (AI-FEAT-061 Q1).
 *
 * The companion opens its popup automatically when a camera card is connected, but
 * must never interrupt an import or a modal interaction. main.js registers the
 * long-running and dialog-opening IPC handlers through wrap(), so this module knows
 * while any of them is in flight. Observation only: wrap() returns exactly what the
 * handler returns (or rejects exactly as it rejects).
 */

'use strict';

let _seq = 0;
const _active = new Map(); // token -> kind

function begin(kind) {
  const token = ++_seq;
  _active.set(token, kind);
  return token;
}

function end(token) {
  _active.delete(token);
}

/**
 * @template {(...args: any[]) => any} F
 * @param {string} kind  e.g. 'import', 'dialog' (diagnostics only)
 * @param {F} handler
 * @returns {(...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>}
 */
function wrap(kind, handler) {
  return async (...args) => {
    const token = begin(kind);
    try {
      return await handler(...args);
    } finally {
      end(token);
    }
  };
}

/** @returns {boolean} true while any wrapped operation or dialog is in flight */
function isBusy() {
  return _active.size > 0;
}

/** @returns {string[]} kinds currently in flight (diagnostics/tests) */
function activeKinds() {
  return [..._active.values()].sort();
}

module.exports = { begin, end, wrap, isBusy, activeKinds };
