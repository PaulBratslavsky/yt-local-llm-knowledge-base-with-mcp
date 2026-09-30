// Resolving the videos a digest is built from.
//
// Both digest orchestrators (`generateDigestArticleByIds`,
// `generateDigestByIds`) and the /digest loader each had their own copy of
// this lookup, and all three shared two bugs:
//
//   - They pushed into a shared array from inside `Promise.all`, so the
//     result was in *completion* order. `formatVideoForSynthesis` labels
//     videos "Video 1..N", so an identical selection produced a different
//     prompt on every run — against ADR-0006's premise that a video set
//     maps to a stable digest.
//   - They wrapped fetchers that already return null for a dead backend in
//     `.catch(() => null)`, so "Strapi is down" reached the user as
//     "Could not find: abc123" — the row looked deleted (ADR-0007).

import {
  fetchVideoByDocumentIdWithStatusService,
  fetchVideoByVideoIdWithStatusService,
} from './videos';
import type { StrapiVideo } from './videos';

export type DigestVideoResolution =
  | { status: 'ok'; videos: StrapiVideo[] }
  | { status: 'missing'; missing: string[] }
  | { status: 'backend-error'; error: string };

/** Resolve each identifier by youtubeVideoId, falling back to documentId.
 *
 *  Order matches `identifiers`. A backend failure is reported as itself and
 *  takes precedence over missing rows: when Strapi is unreachable we cannot
 *  know whether anything is missing. */
export async function resolveDigestVideos(
  identifiers: string[],
): Promise<DigestVideoResolution> {
  type One =
    | { kind: 'found'; video: StrapiVideo }
    | { kind: 'missing'; id: string }
    | { kind: 'error'; error: string };

  const resolved: One[] = await Promise.all(
    identifiers.map(async (id): Promise<One> => {
      const byVid = await fetchVideoByVideoIdWithStatusService(id);
      if (byVid.error) return { kind: 'error', error: byVid.error };
      if (byVid.video) return { kind: 'found', video: byVid.video };

      const byDoc = await fetchVideoByDocumentIdWithStatusService(id);
      if (byDoc.error) return { kind: 'error', error: byDoc.error };
      if (byDoc.video) return { kind: 'found', video: byDoc.video };
      return { kind: 'missing', id };
    }),
  );

  const failed = resolved.find((r): r is Extract<One, { kind: 'error' }> => r.kind === 'error');
  if (failed) return { status: 'backend-error', error: failed.error };

  const missing = resolved.flatMap((r) => (r.kind === 'missing' ? [r.id] : []));
  if (missing.length > 0) return { status: 'missing', missing };

  return {
    status: 'ok',
    videos: resolved.flatMap((r) => (r.kind === 'found' ? [r.video] : [])),
  };
}
