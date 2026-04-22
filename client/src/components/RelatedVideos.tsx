import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  relatedVideos,
  type RelatedVideo,
  type RelatedVideosResult,
} from '#/data/server-functions/videos';

type Props = {
  videoId: string;
  limit?: number;
};

// Semantic-neighbor card below the summary on the learn page. Silently
// absent when the target has no embedding yet, or when nothing else in
// the library clears the similarity threshold. The user only sees it
// when it's useful.
export function RelatedVideos({ videoId, limit = 6 }: Readonly<Props>) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; results: RelatedVideo[] }
    | { kind: 'hidden' }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res: RelatedVideosResult = await relatedVideos({
        data: { videoId, limit },
      });
      if (cancelled) return;
      if (res.status !== 'ok' || res.results.length === 0) {
        setState({ kind: 'hidden' });
        return;
      }
      setState({ kind: 'ready', results: res.results });
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, limit]);

  if (state.kind !== 'ready') return null;

  return (
    <section className="mt-16 border-t border-[var(--line)] pt-8">
      <header className="mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
          Related videos
        </h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Semantically closest in your library.
        </p>
      </header>
      {/* Two columns instead of three — the learn page's left pane is ~60%
          of the viewport and narrower than the feed, so three cards get
          squeezed. Stacked thumbnail + title + meta reads much better at
          this width than the side-by-side compact layout. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {state.results.map((r) => (
          <RelatedCard key={r.documentId} item={r} />
        ))}
      </div>
    </section>
  );
}

function RelatedCard({ item }: Readonly<{ item: RelatedVideo }>) {
  return (
    <Link
      to="/learn/$videoId"
      params={{ videoId: item.youtubeVideoId }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] no-underline transition hover:border-[var(--line-strong)]"
    >
      {item.videoThumbnailUrl ? (
        <div className="aspect-video w-full overflow-hidden bg-[var(--bg-subtle)]">
          <img
            src={item.videoThumbnailUrl}
            alt={item.videoTitle ?? item.youtubeVideoId}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        </div>
      ) : (
        <span
          aria-hidden="true"
          className="aspect-video w-full bg-[var(--bg-subtle)]"
        />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[var(--ink)] transition group-hover:text-[var(--accent)]">
          {item.videoTitle ?? item.youtubeVideoId}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2 text-[0.65rem] text-[var(--ink-muted)]">
          <span className="truncate">
            {item.videoAuthor ?? '—'}
          </span>
          <span className="tabular-nums">
            {(item.score * 100).toFixed(0)}% similar
          </span>
        </div>
      </div>
    </Link>
  );
}
