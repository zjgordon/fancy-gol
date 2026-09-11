import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import type { BenchCaseResult, BenchReport } from '@shared/bench';
import { thumbnailDigest } from '@shared/bench';
import type { StudioRunBattery } from '@ui/panels/ruleset-studio/bench';
import { createRulesetStudioPanel, STUDIO_PANEL_ID } from '@ui/panels/ruleset-studio/panel';
import { attachPanelHost } from '@ui/shell/panel-host';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONWAY_TEXT = readFileSync(join(process.cwd(), 'tests/fixtures/rules/valid/conway.json'), 'utf8');

function validate(value: unknown) {
  try {
    return { ok: true as const, value: validateRuleSet(value) };
  } catch (error) {
    if (error instanceof RuleValidationError) return { ok: false as const, issues: error.issues };
    throw error;
  }
}

function stubCase(id: BenchCaseResult['id'], label: string): BenchCaseResult {
  const thumbnail = new Uint8Array(32 * 32);
  thumbnail[0] = 1;
  return {
    id,
    label,
    stabilizationGeneration: 0,
    finalPopulation: 4,
    growthKind: 'constant',
    growthLabel: 'Constant population (R² = 1.000, ±0 cells)',
    period: 1,
    cycleKind: 'oscillator',
    thumbnail,
    thumbnailDigest: thumbnailDigest(thumbnail),
  };
}

describe('studio test bench', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup(runBattery?: StudioRunBattery) {
    const panel = createRulesetStudioPanel({
      initialText: CONWAY_TEXT,
      validate,
      validateDelayMs: 0,
      lineHeightPx: () => 16,
      ...(runBattery ? { runBattery } : {}),
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1200 });
    host.register(panel.spec);
    host.open(STUDIO_PANEL_ID);
    return { panel, host };
  }

  it('runs the injected battery and paints a card per seed without calling the engine', async () => {
    const block = stubCase('block', 'Block');
    const runBattery = vi.fn((_value: unknown, opts: { signal: AbortSignal; onCase?: (c: BenchCaseResult) => void }) => {
      opts.onCase?.(block);
      return Promise.resolve({ cases: [block] });
    });
    const { panel, host } = setup(runBattery);
    const run = panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!;
    expect(run.disabled).toBe(false);
    run.click();
    await vi.waitFor(() => {
      expect(panel.root.querySelectorAll('.studio-bench-card')).toHaveLength(1);
    });
    expect(runBattery).toHaveBeenCalledTimes(1);
    expect(runBattery.mock.calls[0]?.[0]).toEqual(validateRuleSet(JSON.parse(CONWAY_TEXT)));
    expect(panel.root.querySelector('.studio-bench-title')?.textContent).toBe('Block');
    expect(panel.root.querySelector('.studio-bench-period')?.textContent).toBe('p1');
    expect(panel.root.querySelector('.studio-bench-status')?.textContent).toBe('Bench finished.');
    panel.dispose();
    host.dispose();
  });

  it('never blocks the UI: Cancel aborts an in-flight run', async () => {
    let resolveRun!: (report: BenchReport) => void;
    const runBattery = vi.fn((_value: unknown, opts: { signal: AbortSignal }) => {
      return new Promise<BenchReport>((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('bench cancelled'), { name: 'AbortError' })));
        resolveRun = resolve;
      });
    });
    const { panel, host } = setup(runBattery);
    panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!.click();
    const cancel = panel.root.querySelector<HTMLButtonElement>('.studio-bench-cancel')!;
    expect(cancel.hidden).toBe(false);
    cancel.click();
    await vi.waitFor(() => {
      expect(panel.root.querySelector('.studio-bench-status')?.textContent).toBe('Bench cancelled.');
    });
    expect(panel.root.querySelectorAll('.studio-bench-card')).toHaveLength(0);
    resolveRun({ cases: [] });
    panel.dispose();
    host.dispose();
  });

  it('paints extinct, still-life, and still-evolving cards from the final report', async () => {
    const extinct = { ...stubCase('single', 'Single cell'), period: null, finalPopulation: 0, stabilizationGeneration: 1 };
    const ash = { ...stubCase('soup-10', 'Soup 10%'), period: null, finalPopulation: 12, stabilizationGeneration: 40 };
    const live = {
      ...stubCase('soup-20', 'Soup 20%'),
      period: null,
      stabilizationGeneration: null,
      growthKind: 'insufficient-data' as const,
      growthLabel: 'Insufficient data (8/64 samples)',
    };
    const { panel, host } = setup(() => Promise.resolve({ cases: [extinct, ash, live] }));
    panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!.click();
    await vi.waitFor(() => {
      expect(panel.root.querySelectorAll('.studio-bench-card')).toHaveLength(3);
    });
    const periods = [...panel.root.querySelectorAll('.studio-bench-period')].map((el) => el.textContent);
    expect(periods).toEqual(['extinct', 'still life', 'still evolving']);
    const growths = [...panel.root.querySelectorAll('.studio-bench-growth')].map((el) => el.textContent);
    expect(growths[2]).toContain('Insufficient data');
    panel.dispose();
    host.dispose();
  });

  it('shows a runner error and leaves Run disabled without a worker', async () => {
    const { panel, host } = setup(() => Promise.reject(new Error('worker died')));
    panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!.click();
    await vi.waitFor(() => {
      expect(panel.root.querySelector('.studio-bench-status')?.textContent).toBe('worker died');
    });
    panel.dispose();
    host.dispose();

    const bare = setup();
    expect(bare.panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!.disabled).toBe(true);
    bare.panel.dispose();
    bare.host.dispose();
  });

  it('disables Run when the editor is invalid', () => {
    const { panel, host } = setup(() => Promise.resolve({ cases: [] }));
    panel.setText('{');
    expect(panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!.disabled).toBe(true);
    panel.dispose();
    host.dispose();
  });

  it('has zero axe-core violations with results visible', async () => {
    const block = stubCase('single', 'Single cell');
    const { panel, host } = setup((_value, opts) => {
      opts.onCase?.(block);
      return Promise.resolve({ cases: [block] });
    });
    panel.root.querySelector<HTMLButtonElement>('.studio-bench-run')!.click();
    await vi.waitFor(() => {
      expect(panel.root.querySelector('.studio-bench-card')).not.toBeNull();
    });
    expect((await axe.run(panel.root)).violations).toEqual([]);
    panel.dispose();
    host.dispose();
  });
});
