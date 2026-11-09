import { Link } from '@tanstack/react-router';

// A video with no summary yet. It may be generating (shared in the app), or it
// may have been added from outside the app (the yt-kb MCP tools add pending
// cards), where nothing generates until someone opens it. Opening /learn
// starts generation if it isn't already running, so the link works for both.
export function PendingSummary({ youtubeVideoId }: Readonly<{ youtubeVideoId: string }>) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--line)] bg-[var(--bg-subtle)]/50 px-3 py-2">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" aria-hidden="true" />
      <span className="text-xs italic text-[var(--ink-muted)]">
        Verdict &amp; score appear here once the summary lands.
      </span>
      <Link
        to="/learn/$videoId"
        params={{ videoId: youtubeVideoId }}
        className="ml-auto inline-flex items-center rounded-md border border-[var(--line)] px-2 py-1 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--bg-subtle)]"
      >
        Generate summary
      </Link>
    </div>
  );
}
