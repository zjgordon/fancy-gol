#!/usr/bin/env node
/**
 * bench.mjs — P0-I-4 performance gate, three-class policy (P2-F-1, `planning/README.md` §3.6).
 *
 * Hand-written per the no-bloat rule (ADR-004): warmup, N=7, take the median, compare to a
 * committed baseline, fail on a class-appropriate regression or a missed absolute budget.
 * Vitest's `bench` is not the gate.
 *
 * Every case declares exactly one `class` (`tests/bench/types.ts`):
 *   - deterministic  tight ≤3% regression against the committed baseline.
 *   - wall-clock     gated on `median / calibration`, not raw ms — a fixed, allocation-free
 *                    synthetic workload is timed in-process alongside the suite, and the case's
 *                    ratio to that calibration is what regresses, not the absolute number. A
 *                    slower or noisier runner slows the calibration too, so the ratio survives
 *                    machine changes that raw milliseconds never could. Cases that already
 *                    return a same-process ratio (`selfCalibrated: true`) skip the calibrator
 *                    divisor — dividing an overhead % by a synthetic ms figure made the gate
 *                    track the calibrator, not the case.
 *   - browser        absolute budget only in this task (gate-history lands in P2-F-3).
 * There is no per-case `baselineGate: false` opt-out — that valve is retired.
 *
 *   node --expose-gc --import tsx scripts/bench.mjs
 *   node --expose-gc --import tsx scripts/bench.mjs --update-baseline
 *   node --expose-gc --import tsx scripts/bench.mjs --inject-slowdown 1.3
 *
 * `--inject-slowdown` makes every case's median *worse* by the given factor (divide when
 * higher-is-better, multiply when lower-is-better) so the acceptance criteria can be proved
 * without poisoning the real suite. It never touches the calibration workload itself — that is
 * the point: it simulates the *code* getting slower, not the machine, which is exactly what a
 * wall-clock case's ratio gate must catch.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_N = 7;
export const DEFAULT_DIR = join(ROOT, 'tests/bench');
export const DEFAULT_BASELINE = join(ROOT, 'bench-baseline.json');

/** Tight regression band for `deterministic` cases (gzip size, allocated memory, …). No noise excuse exists. */
export const DETERMINISTIC_TOLERANCE = 0.03;
/**
 * Noise-aware band for the `wall-clock` calibration ratio. Wider than the deterministic band
 * because it still rides on a wall-clock timer, just a machine-normalised one.
 */
export const WALL_CLOCK_TOLERANCE = 0.12;
/**
 * Ceiling on how far a wall-clock case's own measured sample spread (§3.6: "use the spread
 * already computed across the median-of-7") may widen its tolerance. Uncapped widening would
 * let a case noisy enough on a given run tune its own gate down to nothing — functionally the
 * `baselineGate: false` opt-out this task retires, just computed instead of declared. A firm
 * ceiling keeps "noise-aware" from quietly becoming "no gate at all".
 */
export const WALL_CLOCK_MAX_TOLERANCE = 0.35;
/** Fixed, allocation-free synthetic workload used to measure this run's machine speed. */
export const CALIBRATION_ITERATIONS = 8_000_000;

const VALID_CLASSES = new Set(['deterministic', 'wall-clock', 'browser']);

