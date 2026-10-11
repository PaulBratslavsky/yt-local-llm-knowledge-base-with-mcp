# Static Knowledge Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, searchable Astro site built from the yt-kb summary layer, so a video's summary, key points and timecoded sections can be found in seconds mid-conversation.

**Architecture:** A third package `site/` beside `client/` and `server/`. Astro fetches Strapi at build time through `strapi-community-astro-loader` into a content collection whose zod schema mirrors the Strapi content type. An explicit `fields[]` allowlist keeps retrieval state (embeddings, BM25 index, transcripts) out of the output. Search is a build-emitted JSON index loaded into memory by one small island; every other page ships zero JavaScript. Deploy is a CLI push of `dist/` to Netlify.

**Tech Stack:** Astro 6, `strapi-community-astro-loader` 4, `@strapi/client` 1, Tailwind CSS 4, MiniSearch, `marked` 15, vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`

## Global Constraints

- Node 24 (the repo's current runtime), yarn 1.22.22, same as `client/` and `server/`.
- **Pin any pre-1.0 dependency exactly** — no caret. On a `0.x` package a caret is a silent ceiling, not a float (ADR-0010).
- Only videos with `summaryStatus === 'generated'` are published.
- The loader's `fields[]` list is an allowlist. `transcriptSegments`, `summaryEmbedding` and `passageEmbeddings` must never appear in it.
- Slugs are the `youtubeVideoId`, never a title slug.
- A section without a `timeSec` renders as a plain heading. Never fabricate a timecode (ADR-0004).
- The build fails loudly when Strapi is unreachable. A partial site is worse than no site (ADR-0007).
- Sentence case in UI copy, matching the app.
- The site is read-only. No write path to Strapi.

## Review Focus

These are implied by the spec but easy to leave untested. Each has a test assigned to the task that owns the code.

1. **Strapi unreachable or returning a partial list at build time** — the build must fail with a clear message, not emit a site missing half the library. (Task 2)
2. **A video with no sections, no takeaways, or no action steps** — older rows exist; the page renders without crashing. (Task 3)
3. **A section whose `timeSec` is null or undefined** — renders as a heading with no link, rather than linking to `t=0s`. (Task 3)
4. **A tag containing spaces, uppercase or punctuation** — the URL slug is safe and round-trips back to the original tag name. (Task 4)
5. **Raw HTML inside AI-generated markdown** (`summaryOverview`, `readableArticle`) — rendered as text, never executed. The content comes from a model and is not trusted markup. (Task 6)

---

## File Structure

```
site/
  package.json                     deps + scripts
  astro.config.mjs                 tailwind vite plugin
  tsconfig.json
  vitest.config.ts                 node env, src/**/*.test.ts
  .env.example                     STRAPI_BASE_URL
  scripts/
    verify-output.mjs              walks dist/, fails on forbidden keys
  src/
    content.config.ts              collection, zod schema, field allowlist
    lib/
      video.ts                     pure helpers: youtubeUrlAt, displayTitle
      tags.ts                      pure helpers: tagSlug, tagsFromVideos
      search-docs.ts               pure: buildSearchDocs(videos) -> SearchDoc[]
      search-engine.ts             pure: createIndex(docs), runSearch(index, q)
      markdown.ts                  pure: renderMarkdown(src) -> safe HTML
      output-guard.ts              pure: findForbidden(text) -> string[]
    components/
      VideoCard.astro
      TakeawayList.astro
      SectionList.astro
      ActionStepList.astro
      TagPills.astro
      VerdictBadge.astro
      SearchBox.astro              island wrapper
      search-client.ts             island runtime
    layouts/
      BaseLayout.astro
    pages/
      index.astro                  search-first landing
      v/[videoId].astro            video page
      t/[tag].astro                topic page
      articles.astro               videos with a readable article
      search-index.json.ts         static endpoint emitting the index
      404.astro
    styles/global.css
```

Pure logic lives in `src/lib/` so it is testable without a browser or a build. `.astro` files stay presentational — they read from the collection and call helpers.

---

### Task 1: Scaffold the site package

**Files:**
- Create: `site/package.json`, `site/astro.config.mjs`, `site/tsconfig.json`, `site/vitest.config.ts`, `site/.env.example`, `site/src/styles/global.css`, `site/src/layouts/BaseLayout.astro`, `site/src/pages/index.astro`, `site/.gitignore`
- Modify: `package.json` (root scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: `yarn site`, `yarn site:build`, `yarn site:test`, `yarn setup:site` at the repo root. `BaseLayout.astro` taking props `{ title: string; description?: string }`.

- [ ] **Step 1: Create the package manifest**

`site/package.json` (the `build` script gains the output guard in Task 8 — it
must stay plain `astro build` until that script exists, or every build
between here and there fails):

```json
{
  "name": "yt-kb-site",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "deploy": "netlify deploy --prod --dir=dist"
  },
  "dependencies": {
    "@strapi/client": "^1.2.0",
    "astro": "^6.1.3",
    "marked": "^15.0.7",
    "minisearch": "^7.1.0",
    "strapi-community-astro-loader": "^4.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.9",
    "tailwindcss": "^4.0.9",
    "vitest": "^3.0.5"
  }
}
```

Every dependency here is at or past 1.0, so carets are safe. If you add a `0.x` package later, pin it exactly — see Global Constraints.

- [ ] **Step 2: Create the Astro and TypeScript config**

`site/astro.config.mjs`:

```js
// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  vite: { plugins: [tailwindcss()] },
});
```

`site/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

`site/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
```

`site/.gitignore`:

```
dist/
.astro/
node_modules/
.env
.netlify/
```

- [ ] **Step 3: Create the env example**

`site/.env.example`:

```
# Strapi REST base, including /api. The build fetches this at build time;
# nothing is read at runtime.
STRAPI_BASE_URL=http://localhost:1340/api

# Public URL of the deployed site, used for canonical links.
SITE_URL=http://localhost:4321
```

- [ ] **Step 4: Create the base layout and a placeholder page**

`site/src/styles/global.css`:

```css
@import "tailwindcss";
```

`site/src/layouts/BaseLayout.astro`:

```astro
---
import '../styles/global.css';

interface Props {
  title: string;
  description?: string;
}

const { title, description } = Astro.props;
---

<!doctype html>
<html lang="en" class="bg-white text-slate-900">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body class="mx-auto max-w-3xl px-5 py-10">
    <header class="mb-10">
      <a href="/" class="text-sm font-medium text-slate-500 hover:text-slate-900">
        YT knowledge base
      </a>
    </header>
    <main>
      <slot />
    </main>
  </body>
</html>
```

`site/src/pages/index.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="YT knowledge base">
  <h1 class="text-2xl font-medium">Scaffold works.</h1>
</BaseLayout>
```

- [ ] **Step 5: Add root scripts**

Add to the root `package.json` `scripts`, keeping the existing entries:

```json
"site": "yarn --cwd ./site dev",
"site:build": "yarn --cwd ./site build",
"site:test": "yarn --cwd ./site test",
"site:deploy": "yarn --cwd ./site deploy",
"setup:site": "cd site && yarn && node ../copy-env.mjs ./"
```

Also extend the existing `setup` script to include the site:

```json
"setup": "yarn install && yarn setup:client && yarn setup:server && yarn setup:site"
```

- [ ] **Step 6: Install and verify dev server**

```bash
cd site && yarn && node ../copy-env.mjs ./
```

Run: `yarn site`
Expected: Astro dev server on `http://localhost:4321`, page reads "Scaffold works."

Stop the dev server before continuing.

- [ ] **Step 7: Commit**

```bash
git add site package.json
git commit -m "feat(site): scaffold the Astro package"
```

---

### Task 2: Content collection and the field allowlist

