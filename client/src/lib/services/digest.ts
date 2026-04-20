// Cross-video digest synthesis. Generates an ephemeral meta-summary over a
// selection of videos — no persistence. The synthesis runs over the already-
// compiled summary fields (overview, sections, takeaways, verdict), not
// transcripts, so the token footprint stays small (~2KB per video).
//
// Called from the server function layer (/digest route, MCP tool).
import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';
import {
  fetchVideoByDocumentIdService,
  fetchVideoByVideoIdService,
  type StrapiVideo,
} from '#/lib/services/videos';
import { withRetry } from '#/lib/retry';
import { OLLAMA_HOST, OLLAMA_MODEL as SUMMARY_MODEL } from '#/lib/env';

const digestAdapter = createOllamaChat(SUMMARY_MODEL, OLLAMA_HOST);

export const DIGEST_MAX_VIDEOS = 5;
export const DIGEST_MIN_VIDEOS = 2;

// Output shape for the synthesis call. Contradictions + viewingOrder are
// optional because many selections don't warrant them — empty arrays hide
// those sections in the UI. videoTitles inside sharedThemes are soft links
// that the renderer fuzzy-matches to real selected videos before wiring up
// the clickable chips.
export const DigestSchema = z.object({
  title: z
    .string()
    .describe('Short punchy title for the digest. MAX 200 characters.'),
  description: z
    .string()
    .describe(
      'One-sentence subtitle summarizing what the digest covers across the selected videos. MAX 400 characters.',
    ),
  overallTheme: z
    .string()
    .describe(
      'One or two paragraphs describing the shared topic or throughline. What these videos are collectively about. Do NOT list each video separately here — that comes later.',
    ),
  sharedThemes: z
    .array(
      z.object({
        title: z
          .string()
          .describe(
            'A human-readable descriptive title for the theme, like "Multi-agent coordination protocols" or "Trust and authentication". MUST be a real English phrase that a reader would understand in isolation. Do NOT use schema field names, iteration numbers, "Theme 1", "Video1", underscores, or camelCase identifiers. MAX 200 characters.',
          ),
        body: z
          .string()
          .describe(
            'Description of the theme and how the videos cover it. MAX 1500 characters. No markdown headings.',
          ),
        videoTitles: z
          .array(z.string())
          .describe(
            'Exact titles (as given in the input) of the videos that cover this theme. Use the title string verbatim.',
          ),
      }),
    )
    .min(1)
    .max(8)
    .describe(
      'Themes that appear across two or more of the selected videos, with which videos cover each. Minimum 1, maximum 8.',
    ),
  uniqueInsights: z
    .array(
      z.object({
        videoTitle: z.string().describe('Exact video title from the input.'),
        insight: z
          .string()
          .describe(
            'What this video uniquely contributes that the others do not. MAX 600 characters.',
          ),
      }),
    )
    .describe(
      'For each selected video, what unique angle or content it adds. One entry per video, ideally.',
    ),
  contradictions: z
    .array(
      z.object({
        topic: z.string().describe('The contested idea. MAX 200 characters.'),
        positions: z
          .array(
            z.object({
              videoTitle: z.string(),
              stance: z
                .string()
                .describe('The video\'s position on the topic. MAX 400 characters.'),
            }),
          )
          .min(2),
      }),
    )
    .describe(
      'Genuine disagreements between the videos. ONLY include real contradictions — leave empty if the videos mostly agree.',
    ),
  viewingOrder: z
    .array(
      z.object({
        videoTitle: z.string(),
        why: z
          .string()
          .describe('Why this video comes at this position. MAX 300 characters.'),
      }),
    )
    .describe(
      'Recommended order to watch the videos in, with reasoning. Leave empty if order does not matter.',
    ),
  bottomLine: z
    .string()
    .describe(
      'The "if you read nothing else" TL;DR. 2-4 sentences synthesizing the most important cross-video takeaway. MAX 800 characters.',
    ),
});

export type Digest = z.infer<typeof DigestSchema>;

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

