'use strict';

const { extractIds, compareIds } = require('./ids');

function edge(source, target, relationship, provenancePath, evidenceStatus, note) {
  return { source, target, relationship, provenance_path: provenancePath, evidence_status: evidenceStatus, note: note || null };
}

// Builds the full cross-cutting dependency graph. Every edge cites the exact
// canonical field it came from (provenance_path) — nothing here is inferred
// from naming similarity. evidence_status is "explicit" for every edge since
// each is read directly from an authored field.
function buildGraph(parsed) {
  const nodes = [];
  const edges = [];
  const addNode = (id, type, label, docPath) => nodes.push({ id, type, label, doc_path: docPath || null });

  for (const [id, feat] of parsed.features) addNode(id, 'feature', feat.name, feat.filePath);
  for (const [id, m] of parsed.roadmap) addNode(id, 'milestone', m.name, parsed.roadmapPath);
  for (const [id, b] of parsed.bugs) addNode(id, 'bug', b.name, b.filePath);
  for (const [id, d] of parsed.decisions) addNode(id, 'decision', d.name, d.filePath);
  for (const [id, p] of parsed.postmortems) addNode(id, 'postmortem', p.name, p.filePath);
  if (parsed.conversations) {
    for (const [id, c] of parsed.conversations) addNode(id, 'engineering_conversation', c.name, c.filePath);
  }
  for (const h of parsed.archHeadings) {
    addNode('ARCH-' + h.slug, 'architecture_section', h.text, parsed.archPath + '#' + h.slug);
  }

  // Feature -> Feature (Dependencies, Parent feature, Subfeatures header fields)
  for (const [id, feat] of parsed.features) {
    for (const dep of extractIds(String(feat.header['Dependencies'] || ''), 'feature')) {
      edges.push(edge(id, dep, 'depends_on', `${feat.filePath}#header-table:Dependencies`, 'explicit'));
    }
    for (const parent of extractIds(String(feat.header['Parent feature'] || ''), 'feature')) {
      edges.push(edge(parent, id, 'extended_by', `${feat.filePath}#header-table:Parent-feature`, 'explicit', 'parent extended by this subfeature'));
    }
    for (const sub of extractIds(String(feat.header['Subfeatures'] || ''), 'feature')) {
      edges.push(edge(id, sub, 'extended_by', `${feat.filePath}#header-table:Subfeatures`, 'explicit', 'this feature extended by subfeature'));
    }
    for (const rel of extractIds(String(feat.lifecycle['Related features'] || ''), 'feature')) {
      if (rel !== id) edges.push(edge(id, rel, 'related_to', `${feat.filePath}#lifecycle-metadata:Related-features`, 'explicit'));
    }
    // Feature -> Roadmap milestone (planned_in)
    for (const rm of extractIds(String(feat.header['Related roadmap milestone'] || ''), 'roadmap')) {
      edges.push(edge(id, rm, 'planned_in', `${feat.filePath}#header-table:Related-roadmap-milestone`, 'explicit'));
    }
    // Feature -> Decision (governed_by)
    for (const dec of extractIds(String(feat.lifecycle['Related decisions'] || ''), 'decision')) {
      edges.push(edge(id, dec, 'governed_by', `${feat.filePath}#lifecycle-metadata:Related-decisions`, 'explicit'));
    }
    // Feature -> Bug (affected_by_bug)
    for (const bug of extractIds(String(feat.lifecycle['Related bugs'] || ''), 'bug')) {
      edges.push(edge(id, bug, 'affected_by_bug', `${feat.filePath}#lifecycle-metadata:Related-bugs`, 'explicit'));
    }
    // Feature -> Postmortem
    for (const pm of extractIds(String(feat.lifecycle['Related postmortems'] || ''), 'postmortem')) {
      edges.push(edge(id, pm, 'affected_by_bug', `${feat.filePath}#lifecycle-metadata:Related-postmortems`, 'explicit', 'postmortem'));
    }
    // Feature -> Architecture section
    for (const archLine of String(feat.lifecycle['Related architectural evolution sections'] || '').split(';')) {
      const m = /#([a-z0-9-]+)/.exec(archLine);
      if (m) edges.push(edge(id, 'ARCH-' + m[1], 'documented_by', `${feat.filePath}#lifecycle-metadata:Related-architectural-evolution-sections`, 'explicit'));
    }
  }

  // Roadmap milestone -> Feature (implements: this milestone delivers this feature)
  for (const [rmId, m] of parsed.roadmap) {
    for (const featId of extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature')) {
      edges.push(edge(rmId, featId, 'implements', `${parsed.roadmapPath}#${rmId.toLowerCase()}:Included-AI-FEAT-IDs`, 'explicit'));
    }
    for (const featId of extractIds(String(m.header['Existing features extended'] || ''), 'feature')) {
      edges.push(edge(featId, rmId, 'extended_by', `${parsed.roadmapPath}#${rmId.toLowerCase()}:Existing-features-extended`, 'explicit', 'feature extended by this milestone'));
    }
    for (const dep of extractIds(String(m.header['Dependencies'] || ''), 'roadmap')) {
      edges.push(edge(rmId, dep, 'depends_on', `${parsed.roadmapPath}#${rmId.toLowerCase()}:Dependencies`, 'explicit'));
    }
  }

  // Bug -> Decision, Bug -> Bug, Decision -> Decision (from each record's Related section)
  for (const [id, bug] of parsed.bugs) {
    for (const dec of extractIds(bug.related || '', 'decision')) {
      edges.push(edge(id, dec, 'shaped_by_decision', `${bug.filePath}#related`, 'explicit'));
    }
    for (const other of extractIds(bug.related || '', 'bug')) {
      if (other !== id) edges.push(edge(id, other, 'related_to', `${bug.filePath}#related`, 'explicit'));
    }
    for (const featId of extractIds(String(bug.header['Related feature(s)'] || ''), 'feature')) {
      edges.push(edge(featId, id, 'affected_by_bug', `${bug.filePath}#header-table:Related-feature(s)`, 'explicit'));
    }
  }
  for (const [id, dec] of parsed.decisions) {
    for (const other of extractIds(dec.body, 'decision').filter((x) => x !== id)) {
      edges.push(edge(id, other, 'related_to', `${dec.filePath}#body`, 'explicit', 'decision-to-decision body reference'));
    }
    const supersededBy = /Superseded by (DEC-\d{3})/i.exec(String(dec.header['Status'] || ''));
    if (supersededBy) edges.push(edge(supersededBy[1], id, 'supersedes', `${dec.filePath}#header-table:Status`, 'explicit'));
    // This header field legitimately mixes both ID families (e.g. DEC-007 cites
    // AI-RM-001 alongside AI-FEAT-029; DEC-015 cites AI-RM-002 through AI-RM-009)
    // — extracting only 'feature' here would silently drop every milestone edge.
    const decRelatedRaw = String(dec.header['Related feature(s) / roadmap milestone'] || '');
    for (const featOrRm of [...extractIds(decRelatedRaw, 'feature'), ...extractIds(decRelatedRaw, 'roadmap')]) {
      edges.push(edge(featOrRm, id, 'governed_by', `${dec.filePath}#header-table:Related-feature(s)-/-roadmap-milestone`, 'explicit'));
    }
  }

  // Postmortem -> Feature
  for (const [id, pm] of parsed.postmortems) {
    for (const featId of extractIds(String(pm.header['Related feature(s)'] || ''), 'feature')) {
      edges.push(edge(featId, id, 'affected_by_bug', `${pm.filePath}#header-table:Related-feature(s)`, 'explicit', 'postmortem'));
    }
  }

  // Part 8 — Engineering Conversation -> Feature / Roadmap / Bug / Decision /
  // Memory / Conversation, read from the record's own Relationships table.
  if (parsed.conversations) {
    for (const [id, c] of parsed.conversations) {
      const relSection = require('./markdown').extractSection(c.body, 'Relationships') || '';
      const relTable = require('./markdown').extractHeaderTable(relSection);
      for (const featId of [...extractIds(String(relTable['Primary feature IDs'] || ''), 'feature'), ...extractIds(String(relTable['Secondary feature IDs'] || ''), 'feature')]) {
        edges.push(edge(id, featId, 'conversation_about_feature', `${c.filePath}#relationships`, 'explicit'));
      }
      for (const rmId of extractIds(String(relTable['Roadmap milestone IDs'] || ''), 'roadmap')) {
        edges.push(edge(id, rmId, 'conversation_about_roadmap', `${c.filePath}#relationships`, 'explicit'));
      }
      for (const bugId of extractIds(String(relTable['Related bugs'] || ''), 'bug')) {
        edges.push(edge(id, bugId, 'conversation_reports_bug', `${c.filePath}#relationships`, 'explicit'));
      }
      for (const decId of extractIds(String(relTable['Related decisions'] || ''), 'decision')) {
        edges.push(edge(id, decId, 'conversation_shapes_decision', `${c.filePath}#relationships`, 'explicit'));
      }
      for (const memId of extractIds(String(relTable['Related memory capsules'] || ''), 'memory')) {
        edges.push(edge(id, memId, 'conversation_relates_to_memory', `${c.filePath}#relationships`, 'explicit'));
      }
      for (const otherConvId of extractIds(String(relTable['Related conversations'] || ''), 'conversation')) {
        if (otherConvId !== id) edges.push(edge(id, otherConvId, 'conversation_follows_conversation', `${c.filePath}#relationships`, 'explicit'));
      }
    }
  }

  // Architecture relationship map -> Feature / Bug / Decision / Postmortem
  for (const row of parsed.archRelationshipMap) {
    if (!row.anchorSlug) continue; // unresolved stage->heading join; surfaced by validators as a graph-integrity gap if it matters
    const archId = 'ARCH-' + row.anchorSlug;
    for (const featId of row.features) {
      edges.push(edge(featId, archId, 'documented_by', `${parsed.archPath}#5-relationship-map`, 'explicit'));
    }
    for (const bugId of row.records.bugs) edges.push(edge(archId, bugId, 'related_to', `${parsed.archPath}#5-relationship-map`, 'explicit'));
    for (const decId of row.records.decisions) edges.push(edge(archId, decId, 'related_to', `${parsed.archPath}#5-relationship-map`, 'explicit'));
    for (const pmId of row.records.postmortems) edges.push(edge(archId, pmId, 'related_to', `${parsed.archPath}#5-relationship-map`, 'explicit'));
  }

  // Dedupe identical edges (same source/target/relationship/provenance)
  const seen = new Set();
  const dedupedEdges = [];
  for (const e of edges) {
    const key = [e.source, e.target, e.relationship, e.provenance_path].join('');
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEdges.push(e);
  }
  dedupedEdges.sort((a, b) => {
    return compareIds(a.source, b.source) || compareIds(a.target, b.target) || a.relationship.localeCompare(b.relationship);
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const danglingEdges = dedupedEdges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));

  return {
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: dedupedEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    danglingEdges,
  };
}

module.exports = { buildGraph };
