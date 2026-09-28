// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const relatedVideosMock = vi.hoisted(() => vi.fn());

vi.mock('#/data/server-functions/videos', () => ({
  relatedVideos: relatedVideosMock,
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
}));

import { RelatedVideos } from './RelatedVideos';

afterEach(() => {
  cleanup();
  relatedVideosMock.mockReset();
});

describe('RelatedVideos', () => {
  // ADR-0007: a dead backend must not be indistinguishable from "this video
  // has no neighbours". Hiding the section on error made them identical.
  it('reports a backend failure instead of hiding the section', async () => {
    relatedVideosMock.mockResolvedValue({
      status: 'error',
      error: 'Backend unreachable. Check that Strapi is running on port 1340.',
    });

    render(<RelatedVideos videoId="abc123" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText(/Backend unreachable/)).toBeDefined();
  });

  it('stays hidden when the library genuinely has no neighbours', async () => {
    relatedVideosMock.mockResolvedValue({
      status: 'ok',
      results: [],
      reason: 'no-candidates',
    });

    const { container } = render(<RelatedVideos videoId="abc123" />);

    await waitFor(() => {
      expect(relatedVideosMock).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });
});
