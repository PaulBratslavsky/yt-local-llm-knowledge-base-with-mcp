import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import {
  ASK_LIBRARY_SYSTEM,
  formatPassagesForPrompt,
  retrievePassagesForQuery,
  type RetrievedPassage,
} from '#/lib/services/ask-library';
import { OLLAMA_HOST, OLLAMA_CHAT_MODEL as CHAT_MODEL } from '#/lib/env';

// Streaming library-QA endpoint. Parallels /api/chat in shape:
//   - AG-UI style SSE (TEXT_MESSAGE_CONTENT + [DONE])
//   - Custom `data: {"type":"CITATIONS",...}` pre-stream event carrying
//     the retrieved passage metadata so the client can render clickable
//     citation chips as soon as [N] markers appear in the streamed text.
//
// The client reads the CITATIONS frame first, then accumulates text
// deltas. Chips resolve to { video, startSec, text } by passage index.

type CitationPayload = {
  index: number;
  videoDocumentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  startSec: number;
  endSec: number;
  text: string;
};

function toCitationPayload(p: RetrievedPassage, i: number): CitationPayload {
  return {
    index: i,
    videoDocumentId: p.video.documentId,
    youtubeVideoId: p.video.youtubeVideoId,
    videoTitle: p.video.videoTitle,
    videoAuthor: p.video.videoAuthor,
    videoThumbnailUrl: p.video.videoThumbnailUrl,
    startSec: p.startSec,
    endSec: p.endSec,
    text: p.text,
  };
}

export const Route = createFileRoute('/api/ask')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { question?: string };
        try {
          body = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }
        const question = body.question?.trim();
        if (!question || question.length > 1000) {
          return new Response('question required (1–1000 chars)', {
            status: 400,
          });
        }

        // Retrieve top 15 passages. Shared helper so this stays aligned
        // with /search moment-search ranking.
        let passages: RetrievedPassage[];
        try {
          passages = await retrievePassagesForQuery(question, {
            maxVideos: 5,
            passagesPerVideo: 3,
            minScore: 0.35,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'retrieval failed';
          return new Response(`retrieval failed: ${msg}`, { status: 500 });
        }

        if (passages.length === 0) {
          // Short-circuit: no passages means nothing to synthesize from.
          // Send a single response saying so. Still via SSE so the
          // client code path is uniform.
          const body = [
            `data: ${JSON.stringify({ type: 'CITATIONS', citations: [] })}\n\n`,
            `data: ${JSON.stringify({
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'ask-empty',
              delta:
                "I couldn't find anything in your library that matches this question. Try rephrasing, or add more videos that cover the topic.",
            })}\n\n`,
            'data: [DONE]\n\n',
          ].join('');
          return new Response(body, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          });
        }

        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [ask] "${question}" → ${passages.length} passages → synthesizing`,
        );

        const userPrompt = [
          `Question: ${question}`,
          '',
          formatPassagesForPrompt(passages),
        ].join('\n');

        const adapter = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);
        const stream = chat({
          adapter,
          messages: [
            { role: 'system', content: ASK_LIBRARY_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          temperature: 0.2,
        });

        // Build a combined stream: one CITATIONS frame up front, then
        // the normal chat SSE stream. Both follow the AG-UI-ish shape
        // the client already knows from /api/chat.
        const citationsFrame = `data: ${JSON.stringify({
          type: 'CITATIONS',
          citations: passages.map(toCitationPayload),
        })}\n\n`;

        const baseResponse = toServerSentEventsResponse(stream);
        const baseReader = baseResponse.body!.getReader();
        const encoder = new TextEncoder();

        const combined = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(citationsFrame));
            try {
              while (true) {
                const { value, done } = await baseReader.read();
                if (done) break;
                controller.enqueue(value);
              }
            } finally {
              controller.close();
            }
          },
        });

        return new Response(combined, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      },
    },
  },
});
