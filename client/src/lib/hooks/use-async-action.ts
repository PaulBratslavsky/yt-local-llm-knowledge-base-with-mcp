import { useCallback, useRef, useState } from 'react';

/** Runs one async action at a time and always clears the busy flag, even
 *  when the action throws — the bug that left "Retrying…" stuck on /learn
 *  (M-15). A thrown message is kept in `error` for the button to show. */
export function useAsyncAction(): {
  running: boolean;
  error: string | null;
  run: (action: () => Promise<void>) => Promise<void>;
} {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.');
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, []);
  return { running, error, run };
}
