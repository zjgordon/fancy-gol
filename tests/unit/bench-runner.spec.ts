import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applySlowdown,
  evaluateCase,
  formatNumber,
  median,
  parseArgs,
} from '../../scripts/bench.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const RUNNER = join(ROOT, 'scripts/bench.mjs');
const FIXTURE_DIR = join(ROOT, 'tests/fixtures/bench');
const FIXTURE_BASELINE = join(FIXTURE_DIR, 'baseline.json');

function runBench(extra: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      RUNNER,
      '--dir',
      FIXTURE_DIR,
      '--baseline',
      FIXTURE_BASELINE,
      ...extra,
    ],
    { encoding: 'utf8', cwd: ROOT },
  );
  return {
    status: r.status,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  };
}

describe('median', () => {
  it('returns the middle value of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two centre values of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('rejects an empty list', () => {
    expect(() => median([])).toThrow(/empty/);
  });
});

describe('applySlowdown', () => {
  it('makes a higher-is-better metric worse by dividing', () => {
    expect(applySlowdown(130, 1.3, true)).toBeCloseTo(100);
  });

  it('makes a lower-is-better metric worse by multiplying', () => {
    expect(applySlowdown(100, 1.3, false)).toBeCloseTo(130);
  });

  it('is a no-op at factor 1', () => {
    expect(applySlowdown(50, 1, true)).toBe(50);
  });
});

describe('evaluateCase', () => {
  it('flags a missed higher-is-better budget', () => {
    const r = evaluateCase({ value: 50, budget: 60, higherIsBetter: true });
    expect(r.budgetFail).toBe(true);
  });

  it('flags a >10% regression against baseline', () => {
    const r = evaluateCase({
      value: 130,
      baseline: 100,
      budget: 200,
      higherIsBetter: false,
      tolerance: 0.1,
    });
    expect(r.budgetFail).toBe(false);
    expect(r.regressionFail).toBe(true);
    expect(r.regression).toBeCloseTo(0.3);
  });

  it('accepts a 10% regression on the nose', () => {
    const r = evaluateCase({
      value: 110,
      baseline: 100,
      budget: 200,
      higherIsBetter: false,
      tolerance: 0.1,
    });
    expect(r.regressionFail).toBe(false);
  });
});

describe('parseArgs', () => {
  it('parses the flags the CLI documents', () => {
    const a = parseArgs(['--update-baseline', '--inject-slowdown', '1.3', '--filter', 'a,b', '--n', '3']);
    expect(a.updateBaseline).toBe(true);
    expect(a.injectSlowdown).toBe(1.3);
    expect(a.filter).toBe('a,b');
    expect(a.n).toBe(3);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
  });
});

describe('formatNumber', () => {
  it('keeps a unit on the formatted value', () => {
    expect(formatNumber(60, 'steps/sec')).toMatch(/60.*steps\/sec/);
  });
});

describe('npm run bench 30% slowdown gate', () => {
  it('prints a table and exits 0 against the fixture baseline', () => {
    const r = runBench([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/trivial-ms/);
    expect(r.stdout).toMatch(/fancy-gol\s+bench/);
    expect(r.stdout).toMatch(/ok/);
  });

  it('exits non-zero on a deliberately introduced 30% slowdown', () => {
    const r = runBench(['--inject-slowdown', '1.3']);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/REGRESS|regression/i);
    expect(r.stdout).toMatch(/slowdown/);
  });
});
