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
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Related videos
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Semantically closest in your library.
          </p>
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      className="group flex gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 no-underline transition hover:border-[var(--line-strong)]"
    >
      {item.videoThumbnailUrl ? (
        <img
          src={item.videoThumbnailUrl}
          alt={item.videoTitle ?? item.youtubeVideoId}
          className="h-16 w-24 flex-none rounded-lg object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-16 w-24 flex-none rounded-lg bg-[var(--bg-subtle)]"
        />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-sm font-medium text-[var(--ink)] transition group-hover:text-[var(--accent)]">
          {item.videoTitle ?? item.youtubeVideoId}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-[var(--ink-muted)]">
          {item.videoAuthor && (
            <span className="truncate">{item.videoAuthor}</span>
          )}
          <span className="tabular-nums">
            {(item.score * 100).toFixed(0)}% similar
          </span>
        </div>
      </div>
    </Link>
  );
}
