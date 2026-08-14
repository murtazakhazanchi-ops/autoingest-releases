'use strict';

// Part 2 remediation (Decision 5) — the hybrid dependency-model generator.
// 12_DEPENDENCY_MODEL.md is a canonical spine document (docs/product/
// CLAUDE.md's hierarchy), not a generated-only artifact, so it can never
// move to generated/ or become fully machine-authored — its own
// "Methodology" prose and interpretive framing stay hand-written. But the
// relationship TABLES it contains are exactly the kind of data every other
// generated/ artifact already derives from the same parsed canonical
// Markdown — hand-copying them risks silent drift the same way any other
// generated/ artifact would if hand-maintained (see that directory's own
// "never edit by hand" rule). This module renders ONLY the data fragments
// for the tables whose source data is already fully parsed elsewhere in
// this tool (no new prose-scanning parser was written for this pass — see
// each function's own comment for exactly what's covered and what's
// deliberately left hand-authored).
//
// Each fragment is inserted into the canonical file between a matching
// pair of HTML-comment markers (see applyGeneratedRegions below) — the
// single source of truth is the same `built`/`parsed` state every other
// generated/ file already consumes; regenerating never require reading
// anything back out of 12_DEPENDENCY_MODEL.md itself.

const { extractIds, compareIds } = require('./ids');
const path = require('path');

function idList(ids) {
  return ids.length ? ids.join(', ') : 'None';
}

