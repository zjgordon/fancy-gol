/**
 * The studio form (P2-E-2): B/S chips, a notation field, a neighbourhood
 * diagram, a state list, a small transition grid, and Randomise. It never
 * talks to the engine — it emits a {@link StudioDocument} and the panel
 * writes that into the JSON editor.
 */
import {
  applyBornSurvive,
  applyNeighborhood,
  applyNotation,
  applyStates,
  DEFAULT_RANDOMISE,
  formatNotation,
  guessTemperament,
  mulberry32,
  neighborMax,
  randomiseDocument,
  temperamentLine,
  toggleCount,
  type RandomiseOptions,
  type StudioDocument,
  type StudioState,
} from './model';
import { neighborCount, offsetsFor, type StudioNeighborhood } from './offsets';

export interface StudioForm {
  readonly root: HTMLElement;
  setDocument(doc: StudioDocument): void;
  getDocument(): StudioDocument;
  getNotation(): string;
  setNotation(value: string): boolean;
  toggle(field: 'born' | 'survive', n: number): void;
  randomise(seed?: number): StudioDocument;
  getConstraints(): RandomiseOptions;
  setConstraints(opts: Partial<RandomiseOptions>): void;
  dispose(): void;
}

export interface StudioFormOptions {
  readonly document: StudioDocument;
  readonly onChange: (doc: StudioDocument) => void;
  readonly rng?: () => number;
}

const KIND_OPTIONS = ['dead', 'live', 'decay', 'inert'] as const;

const NEIGHBORHOOD_OPTIONS: ReadonlyArray<{ id: string; label: string; value: StudioNeighborhood }> = [
  { id: 'moore-1', label: 'Moore r=1 (8)', value: { kind: 'moore', radius: 1 } },
  { id: 'moore-2', label: 'Moore r=2 (24)', value: { kind: 'moore', radius: 2 } },
  { id: 'vn-1', label: 'von Neumann r=1 (4)', value: { kind: 'vonNeumann', radius: 1 } },
  { id: 'hex', label: 'Hex (6)', value: { kind: 'hex' } },
];

function neighborhoodId(n: StudioNeighborhood): string {
  if (n.kind === 'moore' && (n.radius ?? 1) === 1) return 'moore-1';
  if (n.kind === 'moore' && n.radius === 2) return 'moore-2';
  if (n.kind === 'vonNeumann') return 'vn-1';
  if (n.kind === 'hex') return 'hex';
  return 'moore-1';
}

