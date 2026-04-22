import { useEffect, useState } from 'react';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { VideoCard } from '#/components/VideoCard';
import { Button } from '#/components/ui/button';
import {
  getFeed,
  semanticSearchVideos,
  type SemanticHit,
} from '#/data/server-functions/videos';
import { getMatchTier } from '#/lib/services/embeddings';
import {
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
} from '#/lib/services/digest';
import type { StrapiVideo } from '#/lib/services/videos';

const FeedSearchSchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(80).optional(),
  page: z.number().int().min(1).max(1000).optional(),
  mode: z.enum(['keyword', 'semantic']).optional(),
});

type SemanticResultShape = {
  kind: 'semantic';
  hits: SemanticHit[];
  query: string;
};

type KeywordResultShape = {
  kind: 'keyword';
  result: {
    videos: StrapiVideo[];
    total: number;
    page: number;
    pageCount: number;
  };
};

type FeedLoaderData = KeywordResultShape | SemanticResultShape;

export const Route = createFileRoute('/feed')({
  validateSearch: FeedSearchSchema,
  loaderDeps: ({ search }) => ({
    q: search.q,
    tag: search.tag,
    page: search.page,
    mode: search.mode,
  }),
  loader: async ({ deps }): Promise<FeedLoaderData> => {
    // Semantic mode requires a query. With no query the mode toggle is
    // irrelevant — fall back to the normal feed listing.
    if (deps.mode === 'semantic' && deps.q) {
      const res = await semanticSearchVideos({
        data: { query: deps.q, limit: 30 },
      });
      if (res.status === 'ok') {
        return { kind: 'semantic', hits: res.hits, query: deps.q };
      }
      // On semantic failure (Ollama down, model missing), degrade to keyword.
    }
    const result = await getFeed({
      data: { q: deps.q, tag: deps.tag, page: deps.page ?? 1, pageSize: 20 },
    });
    return { kind: 'keyword', result };
  },
  component: FeedPage,
  head: () => ({ meta: [{ title: 'Feed · YT Knowledge Base' }] }),
});

function FeedPage() {
  const loaderData = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();

  // Normalize both shapes (keyword paginated, semantic ranked) into a common
  // list for the rest of the render. Pagination only exists for keyword.
  const videos =
    loaderData.kind === 'keyword'
      ? loaderData.result.videos
      : loaderData.hits.map((h) => h.video);
  // For semantic mode, compute a match tier per hit — derived from rank
  // + score. Raw cosine saturates around 0.7 so rank-based labels read
  // better than percentages.
  const tiers =
    loaderData.kind === 'semantic'
      ? new Map(
          loaderData.hits.map(
            (h, rank) =>
              [h.video.documentId, getMatchTier(rank, h.score)] as const,
          ),
        )
      : null;

  // Selection mode is page-local state. Switching tags/search keeps the
  // current selection because the component doesn't remount — only the
  // loader re-runs. Leaving /feed resets everything.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Poll the loader while any card is `pending` so summaries flip to
  // "generated" on the feed without a manual refresh. Only relevant in
  // keyword mode — semantic-search results always have generated summaries
  // (the loader requires it).
  useEffect(() => {
    if (loaderData.kind !== 'keyword') return;
    const anyPending = videos.some((v) => v.summaryStatus === 'pending');
    if (!anyPending) return;
    const id = globalThis.setInterval(() => {
      void router.invalidate();
    }, 3000);
    return () => globalThis.clearInterval(id);
  }, [loaderData.kind, videos, router]);

  // Escape cancels selection mode, matching the intuitive pattern.
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectionMode(false);
        setSelected(new Set());
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [selectionMode]);

  const toggleSelected = (youtubeVideoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(youtubeVideoId)) {
        next.delete(youtubeVideoId);
      } else if (next.size < DIGEST_MAX_VIDEOS) {
        next.add(youtubeVideoId);
      }
      return next;
    });
  };

  const startDigestMode = () => {
    setSelectionMode(true);
    setSelected(new Set());
  };

  const cancelDigestMode = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const submitDigest = () => {
    if (selected.size < DIGEST_MIN_VIDEOS) return;
    navigate({
      to: '/digest',
      search: { videos: Array.from(selected).join(',') },
    });
  };

  return (
    <main className="px-6 pb-28 pt-10 sm:px-10 sm:pt-14 lg:px-14">
      <header className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          Knowledge feed
        </span>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <h1 className="display-title max-w-3xl text-[2.75rem] text-[var(--ink)] sm:text-[4rem]">
            Shared videos,
            <br />
            <span className="text-[var(--ink-muted)]">summarized.</span>
          </h1>
          {!selectionMode && videos.length > 0 && (
            <Button
              size="pill"
              variant="outline"
              onClick={startDigestMode}
            >
              Create digest
            </Button>
          )}
        </div>
      </header>

      <SearchBar
        q={search.q ?? ''}
        tag={search.tag}
        mode={search.mode ?? 'keyword'}
      />

      {search.tag && <ActiveTagPill tag={search.tag} />}

      {selectionMode && (
        <div className="mb-5 rounded-xl border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--ink)]">
          Pick 2–{DIGEST_MAX_VIDEOS} videos to digest. Videos without
          summaries can&apos;t be picked.
        </div>
      )}

      {videos.length === 0 ? (
        <EmptyFeed
          q={search.q}
          tag={search.tag}
          mode={loaderData.kind === 'semantic' ? 'semantic' : 'keyword'}
        />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between text-sm text-[var(--ink-muted)]">
            {loaderData.kind === 'keyword' ? (
              <>
                <span>
                  {loaderData.result.total}{' '}
                  {loaderData.result.total === 1 ? 'video' : 'videos'}
                </span>
                <span>
                  Page {loaderData.result.page} of{' '}
                  {Math.max(1, loaderData.result.pageCount)}
                </span>
              </>
            ) : (
              <>
                <span>
                  {videos.length} semantic{' '}
                  {videos.length === 1 ? 'match' : 'matches'} for
                  &ldquo;{loaderData.query}&rdquo;
                </span>
                <span>Ranked by similarity</span>
              </>
            )}
          </div>
          <section className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => {
              const eligible = video.summaryStatus === 'generated';
              const isSelected = selected.has(video.youtubeVideoId);
              const atCap =
                selected.size >= DIGEST_MAX_VIDEOS && !isSelected;
              const tier = tiers?.get(video.documentId);
              return (
                <VideoCard
                  key={video.documentId}
                  video={video}
                  selectable={selectionMode}
                  selected={isSelected}
                  eligible={eligible}
                  disabled={atCap}
                  onToggle={() => toggleSelected(video.youtubeVideoId)}
                  matchTier={tier}
                />
              );
            })}
          </section>
          {loaderData.kind === 'keyword' && (
            <Pagination
              currentPage={loaderData.result.page}
              pageCount={loaderData.result.pageCount}
              q={search.q}
              tag={search.tag}
            />
          )}
        </>
      )}

      {selectionMode && (
        <DigestSelectionBar
          count={selected.size}
          onCancel={cancelDigestMode}
          onSubmit={submitDigest}
        />
      )}
    </main>
  );
}

