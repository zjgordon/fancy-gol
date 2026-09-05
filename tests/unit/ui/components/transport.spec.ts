import { describe, expect, it, vi, type Mock } from 'vitest';
import { createTransportControls } from '@ui/components/transport';
import { SIM_COMMANDS } from '@ui/commands/builtin/sim';
import { CommandBus } from '@ui/commands/bus';
import { CommandRegistry, type AppContext, type SimControl } from '@ui/commands/registry';
import { ToolRegistry } from '@ui/tools/registry';
import { attachDefaultBindings } from '@ui/input/bindings';
import { Keymap } from '@ui/input/keymap';

interface FakeSim {
  readonly sim: SimControl;
  readonly toggleRun: Mock;
  readonly reset: Mock;
  readonly clear: Mock;
  readonly randomSoup: Mock;
}

/** See `tests/unit/ui/commands/builtin/sim.spec.ts`'s identically-shaped helper for why the
 * spies are kept as separate, plainly-`Mock`-typed handles rather than read back through
 * `SimControl`'s own (method-shorthand) interface. */
function fakeSim(overrides: Partial<Pick<SimControl, 'running'>> = {}): FakeSim {
  const toggleRun = vi.fn();
  const reset = vi.fn();
  const clear = vi.fn();
  const randomSoup = vi.fn();
  const sim: SimControl = {
    running: true,
    targetTps: 30,
    actualTps: 30,
    ...overrides,
    toggleRun,
    step: vi.fn(),
    reset,
    clear,
    randomSoup,
    setSpeed: vi.fn(),
  };
  return { sim, toggleRun, reset, clear, randomSoup };
}

function setup(sim: SimControl) {
  const registry = new CommandRegistry();
  for (const cmd of SIM_COMMANDS) registry.register(cmd);
  const context: AppContext = { toolRegistry: new ToolRegistry(), sim };
  const bus = new CommandBus(registry, context);
  const keymap = new Keymap(() => false); // non-mac, so 'Mod' reads as 'Ctrl' consistently
  attachDefaultBindings(keymap, registry);
  return { bus, keymap };
}

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
  return [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
}

describe('createTransportControls', () => {
  it('renders one button per real transport action, each with an accessible name', () => {
    const { bus, keymap } = setup(fakeSim().sim);
    const transport = createTransportControls(bus, keymap);
    const buttons = [...transport.root.querySelectorAll('button')];
    const labels = buttons.map((b) => b.textContent);
    for (const expected of ['Pause', 'Step', 'Step back', 'Reset', 'Clear', 'Soup']) {
      expect(labels).toContain(expected);
    }
    for (const button of buttons) {
      expect((button.textContent ?? '').length).toBeGreaterThan(0); // visible text is itself an accessible name
    }
  });

  it('every real button carries its keybinding in its title tooltip', () => {
    const { bus, keymap } = setup(fakeSim().sim);
    const transport = createTransportControls(bus, keymap);
    expect(findButton(transport.root, 'Pause').title).toContain('Space');
    expect(findButton(transport.root, 'Step').title).toContain('.');
    expect(findButton(transport.root, 'Reset').title).toContain('R');
    expect(findButton(transport.root, 'Clear').title).toContain('C');
    expect(findButton(transport.root, 'Soup').title).toContain('N');
  });

  it('the step-back button is present but disabled, with a Phase 4 tooltip — never a mystery', () => {
    const { bus, keymap } = setup(fakeSim().sim);
    const transport = createTransportControls(bus, keymap);
    const stepBack = findButton(transport.root, 'Step back');
    expect(stepBack.disabled).toBe(true);
    expect(stepBack.title.toLowerCase()).toContain('phase 4');
  });

  it('clicking each real button runs its command through the bus, reaching SimControl', () => {
    const fake = fakeSim();
    const { bus, keymap } = setup(fake.sim);
    const transport = createTransportControls(bus, keymap);

    findButton(transport.root, 'Reset').click();
    findButton(transport.root, 'Clear').click();
    findButton(transport.root, 'Soup').click();
    expect(fake.reset).toHaveBeenCalledTimes(1);
    expect(fake.clear).toHaveBeenCalledTimes(1);
    expect(fake.randomSoup).toHaveBeenCalledTimes(1);
  });

  it('clicking Pause toggles the run state via the bus', () => {
    const fake = fakeSim();
    const { bus, keymap } = setup(fake.sim);
    const transport = createTransportControls(bus, keymap);
    findButton(transport.root, 'Pause').click();
    expect(fake.toggleRun).toHaveBeenCalledTimes(1);
  });

  it('update() flips the Play/Pause label and aria-pressed to match running state', () => {
    const { bus, keymap } = setup(fakeSim().sim);
    const transport = createTransportControls(bus, keymap);
    const playPause = () =>
      [...transport.root.querySelectorAll('button')].find((b) => ['Play', 'Pause'].includes(b.textContent ?? ''))!;

    transport.update({ running: true });
    expect(playPause().textContent).toBe('Pause');
    expect(playPause().getAttribute('aria-pressed')).toBe('true');

    transport.update({ running: false });
    expect(playPause().textContent).toBe('Play');
    expect(playPause().getAttribute('aria-pressed')).toBe('false');
  });

  it('update() disables Step while running — stepping mid-free-run is not a coherent action', () => {
    const { bus, keymap } = setup(fakeSim().sim);
    const transport = createTransportControls(bus, keymap);

    transport.update({ running: true });
    expect(findButton(transport.root, 'Step').disabled).toBe(true);

    transport.update({ running: false });
    expect(findButton(transport.root, 'Step').disabled).toBe(false);
  });
});