// Milestone -> Features. Source: parsed.roadmap (parsed.roadmapOrder gives
// the canonical AI-RM-### ordering) — the exact same fields
// lib/roadmapDashboard.js already reads for the roadmap dashboard, so this
// can never disagree with that dashboard without both being regenerated
// from the same edit.
function renderMilestoneFeaturesFragment(parsed) {
  const rows = parsed.roadmapOrder.map((id) => {
    const m = parsed.roadmap.get(id);
    const status = m.header['Status'] || 'Evidence pending';
    const included = extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature');
    const extended = extractIds(String(m.header['Existing features extended'] || ''), 'feature');
    const featLinks = (ids) => ids.length
      ? ids.map((fid) => {
        const feat = parsed.features.get(fid);
        return feat ? `[${fid}](features/${path.basename(feat.filePath)})` : fid;
      }).join(', ')
      : '—';
    return `| **${id}** — ${m.name} | ${status} | ${featLinks(included) === '—' ? 'None' : featLinks(included)} | ${featLinks(extended)} |`;
  });
  return [
    '| Milestone | Status | Included features (delivered by this milestone) | Existing features extended |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

// Milestone / Feature -> Workflow. NEW table (Part 2 Decision 5 — Workflows
// were entirely unrepresented in this document before). Source:
// workflowIndex (lib/workflowIndex.js), already parsed from docs/product/
// workflows/AI-WF-###_*.md — no new parsing logic.
function renderWorkflowRelationshipFragment(workflowIndex, parsed) {
  if (!workflowIndex || !workflowIndex.length) {
    return '_No Workflow records exist yet — see [workflows/README.md](workflows/README.md)._';
  }
  const rows = workflowIndex.map((w) => {
    const featLinks = w.relatedCapabilities.length
      ? w.relatedCapabilities.map((fid) => {
        const feat = parsed.features.get(fid);
        return feat ? `[${fid}](features/${path.basename(feat.filePath)})` : fid;
      }).join(', ')
      : 'None';
    const rm = w.roadmapRelationship.length ? w.roadmapRelationship.join(', ') : 'None';
    return `| [${w.id}](workflows/${path.basename(w.canonicalDocument)}) | ${w.domain} | ${featLinks} | ${rm} |`;
  });
  return [
    '| Workflow | Domain | Related capabilities | Related roadmap milestone |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

// Feature -> Postmortem. Source: parsed.postmortems' own "Related
// feature(s)" header field (same field lib/searchIndex.js already reads).
function renderFeaturePostmortemFragment(parsed) {
  const ids = Array.from(parsed.postmortems.keys()).sort(compareIds);
  if (!ids.length) return '_No postmortem records exist yet._';
  const rows = ids.map((id) => {
    const p = parsed.postmortems.get(id);
    const featIds = extractIds(String(p.header['Related feature(s)'] || ''), 'feature');
    const featLinks = featIds.length
      ? featIds.map((fid) => {
        const feat = parsed.features.get(fid);
        return feat ? `[${fid}](features/${path.basename(feat.filePath)})` : fid;
      }).join(', ')
      : 'None';
    return `| [${id}](postmortems/${path.basename(p.filePath)}) | ${featLinks} |`;
  });
  return [
    '| Postmortem | Related features |',
    '|---|---|',
    ...rows,
  ].join('\n');
}

// Feature -> Engineering Memory (Part 6). Source: memoryIndex (already
// built by lib/memoryIndex.js from docs/product/memory/AI-MEM-####_*.md).
function renderMemoryFragment(memoryIndex, parsed) {
  if (!memoryIndex || !memoryIndex.length) return '_No Memory Capsules exist yet._';
  const rows = memoryIndex.map((m) => {
    const featLinks = m.feature_ids.length
      ? m.feature_ids.map((fid) => {
        const feat = parsed.features.get(fid);
        return feat ? `[${fid}](features/${path.basename(feat.filePath)})` : fid;
      }).join(', ')
      : 'None';
    const relBugsDecisions = [...m.bug_ids, ...m.decision_ids];
    return `| [${m.memory_id}](memory/${path.basename(m.canonical_path)}) | ${featLinks} | ${relBugsDecisions.length ? idList(relBugsDecisions) : 'None recorded'} |`;
  });
  return [
    '| Memory Capsule | Related features | Related bugs/decisions |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
}

// Feature -> Engineering Conversation (Part 8). Source: conversationIndex
// (already built by lib/conversationIndex.js).
function renderConversationFragment(conversationIndex) {
  if (!conversationIndex || !conversationIndex.length) return '_No Engineering Conversation records exist yet._';
  const rows = conversationIndex.map((c) => {
    const featLinks = c.feature_ids.length ? idList(c.feature_ids) : 'None — see the conversation\'s own Scope';
    return `| [${c.conversation_id}](conversations/${path.basename(c.canonical_path)}) | ${featLinks} |`;
  });
  return [
    '| Conversation | Related features |',
    '|---|---|',
    ...rows,
  ].join('\n');
}

// Replaces the interior of every `<!-- GENERATED:BEGIN id --> ... <!--
// GENERATED:END id -->` marker pair found in `content` with the fragment
// returned by `regions[id]`, if one is supplied. A region whose id isn't in
// `regions` is left untouched (never deleted) — this is deliberate: a
// canonical file may carry a generated region this particular caller
// doesn't know how to regenerate yet, and silently blanking it would be a
// data-loss bug, not a feature. Unknown/malformed marker pairs are left as
// found.
// Captures the begin-marker line and end-marker line verbatim (group 1/4)
// so applyGeneratedRegions can splice in fresh content without needing to
// reconstruct or assume anything about the marker line's own text (e.g. the
// parenthetical regeneration note) — only the interior (group 3) is ever
// replaced.
const REGION_MARKER_RE = /(<!-- GENERATED:BEGIN ([\w-]+)[^>]*-->\n)([\s\S]*?)(\n<!-- GENERATED:END \2 -->)/g;

function applyGeneratedRegions(content, regions) {
  return content.replace(REGION_MARKER_RE, (full, beginLine, id, _body, endLine) => {
    if (!Object.prototype.hasOwnProperty.call(regions, id)) return full;
    return `${beginLine}${regions[id]}${endLine}`;
  });
}

// Reads back every `<!-- GENERATED:BEGIN id --> ... <!-- GENERATED:END id
// -->` region currently present in `content`, keyed by region id — used by
// the validate-time freshness check (lib/validators.js's
// checkDependencyModelFreshness) to compare what's on disk against a fresh
// rebuild, the same way checkGeneratedFreshness already does for
// docs/product/generated/.
function extractGeneratedRegions(content) {
  const found = {};
  let m;
  const re = new RegExp(REGION_MARKER_RE.source, 'g');
  while ((m = re.exec(content))) found[m[2]] = m[3];
  return found;
}

// Computes every generated region's fresh content in one call, from the
// same `parsed`/`built` state every other generated/ artifact already
// consumes — the single source of truth Decision 5 requires. Both `build`
// (lib/build.js, via cli.js's cmdBuild) and `validate`
// (lib/validators.js's checkDependencyModelFreshness) call this so the two
// can never independently drift on what "fresh" means.
function computeDependencyModelRegions(parsed, built) {
  return {
    'milestone-features': renderMilestoneFeaturesFragment(parsed),
    'workflow-relationships': renderWorkflowRelationshipFragment(built.workflowIndex, parsed),
    'feature-postmortem': renderFeaturePostmortemFragment(parsed),
    'feature-memory': renderMemoryFragment(built.memoryIndex, parsed),
    'feature-conversation': renderConversationFragment(built.conversationIndex),
  };
}

module.exports = {
  renderMilestoneFeaturesFragment,
  renderWorkflowRelationshipFragment,
  renderFeaturePostmortemFragment,
  renderMemoryFragment,
  renderConversationFragment,
  applyGeneratedRegions,
  extractGeneratedRegions,
  computeDependencyModelRegions,
};
