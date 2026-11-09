// Persist a summary the calling agent generated (e.g. Claude) to an existing
// Video row, in the shape the app's pipeline writes
// (client/src/lib/services/learning.ts).
//
// Section timecodes are not taken from the caller — the input has none. As
// in the app, each section's moment is found in the transcript: BM25 over
// the transcript's model-free index (Transcript.searchIndex, built here if
// missing) with "<heading>. <body>" as the query, through
// findEvidenceForQuote with minimum score 1.0 — the same call the app's
// summary pipeline makes (client/src/lib/services/learning.ts). A section
// with no match at or above that score gets timeSec null. CLAUDE.md: never
// trust a timecode a model produced.
//
// This tool does not build Video.transcriptSegments, the app's contextual
// index; the search tools use the transcript's index when it is missing.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';
import { findEvidenceForQuote } from '../../services/bm25-core';
import {
  ensureTranscriptSearchIndex,
  loadTranscriptSearchIndex,
  type TranscriptIndexSource,
} from '../../services/search-index';
import { resolveByEitherId } from './video-access';

const SectionSchema = z.object({
  heading: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
});

const TakeawaySchema = z.object({
  text: z.string().min(1).max(280),
});

const ActionStepSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
});

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('youtubeVideoId or Strapi documentId of an existing Video row.'),
  summaryTitle: z.string().min(1).max(200),
  summaryDescription: z.string().min(1).max(500),
  summaryOverview: z.string().min(1).describe('Markdown TL;DR — 1–2 paragraphs.'),
  watchVerdict: z
    .enum(['skip', 'skim', 'worth_it'])
    .describe(
      'Honest "should the user watch this?" judgement. worth_it = dense with specific/actionable info the summary cannot replace. skim = some useful parts plus filler. skip = generic advice the summary covers.',
    ),
  verdictSummary: z
    .string()
    .min(1)
    .max(280)
    .describe(
      'ONE sentence, format: "Worth it if you care about X. Skip if you already know Y." Be specific.',
    ),
  verdictReason: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      '2-4 sentences on what the video does well, what it assumes the viewer knows, and who should watch it.',
    ),
  keyTakeaways: z.array(TakeawaySchema).min(1).max(10),
  sections: z.array(SectionSchema).min(1).max(20),
  actionSteps: z.array(ActionStepSchema).min(1).max(10),
  aiModel: z
    .string()
    .max(100)
    .optional()
    .describe('Model that produced the summary (e.g. "claude-sonnet-4-6"). Stored verbatim.'),
});

type VideoForSummary = {
  documentId: string;
  youtubeVideoId: string;
  transcript?: TranscriptIndexSource | null;
};

export const saveSummaryTool: ToolDef<z.infer<typeof schema>> = {
  name: 'saveSummary',
  description:
    'Persist an AI-generated summary (title, description, overview, sections, key takeaways, action steps) to an existing Video. Do not send section timecodes: this tool finds each section in the transcript itself. Use this after generating a summary with a frontier model so it shows up in the app UI alongside locally-generated ones.',
  schema,
  execute: async (args, { strapi }) => {
    const video = await resolveByEitherId<VideoForSummary>(strapi, args.videoId, {
      // searchIndex is private and Strapi 5.61 rejects it inside a populate's
      // `fields`; it is read root-level below.
      populate: { transcript: { fields: ['documentId', 'durationSec'] } },
    });
    if (!video) {
      return { error: `No video found for "${args.videoId}". Call addVideo first.` };
    }

    // The linked transcript, else the stored one for this id.
    const transcript = video.transcript
      ? { ...video.transcript, ...((await loadTranscriptSearchIndex(strapi, video.transcript.documentId)) ?? {}) }
      : ((await strapi.documents('plugin::yt-kb.transcript').findFirst({
          filters: { youtubeVideoId: { $eq: video.youtubeVideoId } },
          fields: ['searchIndex', 'durationSec'],
        } as never)) as unknown as TranscriptIndexSource | null);
    const index = transcript ? await ensureTranscriptSearchIndex(strapi, transcript) : null;

    // Same query, function and threshold as the app (learning.ts).
    const SECTION_MIN_SCORE = 1.0;
    const sections = args.sections.map(({ heading, body }) => ({
      heading,
      body,
      timeSec: index
        ? (findEvidenceForQuote(`${heading}. ${body}`, index.bm25, SECTION_MIN_SCORE)?.timeSec ?? null)
        : null,
    }));

    const updated = await strapi.documents('plugin::yt-kb.video').update({
      documentId: video.documentId,
      data: {
        summaryStatus: 'generated',
        summaryTitle: args.summaryTitle,
        summaryDescription: args.summaryDescription,
        summaryOverview: args.summaryOverview,
        watchVerdict: args.watchVerdict,
        verdictSummary: args.verdictSummary,
        verdictReason: args.verdictReason,
        summaryGeneratedAt: new Date().toISOString(),
        aiModel: args.aiModel ?? null,
        keyTakeaways: args.keyTakeaways,
        sections,
        actionSteps: args.actionSteps,
      } as Record<string, unknown>,
    });

    return {
      videoDocumentId: (updated as { documentId: string }).documentId,
      youtubeVideoId: video.youtubeVideoId,
      summaryStatus: 'generated',
      sectionCount: sections.length,
      sectionsWithTimecode: sections.filter((s) => s.timeSec !== null).length,
      takeawayCount: args.keyTakeaways.length,
      actionStepCount: args.actionSteps.length,
    };
  },
};
