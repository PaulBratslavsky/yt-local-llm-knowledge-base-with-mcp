// Topical embeddings for semantic neighbor search over the video library.
//
// Scale assumption: personal KB, <1000 videos. We keep this simple:
//   - One vector per video, from the summary layer (not transcript chunks).
//   - Stored as JSON on the Video row (same pattern as transcriptSegments).
//   - Cosine similarity computed in-memory at query time — fast enough at this
//     scale (1000 × 768-dim dot product ≈ 1–2 ms).
//
// Upgradability:
//   (embeddingModel, embeddingVersion) form a compound invalidation key.
//   Changing either — swap the Ollama model, or change what text the builder
//   concatenates — marks every stored vector stale; the regenerate flow picks
//   them up. Graduating to pgvector or a separate vector DB later is a
//   storage-layer swap; all consumers go through this service boundary.
//
// Same service is intended to power a future Tier-2 passage-level embedding
// (chunked transcript segments inside StoredTranscriptIndex). Only the
// write target and read path differ; `embedText` + `cosineSimilarity` are
// reused verbatim.

import {
  OLLAMA_HOST,
  OLLAMA_EMBEDDING_MODEL,
  EMBEDDING_VERSION,
} from '#/lib/env';
import type { StrapiVideo } from './videos';

export const CURRENT_EMBEDDING_MODEL = OLLAMA_EMBEDDING_MODEL;
export const CURRENT_EMBEDDING_VERSION = EMBEDDING_VERSION;

// Defensive cap. `nomic-embed-text` handles 2048-token inputs (~8000 chars
// for English); we truncate a hair under that so no silent drops.
const MAX_EMBED_CHARS = 8000;

// =============================================================================
// Ollama native embeddings endpoint
// =============================================================================

export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('embedText: empty input');
  const body = trimmed.slice(0, MAX_EMBED_CHARS);

  const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CURRENT_EMBEDDING_MODEL,
      prompt: body,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Ollama embeddings error ${res.status}: ${errText.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error('Ollama returned no embedding');
  }
  return json.embedding;
}

// =============================================================================
// Cosine similarity — hot loop, inlined for speed at >500 videos.
// =============================================================================

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

// =============================================================================
// Text builder — what we actually embed.
//
// Summary-layer only. Transcripts are noisy and too long; the summary already
// encodes "what this video is about" densely. We include tags as user-
// authored topic signal — they bias similarity toward the library's own
// semantic clusters.
//
// If you change what goes in here, bump EMBEDDING_VERSION in env.ts so
// existing stored vectors are flagged stale.
// =============================================================================

export function buildEmbeddingText(video: StrapiVideo): string {
  const parts: string[] = [];
  if (video.videoTitle) parts.push(video.videoTitle);
  if (
    video.summaryTitle &&
    video.summaryTitle !== video.videoTitle
  ) {
    parts.push(video.summaryTitle);
  }
  if (video.summaryDescription) parts.push(video.summaryDescription);
  if (video.summaryOverview) parts.push(video.summaryOverview);
  if (video.keyTakeaways && video.keyTakeaways.length > 0) {
    parts.push(video.keyTakeaways.map((t) => `- ${t.text}`).join('\n'));
  }
  if (video.sections && video.sections.length > 0) {
    parts.push(video.sections.map((s) => s.heading).join('\n'));
  }
  if (video.tags && video.tags.length > 0) {
    parts.push(`Tags: ${video.tags.map((t) => t.name).join(', ')}`);
  }
  return parts.join('\n\n');
}

// =============================================================================
// Staleness check — is the embedding on this row usable with the current
// model + version, or does it need regeneration?
// =============================================================================

export function isEmbeddingCurrent(video: StrapiVideo): boolean {
  if (!video.summaryEmbedding || video.summaryEmbedding.length === 0) {
    return false;
  }
  if (video.embeddingModel !== CURRENT_EMBEDDING_MODEL) return false;
  if (video.embeddingVersion !== CURRENT_EMBEDDING_VERSION) return false;
  return true;
}

export type VideoEmbeddingStatus =
  | 'missing'      // no vector stored
  | 'stale'        // stored but model/version mismatch
  | 'current';     // stored and matches current env

export function embeddingStatus(video: StrapiVideo): VideoEmbeddingStatus {
  if (!video.summaryEmbedding || video.summaryEmbedding.length === 0) {
    return 'missing';
  }
  if (
    video.embeddingModel !== CURRENT_EMBEDDING_MODEL ||
    video.embeddingVersion !== CURRENT_EMBEDDING_VERSION
  ) {
    return 'stale';
  }
  return 'current';
}

// =============================================================================
// Orchestrator — build text, call Ollama, return the row payload.
// Callers pass the result to `updateVideoEmbeddingService` (videos.ts).
// =============================================================================

export type ComputedEmbedding = {
  embedding: number[];
  model: string;
  version: number;
  generatedAt: string;
};

export async function computeVideoEmbedding(
  video: StrapiVideo,
): Promise<ComputedEmbedding> {
  const text = buildEmbeddingText(video);
  if (!text.trim()) {
    throw new Error(
      'No summary content to embed — generate the summary first.',
    );
  }
  const embedding = await embedText(text);
  return {
    embedding,
    model: CURRENT_EMBEDDING_MODEL,
    version: CURRENT_EMBEDDING_VERSION,
    generatedAt: new Date().toISOString(),
  };
}
