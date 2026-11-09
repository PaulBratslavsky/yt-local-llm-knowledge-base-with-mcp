import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';

export const POLL_INTERVAL_MS = 3000;
/** 200 × 3 s = 10 min — longer than a long map-reduce summary. */
export const POLL_MAX_ATTEMPTS = 200;

/** Re-run the route loaders every 3 s while `active`, at most 200 times.
 *  `capReached` turns true when polling stops so the page can say so (M-15);
 *  it resets when `active` goes false. `refreshOnFocus` also re-runs the
 *  loaders when the tab regains focus. */
export function usePollingInvalidation(
  active: boolean,
  opts: { refreshOnFocus?: boolean } = {},
): { capReached: boolean } {
  const router = useRouter();
  const attemptsRef = useRef(0);
  const [capReached, setCapReached] = useState(false);
  const refreshOnFocus = opts.refreshOnFocus ?? false;

  useEffect(() => {
    if (!active) {
      attemptsRef.current = 0;
      setCapReached(false);
      return;
    }
    const id = window.setInterval(() => {
      attemptsRef.current += 1;
      if (attemptsRef.current > POLL_MAX_ATTEMPTS) {
        window.clearInterval(id);
        setCapReached(true);
        return;
      }
      void router.invalidate();
    }, POLL_INTERVAL_MS);
    if (!refreshOnFocus) return () => window.clearInterval(id);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void router.invalidate();
    };
    const onFocus = () => {
      void router.invalidate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, refreshOnFocus, router]);

  return { capReached };
}
