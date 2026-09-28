// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage } from '#/lib/hooks/useLibraryChat';

const chatState = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  isStreaming: false,
  cancel: vi.fn(),
}));

vi.mock('#/lib/hooks/useLibraryChat', () => ({
  useLibraryChat: () => ({
    messages: chatState.messages,
    isOpen: true,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    ask: vi.fn(),
    cancel: chatState.cancel,
    isStreaming: chatState.isStreaming,
  }),
}));

import { LibraryChat } from './LibraryChat';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  chatState.messages = [];
  chatState.isStreaming = false;
  chatState.cancel.mockReset();
});

function assistantMessage(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    status: 'done',
    citations: [],
    ...over,
  } as ChatMessage;
}

describe('LibraryChat', () => {
  // VideoChat and DigestChat both keep the tokens that reached the screen
  // when a run dies (120ea85). The hook keeps them here too — it only
  // patches `status` and `error` — but the renderer threw them away.
  it('keeps the partial answer visible when the run fails', () => {
    chatState.messages = [
      assistantMessage({
        content: 'Three videos cover local inference. The clearest is',
        status: 'error',
        error: "Couldn't reach Ollama at http://localhost:11434.",
      }),
    ];

    render(<LibraryChat />);

    expect(screen.getByText(/Three videos cover local inference/)).toBeDefined();
    expect(screen.getByText(/Couldn't reach Ollama/)).toBeDefined();
  });

  it('shows only the error when nothing had streamed yet', () => {
    chatState.messages = [
      assistantMessage({
        content: '',
        status: 'error',
        error: "Couldn't reach Ollama at http://localhost:11434.",
      }),
    ];

    render(<LibraryChat />);

    expect(screen.getByText(/Couldn't reach Ollama/)).toBeDefined();
  });

  it('renders a completed answer without an error strip', () => {
    chatState.messages = [
      assistantMessage({ content: 'Local inference is covered here.', status: 'done' }),
    ];

    render(<LibraryChat />);

    expect(screen.getByText(/Local inference is covered here/)).toBeDefined();
    expect(screen.queryByText(/Couldn't complete/)).toBeNull();
  });

  // `cancel` was exported by the hook and wired to nothing, so a long ask
  // could not be stopped — while VideoChat and DigestChat have no abort at
  // all. Dead interface is worse than none: it reads as supported.
  it('offers a way to stop an in-flight ask', () => {
    chatState.isStreaming = true;
    chatState.messages = [
      assistantMessage({ content: 'Working on it', status: 'pending' }),
    ];

    render(<LibraryChat />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(chatState.cancel).toHaveBeenCalledTimes(1);
  });
});
