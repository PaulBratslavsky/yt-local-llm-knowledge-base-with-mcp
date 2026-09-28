// Composing one SSE stream out of a locally-built prelude frame and an
// upstream model stream. `/api/ask` needs this: it sends a CITATIONS frame
// before the answer so the client can render citation chips as soon as [N]
// markers appear, then forwards the chat stream unchanged.
//
// Extracted from the route so the mid-stream failure path is testable —
// route handlers aren't reachable from vitest.

const encoder = new TextEncoder();

/** The frame shape the client's two readers already understand as "the
 *  run died" — see chat-stream.ts and useLibraryChat.ts. */
function runErrorFrame(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `data: ${JSON.stringify({ type: 'RUN_ERROR', message })}\n\n`;
}

export function withPreludeFrame(
  source: ReadableStream<Uint8Array>,
  preludeFrame: string,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(preludeFrame));
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (err) {
        // Report the death in-band. `controller.error()` is not an option
        // here: the `finally` below closes the stream, and erroring a
        // closed stream is a no-op — which is exactly how a truncated
        // answer used to reach the browser looking complete.
        controller.enqueue(encoder.encode(runErrorFrame(err)));
      } finally {
        controller.close();
      }
    },
  });
}
