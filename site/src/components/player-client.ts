import { embedUrl, seekCommand } from '../lib/player';

/** Click-to-seek.
 *
 *  Every timecode on the page — the chips in the walkthrough and the rows in
 *  the chapter rail — carries `data-seek` (whole seconds) and
 *  `data-seek-label` (the section heading). One delegated listener drives
 *  the iframe, so adding a timecode anywhere needs no extra wiring. */
const player = document.querySelector<HTMLIFrameElement>('[data-player]');

if (player) {
  const nowTime = document.querySelector<HTMLElement>('[data-now-time]');
  const nowHeading = document.querySelector<HTMLElement>('[data-now-heading]');
  const nowPanel = document.querySelector<HTMLElement>('[data-now-panel]');
  const copyButton = document.querySelector<HTMLButtonElement>('[data-copy-moment]');

  let currentSec: number | null = null;

  const post = (command: string) => {
    // The embed's own postMessage protocol. '*' because the player is served
    // from youtube-nocookie.com and the exact origin varies by embed.
    player.contentWindow?.postMessage(command, '*');
  };

  /** The embed ignores commands until the page has announced itself. Posting
   *  seekTo straight away does nothing at all — the click appears to work,
   *  the page updates, and the video never moves. Idempotent, so it is sent
   *  on load and again before every command rather than tracked. */
  const announce = () =>
    post(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }));

  announce();
  player.addEventListener('load', announce);

  const markCurrent = (seconds: number) => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-seek]')) {
      const isCurrent = Number(el.dataset.seek) === seconds;
      el.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      // The section card is styled as current too, not just its chip.
      el.closest('[data-section-card]')?.setAttribute(
        'aria-current',
        isCurrent ? 'true' : 'false',
      );
    }
  };

  const formatTimecode = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-seek]');
    if (!target) return;

    const seconds = Number(target.dataset.seek);
    const command = seekCommand(seconds);
    if (command === null) return;

    event.preventDefault();
    announce();
    post(command);
    post(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }));

    currentSec = Math.floor(seconds);
    markCurrent(currentSec);

    nowPanel?.removeAttribute('data-idle');
    if (nowTime) nowTime.textContent = formatTimecode(currentSec);
    if (nowHeading) nowHeading.textContent = target.dataset.seekLabel ?? '';
    if (copyButton) {
      copyButton.hidden = false;
      copyButton.textContent = `Copy link at ${formatTimecode(currentSec)}`;
    }
  });

  // Shares the moment, not the page: the URL carries ?t= so whoever opens it
  // lands where the conversation was.
  copyButton?.addEventListener('click', async () => {
    if (currentSec === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set('t', String(currentSec));

    const label = copyButton.textContent;
    try {
      await navigator.clipboard.writeText(url.toString());
      copyButton.textContent = 'Link copied';
    } catch {
      copyButton.textContent = 'Press ⌘C to copy';
      window.prompt('Copy this link', url.toString());
    }
    window.setTimeout(() => {
      copyButton.textContent = label;
    }, 1600);
  });

  // A link shared with ?t= opens at that moment and highlights its section.
  // The src is rewritten rather than seeked: a command posted before the
  // player has loaded is simply dropped, and this page is static so the
  // build cannot know the query string.
  const requested = Number(new URL(window.location.href).searchParams.get('t'));
  const videoId = player.dataset.videoId;
  if (Number.isFinite(requested) && requested > 0 && videoId) {
    player.src = embedUrl(videoId, requested);
    currentSec = Math.floor(requested);
    markCurrent(currentSec);
    nowPanel?.removeAttribute('data-idle');
    if (nowTime) nowTime.textContent = formatTimecode(currentSec);
    const match = document.querySelector<HTMLElement>(`[data-seek="${currentSec}"]`);
    if (nowHeading) nowHeading.textContent = match?.dataset.seekLabel ?? '';
    if (copyButton) {
      copyButton.hidden = false;
      copyButton.textContent = `Copy link at ${formatTimecode(currentSec)}`;
    }
  }
}
