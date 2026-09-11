/**
 * Studio test-bench cards (P2-E-3). The battery itself runs in a worker;
 * this module only paints results and Cancel. `ui/` never imports the engine.
 */
import { BENCH_THUMB, type BenchCaseResult, type BenchReport } from '@shared/bench';

export type StudioRunBattery = (
  ruleset: unknown,
  opts: { signal: AbortSignal; onCase?: (result: BenchCaseResult) => void },
) => Promise<BenchReport>;

export interface StudioBench {
  readonly root: HTMLElement;
  sync(): void;
  cancel(): void;
  dispose(): void;
}

export interface StudioBenchOptions {
  readonly runBattery?: StudioRunBattery;
  readonly getCandidate: () => unknown;
  readonly isValid: () => boolean;
}

function periodLine(c: BenchCaseResult): string {
  if (c.period !== null) return `p${String(c.period)}`;
  if (c.stabilizationGeneration !== null && c.finalPopulation === 0) return 'extinct';
  if (c.stabilizationGeneration !== null) return 'still life';
  return 'still evolving';
}

function stabLine(c: BenchCaseResult): string {
  if (c.stabilizationGeneration === null) return 'Still evolving at the generation cap';
  return `Stabilised at generation ${String(c.stabilizationGeneration)}`;
}

function paintThumb(canvas: HTMLCanvasElement, pixels: Uint8Array): void {
  canvas.width = BENCH_THUMB;
  canvas.height = BENCH_THUMB;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(canvas);
  const live = css.color;
  const dead = css.backgroundColor;
  if (!live || !dead) return;
  for (let y = 0; y < BENCH_THUMB; y++) {
    for (let x = 0; x < BENCH_THUMB; x++) {
      ctx.fillStyle = pixels[y * BENCH_THUMB + x] ? live : dead;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function cardFor(result: BenchCaseResult): HTMLElement {
  const card = document.createElement('li');
  card.className = 'studio-bench-card';

  const canvas = document.createElement('canvas');
  canvas.className = 'studio-bench-thumb';
  canvas.setAttribute('aria-hidden', 'true');
  paintThumb(canvas, result.thumbnail);

  const body = document.createElement('div');
  body.className = 'studio-bench-body';

  const title = document.createElement('h3');
  title.className = 'studio-bench-title';
  title.textContent = result.label;

  const period = document.createElement('p');
  period.className = 'studio-bench-period';
  period.textContent = periodLine(result);

  const pop = document.createElement('p');
  pop.className = 'studio-bench-pop';
  pop.textContent = `${String(result.finalPopulation)} cells`;

  const growth = document.createElement('p');
  growth.className = 'studio-bench-growth';
  growth.textContent = result.growthKind === 'insufficient-data' ? result.growthLabel : result.growthKind;
  growth.title = result.growthLabel;

  const stab = document.createElement('p');
  stab.className = 'studio-bench-stab';
  stab.textContent = stabLine(result);

  body.append(title, period, pop, growth, stab);
  card.append(canvas, body);
  return card;
}

export function createStudioBench(opts: StudioBenchOptions): StudioBench {
  const root = document.createElement('section');
  root.className = 'studio-bench';
  root.setAttribute('aria-label', 'Rule test bench');

  const toolbar = document.createElement('div');
  toolbar.className = 'studio-bench-toolbar';

  const heading = document.createElement('h2');
  heading.className = 'studio-bench-heading';
  heading.textContent = 'Test bench';

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'studio-bench-run';
  runBtn.textContent = 'Run bench';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'studio-bench-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.hidden = true;

  toolbar.append(heading, runBtn, cancelBtn);

  const status = document.createElement('p');
  status.className = 'studio-bench-status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Eight seeds: five soups, a cell, a block, and an 8×8.';

  const grid = document.createElement('ul');
  grid.className = 'studio-bench-grid';

  root.append(toolbar, status, grid);

  let controller: AbortController | null = null;
  let running = false;

  function setRunning(next: boolean): void {
    running = next;
    cancelBtn.hidden = !next;
    runBtn.disabled = next || !opts.runBattery || !opts.isValid();
    grid.setAttribute('aria-busy', next ? 'true' : 'false');
  }

  function sync(): void {
    if (!running) runBtn.disabled = !opts.runBattery || !opts.isValid();
  }

  function cancel(): void {
    controller?.abort();
  }

  runBtn.addEventListener('click', () => {
    const runner = opts.runBattery;
    const candidate = opts.getCandidate();
    if (!runner || !opts.isValid() || candidate == null) return;
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    grid.replaceChildren();
    status.textContent = 'Running the battery…';
    setRunning(true);
    void runner(candidate, {
      signal: ac.signal,
      onCase: (result) => {
        if (controller !== ac) return;
        grid.appendChild(cardFor(result));
      },
    })
      .then((report) => {
        if (controller !== ac) return;
        if (grid.childElementCount === 0) {
          for (const result of report.cases) grid.appendChild(cardFor(result));
        }
        status.textContent = 'Bench finished.';
      })
      .catch((error: unknown) => {
        if (controller !== ac) return;
        const aborted = error instanceof Error && error.name === 'AbortError';
        status.textContent = aborted ? 'Bench cancelled.' : error instanceof Error ? error.message : 'Bench failed.';
        if (aborted) grid.replaceChildren();
      })
      .finally(() => {
        if (controller === ac) {
          controller = null;
          setRunning(false);
        }
      });
  });

  cancelBtn.addEventListener('click', () => cancel());
  setRunning(false);

  return {
    root,
    sync,
    cancel,
    dispose() {
      cancel();
      root.remove();
    },
  };
}