**Files:**
- Create: `site/src/content.config.ts`, `site/src/lib/video.ts`, `site/src/lib/video.test.ts`
- Test: `site/src/lib/video.test.ts`

**Interfaces:**
- Consumes: Task 1's package.
- Produces:
  - `VIDEO_FIELDS: readonly string[]` and `FORBIDDEN_FIELDS: readonly string[]` from `src/lib/video.ts`
  - `videoSchema` (zod) from `src/lib/video.ts`
  - Astro collection named `videos`, entry `id` = `youtubeVideoId`
  - Type `Video = z.infer<typeof videoSchema>`

- [ ] **Step 1: Write the failing test**

`site/src/lib/video.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_FIELDS, VIDEO_FIELDS, videoSchema } from './video';

describe('the published field allowlist', () => {
  // The allowlist is the privacy mechanism. Retrieval state is the bulk of
  // a Video row and must never be requested, let alone rendered.
  it('never requests retrieval state', () => {
    for (const forbidden of FORBIDDEN_FIELDS) {
      expect(VIDEO_FIELDS).not.toContain(forbidden);
    }
  });

  it('names the three retrieval fields explicitly', () => {
    expect(FORBIDDEN_FIELDS).toEqual([
      'transcriptSegments',
      'summaryEmbedding',
      'passageEmbeddings',
    ]);
  });

  it('requests the fields the pages actually render', () => {
    for (const needed of [
      'youtubeVideoId',
      'videoTitle',
      'summaryTitle',
      'summaryDescription',
      'summaryOverview',
      'watchVerdict',
      'finalScore',
      'readableArticle',
    ]) {
      expect(VIDEO_FIELDS).toContain(needed);
    }
  });
});

describe('videoSchema', () => {
  const row = {
    youtubeVideoId: 'abc123',
    url: 'https://www.youtube.com/watch?v=abc123',
    videoTitle: 'Kubernetes internals',
    videoAuthor: 'A channel',
    videoThumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
    summaryTitle: 'Kubernetes internals',
    summaryDescription: 'Scheduling and storage.',
    summaryOverview: 'Covers the scheduler.',
    watchVerdict: 'worth_it',
    verdictSummary: 'Worth it if you run clusters.',
    verdictReason: 'Concrete and specific.',
    finalScore: 83,
    summaryGeneratedAt: '2026-09-01T00:00:00.000Z',
    readableArticle: null,
    keyTakeaways: [{ text: 'The scheduler binds pods to nodes' }],
    sections: [{ heading: 'Scheduling', body: 'how it works', timeSec: 42 }],
    actionSteps: [{ title: 'Read the docs', body: 'start here' }],
    tags: [{ name: 'kubernetes' }],
  };

  it('accepts a complete row', () => {
    expect(videoSchema.parse(row).youtubeVideoId).toBe('abc123');
  });

  // Older rows predate some components. A missing array must not fail the
  // build — it means "none", not "broken".
  it('defaults the component arrays to empty', () => {
    const sparse = { ...row };
    delete (sparse as Record<string, unknown>).keyTakeaways;
    delete (sparse as Record<string, unknown>).sections;
    delete (sparse as Record<string, unknown>).actionSteps;
    delete (sparse as Record<string, unknown>).tags;

    const parsed = videoSchema.parse(sparse);

    expect(parsed.keyTakeaways).toEqual([]);
    expect(parsed.sections).toEqual([]);
    expect(parsed.actionSteps).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });

  it('allows a section with no timeSec', () => {
    const parsed = videoSchema.parse({
      ...row,
      sections: [{ heading: 'Ungrounded', body: 'no match found' }],
    });
    expect(parsed.sections[0].timeSec).toBeUndefined();
  });

  // A renamed Strapi field must break the build, not silently empty a page.
  it('rejects a row with no youtubeVideoId', () => {
    const broken = { ...row };
    delete (broken as Record<string, unknown>).youtubeVideoId;
    expect(() => videoSchema.parse(broken)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd site test src/lib/video.test.ts`
Expected: FAIL — `Cannot find module './video'`.

- [ ] **Step 3: Write the implementation**

`site/src/lib/video.ts`:

```ts
import { z } from 'astro/zod';

/** Server-side retrieval state. These are the bulk of a Video row and must
 *  never reach the published output: the BM25 token tables, the per-video
 *  vector, and the per-passage vectors. The allowlist below is how that is
 *  enforced — they are simply never requested. */
export const FORBIDDEN_FIELDS = [
  'transcriptSegments',
  'summaryEmbedding',
  'passageEmbeddings',
] as const;

/** The only Video fields the site fetches. Adding a field here is a
 *  deliberate act; anything absent cannot appear in the output. */
export const VIDEO_FIELDS = [
  'youtubeVideoId',
  'url',
  'videoTitle',
  'videoAuthor',
  'videoThumbnailUrl',
  'summaryTitle',
  'summaryDescription',
  'summaryOverview',
  'watchVerdict',
  'verdictSummary',
  'verdictReason',
  'finalScore',
  'summaryGeneratedAt',
  'readableArticle',
] as const;

export const videoSchema = z.object({
  youtubeVideoId: z.string(),
  url: z.string().nullable().optional(),
  videoTitle: z.string().nullable().optional(),
  videoAuthor: z.string().nullable().optional(),
  videoThumbnailUrl: z.string().nullable().optional(),
  summaryTitle: z.string().nullable().optional(),
  summaryDescription: z.string().nullable().optional(),
  summaryOverview: z.string().nullable().optional(),
  watchVerdict: z.enum(['worth_it', 'skim', 'skip']).nullable().optional(),
  verdictSummary: z.string().nullable().optional(),
  verdictReason: z.string().nullable().optional(),
  finalScore: z.number().nullable().optional(),
  summaryGeneratedAt: z.string().nullable().optional(),
  readableArticle: z.string().nullable().optional(),
  keyTakeaways: z.array(z.object({ text: z.string() })).default([]),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string().nullable().optional(),
        // Absent when BM25 found no confident match. Never invent one.
        timeSec: z.number().nullable().optional(),
      }),
    )
    .default([]),
  actionSteps: z
    .array(
      z.object({
        title: z.string(),
        body: z.string().nullable().optional(),
      }),
    )
    .default([]),
  tags: z.array(z.object({ name: z.string() })).default([]),
});

export type Video = z.infer<typeof videoSchema>;

/** The title to show: the model's summary title when it wrote one, else
 *  YouTube's. */
export function displayTitle(video: Video): string {
  return video.summaryTitle?.trim() || video.videoTitle?.trim() || video.youtubeVideoId;
}

/** A YouTube link, optionally seeking to a section's start.
 *
 *  Returns the plain watch URL when `timeSec` is absent — a section the
 *  pipeline could not ground gets no timecode rather than `t=0s`, which
 *  would be a fabricated claim about where the content is. */
export function youtubeUrlAt(
  youtubeVideoId: string,
  timeSec?: number | null,
): string {
  const base = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  if (typeof timeSec !== 'number' || !Number.isFinite(timeSec) || timeSec < 0) {
    return base;
  }
  return `${base}&t=${Math.floor(timeSec)}s`;
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd site test src/lib/video.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the content collection**

`site/src/content.config.ts`:

```ts
import { defineCollection } from 'astro:content';
import { strapiLoader } from 'strapi-community-astro-loader';
import { VIDEO_FIELDS, videoSchema } from './lib/video';

const clientConfig = {
  baseURL: import.meta.env.STRAPI_BASE_URL || 'http://localhost:1340/api',
};

