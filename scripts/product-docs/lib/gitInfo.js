'use strict';

const { execFileSync } = require('child_process');
const { REPO_ROOT } = require('./repoRoot');

// git log/diff are deliberately unscoped to the whole repo (no docs/product/
// pathspec) — changeReport.js needs every changed source file, not just
// documentation files, to cross-reference against the subsystem/feature
// index. maxBuffer is raised well past Node's 1MB default so a pathologically
// large ref range (e.g. a report from the repo's first commit to HEAD) fails
// on git's own error rather than an opaque ENOBUFS from the child process.
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

// execFileSync already prevents shell-metacharacter injection (args are never
// shell-interpolated), but a ref string starting with "-" could still be
// misread by git itself as an option rather than a revision. Reject that
// shape outright rather than relying on flag-placement tricks.
function assertSafeRef(ref) {
  if (typeof ref !== 'string' || ref.startsWith('-')) {
    throw new Error(`Invalid git ref: ${JSON.stringify(ref)}`);
  }
}

function currentCommit() {
  try {
    return git(['rev-parse', 'HEAD']);
  } catch {
    return 'unknown';
  }
}

function isWorkingTreeDirty() {
  try {
    return git(['status', '--porcelain']).length > 0;
  } catch {
    return false;
  }
}

function refExists(ref) {
  try {
    assertSafeRef(ref);
    git(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

function resolveCommit(ref) {
  assertSafeRef(ref);
  return git(['rev-parse', ref]);
}

function commitDate(ref) {
  assertSafeRef(ref);
  return git(['show', '-s', '--format=%cI', ref]);
}

function commitSubject(ref) {
  assertSafeRef(ref);
  return git(['show', '-s', '--format=%s', ref]);
}

function log(fromRef, toRef) {
  assertSafeRef(fromRef);
  assertSafeRef(toRef);
  const raw = git(['log', '--format=%H%x1f%h%x1f%cI%x1f%s', `${fromRef}..${toRef}`]);
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [hash, short, date, subject] = line.split('\x1f');
    return { hash, short, date, subject };
  });
}

function changedFiles(fromRef, toRef) {
  assertSafeRef(fromRef);
  assertSafeRef(toRef);
  const raw = git(['diff', '--name-only', `${fromRef}..${toRef}`]);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).sort();
}

// Part 7D — release intelligence. Every tag reachable from `ref`, newest
// first by commit date (not tag-creation order, which can be reordered by
// a backdated/annotated tag) — `%(creatordate:iso-strict)` on a lightweight
// tag falls back to the tagged commit's own date, which is what "reachable
// history order" means for a release range.
function tagsReachableFrom(ref) {
  assertSafeRef(ref);
  const raw = git(['tag', '--merged', ref, '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)']);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [name, date] = line.split('\t');
    return { name, date };
  });
}

// The most recent tag reachable from `ref`, EXCLUDING a tag that points at
// `ref` itself — this is "the prior release", not "the release being cut".
function priorTag(ref) {
  assertSafeRef(ref);
  const resolved = resolveCommit(ref);
  for (const t of tagsReachableFrom(ref)) {
    if (resolveCommit(t.name) !== resolved) return t.name;
  }
  return null;
}

function tagExists(name) {
  try {
    assertSafeRef(name);
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}`]);
    return true;
  } catch {
    return false;
  }
}

// Part 9 — used to auto-discover a prior RC tag for a given Stable version
// (e.g. pattern "v0.9.12-rc.*" for stable version "0.9.12") without any
// human input. `git tag -l <pattern>` uses git's own glob matching, not a
// shell glob — no injection risk — but the pattern is still validated
// through assertSafeRef for the same leading-dash defense every other ref
// argument in this file gets.
function listTagsMatching(pattern) {
  assertSafeRef(pattern);
  const raw = git(['tag', '-l', pattern, '--sort=-v:refname']);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

module.exports = {
  currentCommit,
  isWorkingTreeDirty,
  refExists,
  resolveCommit,
  commitDate,
  listTagsMatching,
  commitSubject,
  log,
  changedFiles,
  tagsReachableFrom,
  priorTag,
  tagExists,
};