/** Median of a non-empty numeric list. Even length: mean of the two centre values. */
export function median(xs) {
  if (xs.length === 0) throw new RangeError('median() of an empty list');
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Apply a slowdown factor so the value looks worse. A factor of 1.3 is a 30%
 * slowdown: ops/sec drop, milliseconds rise.
 */
export function applySlowdown(value, factor, higherIsBetter) {
  if (!(factor > 0)) throw new RangeError(`slowdown factor must be > 0, got ${factor}`);
  if (factor === 1) return value;
  return higherIsBetter ? value / factor : value * factor;
}

/**
 * A fixed, allocation-free, no-I/O CPU workload: `iterations` rounds of integer multiply-xor.
 * Its only job is to take a measurable, machine-speed-proportional amount of time so a
 * `wall-clock` case's ratio to it is portable across runners.
 */
export function runCalibrationWorkload(iterations = CALIBRATION_ITERATIONS) {
  let acc = 0x9e3779b9;
  for (let i = 0; i < iterations; i++) {
    acc = Math.imul(acc ^ i, 0x85ebca6b) >>> 0;
  }
  return acc;
}

/** Median time (ms) of N runs of the calibration workload. */
export function measureCalibrationMs(n = DEFAULT_N, iterations = CALIBRATION_ITERATIONS) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    runCalibrationWorkload(iterations);
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

/**
 * A `wall-clock` case's value normalised against this run's calibration. Defined so that, for
 * either direction of `higherIsBetter`, a machine that runs everything N× slower — the case
 * *and* the calibration workload — leaves the ratio unchanged, while the case's own code
 * getting slower (independent of the machine) moves it. Lower ratio is always worse.
 *
 * `selfCalibrated` cases already return a same-process ratio (overhead %, 320²/32² cost).
 * Their machine cancelled in the measurement; dividing by the synthetic calibrator makes a
 * faster calibrator look like a regression. For those, the committed ratio is `1/value`
 * (lower-is-better) or `value` (higher-is-better) — still lower-ratio-is-worse.
 */
export function wallClockRatio(value, calibrationMs, higherIsBetter, selfCalibrated = false) {
  if (!(value > 0)) throw new RangeError(`wall-clock value must be > 0, got ${value}`);
  if (selfCalibrated) return higherIsBetter ? value : 1 / value;
  if (!(calibrationMs > 0)) throw new RangeError(`calibrationMs must be > 0, got ${calibrationMs}`);
  return higherIsBetter ? value * calibrationMs : calibrationMs / value;
}

export function parseArgs(argv) {
  const out = {
    updateBaseline: false,
    injectSlowdown: 1,
    dir: DEFAULT_DIR,
    baseline: DEFAULT_BASELINE,
    filter: null,
    n: DEFAULT_N,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update-baseline') out.updateBaseline = true;
    else if (a === '--inject-slowdown') {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw new RangeError(`--inject-slowdown needs a positive number, got ${raw}`);
      out.injectSlowdown = n;
    } else if (a === '--dir') out.dir = resolve(argv[++i]);
    else if (a === '--baseline') out.baseline = resolve(argv[++i]);
    else if (a === '--filter') out.filter = String(argv[++i]);
    else if (a === '--n') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`--n needs a positive integer, got ${argv[i]}`);
      out.n = n;
    } else if (a === '--help' || a === '-h') out.help = true;
    else throw new RangeError(`unknown argument: ${a}`);
  }
  return out;
}

export async function loadCases(dir) {
  if (!existsSync(dir)) throw new Error(`bench case directory not found: ${dir}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.bench.ts') || f.endsWith('.bench.mjs'))
    .sort();
  const cases = [];
  for (const file of files) {
    const href = pathToFileURL(join(dir, file)).href;
    const mod = await import(href);
    const exported = mod.cases ?? mod.default;
    if (exported == null) throw new Error(`${file} does not export \`cases\``);
    const list = Array.isArray(exported) ? exported : [exported];
    for (const c of list) {
      if (!c || typeof c.id !== 'string' || typeof c.run !== 'function') {
        throw new Error(`${file} exported a case without id/run`);
      }
      if (!VALID_CLASSES.has(c.class)) {
        throw new Error(`${file}: case ${c.id} has an invalid or missing class (${c.class}) — must be one of ${[...VALID_CLASSES].join(', ')}`);
      }
      if (c.class === 'browser' && c.budget == null) {
        throw new Error(`${file}: browser-class case ${c.id} needs an absolute budget — it is the only gate that class has`);
      }
      cases.push(c);
    }
  }
  return cases;
}

