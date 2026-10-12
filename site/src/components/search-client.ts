import { createIndex, runSearch } from '../lib/search-engine';
import type { SearchDoc } from '../lib/search-docs';

const input = document.querySelector<HTMLInputElement>('[data-search-input]');
const results = document.querySelector<HTMLElement>('[data-search-results]');
const tagSelect = document.querySelector<HTMLSelectElement>('[data-search-tag]');

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

if (input && results) {
  /** Cached as a promise, not a value: typing fires an input event per
   *  keystroke, and caching only the resolved index would start a second
   *  fetch of the same file for every key pressed before the first lands. */
  let indexPromise: Promise<ReturnType<typeof createIndex>> | null = null;

  const fillTags = (docs: SearchDoc[]) => {
    if (!tagSelect || tagSelect.options.length > 1) return;
    tagSelect.disabled = false;
    const names = [...new Set(docs.flatMap((d) => d.tags ?? []))].sort();
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      tagSelect.append(option);
    }
  };

  const ensureIndex = () => {
    indexPromise ??= (async () => {
      const res = await fetch('/search-index.json');
      if (!res.ok) throw new Error(`Search index unavailable (${res.status})`);
      const docs = (await res.json()) as SearchDoc[];
      fillTags(docs);
      return createIndex(docs);
    })().catch((err) => {
      // Let the next keystroke retry rather than caching the failure.
      indexPromise = null;
      throw err;
    });
    return indexPromise;
  };

  const render = (hits: SearchDoc[], query: string) => {
    if (!query.trim()) {
      results.innerHTML = '';
      return;
    }
    if (hits.length === 0) {
      results.innerHTML =
        '<li class="py-3 text-sm text-slate-500">No matches. Try fewer or more distinctive words.</li>';
      return;
    }
    results.innerHTML = hits
      .slice(0, 20)
      .map(
        (hit) => `
          <li class="border-t border-slate-100 py-3">
            <a class="block hover:bg-slate-50" href="/v/${encodeURIComponent(hit.id)}">
              <span class="font-medium">${escapeHtml(hit.title)}</span>
              <span class="ml-2 text-xs text-slate-500">${escapeHtml(hit.author ?? '')}</span>
              <p class="mt-1 text-sm text-slate-700">${escapeHtml(hit.description ?? '')}</p>
            </a>
          </li>`,
      )
      .join('');
  };

  const search = async () => {
    const query = input.value;
    try {
      const index = await ensureIndex();
      render(runSearch(index, query, { tag: tagSelect?.value || undefined }), query);
    } catch (err) {
      results.innerHTML = `<li class="py-3 text-sm text-red-700">${escapeHtml(
        err instanceof Error ? err.message : 'Search failed',
      )}</li>`;
    }
  };

  input.addEventListener('input', search);
  tagSelect?.addEventListener('change', search);

  // Load the index immediately rather than on the first keystroke. The tag
  // facet is filled from it, and an enabled <select> holding only "All tags"
  // reads as "this library has no tags". Hooking `focus` is not enough:
  // autofocus fires while the HTML is parsing, before this deferred module
  // runs. The box only exists on the two search-first pages, so fetching
  // here is what those pages are for.
  void ensureIndex().catch(() => {
    // Leave the facet disabled; the first keystroke retries and reports.
  });

  // Cmd/Ctrl-K focuses search from anywhere on the page.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
