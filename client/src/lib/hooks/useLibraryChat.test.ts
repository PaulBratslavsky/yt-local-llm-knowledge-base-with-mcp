import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAsk } from './useLibraryChat';

// Builds a Response whose body streams the given SSE byte chunks one at a
// time, mirroring how chat-stream.test.ts exercises streamChatSSE — same
// realistic split-across-reads shape.
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

describe('streamAsk', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // useLibraryChat.ts hand-rolls its own SSE reader for /api/ask rather than
  // going through chat-stream.ts (see task-10-report.md, Fix round 1). Before
  // this fix, a RUN_ERROR frame fell through every branch of the frame
  // handler unnoticed, the read loop finished as if the stream had ended
  // normally, and the function resolved — writing a final `setState` call
  // with `status: 'done'`. That's the exact bug already fixed once in
  // chat-stream.ts, alive on a second surface.
  it('rejects on a RUN_ERROR frame instead of silently resolving with status "done"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"partial answer"}\n\n',
        'data: {"type":"RUN_ERROR","message":"fetch failed"}\n\n',
      ]),
    );

    const setState = vi.fn();
    const controller = new AbortController();

    await expect(
      streamAsk('does this survive?', {
        assistantId: 'assistant-1',
        setState,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/fetch failed/);

    // Exactly one setState call: the TEXT_MESSAGE_CONTENT delta. The final
    // `status: 'done'` call that normally follows the read loop must never
    // fire, because the RUN_ERROR frame threw before the loop finished.
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it('still streams text and resolves normally when no RUN_ERROR occurs (control case)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"hello"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const setState = vi.fn();
    const controller = new AbortController();

    await expect(
      streamAsk('a normal question', {
        assistantId: 'assistant-2',
        setState,
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();

    // One call for the streamed delta, one for the final "done" flip.
    expect(setState).toHaveBeenCalledTimes(2);
  });
});
