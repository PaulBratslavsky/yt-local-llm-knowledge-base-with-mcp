// SSE parser for TanStack AI's AG-UI chat stream. The server emits
// `data: <json>\n\n` blocks via `toServerSentEventsResponse`; this
// module turns those raw bytes into a typed `StreamEvent` async
// iterator. Used by both `VideoChat` (per-video chat) and `DigestChat`
// (cross-video digest chat); was previously duplicated across both
// consumers with subtle field-name drift between the two copies.
//
// The parser is pure with respect to networking — it consumes a `Response`
// the caller already issued. Each consumer handles its own URL, body,
// and abort logic.

// -----------------------------------------------------------------------------
// Public Interface
// -----------------------------------------------------------------------------

// Events the UI cares about. Run-start / run-end / step / text-start /
// text-end / tool-args (intermediate) are silently dropped — only the
// minimal set needed to update the UI is surfaced.
export type StreamEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool_start'; id: string; name: string }
  | {
      kind: 'tool_end';
      id: string;
      name: string;
      input: unknown;
      result: string | null;
    };

// -----------------------------------------------------------------------------
// Stream parser
// -----------------------------------------------------------------------------

export async function* streamChatSSE(
  response: Response,
): AsyncGenerator<StreamEvent, void, void> {
  if (!response.body) {
    throw new Error('chat-stream: empty response body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // As of @tanstack/ai 0.47, a tool call's `input` and `result` arrive on
  // TWO separate AG-UI events, not one: the ai-ollama adapter emits
  // TOOL_CALL_END the instant the model finishes specifying the call
  // (input only — execution hasn't happened yet), and the chat engine
  // emits a later, separate TOOL_CALL_RESULT once the tool actually runs
  // (carrying `content`, keyed only by `toolCallId`, with no tool name).
  // Verified empirically against live Ollama traffic on 2026-08-22 — see
  // task-10-report.md. Track pending calls here so the public `tool_end`
  // event (which VideoChat/DigestChat treat as the source of truth for
  // both input AND result) still gets built correctly.
  const pendingInput = new Map<string, { name: string; input: unknown }>();
  const emitted = new Set<string>();

  function handleBlock(block: string): StreamEvent | null {
    return parseSseEventBlock(block, pendingInput, emitted);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const eventBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = handleBlock(eventBlock);
        if (event) yield event;
        idx = buffer.indexOf('\n\n');
      }
    }
    // Flush any trailing block after the stream closes (rare — most
    // streams end with the `\n\n` after [DONE], but be defensive).
    buffer += decoder.decode();
    const tail = handleBlock(buffer);
    if (tail) yield tail;

    // Safety net: a tool call whose TOOL_CALL_END arrived but whose
    // TOOL_CALL_RESULT never did (stream cut short mid-execution, an
    // interrupted run) still deserves to reach the UI with its input,
    // rather than vanishing silently.
    for (const [id, { name, input }] of pendingInput) {
      if (!emitted.has(id)) {
        yield { kind: 'tool_end', id, name, input, result: null };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

// Parse one SSE event block (newline-joined `data:` lines) into a typed
// event, or null to skip. The AG-UI wire format has had two field-name
// dialects observed in the wild — `toolName` / `input` vs.
// `toolCallName` / `args` — so we accept both shapes via `??` fallbacks.
// Keeps the parser robust to upstream TanStack AI version drift.
//
// `pendingInput` / `emitted` carry tool-call state across blocks within one
// stream (see streamChatSSE) so a TOOL_CALL_END (input, no result) and its
// later TOOL_CALL_RESULT (result, no name/input) can be merged into a single
// `tool_end` StreamEvent — see the comment in streamChatSSE for why the split
// exists.
function parseSseEventBlock(
  block: string,
  pendingInput: Map<string, { name: string; input: unknown }>,
  emitted: Set<string>,
): StreamEvent | null {
  const lines = block.split('\n');
  let payload = '';
  for (const line of lines) {
    if (line.startsWith('data:')) {
      payload += line.slice(5).trimStart();
    }
  }
  if (!payload || payload === '[DONE]') return null;

  let event: AgUiEvent;
  try {
    event = JSON.parse(payload) as AgUiEvent;
  } catch {
    return null;
  }

  switch (event.type) {
    case 'TEXT_MESSAGE_CONTENT':
      return typeof event.delta === 'string'
        ? { kind: 'text', delta: event.delta }
        : null;
    case 'TOOL_CALL_START': {
      const id = event.toolCallId;
      const name = event.toolName ?? event.toolCallName;
      return id && name ? { kind: 'tool_start', id, name } : null;
    }
    case 'TOOL_CALL_END': {
      const id = event.toolCallId;
      // TOOL_CALL_END is the source of truth for `input` (TOOL_CALL_ARGS
      // events stream args incrementally; we ignore those).
      const name = event.toolName ?? event.toolCallName ?? '';
      if (!id) return null;
      const input = event.input ?? event.args ?? null;
      // Some dialects put the execution result directly on TOOL_CALL_END
      // (e.g. the continuation-replay path in @tanstack/ai's engine). If
      // so, this frame is already complete — emit now and mark it done so
      // a later TOOL_CALL_RESULT for the same id doesn't duplicate it.
      if (event.result !== undefined) {
        emitted.add(id);
        pendingInput.delete(id);
        return { kind: 'tool_end', id, name, input, result: event.result ?? null };
      }
      // Normal @tanstack/ai 0.47 path: only `input` arrives here. The
      // execution result arrives later on a separate TOOL_CALL_RESULT
      // event — stash input and wait for it.
      pendingInput.set(id, { name, input });
      return null;
    }
    case 'TOOL_CALL_RESULT': {
      const id = event.toolCallId;
      if (!id || emitted.has(id)) return null;
      const pending = pendingInput.get(id);
      emitted.add(id);
      pendingInput.delete(id);
      return {
        kind: 'tool_end',
        id,
        name: pending?.name ?? '',
        input: pending?.input ?? null,
        result: event.content ?? event.result ?? null,
      };
    }
    case 'RUN_ERROR': {
      // Confirmed live (2026-08-22, task-10-report.md): when the Ollama
      // backend dies mid-stream, @tanstack/ai's `toServerSentEventsResponse`
      // gracefully emits `data: {"type":"RUN_ERROR","message":"..."}` rather
      // than just dropping the connection — but this parser had no case for
      // it, so the frame silently vanished (fell into `default`) and
      // `VideoChat`'s `catch` block — the only place that calls
      // `friendlyOllamaError` — was never reached. The user saw the message
      // stop mid-stream with zero feedback. Throwing here propagates the
      // failure out of the async generator's `for await`, restoring the
      // intended error path.
      throw new Error(
        typeof event.message === 'string' ? event.message : 'AI run failed',
      );
    }
    default:
      return null;
  }
}

// Loose shape of an AG-UI event JSON. The optional fields cover both
// dialects (`toolName` vs `toolCallName`, `input` vs `args`) so the
// parser doesn't break across TanStack AI versions.
type AgUiEvent = {
  type?: string;
  delta?: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolCallName?: string;
  input?: unknown;
  args?: unknown;
  result?: string | null;
  message?: string;
};