export function loadBaseline(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function formatNumber(n, unit) {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  let body;
  if (abs >= 100) body = n.toFixed(1);
  else if (abs >= 10) body = n.toFixed(2);
  else if (abs >= 1) body = n.toFixed(3);
  else body = n.toFixed(4);
  return unit ? `${body} ${unit}` : body;
}

function pad(s, n, right = false) {
  const str = String(s);
  if (str.length >= n) return str;
  const padStr = ' '.repeat(n - str.length);
  return right ? padStr + str : str + padStr;
}

const CLASS_ABBR = { deterministic: 'det', 'wall-clock': 'wcl', browser: 'brw' };

export function formatTable(rows, { n, machine, calibrationMs }) {
  const width = 100;
  const lines = [];
  lines.push('─'.repeat(width));
  lines.push(
    ` fancy-gol  bench   N=${n} median   det ≤${(DETERMINISTIC_TOLERANCE * 100).toFixed(0)}%   wall-clock ratio ≤${(WALL_CLOCK_TOLERANCE * 100).toFixed(0)}%   browser: budget only`,
  );
  if (machine) lines.push(` ${machine}`);
  if (calibrationMs != null) {
    lines.push(` calibration: ${formatNumber(calibrationMs, 'ms')} median of N (fixed synthetic workload, no alloc/I-O)`);
  }
  lines.push('─'.repeat(width));
  lines.push(
    ` ${pad('case', 30)} ${pad('cls', 4)} ${pad('median', 16, true)} ${pad('budget', 14, true)} ${pad('baseline', 14, true)} ${pad('Δ', 9, true)}  `,
  );
  for (const r of rows) {
    const budget =
      r.budget == null ? '—' : `${r.higherIsBetter ? '≥' : '≤'} ${formatNumber(r.budget, r.unit)}`;
    const base = r.baseline == null ? '—' : formatNumber(r.baseline, r.unit);
    const delta =
      r.cls === 'browser' || (r.baseline == null && r.baselineRatio == null)
        ? '—'
        : `${r.regression >= 0 ? '+' : ''}${(r.regression * 100).toFixed(1)}%`;
    const flag = r.ok ? 'ok' : r.budgetFail ? 'BUDGET' : 'REGRESS';
    const idLabel = r.transcribed ? `${r.id} *` : r.id;
    lines.push(
      ` ${pad(idLabel, 30)} ${pad(CLASS_ABBR[r.cls] ?? '?', 4)} ${pad(formatNumber(r.median, r.unit), 16, true)} ${pad(budget, 14, true)} ${pad(base, 14, true)} ${pad(delta, 9, true)}  ${flag}`,
    );
  }
  lines.push('─'.repeat(width));
  if (rows.some((r) => r.transcribed)) {
    lines.push(' * transcribed — recorded from an external (e.g. Playwright) run, not re-timed here');
  }
  return lines.join('\n');
}

/**
 * Decide whether a measured value misses its absolute budget and/or regresses per its class's
 * policy against a committed baseline. `regression` is signed "worse-is-positive".
 *
 * `deterministic` compares `value` to `baseline` directly at `DETERMINISTIC_TOLERANCE`.
 * `wall-clock` compares `ratio` to `baselineRatio` at `WALL_CLOCK_TOLERANCE` — `value`/`baseline`
 * are reported for humans but never gate a wall-clock case.
 * `browser` never regression-gates; only `budget` applies.
 */
export function evaluateCase({
  value,
  baseline,
  budget,
  higherIsBetter,
  cls = 'deterministic',
  tolerance,
  ratio,
  baselineRatio,
}) {
  const budgetFail =
    budget === undefined || budget === null
      ? false
      : higherIsBetter
        ? value < budget
        : value > budget;

  let regression = 0;
  let regressionFail = false;

  if (cls === 'browser') {
    // Absolute budget only — no regression gate exists for this class in P2-F-1.
    // Gate-history (P2-F-3) is what eventually catches drift here.
  } else if (cls === 'wall-clock') {
    if (baselineRatio !== undefined && baselineRatio !== null && ratio !== undefined && ratio !== null) {
      regression = (baselineRatio - ratio) / baselineRatio;
      regressionFail = regression > (tolerance ?? WALL_CLOCK_TOLERANCE) + 1e-12;
    }
  } else {
    if (baseline !== undefined && baseline !== null) {
      regression = higherIsBetter ? (baseline - value) / baseline : (value - baseline) / baseline;
      regressionFail = regression > (tolerance ?? DETERMINISTIC_TOLERANCE) + 1e-12;
    }
  }

  return { budgetFail, regressionFail, regression };
}

/**
 * Effective wall-clock tolerance for a run whose own N samples disagreed by `spread` (relative).
 * Never tighter than `WALL_CLOCK_TOLERANCE`, never wider than `WALL_CLOCK_MAX_TOLERANCE` — see
 * that constant's doc for why the cap exists.
 */
export function wallClockTolerance(spread) {
  return Math.min(WALL_CLOCK_MAX_TOLERANCE, Math.max(WALL_CLOCK_TOLERANCE, spread));
}

/** Relative spread of this run's own N samples: (max - min) / median. Zero for a constant case. */
function relativeSpread(samples, med) {
  if (!(med > 0)) return 0;
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  return (max - min) / med;
}

async function runCase(c, n) {
  if (typeof c.setup === 'function') await c.setup();
  const warmup = c.warmup ?? 0;
  try {
    for (let i = 0; i < warmup; i++) await c.run();
    const samples = [];
    for (let i = 0; i < n; i++) {
      const v = await c.run();
      if (!Number.isFinite(v)) throw new Error(`case ${c.id} returned non-finite ${v}`);
      samples.push(v);
    }
    const med = median(samples);
    return { median: med, spread: relativeSpread(samples, med) };
  } finally {
    if (typeof c.teardown === 'function') await c.teardown();
  }
}

function writeBaseline(path, cases, medians, ratios, calibrationMs, { keepStale }) {
  const prev = loadBaseline(path);
  const doc = {
    version: 2,
    recorded: new Date().toISOString().slice(0, 10),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    note: 'Real machine run. Medians of N after per-case warmup. Updating this file is a reviewed commit, never a reflex.',
    tolerances: { deterministic: DETERMINISTIC_TOLERANCE, wallClock: WALL_CLOCK_TOLERANCE },
    calibrationMs,
    // A full (unfiltered) run replaces the whole map, so a renamed or deleted case's stale
    // entry doesn't live on forever; `--filter` runs merge, since they only ever see a subset.
    cases: keepStale ? { ...(prev?.cases ?? {}) } : {},
  };
  for (const c of cases) {
    doc.cases[c.id] = {
      median: medians.get(c.id),
      unit: c.unit,
      class: c.class,
      ...(c.budget != null ? { budget: c.budget } : {}),
      higherIsBetter: !!c.higherIsBetter,
      ...(c.class === 'wall-clock' ? { ratio: ratios.get(c.id) } : {}),
      ...(c.selfCalibrated ? { selfCalibrated: true } : {}),
      ...(c.transcribed ? { transcribed: true } : {}),
    };
  }
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
}

export async function runSuite(opts) {
  const {
    updateBaseline = false,
    injectSlowdown = 1,
    dir = DEFAULT_DIR,
    baseline: baselinePath = DEFAULT_BASELINE,
    filter = null,
    n = DEFAULT_N,
    log = console.log,
    error = console.error,
  } = opts;

  if (updateBaseline && injectSlowdown !== 1) {
    throw new Error('refusing to --update-baseline under --inject-slowdown');
  }

  let cases = await loadCases(dir);
  if (filter) {
    const want = new Set(filter.split(',').map((s) => s.trim()).filter(Boolean));
    cases = cases.filter((c) => want.has(c.id));
    if (cases.length === 0) throw new Error(`--filter matched no cases: ${filter}`);
  }

  const baselineDoc = loadBaseline(baselinePath);
  if (!baselineDoc && !updateBaseline) {
    throw new Error(
      `no baseline at ${baselinePath} — record one with: npm run bench -- --update-baseline`,
    );
  }

  const needCalibration = cases.some((c) => c.class === 'wall-clock' && !c.selfCalibrated);
  const calibrationMs = needCalibration ? measureCalibrationMs(n) : null;

  const medians = new Map();
  const ratios = new Map();
  const rows = [];
  let failed = 0;

  for (const c of cases) {
    log(`  running ${c.id}…`);
    const { median: rawMedian, spread } = await runCase(c, n);
    const measured = applySlowdown(rawMedian, injectSlowdown, !!c.higherIsBetter);
    const valueForRecord = updateBaseline ? rawMedian : measured;
    medians.set(c.id, valueForRecord);

    let ratio;
    if (c.class === 'wall-clock') {
      ratio = wallClockRatio(valueForRecord, calibrationMs, !!c.higherIsBetter, !!c.selfCalibrated);
      ratios.set(c.id, ratio);
    }

    const baseEntry = baselineDoc?.cases?.[c.id];
    const base = baseEntry?.median;
    const baselineRatio = baseEntry?.ratio;

    // README §3.6: "band on the ratio may still be noise-aware (use the spread already
    // computed across the median-of-7)". A case whose own N trials already disagree by more
    // than the fixed wall-clock band is inherently noisier than that band assumes — widen to
    // match its own measured spread rather than false-fail on machine jitter every run.
    const tolerance = c.class === 'wall-clock' ? wallClockTolerance(spread) : undefined;

    // The regression/ratio comparison against the *old* baseline is always computed — and
    // always shown — so `--update-baseline` never prints a dishonest "+0.0%" next to a value
    // that visibly moved. Only its power to block the write (`regressionFail`) is suppressed;
    // a budget miss still refuses the update.
    const { budgetFail, regressionFail: rawRegressionFail, regression } = evaluateCase({
      value: measured,
      baseline: base,
      budget: c.budget,
      higherIsBetter: !!c.higherIsBetter,
      cls: c.class,
      tolerance,
      ratio,
      baselineRatio,
    });
    const regressionFail = updateBaseline ? false : rawRegressionFail;
    const ok = !budgetFail && !regressionFail;
    if (!ok) failed += 1;
    rows.push({
      id: c.id,
      cls: c.class,
      unit: c.unit,
      median: measured,
      budget: c.budget,
      baseline: base,
      baselineRatio,
      higherIsBetter: !!c.higherIsBetter,
      transcribed: !!c.transcribed,
      budgetFail,
      regressionFail,
      regression,
      ok,
    });
  }

  const machine = `${process.version}  ${process.platform}/${process.arch}`;
  log(formatTable(rows, { n, machine, calibrationMs }));
  if (injectSlowdown !== 1) log(`  (slowdown ×${injectSlowdown} injected — case values are deliberately worse; calibration is not)`);

  if (updateBaseline) {
    if (failed) {
      error('refusing to --update-baseline: one or more cases missed their budget');
    } else {
      writeBaseline(baselinePath, cases, medians, ratios, calibrationMs, { keepStale: !!filter });
      log(`  wrote ${baselinePath}`);
    }
  }

  const budgetFails = rows.filter((r) => r.budgetFail).length;
  const regressFails = rows.filter((r) => r.regressionFail).length;
  if (failed) {
    error(`✗ ${failed} case(s) failed  (${budgetFails} budget, ${regressFails} regression)`);
  } else {
    log(`✓ ${rows.length}/${rows.length}  budgets held   0 regressions`);
  }
  return { failed, rows };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(`Usage: node --expose-gc --import tsx scripts/bench.mjs [options]
  --update-baseline     write bench-baseline.json from this run
  --inject-slowdown N   make every case's median N× worse (prove the gate); calibration unaffected
  --dir PATH            case directory (default tests/bench)
  --baseline PATH       baseline json (default ./bench-baseline.json)
  --filter id,id        run a subset of cases
  --n N                 trials per case (default 7)`);
    process.exit(0);
  }
  try {
    const { failed } = await runSuite({ ...args, log: console.log, error: console.error });
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  main();
}
