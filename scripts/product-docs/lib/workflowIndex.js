'use strict';

// Stage 2 — compiles docs/product/generated/workflow-index.json from the
// canonical docs/product/workflows/AI-WF-###_*.md records (parsed.workflows,
// via lib/parseProductDocs.js's parseWorkflowFile). Same authority rule as
// every other file in docs/product/generated/: a locator/projection layer,
// never hand-edited, never authoritative — the Markdown files under
// docs/product/workflows/ remain the source of truth for Workflow content.

const { extractIds, compareIds } = require('./ids');

function buildWorkflowIndex(parsed) {
  const ids = Array.from(parsed.workflows.keys()).sort(compareIds);
  return ids.map((id) => {
    const wf = parsed.workflows.get(id);
    return {
      id,
      title: wf.name,
      domain: wf.header['Domain'] || 'Evidence pending',
      relatedCapabilities: extractIds(String(wf.header['Related capabilities'] || ''), 'feature'),
      roadmapRelationship: extractIds(String(wf.header['Related roadmap milestone'] || ''), 'roadmap'),
      navigationVerified: wf.header['Navigation verified'] || 'Evidence pending',
      whatItDoes: wf.whatItDoes || null,
      whenToUseIt: wf.whenToUseIt || null,
      beforeYouStart: wf.beforeYouStart || null,
      whereToGo: wf.whereToGo || null,
      steps: wf.steps || [],
      expectedResult: wf.expectedResult || null,
      limitations: wf.limitations || null,
      warnings: wf.warnings || null,
      troubleshooting: wf.troubleshooting || null,
      relatedActions: wf.relatedActions || null,
      relatedActionIds: {
        workflows: extractIds(String(wf.relatedActions || ''), 'workflow'),
        features: extractIds(String(wf.relatedActions || ''), 'feature'),
      },
      canonicalDocument: wf.filePath,
      sourceAuthority: 'canonical', // docs/product/workflows/ tier — authored, human-reviewed, same tier as bugs/decisions
      evidenceStatus: wf.header['Evidence status'] || 'Evidence pending',
    };
  });
}

module.exports = { buildWorkflowIndex };
