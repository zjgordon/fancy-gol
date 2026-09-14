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
  wallClockRatio,
  wallClockTolerance,
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

describe('wallClockRatio', () => {
  it('is invariant to a machine that runs everything N× slower', () => {
    // Machine A: value 10ms against a 5ms calibration. Machine B is 2× slower end to end.
    const ratioA = wallClockRatio(10, 5, false);
    const ratioB = wallClockRatio(20, 10, false);
    expect(ratioB).toBeCloseTo(ratioA);
  });

  it('moves when the case itself gets slower but the machine does not', () => {
    const before = wallClockRatio(10, 5, false);
    const after = wallClockRatio(13, 5, false); // case alone got 30% slower
    expect(after).toBeLessThan(before);
  });

  it('handles higher-is-better throughput metrics the same way', () => {
    const ratioA = wallClockRatio(100, 5, true);
    const ratioB = wallClockRatio(50, 10, true); // 2× slower machine halves throughput, doubles calibration
    expect(ratioB).toBeCloseTo(ratioA);
  });

  it('rejects a non-positive calibration', () => {
    expect(() => wallClockRatio(10, 0, false)).toThrow(/calibrationMs/);
  });
});

describe('wallClockTolerance', () => {
  it('floors at the fixed WALL_CLOCK_TOLERANCE for a low-noise run', () => {
    expect(wallClockTolerance(0.01)).toBeCloseTo(0.12);
  });

  it('widens to match a noisier run within the cap', () => {
    expect(wallClockTolerance(0.2)).toBeCloseTo(0.2);
  });

  it('never exceeds WALL_CLOCK_MAX_TOLERANCE, however noisy the run', () => {
    // Uncapped widening would let a case tune its own gate down to nothing on a bad enough
    // run — exactly the `baselineGate: false` opt-out this task retires, just computed.
    expect(wallClockTolerance(0.9)).toBeCloseTo(0.35);
  });
});

describe('evaluateCase deterministic class (default)', () => {
  it('flags a missed higher-is-better budget', () => {
    const r = evaluateCase({ value: 50, budget: 60, higherIsBetter: true });
    expect(r.budgetFail).toBe(true);
  });

  it('fails a 6% regression the retired flat 10% gate would have passed — deterministic tight fail', () => {
    const r = evaluateCase({ value: 106, baseline: 100, higherIsBetter: false, cls: 'deterministic' });
    expect(r.regressionFail).toBe(true);
    expect(r.regression).toBeCloseTo(0.06);
  });

  it('holds at the 3% edge', () => {
    const r = evaluateCase({ value: 103, baseline: 100, higherIsBetter: false, cls: 'deterministic' });
    expect(r.regressionFail).toBe(false);
  });

  it('defaults to the deterministic class when none is given', () => {
    const r = evaluateCase({ value: 106, baseline: 100, higherIsBetter: false });
    expect(r.regressionFail).toBe(true);
  });
});

describe('evaluateCase wall-clock class', () => {
  it('gates on the calibration ratio, not the raw value — wall-clock ratio fail', () => {
    // Raw value is literally unchanged from the baseline; a value-only gate would see 0%
    // regression. The ratio to calibration dropped 20%, past the 12% band, and must still fail.
    const r = evaluateCase({
      value: 100,
      baseline: 100,
      higherIsBetter: false,
      cls: 'wall-clock',
      ratio: 0.8,
      baselineRatio: 1.0,
    });
    expect(r.regressionFail).toBe(true);
    expect(r.regression).toBeCloseTo(0.2);
  });

  it('does not regress when the ratio held steady despite the raw value moving', () => {
    // A slower box slowed the calibration workload right along with the case; the ratio,
    // not the millisecond figure, is what the gate is defined on.
    const r = evaluateCase({
      value: 500,
      baseline: 100,
      higherIsBetter: false,
      cls: 'wall-clock',
      ratio: 1.0,
      baselineRatio: 1.0,
    });
    expect(r.regressionFail).toBe(false);
  });

  it('accepts a ratio drop within the noise-aware wall-clock band', () => {
    const r = evaluateCase({
      value: 1,
      baseline: 1,
      higherIsBetter: false,
      cls: 'wall-clock',
      ratio: 0.9,
      baselineRatio: 1.0,
    });
    expect(r.regressionFail).toBe(false);
  });

  it('never regresses without a recorded baseline ratio', () => {
    const r = evaluateCase({ value: 1, higherIsBetter: false, cls: 'wall-clock' });
    expect(r.regressionFail).toBe(false);
  });
});

describe('evaluateCase browser class', () => {
  it('never regression-gates, even on a huge raw value change — browser class ignores baselines', () => {
    const r = evaluateCase({ value: 1000, baseline: 100, higherIsBetter: false, cls: 'browser', budget: 2000 });
    expect(r.regressionFail).toBe(false);
    expect(r.budgetFail).toBe(false);
  });

  it('still enforces its absolute budget — browser budget fail', () => {
    const r = evaluateCase({ value: 2500, baseline: 100, higherIsBetter: false, cls: 'browser', budget: 2000 });
    expect(r.budgetFail).toBe(true);
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

describe('npm run bench against the fixture suite (deterministic + wall-clock + browser)', () => {
  it('prints a table with all three classes and exits 0 against the committed fixture baseline', () => {
    const r = runBench([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/trivial-ms/);
    expect(r.stdout).toMatch(/fixture-wall-clock/);
    expect(r.stdout).toMatch(/fixture-browser/);
    expect(r.stdout).toMatch(/fancy-gol\s+bench/);
    expect(r.stdout).toMatch(/calibration:/);
    expect(r.stdout).not.toMatch(/BUDGET|REGRESS/);
  });

  it('exits non-zero on a deliberate 30% slowdown across the whole suite', () => {
    const r = runBench(['--inject-slowdown', '1.3']);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/REGRESS|regression/i);
    expect(r.stdout).toMatch(/slowdown/);
  });

  it('fails a deterministic case on a 6% regression — below the retired 10% band, above the tight 3% one', () => {
    const r = runBench(['--filter', 'trivial-ms', '--inject-slowdown', '1.06']);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/trivial-ms.*REGRESS/);
  });

  it('fails a wall-clock case on its calibration ratio, independent of the machine-speed calibration itself', () => {
    // A 2x (100%) injected slowdown clears even the capped noise-aware band (WALL_CLOCK_MAX_TOLERANCE,
    // 35%) with room to spare, so this stays deterministic on a busy shared machine.
    const r = runBench(['--filter', 'fixture-wall-clock', '--inject-slowdown', '2']);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/fixture-wall-clock.*REGRESS/);
  });

  it('fails a browser-class case purely on its absolute budget, never on regression', () => {
    const r = runBench(['--filter', 'fixture-browser', '--inject-slowdown', '1.8']);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/fixture-browser.*BUDGET/);
    expect(r.stdout).not.toMatch(/REGRESS/);
  });

  it('rejects a case with no class', () => {
    const badDir = join(ROOT, 'tests/fixtures/bench-invalid-class');
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', RUNNER, '--dir', badDir, '--baseline', FIXTURE_BASELINE],
      { encoding: 'utf8', cwd: ROOT },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid or missing class/);
  });

  it('rejects a browser-class case with no budget', () => {
    const badDir = join(ROOT, 'tests/fixtures/bench-browser-no-budget');
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', RUNNER, '--dir', badDir, '--baseline', FIXTURE_BASELINE],
      { encoding: 'utf8', cwd: ROOT },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/needs an absolute budget/);
  });
});
