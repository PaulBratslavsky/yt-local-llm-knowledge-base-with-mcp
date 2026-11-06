// Server-side embedding READ utilities for MCP tools.
//
// Strapi does not compute embeddings. Inference runs in the TanStack app,
// next to Ollama (client/src/lib/services/embeddings.ts), and writes the
// vectors to Strapi; /settings is where reindexing happens. This file only
// reads stored vectors — cosine similarity, and whether a stored vector is
// current — so the MCP tools that use it work on a hosted Strapi with no
// Ollama beside it.
//
// The staleness check must agree with the client: change
// OLLAMA_EMBEDDING_MODEL or EMBEDDING_VERSION in both places, or every
// vector reads as stale here.

const OLLAMA_EMBEDDING_MODEL =
  process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';
// v2 default matches the client — v2 introduced task prefixes
// (`search_query: / search_document:`) which materially change the vectors.
const EMBEDDING_VERSION = (() => {
  const parsed = parseInt(process.env.EMBEDDING_VERSION ?? '2', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
})();

export const CURRENT_EMBEDDING_MODEL = OLLAMA_EMBEDDING_MODEL;
export const CURRENT_EMBEDDING_VERSION = EMBEDDING_VERSION;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export type EmbeddingStatus = 'missing' | 'stale' | 'current';

export type VideoWithEmbedding = {
  summaryEmbedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingVersion?: number | null;
};

export function embeddingStatus(v: VideoWithEmbedding): EmbeddingStatus {
  if (!v.summaryEmbedding || v.summaryEmbedding.length === 0) return 'missing';
  if (v.embeddingModel !== CURRENT_EMBEDDING_MODEL) return 'stale';
  if (v.embeddingVersion !== CURRENT_EMBEDDING_VERSION) return 'stale';
  return 'current';
}
