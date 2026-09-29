// Centralized env var resolution + startup validation.
//
// Every consumer should import resolved constants from here rather than
// reading `process.env` directly, so empty-string overrides ("FOO=") don't
// silently bypass the default value. This module used to live inline inside
// learning.ts/api.chat.tsx, each using `??` — which only falls back on
// null/undefined. Setting `OLLAMA_CHAT_MODEL=` (empty) produced a "model is
// required" error from Ollama at first chat call. Consolidating here with
// `.trim() || fallback` closes that hole in one place.

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** An integer invalidation key from the environment. Falls back to the
 *  shipped default when unset or unparseable — a typo must not silently
 *  invalidate the whole vector store. */
function readVersion(name: string, fallback: number): number {
  const parsed = Number.parseInt(readEnv(name) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const STRAPI_URL = readEnv('STRAPI_URL') ?? 'http://localhost:1340';
const STRAPI_API_TOKEN = readEnv('STRAPI_API_TOKEN');

const TRANSCRIPT_PROXY_URL = readEnv('TRANSCRIPT_PROXY_URL');

const OLLAMA_BASE_URL = readEnv('OLLAMA_BASE_URL') ?? 'http://localhost:11434/v1';
// Ollama's native HTTP API doesn't use the `/v1` OpenAI-compat suffix, but our
// env var keeps it for backward compatibility with older `.env` files. Strip.
const OLLAMA_HOST = OLLAMA_BASE_URL.replace(/\/v1\/?$/, '');

const OLLAMA_MODEL = readEnv('OLLAMA_MODEL') ?? 'gemma4-kb:latest';
const OLLAMA_CHAT_MODEL = readEnv('OLLAMA_CHAT_MODEL') ?? OLLAMA_MODEL;
// Library-wide synthesis (/api/ask) can optionally point at a bigger
// model than the per-video chat default. Falls back to OLLAMA_CHAT_MODEL
// so unset = same as today. Recommended overrides for RAG quality:
// `qwen2.5:7b-instruct`, `llama3.1:8b-instruct-q4_K_M`, `gemma2:9b`.
const OLLAMA_SYNTHESIS_MODEL =
  readEnv('OLLAMA_SYNTHESIS_MODEL') ?? OLLAMA_CHAT_MODEL;
const OLLAMA_EMBEDDING_MODEL =
  readEnv('OLLAMA_EMBEDDING_MODEL') ?? 'nomic-embed-text';

// Bump this when the text-builder in `embeddings.ts` changes (different fields
// concatenated, different ordering, etc.) OR when the task prefix scheme
// in `embedText` changes. Stored `embeddingVersion` on a Video != this →
// the vector is stale and must be recomputed. Used alongside
// `embeddingModel` as a compound invalidation key.
//
// v2 — added `search_query: / search_document:` task prefixes for
//      nomic-embed-text; old v1 vectors have no prefix and produce wrong
//      similarity scores against query-side vectors (baseline ~0.5 for
//      anything English).
// Read from the environment, not hard-coded: the Strapi server reads the
// same variable (server/src/mcp/utils/embeddings.ts) and both halves write
// vectors tagged with it. A literal here meant the documented "bump the
// env-level EMBEDDING_VERSION" procedure moved the server to v3 while the
// client still believed 2 — so every freshly written vector was filtered
// out as stale and retrieval went quietly empty.
//
// The two .env files must agree. See the note in both .env.example files.
const EMBEDDING_VERSION = readVersion('EMBEDDING_VERSION', 2);

// Separate invalidation key for passage embeddings (Tier 2 moment search).
// Bump when the passage chunker's parameters change (target/max window size,
// pause threshold, etc.), the task prefix scheme changes, or the set of
// fields included per chunk changes.
//
// v2 — added `search_document:` prefix to chunk embeddings so cosine against
//      prefixed queries produces meaningful scores.
// v3 — Contextual Retrieval: every chunk's embed text now prepends a
//      short `Video: / Channel: / Tags:` header so the vector carries the
//      parent video's identity. Fixes proper-noun queries where the
//      chunk itself uses pronouns ("the model", "this framework") and
//      dense fails to associate the chunk with its subject.
const PASSAGE_EMBEDDING_VERSION = readVersion('PASSAGE_EMBEDDING_VERSION', 3);

const MAP_CONCURRENCY = (() => {
  const parsed = Number.parseInt(readEnv('MAP_CONCURRENCY') ?? '1', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 4);
})();

// One-shot startup validation. Runs at module load — the first import in any
// request path prints warnings once per process. Doesn't throw: local-first
// should degrade gracefully, and most of these are "works but not ideal".
let validated = false;
function validateOnce() {
  if (validated) return;
  validated = true;
  const warn = (msg: string) => console.warn(`[env] ${msg}`);
  if (!OLLAMA_MODEL) {
    warn('OLLAMA_MODEL resolved to an empty string — Ollama will reject every call with "model is required".');
  }
  if (!OLLAMA_CHAT_MODEL) {
    warn('OLLAMA_CHAT_MODEL resolved to empty — chat + query rewrite will fail.');
  }
  if (!STRAPI_URL) {
    warn('STRAPI_URL resolved to empty — Strapi calls will fail.');
  }
}
validateOnce();

export {
  STRAPI_URL,
  STRAPI_API_TOKEN,
  TRANSCRIPT_PROXY_URL,
  OLLAMA_BASE_URL,
  OLLAMA_HOST,
  OLLAMA_MODEL,
  OLLAMA_CHAT_MODEL,
  OLLAMA_SYNTHESIS_MODEL,
  OLLAMA_EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  PASSAGE_EMBEDDING_VERSION,
  MAP_CONCURRENCY,
};
