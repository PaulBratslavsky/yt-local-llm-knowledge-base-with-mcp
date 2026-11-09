// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: ReactNode; to: string; params: { videoId: string } }) => (
    <a href={to.replace('$videoId', params.videoId)}>{children}</a>
  ),
}));

import { PendingSummary } from './PendingSummary';

afterEach(() => {
  cleanup();
});

describe('PendingSummary', () => {
  it('offers a Generate summary link to the learn page, which starts generation', () => {
    render(<PendingSummary youtubeVideoId="nl3bSrUfvXQ" />);
    const link = screen.getByRole('link', { name: /generate summary/i });
    expect(link.getAttribute('href')).toBe('/learn/nl3bSrUfvXQ');
  });

  it('still says the verdict and score appear once the summary lands', () => {
    render(<PendingSummary youtubeVideoId="nl3bSrUfvXQ" />);
    expect(screen.getByText(/once the summary lands/i)).toBeTruthy();
  });
});
