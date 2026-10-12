import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    expect(renderMarkdown('# Title\n\nSome **bold** text.')).toContain('<h1');
    expect(renderMarkdown('# Title\n\nSome **bold** text.')).toContain('<strong>');
  });

  // The article and overview are model output. Treat them as untrusted
  // markup: a model that emits a <script> tag must not get one executed.
  it('does not emit script tags from raw HTML in the source', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not emit inline event handlers', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror="');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  // Escaping the source before parsing would also kill real markdown, and
  // model-written articles do quote things.
  it('still renders a blockquote', () => {
    expect(renderMarkdown('> a quoted line')).toContain('<blockquote>');
  });

  it('does not double-escape ampersands', () => {
    const html = renderMarkdown('Q&A with AT&T');
    expect(html).toContain('Q&amp;A');
    expect(html).not.toContain('&amp;amp;');
  });

  // Markdown link syntax is not HTML, so escaping the source does not touch
  // it: a javascript: href survives as a live, clickable link.
  it('strips a javascript: link, keeping its text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('keeps an ordinary https link', () => {
    expect(renderMarkdown('[ok](https://example.com)')).toContain(
      '<a href="https://example.com"',
    );
  });

  it('keeps a markdown list a list', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });
});

