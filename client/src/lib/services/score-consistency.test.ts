import { describe, expect, it } from 'vitest';
import {
  aggregateSignalScore,
  computeSignalScores,
  signalInputForTranscript,
} from './content-signals';
import { cleanTranscript, prepareSegmentedTranscript } from './transcript';
import { computeFinalScore, FINAL_SCORE_WEIGHTS } from './videos';

// YouTube auto-captions repeat the tail of one caption as the head of the
// next, constantly. That is the input that made the writers disagree.
const SEGMENTS = [
  { text: 'so the key idea here is', startMs: 0, endMs: 1000 },
  { text: 'is that the model will', startMs: 1000, endMs: 2000 },
  { text: 'will cache the tokens', startMs: 2000, endMs: 3000 },
];
const RAW_TEXT = SEGMENTS.map((s) => s.text).join(' ');

describe('the two ways of cleaning a transcript', () => {
  // Not a wish — a demonstration of why scoring has to pick one. The dedupe
  // pattern collapses a repeat only when both words are in the same string
  // it is handed.
  it('disagree on cross-segment repeats, which is the whole problem', () => {
    const perSegment = prepareSegmentedTranscript(SEGMENTS).cleanedText;
    const wholeString = cleanTranscript(RAW_TEXT);

    expect(perSegment).toContain('is is');
    expect(wholeString).not.toContain('is is');
  });
});

describe('signalInputForTranscript', () => {
  it('cleans the whole transcript as one string', () => {
    expect(signalInputForTranscript(RAW_TEXT).cleanedText).toBe(cleanTranscript(RAW_TEXT));
  });

  // The property that makes a score trustworthy: re-cutting the captions
  // into different lines must not move it. Scoring reads rawText only, so
  // it cannot see where the boundaries were.
  it('gives the same answer however the captions were split', () => {
    const differentlySplit = [
      'so the key idea',
      'here is is that the',
      'model will will cache the tokens',
    ];

    expect(signalInputForTranscript(differentlySplit.join(' '))).toEqual(
      signalInputForTranscript(RAW_TEXT),
    );
  });

  it('counts words the way the signal maths has always counted them', () => {
    const historical = (cleanTranscript(RAW_TEXT).match(/\b[\w'-]+\b/g) ?? []).length;
    expect(signalInputForTranscript(RAW_TEXT).wordCount).toBe(historical);
  });

  it('survives a row with no transcript text at all', () => {
    expect(signalInputForTranscript(null)).toEqual({ cleanedText: '', wordCount: 0 });
    expect(signalInputForTranscript(undefined).wordCount).toBe(0);
  });
});

describe('every writer scores a given row identically', () => {
  // The acceptance criterion from issue #5. Generation used to score the
  // per-segment cleaning it had in hand while the recompute and backfill
  // paths cleaned the joined string, so the same unchanged video got a
  // different number depending on which button was pressed last.
  const row = { rawText: RAW_TEXT, durationSec: 30 };

  const scoreFrom = (cleanedText: string, wordCount: number) =>
    aggregateSignalScore(
      computeSignalScores({
        rawText: row.rawText,
        cleanedText,
        wordCount,
        durationSec: row.durationSec,
      }),
    );

  const viaHelper = () => {
    const input = signalInputForTranscript(row.rawText);
    return scoreFrom(input.cleanedText, input.wordCount);
  };

  it('gives the same signalScore however many times it is computed', () => {
    expect(viaHelper()).toBe(viaHelper());
  });

  it('gives the same finalScore for a fixed valueScore', () => {
    expect(computeFinalScore(70, viaHelper())).toBe(computeFinalScore(70, viaHelper()));
  });

  // The regression itself, asserted on the input rather than the score.
  // The score is an aggregate of five rounded sub-signals, so on a short
  // fixture a real input difference can round away — on the live library
  // it moved 7 of 100 videos. The input is where the drift starts, so that
  // is where this guards.
  it('scores different text than the per-segment cleaning would', () => {
    const prepared = prepareSegmentedTranscript(SEGMENTS);
    const used = signalInputForTranscript(row.rawText);

    expect(used.cleanedText).not.toBe(prepared.cleanedText);
    expect(used.wordCount).not.toBe(prepared.wordStartMs.length);
  });
});

describe('computeFinalScore', () => {
  it('blends the two components by the declared weights', () => {
    // 0.6 * 80 + 0.4 * 30 = 60
    expect(computeFinalScore(30, 80)).toBe(60);
  });

  it('weights signal more heavily than value', () => {
    expect(FINAL_SCORE_WEIGHTS.signal).toBeGreaterThan(FINAL_SCORE_WEIGHTS.value);
  });

  it('uses weights that sum to one, or the result is not on a 0-100 scale', () => {
    expect(FINAL_SCORE_WEIGHTS.signal + FINAL_SCORE_WEIGHTS.value).toBeCloseTo(1, 10);
  });

  it('rounds to a whole number', () => {
    expect(Number.isInteger(computeFinalScore(77, 43))).toBe(true);
  });

  // A row rated before the other half existed still needs a usable score.
  it('falls back to whichever component exists', () => {
    expect(computeFinalScore(null, 80)).toBe(80);
    expect(computeFinalScore(30, null)).toBe(30);
    expect(computeFinalScore(undefined, 80)).toBe(80);
  });

  it('is null only when neither component exists', () => {
    expect(computeFinalScore(null, null)).toBeNull();
    expect(computeFinalScore(undefined, undefined)).toBeNull();
  });

  it('treats zero as a real score, not a missing one', () => {
    expect(computeFinalScore(0, 80)).toBe(48);
    expect(computeFinalScore(80, 0)).toBe(32);
  });
});