function logPhase(tag: string, phase: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [digest ${tag}] ${phase}${body}`);
}

function ms(start: number): string {
  return `${Math.round(performance.now() - start)}ms`;
}

// Strapi field limits. Clamp on the client so a rare model overshoot
// doesn't land garbage in a copy/save-as-note payload.
const LIMITS = {
  title: 200,
  description: 400,
  themeTitle: 200,
  themeBody: 1500,
  insight: 600,
  contradictionTopic: 200,
  contradictionStance: 400,
  viewingOrderReason: 300,
  bottomLine: 800,
} as const;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max - 1);
  const lastSpace = window.lastIndexOf(' ');
  const boundary = lastSpace > max * 0.6 ? lastSpace : window.length;
  return `${window.slice(0, boundary).trimEnd()}…`;
}

function sanitizeDigest(raw: Digest): Digest {
  return {
    ...raw,
    title: clamp(raw.title, LIMITS.title),
    description: clamp(raw.description, LIMITS.description),
    overallTheme: raw.overallTheme,
    sharedThemes: raw.sharedThemes.map((t) => ({
      title: clamp(t.title, LIMITS.themeTitle),
      body: clamp(t.body, LIMITS.themeBody),
      videoTitles: t.videoTitles,
    })),
    uniqueInsights: raw.uniqueInsights.map((u) => ({
      videoTitle: u.videoTitle,
      insight: clamp(u.insight, LIMITS.insight),
    })),
    contradictions: raw.contradictions.map((c) => ({
      topic: clamp(c.topic, LIMITS.contradictionTopic),
      positions: c.positions.map((p) => ({
        videoTitle: p.videoTitle,
        stance: clamp(p.stance, LIMITS.contradictionStance),
      })),
    })),
    viewingOrder: raw.viewingOrder.map((v) => ({
      videoTitle: v.videoTitle,
      why: clamp(v.why, LIMITS.viewingOrderReason),
    })),
    bottomLine: clamp(raw.bottomLine, LIMITS.bottomLine),
  };
}

// Fuzzy-match the model's returned `videoTitle` strings against the real
// selected videos. The model is instructed to use input titles verbatim but
// can paraphrase, typo, or return "Video A". Drop any match that doesn't
// resolve — logged so bad output surfaces in the server terminal.
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DigestSourceVideo = {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
};

export function resolveVideoTitle(
  candidate: string,
  videos: DigestSourceVideo[],
): DigestSourceVideo | null {
  const target = normalizeTitle(candidate);
  if (!target) return null;

  // Exact match first
  for (const v of videos) {
    if (!v.videoTitle) continue;
    if (normalizeTitle(v.videoTitle) === target) return v;
  }

  // Prefix / contains fallback — either direction (the model might
  // truncate a long title, or pad a short one with extra words)
  for (const v of videos) {
    if (!v.videoTitle) continue;
    const vt = normalizeTitle(v.videoTitle);
    if (vt.includes(target) || target.includes(vt)) return v;
  }

  return null;
}

// Build the user-side prompt content from a video's structured summary.
// Compact but evidence-dense: title + author + verdict + description +
// overview + takeaways + section headings. No transcript chunks — the
// digest synthesizes across the already-compressed summary layer.
function formatVideoForSynthesis(video: StrapiVideo, index: number): string {
  const lines: string[] = [];
  lines.push(`### Video ${index + 1}: ${video.videoTitle ?? 'Untitled'}`);
  if (video.videoAuthor) lines.push(`Author: ${video.videoAuthor}`);
  if (video.summaryDescription) lines.push(`Subtitle: ${video.summaryDescription}`);
  if (video.verdictSummary) lines.push(`Watch verdict: ${video.verdictSummary}`);

  if (video.summaryOverview) {
    lines.push('');
    lines.push('Overview:');
    lines.push(video.summaryOverview);
  }

  if (video.keyTakeaways && video.keyTakeaways.length > 0) {
    lines.push('');
    lines.push('Key takeaways:');
    for (const t of video.keyTakeaways) lines.push(`- ${t.text}`);
  }

  if (video.sections && video.sections.length > 0) {
    lines.push('');
    lines.push('Section outline:');
    for (const s of video.sections) {
      // Include just the heading + a one-line body excerpt to keep the
      // input tight while still giving the synthesizer structural cues.
      const body = s.body.replace(/\s+/g, ' ').slice(0, 160);
      lines.push(`- ${s.heading}: ${body}${body.length >= 160 ? '…' : ''}`);
    }
  }

  return lines.join('\n');
}

const DIGEST_SYSTEM = [
  'You synthesize a cross-video digest from several YouTube video summaries for a personal knowledge base.',
  'Your output is a structured, evidence-oriented report that highlights what the videos share, where they differ, and what each uniquely contributes.',
  '',
  'Rules:',
  ' • Every videoTitle you reference MUST be copied verbatim from the input — do not paraphrase or invent titles.',
  ' • Ground every claim in what the summaries actually say. Do not invent topics or stances.',
  ' • sharedThemes should reflect ideas that genuinely appear in TWO OR MORE of the provided videos. If only one video covers something, it belongs in uniqueInsights, not sharedThemes.',
  ' • contradictions should ONLY list real disagreements — two videos taking opposing positions on the same concrete topic. Leave empty if the videos mostly agree (which is common).',
  ' • viewingOrder should only be populated if one video clearly benefits from another as prerequisite. Leave empty when order does not matter.',
  ' • bottomLine is the TL;DR — what the reader should walk away with if they read nothing else.',
  ' • No marketing fluff. No sentence-length filler. Be specific.',
  '',
  'TITLE FORMAT — Every `title` field (on sharedThemes, contradictions.topic, etc.) must be a real, natural-English phrase a human would understand on its own. Examples of GOOD titles: "Multi-agent coordination protocols", "Trust and authentication", "Sandboxed execution environments", "Human-in-the-loop oversight". Examples of BAD titles (NEVER use): "uniqueInsights_Video1", "Theme 1", "sharedTheme1", "video1_insight", or any string containing underscores, camelCase, or iteration numbers. Titles are READ BY A PERSON, not consumed as identifiers.',
].join('\n');

