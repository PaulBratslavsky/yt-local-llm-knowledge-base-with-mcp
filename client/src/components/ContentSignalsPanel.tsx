import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import {
  backfillFinalScores,
  backfillSignalScores,
  countMissingFinalScores,
  countMissingSignalScores,
  listRegenerableVideos,
  regenerateVideoVerdict,
} from '#/data/server-functions/videos';
import { runCancellableBatch } from '#/lib/cancellable-batch';

// One unified panel for content scoring. Two paths, clearly separated by
// speed/cost so the user can choose:
//
//   PRIMARY: Refresh content scores — fast, deterministic. Runs the
//            signal pipeline (filler/lexical/etc) and recomputes the
//            hybrid finalScore for every row that needs it. Few
//            seconds for a typical library. This is the button you
//            want 90% of the time.
//
//   SECONDARY: Re-rate with AI — slow. Runs Ollama on every video's
//              transcript to refresh the LLM verdict (watchVerdict +
//              valueScore + verdictSummary + verdictReason). ~5–15s
//              per video, sequential. Only useful when the rubric
//              prompt has changed or you want to refresh stale
//              judgements at scale. Per-video AI re-rate is
//              available on the Learn page.
//
// Earlier iterations of this panel exposed signal-only and final-only
// backfills as separate buttons; merging them into one "Refresh"
// action because the two operations are conceptually one thing —
// "make sure the score for every video reflects current data."
export function ContentSignalsPanel() {
  const router = useRouter();

  const [missing, setMissing] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const [aiState, setAiState] = useState<
    | { kind: 'idle' }
    | { kind: 'running'; current: number; total: number; lastVideo: string | null }
    | { kind: 'done'; ok: number; failed: number; total: number }
    | { kind: 'cancelled'; ok: number; failed: number; total: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  // Two halves of the same flag, deliberately. The state drives the button
  // label; the ref is what the running loop reads. State alone cannot work:
  // the loop holds the closure it started with, and a click only ever makes
  // a new one, so the run would never see the change (issue #11).
  const [aiCancelRequested, setAiCancelRequested] = useState(false);
  const aiCancelRef = useRef(false);

  const requestAiCancel = () => {
    aiCancelRef.current = true;
    setAiCancelRequested(true);
  };
  const [aiVisible, setAiVisible] = useState(false);

  const refresh = async () => {
    setCountError(null);
    const [s, f] = await Promise.all([countMissingSignalScores(), countMissingFinalScores()]);
    const error = s.error ?? f.error ?? null;
    if (error) {
      // M-13: an unreadable library used to read as "All videos have current scores."
      setMissing(null);
      setCountError(error);
      return;
    }
    setMissing(s.missing + f.missing);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const sig = await backfillSignalScores();
      const fin = await backfillFinalScores();
      const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
      const parts: string[] = [];
      if (sig.updated > 0) parts.push(`${sig.updated} ${plural(sig.updated, 'signal score', 'signal scores')}`);
      if (fin.updated > 0) parts.push(`${fin.updated} ${plural(fin.updated, 'final score', 'final scores')}`);
      const notes: string[] = [];
      if (sig.skipped > 0) {
        notes.push(
          `${sig.skipped} ${plural(sig.skipped, 'video', 'videos')} skipped — no cached transcript; run a full Regenerate on ${plural(sig.skipped, 'it', 'them')}.`,
        );
      }
      const failed = sig.failed + fin.failed;
      if (failed > 0) {
        notes.push(`${failed} ${plural(failed, 'write', 'writes')} failed (first: ${[...sig.errors, ...fin.errors][0]}).`);
      }
      if (sig.status === 'error') notes.push(`Signal scores stopped early: ${sig.error}`);
      if (fin.status === 'error') notes.push(`Final scores stopped early: ${fin.error}`);
      const head =
        parts.length > 0
          ? `Updated ${parts.join(' + ')}.`
          : notes.length > 0
            ? 'Nothing was updated.'
            : 'Nothing to update — every video already has scores.';
      setRefreshMessage([head, ...notes].join(' '));
      await refresh();
      await router.invalidate();
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAiRegenerate = async () => {
    if (aiState.kind === 'running') return;
    aiCancelRef.current = false;
    setAiCancelRequested(false);

    const listed = await listRegenerableVideos();
    if (listed.status === 'error') {
      // M-13: a failed read used to start a re-rate over part of the library.
      setAiState({ kind: 'error', message: listed.error });
      return;
    }
    const videos = listed.videos;
    if (videos.length === 0) {
      setAiState({ kind: 'done', ok: 0, failed: 0, total: 0 });
      return;
    }

    setAiState({ kind: 'running', current: 0, total: videos.length, lastVideo: null });

    const outcome = await runCancellableBatch({
      items: videos,
      labelOf: (v) => v.videoTitle ?? v.videoId,
      isCancelled: () => aiCancelRef.current,
      onProgress: ({ current, total, label }) =>
        setAiState({ kind: 'running', current, total, lastVideo: label }),
      process: async (v) => {
        const result = await regenerateVideoVerdict({ data: { videoId: v.videoId } });
        return result.status === 'ok';
      },
    });

    setAiState({
      kind: outcome.status === 'cancelled' ? 'cancelled' : 'done',
      ok: outcome.ok,
      failed: outcome.failed,
      total: outcome.total,
    });

    // Both endings changed the library, so refresh either way. The old code
    // returned early on cancel and left the panel's counts stale.
    await refresh();
    await router.invalidate();
  };

  const aiRunning = aiState.kind === 'running';

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Content scores
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Each video has a single 0–100 <strong>Content score</strong> shown
          on cards and the Learn page. It&apos;s a blend of programmatic signals
          (filler density, lexical density, sponsor presence, etc.) and the
          model&apos;s own &ldquo;is this worth your time&rdquo; judgement.
          New videos get a score automatically when their summary generates.
        </p>
      </header>

      {/* Primary action — fast deterministic refresh. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
        <div className="flex-1 text-sm">
          <p className="font-medium text-[var(--ink)]">
            Refresh content scores
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Recomputes scores for every video that&apos;s missing one. Fast
            (~50ms per video), no AI calls.
          </p>
          {missing === null && !countError && (
            <p className="mt-1 text-xs italic text-[var(--ink-muted)]">
              Checking library…
            </p>
          )}
          {countError && (
            <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <span>Couldn&apos;t check the library: {countError}</span>
              <button type="button" onClick={() => void refresh()} className="underline underline-offset-2">
                Retry
              </button>
            </div>
          )}
          {missing !== null && missing > 0 && (
            <p className="mt-1 text-xs text-[var(--ink)]">
              <strong>{missing}</strong> video
              {missing === 1 ? '' : 's'} need{missing === 1 ? 's' : ''} updating.
            </p>
          )}
          {missing === 0 && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              All videos have current scores.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || missing === 0 || missing === null}
        >
          {refreshing ? 'Refreshing…' : 'Refresh scores'}
        </Button>
      </div>
      {refreshMessage && (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">{refreshMessage}</p>
      )}

      {/* Secondary action — slow AI re-rate, hidden behind a toggle so it
          doesn't compete for attention with the primary path. */}
      <div className="mt-4">
        {!aiVisible && aiState.kind === 'idle' ? (
          <button
            type="button"
            onClick={() => setAiVisible(true)}
            className="text-xs text-[var(--ink-muted)] underline-offset-2 hover:underline hover:text-[var(--ink)]"
          >
            Advanced: re-rate every video with AI (slow)…
          </button>
        ) : (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 text-sm">
                <p className="font-medium text-[var(--ink)]">
                  Re-rate every video with AI
                </p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  Runs Ollama on every video&apos;s cached transcript to refresh
                  the LLM verdict. ~5–15s per video, sequential. Only useful
                  when the rubric prompt has changed or you want to refresh
                  stale judgements at scale.
                </p>
                {aiState.kind === 'running' && (
                  <p className="mt-1 text-xs text-[var(--ink)]">
                    {aiState.current} / {aiState.total} —{' '}
                    {aiState.lastVideo ? (
                      <span className="text-[var(--ink-muted)]">
                        {aiState.lastVideo}
                      </span>
                    ) : null}
                  </p>
                )}
                {aiState.kind === 'done' && (
                  <p className="mt-1 text-xs text-[var(--ink)]">
                    Done. <strong>{aiState.ok}</strong> updated,{' '}
                    <strong>{aiState.failed}</strong> failed of {aiState.total}.
                  </p>
                )}
                {aiState.kind === 'cancelled' && (
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Cancelled. {aiState.ok} updated, {aiState.failed} failed
                    before stop.
                  </p>
                )}
                {aiState.kind === 'error' && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    Couldn&apos;t list the videos to re-rate: {aiState.message}
                  </p>
                )}
              </div>
              {aiRunning ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={requestAiCancel}
                  disabled={aiCancelRequested}
                >
                  {aiCancelRequested ? 'Stopping…' : 'Cancel'}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleAiRegenerate()}
                >
                  Re-rate with AI
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
