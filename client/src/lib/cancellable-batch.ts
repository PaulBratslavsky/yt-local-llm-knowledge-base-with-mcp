// Run a slow sequence of items one at a time, reporting progress and
// stopping when asked.
//
// `isCancelled` is a function, not a value, and that is the whole point.
// The batch AI re-rate used to read a `useState` boolean captured in the
// closure that started the loop. Clicking Cancel set the state, React
// re-rendered and built a *new* closure — but the run already in flight
// kept reading the old one, which said false forever. The button changed to
// "Stopping…" and the batch ran to the end: on a 50-video library at 5–15s
// each, about ten minutes of local inference nobody could stop (issue #11).
//
// Asking a function on each iteration is what makes a mid-run change
// visible. The caller decides where the answer lives; a ref works, so does
// an AbortSignal.

export type BatchProgress = {
  /** One-based position of the item about to be processed. */
  current: number;
  total: number;
  /** Human-readable name of that item, for the UI. */
  label: string;
};

export type BatchOutcome = {
  status: 'completed' | 'cancelled';
  ok: number;
  failed: number;
  /** Items in the batch, not items attempted — a cancelled run reports the
   *  size of the job it was asked to do. */
  total: number;
};

export async function runCancellableBatch<T>(input: {
  items: readonly T[];
  labelOf: (item: T) => string;
  /** Resolves true when the item succeeded. A throw counts as a failure
   *  and does not stop the batch: one bad video is not a reason to abandon
   *  the rest of the library. */
  process: (item: T) => Promise<boolean>;
  isCancelled: () => boolean;
  onProgress: (progress: BatchProgress) => void;
}): Promise<BatchOutcome> {
  const total = input.items.length;
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < total; i += 1) {
    // Checked before each item, so a cancellation costs at most the item
    // already in flight.
    if (input.isCancelled()) {
      return { status: 'cancelled', ok, failed, total };
    }

    const item = input.items[i];
    input.onProgress({ current: i + 1, total, label: input.labelOf(item) });

    try {
      if (await input.process(item)) ok += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  return { status: 'completed', ok, failed, total };
}
