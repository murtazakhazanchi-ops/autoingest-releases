import { getLlama } from 'node-llama-cpp';
import path from 'path';

const MODEL_PATH = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24/.claude/worktrees/knowledge-portal-stage2/scripts/product-docs/bench/models/qwen2.5-1.5b-instruct-Q4_K_M.gguf';

async function main() {
  const t0 = Date.now();
  const llama = await getLlama();
  console.log('getLlama() took', Date.now() - t0, 'ms');

  const t1 = Date.now();
  const model = await llama.loadModel({ modelPath: MODEL_PATH });
  console.log('loadModel() took', Date.now() - t1, 'ms');

  const t2 = Date.now();
  const embeddingContext = await model.createEmbeddingContext();
  console.log('createEmbeddingContext() took', Date.now() - t2, 'ms');

  const texts = [
    'Writes a clean mirror of selected events to a portable drive for physical transport.',
    'How do I send my photos to another drive?',
    'Detects connected storage devices eligible for import.',
  ];
  const embeddings = [];
  for (const t of texts) {
    const ts = Date.now();
    const e = await embeddingContext.getEmbeddingFor(t);
    embeddings.push(e.vector);
    console.log('embedding for', JSON.stringify(t.slice(0, 40)), 'took', Date.now() - ts, 'ms, dim=', e.vector.length);
  }

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  console.log('sim(transfer-export-summary, transfer-question) =', cosine(embeddings[0], embeddings[1]));
  console.log('sim(transfer-export-summary, source-detection-summary) =', cosine(embeddings[0], embeddings[2]));

  process.exit(0);
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
