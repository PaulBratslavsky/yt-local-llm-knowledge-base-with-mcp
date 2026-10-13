import { describe, expect, it } from 'vitest';
import { orderedSections } from './sections';

const s = (heading: string, timeSec?: number | null) => ({ heading, body: null, timeSec });

describe('orderedSections', () => {
  it('puts sections in the order they happen in the video', () => {
    const ordered = orderedSections([s('third', 300), s('first', 10), s('second', 120)]);
    expect(ordered.map((x) => x.heading)).toEqual(['first', 'second', 'third']);
  });

  // A section the pipeline could not ground has no place on the timeline.
  // Dropping it would lose content; guessing a position would be a lie.
  it('keeps ungrounded sections, after the grounded ones', () => {
    const ordered = orderedSections([s('nowhere'), s('late', 300), s('early', 10)]);
    expect(ordered.map((x) => x.heading)).toEqual(['early', 'late', 'nowhere']);
  });

  it('keeps ungrounded sections in their original order', () => {
    const ordered = orderedSections([s('a'), s('b'), s('c', 5)]);
    expect(ordered.map((x) => x.heading)).toEqual(['c', 'a', 'b']);
  });

  it('treats a zero timecode as a real position, not a missing one', () => {
    const ordered = orderedSections([s('later', 90), s('opening', 0)]);
    expect(ordered.map((x) => x.heading)).toEqual(['opening', 'later']);
  });

  it('handles an empty list', () => {
    expect(orderedSections([])).toEqual([]);
  });
});
