import { describe, expect, it, vi, type Mock } from 'vitest';
import { SIM_COMMANDS } from '@ui/commands/builtin/sim';
import { CommandRegistry, type AppContext, type SimControl } from '@ui/commands/registry';
import { ToolRegistry } from '@ui/tools/registry';

interface FakeSim {
  readonly sim: SimControl;
  readonly toggleRun: Mock;
  readonly step: Mock;
  readonly reset: Mock;
  readonly clear: Mock;
  readonly randomSoup: Mock;
  readonly setSpeed: Mock<(tps: number) => void>;
}

/**
 * Returns the spies as plain (non-method-shorthand-typed) properties alongside the `SimControl`
 * itself — `SimControl`'s methods are declared with real method syntax (matching every other
 * `ui/commands/` interface), so a reference extracted *through* that interface type trips
 * `@typescript-eslint/unbound-method`; keeping a separate, plainly-`Mock`-typed handle to each
 * spy sidesteps that without weakening the interface just to appease a test's assertions.
 */
function fakeSim(overrides: Partial<Pick<SimControl, 'running' | 'targetTps' | 'actualTps'>> = {}): FakeSim {
  const toggleRun = vi.fn();
  const step = vi.fn();
  const reset = vi.fn();
  const clear = vi.fn();
  const randomSoup = vi.fn();
  const setSpeed = vi.fn<(tps: number) => void>();
  const sim: SimControl = {
    running: true,
    targetTps: 30,
    actualTps: 30,
    ...overrides,
    toggleRun,
    step,
    reset,
    clear,
    randomSoup,
    setSpeed,
  };
  return { sim, toggleRun, step, reset, clear, randomSoup, setSpeed };
}

function ctxWith(sim?: SimControl): AppContext {
  return { toolRegistry: new ToolRegistry(), ...(sim ? { sim } : {}) };
}

describe('SIM_COMMANDS', () => {
  it('registers cleanly (no duplicate ids, no orphan bindings) alongside the tool.select.* commands', () => {
    const registry = new CommandRegistry();
    expect(() => {
      for (const cmd of SIM_COMMANDS) registry.register(cmd);
    }).not.toThrow();
    for (const cmd of registry.list()) {
      expect(cmd.title.length).toBeGreaterThan(0);
      expect(cmd.category.length).toBeGreaterThan(0);
      expect(cmd.defaultBinding !== undefined || cmd.noBinding === true).toBe(true);
    }
  });

  it('covers exactly the seven sim.* bindings PHASE_1_BINDINGS lists as data (Space, ., R, C, N, [, ])', () => {
    const ids = SIM_COMMANDS.map((c) => c.id).sort();
    expect(ids).toEqual(
      ['sim.clear', 'sim.randomSoup', 'sim.reset', 'sim.speedDown', 'sim.speedUp', 'sim.step', 'sim.toggleRun'].sort(),
    );
    const bindings = SIM_COMMANDS.map((c) => c.defaultBinding).sort();
    expect(bindings).toEqual(['.', '[', ']', 'C', 'N', 'R', 'Space'].sort());
  });

  describe('requireSim: every command fails loudly, never silently, without a SimControl', () => {
    const ctx = ctxWith(undefined);
    for (const cmd of SIM_COMMANDS) {
      it(`${cmd.id}.run throws a legible error`, () => {
        expect(() => cmd.run(ctx, undefined)).toThrow(/SimControl/);
      });
    }
  });

  it('sim.toggleRun calls SimControl.toggleRun and isActive reflects running', () => {
    const running = fakeSim({ running: true });
    const ctx = ctxWith(running.sim);
    const cmd = SIM_COMMANDS.find((c) => c.id === 'sim.toggleRun')!;
    void cmd.run(ctx, undefined);
    expect(running.toggleRun).toHaveBeenCalledTimes(1);
    expect(cmd.isActive?.(ctx)).toBe(true);

    const paused = fakeSim({ running: false });
    expect(cmd.isActive?.(ctxWith(paused.sim))).toBe(false);
  });

  it('sim.step is enabled only while paused', () => {
    const cmd = SIM_COMMANDS.find((c) => c.id === 'sim.step')!;
    expect(cmd.isEnabled?.(ctxWith(fakeSim({ running: true }).sim))).toBe(false);
    expect(cmd.isEnabled?.(ctxWith(fakeSim({ running: false }).sim))).toBe(true);

    const fake = fakeSim();
    void cmd.run(ctxWith(fake.sim), undefined);
    expect(fake.step).toHaveBeenCalledTimes(1);
  });

  it('sim.reset/sim.clear/sim.randomSoup each call their matching SimControl method', () => {
    for (const { id, pick } of [
      { id: 'sim.reset', pick: (f: FakeSim) => f.reset },
      { id: 'sim.clear', pick: (f: FakeSim) => f.clear },
      { id: 'sim.randomSoup', pick: (f: FakeSim) => f.randomSoup },
    ] as const) {
      const fake = fakeSim();
      const cmd = SIM_COMMANDS.find((c) => c.id === id)!;
      void cmd.run(ctxWith(fake.sim), undefined);
      expect(pick(fake)).toHaveBeenCalledTimes(1);
    }
  });

  it('sim.speedUp/speedDown step the current target logarithmically via SimControl.setSpeed', () => {
    const up = fakeSim({ targetTps: 30 });
    const upCmd = SIM_COMMANDS.find((c) => c.id === 'sim.speedUp')!;
    void upCmd.run(ctxWith(up.sim), undefined);
    expect(up.setSpeed).toHaveBeenCalledTimes(1);
    const [upValue] = up.setSpeed.mock.calls[0]!;
    expect(upValue).toBeGreaterThan(30);

    const down = fakeSim({ targetTps: 30 });
    const downCmd = SIM_COMMANDS.find((c) => c.id === 'sim.speedDown')!;
    void downCmd.run(ctxWith(down.sim), undefined);
    const [downValue] = down.setSpeed.mock.calls[0]!;
    expect(downValue).toBeLessThan(30);
  });
});
