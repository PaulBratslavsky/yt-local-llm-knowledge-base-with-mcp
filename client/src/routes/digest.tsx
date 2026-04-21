import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '#/components/ui/button';
import { DigestChat } from '#/components/DigestChat';
import {
  generateDigest,
  generateDigestArticle,
  saveDigestAsNote,
  type GenerateDigestResult,
} from '#/data/server-functions/digest';
import {
  resolveVideoTitle,
  type Digest,
  type DigestSourceVideo,
} from '#/lib/services/digest';
import type { StrapiVideo } from '#/lib/services/videos';

// The digest is ephemeral — no DB row. URL encodes the selection as
// `?videos=id1,id2,...`; the loader synthesizes the report on every visit.
// Refresh / share link = re-run the synthesis against whatever the videos
// currently contain.

const DigestSearchSchema = z.object({
  videos: z.string().min(1).max(400),
});

export const Route = createFileRoute('/digest')({
  validateSearch: DigestSearchSchema,
  loaderDeps: ({ search }) => ({ videos: search.videos }),
  loader: async ({ deps }): Promise<GenerateDigestResult> => {
    const videoIds = deps.videos
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return await generateDigest({ data: { videoIds } });
  },
  component: DigestPage,
  pendingComponent: DigestPending,
  head: () => ({ meta: [{ title: 'Digest · YT Knowledge Base' }] }),
});

function DigestPending() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
        Synthesizing
      </span>
      <h1 className="display-title mt-6 text-3xl text-[var(--ink)] sm:text-4xl">
        Building your digest…
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]">
        Reading across the selected videos and pulling out shared themes,
        unique insights, and any contradictions. Usually 5–15 seconds.
      </p>
    </main>
  );
}

function DigestPage() {
  const result = Route.useLoaderData();

  if (result.status === 'error') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Couldn&apos;t build the digest
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-destructive">
          {result.error}
        </p>
        <div className="mt-8">
          <Link to="/feed">
            <Button variant="outline">Back to feed</Button>
          </Link>
        </div>
      </main>
    );
  }

  return <DigestReport digest={result.digest} videos={result.videos} />;
}

function DigestReport({
  digest,
  videos,
}: Readonly<{ digest: Digest; videos: StrapiVideo[] }>) {
  const sources: DigestSourceVideo[] = videos.map((v) => ({
    documentId: v.documentId,
    youtubeVideoId: v.youtubeVideoId,
    videoTitle: v.videoTitle,
    videoAuthor: v.videoAuthor,
    videoThumbnailUrl: v.videoThumbnailUrl,
  }));

  // Which view is currently active. Toggling to 'article' lazily
  // generates the long-form markdown post via the LLM and keeps the
  // result in state — subsequent tab switches are instant.
  const [view, setView] = useState<'digest' | 'article'>('digest');

  return (
    <main className="min-h-[calc(100vh-4rem)]">
      {/* 6fr/4fr split mirroring the learn page. Left column holds the
          synthesized report, right aside holds the cross-video chat pinned
          while the left column scrolls. Both extend edge-to-edge on lg+. */}
      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[6fr_4fr] lg:items-stretch">
        <div className="min-w-0 bg-[var(--bg-subtle)] px-6 py-10 sm:px-10 sm:py-14 lg:px-14">
          <DigestViewTabs active={view} onChange={setView} />

          {view === 'article' ? (
            <DigestArticleView videos={videos} />
          ) : (
            <DigestStructuredView digest={digest} sources={sources} videos={videos} />
          )}
        </div>

        <aside className="flex min-h-0 flex-col bg-[var(--card)] lg:sticky lg:top-16 lg:max-h-[calc(100vh-4rem)] lg:border-l lg:border-[var(--line)]">
          <DigestChat
            videos={videos}
            className="min-h-[480px] flex-1 px-6 py-6 sm:px-8"
          />
        </aside>
      </div>
    </main>
  );
}

