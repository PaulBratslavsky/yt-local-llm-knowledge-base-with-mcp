import { describe, expect, it, vi, afterEach } from 'vitest';
import { streamCompose } from './NoteComposer';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(gen: AsyncGenerator<string, void, void>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of gen) out.push(delta);
  return out;
}

describe('streamCompose', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // NoteComposer.tsx hand-rolls its own SSE reader for /api/notes/compose
  // rather than going through chat-stream.ts (see task-10-report.md, Fix
  // round 1). Before this fix, a RUN_ERROR frame fell through the parser's
  // only branch (TEXT_MESSAGE_CONTENT) unnoticed, the generator returned as
  // if compose had finished normally, and handleGenerate wrote whatever
  // partial markdown had accumulated into the editor with no error shown.
  it('throws on a RUN_ERROR frame instead of silently ending the generator', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"# Partial note\\n"}\n\n',
        'data: {"type":"RUN_ERROR","message":"fetch failed"}\n\n',
      ]),
    );

    const gen = streamCompose({ videoId: 'v1', prompt: 'summarize' });
    await expect(collect(gen)).rejects.toThrow(/fetch failed/);
  });

  it('still yields deltas and completes normally when no RUN_ERROR occurs (control case)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"# Note\\n"}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Body text."}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const gen = streamCompose({ videoId: 'v1', prompt: 'summarize' });
    await expect(collect(gen)).resolves.toEqual(['# Note\n', 'Body text.']);
  });
});
