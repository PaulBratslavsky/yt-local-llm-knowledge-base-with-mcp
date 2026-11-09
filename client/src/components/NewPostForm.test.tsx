// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const shareVideo = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('#/data/server-functions/videos', () => ({
  shareVideo,
  suggestTagsForUrl: async () => ({ status: 'ok', suggestions: [] }),
}));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {}, navigate }),
}));
vi.mock('#/components/GenerationModeSelect', () => ({
  GenerationModeSelect: () => null,
}));

import { NewPostForm } from './NewPostForm';

afterEach(() => {
  cleanup();
  shareVideo.mockReset();
  navigate.mockReset();
});

const URL = 'https://www.youtube.com/watch?v=zzzzzzzzzz0';

async function submit() {
  render(<NewPostForm />);
  fireEvent.change(screen.getByLabelText('YouTube URL'), { target: { value: URL } });
  const button = screen.getByRole('button', { name: 'Share video' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}

describe('NewPostForm share states (M-15, M-12)', () => {
  it('shows a thrown share inline and re-enables the button', async () => {
    shareVideo.mockRejectedValue(new Error('fetch failed'));
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't share the video: fetch failed");
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Share video' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the server's error (a tag that can't be stored) and stays on the form", async () => {
    shareVideo.mockResolvedValue({ status: 'error', error: 'Could not create tag "c#": Internal Server Error' });
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not create tag "c#": Internal Server Error');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the learn page on success', async () => {
    shareVideo.mockResolvedValue({ status: 'created', video: { youtubeVideoId: 'zzzzzzzzzz0' } });
    await submit();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/learn/$videoId', params: { videoId: 'zzzzzzzzzz0' } }),
    );
  });
});
