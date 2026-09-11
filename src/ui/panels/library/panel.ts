/**
 * Pattern library panel (P2-B-3). Virtualised cards on the P2-G-2 host —
 * this file only mounts content. Search, filters, near-pointer thumbnails,
 * stamp pickup, and a Credits dialog that lists every SOURCES.md collection.
 */
import { openDialog } from '@ui/components/dialog';
import type { PanelSpec } from '@ui/shell/panel-host';
import { scoreFuzzy } from '@ui/search/fuzzy';
import { PATTERN_COLLECTION_CREDITS } from './credits';
import {
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_CATEGORIES,
  attributionLine,
  filterLibrary,
  periodLabel,
  uniquePeriods,
  uniqueRulesets,
  uniqueTags,
  type LibraryEntry,
  type LibraryFilters,
  type LibrarySizeBucket,
} from './filter';
import { createThumbDirector, type ThumbTarget } from './thumbs';
import { attachVirtualList } from './virtual-list';

export const LIBRARY_PANEL_ID = 'library';
export const LIBRARY_PANEL_MIN_WIDTH = 320;
export const LIBRARY_CARD_HEIGHT = 80;
export const LIBRARY_DRAG_TYPE = 'application/x-fancy-gol-pattern';

export type LibraryCatalogSource = 'api' | 'bundled';

export interface LibraryPanelOptions {
  readonly entries?: readonly LibraryEntry[];
  readonly catalogSource?: LibraryCatalogSource;
  readonly activeRuleset?: string;
  readonly thumbUrl?: (id: string, animated: boolean) => string | null;
  readonly onPick?: (id: string) => void;
  readonly onIsolate?: (id: string) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
}

export interface LibraryPanel {
  readonly spec: PanelSpec;
  readonly root: HTMLElement;
  setEntries(entries: readonly LibraryEntry[], source?: LibraryCatalogSource): void;
  setActiveRuleset(id: string): void;
  getFilters(): LibraryFilters;
  getVisibleIds(): readonly string[];
  getSelectedId(): string | null;
  select(id: string | null): void;
  dispose(): void;
}

const ORIGIN_LABEL: Record<string, string> = {
  user: 'yours',
  curated: 'catalogue',
  bundled: 'starter',
};

function defaultThumbUrl(id: string, animated: boolean): string | null {
  if (id.startsWith('user:')) return null;
  return `/thumbs/${encodeURIComponent(id)}.${animated ? 'apng' : 'png'}`;
}

function fillSelect(select: HTMLSelectElement, values: readonly string[], labels?: readonly string[]): void {
  const current = select.value;
  select.replaceChildren();
  for (let i = 0; i < values.length; i++) {
    const opt = document.createElement('option');
    opt.value = values[i]!;
    opt.textContent = labels?.[i] ?? values[i]!;
    select.appendChild(opt);
  }
  if (values.includes(current)) select.value = current;
}

function markedName(name: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const hit = query.trim() ? scoreFuzzy(query, name) : null;
  if (!hit || hit.indices.length === 0) {
    frag.append(name);
    return frag;
  }
  const marks = new Set(hit.indices);
  let run = '';
  let marking = false;
  const flush = (): void => {
    if (!run) return;
    if (marking) {
      const mark = document.createElement('mark');
      mark.className = 'lib-mark';
      mark.textContent = run;
      frag.append(mark);
    } else {
      frag.append(run);
    }
    run = '';
  };
  for (let i = 0; i < name.length; i++) {
    const on = marks.has(i);
    if (on !== marking) {
      flush();
      marking = on;
    }
    run += name[i]!;
  }
  flush();
  return frag;
}

