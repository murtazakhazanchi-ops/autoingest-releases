// Phase C7 — bounded semantic candidate-generation PROTOTYPE. Research/
// benchmark tooling only, never wired into production. Consumes the real
// AutoIngest knowledge corpus (canonical record content only — no
// evaluation-question text is ever embedded into the corpus side). Uses a
// small, purpose-built local embedding model (BAAI/bge-small-en-v1.5,
// MIT-licensed, GGUF quantized, ggml-org's own canonical conversion) via
// node-llama-cpp, the SAME library already a production dependency for
// the local judge — no new native dependency, only a new (small, MIT,
// offline-capable) model artifact. Never touches services/localJudge's
// own Phi lifecycle/runtime code at all.
import { getLlama } from 'node-llama-cpp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBED_MODEL_PATH = process.env.C7_EMBED_MODEL || '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/bge-small-en-v1.5-q8_0.gguf';

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Corpus representation (Section 6) — FIELD-AWARE, not whole-record-only:
// one embedded chunk per record, built from title + the most operator-
// relevant canonical fields for that entity type (never Evolution Journal/
// Known Bugs/Decisions/citation-only boilerplate — the same exclusion
// discipline lib/featureIndex.js's own search_keywords already applies).
// Record identity is always recoverable: `id` travels with every chunk.
// bge-small-en-v1.5's context window (512 tokens) is smaller than several
// canonical fields on their own (AI-FEAT-038's Current Behavior alone
// exceeds it) — truncating would silently discard real evidence. Section
// 6 explicitly asks for this to be investigated rather than assumed;
// MULTIPLE SMALLER CHUNKS per record (each field or field-group its own
// chunk, all tagged with the same record id, MAX-pooled at query time —
// see semanticTopK below) is the chosen representation: no information is
// dropped, and a chunk that's independently on-topic can win even if
// other fields on the same record are not.
// Conservative and applied to EVERY field independently, never to a
// combined multi-field string — found necessary by direct measurement:
// this corpus's markdown/code-identifier-heavy text has a materially
// worse tokens-per-character ratio than ordinary prose in places (e.g.
// AI-WF-006's whatItDoes field alone, 3502 chars, still overflowed the
// model's 512-token context even after an earlier, looser 900/450-char
// attempt that combined title+summary into one chunk).
const MAX_CHUNK_CHARS = 300;

function splitLong(text) {
  if (!text) return [];
  const parts = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) parts.push(text.slice(i, i + MAX_CHUNK_CHARS));
  return parts;
}

function pushField(chunks, id, type, title, text) {
  for (const part of splitLong(text)) chunks.push({ id, type, title, text: part });
}

function buildCorpusChunks(built) {
  const chunks = [];
  for (const f of built.featureIndex || []) {
    pushField(chunks, f.feature_id, 'feature', f.name, f.name);
    pushField(chunks, f.feature_id, 'feature', f.name, f.summary);
    pushField(chunks, f.feature_id, 'feature', f.name, f.current_behavior);
  }
  for (const w of built.workflowIndex || []) {
    pushField(chunks, w.id, 'workflow', w.title, w.title);
    pushField(chunks, w.id, 'workflow', w.title, w.whatItDoes);
    pushField(chunks, w.id, 'workflow', w.title, w.whenToUseIt);
    pushField(chunks, w.id, 'workflow', w.title, w.expectedResult);
    pushField(chunks, w.id, 'workflow', w.title, w.troubleshooting);
  }
  // Decisions/postmortems/bugs — rationale/troubleshooting coverage, reuse
  // lib/searchIndex.js's own already-assembled summary+detail fields for
  // these types (Context+Decision / Symptom+RootCause) — nothing new
  // invented, no second parse of the canonical markdown.
  for (const r of built.searchIndex || []) {
    if (!['decision', 'bug', 'postmortem'].includes(r.entity_type)) continue;
    pushField(chunks, r.stable_id, r.entity_type, r.title, r.title);
    pushField(chunks, r.stable_id, r.entity_type, r.title, r.summary);
    pushField(chunks, r.stable_id, r.entity_type, r.title, r.detail);
  }
  return chunks;
}

async function embedAll(ec, texts, batchLabel) {
  const vectors = [];
  const t0 = Date.now();
  for (const t of texts) {
    const e = await ec.getEmbeddingFor(t);
    vectors.push(e.vector);
  }
  const elapsed = Date.now() - t0;
  if (batchLabel) console.error(`[embed] ${batchLabel}: ${texts.length} texts in ${elapsed}ms (${(elapsed / texts.length).toFixed(1)}ms/each)`);
  return vectors;
}

export async function loadEmbeddingContext(modelPath = EMBED_MODEL_PATH) {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const ec = await model.createEmbeddingContext();
  return { llama, model, ec };
}

export async function buildSemanticIndex(built, ec) {
  const chunks = buildCorpusChunks(built);
  const t0 = Date.now();
  const vectors = await embedAll(ec, chunks.map((c) => c.text), 'corpus');
  const indexingMs = Date.now() - t0;
  return { chunks, vectors, indexingMs };
}

// MAX-pooled across a record's own chunks (Section 6's multi-chunk
// representation, chosen over truncation — see buildCorpusChunks' own
// comment) — a record's best-matching chunk decides its score, so a
// record with several distinct chunks gets no unfair advantage or
// penalty purely from chunk count (never summed/averaged, which would).
export async function semanticTopK(question, index, ec, k = 5) {
  const qe = await ec.getEmbeddingFor(question);
  const bestByRecord = new Map();
  for (let i = 0; i < index.chunks.length; i++) {
    const c = index.chunks[i];
    const score = cosine(qe.vector, index.vectors[i]);
    const prev = bestByRecord.get(c.id);
    if (!prev || score > prev.score) bestByRecord.set(c.id, { id: c.id, type: c.type, title: c.title, score });
  }
  const scored = Array.from(bestByRecord.values());
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export { buildCorpusChunks, cosine };