const videos = defineCollection({
  loader: strapiLoader({
    contentType: 'video',
    clientConfig,
    params: {
      // Allowlist — see lib/video.ts. Retrieval state is never named here.
      fields: [...VIDEO_FIELDS],
      filters: { summaryStatus: { $eq: 'generated' } },
      sort: 'summaryGeneratedAt:desc',
      pagination: { pageSize: 500 },
      populate: {
        keyTakeaways: { fields: ['text'] },
        sections: { fields: ['heading', 'body', 'timeSec'] },
        actionSteps: { fields: ['title', 'body'] },
        tags: { fields: ['name'] },
      },
    },
  }),
  schema: videoSchema,
});

export const collections = { videos };
```

- [ ] **Step 6: Verify the collection loads against live Strapi**

Start the stack in a separate terminal (`yarn start` from the repo root) and wait for Strapi on 1340.

Temporarily replace `site/src/pages/index.astro` with:

```astro
---
import { getCollection } from 'astro:content';
import BaseLayout from '../layouts/BaseLayout.astro';

const videos = await getCollection('videos');
---

<BaseLayout title="Collection check">
  <p>{videos.length} videos loaded.</p>
  <ul>
    {videos.slice(0, 5).map((v) => <li>{v.data.summaryTitle ?? v.data.videoTitle}</li>)}
  </ul>
</BaseLayout>
```

Run: `yarn site:build`
Expected: build succeeds, and `site/dist/index.html` reports **172 videos loaded** (or whatever the current generated count is — it must match `SELECT COUNT(*) FROM videos WHERE summary_status='generated'`).

- [ ] **Step 7: Verify the build fails when Strapi is down** *(Review Focus 1)*

Stop Strapi. Run: `yarn site:build`
Expected: the build FAILS with a connection error. It must not produce a `dist/` with zero videos.

If the loader instead swallows the error and emits an empty site, add this guard to `site/src/content.config.ts` right after the collection definition and re-verify:

```ts
// A build that silently produced an empty site is worse than no build.
// Strapi being unreachable must stop the build, not quietly ship nothing.
if (import.meta.env.PROD) {
  const { getCollection } = await import('astro:content');
  const loaded = await getCollection('videos');
  if (loaded.length === 0) {
    throw new Error(
      'No videos loaded from Strapi. Is the stack running on ' +
        clientConfig.baseURL +
        '? Refusing to build an empty site.',
    );
  }
}
```

Restart Strapi before continuing.

- [ ] **Step 8: Commit**

```bash
git add site/src/content.config.ts site/src/lib/video.ts site/src/lib/video.test.ts site/src/pages/index.astro
git commit -m "feat(site): content collection with a field allowlist"
```

---

### Task 3: The video page

**Files:**
- Create: `site/src/pages/v/[videoId].astro`, `site/src/components/VerdictBadge.astro`, `site/src/components/TakeawayList.astro`, `site/src/components/SectionList.astro`, `site/src/components/ActionStepList.astro`
- Modify: `site/src/lib/video.test.ts` (add link tests)

**Interfaces:**
- Consumes: `Video`, `displayTitle`, `youtubeUrlAt`, `formatTimecode` from `src/lib/video.ts`; the `videos` collection.
- Produces: route `/v/<youtubeVideoId>`; components taking `{ video: Video }` (`TakeawayList`, `SectionList`, `ActionStepList`) and `{ verdict, score }` (`VerdictBadge`).

- [ ] **Step 1: Write the failing tests** *(Review Focus 3)*

Append to `site/src/lib/video.test.ts`:

```ts
import { displayTitle, formatTimecode, youtubeUrlAt } from './video';

describe('youtubeUrlAt', () => {
  it('seeks to the section start when there is one', () => {
    expect(youtubeUrlAt('abc123', 95)).toBe(
      'https://www.youtube.com/watch?v=abc123&t=95s',
    );
  });

  it('floors fractional seconds', () => {
    expect(youtubeUrlAt('abc123', 95.7)).toBe(
      'https://www.youtube.com/watch?v=abc123&t=95s',
    );
  });

  // ADR-0004: a section the pipeline could not ground gets no timecode.
  // Linking to t=0s would assert a location the data does not support.
  it('returns a plain watch URL when the section is ungrounded', () => {
    expect(youtubeUrlAt('abc123')).toBe('https://www.youtube.com/watch?v=abc123');
    expect(youtubeUrlAt('abc123', null)).toBe('https://www.youtube.com/watch?v=abc123');
    expect(youtubeUrlAt('abc123', Number.NaN)).toBe(
      'https://www.youtube.com/watch?v=abc123',
    );
  });
});

describe('formatTimecode', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatTimecode(95)).toBe('01:35');
  });

  it('formats past an hour as h:mm:ss', () => {
    expect(formatTimecode(3725)).toBe('1:02:05');
  });
});

