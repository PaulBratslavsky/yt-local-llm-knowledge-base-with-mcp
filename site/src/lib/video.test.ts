import { describe, expect, it } from 'vitest';
import {
  displayTitle,
  formatTimecode,
  FORBIDDEN_FIELDS,
  VIDEO_FIELDS,
  videoSchema,
  youtubeUrlAt,
} from './video';

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
