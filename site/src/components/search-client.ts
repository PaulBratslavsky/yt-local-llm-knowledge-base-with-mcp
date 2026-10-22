import {
  createIndex,
  filterDocs,
  runSearch,
  type SearchOptions,
} from '../lib/search-engine';
import type { SearchDoc } from '../lib/search-docs';
import { thumbnailUrl } from '../lib/player';

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

  const VERDICT: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    worth_it: { label: 'Worth watching', bg: 'var(--ok-bg)', text: 'var(--ok-text)', dot: 'var(--ok-dot)' },
    skim: { label: 'Skim it', bg: 'var(--warn-bg)', text: 'var(--warn-text)', dot: 'var(--warn-dot)' },
    skip: { label: 'Skip it', bg: 'var(--mute-bg)', text: 'var(--mute-text)', dot: 'var(--mute-dot)' },
  };

  /** Mirrors VideoCard.astro. The two are written twice because one is
   *  built by Astro and one by the island at runtime; if they drift, a
   *  search result stops looking like the thing it points at. */
  const card = (hit: SearchDoc) => {
    const score = hit.contentScore ?? 0;
    const tone =
      score >= 70
        ? 'background: var(--ok-bg); color: var(--ok-text)'
        : score >= 50
          ? 'background: var(--accent-soft); color: var(--accent-text)'
          : 'background: var(--chip-bg); color: var(--ink-soft)';
    const verdict = VERDICT[hit.verdict ?? ''];
    const thumb = thumbnailUrl(hit.id);

    return `
      <li>
        <article class="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] transition-shadow hover:shadow-[0_1px_2px_rgba(9,9,11,0.04),0_12px_32px_rgba(9,9,11,0.07)]">
          <a class="flex flex-col no-underline sm:flex-row" href="/v/${encodeURIComponent(hit.id)}">
            ${
              thumb
                ? `<div class="relative aspect-video w-full flex-none self-start overflow-hidden bg-black sm:w-[264px]">
                     <img alt="" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          height="360" loading="lazy" src="${escapeHtml(thumb)}" width="480" />
                     <span class="absolute right-2 top-2 inline-flex h-7 min-w-[34px] items-center justify-center rounded-lg px-2 text-[13px] font-semibold tabular-nums backdrop-blur-sm"
                           style="${tone}">${escapeHtml(String(score))}</span>
                   </div>`
                : ''
            }
            <div class="min-w-0 flex-1 px-5 py-4">
              <div class="flex flex-wrap items-center gap-2">
                ${
                  verdict
                    ? `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-wide"
                             style="background: ${verdict.bg}; color: ${verdict.text}">
                         <span class="h-[6px] w-[6px] rounded-full" style="background: ${verdict.dot}"></span>
                         ${verdict.label}
                       </span>`
                    : ''
                }
                <span class="truncate text-[13px] text-[var(--ink-muted)]">${escapeHtml(hit.author ?? '')}</span>
              </div>
              <h3 class="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.012em] text-[var(--ink)]">${escapeHtml(hit.title)}</h3>
              <p class="mt-1.5 line-clamp-3 text-[14.5px] leading-relaxed text-[var(--ink-soft)]">${escapeHtml(hit.description ?? '')}</p>
              <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-[var(--ink-faint)]">
                ${(hit.tags ?? [])
                  .slice(0, 3)
                  .map((name) => `<span class="rounded-full bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--ink-muted)]">${escapeHtml(name)}</span>`)
                  .join('')}
              </div>
            </div>
          </a>
        </article>
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
