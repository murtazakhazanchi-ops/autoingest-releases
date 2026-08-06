'use strict';

// Collects DETERMINISTIC facts only — git state, changed files, commit
// metadata. Never infers meaning from them; that is changeClassifier's job,
// and it must label its own output with a confidence level. Reuses
// scripts/product-docs/lib/gitInfo.js rather than re-shelling to git, so
// this module inherits that file's ref-safety guards (rejects
// dash-prefixed refs, bounded maxBuffer) for free.

const gitInfo = require('../lib/gitInfo');

// Refreshes the deterministic git-fact fields on a packet: head_commit and
// the working-tree file list changed since base_commit. Called by
// `automation update`/`automation finalize` — never by `automation start`,
// since base_commit is fixed at session start.
function collectGitFacts(packet) {
  const headCommit = gitInfo.currentCommit();
  let changedFiles = [];
  let commits = [];
  if (gitInfo.refExists(packet.base_commit) && packet.base_commit !== headCommit) {
    changedFiles = gitInfo.changedFiles(packet.base_commit, 'HEAD');
    commits = gitInfo.log(packet.base_commit, 'HEAD').map((c) => ({
      hash: c.hash,
      short: c.short,
      date: c.date,
      subject: c.subject,
    }));
  }
  return {
    head_commit: headCommit,
    working_tree_dirty: gitInfo.isWorkingTreeDirty(),
    affected_files: changedFiles,
    commits,
  };
}

module.exports = { collectGitFacts };
