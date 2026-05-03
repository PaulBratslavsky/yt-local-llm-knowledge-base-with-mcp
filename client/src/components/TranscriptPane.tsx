import { useMemo, useState } from 'react';
import { Button } from '#/components/ui/button';
import type {
  StrapiTranscriptSegment,
  StrapiVideo,
} from '#/lib/services/videos';

// Read-only transcript view rendered in the left pane of /learn when the
// Transcript tab is active. Each row is a clickable button that calls
// onSeek(seconds) — the parent handles the postMessage to the YouTube
// iframe, same path used by the Summary timecode chips and Notes.
//
// Raw segments from Strapi are usually 1–3 words each (one phrase per
// caption frame), which makes for a noisy wall of rows. We coalesce
// consecutive segments into roughly sentence-sized rows. The seek target
// for a coalesced row is the FIRST segment's startMs — that's the moment
// the speaker starts saying that sentence.
//
// Auto-highlighting the active row as the video plays is intentionally
// deferred: it requires a managed player (likely react-youtube) exposing
// a currentSeconds signal. Tracked separately from this component.

const MAX_ROW_DURATION_MS = 12_000;
const MAX_ROW_CHARS = 220;
const SENTENCE_END = /[.!?]["')\]]?$/;

type CoalescedRow = {
  startMs: number;
  text: string;
};

function coalesceSegments(
  segments: ReadonlyArray<StrapiTranscriptSegment>,
): CoalescedRow[] {
  const rows: CoalescedRow[] = [];
  let buffer: { startMs: number; parts: string[]; chars: number } | null = null;

  const flush = () => {
    if (!buffer) return;
    const text = buffer.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) rows.push({ startMs: buffer.startMs, text });
    buffer = null;
  };

  for (const seg of segments) {
    const piece = seg.text?.trim();
    if (!piece) continue;
    if (!buffer) {
      buffer = { startMs: seg.startMs, parts: [piece], chars: piece.length };
    } else {
      buffer.parts.push(piece);
      buffer.chars += piece.length + 1;
    }
    const elapsed = seg.startMs - buffer.startMs;
    const endsSentence = SENTENCE_END.test(piece);
    if (
      endsSentence ||
      buffer.chars >= MAX_ROW_CHARS ||
      elapsed >= MAX_ROW_DURATION_MS
    ) {
      flush();
    }
  }
  flush();
  return rows;
}

function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TranscriptPane({
  video,
  onSeek,
}: Readonly<{
  video: StrapiVideo;
  onSeek: (seconds: number) => void;
}>) {
  const segments = video.transcript?.rawSegments ?? null;
  const rows = useMemo(
    () => (segments && segments.length > 0 ? coalesceSegments(segments) : []),
    [segments],
  );
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = rows
      .map((row) => `[${formatTimecode(row.startMs)}] ${row.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 text-center sm:p-10">
        <h2 className="display-title text-2xl text-[var(--ink)] sm:text-3xl">
          No transcript available
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
          We don&apos;t have a captions transcript stored for this video yet.
          Transcripts are fetched alongside the summary — try regenerating the
          summary if this video should have one.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="display-title text-xl text-[var(--ink)]">Transcript</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Click a line to jump the video to that moment.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied!' : 'Copy transcript'}
        </Button>
      </header>
      <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--card)]">
        {rows.map((row, idx) => {
          const seconds = Math.floor(row.startMs / 1000);
          return (
            <li key={`${row.startMs}-${idx}`}>
              <button
                type="button"
                onClick={() => onSeek(seconds)}
                className="grid w-full grid-cols-[4.5rem_1fr] items-start gap-4 px-4 py-3 text-left transition hover:bg-[var(--bg-subtle)] focus:bg-[var(--bg-subtle)] focus:outline-none"
              >
                <span className="font-mono text-xs tabular-nums text-[var(--accent)]">
                  {formatTimecode(row.startMs)}
                </span>
                <span className="text-sm leading-relaxed text-[var(--ink)]">
                  {row.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
