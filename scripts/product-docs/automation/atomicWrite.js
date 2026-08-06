'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO_ROOT } = require('./paths');

// Every path this module (or any automation module built on it) ever writes
// must resolve inside the repository root. This is the single choke point
// for that guarantee — see docs/product/CLAUDE.md's security requirements
// ("normalize and constrain paths to repository root; prevent path
// traversal") and the SECURITY section of the Part 5 brief.
function assertInsideRepo(absPath) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(REPO_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside repository root: ${absPath}`);
  }
  return resolved;
}

// Atomic write: write to a sibling temp file, fsync, then rename over the
// target. A crash mid-write leaves either the old content or the new
// content on disk — never a truncated/partial file. Never used for
// .git-tracked files during a git hook's own execution window without the
// caller understanding that a rename changes the file's inode.
function atomicWriteFileSync(absPath, content) {
  const target = assertInsideRepo(absPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

// Append-only journal write: each call appends one JSON line, fsync'd
// immediately. Used so a crash between "decide to record a fact" and
// "finish updating the packet snapshot" still leaves the fact recoverable
// — see automation/evidencePacket.js's journal-then-snapshot ordering.
function appendJsonLineSync(absPath, obj) {
  const target = assertInsideRepo(absPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const line = JSON.stringify(obj) + '\n';
  const fd = fs.openSync(target, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { assertInsideRepo, atomicWriteFileSync, appendJsonLineSync };
