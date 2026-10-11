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