function DigestSelectionBar({
  count,
  onCancel,
  onSubmit,
}: Readonly<{
  count: number;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  const canSubmit = count >= DIGEST_MIN_VIDEOS;
  return (
    <div
      role="toolbar"
      aria-label="Digest selection"
      className="fixed inset-x-0 bottom-6 z-20 mx-auto flex w-[min(92vw,600px)] items-center justify-between gap-3 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 shadow-[0_8px_24px_rgba(9,9,11,0.12)]"
    >
      <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--accent)] px-2 text-xs font-semibold text-white">
          {count}
        </span>
        <span className="text-[var(--ink-muted)]">
          of {DIGEST_MAX_VIDEOS} selected
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
          Create digest →
        </Button>
      </div>
    </div>
  );
}

function SearchBar({
  q,
  tag,
  mode,
}: Readonly<{ q: string; tag?: string; mode: 'keyword' | 'semantic' }>) {
  return (
    <form method="get" action="/feed" className="mb-6 grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={
            mode === 'semantic'
              ? 'Describe what you\'re looking for…'
              : 'Search titles, channels, captions…'
          }
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none"
        />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <Button type="submit" size="pill">
          Search
        </Button>
      </div>
      <SearchModeToggle mode={mode} />
    </form>
  );
}

function SearchModeToggle({ mode }: Readonly<{ mode: 'keyword' | 'semantic' }>) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
      <span>Mode:</span>
      <label className="inline-flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="mode"
          value="keyword"
          defaultChecked={mode === 'keyword'}
          className="accent-[var(--accent)]"
        />
        <span>Keyword</span>
      </label>
      <label className="inline-flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="mode"
          value="semantic"
          defaultChecked={mode === 'semantic'}
          className="accent-[var(--accent)]"
        />
        <span>
          Semantic{' '}
          <span className="text-[var(--ink-muted)]">
            (embeddings · meaning-based)
          </span>
        </span>
      </label>
    </div>
  );
}

function ActiveTagPill({ tag }: Readonly<{ tag: string }>) {
  return (
    <div className="mb-5 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
      Filtered by
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs font-medium text-[var(--ink)]">
        #{tag}
        <Link
          to="/feed"
          search={{}}
          aria-label="Clear tag filter"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--line)]"
        >
          ×
        </Link>
      </span>
    </div>
  );
}

function Pagination({
  currentPage,
  pageCount,
  q,
  tag,
}: Readonly<{ currentPage: number; pageCount: number; q?: string; tag?: string }>) {
  if (pageCount <= 1) return null;
  const prev = Math.max(1, currentPage - 1);
  const next = Math.min(pageCount, currentPage + 1);

  return (
    <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
      <Button asChild size="pill" variant="outline" disabled={currentPage === 1}>
        <Link to="/feed" search={{ q, tag, page: prev }}>
          ← Prev
        </Link>
      </Button>
      <span className="text-sm font-medium text-[var(--ink-muted)]">
        {currentPage} / {pageCount}
      </span>
      <Button asChild size="pill" variant="outline" disabled={currentPage === pageCount}>
        <Link to="/feed" search={{ q, tag, page: next }}>
          Next →
        </Link>
      </Button>
    </nav>
  );
}

function EmptyFeed({
  q,
  tag,
  mode,
}: Readonly<{
  q?: string;
  tag?: string;
  mode: 'keyword' | 'semantic';
}>) {
  const filtered = Boolean(q || tag);
  const semanticEmpty = mode === 'semantic' && Boolean(q);
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--card)] p-10 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        {filtered ? 'No matches' : 'Nothing here yet'}
      </p>
      <h2 className="display-title mt-2 text-3xl text-[var(--ink)]">
        {filtered ? 'Try a different search.' : 'Share the first video.'}
      </h2>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        {semanticEmpty
          ? 'Nothing in the library clears the similarity threshold. Try different wording, or switch to keyword mode.'
          : filtered
            ? 'Or clear the filter to see everything.'
            : 'Paste a YouTube URL to seed the knowledge base. The AI summary runs in the background.'}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        {filtered ? (
          <Button asChild size="pill" variant="outline">
            <Link to="/feed" search={{}}>
              Clear filters
            </Link>
          </Button>
        ) : (
          <Button asChild size="pill">
            <Link to="/new-post">Share a video</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
