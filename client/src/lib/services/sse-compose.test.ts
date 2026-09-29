import { describe, expect, it } from 'vitest';
import { withPreludeFrame } from './sse-compose';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A stream that emits `chunks`, then either ends or rejects. */
function sourceStream(chunks: string[], failWith?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
        return;
      }
      if (failWith) {
        // Reject the read itself — what a dying upstream looks like from
        // the re-piping side.
        controller.error(failWith);
        return;
      }
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

const PRELUDE = `data: ${JSON.stringify({ type: 'CITATIONS', citations: [] })}\n\n`;

describe('withPreludeFrame', () => {
  it('emits the prelude before the source chunks', async () => {
    const out = await drain(
      withPreludeFrame(sourceStream(['data: one\n\n', 'data: two\n\n']), PRELUDE),
    );
    expect(out.indexOf('CITATIONS')).toBeLessThan(out.indexOf('data: one'));
    expect(out).toContain('data: two');
  });

  // The bug: `finally { controller.close() }` ran before the rejection could
  // propagate, and `controller.error()` on a closed stream is a no-op — so
  // the browser saw a clean end-of-stream and marked a truncated answer
  // `done`. The client only learns of a mid-stream death from a RUN_ERROR
  // frame (see chat-stream.ts and useLibraryChat.ts).
  it('emits a RUN_ERROR frame when the source dies mid-stream', async () => {
    const out = await drain(
      withPreludeFrame(
        sourceStream(['data: partial\n\n'], new Error('ollama went away')),
        PRELUDE,
      ),
    );
    expect(out).toContain('data: partial');
    expect(out).toContain('RUN_ERROR');
    expect(out).toContain('ollama went away');
  });

  it('keeps the tokens that arrived before the failure', async () => {
    const out = await drain(
      withPreludeFrame(
        sourceStream(['data: a\n\n', 'data: b\n\n'], new Error('boom')),
        PRELUDE,
      ),
    );
    expect(out).toContain('data: a');
    expect(out).toContain('data: b');
  });

  it('ends cleanly with no RUN_ERROR when the source completes', async () => {
    const out = await drain(withPreludeFrame(sourceStream(['data: done\n\n']), PRELUDE));
    expect(out).not.toContain('RUN_ERROR');
  });
});
