'use strict';

const path = require('path');
const fs = require('fs');

// scripts/product-docs/lib/repoRoot.js -> repo root is three levels up.
function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate repository root (no .git found above ' + __dirname + ')');
}

const REPO_ROOT = findRepoRoot();
const PRODUCT_DOCS_ROOT = path.join(REPO_ROOT, 'docs', 'product');
const GENERATED_ROOT = path.join(PRODUCT_DOCS_ROOT, 'generated');

module.exports = { REPO_ROOT, PRODUCT_DOCS_ROOT, GENERATED_ROOT };
