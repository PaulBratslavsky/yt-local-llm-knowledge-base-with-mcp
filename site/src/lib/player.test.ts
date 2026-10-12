import { describe, expect, it } from 'vitest';
import { embedUrl, momentUrl, seekCommand } from './player';

describe('embedUrl', () => {
  it('enables the JS API so the page can drive the player', () => {
    const url = new URL(embedUrl('abc123'));
    expect(url.pathname).toBe('/embed/abc123');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
  });

  // Nothing about this site needs YouTube's cookies on first paint.
  it('uses the no-cookie host', () => {
    expect(new URL(embedUrl('abc123')).host).toBe('www.youtube-nocookie.com');
  });

  it('starts at a given second when asked', () => {
    expect(new URL(embedUrl('abc123', 95)).searchParams.get('start')).toBe('95');
  });

  it('floors a fractional start and ignores a nonsensical one', () => {
    expect(new URL(embedUrl('abc123', 95.7)).searchParams.get('start')).toBe('95');
    expect(new URL(embedUrl('abc123', -5)).searchParams.get('start')).toBeNull();
    expect(new URL(embedUrl('abc123', Number.NaN)).searchParams.get('start')).toBeNull();
  });

  it('escapes an id rather than letting it add parameters', () => {
    const url = new URL(embedUrl('abc&autoplay=1'));
    expect(url.searchParams.get('autoplay')).toBeNull();
  });
});

describe('seekCommand', () => {
  // The YouTube iframe accepts JSON postMessage commands when
  // enablejsapi=1. `allowSeekAhead` must be true or it snaps to the
  // nearest already-buffered keyframe instead of the moment asked for.
  it('builds a seekTo command that may seek past the buffer', () => {
    const command = seekCommand(95);
    expect(command).not.toBeNull();
    expect(JSON.parse(command as string)).toEqual({
      event: 'command',
      func: 'seekTo',
      args: [95, true],
    });
  });

  it('floors fractional seconds', () => {
    expect(JSON.parse(seekCommand(95.7) as string).args[0]).toBe(95);
  });

  it('refuses a seek it cannot express', () => {
    expect(seekCommand(Number.NaN)).toBeNull();
    expect(seekCommand(-1)).toBeNull();
  });
});

describe('momentUrl', () => {
  const page = 'https://notes.example/v/abc123';

  it('points at the moment being discussed', () => {
    expect(momentUrl(page, 95)).toBe(`${page}?t=95`);
  });

  // Copying twice from the same page must not stack up t= parameters.
  it('replaces a timecode already in the link', () => {
    expect(momentUrl(`${page}?t=10`, 95)).toBe(`${page}?t=95`);
  });

  it('keeps any other query the link carries', () => {
    expect(momentUrl(`${page}?ref=chat`, 95)).toBe(`${page}?ref=chat&t=95`);
  });

  it('floors a fractional second', () => {
    expect(momentUrl(page, 95.7)).toBe(`${page}?t=95`);
  });

  it('refuses a position it cannot express', () => {
    expect(momentUrl(page, Number.NaN)).toBeNull();
    expect(momentUrl(page, -1)).toBeNull();
  });
});