function DigestViewTabs({
  active,
  onChange,
}: Readonly<{
  active: 'digest' | 'article';
  onChange: (v: 'digest' | 'article') => void;
}>) {
  const tabClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
      isActive
        ? 'border-[var(--line)] bg-[var(--card)] text-[var(--ink-muted)]'
        : 'border-transparent bg-transparent text-[var(--ink-muted)] hover:border-[var(--line)] hover:bg-[var(--card)] hover:text-[var(--ink)]'
    }`;
  return (
    <div className="mb-8 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5">
      <button
        type="button"
        onClick={() => onChange('digest')}
        className={tabClass(active === 'digest')}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active === 'digest' ? 'bg-[var(--accent)]' : 'bg-[var(--ink-muted)]/30'
          }`}
        />
        Digest
      </button>
      <button
        type="button"
        onClick={() => onChange('article')}
        className={tabClass(active === 'article')}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active === 'article' ? 'bg-[var(--accent)]' : 'bg-[var(--ink-muted)]/30'
          }`}
        />
        Article
      </button>
    </div>
  );
}

function DigestStructuredView({
  digest,
  sources,
  videos,
}: Readonly<{
  digest: Digest;
  sources: DigestSourceVideo[];
  videos: StrapiVideo[];
}>) {
  return (
    <>
      <header className="mb-10">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            Cross-video digest
          </span>
          <h1 className="display-title mt-5 text-3xl leading-[1.1] text-[var(--ink)] sm:text-5xl">
            {digest.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
            {digest.description}
          </p>
          <SourceChips videos={sources} />
        </header>

        <section className="mb-10 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Bottom line
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--ink)]">
            {digest.bottomLine}
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Overall theme
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)] whitespace-pre-line">
            {digest.overallTheme}
          </p>
        </section>

        {digest.sharedThemes.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Shared themes
            </h2>
            <div className="mt-4 grid gap-5">
              {digest.sharedThemes.map((t, i) => (
                <ThemeBlock
                  key={`theme-${i}`}
                  title={t.title}
                  body={t.body}
                  videoTitles={t.videoTitles}
                  sources={sources}
                />
              ))}
            </div>
          </section>
        )}

        {digest.uniqueInsights.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Unique contributions
            </h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
              {digest.uniqueInsights.map((u, i) => {
                const match = resolveVideoTitle(u.videoTitle, sources);
                return (
                  <div
                    key={`insight-${i}`}
                    className={`grid gap-2 p-5 sm:grid-cols-[200px_1fr] sm:gap-6 ${
                      i > 0 ? 'border-t border-[var(--line)]' : ''
                    }`}
                  >
                    <div className="text-sm font-medium text-[var(--ink)]">
                      {match ? (
                        <Link
                          to="/learn/$videoId"
                          params={{ videoId: match.youtubeVideoId }}
                          className="hover:underline"
                        >
                          {match.videoTitle ?? u.videoTitle}
                        </Link>
                      ) : (
                        u.videoTitle
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
                      {u.insight}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {digest.contradictions.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Where they disagree
            </h2>
            <div className="mt-4 grid gap-5">
              {digest.contradictions.map((c, i) => (
                <div
                  key={`contradiction-${i}`}
                  className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5"
                >
                  <h3 className="text-base font-semibold text-[var(--ink)]">
                    {c.topic}
                  </h3>
                  <div className="mt-3 grid gap-3">
                    {c.positions.map((p, j) => {
                      const match = resolveVideoTitle(p.videoTitle, sources);
                      return (
                        <div key={`pos-${i}-${j}`} className="text-sm">
                          <div className="font-medium text-[var(--ink)]">
                            {match ? (
                              <Link
                                to="/learn/$videoId"
                                params={{ videoId: match.youtubeVideoId }}
                                className="hover:underline"
                              >
                                {match.videoTitle ?? p.videoTitle}
                              </Link>
                            ) : (
                              p.videoTitle
                            )}
                          </div>
                          <p className="mt-1 leading-relaxed text-[var(--ink-soft)]">
                            {p.stance}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {digest.viewingOrder.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Suggested viewing order
            </h2>
            <ol className="mt-4 grid gap-3">
              {digest.viewingOrder.map((v, i) => {
                const match = resolveVideoTitle(v.videoTitle, sources);
                return (
                  <li
                    key={`order-${i}`}
                    className="flex gap-4 rounded-xl border border-[var(--line)] bg-[var(--card)] p-4"
                  >
                    <span className="text-lg font-semibold text-[var(--ink-muted)]">
                      {i + 1}.
                    </span>
                    <div>
                      <div className="text-sm font-medium text-[var(--ink)]">
                        {match ? (
                          <Link
                            to="/learn/$videoId"
                            params={{ videoId: match.youtubeVideoId }}
                            className="hover:underline"
                          >
                            {match.videoTitle ?? v.videoTitle}
                          </Link>
                        ) : (
                          v.videoTitle
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">
                        {v.why}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Source videos
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {videos.map((v) => (
              <Link
                key={v.documentId}
                to="/learn/$videoId"
                params={{ videoId: v.youtubeVideoId }}
                className="flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 transition hover:border-[var(--line-strong)]"
              >
                {v.videoThumbnailUrl && (
                  <img
                    src={v.videoThumbnailUrl}
                    alt=""
                    className="h-16 w-28 shrink-0 rounded-md object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">
                    {v.videoTitle ?? v.youtubeVideoId}
                  </div>
                  {v.videoAuthor && (
                    <div className="truncate text-xs text-[var(--ink-muted)]">
                      {v.videoAuthor}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>

      <DigestActionBar digest={digest} videos={videos} />
    </>
  );
}

function DigestArticleView({
  videos,
}: Readonly<{ videos: StrapiVideo[] }>) {
  const videoIds = videos.map((v) => v.youtubeVideoId);
  const [article, setArticle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Lazy generate on mount. Result lives in component state — tab toggle
  // back and forth stays instant; only a hard refresh re-runs the LLM.
  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateDigestArticle({
        data: { videoIds },
      });
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      setArticle(result.article);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Article generation failed');
    } finally {
      setLoading(false);
    }
  };

  // Kick off generation the first time this view mounts.
  useLazyRun(article, loading, error, run);

  const copy = async () => {
    if (!article) return;
    try {
      await navigator.clipboard.writeText(article);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (loading && !article) {
    return (
      <div className="py-20 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          Writing
        </span>
        <h2 className="display-title mt-5 text-2xl text-[var(--ink)]">
          Writing your article…
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          Synthesizing a long-form piece across {videos.length} videos.
          Usually 15–30 seconds.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <h2 className="display-title text-2xl text-[var(--ink)]">
          Couldn&apos;t write the article
        </h2>
        <p className="mt-4 text-sm text-destructive">{error}</p>
        <div className="mt-6">
          <Button variant="outline" onClick={run}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!article) return null;

  return (
    <>
      <article className="prose-article mx-auto max-w-2xl">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{article}</ReactMarkdown>
      </article>
      <section className="sticky bottom-4 z-10 mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_4px_16px_rgba(9,9,11,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy markdown'}
          </Button>
          <Button variant="outline" size="sm" onClick={run} disabled={loading}>
            {loading ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </section>
    </>
  );
}

// Kick off the generation the first time an article view is rendered in
// a given session. Guards against re-running during state updates.
function useLazyRun(
  article: string | null,
  loading: boolean,
  error: string | null,
  run: () => Promise<void>,
) {
  // Use a ref to only run once per mount, independent of React strict-mode
  // double-invocation.
  const triggered = useRef(false);
  useEffect(() => {
    if (triggered.current) return;
    if (article !== null || loading || error !== null) return;
    triggered.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function SourceChips({
  videos,
}: Readonly<{ videos: DigestSourceVideo[] }>) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--ink-muted)]">
        Based on {videos.length} videos:
      </span>
      {videos.map((v) => (
        <Link
          key={v.documentId}
          to="/learn/$videoId"
          params={{ videoId: v.youtubeVideoId }}
          className="inline-flex max-w-[200px] items-center rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="truncate">{v.videoTitle ?? v.youtubeVideoId}</span>
        </Link>
      ))}
    </div>
  );
}

function ThemeBlock({
  title,
  body,
  videoTitles,
  sources,
}: Readonly<{
  title: string;
  body: string;
  videoTitles: string[];
  sources: DigestSourceVideo[];
}>) {
  const matches = videoTitles
    .map((t) => resolveVideoTitle(t, sources))
    .filter((v): v is DigestSourceVideo => v !== null);
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <h3 className="text-base font-semibold leading-snug text-[var(--ink)]">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        {body}
      </p>
      {matches.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--ink-muted)]">Covered in:</span>
          {matches.map((m) => (
            <Link
              key={m.documentId}
              to="/learn/$videoId"
              params={{ videoId: m.youtubeVideoId }}
              className="inline-flex max-w-[180px] items-center rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <span className="truncate">{m.videoTitle ?? m.youtubeVideoId}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Actions: copy the digest as markdown, save into a source video's notes,
// or regenerate (just re-invalidate the loader — same URL, fresh call).
function DigestActionBar({
  digest,
  videos,
}: Readonly<{ digest: Digest; videos: StrapiVideo[] }>) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [savingTo, setSavingTo] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const markdown = digestToMarkdown(digest);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const save = async (videoDocumentId: string) => {
    setSavingTo(videoDocumentId);
    setSaveMsg(null);
    const res = await saveDigestAsNote({
      data: { videoDocumentId, markdown },
    });
    setSavingTo(null);
    setSaveMsg(
      res.status === 'ok' ? 'Saved to video notes.' : `Save failed: ${res.error}`,
    );
  };

  const regenerate = () => {
    router.invalidate();
  };

  return (
    <section className="sticky bottom-4 z-10 mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_4px_16px_rgba(9,9,11,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy markdown'}
        </Button>
        <div className="relative">
          <details className="group">
            <summary className="inline-flex cursor-pointer items-center rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--bg-subtle)]">
              Save as note on…
            </summary>
            <div className="absolute bottom-full left-0 mb-2 min-w-[240px] rounded-md border border-[var(--line)] bg-[var(--card)] p-1 shadow-lg">
              {videos.map((v) => (
                <button
                  key={v.documentId}
                  type="button"
                  onClick={() => save(v.documentId)}
                  disabled={savingTo !== null}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--ink)] transition hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                >
                  <span className="truncate">
                    {v.videoTitle ?? v.youtubeVideoId}
                  </span>
                </button>
              ))}
            </div>
          </details>
        </div>
        <Button variant="outline" size="sm" onClick={regenerate}>
          Regenerate
        </Button>
        {saveMsg && (
          <span className="text-xs text-[var(--ink-muted)]">{saveMsg}</span>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Markdown serialization — used by Copy and Save-as-note actions
// =============================================================================

function digestToMarkdown(d: Digest): string {
  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  lines.push('');
  lines.push(`_${d.description}_`);
  lines.push('');
  lines.push('## Bottom line');
  lines.push('');
  lines.push(d.bottomLine);
  lines.push('');
  lines.push('## Overall theme');
  lines.push('');
  lines.push(d.overallTheme);
  lines.push('');

  if (d.sharedThemes.length > 0) {
    lines.push('## Shared themes');
    lines.push('');
    for (const t of d.sharedThemes) {
      lines.push(`### ${t.title}`);
      lines.push('');
      lines.push(t.body);
      if (t.videoTitles.length > 0) {
        lines.push('');
        lines.push(`_Covered in: ${t.videoTitles.join(', ')}_`);
      }
      lines.push('');
    }
  }

  if (d.uniqueInsights.length > 0) {
    lines.push('## Unique contributions');
    lines.push('');
    for (const u of d.uniqueInsights) {
      lines.push(`- **${u.videoTitle}**: ${u.insight}`);
    }
    lines.push('');
  }

  if (d.contradictions.length > 0) {
    lines.push('## Where they disagree');
    lines.push('');
    for (const c of d.contradictions) {
      lines.push(`### ${c.topic}`);
      lines.push('');
      for (const p of c.positions) {
        lines.push(`- **${p.videoTitle}**: ${p.stance}`);
      }
      lines.push('');
    }
  }

  if (d.viewingOrder.length > 0) {
    lines.push('## Suggested viewing order');
    lines.push('');
    d.viewingOrder.forEach((v, i) => {
      lines.push(`${i + 1}. **${v.videoTitle}** — ${v.why}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
