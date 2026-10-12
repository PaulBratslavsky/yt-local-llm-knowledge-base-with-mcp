import type { Video } from './video';

type Section = Video['sections'][number];

/** Sections in the order they happen in the video.
 *
 *  A section whose `timeSec` the pipeline could not ground has no place on
 *  the timeline, so it sorts to the end rather than to the start — which is
 *  where a missing number would otherwise land it — keeping its original
 *  position relative to the other ungrounded ones. */
export function orderedSections(sections: readonly Section[]): Section[] {
  const grounded: Section[] = [];
  const ungrounded: Section[] = [];

  for (const section of sections) {
    if (typeof section.timeSec === 'number' && Number.isFinite(section.timeSec)) {
      grounded.push(section);
    } else {
      ungrounded.push(section);
    }
  }

  grounded.sort((a, b) => (a.timeSec as number) - (b.timeSec as number));
  return [...grounded, ...ungrounded];
}
