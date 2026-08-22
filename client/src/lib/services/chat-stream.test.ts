import { describe, expect, it } from 'vitest';
import { streamChatSSE, type StreamEvent } from './chat-stream';

// Build a Response whose body streams the given byte chunks one-by-one
// (so the parser sees realistic split-across-reads behaviour, not a
// single mega-chunk). Used to verify the parser handles partial
// `data:` blocks correctly.
function streamingResponse(chunks: string[]): Response {
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

async function collect(response: Response): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of streamChatSSE(response)) events.push(event);
  return events;
}

describe('streamChatSSE', () => {
  it('yields text events for TEXT_MESSAGE_CONTENT frames', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hello "}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"world"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'text', delta: 'Hello ' },
      { kind: 'text', delta: 'world' },
    ]);
  });

  it('skips events whose type is not in the surfaced set', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"RUN_STARTED"}\n\n',
        'data: {"type":"TEXT_MESSAGE_START","messageId":"m1"}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"hi"}\n\n',
        'data: {"type":"TEXT_MESSAGE_END"}\n\n',
        'data: {"type":"STEP_FINISHED"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'hi' }]);
  });

  it('parses tool_start + tool_end with `toolName` + `input` (VideoChat dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolName":"web_search","input":{"query":"foo"},"result":"[]"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'web_search',
        input: { query: 'foo' },
        result: '[]',
      },
    ]);
  });

  it('parses tool_start + tool_end with `toolCallName` + `args` (DigestChat dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolCallName":"web_search","args":{"q":"x"},"result":null}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'web_search',
        input: { q: 'x' },
        result: null,
      },
    ]);
  });

  // @tanstack/ai 0.47 (verified against live Ollama traffic, 2026-08-22):
  // the ai-ollama adapter's TOOL_CALL_END carries only `input` — no
  // `result` field at all — and the actual execution output arrives later
  // on a separate TOOL_CALL_RESULT event keyed only by `toolCallId`
  // (`content`, no tool name). The parser must merge these into one
  // `tool_end` StreamEvent so VideoChat/DigestChat (which treat `tool_end`
  // as the single source of truth for both input and result) still work.
  it('merges a real-0.47-shaped TOOL_CALL_END (input only) with a later TOOL_CALL_RESULT (content only) into one tool_end', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_1","toolCallName":"web_search","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_ARGS","toolCallId":"call_1","args":"{\\"query\\":\\"x\\"}"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_1","toolCallName":"web_search","toolName":"web_search","input":{"query":"x"}}\n\n',
        'data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_1","content":"{\\"results\\":[]}","role":"tool"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_1',
        name: 'web_search',
        input: { query: 'x' },
        result: '{"results":[]}',
      },
    ]);
  });

  it('still surfaces a tool_end with a null result if TOOL_CALL_RESULT never arrives (stream cut short)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_2","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_2","toolName":"web_search","input":{"query":"y"}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_2', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_2',
        name: 'web_search',
        input: { query: 'y' },
        result: null,
      },
    ]);
  });

  it('does not double-emit tool_end when TOOL_CALL_END already carries a result and TOOL_CALL_RESULT follows for the same id', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_3","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_3","toolName":"web_search","input":{"query":"z"},"result":"ok"}\n\n',
        'data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_3","content":"ok"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_3', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_3',
        name: 'web_search',
        input: { query: 'z' },
        result: 'ok',
      },
    ]);
  });

  // The whole fix rests on keying pending input by toolCallId rather than
  // stream position — two tool calls can be in flight at once (the model
  // requests both, then they execute concurrently server-side), and their
  // TOOL_CALL_RESULT events are not guaranteed to arrive in request order.
  // Call B's END/RESULT interleave with call A's here, and B's RESULT
  // arrives before A's, to prove each result lands on the correct call.
  it('keeps concurrent tool calls correctly paired when their results arrive out of order', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_a","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_b","toolName":"get_video_details"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_a","toolName":"web_search","input":{"query":"a-query"}}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_b","toolName":"get_video_details","input":{"youtubeVideoId":"b-video"}}\n\n',
        // B resolves first even though A was requested first.
        'data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_b","content":"b-result"}\n\n',
        'data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_a","content":"a-result"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_a', name: 'web_search' },
      { kind: 'tool_start', id: 'call_b', name: 'get_video_details' },
      {
        kind: 'tool_end',
        id: 'call_b',
        name: 'get_video_details',
        input: { youtubeVideoId: 'b-video' },
        result: 'b-result',
      },
      {
        kind: 'tool_end',
        id: 'call_a',
        name: 'web_search',
        input: { query: 'a-query' },
        result: 'a-result',
      },
    ]);
  });

  it('handles a frame split across multiple chunks', async () => {
    // The first read ends mid-JSON; the parser must buffer and only
    // emit when it sees the `\n\n` block delimiter.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESS',
        'AGE_CONTENT","delta":"chunked"}',
        '\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'chunked' }]);
  });

  it('handles multiple frames inside one chunk', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"a"}\n\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"b"}\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'text', delta: 'a' },
      { kind: 'text', delta: 'b' },
    ]);
  });

  it('skips invalid JSON in a data: line without throwing', async () => {
    const events = await collect(
      streamingResponse([
        'data: {garbage\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"recovered"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'recovered' }]);
  });

  it('skips events missing required fields', async () => {
    const events = await collect(
      streamingResponse([
        // No delta
        'data: {"type":"TEXT_MESSAGE_CONTENT"}\n\n',
        // No toolCallId
        'data: {"type":"TOOL_CALL_START","toolName":"x"}\n\n',
        // No name (neither dialect)
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([]);
  });

  it('throws when the response has no body', async () => {
    const empty = new Response(null, { status: 200 });
    await expect(collect(empty)).rejects.toThrow(/empty response body/);
  });

  // Verified live (2026-08-22, task-10-report.md): when Ollama dies
  // mid-stream, @tanstack/ai's `toServerSentEventsResponse` gracefully
  // sends a `RUN_ERROR` frame rather than just dropping the connection —
  // e.g. `data: {"type":"RUN_ERROR","message":"proxy error: Error: socket
  // hang up"}`. Before this fix, RUN_ERROR fell into the parser's
  // `default` case and vanished silently: no thrown error, no partial
  // text — the caller's `catch` block (the only place that calls
  // `friendlyOllamaError`) never ran and the user saw the stream just
  // stop with no feedback at all.
  it('throws on a RUN_ERROR frame so the caller can surface it via friendlyOllamaError', async () => {
    const events: StreamEvent[] = [];
    const iterate = async () => {
      for await (const event of streamChatSSE(
        streamingResponse([
          'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"partial"}\n\n',
          'data: {"type":"RUN_ERROR","message":"proxy error: Error: socket hang up"}\n\n',
        ]),
      )) {
        events.push(event);
      }
    };
    await expect(iterate()).rejects.toThrow(/socket hang up/);
    expect(events).toEqual([{ kind: 'text', delta: 'partial' }]);
  });

  it('flushes a trailing block that lacks the final \\n\\n', async () => {
    // Some servers omit the terminating blank line. Defensive parse.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"end"}\n\ndata: [DONE]',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'end' }]);
  });
});