export function createLibraryPanel(opts: LibraryPanelOptions = {}): LibraryPanel {
  let entries: readonly LibraryEntry[] = opts.entries ?? [];
  let catalogSource: LibraryCatalogSource = opts.catalogSource ?? 'api';
  let filters: LibraryFilters = {
    ...EMPTY_LIBRARY_FILTERS,
    ruleset: opts.activeRuleset ?? '',
  };
  let selectedId: string | null = null;
  let ranked = filterLibrary(entries, filters);
  const thumbUrl = opts.thumbUrl ?? defaultThumbUrl;
  const thumbs = createThumbDirector();

  const root = document.createElement('div');
  root.className = 'lib-panel';

  const hint = document.createElement('p');
  hint.className = 'lib-offline';
  hint.hidden = true;

  const toolbar = document.createElement('div');
  toolbar.className = 'lib-toolbar';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'lib-search';
  search.setAttribute('aria-label', 'Search patterns');
  search.placeholder = 'Search name, discoverer, p30…';

  const creditsBtn = document.createElement('button');
  creditsBtn.type = 'button';
  creditsBtn.className = 'lib-credits-btn';
  creditsBtn.textContent = 'Credits';

  toolbar.append(search, creditsBtn);

  const filtersRow = document.createElement('div');
  filtersRow.className = 'lib-filters';
  filtersRow.setAttribute('role', 'group');
  filtersRow.setAttribute('aria-label', 'Library filters');

  const rulesetSel = document.createElement('select');
  rulesetSel.setAttribute('aria-label', 'Ruleset');
  const categorySel = document.createElement('select');
  categorySel.setAttribute('aria-label', 'Category');
  const tagSel = document.createElement('select');
  tagSel.setAttribute('aria-label', 'Tag');
  const sizeSel = document.createElement('select');
  sizeSel.setAttribute('aria-label', 'Size');
  const periodSel = document.createElement('select');
  periodSel.setAttribute('aria-label', 'Period');
  filtersRow.append(rulesetSel, categorySel, tagSel, sizeSel, periodSel);

  const count = document.createElement('p');
  count.className = 'lib-count';

  const list = attachVirtualList<LibraryEntry>({
    itemHeight: LIBRARY_CARD_HEIGHT,
    overscan: 3,
    render: (entry) => renderCard(entry),
    onVisibleChange: (visible) => {
      const targets: ThumbTarget[] = [];
      for (const entry of visible) {
        const img = root.querySelector<HTMLElement>(`img[data-pattern="${CSS.escape(entry.id)}"]`);
        if (!img) continue;
        targets.push({
          id: entry.id,
          el: img,
          posterUrl: thumbUrl(entry.id, false),
          animUrl: thumbUrl(entry.id, true),
        });
      }
      thumbs.setTargets(targets);
      thumbs.tick();
    },
  });
  list.viewport.setAttribute('role', 'listbox');
  list.viewport.setAttribute('aria-label', 'Pattern catalogue');

  const detail = document.createElement('section');
  detail.className = 'lib-detail';
  detail.hidden = true;
  const detailTitle = document.createElement('h3');
  detailTitle.className = 'lib-detail-title';
  const detailAttr = document.createElement('p');
  detailAttr.className = 'lib-detail-attr';
  const detailMeta = document.createElement('p');
  detailMeta.className = 'lib-detail-meta';
  const detailDesc = document.createElement('p');
  detailDesc.className = 'lib-detail-desc';
  const detailSource = document.createElement('a');
  detailSource.className = 'lib-detail-source';
  detailSource.target = '_blank';
  detailSource.rel = 'noreferrer';
  const detailActions = document.createElement('div');
  detailActions.className = 'lib-detail-actions';
  const stampBtn = document.createElement('button');
  stampBtn.type = 'button';
  stampBtn.textContent = 'Stamp';
  const isolateBtn = document.createElement('button');
  isolateBtn.type = 'button';
  isolateBtn.textContent = 'Run in isolation';
  detailActions.append(stampBtn, isolateBtn);
  detail.append(detailTitle, detailAttr, detailMeta, detailDesc, detailSource, detailActions);

  root.append(hint, toolbar, filtersRow, count, list.root, detail);

  function visibleEntries(): readonly LibraryEntry[] {
    return ranked.map((r) => r.item);
  }

  function renderCard(entry: LibraryEntry): HTMLElement {
    const card = document.createElement('div');
    card.className = 'lib-card';
    card.setAttribute('role', 'option');
    card.dataset['id'] = entry.id;
    card.tabIndex = -1;
    card.draggable = true;
    card.setAttribute('aria-selected', entry.id === selectedId ? 'true' : 'false');
    if (entry.id === selectedId) card.classList.add('lib-card--selected');

    const img = document.createElement('img');
    img.className = 'lib-thumb';
    img.alt = '';
    img.dataset['pattern'] = entry.id;
    const poster = thumbUrl(entry.id, false);
    if (poster) img.src = poster;
    else img.classList.add('lib-thumb--empty');

    const body = document.createElement('div');
    body.className = 'lib-card-body';
    const name = document.createElement('p');
    name.className = 'lib-card-name';
    name.append(markedName(entry.name, filters.query));
    const attr = document.createElement('p');
    attr.className = 'lib-card-attr';
    attr.textContent = attributionLine(entry);
    const chips = document.createElement('p');
    chips.className = 'lib-card-chips';
    const origin = document.createElement('span');
    origin.className = `lib-origin lib-origin--${entry.origin}`;
    origin.textContent = ORIGIN_LABEL[entry.origin] ?? entry.origin;
    chips.append(origin);
    if (entry.period != null) {
      const per = document.createElement('span');
      per.className = 'lib-chip';
      per.textContent = periodLabel(entry.period);
      chips.append(per);
    }
    body.append(name, attr, chips);
    card.append(img, body);

    card.addEventListener('click', () => {
      select(entry.id);
    });
    card.addEventListener('dblclick', () => {
      opts.onPick?.(entry.id);
    });
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(LIBRARY_DRAG_TYPE, entry.id);
      e.dataTransfer?.setData('text/plain', entry.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    return card;
  }

  function paintFilters(): void {
    const rulesets = uniqueRulesets(entries);
    fillSelect(rulesetSel, ['', ...rulesets], ['All rulesets', ...rulesets]);
    fillSelect(
      categorySel,
      ['', ...LIBRARY_CATEGORIES],
      ['Any category', ...LIBRARY_CATEGORIES],
    );
    const tags = uniqueTags(entries, filters.ruleset);
    fillSelect(tagSel, ['', ...tags], ['Any tag', ...tags]);
    fillSelect(sizeSel, ['any', 'tiny', 'small', 'medium', 'large'], ['Any size', 'Tiny', 'Small', 'Medium', 'Large']);
    const periods = uniquePeriods(entries, filters.ruleset);
    fillSelect(
      periodSel,
      ['', 'still', ...periods.map(String)],
      ['Any period', 'Still / none', ...periods.map((p) => periodLabel(p))],
    );
    rulesetSel.value = filters.ruleset;
    categorySel.value = filters.category;
    tagSel.value = filters.tag;
    sizeSel.value = filters.size;
    periodSel.value = filters.period;
  }

  function paintDetail(): void {
    const entry = entries.find((e) => e.id === selectedId);
    if (!entry) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    detailTitle.textContent = entry.name;
    detailAttr.textContent = attributionLine(entry) || 'Discoverer unknown';
    const bits = [
      `${entry.width}×${entry.height}`,
      entry.category,
      entry.period != null ? periodLabel(entry.period) : null,
      entry.origin === 'user' ? 'saved by you' : null,
    ].filter((b): b is string => Boolean(b));
    detailMeta.textContent = bits.join(' · ');
    detailDesc.textContent = entry.description ?? '';
    detailDesc.hidden = !entry.description;
    if (entry.source) {
      detailSource.hidden = false;
      detailSource.href = entry.source;
      detailSource.textContent = entry.source;
    } else {
      detailSource.hidden = true;
      detailSource.removeAttribute('href');
      detailSource.textContent = '';
    }
  }

  function paint(): void {
    ranked = filterLibrary(entries, filters);
    hint.hidden = catalogSource !== 'bundled';
    hint.textContent =
      catalogSource === 'bundled'
        ? 'Starter set — the server is unreachable. Saved patterns will return with it.'
        : '';
    const visible = visibleEntries();
    if (selectedId && !visible.some((e) => e.id === selectedId)) selectedId = visible[0]?.id ?? null;
    count.textContent = `${visible.length} pattern${visible.length === 1 ? '' : 's'}`;
    list.setItems(visible);
    paintDetail();
  }

  function select(id: string | null): void {
    selectedId = id;
    for (const card of list.viewport.querySelectorAll<HTMLElement>('.lib-card')) {
      const on = card.dataset['id'] === id;
      card.classList.toggle('lib-card--selected', on);
      card.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    paintDetail();
  }

  function applyFilters(next: Partial<LibraryFilters>): void {
    filters = { ...filters, ...next };
    paint();
  }

  function moveSelection(delta: number): void {
    const visible = visibleEntries();
    if (visible.length === 0) return;
    const idx = Math.max(0, visible.findIndex((e) => e.id === selectedId));
    const next = visible[(idx + delta + visible.length) % visible.length]!;
    select(next.id);
    list.scrollToIndex(visible.indexOf(next));
  }

  function openCredits(): void {
    const handle = openDialog({ title: 'Pattern credits' });
    handle.panel.classList.add('dialog-panel-wide');
    const intro = document.createElement('p');
    intro.className = 'lib-credits-intro';
    intro.textContent =
      'Facts (name, discoverer, year, layout) from these collections; every description was written here.';
    const listEl = document.createElement('ul');
    listEl.className = 'lib-credits-list';
    for (const row of PATTERN_COLLECTION_CREDITS) {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = row.source;
      const what = document.createElement('p');
      what.textContent = `${row.what} · Class ${row.class}`;
      const terms = document.createElement('p');
      terms.textContent = row.terms;
      li.append(title, what, terms);
      listEl.appendChild(li);
    }
    handle.panel.append(intro, listEl);
  }

  search.addEventListener('input', () => applyFilters({ query: search.value }));
  rulesetSel.addEventListener('change', () => applyFilters({ ruleset: rulesetSel.value, tag: '', period: '' }));
  categorySel.addEventListener('change', () => applyFilters({ category: categorySel.value }));
  tagSel.addEventListener('change', () => applyFilters({ tag: tagSel.value }));
  sizeSel.addEventListener('change', () => applyFilters({ size: sizeSel.value as LibrarySizeBucket }));
  periodSel.addEventListener('change', () => applyFilters({ period: periodSel.value }));
  creditsBtn.addEventListener('click', openCredits);
  stampBtn.addEventListener('click', () => {
    if (selectedId) opts.onPick?.(selectedId);
  });
  isolateBtn.addEventListener('click', () => {
    if (selectedId) opts.onIsolate?.(selectedId);
  });

  root.addEventListener('pointermove', (e) => {
    thumbs.setPointer(e.clientX, e.clientY);
    thumbs.tick();
  });
  root.addEventListener('pointerleave', () => {
    thumbs.setPointer(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    thumbs.tick();
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
      opts.onPick?.(selectedId);
    }
  });

  paintFilters();
  paint();

  const spec: PanelSpec = {
    id: LIBRARY_PANEL_ID,
    title: 'Library',
    minWidthPx: LIBRARY_PANEL_MIN_WIDTH,
    mount(body) {
      body.appendChild(root);
      paint();
      opts.onOpen?.();
    },
    unmount() {
      root.remove();
      opts.onClose?.();
    },
  };

  return {
    spec,
    root,
    setEntries(next, source) {
      entries = next;
      if (source) catalogSource = source;
      paintFilters();
      paint();
    },
    setActiveRuleset(id) {
      applyFilters({ ruleset: id, tag: '', period: '' });
      paintFilters();
    },
    getFilters: () => filters,
    getVisibleIds: () => visibleEntries().map((e) => e.id),
    getSelectedId: () => selectedId,
    select,
    dispose() {
      thumbs.dispose();
      list.dispose();
      root.remove();
    },
  };
}