function defaultHex(id: number): string {
  const hue = (id * 67) % 360;
  const s = 0.65;
  const l = id === 0 ? 0.22 : 0.58;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (ch: number): string =>
    Math.round((ch + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function createStudioForm(opts: StudioFormOptions): StudioForm {
  let doc = opts.document;
  const colors = new Map<number, string>();
  const constraints: { birthDensity: number; surviveDensity: number; symmetry: number } = {
    ...DEFAULT_RANDOMISE,
  };

  const root = document.createElement('div');
  root.className = 'studio-form';

  const notationRow = document.createElement('div');
  notationRow.className = 'studio-notation-row';
  const notationLabel = document.createElement('label');
  notationLabel.textContent = 'Notation';
  const notation = document.createElement('input');
  notation.type = 'text';
  notation.className = 'studio-notation';
  notation.setAttribute('aria-label', 'Rule notation');
  notation.spellcheck = false;
  notationLabel.appendChild(notation);
  notationRow.appendChild(notationLabel);

  const temper = document.createElement('p');
  temper.className = 'studio-temper';
  temper.setAttribute('aria-live', 'polite');

  const bornRow = document.createElement('div');
  bornRow.className = 'studio-chips';
  bornRow.setAttribute('role', 'group');
  bornRow.setAttribute('aria-label', 'Birth counts');
  const surviveRow = document.createElement('div');
  surviveRow.className = 'studio-chips';
  surviveRow.setAttribute('role', 'group');
  surviveRow.setAttribute('aria-label', 'Survival counts');

  const tableWrap = document.createElement('div');
  tableWrap.className = 'studio-table-wrap';
  const table = document.createElement('table');
  table.className = 'studio-table';
  table.setAttribute('aria-label', 'Transition table');
  tableWrap.appendChild(table);

  const hoodRow = document.createElement('div');
  hoodRow.className = 'studio-hood';
  const hoodLabel = document.createElement('label');
  hoodLabel.textContent = 'Neighbourhood';
  const hoodSelect = document.createElement('select');
  hoodSelect.setAttribute('aria-label', 'Neighbourhood');
  for (const option of NEIGHBORHOOD_OPTIONS) {
    const el = document.createElement('option');
    el.value = option.id;
    el.textContent = option.label;
    hoodSelect.appendChild(el);
  }
  hoodLabel.appendChild(hoodSelect);
  const diagrams = document.createElement('div');
  diagrams.className = 'studio-diagrams';
  hoodRow.append(hoodLabel, diagrams);

  const states = document.createElement('div');
  states.className = 'studio-states';
  states.setAttribute('aria-label', 'States');

  const randomRow = document.createElement('div');
  randomRow.className = 'studio-random';
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'studio-random-btn';
  randomBtn.textContent = 'Randomise';
  const sliders = document.createElement('div');
  sliders.className = 'studio-sliders';
  sliders.append(
    slider('Birth density', 'birth', constraints.birthDensity, (v) => {
      constraints.birthDensity = v;
    }),
    slider('Survival density', 'survive', constraints.surviveDensity, (v) => {
      constraints.surviveDensity = v;
    }),
    slider('Symmetry', 'symmetry', constraints.symmetry, (v) => {
      constraints.symmetry = v;
    }),
  );
  randomRow.append(randomBtn, sliders);

  root.append(notationRow, temper, bornRow, surviveRow, tableWrap, hoodRow, states, randomRow);

  function emit(next: StudioDocument): void {
    doc = next;
    paint();
    opts.onChange(doc);
  }

  function paintChips(row: HTMLElement, field: 'born' | 'survive'): void {
    const max = neighborMax(doc);
    const selected = new Set(field === 'born' ? doc.transition.born : doc.transition.survive);
    while (row.childElementCount > max + 1) row.lastElementChild?.remove();
    for (let n = 0; n <= max; n++) {
      let btn = row.children[n] as HTMLButtonElement | undefined;
      if (!btn) {
        const created = document.createElement('button');
        created.type = 'button';
        created.className = 'studio-chip';
        created.addEventListener('click', () => {
          const count = Number(created.dataset['n']);
          const current = field === 'born' ? doc.transition.born : doc.transition.survive;
          emit(applyBornSurvive(doc, field, toggleCount(current, count)));
        });
        row.appendChild(created);
        btn = created;
      }
      btn.dataset['n'] = String(n);
      btn.textContent = String(n);
      btn.setAttribute('aria-label', `${field === 'born' ? 'Birth' : 'Survive'} on ${String(n)}`);
      btn.setAttribute('aria-pressed', selected.has(n) ? 'true' : 'false');
    }
  }

  function paintTable(): void {
    const max = neighborMax(doc);
    const born = new Set(doc.transition.born);
    const survive = new Set(doc.transition.survive);
    table.replaceChildren();
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.appendChild(th('n'));
    for (let n = 0; n <= max; n++) hr.appendChild(th(String(n)));
    head.appendChild(hr);
    const body = document.createElement('tbody');
    body.appendChild(tableRow('Birth', 'born', born, max));
    body.appendChild(tableRow('Survive', 'survive', survive, max));
    table.append(head, body);
  }

  function tableRow(label: string, field: 'born' | 'survive', selected: Set<number>, max: number): HTMLTableRowElement {
    const tr = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = label;
    tr.appendChild(name);
    for (let n = 0; n <= max; n++) {
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'studio-cell';
      btn.setAttribute('aria-pressed', selected.has(n) ? 'true' : 'false');
      btn.setAttribute('aria-label', `${label} on ${String(n)}`);
      btn.textContent = selected.has(n) ? (field === 'born' ? 'B' : 'S') : '·';
      btn.addEventListener('click', () => {
        const current = field === 'born' ? doc.transition.born : doc.transition.survive;
        emit(applyBornSurvive(doc, field, toggleCount(current, n)));
      });
      td.appendChild(btn);
      tr.appendChild(td);
    }
    return tr;
  }

  function paintDiagrams(): void {
    diagrams.replaceChildren();
    const parities: Array<0 | 1> = doc.neighborhood.kind === 'hex' ? [0, 1] : [0];
    for (const parity of parities) {
      const figure = document.createElement('figure');
      figure.className = 'studio-diagram';
      const caption = document.createElement('figcaption');
      caption.textContent =
        doc.neighborhood.kind === 'hex' ? (parity === 0 ? 'Even row' : 'Odd row') : `${neighborCount(doc.neighborhood)} neighbours`;
      const grid = document.createElement('div');
      grid.className = 'studio-diagram-grid';
      const offs = offsetsFor(doc.neighborhood, parity);
      const keys = new Set(offs.map(([dx, dy]) => `${String(dx)},${String(dy)}`));
      let minX = 0;
      let maxX = 0;
      let minY = 0;
      let maxY = 0;
      for (const [dx, dy] of offs) {
        minX = Math.min(minX, dx);
        maxX = Math.max(maxX, dx);
        minY = Math.min(minY, dy);
        maxY = Math.max(maxY, dy);
      }
      grid.style.gridTemplateColumns = `repeat(${String(maxX - minX + 1)}, minmax(0, 1fr))`;
      for (let dy = minY; dy <= maxY; dy++) {
        for (let dx = minX; dx <= maxX; dx++) {
          const cell = document.createElement('span');
          cell.className = 'studio-diagram-cell';
          cell.dataset['dx'] = String(dx);
          cell.dataset['dy'] = String(dy);
          if (dx === 0 && dy === 0) {
            cell.classList.add('studio-diagram-center');
            cell.textContent = '·';
          } else if (keys.has(`${String(dx)},${String(dy)}`)) {
            cell.classList.add('studio-diagram-nb');
          }
          grid.appendChild(cell);
        }
      }
      figure.append(grid, caption);
      figure.dataset['offsets'] = offs.map(([dx, dy]) => `${String(dx)},${String(dy)}`).join(' ');
      diagrams.appendChild(figure);
    }
  }

  function paintStates(): void {
    states.replaceChildren();
    const heading = document.createElement('p');
    heading.className = 'studio-states-title';
    heading.textContent = 'States';
    states.appendChild(heading);
    for (const state of doc.states) {
      states.appendChild(stateRow(state));
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'studio-state-add';
    add.textContent = 'Add state';
    add.addEventListener('click', () => {
      const next: StudioState[] = [
        ...doc.states,
        {
          id: doc.states.length,
          name: `state-${String(doc.states.length)}`,
          kind: 'decay',
          countsAsAlive: false,
        },
      ];
      emit(applyStates(doc, next));
    });
    states.appendChild(add);
  }

  function stateRow(state: StudioState): HTMLElement {
    const row = document.createElement('div');
    row.className = 'studio-state';
    row.dataset['id'] = String(state.id);

    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'studio-state-color';
    color.setAttribute('aria-label', `Colour for ${state.name}`);
    color.value = colors.get(state.id) ?? defaultHex(state.id);
    color.addEventListener('input', () => {
      colors.set(state.id, color.value);
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'studio-state-name';
    name.setAttribute('aria-label', `Name of state ${String(state.id)}`);
    name.value = state.name;
    name.addEventListener('change', () => {
      emit(applyStates(doc, doc.states.map((s) => (s.id === state.id ? { ...s, name: name.value } : s))));
    });

    const kind = document.createElement('select');
    kind.setAttribute('aria-label', `Kind of ${state.name}`);
    for (const k of KIND_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      kind.appendChild(opt);
    }
    kind.value = state.kind;
    kind.disabled = state.id === 0;
    kind.addEventListener('change', () => {
      emit(
        applyStates(
          doc,
          doc.states.map((s) => (s.id === state.id ? { ...s, kind: kind.value as StudioState['kind'] } : s)),
        ),
      );
    });

    const alive = document.createElement('label');
    alive.className = 'studio-state-alive';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.countsAsAlive;
    box.disabled = state.id === 0;
    box.setAttribute('aria-label', `${state.name} counts as alive`);
    box.addEventListener('change', () => {
      emit(
        applyStates(
          doc,
          doc.states.map((s) => (s.id === state.id ? { ...s, countsAsAlive: box.checked } : s)),
        ),
      );
    });
    const aliveText = document.createElement('span');
    aliveText.textContent = 'alive';
    alive.append(box, aliveText);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'studio-state-remove';
    remove.textContent = 'Remove';
    remove.disabled = state.id === 0 || doc.states.length <= 2;
    remove.addEventListener('click', () => {
      emit(applyStates(doc, doc.states.filter((s) => s.id !== state.id)));
    });

    row.append(color, name, kind, alive, remove);
    return row;
  }

  function paint(): void {
    if (document.activeElement !== notation) notation.value = formatNotation(doc);
    temper.textContent = temperamentLine(guessTemperament(doc));
    paintChips(bornRow, 'born');
    paintChips(surviveRow, 'survive');
    paintTable();
    hoodSelect.value = neighborhoodId(doc.neighborhood);
    paintDiagrams();
    paintStates();
  }

  notation.addEventListener('change', () => {
    const next = applyNotation(doc, notation.value);
    if (next) emit(next);
    else notation.value = formatNotation(doc);
  });
  hoodSelect.addEventListener('change', () => {
    const found = NEIGHBORHOOD_OPTIONS.find((o) => o.id === hoodSelect.value);
    if (found) emit(applyNeighborhood(doc, found.value));
  });
  randomBtn.addEventListener('click', () => {
    const rng = opts.rng ?? mulberry32((Math.random() * 0xffffffff) >>> 0);
    emit(randomiseDocument(doc, constraints, rng));
  });

  paint();

  return {
    root,
    setDocument(next) {
      doc = next;
      paint();
    },
    getDocument: () => doc,
    getNotation: () => formatNotation(doc),
    setNotation(value) {
      const next = applyNotation(doc, value);
      if (!next) return false;
      emit(next);
      return true;
    },
    toggle(field, n) {
      const current = field === 'born' ? doc.transition.born : doc.transition.survive;
      emit(applyBornSurvive(doc, field, toggleCount(current, n)));
    },
    randomise(seed) {
      const rng = opts.rng ?? mulberry32(seed ?? ((Math.random() * 0xffffffff) >>> 0));
      const next = randomiseDocument(doc, constraints, rng);
      emit(next);
      return next;
    },
    getConstraints: () => ({ ...constraints }),
    setConstraints(next) {
      if (next.birthDensity !== undefined) constraints.birthDensity = next.birthDensity;
      if (next.surviveDensity !== undefined) constraints.surviveDensity = next.surviveDensity;
      if (next.symmetry !== undefined) constraints.symmetry = next.symmetry;
      const inputs = sliders.querySelectorAll('input[type="range"]');
      const birth = inputs[0] as HTMLInputElement | undefined;
      const survive = inputs[1] as HTMLInputElement | undefined;
      const sym = inputs[2] as HTMLInputElement | undefined;
      if (birth) birth.value = String(constraints.birthDensity);
      if (survive) survive.value = String(constraints.surviveDensity);
      if (sym) sym.value = String(constraints.symmetry);
    },
    dispose() {
      root.remove();
    },
  };
}

function th(text: string): HTMLTableCellElement {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}

function slider(label: string, name: string, value: number, onInput: (n: number) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'studio-slider';
  const title = document.createElement('span');
  title.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.name = name;
  input.addEventListener('input', () => onInput(Number(input.value)));
  wrap.append(title, input);
  return wrap;
}