// Detect when the model returned a schema-key-shaped string instead of a
// human-readable title (the most common Gemma failure mode). Used to flag
// + log obvious garbage so we see it in logs and can tune the prompt.
const LIKELY_SCHEMA_KEY = /^[a-z][a-zA-Z]*(_[A-Za-z0-9]+)+$/;
function looksLikeSchemaKey(title: string): boolean {
  return LIKELY_SCHEMA_KEY.test(title.trim());
}

export async function synthesizeDigest(
  videos: StrapiVideo[],
): Promise<ServiceResult<Digest>> {
  if (videos.length < DIGEST_MIN_VIDEOS) {
    return {
      success: false,
      error: `Need at least ${DIGEST_MIN_VIDEOS} videos to create a digest.`,
    };
  }
  if (videos.length > DIGEST_MAX_VIDEOS) {
    return {
      success: false,
      error: `Max ${DIGEST_MAX_VIDEOS} videos per digest.`,
    };
  }

  const ineligible = videos.filter((v) => v.summaryStatus !== 'generated');
  if (ineligible.length > 0) {
    const titles = ineligible
      .map((v) => v.videoTitle ?? v.youtubeVideoId)
      .join(', ');
    return {
      success: false,
      error: `These videos need summaries first: ${titles}`,
    };
  }

  const tag = videos.map((v) => v.youtubeVideoId).join(',');
  const started = performance.now();
  logPhase(tag, '▶ synthesizing', {
    videos: videos.length,
    model: SUMMARY_MODEL,
  });

  const userPrompt = [
    `Synthesize a digest across the following ${videos.length} videos. Reference titles verbatim from each entry.`,
    '',
    ...videos.map((v, i) => formatVideoForSynthesis(v, i)),
  ].join('\n\n');

  try {
    const object = (await withRetry(
      () =>
        chat({
          adapter: digestAdapter,
          messages: [
            { role: 'system', content: DIGEST_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          outputSchema: DigestSchema,
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(tag, `↻ retry ${attempt}/1 in ${delayMs}ms`, {
            cause: err instanceof Error ? err.message : 'unknown',
          });
        },
      },
    )) as Digest;

    const safe = sanitizeDigest(object);
    const badTitles = safe.sharedThemes
      .map((t) => t.title)
      .filter((t) => looksLikeSchemaKey(t));
    if (badTitles.length > 0) {
      logPhase(tag, '⚠ model returned schema-key-shaped titles', {
        titles: badTitles,
      });
    }
    logPhase(tag, '✓ synthesized', {
      took: ms(started),
      sharedThemes: safe.sharedThemes.length,
      uniqueInsights: safe.uniqueInsights.length,
      contradictions: safe.contradictions.length,
      viewingOrder: safe.viewingOrder.length,
    });
    return { success: true, data: safe };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Digest generation failed';
    logPhase(tag, '✗ failed', { error: message, took: ms(started) });
    return { success: false, error: message };
  }
}

// Orchestration: accept a list of identifiers (documentId or youtubeVideoId),
// load the full video records in parallel, and synthesize. Returns both the
// digest and the source video metadata — the UI needs both for clickable
// theme chips.
export async function generateDigestByIds(
  identifiers: string[],
): Promise<
  | { success: true; digest: Digest; videos: StrapiVideo[] }
  | { success: false; error: string }
> {
  const unique = Array.from(new Set(identifiers.map((s) => s.trim()).filter(Boolean)));
  if (unique.length < DIGEST_MIN_VIDEOS) {
    return {
      success: false,
      error: `Pick at least ${DIGEST_MIN_VIDEOS} videos.`,
    };
  }
  if (unique.length > DIGEST_MAX_VIDEOS) {
    return {
      success: false,
      error: `Pick at most ${DIGEST_MAX_VIDEOS} videos.`,
    };
  }

  // Lookup: try youtubeVideoId first (the feed selection path), fall back
  // to documentId (flexibility for callers like MCP).
  const videos: StrapiVideo[] = [];
  const missing: string[] = [];
  await Promise.all(
    unique.map(async (id) => {
      const byVid = await fetchVideoByVideoIdService(id).catch(() => null);
      if (byVid) {
        videos.push(byVid);
        return;
      }
      const byDoc = await fetchVideoByDocumentIdService(id).catch(() => null);
      if (byDoc) {
        videos.push(byDoc);
        return;
      }
      missing.push(id);
    }),
  );

  if (missing.length > 0) {
    return {
      success: false,
      error: `Could not find: ${missing.join(', ')}`,
    };
  }

  const result = await synthesizeDigest(videos);
  if (!result.success) return result;
  return { success: true, digest: result.data, videos };
}
