// Attach a short note to a video. Append-only — use the Strapi admin panel
// or a future MCP tool to edit/delete. Notes are stored on the Note
// content type (api::note.note) with a many-to-one relation to Video.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z.string().min(1).describe('youtubeVideoId or Video documentId.'),
  body: z.string().min(1).max(4000).describe('The note body. Markdown is fine; rendered in the admin UI.'),
  author: z
    .string()
    .max(120)
    .optional()
    .describe('Optional author label — typically the MCP client name. Defaults to "mcp".'),
});

export const saveNoteTool: ToolDef<z.infer<typeof schema>> = {
  name: 'saveNote',
  description: 'Attach a short note (markdown) to a video. Use this to capture frontier-model observations so they\'re visible later from the app. Append-only — one tool call = one new note.',
  schema,
  execute: async ({ videoId, body, author }, { strapi }) => {
    let video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as { documentId: string } | null;
    if (!video) {
      video = (await strapi.documents('api::video.video').findOne({
        documentId: videoId,
      })) as { documentId: string } | null;
    }
    if (!video) return { error: `No video found for "${videoId}".` };

    // `api::note.note` isn't in the generated ContentType union until the
    // first `strapi build` regenerates types — cast the UID here.
    const noteDocuments = strapi.documents('api::note.note' as never);
    const note = (await noteDocuments.create({
      data: {
        video: video.documentId,
        body,
        author: author ?? 'mcp',
      } as never,
    })) as { documentId: string };

    return {
      noteDocumentId: note.documentId,
      videoDocumentId: video.documentId,
      characters: body.length,
    };
  },
};
