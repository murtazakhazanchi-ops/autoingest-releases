'use strict';

// Stage 1 Knowledge Engine — minimal local static+API server (AI-FEAT-058
// Phase 9). Node core `http`/`url`/`fs` modules only — no framework, no new
// npm dependency, matching this tool's existing "no npm dependencies added"
// convention (see scripts/product-docs/README.md). Binds to 127.0.0.1 only
// — never 0.0.0.0 — so it is never reachable from outside the local
// machine; this is a developer/reviewer prototype tool, not a hosted
// service. Serves the static portal page and answers real questions
// through lib/knowledgeEngine.js directly (no duplicate ranking logic —
// see that module's own header comment for why a second implementation in
// the browser was deliberately rejected).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const build = require('../lib/build');
const md = require('../lib/markdown');
const { answerQuestion, buildEngineContext } = require('../lib/knowledgeEngine');
// Phase C3 -- the ONE new production caller wired to real semantic
// authority in this checkpoint. Deliberately minimal: /api/ask is already
// a plain async-friendly Node http handler, and unlike the CLI's `ask`
// command (see lib/knowledgeCli.js's own header comment) this portal
// never advertised a "deterministic only, no external AI" invariant of
// its own -- it already exists to answer real operator-style questions.
// NOTE: this server always runs under plain `node` (see this file's own
// header comment -- never inside Electron), so the real local judge
// runtime can never actually load here (utilityProcess is Electron-only);
// answerQuestionWithAuthority() degrades every authority-sensitive
// question to a safe UNKNOWN via the same model-unavailable path proven
// in scripts/product-docs/test/answerWithAuthority.test.js. This still
// proves the full scope-gate/availability-gate/safe-fallback code path
// end to end in real production code; the "judge actually runs" path is
// proven separately, inside a real Electron process, by
// services/localJudge/electronBenchmark.js.
const { answerQuestionWithAuthority } = require('../lib/answerWithAuthority');

const STATIC_DIR = __dirname;
const INDEX_FILE = path.join(STATIC_DIR, 'index.html');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res, status, filePath) {
  const content = fs.readFileSync(filePath);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': content.length });
  res.end(content);
}

// Phase C3: async so /api/ask can await answerQuestionWithAuthority()
// (every other branch remains fully synchronous, unchanged, and simply
// resolves immediately). Callers must await/catch this -- see
// startServer() below, updated accordingly.
async function handleRequest(req, res) {
  let parsed;
  try {
    parsed = new URL(req.url, 'http://127.0.0.1');
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid URL' });
    return;
  }

  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    sendHtml(res, 200, INDEX_FILE);
    return;
  }

  if (parsed.pathname === '/api/capabilities') {
    const { built } = build.assemble();
    sendJson(res, 200, { capabilities: built.knowledgeIndex });
    return;
  }

  if (parsed.pathname === '/api/workflows') {
    const { built } = build.assemble();
    sendJson(res, 200, { workflows: built.workflowIndex });
    return;
  }

  if (parsed.pathname === '/api/roadmap') {
    const { built } = build.assemble();
    sendJson(res, 200, { milestones: built.dashboard.milestones, currentMilestoneId: built.dashboard.current_milestone_id, progressPercent: built.dashboard.progress_percent });
    return;
  }

  // Stage 2, Phase 22 — project-health snapshot for the Status tab. Read
  // directly from the same regenerated roadmap-dashboard.json source as
  // /api/roadmap, never hand-typed — no field here is invented.
  if (parsed.pathname === '/api/status') {
    const { built } = build.assemble();
    const d = built.dashboard;
    sendJson(res, 200, {
      totalFeatures: d.total_features,
      featureStatusCounts: d.feature_status_counts_overall,
      totalMilestones: d.total_milestones,
      completedMilestones: d.completed_count,
      progressPercent: d.progress_percent,
      currentMilestoneId: d.current_milestone_id,
      nextMilestoneId: d.next_milestone_id,
      blockers: d.blockers,
      currentRisks: d.current_risks,
      recentlyCompleted: d.recently_completed_documentation_work,
      nextPlannedAction: d.next_planned_action,
      evidenceGapsNote: d.evidence_gaps_note,
    });
    return;
  }

  // Stage 2, Phase 22 — Troubleshooting tab data: every Workflow's own
  // authored Troubleshooting section (grounded operator guidance) plus a
  // plain directory of canonical BUG-### records (id/status/severity/
  // related features/citation path only — never the full bug narrative
  // rendered as if it were operator-facing instructions).
  if (parsed.pathname === '/api/troubleshooting') {
    const { built, parsed: p } = build.assemble();
    const workflowTroubleshooting = built.workflowIndex
      .filter((w) => w.troubleshooting)
      .map((w) => ({ id: w.id, title: w.title, troubleshooting: w.troubleshooting, canonicalDocument: w.canonicalDocument }));
    const bugs = Array.from(p.bugs.values()).map((b) => ({
      id: b.id,
      name: b.name,
      status: b.header['Status'] || 'Evidence pending',
      severity: b.header['Severity'] || 'Evidence pending',
      relatedFeatures: b.header['Related feature(s)'] || 'Evidence pending',
      symptom: md.extractSection(b.body, 'Symptom'),
      filePath: b.filePath,
    })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    sendJson(res, 200, { workflowTroubleshooting, bugs });
    return;
  }

  // Stage 2, Phase 23 — directory/onboarding browsing mode: a flat,
  // browsable index across every record type, for exploring the knowledge
  // base without needing to phrase a question first. Every row is a
  // passthrough of already-generated/canonical data — nothing computed or
  // invented here.
  if (parsed.pathname === '/api/directory') {
    const { built, parsed: p } = build.assemble();
    const features = built.knowledgeIndex.map((k) => ({ id: k.id, title: k.title, category: k.category, status: k.operatorStatus, kind: 'Capability' }));
    const workflows = built.workflowIndex.map((w) => ({ id: w.id, title: w.title, category: w.domain, status: 'AVAILABLE', kind: 'Workflow' }));
    const bugs = Array.from(p.bugs.values()).map((b) => ({ id: b.id, title: b.name, category: 'Troubleshooting', status: b.header['Status'] || 'Evidence pending', kind: 'Bug' }));
    const decisions = Array.from(p.decisions.values()).map((d) => ({ id: d.id, title: d.name, category: 'Decision', status: d.header['Status'] || 'Evidence pending', kind: 'Decision' }));
    const all = [...features, ...workflows, ...bugs, ...decisions].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    sendJson(res, 200, { entries: all });
    return;
  }

  if (parsed.pathname === '/api/ask') {
    const question = parsed.searchParams.get('q') || '';
    if (!question.trim()) {
      sendJson(res, 400, { error: 'Missing ?q=<question>' });
      return;
    }
    const { built } = build.assemble();
    const answer = await answerQuestionWithAuthority(question, buildEngineContext(built));
    sendJson(res, 200, answer);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    // handleRequest() is now async (Phase C3) -- Promise.resolve(...).catch()
    // ensures BOTH a synchronous throw (existing behavior) and an async
    // rejection from an awaited answerQuestionWithAuthority() call are
    // caught the same way, rather than becoming an unhandled rejection.
    Promise.resolve()
      .then(() => handleRequest(req, res))
      .catch((err) => {
        sendJson(res, 500, { error: err.message });
      });
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`AutoIngest Knowledge Engine prototype — http://127.0.0.1:${port}`);
    console.log('Local only (127.0.0.1) — not reachable from any other machine. Ctrl-C to stop.');
  });
  return server;
}

module.exports = { startServer };
