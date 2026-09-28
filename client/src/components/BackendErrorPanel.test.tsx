// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
}));

import { BackendErrorPanel } from './BackendErrorPanel';

afterEach(() => {
  cleanup();
  invalidate.mockReset();
});

// This panel is ADR-0007's answer to "backend down looked like empty data".
// Its whole job is to be distinguishable from an empty state and to offer a
// way back, so that is what these assert.
describe('BackendErrorPanel', () => {
  it('shows the failure message in the card variant', () => {
    render(<BackendErrorPanel message="Strapi unreachable at http://localhost:1340" />);
    expect(
      screen.getByText('Strapi unreachable at http://localhost:1340'),
    ).toBeDefined();
  });

  it('announces itself as an alert rather than ordinary empty-state copy', () => {
    render(<BackendErrorPanel message="Strapi unreachable" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('re-runs the loader when Retry is clicked', () => {
    render(<BackendErrorPanel message="Strapi unreachable" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  // The banner variant is currently unused in the app; the six surfaces in
  // #18 are what it exists for, so lock its contract before they adopt it.
  it('shows the message and a Retry in the banner variant', () => {
    render(<BackendErrorPanel message="Semantic search is unavailable" variant="banner" />);
    expect(screen.getByText('Semantic search is unavailable')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
