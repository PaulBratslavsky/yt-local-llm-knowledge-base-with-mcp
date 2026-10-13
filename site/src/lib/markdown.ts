import { Marked } from 'marked';

/** Escapes text for use in HTML content or a double-quoted attribute,
 *  leaving entities that are already escaped alone. */
function escapeHtml(value: string): string {
  return value
    .replace(/&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Schemes a link or image may use. Anything else — `javascript:`, `data:`,
 *  `vbscript:` — is dropped rather than rendered as a live href. */
const SAFE_URL = /^(https?:|mailto:|#|\/)/i;

/** Markdown renderer for model-authored prose.
 *
 *  `summaryOverview` and `readableArticle` are LLM output: content, not
 *  markup. Raw HTML in the source is escaped so it shows as text, and link
 *  and image URLs must use a safe scheme. These pages are static with no CSP
 *  to fall back on, so the renderer is the only gate.
 *
 *  Done with renderer overrides rather than by escaping the source first:
 *  escaping `<` and `>` up front also destroys blockquotes, which
 *  model-written articles do use, and it leaves `[x](javascript:...)`
 *  untouched because markdown link syntax is not HTML. */
const renderer = new Marked({
  renderer: {
    // Both block-level and inline raw HTML arrive here.
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_URL.test((href ?? '').trim())) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${titleAttr} rel="noopener">${text}</a>`;
    },
    image({ href, title, text }) {
      if (!SAFE_URL.test((href ?? '').trim())) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr} />`;
    },
  },
});

export function renderMarkdown(src: string): string {
  if (!src) return '';
  return renderer.parse(src, { async: false }) as string;
}
