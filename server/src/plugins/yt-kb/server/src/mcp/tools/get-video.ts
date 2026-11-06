// Full video record including summary, sections, key takeaways, action
// steps, and tags. Use searchTranscript or getTranscript for the transcript
// body itself — this tool stays focused on the AI-generated view.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { POPULATE, resolveByEitherId, videoNotFound } from './video-access';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('Either the youtubeVideoId or the Strapi documentId.'),
});

export const getVideoTool: ToolDef<z.infer<typeof schema>> = {
  name: 'getVideo',
  description:
    'Fetch a full Video record by youtubeVideoId or documentId, including summary title/description/overview, sections (with timecodes), key takeaways, action steps, and tags. Does NOT include the transcript — call getTranscript or searchTranscript for that.',
  schema,
  execute: async ({ videoId }, { strapi }) => {
    const video = await resolveByEitherId(strapi, videoId, {
      populate: POPULATE.full,
    });
    if (!video) return videoNotFound(videoId);

    // Strip the internal retrieval blobs from the response — they're huge
    // (passageEmbeddings alone can be ~800 KB, which doubles past the 1 MB
    // MCP result limit once the adapter mirrors it into structuredContent)
    // and useless to a human-readable tool call. Agents that need the BM25
    // index should use searchTranscript; embeddings back relatedVideos.
    const {
      transcriptSegments,
      passageEmbeddings,
      summaryEmbedding,
      tags,
      ...rest
    } = video as Record<string, unknown> & {
      transcriptSegments?: unknown;
      passageEmbeddings?: unknown;
      summaryEmbedding?: unknown;
      tags?: Array<{ name: string }>;
    };
    void transcriptSegments;
    void passageEmbeddings;
    void summaryEmbedding;

    return {
      ...rest,
      tags: (tags ?? []).map((t) => t.name),
    };
  },
};
