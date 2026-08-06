'use strict';

// Crash/interruption recovery. Never silently completes a packet — a
// pending packet is only ever moved to completed/ by orchestrator.finalize
// succeeding fully; recovery's job is to detect and correctly label the
// alternative outcomes: stale (branch moved on), still-recoverable
// (in-progress, git state unchanged), or abandoned lock.

const fs = require('fs');
const path = require('path');
const gitInfo = require('../lib/gitInfo');
const { listPending, moveToTerminal, journalPath } = require('./evidencePacket');
const { LOCKS_DIR } = require('./paths');
const { STALE_LOCK_MS } = require('./recordAllocator');

function readJournal(sessionId) {
  const p = journalPath(sessionId);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// A packet is "stale" if its base_commit is no longer an ancestor of the
// current HEAD (branch switched away, or history was rebased) — in that
// case the recorded affected_files/commits can no longer be trusted to
// describe the current working tree, so recovery must not silently resume
// it as if nothing happened.
function isBaseCommitStale(packet) {
  if (!gitInfo.refExists(packet.base_commit)) return true;
  try {
    const { execFileSync } = require('child_process');
    execFileSync('git', ['merge-base', '--is-ancestor', packet.base_commit, 'HEAD'], {
      cwd: require('./paths').REPO_ROOT,
    });
    return false;
  } catch {
    return true;
  }
}

function scanPending() {
  // Hoisted out of the map — the current branch is loop-invariant, so
  // shelling to `git rev-parse` once per pending packet (performance
  // review finding) wastes a process spawn per entry for no reason.
  const currentBranch = safeCurrentBranch();
  return listPending().map((packet) => ({
    packet,
    journal_entries: readJournal(packet.session_id).length,
    base_commit_stale: isBaseCommitStale(packet),
    on_current_branch: packet.branch === currentBranch,
  }));
}

function safeCurrentBranch() {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: require('./paths').REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

// Recovers one pending packet: if its base commit is stale, it is honestly
// marked `stale` and moved to failed/ with a reason (never silently
// resumed, never silently completed). If it's still valid, it's left in
// pending/ for the caller to `automation finalize` explicitly.
function recoverOne(sessionId) {
  const entries = scanPending();
  const found = entries.find((e) => e.packet.session_id === sessionId);
  if (!found) return { recovered: false, reason: `no pending packet ${sessionId}` };
  if (found.base_commit_stale) {
    found.packet.automation_status = 'stale';
    found.packet.unresolved_gaps = [
      ...(found.packet.unresolved_gaps || []),
      `Session recovered as stale: base_commit ${found.packet.base_commit} is no longer an ancestor of HEAD (branch switch or rebase). Affected-files evidence may no longer reflect the current tree.`,
    ];
    moveToTerminal(found.packet, 'failed');
    return { recovered: true, outcome: 'stale', session_id: sessionId };
  }
  return { recovered: true, outcome: 'still-pending', session_id: sessionId, journal_entries: found.journal_entries };
}

function recoverAll() {
  return scanPending().map((e) => recoverOne(e.packet.session_id));
}

function listStaleLocks() {
  if (!fs.existsSync(LOCKS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(LOCKS_DIR)) {
    const p = path.join(LOCKS_DIR, f);
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) out.push({ file: f, age_ms: Date.now() - stat.mtimeMs });
  }
  return out;
}

module.exports = { scanPending, recoverOne, recoverAll, listStaleLocks, isBaseCommitStale };
