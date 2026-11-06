/** Talking to the embedded YouTube player.
 *
 *  The site uses the iframe's own postMessage protocol rather than loading
 *  YouTube's IFrame API script: the whole interaction is "seek to this
 *  second", and the script is ~70 KB for a page that otherwise ships almost
 *  nothing. */

const EMBED_HOST = 'https://www.youtube-nocookie.com';

/** A whole, non-negative second, or null if the input cannot be one. */
function wholeSecond(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** The iframe src for a video, optionally starting at a given second. */
export function embedUrl(youtubeVideoId: string, startSec?: number | null): string {
  const url = new URL(`${EMBED_HOST}/embed/${encodeURIComponent(youtubeVideoId)}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  url.searchParams.set('playsinline', '1');

  const start = wholeSecond(startSec);
  if (start !== null) url.searchParams.set('start', String(start));

  return url.toString();
}

/** A `seekTo` command for `iframe.contentWindow.postMessage`, or null when
 *  the target time is not a real position.
 *
 *  `allowSeekAhead: true` matters — without it the player snaps to the
 *  nearest already-buffered keyframe rather than the moment the section
 *  actually starts. */
export function seekCommand(seconds: number): string | null {
  const target = wholeSecond(seconds);
  if (target === null) return null;
  return JSON.stringify({ event: 'command', func: 'seekTo', args: [target, true] });
}

/** A link to this page at a given moment, for pasting into a conversation.
 *
 *  Replaces any `t=` already present rather than appending a second one, so
 *  copying twice from the same page does not stack them up. */
export function momentUrl(href: string, seconds: number): string | null {
  const target = wholeSecond(seconds);
  if (target === null) return null;

  const url = new URL(href);
  url.searchParams.set('t', String(target));
  return url.toString();
}

/** The still YouTube serves for a video, or null when there is no id.
 *
 *  Derived rather than published. Strapi stores this exact URL on every
 *  row, but deriving it keeps `videoThumbnailUrl` out of the `fields[]`
 *  allowlist and out of the search index. The allowlist is the privacy
 *  mechanism, so it should name only what it must.
 *
 *  `hqdefault` is the 16:9 frame letterboxed into a 4:3 image, so a card
 *  that crops it back to 16:9 recovers the frame and loses the bars. */
export function thumbnailUrl(youtubeVideoId: string): string | null {
  if (!youtubeVideoId) return null;
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/hqdefault.jpg`;
}
