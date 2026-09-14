import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RECORD_IDS,
  SCHEMA_VERSION,
  appendRecord,
  cite,
  evaluateCite,
  formatIndex,
  isOfficial,
  makeRecord,
  officialStreak,
  parseRecords,
  sampleSuites,
  serializeRecords,
  streak,
  validateRecord,
} from '../../../scripts/gate-history.mjs';

function rec(
  overrides: Partial<{
    id: string;
    ok: boolean;
    at: string;
    event: string;
    branch: string;
    sha: string;
    suite: string;
  }> = {},
) {
  return makeRecord({
    id: RECORD_IDS.e2e,
    ok: true,
    at: '2026-09-14T05:00:00.000Z',
    event: 'schedule',
    branch: 'main',
    sha: 'abc123',
    suite: 'e2e',
    ...overrides,
  });
}

describe('validateRecord / parseRecords', () => {
  it('accepts a complete record and rejects a truncated line', () => {
    const good = rec();
    expect(validateRecord(good)).toEqual([]);
    expect(good.v).toBe(SCHEMA_VERSION);
    const { records, errors } = parseRecords(`${JSON.stringify(good)}\n{not json}\n`);
    expect(records).toHaveLength(1);
    expect(errors[0]).toMatch(/line 2/);
  });

  it('skips blank lines and flags a missing id', () => {
    expect(validateRecord({ v: 1, ok: true })).toEqual(expect.arrayContaining([expect.stringMatching(/missing id/)]));
    expect(parseRecords('\n\n').records).toEqual([]);
  });
});

describe('streak and cite', () => {
  it('counts newest-first consecutive greens and stops at a red', () => {
    const records = [
      rec({ at: '2026-09-11T00:00:00.000Z' }),
      rec({ at: '2026-09-12T00:00:00.000Z', ok: false }),
      rec({ at: '2026-09-13T00:00:00.000Z' }),
      rec({ at: '2026-09-14T00:00:00.000Z' }),
    ];
    expect(streak(records, RECORD_IDS.e2e)).toBe(2);
    expect(officialStreak(records, RECORD_IDS.e2e)).toBe(2);
  });

  it('does not count a phase-branch dispatch toward the official cite', () => {
    const records = [
      rec({ event: 'workflow_dispatch', branch: 'phase/2-library-and-stats' }),
      rec({ event: 'schedule', branch: 'main' }),
    ];
    expect(isOfficial(records[0]!)).toBe(false);
    expect(streak(records, RECORD_IDS.e2e)).toBe(2);
    expect(officialStreak(records, RECORD_IDS.e2e)).toBe(1);
    const unmet = evaluateCite(records, RECORD_IDS.e2e, 3);
    expect(unmet.ok).toBe(false);
    expect(unmet.cite).toBe(cite(RECORD_IDS.e2e, 3));
    expect(evaluateCite(records, RECORD_IDS.e2e, 1).ok).toBe(true);
  });

  it('keeps visual and e2e streaks independent', () => {
    const records = [
      rec({ id: RECORD_IDS.visual, suite: 'visual', ok: false, at: '2026-09-14T01:00:00.000Z' }),
      rec({ id: RECORD_IDS.e2e, suite: 'e2e', at: '2026-09-14T02:00:00.000Z' }),
    ];
    expect(officialStreak(records, RECORD_IDS.e2e)).toBe(1);
    expect(officialStreak(records, RECORD_IDS.visual)).toBe(0);
  });
});

describe('append / index / sample', () => {
  it('appends a valid record and refuses a broken one', () => {
    const next = appendRecord([], rec());
    expect(next).toHaveLength(1);
    expect(() => appendRecord([], { v: 1, id: '', ok: true } as never)).toThrow(/invalid record/);
  });

  it('round-trips jsonl and names the cite in the generated index', () => {
    const records = [rec(), rec({ id: RECORD_IDS.visual, suite: 'visual', ok: false })];
    const { records: back, errors } = parseRecords(serializeRecords(records));
    expect(errors).toEqual([]);
    expect(back).toHaveLength(2);
    const md = formatIndex(records, { generated: '2026-09-14' });
    expect(md).toContain('gate-history: visual-nonflake ≥ 3 green');
    expect(md).toContain('`e2e-nonflake`');
    expect(md).toContain('Generated 2026-09-14');
  });

  it('sampleSuites records each repeat and fails the batch if any suite is red', () => {
    const calls: string[] = [];
    const { results, failed } = sampleSuites({
      suites: ['e2e', 'visual'],
      repeats: 2,
      meta: { event: 'workflow_dispatch', branch: 'phase/2-library-and-stats', sha: 'deadbeef' },
      run: (suite) => {
        calls.push(suite);
        return { ok: suite === 'e2e', durationMs: 12, status: suite === 'e2e' ? 0 : 1 };
      },
    });
    expect(calls).toEqual(['e2e', 'e2e', 'visual', 'visual']);
    expect(failed).toBe(true);
    expect(results).toHaveLength(4);
    expect(results.filter((r) => r.id === RECORD_IDS.e2e).every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.id === RECORD_IDS.visual).every((r) => !r.ok)).toBe(true);
  });

  it('writes jsonl a subsequent summarize can load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gol-gh-'));
    const file = join(dir, 'records.jsonl');
    writeFileSync(file, serializeRecords([makeRecord({
      id: RECORD_IDS.e2e,
      ok: true,
      event: 'schedule',
      branch: 'main',
      sha: 'abc123',
      suite: 'e2e',
      runUrl: 'https://example.test/1',
    })]));
    const { records, errors } = parseRecords(readFileSync(file, 'utf8'));
    expect(errors).toEqual([]);
    expect(records[0]?.runUrl).toMatch(/example\.test/);
  });
});
