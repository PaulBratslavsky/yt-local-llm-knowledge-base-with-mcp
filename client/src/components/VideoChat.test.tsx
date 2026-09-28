// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StreamEvent } from '#/lib/services/chat-stream';

// The stream is the seam. `streamChatResponse` does the fetch and then
// delegates to `streamChatSSE`, so stubbing the latter lets a test drive a
// mid-stream failure — the case that matters here — without a server.
const streamEvents = vi.hoisted(() => ({
  emit: [] as StreamEvent[],
  failAfterEmitting: false,
}));

vi.mock('#/lib/services/chat-stream', () => ({
  streamChatSSE: async function* () {
    for (const event of streamEvents.emit) yield event;
    if (streamEvents.failAfterEmitting) throw new Error('fetch failed');
  },
}));

vi.mock('#/data/server-functions/videos', () => ({
  getChatResponseEvidence: vi.fn().mockResolvedValue({ status: 'ok', citations: [] }),
}));
vi.mock('#/data/server-functions/notes', () => ({
  summarizeToNote: vi.fn(),
}));
vi.mock('#/lib/skills', () => ({ listSkills: () => [] }));
vi.mock('#/components/player', () => ({
  usePlayerControl: () => ({ seekTo: vi.fn(), play: vi.fn(), pause: vi.fn() }),
}));

import { VideoChat } from './VideoChat';

beforeAll(() => {
  // jsdom implements neither of these, and the component calls both.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }),
  );
});

afterEach(() => {
  cleanup();
  streamEvents.emit = [];
  streamEvents.failAfterEmitting = false;
});

function ask(question: string) {
  fireEvent.change(screen.getByPlaceholderText(/Ask about this video/), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('VideoChat', () => {
  // Regression guard for 120ea85. Ollama dying mid-answer used to discard
  // every token that had already reached the screen; the same bug is still
  // live in LibraryChat's renderer (#9), so this contract is worth pinning.
  it('keeps the partial answer when the stream fails mid-response', async () => {
    streamEvents.emit = [
      { kind: 'text', delta: 'The ingest pipeline starts ' },
      { kind: 'text', delta: 'at the fetch step.' },
    ];
    streamEvents.failAfterEmitting = true;

    render(<VideoChat videoId="abc123" />);
    ask('How does ingest work?');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(
      screen.getByText(/The ingest pipeline starts at the fetch step\./),
    ).toBeDefined();
  });

  it('drops the empty placeholder when the stream fails before any token', async () => {
    streamEvents.emit = [];
    streamEvents.failAfterEmitting = true;

    render(<VideoChat videoId="abc123" />);
    ask('How does ingest work?');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    // The user's own question stays, and the failure is reported once.
    expect(screen.getByText('How does ingest work?')).toBeDefined();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('translates an unreachable Ollama into a recovery hint', async () => {
    streamEvents.emit = [];
    streamEvents.failAfterEmitting = true;

    render(<VideoChat videoId="abc123" />);
    ask('How does ingest work?');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    // friendlyOllamaError turns node's bare "fetch failed" into something
    // that names Ollama — ADR-0007's whole point.
    expect(screen.getByRole('alert').textContent).toMatch(/Ollama/i);
  });
});
