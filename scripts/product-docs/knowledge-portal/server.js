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
const { answerQuestion, knowledgeIndexMap } = require('../lib/knowledgeEngine');

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

function handleRequest(req, res) {
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

  if (parsed.pathname === '/api/roadmap') {
    const { built } = build.assemble();
    sendJson(res, 200, { milestones: built.dashboard.milestones, currentMilestoneId: built.dashboard.current_milestone_id, progressPercent: built.dashboard.progress_percent });
    return;
  }

  if (parsed.pathname === '/api/ask') {
    const question = parsed.searchParams.get('q') || '';
    if (!question.trim()) {
      sendJson(res, 400, { error: 'Missing ?q=<question>' });
      return;
    }
    const { built } = build.assemble();
    const answer = answerQuestion(question, {
      searchIndex: built.searchIndex,
      knowledgeIndexById: knowledgeIndexMap(built.knowledgeIndex),
    });
    sendJson(res, 200, answer);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`AutoIngest Knowledge Engine prototype — http://127.0.0.1:${port}`);
    console.log('Local only (127.0.0.1) — not reachable from any other machine. Ctrl-C to stop.');
  });
  return server;
}

module.exports = { startServer };
