// Generate a digest's long-form article and keep it.
//
// Two steps that can each fail independently, which is why this is a
// three-way result rather than a boolean. The route used to run both
// inline and return `{ ok: true }` after the save regardless of whether
// the save worked — the `if (saved.status === 'ok')` branch had no `else`.
// The article rendered, nothing was stored, the user was told nothing, and
// the work was gone on the next reload (issue #10).
//
// The two operations are passed in rather than imported. They are TanStack
// server functions, so injecting them keeps this workflow testable without
// a router, a network, or React.

import type { Digest } from './digest';

/** What the page learns about the saved row. Deliberately only the two
 *  fields a save actually tells us — the previous code spread
 *  `{} as StrapiDigest` to satisfy the wider type, claiming an id, title,
 *  videos and timestamps it did not have. */
export type SavedDigestRef = {
  documentId: string;
  articleMarkdown: string | null;
};

export type GenerateArticleFn = (
  videoIds: string[],
) => Promise<{ status: 'ok'; article: string } | { status: 'error'; error: string }>;

export type SaveDigestFn = (input: {
  digest: Digest;
  youtubeVideoIds: string[];
  articleMarkdown: string;
}) => Promise<
  { status: 'ok'; digestDocumentId: string } | { status: 'error'; error: string }
>;

export type DigestArticleOutcome =
  | { status: 'ok'; article: string; saved: SavedDigestRef }
  | { status: 'generate-failed'; error: string }
  /** The model did the work and the article is worth showing — it just was
   *  not kept. A different message from "generation failed", and the
   *  difference matters to someone deciding whether to retry. */
  | { status: 'save-failed'; article: string; error: string };

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function generateAndSaveDigestArticle(input: {
  digest: Digest;
  videoIds: string[];
  generate: GenerateArticleFn;
  save: SaveDigestFn;
}): Promise<DigestArticleOutcome> {
  let generated: Awaited<ReturnType<GenerateArticleFn>>;
  try {
    generated = await input.generate(input.videoIds);
  } catch (err) {
    return { status: 'generate-failed', error: messageFrom(err) };
  }

  if (generated.status === 'error') {
    return { status: 'generate-failed', error: generated.error };
  }

  const article = generated.article;

  // Upsert, so this also persists the structured digest the first time —
  // consistent with the video reader, where generating auto-persists.
  let saved: Awaited<ReturnType<SaveDigestFn>>;
  try {
    saved = await input.save({
      digest: input.digest,
      youtubeVideoIds: input.videoIds,
      articleMarkdown: article,
    });
  } catch (err) {
    return { status: 'save-failed', article, error: messageFrom(err) };
  }

  if (saved.status === 'error') {
    return { status: 'save-failed', article, error: saved.error };
  }

  return {
    status: 'ok',
    article,
    saved: { documentId: saved.digestDocumentId, articleMarkdown: article },
  };
}
