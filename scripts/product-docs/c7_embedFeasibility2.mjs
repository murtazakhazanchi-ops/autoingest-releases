import { getLlama } from 'node-llama-cpp';

const MODEL_PATH = '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/bge-small-en-v1.5-q8_0.gguf';

async function main() {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: MODEL_PATH });
  const ec = await model.createEmbeddingContext();

  const items = [
    { id: 'query', text: 'How do I send my photos to another drive?' },
    { id: 'AI-FEAT-038', text: 'Transfer Export: Writes a clean, archive-aware mirror of selected events from the Active Archive Root to a Transfer Drive, for physical transport to the Main Archive Root.' },
    { id: 'AI-FEAT-011', text: 'Source Detection: Detects connected storage devices eligible for import: polls for drives, filters by DCIM presence, and recognizes Sony camera folder conventions.' },
    { id: 'AI-FEAT-047', text: 'QMZ Sequencing Workspace: a standalone sequencing workspace distinct from standard Event Import, with its own root and durable state file.' },
    { id: 'AI-FEAT-025', text: 'Checksum-Based File Verification: Two distinct, real, hash-based verification mechanisms for an import-batch checksum run and a Local-First sync-job checksum run.' },
  ];
  const embeddings = {};
  for (const it of items) {
    const e = await ec.getEmbeddingFor(it.text);
    embeddings[it.id] = e.vector;
  }
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  console.log('Query:', items[0].text);
  for (const it of items.slice(1)) {
    console.log('  sim(query,', it.id + ')', '=', cosine(embeddings.query, embeddings[it.id]).toFixed(4));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
