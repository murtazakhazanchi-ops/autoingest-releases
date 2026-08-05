'use strict';

const fs = require('fs');
const path = require('path');
const { validate } = require('./schemaValidator');
const { finding } = require('./validators');

const SCHEMA_DIR = path.join(__dirname, '..', 'schemas');

const SCHEMA_MAP = {
  'feature-index.json': 'feature-index.schema.json',
  'authority-index.json': 'authority-index.schema.json',
  'subsystem-locator.json': 'subsystem-locator.schema.json',
  'dependency-graph.json': 'dependency-graph.schema.json',
  'roadmap-dashboard.json': 'roadmap-dashboard.schema.json',
  'manifest.json': 'manifest.schema.json',
};

function checkGeneratedSchemas(freshFiles) {
  const findings = [];
  for (const [relPath, schemaFile] of Object.entries(SCHEMA_MAP)) {
    const content = freshFiles.get(relPath);
    if (!content) continue;
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, schemaFile), 'utf8'));
    const data = JSON.parse(content);
    const errors = validate(schema, data);
    for (const err of errors) {
      findings.push(finding('error', 'schema-violation', `${relPath} fails ${schemaFile}: ${err}`, `generated/${relPath}`));
    }
  }
  return findings;
}

module.exports = { checkGeneratedSchemas, SCHEMA_MAP };
