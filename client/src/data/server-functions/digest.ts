import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  generateDigestByIds,
  generateDigestArticleByIds,
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
  type Digest,
} from '#/lib/services/digest';
import {
  updateVideoNotesService,
  fetchVideoByDocumentIdService,
  type StrapiVideo,
} from '#/lib/services/videos';

// =============================================================================
// Generate digest (ephemeral — no DB row)
// =============================================================================

const GenerateDigestSchema = z.object({
  videoIds: z
    .array(z.string().min(1).max(64))
    .min(DIGEST_MIN_VIDEOS)
    .max(DIGEST_MAX_VIDEOS),
});

export type GenerateDigestResult =
  | { status: 'ok'; digest: Digest; videos: StrapiVideo[] }
  | { status: 'error'; error: string };

export const generateDigest = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof GenerateDigestSchema>) =>
    GenerateDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GenerateDigestResult> => {
    const result = await generateDigestByIds(data.videoIds);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', digest: result.digest, videos: result.videos };
  });

// =============================================================================
// Generate digest article (flowing long-form markdown post — like reading
// mode but for the cross-video digest). Ephemeral, lazy.
// =============================================================================

export type GenerateDigestArticleResult =
  | { status: 'ok'; article: string; videos: StrapiVideo[] }
  | { status: 'error'; error: string };

export const generateDigestArticle = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof GenerateDigestSchema>) =>
    GenerateDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GenerateDigestArticleResult> => {
    const result = await generateDigestArticleByIds(data.videoIds);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', article: result.article, videos: result.videos };
  });

// =============================================================================
// Save the digest into one of the source videos' notes field
// =============================================================================

const SaveDigestAsNoteSchema = z.object({
  videoDocumentId: z.string().min(1).max(64),
  markdown: z.string().min(1).max(20_000),
});

export const saveDigestAsNote = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof SaveDigestAsNoteSchema>) =>
    SaveDigestAsNoteSchema.parse(data),
  )
  .handler(
    async ({
      data,
    }): Promise<{ status: 'ok' } | { status: 'error'; error: string }> => {
      const video = await fetchVideoByDocumentIdService(data.videoDocumentId);
      if (!video) {
        return { status: 'error', error: 'Video not found' };
      }
      // Append, don't overwrite — prior notes survive.
      const stamp = new Date().toISOString().slice(0, 10);
      const header = `\n\n---\n\n## Digest · ${stamp}\n\n`;
      const combined = (video.notes ?? '') + header + data.markdown;
      const res = await updateVideoNotesService({
        documentId: data.videoDocumentId,
        notes: combined,
      });
      if (!res.success) return { status: 'error', error: res.error };
      return { status: 'ok' };
    },
  );
