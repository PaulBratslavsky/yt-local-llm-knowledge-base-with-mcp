import {
  createIndex,
  filterDocs,
  runSearch,
  type SearchOptions,
} from '../lib/search-engine';
import type { SearchDoc } from '../lib/search-docs';

const input = document.querySelector<HTMLInputElement>('[data-search-input]');
const results = document.querySelector<HTMLElement>('[data-search-results]');
const tagSelect = document.querySelector<HTMLSelectElement>('[data-search-tag]');
const facets = [...document.querySelectorAll<HTMLButtonElement>('[data-facet]')];
/** The browse lists the home page renders at build time. They are the answer
 *  to "show me around"; a query replaces them rather than pushing them down. */
const browse = document.querySelector<HTMLElement>('[data-browse]');

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

if (input && results) {
  let activeFacet = 'all';

  /** Cached as a promise, not a value: typing fires an input event per
   *  keystroke, and caching only the resolved index would start a second
   *  fetch of the same file for every key pressed before the first lands. */
  let indexPromise: Promise<ReturnType<typeof createIndex>> | null = null;
  /** Kept alongside the index for the browse path, which filters documents
   *  directly because MiniSearch has no match-all query. */
  let allDocs: SearchDoc[] = [];

  const fillTags = (docs: SearchDoc[]) => {
    if (!tagSelect || tagSelect.options.length > 1) return;
    tagSelect.disabled = false;
    for (const name of [...new Set(docs.flatMap((d) => d.tags ?? []))].sort()) {
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
      allDocs = docs;
      fillTags(docs);
      return createIndex(docs);
    })().catch((err) => {
      // Let the next keystroke retry rather than caching the failure.
      indexPromise = null;
      throw err;
    });
    return indexPromise;
  };

  const facetOptions = (): SearchOptions => ({
    tag: tagSelect?.value || undefined,
    verdict: activeFacet === 'worth' ? 'worth_it' : undefined,
    minScore: activeFacet === 'high' ? 85 : undefined,
  });

  const card = (hit: SearchDoc) => {
    const high = (hit.contentScore ?? 0) >= 85;
    const scoreStyle = high
      ? 'background: var(--ok-bg); color: var(--ok-text)'
      : 'background: var(--chip-bg); color: var(--ink-soft)';
    return `
      <li>
        <a class="block rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 py-5 no-underline hover:border-[var(--line-strong)]"
           href="/v/${encodeURIComponent(hit.id)}">
          <div class="flex items-start gap-4">
            <div class="min-w-0 flex-1">
              <h3 class="text-[18px] font-semibold leading-snug tracking-[-0.012em] text-[var(--ink)]">${escapeHtml(hit.title)}</h3>
              <p class="mt-1 text-[13.5px] text-[var(--ink-muted)]">${escapeHtml(hit.author ?? '')}</p>
              <p class="mt-2 text-[15px] leading-relaxed text-[var(--ink-soft)]">${escapeHtml(hit.description ?? '')}</p>
            </div>
            <span class="inline-flex h-8 min-w-[46px] flex-none items-center justify-center rounded-[9px] px-2.5 text-[15px] font-semibold tabular-nums"
                  style="${scoreStyle}">${escapeHtml(String(hit.contentScore ?? 0))}</span>
          </div>
        </a>
      </li>`;
  };

  const render = (hits: SearchDoc[], query: string) => {
    const searching = query.trim().length > 0 || activeFacet !== 'all' || !!tagSelect?.value;
    if (browse) browse.hidden = searching;

    if (!searching) {
      results.innerHTML = '';
      return;
    }
    if (hits.length === 0) {
      // Blaming the words is wrong when a facet left on from a previous
      // search is what actually emptied the list.
      const narrowed = activeFacet !== 'all' || !!tagSelect?.value;
      const reason = narrowed
        ? 'No video matches both your words and the filters above. Try clearing a filter.'
        : 'Nothing matches that. Try fewer or more distinctive words.';
      results.innerHTML = `
        <li class="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--card)] px-6 py-7 text-center text-[15px] text-[var(--ink-muted)]">
          ${reason}
        </li>`;
      return;
    }
    results.innerHTML = hits.slice(0, 20).map(card).join('');
  };

  const search = async () => {
    const query = input.value;
    try {
      const index = await ensureIndex();
      // A facet with no query narrows the whole library rather than
      // searching for nothing and showing an empty page.
      const hits = query.trim()
        ? runSearch(index, query, facetOptions())
        : filterDocs(allDocs, facetOptions());
      render(hits, query);
    } catch (err) {
      results.innerHTML = `
        <li class="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 py-5 text-[15px] text-[var(--ink)]">
          ${escapeHtml(err instanceof Error ? err.message : 'Search failed')}
        </li>`;
    }
  };

  for (const chip of facets) {
    chip.addEventListener('click', () => {
      activeFacet = chip.dataset.facet ?? 'all';
      for (const other of facets) {
        other.setAttribute('aria-pressed', other === chip ? 'true' : 'false');
      }
      void search();
    });
  }

  input.addEventListener('input', search);
  tagSelect?.addEventListener('change', search);

  // Load the index immediately rather than on the first keystroke: the tag
  // facet is filled from it, and an enabled <select> holding only "All
  // topics" reads as "this library has no topics". Hooking `focus` is not
  // enough — autofocus fires while the HTML parses, before this module runs.
  void ensureIndex().catch(() => {
    // Leave the facet disabled; the first keystroke retries and reports.
  });
}
