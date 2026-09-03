#!/usr/bin/env node
/**
 * bench.mjs — P0-I-4 performance gate.
 *
 * Hand-written per the no-bloat rule (ADR-004): warmup, N=7, take the median,
 * compare to a committed baseline, fail on a >10% regression or a missed
 * absolute budget. Vitest's `bench` is not the gate.
 *
 *   node --expose-gc --import tsx scripts/bench.mjs
 *   node --expose-gc --import tsx scripts/bench.mjs --update-baseline
 *   node --expose-gc --import tsx scripts/bench.mjs --inject-slowdown 1.3
 *
 * `--inject-slowdown` makes every median *worse* by the given factor (divide
 * when higher-is-better, multiply when lower-is-better) so the first
 * acceptance criterion can be proved without poisoning the real suite.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_N = 7;
export const DEFAULT_TOLERANCE = 0.1;
export const DEFAULT_DIR = join(ROOT, 'tests/bench');
export const DEFAULT_BASELINE = join(ROOT, 'bench-baseline.json');

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
 * Decide whether a measured median misses its absolute budget and/or regresses
 * more than `tolerance` against a committed baseline. `regression` is signed
 * "worse-is-positive" (0.3 means 30% slower).
 */
export function evaluateCase({ value, baseline, budget, higherIsBetter, tolerance = DEFAULT_TOLERANCE }) {
  const budgetFail =
    budget === undefined || budget === null
      ? false
      : higherIsBetter
        ? value < budget
        : value > budget;
  let regression = 0;
  let regressionFail = false;
  if (baseline !== undefined && baseline !== null) {
    regression = higherIsBetter ? (baseline - value) / baseline : (value - baseline) / baseline;
    regressionFail = regression > tolerance + 1e-12;
  }
  return { budgetFail, regressionFail, regression };
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

export function formatTable(rows, { n, tolerance, machine }) {
  const lines = [];
  lines.push('─'.repeat(92));
  lines.push(` fancy-gol  bench   N=${n} median   tolerance ${(tolerance * 100).toFixed(0)}%`);
  if (machine) lines.push(` ${machine}`);
  lines.push('─'.repeat(92));
  lines.push(
    ` ${pad('case', 28)} ${pad('median', 16, true)} ${pad('budget', 14, true)} ${pad('baseline', 14, true)} ${pad('Δ', 8, true)}  `,
  );
  for (const r of rows) {
    const budget =
      r.budget == null ? '—' : `${r.higherIsBetter ? '≥' : '≤'} ${formatNumber(r.budget, r.unit)}`;
    const base = r.baseline == null ? '—' : formatNumber(r.baseline, r.unit);
    const delta =
      r.baseline == null ? '—' : `${r.regression >= 0 ? '+' : ''}${(r.regression * 100).toFixed(1)}%`;
    const flag = r.ok ? 'ok' : r.budgetFail ? 'BUDGET' : 'REGRESS';
    lines.push(
      ` ${pad(r.id, 28)} ${pad(formatNumber(r.median, r.unit), 16, true)} ${pad(budget, 14, true)} ${pad(base, 14, true)} ${pad(delta, 8, true)}  ${flag}`,
    );
  }
  lines.push('─'.repeat(92));
  return lines.join('\n');
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
    return median(samples);
  } finally {
    if (typeof c.teardown === 'function') await c.teardown();
  }
}

function writeBaseline(path, cases, medians) {
  const prev = loadBaseline(path);
  const doc = {
    version: 1,
    recorded: new Date().toISOString().slice(0, 10),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    note: 'Real machine run. Medians of 7 after per-case warmup. Updating this file is a reviewed commit, never a reflex.',
    tolerance: DEFAULT_TOLERANCE,
    cases: { ...(prev?.cases ?? {}) },
  };
  for (const c of cases) {
    doc.cases[c.id] = {
      median: medians.get(c.id),
      unit: c.unit,
      ...(c.budget != null ? { budget: c.budget } : {}),
      higherIsBetter: !!c.higherIsBetter,
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

  const medians = new Map();
  const rows = [];
  let failed = 0;

  for (const c of cases) {
    log(`  running ${c.id}…`);
    const raw = await runCase(c, n);
    const measured = applySlowdown(raw, injectSlowdown, !!c.higherIsBetter);
    medians.set(c.id, updateBaseline ? raw : measured);

    const base = baselineDoc?.cases?.[c.id]?.median;
    const { budgetFail, regressionFail: rawRegression, regression } = evaluateCase({
      value: measured,
      baseline: updateBaseline ? undefined : base,
      budget: c.budget,
      higherIsBetter: !!c.higherIsBetter,
    });
    const regressionFail = c.baselineGate === false ? false : rawRegression;
    const ok = !budgetFail && !regressionFail;
    if (!ok) failed += 1;
    rows.push({
      id: c.id,
      unit: c.unit,
      median: measured,
      budget: c.budget,
      baseline: base,
      higherIsBetter: !!c.higherIsBetter,
      budgetFail,
      regressionFail,
      regression,
      ok,
    });
  }

  const machine = `${process.version}  ${process.platform}/${process.arch}`;
  log(formatTable(rows, { n, tolerance: DEFAULT_TOLERANCE, machine }));
  if (injectSlowdown !== 1) log(`  (slowdown ×${injectSlowdown} injected — values are deliberately worse)`);

  if (updateBaseline) {
    if (failed) {
      error('refusing to --update-baseline: one or more cases missed their budget');
    } else {
      writeBaseline(baselinePath, cases, medians);
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
  --inject-slowdown N   make every median N× worse (prove the gate)
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
