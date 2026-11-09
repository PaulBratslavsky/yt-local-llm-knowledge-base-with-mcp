// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const invalidate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

import { RouteError, RoutePending } from './RouteStates';

afterEach(() => {
  cleanup();
  invalidate.mockClear();
});

describe('router-wide states (M-15)', () => {
  it('RouteError shows the message in an alert and Retry re-runs the loaders', () => {
    render(<RouteError error={new Error('boom')} reset={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('RoutePending says it is loading and is marked busy', () => {
    render(<RoutePending />);
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.getByTestId('route-pending').getAttribute('aria-busy')).toBe('true');
  });
});