describe('displayTitle', () => {
  it('prefers the summary title', () => {
    expect(
      displayTitle({ youtubeVideoId: 'x', summaryTitle: 'A', videoTitle: 'B' } as never),
    ).toBe('A');
  });

  it('falls back to the video title when the summary has none', () => {
    expect(
      displayTitle({ youtubeVideoId: 'x', summaryTitle: null, videoTitle: 'B' } as never),
    ).toBe('B');
  });

  it('falls back to the id when neither exists', () => {
    expect(displayTitle({ youtubeVideoId: 'x' } as never)).toBe('x');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `yarn --cwd site test src/lib/video.test.ts`
Expected: the `youtubeUrlAt` fractional/NaN cases and `displayTitle` fallbacks FAIL if the implementation from Task 2 is incomplete; otherwise they pass and you have confirmed the behaviour. Both outcomes are fine — do not weaken a test to make it fail.

- [ ] **Step 3: Create the presentational components**

`site/src/components/VerdictBadge.astro`:

```astro
---
interface Props {
  verdict?: 'worth_it' | 'skim' | 'skip' | null;
  score?: number | null;
}

const { verdict, score } = Astro.props;

const LABEL = {
  worth_it: 'Worth watching',
  skim: 'Skim it',
  skip: 'Skip it',
} as const;

const TONE = {
  worth_it: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  skim: 'bg-amber-50 text-amber-900 ring-amber-200',
  skip: 'bg-slate-100 text-slate-700 ring-slate-200',
} as const;
---

<div class="flex items-center gap-3">
  {verdict && (
    <span class={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${TONE[verdict]}`}>
      {LABEL[verdict]}
    </span>
  )}
  {typeof score === 'number' && (
    <span class="text-xs text-slate-500">Content score {score}</span>
  )}
</div>
```

`site/src/components/TakeawayList.astro`:

```astro
---
import type { Video } from '../lib/video';

interface Props {
  takeaways: Video['keyTakeaways'];
}

const { takeaways } = Astro.props;
---

{takeaways.length > 0 && (
  <section class="mt-8">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
      Key takeaways
    </h2>
    <ul class="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
      {takeaways.map((t) => <li>{t.text}</li>)}
    </ul>
  </section>
)}
```

`site/src/components/SectionList.astro`:

```astro
---
import type { Video } from '../lib/video';
import { formatTimecode, youtubeUrlAt } from '../lib/video';

interface Props {
  videoId: string;
  sections: Video['sections'];
}

const { videoId, sections } = Astro.props;
---

{sections.length > 0 && (
  <section class="mt-8">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">Sections</h2>
    <ol class="mt-3 space-y-4">
      {sections.map((s) => (
        <li>
          <div class="flex items-baseline gap-3">
            {typeof s.timeSec === 'number' ? (
              <a
                class="font-mono text-xs text-blue-700 hover:underline"
                href={youtubeUrlAt(videoId, s.timeSec)}
                rel="noopener"
                target="_blank"
              >
                {formatTimecode(s.timeSec)}
              </a>
            ) : (
              <span class="font-mono text-xs text-slate-400" title="No confident transcript match">
                --:--
              </span>
            )}
            <h3 class="font-medium">{s.heading}</h3>
          </div>
          {s.body && <p class="mt-1 pl-14 text-sm leading-relaxed text-slate-700">{s.body}</p>}
        </li>
      ))}
    </ol>
  </section>
)}
```

`site/src/components/ActionStepList.astro`:

```astro
---
import type { Video } from '../lib/video';

interface Props {
  steps: Video['actionSteps'];
}

const { steps } = Astro.props;
---

{steps.length > 0 && (
  <section class="mt-8">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
      Action steps
    </h2>
    <ul class="mt-3 space-y-3 text-sm leading-relaxed">
      {steps.map((s) => (
        <li>
          <span class="font-medium">{s.title}</span>
          {s.body && <span class="text-slate-700"> — {s.body}</span>}
        </li>
      ))}
    </ul>
  </section>
)}
```

Each component renders nothing when its array is empty, which is Review Focus 2: an older row with no sections produces a page without a Sections heading, not a crash.

- [ ] **Step 4: Create the video page**

`site/src/pages/v/[videoId].astro`:

```astro
---
import { getCollection } from 'astro:content';
import BaseLayout from '../../layouts/BaseLayout.astro';
import VerdictBadge from '../../components/VerdictBadge.astro';
import TakeawayList from '../../components/TakeawayList.astro';
import SectionList from '../../components/SectionList.astro';
import ActionStepList from '../../components/ActionStepList.astro';
import { displayTitle, youtubeUrlAt } from '../../lib/video';

export async function getStaticPaths() {
  const videos = await getCollection('videos');
  return videos.map((entry) => ({
    params: { videoId: entry.data.youtubeVideoId },
    props: { video: entry.data },
  }));
}

const { video } = Astro.props;
const title = displayTitle(video);
---

<BaseLayout title={title} description={video.summaryDescription ?? undefined}>
  <article>
    <p class="text-sm text-slate-500">{video.videoAuthor}</p>
    <h1 class="mt-1 text-3xl font-medium leading-tight">{title}</h1>

    <div class="mt-4">
      <VerdictBadge verdict={video.watchVerdict} score={video.finalScore} />
    </div>

    {video.verdictSummary && (
      <p class="mt-4 text-base leading-relaxed text-slate-800">{video.verdictSummary}</p>
    )}

    <p class="mt-4">
      <a
        class="text-sm text-blue-700 hover:underline"
        href={youtubeUrlAt(video.youtubeVideoId)}
        rel="noopener"
        target="_blank"
      >
        Watch on YouTube
      </a>
    </p>

    {video.summaryOverview && (
      <section class="mt-8">
        <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">Overview</h2>
        <p class="mt-3 text-sm leading-relaxed text-slate-800">{video.summaryOverview}</p>
      </section>
    )}

    <TakeawayList takeaways={video.keyTakeaways} />
    <SectionList videoId={video.youtubeVideoId} sections={video.sections} />
    <ActionStepList steps={video.actionSteps} />
  </article>
</BaseLayout>
```

- [ ] **Step 5: Build and verify a real page**

Run: `yarn site:build`
Expected: build succeeds and emits one HTML file per generated video under `site/dist/v/`.

Check a real one:

```bash
ls site/dist/v | head -3
grep -c 'youtube.com/watch' site/dist/v/*/index.html | head -3
```

Expected: at least one `&t=` link on a page whose video has grounded sections.

- [ ] **Step 6: Verify the sparse-row case** *(Review Focus 2)*

Find a video with no sections and confirm its page built without a Sections block:

```bash
sqlite3 server/.tmp/data.db "SELECT v.youtube_video_id FROM videos v LEFT JOIN videos_cmps c ON c.entity_id = v.id AND c.field='sections' WHERE v.summary_status='generated' GROUP BY v.id HAVING COUNT(c.id)=0 LIMIT 1;"
```

If that returns an id, open `site/dist/v/<id>/index.html` and confirm it exists and contains no `Sections` heading. If every video has sections, note that in the commit message and move on — the component's guard is still covered by the empty-array default test in Task 2.

- [ ] **Step 7: Commit**

```bash
git add site/src/pages/v site/src/components site/src/lib/video.test.ts
git commit -m "feat(site): video page with timecoded section links"
```

---

### Task 4: Tag pages

**Files:**
- Create: `site/src/lib/tags.ts`, `site/src/lib/tags.test.ts`, `site/src/pages/t/[tag].astro`, `site/src/components/TagPills.astro`
- Modify: `site/src/pages/v/[videoId].astro` (render tags)

**Interfaces:**
- Consumes: `Video` from `src/lib/video.ts`.
- Produces: `tagSlug(name: string): string`, `collectTags(videos: Video[]): Array<{ name: string; slug: string; count: number }>` from `src/lib/tags.ts`; route `/t/<slug>`.

- [ ] **Step 1: Write the failing test** *(Review Focus 4)*

`site/src/lib/tags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collectTags, tagSlug } from './tags';

describe('tagSlug', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(tagSlug('Local AI')).toBe('local-ai');
  });

  it('strips punctuation that would break a URL', () => {
    expect(tagSlug('C#/.NET')).toBe('c-net');
    expect(tagSlug('ai & agents')).toBe('ai-agents');
  });

  it('collapses runs of separators and trims them', () => {
    expect(tagSlug('  spaced   out  ')).toBe('spaced-out');
    expect(tagSlug('--edge--')).toBe('edge');
  });

  it('is stable — slugging a slug changes nothing', () => {
    expect(tagSlug(tagSlug('Local AI'))).toBe('local-ai');
  });
});

describe('collectTags', () => {
  const videos = [
    { tags: [{ name: 'Local AI' }, { name: 'strapi' }] },
    { tags: [{ name: 'local ai' }] },
    { tags: [] },
  ] as never[];

  it('counts videos per tag, merging names that slug the same', () => {
    const tags = collectTags(videos);
    const localAi = tags.find((t) => t.slug === 'local-ai');
    expect(localAi?.count).toBe(2);
  });

  it('sorts by count, then name', () => {
    expect(collectTags(videos).map((t) => t.slug)).toEqual(['local-ai', 'strapi']);
  });

  it('handles a library with no tags at all', () => {
    expect(collectTags([{ tags: [] }] as never[])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd site test src/lib/tags.test.ts`
Expected: FAIL — `Cannot find module './tags'`.

- [ ] **Step 3: Write the implementation**

`site/src/lib/tags.ts`:

```ts
import type { Video } from './video';

/** URL-safe, stable, and idempotent.
 *
 *  Tag names are user-entered in the app, so they arrive with spaces, case
 *  and punctuation. The slug is what appears in `/t/<slug>`, and
 *  `tagSlug(tagSlug(x)) === tagSlug(x)` so a slug can be round-tripped
 *  through the function without drifting. */
export function tagSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type TagSummary = { name: string; slug: string; count: number };

/** Every tag in the library with its video count, most used first.
 *
 *  Two names that slug the same ("Local AI" and "local ai") are one tag —
 *  the first name seen wins as the display name. */
export function collectTags(videos: Pick<Video, 'tags'>[]): TagSummary[] {
  const bySlug = new Map<string, TagSummary>();

  for (const video of videos) {
    for (const tag of video.tags ?? []) {
      const slug = tagSlug(tag.name);
      if (!slug) continue;
      const existing = bySlug.get(slug);
      if (existing) existing.count += 1;
      else bySlug.set(slug, { name: tag.name, slug, count: 1 });
    }
  }

  return Array.from(bySlug.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd site test src/lib/tags.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Create the shared video card**

The tag page in the next step imports this, so it comes first:

`site/src/components/VideoCard.astro`:

```astro
---
import type { Video } from '../lib/video';
import { displayTitle } from '../lib/video';

interface Props {
  video: Video;
}

const { video } = Astro.props;
---

<a class="block hover:bg-slate-50" href={`/v/${video.youtubeVideoId}`}>
  <h2 class="font-medium leading-snug">{displayTitle(video)}</h2>
  <p class="mt-1 text-xs text-slate-500">
    {video.videoAuthor}
    {typeof video.finalScore === 'number' && <span> · score {video.finalScore}</span>}
  </p>
  {video.summaryDescription && (
    <p class="mt-1 text-sm leading-relaxed text-slate-700">{video.summaryDescription}</p>
  )}
</a>
```

- [ ] **Step 6: Create the tag pill component and the tag page**

`site/src/components/TagPills.astro`:

```astro
---
import type { Video } from '../lib/video';
import { tagSlug } from '../lib/tags';

interface Props {
  tags: Video['tags'];
}

const { tags } = Astro.props;
---

{tags.length > 0 && (
  <ul class="mt-8 flex flex-wrap gap-2">
    {tags.map((t) => (
      <li>
        <a
          class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
          href={`/t/${tagSlug(t.name)}`}
        >
          {t.name}
        </a>
      </li>
    ))}
  </ul>
)}
```

`site/src/pages/t/[tag].astro`:

```astro
---
import { getCollection } from 'astro:content';
import BaseLayout from '../../layouts/BaseLayout.astro';
import VideoCard from '../../components/VideoCard.astro';
import { collectTags, tagSlug } from '../../lib/tags';

export async function getStaticPaths() {
  const entries = await getCollection('videos');
  const videos = entries.map((e) => e.data);

  return collectTags(videos).map((tag) => ({
    params: { tag: tag.slug },
    props: {
      tag,
      videos: videos.filter((v) => v.tags.some((t) => tagSlug(t.name) === tag.slug)),
    },
  }));
}

const { tag, videos } = Astro.props;
---

<BaseLayout title={`${tag.name} · YT knowledge base`}>
  <h1 class="text-2xl font-medium">{tag.name}</h1>
  <p class="mt-1 text-sm text-slate-500">
    {videos.length} {videos.length === 1 ? 'video' : 'videos'}
  </p>
  <ul class="mt-6 space-y-5">
    {videos.map((video) => <li><VideoCard video={video} /></li>)}
  </ul>
</BaseLayout>
```

- [ ] **Step 7: Render tags on the video page**

In `site/src/pages/v/[videoId].astro`, add the import:

```astro
import TagPills from '../../components/TagPills.astro';
```

and place `<TagPills tags={video.tags} />` immediately after `<ActionStepList steps={video.actionSteps} />`.

- [ ] **Step 8: Build and verify**

Run: `yarn site:build`
Expected: build succeeds; `site/dist/t/` contains one directory per tag (16 today).

```bash
ls site/dist/t | wc -l
```

- [ ] **Step 9: Commit**

```bash
git add site/src/lib/tags.ts site/src/lib/tags.test.ts site/src/pages/t site/src/components/TagPills.astro site/src/components/VideoCard.astro site/src/pages/v/[videoId].astro
git commit -m "feat(site): tag pages"
```

---

### Task 5: The search index endpoint

**Files:**
- Create: `site/src/lib/search-docs.ts`, `site/src/lib/search-docs.test.ts`, `site/src/pages/search-index.json.ts`

**Interfaces:**
- Consumes: `Video`, `displayTitle` from `src/lib/video.ts`.
- Produces: `SearchDoc = { id: string; title: string; author: string; description: string; overview: string; takeaways: string; sections: string; tags: string[]; verdict: string; score: number }` and `buildSearchDocs(videos: Video[]): SearchDoc[]` from `src/lib/search-docs.ts`; the static file `/search-index.json`.

- [ ] **Step 1: Write the failing test**

`site/src/lib/search-docs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSearchDocs } from './search-docs';

const video = {
  youtubeVideoId: 'abc123',
  videoTitle: 'Kubernetes internals',
  summaryTitle: 'How the scheduler works',
  videoAuthor: 'A channel',
  summaryDescription: 'Scheduling and storage.',
  summaryOverview: 'Covers the scheduler and storage classes.',
  readableArticle: 'A very long article body that should not be in the index.',
  watchVerdict: 'worth_it',
  finalScore: 83,
  keyTakeaways: [{ text: 'The scheduler binds pods to nodes' }],
  sections: [{ heading: 'Scheduling', body: 'how it works', timeSec: 42 }],
  actionSteps: [],
  tags: [{ name: 'kubernetes' }],
} as never;

describe('buildSearchDocs', () => {
  it('keys each document by the youtube video id', () => {
    expect(buildSearchDocs([video])[0].id).toBe('abc123');
  });

  it('indexes takeaway text and section headings', () => {
    const doc = buildSearchDocs([video])[0];
    expect(doc.takeaways).toContain('binds pods to nodes');
    expect(doc.sections).toContain('Scheduling');
  });

  // The article can be 7KB+ per video. Including it would multiply the index
  // size for little gain: the summary layer already names the same topics.
  it('leaves the readable article out of the index', () => {
    const serialized = JSON.stringify(buildSearchDocs([video]));
    expect(serialized).not.toContain('should not be in the index');
  });

  it('carries the facet fields the UI filters on', () => {
    const doc = buildSearchDocs([video])[0];
    expect(doc.tags).toEqual(['kubernetes']);
    expect(doc.verdict).toBe('worth_it');
    expect(doc.score).toBe(83);
  });

  it('tolerates a row with nothing but an id', () => {
    const sparse = {
      youtubeVideoId: 'x',
      keyTakeaways: [],
      sections: [],
      actionSteps: [],
      tags: [],
    } as never;

    const doc = buildSearchDocs([sparse])[0];

    expect(doc.id).toBe('x');
    expect(doc.title).toBe('x');
    expect(doc.takeaways).toBe('');
    expect(doc.score).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd site test src/lib/search-docs.test.ts`
Expected: FAIL — `Cannot find module './search-docs'`.

- [ ] **Step 3: Write the implementation**

`site/src/lib/search-docs.ts`:

```ts
import { displayTitle, type Video } from './video';

export type SearchDoc = {
  id: string;
  title: string;
  author: string;
  description: string;
  overview: string;
  takeaways: string;
  sections: string;
  tags: string[];
  verdict: string;
  score: number;
};

/** The index covers the summary layer only.
 *
 *  `readableArticle` is deliberately excluded: at ~7 KB per video it would
 *  dominate the payload, and the summary fields already name the same
 *  topics, so it buys recall the user does not miss. */
export function buildSearchDocs(videos: Video[]): SearchDoc[] {
  return videos.map((video) => ({
    id: video.youtubeVideoId,
    title: displayTitle(video),
    author: video.videoAuthor ?? '',
    description: video.summaryDescription ?? '',
    overview: video.summaryOverview ?? '',
    takeaways: (video.keyTakeaways ?? []).map((t) => t.text).join(' '),
    sections: (video.sections ?? []).map((s) => s.heading).join(' '),
    tags: (video.tags ?? []).map((t) => t.name),
    verdict: video.watchVerdict ?? '',
    score: video.finalScore ?? 0,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd site test src/lib/search-docs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Create the static endpoint**

`site/src/pages/search-index.json.ts`:

```ts
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildSearchDocs } from '../lib/search-docs';

/** Emitted as a static file at build time. The search island fetches it
 *  once and searches in memory — no per-keystroke network. */
export const GET: APIRoute = async () => {
  const entries = await getCollection('videos');
  const docs = buildSearchDocs(entries.map((e) => e.data));

  return new Response(JSON.stringify(docs), {
    headers: { 'Content-Type': 'application/json' },
  });
};
```

- [ ] **Step 6: Build and check the index size**

Run: `yarn site:build`

```bash
ls -lh site/dist/search-index.json
python3 -c "import json;d=json.load(open('site/dist/search-index.json'));print(len(d),'docs')"
```

Expected: one doc per generated video, file comfortably under 500 KB. If it is larger, confirm `readableArticle` is absent from the output before continuing.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/search-docs.ts site/src/lib/search-docs.test.ts site/src/pages/search-index.json.ts
git commit -m "feat(site): build-time search index"
```

---

### Task 6: Search UI and markdown rendering

**Files:**
- Create: `site/src/lib/search-engine.ts`, `site/src/lib/search-engine.test.ts`, `site/src/lib/markdown.ts`, `site/src/lib/markdown.test.ts`, `site/src/components/SearchBox.astro`, `site/src/components/search-client.ts`
- Modify: `site/src/pages/index.astro`, `site/src/pages/v/[videoId].astro` (render the article)

**Interfaces:**
- Consumes: `SearchDoc` from `src/lib/search-docs.ts`.
- Produces: `createIndex(docs: SearchDoc[]): MiniSearch<SearchDoc>` and `runSearch(index, query, opts?): SearchDoc[]` from `src/lib/search-engine.ts`; `renderMarkdown(src: string): string` from `src/lib/markdown.ts`.

- [ ] **Step 1: Write the failing tests** *(Review Focus 5)*

`site/src/lib/search-engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createIndex, runSearch } from './search-engine';
import type { SearchDoc } from './search-docs';

const docs: SearchDoc[] = [
  {
    id: 'kube',
    title: 'How the scheduler works',
    author: 'Cluster channel',
    description: 'Kubernetes scheduling internals.',
    overview: 'Covers pods, nodes and bin packing.',
    takeaways: 'The scheduler binds pods to nodes',
    sections: 'Scheduling Storage classes',
    tags: ['kubernetes'],
    verdict: 'worth_it',
    score: 83,
  },
  {
    id: 'strapi',
    title: 'Building an MCP server in Strapi',
    author: 'Paul',
    description: 'Exposing tools to a frontier model.',
    overview: 'Admin tokens, permission tiers, tool bodies.',
    takeaways: 'Tool bodies are defined once',
    sections: 'Setup Tiering',
    tags: ['strapi', 'mcp'],
    verdict: 'worth_it',
    score: 91,
  },
];

describe('runSearch', () => {
  const index = createIndex(docs);

  it('finds a video by a word in its title', () => {
    expect(runSearch(index, 'scheduler')[0].id).toBe('kube');
  });

  it('finds a video by a word that only appears in a takeaway', () => {
    expect(runSearch(index, 'frontier')[0].id).toBe('strapi');
  });

  it('matches on a prefix, so results appear while typing', () => {
    expect(runSearch(index, 'sched').map((d) => d.id)).toContain('kube');
  });

  it('returns an empty list for a blank query rather than everything', () => {
    expect(runSearch(index, '   ')).toEqual([]);
  });

  it('filters by tag when asked', () => {
    const hits = runSearch(index, 'tool', { tag: 'mcp' });
    expect(hits.map((d) => d.id)).toEqual(['strapi']);
    expect(runSearch(index, 'tool', { tag: 'kubernetes' })).toEqual([]);
  });
});
```

`site/src/lib/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    expect(renderMarkdown('# Title\n\nSome **bold** text.')).toContain('<h1');
    expect(renderMarkdown('# Title\n\nSome **bold** text.')).toContain('<strong>');
  });

  // The article and overview are model output. Treat them as untrusted
  // markup: a model that emits a <script> tag must not get one executed.
  it('does not emit script tags from raw HTML in the source', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
  });

  it('does not emit inline event handlers', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn --cwd site test src/lib/search-engine.test.ts src/lib/markdown.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Write the search engine**

`site/src/lib/search-engine.ts`:

```ts
import MiniSearch from 'minisearch';
import type { SearchDoc } from './search-docs';

/** Field weights: a hit in the title is worth more than one buried in the
 *  overview, which is what makes two-word queries land on the right video. */
const FIELD_BOOSTS = {
  title: 4,
  tags: 3,
  description: 2,
  takeaways: 2,
  sections: 2,
  author: 1.5,
  overview: 1,
};

export function createIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>({
    idField: 'id',
    fields: ['title', 'author', 'description', 'overview', 'takeaways', 'sections', 'tags'],
    storeFields: ['id', 'title', 'author', 'description', 'tags', 'verdict', 'score'],
    searchOptions: {
      boost: FIELD_BOOSTS,
      prefix: true,
      fuzzy: 0.2,
    },
  });
  index.addAll(docs);
  return index;
}

export type SearchOptions = {
  tag?: string;
  verdict?: string;
  minScore?: number;
};

/** Ranked matches, optionally narrowed by facet.
 *
 *  A blank query returns nothing rather than the whole library — the home
 *  page already lists videos, so dumping all of them into the result area
 *  would just be noise. */
export function runSearch(
  index: MiniSearch<SearchDoc>,
  query: string,
  opts: SearchOptions = {},
): SearchDoc[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return index
    .search(trimmed)
    .filter((hit) => {
      const doc = hit as unknown as SearchDoc;
      if (opts.tag && !(doc.tags ?? []).includes(opts.tag)) return false;
      if (opts.verdict && doc.verdict !== opts.verdict) return false;
      if (typeof opts.minScore === 'number' && (doc.score ?? 0) < opts.minScore) {
        return false;
      }
      return true;
    })
    .map((hit) => hit as unknown as SearchDoc);
}
```

- [ ] **Step 4: Write the markdown renderer**

`site/src/lib/markdown.ts`:

```ts
import { marked } from 'marked';

/** Render model-authored markdown.
 *
 *  `summaryOverview` and `readableArticle` are LLM output. They are content,
 *  not markup — so raw HTML in the source is escaped rather than passed
 *  through. Without this, a model that emitted a <script> tag would get one
 *  executed on a static page with no CSP to catch it. */
export function renderMarkdown(src: string): string {
  if (!src) return '';
  const escaped = src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return marked.parse(escaped, { async: false }) as string;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn --cwd site test src/lib/search-engine.test.ts src/lib/markdown.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Create the search island**

`site/src/components/search-client.ts`:

```ts
import { createIndex, runSearch } from '../lib/search-engine';
import type { SearchDoc } from '../lib/search-docs';

const input = document.querySelector<HTMLInputElement>('[data-search-input]');
const results = document.querySelector<HTMLElement>('[data-search-results]');
if (input && results) {
  let index: ReturnType<typeof createIndex> | null = null;

  const ensureIndex = async () => {
    if (index) return index;
    const res = await fetch('/search-index.json');
    if (!res.ok) throw new Error(`search index unavailable (${res.status})`);
    index = createIndex((await res.json()) as SearchDoc[]);
    return index;
  };

  const render = (hits: SearchDoc[], query: string) => {
    if (!query.trim()) {
      results.innerHTML = '';
      return;
    }
    if (hits.length === 0) {
      results.innerHTML =
        '<p class="mt-4 text-sm text-slate-500">No matches. Try fewer or more distinctive words.</p>';
      return;
    }
    results.innerHTML = hits
      .slice(0, 20)
      .map(
        (hit) => `
          <li class="border-t border-slate-100 py-3">
            <a class="block hover:bg-slate-50" href="/v/${hit.id}">
              <span class="font-medium">${escapeHtml(hit.title)}</span>
              <span class="ml-2 text-xs text-slate-500">${escapeHtml(hit.author ?? '')}</span>
              <p class="mt-1 text-sm text-slate-700">${escapeHtml(hit.description ?? '')}</p>
            </a>
          </li>`,
      )
      .join('');
  };

  const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );

  input.addEventListener('input', async () => {
    const query = input.value;
    try {
      const idx = await ensureIndex();
      render(runSearch(idx, query), query);
    } catch (err) {
      results.innerHTML = `<p class="mt-4 text-sm text-red-700">${escapeHtml(
        err instanceof Error ? err.message : 'Search failed',
      )}</p>`;
    }
  });

  // Cmd/Ctrl-K focuses search from anywhere on the page.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
```

`site/src/components/SearchBox.astro`:

```astro
---
interface Props {
  autofocus?: boolean;
}

const { autofocus = false } = Astro.props;
---

<div>
  <label class="sr-only" for="site-search">Search the library</label>
  <input
    autofocus={autofocus}
    class="w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-500"
    data-search-input
    id="site-search"
    placeholder="Search summaries, takeaways and sections…  (Cmd-K)"
    type="search"
  />
  <ul class="mt-2" data-search-results></ul>
</div>

<script>
  import '../components/search-client.ts';
</script>
```

- [ ] **Step 7: Put search on the home page and the article on the video page**

Replace `site/src/pages/index.astro` with:

```astro
---
import { getCollection } from 'astro:content';
import BaseLayout from '../layouts/BaseLayout.astro';
import SearchBox from '../components/SearchBox.astro';
import VideoCard from '../components/VideoCard.astro';

const entries = await getCollection('videos');
const videos = entries.map((e) => e.data);

const recent = [...videos]
  .sort((a, b) => (b.summaryGeneratedAt ?? '').localeCompare(a.summaryGeneratedAt ?? ''))
  .slice(0, 10);

const top = [...videos]
  .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
  .slice(0, 10);
---

<BaseLayout
  title="YT knowledge base"
  description="Searchable summaries of the videos in my library."
>
  <h1 class="text-2xl font-medium">Find a video</h1>
  <p class="mt-1 text-sm text-slate-500">{videos.length} summarized videos.</p>

  <div class="mt-6">
    <SearchBox autofocus={true} />
  </div>

  <section class="mt-12">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">Recent</h2>
    <ul class="mt-3 space-y-5">
      {recent.map((video) => <li><VideoCard video={video} /></li>)}
    </ul>
  </section>

  <section class="mt-12">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
      Highest scoring
    </h2>
    <ul class="mt-3 space-y-5">
      {top.map((video) => <li><VideoCard video={video} /></li>)}
    </ul>
  </section>
</BaseLayout>
```

In `site/src/pages/v/[videoId].astro`, add the import:

```astro
import { renderMarkdown } from '../../lib/markdown';
```

and add this after `<TagPills tags={video.tags} />`:

```astro
{video.readableArticle && (
  <section class="mt-12 border-t border-slate-200 pt-8">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
      Readable article
    </h2>
    <div
      class="prose prose-slate mt-4 max-w-none text-sm leading-relaxed"
      set:html={renderMarkdown(video.readableArticle)}
    />
  </section>
)}
```

- [ ] **Step 8: Expose the tag facet in the UI**

`runSearch` already takes a tag and is tested for it, but nothing lets the
user set one — and narrowing to a topic is half of what "discussing related
topics" needs.

In `site/src/components/SearchBox.astro`, add a select above the results
list, inside the same `<div>`:

```astro
<select
  class="mt-2 rounded-lg border border-slate-300 px-2 py-1 text-sm"
  data-search-tag
>
  <option value="">All tags</option>
</select>
```

In `site/src/components/search-client.ts`, populate it from the index and
feed it into the search. Add after `ensureIndex` is defined:

```ts
const tagSelect = document.querySelector<HTMLSelectElement>('[data-search-tag]');

const fillTags = (docs: SearchDoc[]) => {
  if (!tagSelect || tagSelect.options.length > 1) return;
  const names = [...new Set(docs.flatMap((d) => d.tags ?? []))].sort();
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    tagSelect.append(option);
  }
};
```

Change `ensureIndex` to call `fillTags(docs)` with the fetched documents
before building the index, and change the input handler to pass the facet:

```ts
render(runSearch(idx, query, { tag: tagSelect?.value || undefined }), query);
```

Finally, re-run the search when the facet changes:

```ts
tagSelect?.addEventListener('change', () => {
  input.dispatchEvent(new Event('input'));
});
```

- [ ] **Step 9: Build and verify search in a browser**

Run: `yarn site:build && yarn --cwd site preview`

In the browser at the preview URL:
1. Type `strapi` — results appear without a full page load.
2. Press Cmd-K from a video page — focus lands in the search box.
3. Open a video that has a readable article and confirm it renders as formatted prose.
4. Pick a tag from the facet and confirm results narrow to that tag.

Expected: all four hold. Stop the preview server.

- [ ] **Step 10: Commit**

```bash
git add site/src/lib/search-engine.ts site/src/lib/search-engine.test.ts site/src/lib/markdown.ts site/src/lib/markdown.test.ts site/src/components/SearchBox.astro site/src/components/search-client.ts site/src/pages/index.astro site/src/pages/v/[videoId].astro
git commit -m "feat(site): in-memory search and article rendering"
```

---

### Task 7: The articles route and 404

**Files:**
- Create: `site/src/pages/articles.astro`, `site/src/pages/404.astro`

**Interfaces:**
- Consumes: the `videos` collection, `VideoCard`.
- Produces: routes `/articles` and `/404`.

- [ ] **Step 1: Create the articles page**

`site/src/pages/articles.astro`:

```astro
---
import { getCollection } from 'astro:content';
import BaseLayout from '../layouts/BaseLayout.astro';
import VideoCard from '../components/VideoCard.astro';

const entries = await getCollection('videos');
const withArticles = entries
  .map((e) => e.data)
  .filter((v) => Boolean(v.readableArticle))
  .sort((a, b) => (b.summaryGeneratedAt ?? '').localeCompare(a.summaryGeneratedAt ?? ''));
---

<BaseLayout title="Articles · YT knowledge base">
  <h1 class="text-2xl font-medium">Articles</h1>
  <p class="mt-1 text-sm text-slate-500">
    {withArticles.length} videos with a full written version.
  </p>
  <ul class="mt-6 space-y-5">
    {withArticles.map((video) => <li><VideoCard video={video} /></li>)}
  </ul>
</BaseLayout>
```

- [ ] **Step 2: Create the 404 page**

`site/src/pages/404.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import SearchBox from '../components/SearchBox.astro';
---

<BaseLayout title="Not found · YT knowledge base">
  <h1 class="text-2xl font-medium">Nothing here</h1>
  <p class="mt-2 text-sm text-slate-600">
    That page does not exist. Search for a video instead.
  </p>
  <div class="mt-6">
    <SearchBox autofocus={true} />
  </div>
</BaseLayout>
```

- [ ] **Step 3: Add navigation to the layout**

In `site/src/layouts/BaseLayout.astro`, replace the `<header>` block with:

```astro
    <header class="mb-10 flex items-baseline gap-4">
      <a class="text-sm font-medium text-slate-900" href="/">YT knowledge base</a>
      <a class="text-sm text-slate-500 hover:text-slate-900" href="/articles">Articles</a>
    </header>
```

- [ ] **Step 4: Build and verify**

Run: `yarn site:build`

```bash
test -f site/dist/articles/index.html && echo "articles ok"
test -f site/dist/404.html && echo "404 ok"
```

Expected: both print ok, and the articles count matches the number of videos with a readable article (49 at the time of writing).

- [ ] **Step 5: Commit**

```bash
git add site/src/pages/articles.astro site/src/pages/404.astro site/src/layouts/BaseLayout.astro
git commit -m "feat(site): articles index and 404"
```

---

### Task 8: The output guard

**Files:**
- Create: `site/src/lib/output-guard.ts`, `site/src/lib/output-guard.test.ts`, `site/scripts/verify-output.mjs`

**Interfaces:**
- Consumes: `FORBIDDEN_FIELDS` from `src/lib/video.ts`.
- Produces: `findForbidden(text: string): string[]` from `src/lib/output-guard.ts`; `node scripts/verify-output.mjs` exiting non-zero on a violation, wired into `site/package.json`'s `build` script in Step 5.

- [ ] **Step 1: Write the failing test**

`site/src/lib/output-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findForbidden } from './output-guard';

describe('findForbidden', () => {
  // The allowlist in content.config.ts is the mechanism. This proves it held
  // all the way through to the bytes on disk.
  it('catches each piece of retrieval state by name', () => {
    expect(findForbidden('{"summaryEmbedding":[0.1]}')).toContain('summaryEmbedding');
    expect(findForbidden('{"passageEmbeddings":{}}')).toContain('passageEmbeddings');
    expect(findForbidden('{"transcriptSegments":{}}')).toContain('transcriptSegments');
  });

  it('reports every violation in one pass, not just the first', () => {
    expect(findForbidden('summaryEmbedding passageEmbeddings')).toEqual([
      'passageEmbeddings',
      'summaryEmbedding',
    ]);
  });

  it('passes ordinary page markup', () => {
    expect(findForbidden('<h1>How the scheduler works</h1>')).toEqual([]);
  });

  it('does not fire on the words in ordinary prose', () => {
    expect(findForbidden('This video covers embeddings and transcripts.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd site test src/lib/output-guard.test.ts`
Expected: FAIL — `Cannot find module './output-guard'`.

- [ ] **Step 3: Write the implementation**

`site/src/lib/output-guard.ts`:

```ts
import { FORBIDDEN_FIELDS } from './video';

/** Field names that must never appear in published output.
 *
 *  Matched as exact field names, not as substrings of prose — a summary that
 *  discusses "embeddings" is fine; a page carrying a `summaryEmbedding` key
 *  is a leak. */
export function findForbidden(text: string): string[] {
  return FORBIDDEN_FIELDS.filter((field) => text.includes(field)).sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd site test src/lib/output-guard.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the build-time script**

`site/scripts/verify-output.mjs`:

```js
#!/usr/bin/env node
// Fails the build if any published file carries server-side retrieval
// state. The field allowlist in src/content.config.ts is the mechanism;
// this is the proof it held, run over the bytes that actually ship.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const FORBIDDEN = ['transcriptSegments', 'summaryEmbedding', 'passageEmbeddings'];
const TEXT = /\.(html|json|js|css|txt|xml)$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (TEXT.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  for (const field of FORBIDDEN) {
    if (text.includes(field)) violations.push(`${file}: ${field}`);
  }
}

if (violations.length > 0) {
  console.error('Published output contains server-side retrieval state:\n');
  for (const v of violations.slice(0, 20)) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s). Check the fields[] allowlist.`);
  process.exit(1);
}

console.log(`Output guard: clean (${walk(DIST).length} files checked).`);
```

- [ ] **Step 6: Wire the guard into the build**

In `site/package.json`, change the `build` script so a failed guard fails
the build:

```json
"build": "astro build && node scripts/verify-output.mjs",
```

- [ ] **Step 7: Verify the guard passes on a real build**

Run: `yarn site:build`
Expected: build completes and prints `Output guard: clean (N files checked).`

- [ ] **Step 8: Verify the guard actually catches a leak**

Temporarily add `'summaryEmbedding'` to `VIDEO_FIELDS` in `site/src/lib/video.ts`, then:

Run: `yarn site:build`
Expected: the `video.test.ts` allowlist test fails first; if you bypass that by running `yarn --cwd site astro build && node site/scripts/verify-output.mjs`, the guard exits non-zero and names the offending files.

Revert the change and re-run `yarn site:build` to confirm it is clean again.

- [ ] **Step 9: Commit**

```bash
git add site/src/lib/output-guard.ts site/src/lib/output-guard.test.ts site/scripts/verify-output.mjs
git add site/package.json
git commit -m "feat(site): fail the build if retrieval state reaches the output"
```

---

### Task 9: Netlify deploy and documentation

**Files:**
- Create: `site/netlify.toml`, `site/README.md`
- Modify: `CLAUDE.md` (repository shape, commands)

**Interfaces:**
- Consumes: everything above.
- Produces: a deployed site; `yarn site:deploy`.

- [ ] **Step 1: Create the Netlify config**

`site/netlify.toml`:

```toml
# The site is built locally against a running Strapi and deployed as
# finished output — Netlify never builds it, because Strapi is not
# reachable from their runners.
[build]
  publish = "dist"
  command = ""

[[headers]]
  for = "/search-index.json"
  [headers.values]
    Cache-Control = "public, max-age=300"
```

- [ ] **Step 2: Write the site README**

`site/README.md`:

```markdown
# yt-kb static site

A static, searchable build of the knowledge base summary layer.

## What it publishes

Per video: title, author, thumbnail, verdict, content score, overview, key
takeaways, sections with timecoded links into the video, action steps, tags,
and the readable article when one exists.

It does **not** publish raw transcripts, embeddings, or the BM25 index. The
`fields[]` allowlist in `src/lib/video.ts` is the mechanism;
`scripts/verify-output.mjs` fails the build if anything slips through.

## Build

The build reads Strapi at `STRAPI_BASE_URL` (default `http://localhost:1340/api`),
so the stack must be running:

```bash
yarn start        # from the repo root, in another terminal
yarn site:build   # from the repo root
```

The build fails if Strapi is unreachable rather than publishing an empty site.

## Deploy

```bash
yarn site:deploy  # netlify deploy --prod --dir=dist
```

First time only: `npx netlify login && npx netlify link`.

## Search

`/search-index.json` is emitted at build time from the summary layer and
loaded once by the search island. Everything else on the site ships zero
JavaScript.
```

- [ ] **Step 3: Update the repository documentation**

In `CLAUDE.md`, under **Repository shape**, add after the `server/` bullet:

```markdown
- `site/` — Astro 6 static build of the summary layer, searchable in the browser, deployed to Netlify. Reads Strapi at build time only; publishes no transcripts or retrieval state. See `site/README.md` and `docs/superpowers/specs/2026-10-11-static-knowledge-site-design.md`.
```

And in the **Common commands** table, add:

```markdown
| `yarn site` | Astro dev server on 4321. Needs Strapi up. |
| `yarn site:build` | Static build + output guard. Fails if Strapi is unreachable. |
| `yarn site:deploy` | `netlify deploy --prod` from `site/dist`. |
```

- [ ] **Step 4: Run the full check**

```bash
yarn site:test     # all site unit tests
yarn site:build    # build + guard
yarn test          # the app suite, unaffected
```

Expected: site tests pass; build prints the guard's clean line; the app suite is unchanged (one failure expected if Strapi is live — the documented tag-creation smoke test).

- [ ] **Step 5: Deploy**

```bash
cd site && npx netlify login && npx netlify link   # first time only
cd /Users/paul/projects/yt-knowledge-base && yarn site:deploy
```

Expected: Netlify prints a live URL. Open it and confirm: search returns results, a video page renders with timecoded section links, and a tag page lists its videos.

- [ ] **Step 6: Commit**

```bash
git add site/netlify.toml site/README.md CLAUDE.md
git commit -m "feat(site): netlify deploy and docs"
```

---

## Done when

- `yarn site:build` produces a static site from the live library, and fails loudly when Strapi is down.
- Every published video has a page at `/v/<youtubeVideoId>` with its summary layer, timecoded sections, and article when one exists.
- Typing two or three words in the search box finds the right video with no per-keystroke network.
- `scripts/verify-output.mjs` passes, proving no embeddings, BM25 index or transcript text shipped.
- The site is live on Netlify.
