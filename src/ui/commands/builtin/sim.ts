/**
 * P1-D-2 — the `sim.*` commands: play/pause, single-step, reset, clear, random soup, and the two
 * logarithmic speed-step bindings — the seven `sim.*` entries `ui/input/bindings.ts`'s
 * `PHASE_1_BINDINGS` table already lists as data (`Space`, `.`, `R`, `C`, `N`, `[`, `]`).
 * Registering them here is what makes those table entries stop being silently skipped by
 * `attachDefaultBindings` — exactly the mechanism that module's own doc comment describes: "each
 * future task that adds one of those commands makes its binding live automatically, with no
 * change to `bindings.ts` needed."
 *
 * `,` (step back) is deliberately absent — the table itself marks it *(Phase 4)* and
 * `bindings.ts` never registers it; there is no `sim.stepBack` command here either. Phase 1's
 * transport still ships a visible, disabled step-back button ("present but disabled with a
 * 'Phase 4' tooltip — never ship a mystery") — that's `transport.ts`'s job, a plain disabled
 * `<button>`, not a registered command with nothing to run.
 *
 * Every `run`/`isEnabled`/`isActive` body goes through {@link requireSim}, turning a missing
 * `AppContext.sim` (true only if some future caller registers these commands without ever
 * constructing a `SimControl`) into a loud, legible error — never a silent no-op — matching this
 * project's "failure mode is a legible message" standard.
 */
import type { AppCommand, AppContext, SimControl } from '@ui/commands/registry';
import { stepSpeed } from '@ui/components/speed';

function requireSim(ctx: AppContext): SimControl {
  if (!ctx.sim) {
    throw new Error('sim.* command run without a SimControl on AppContext — was one ever constructed?');
  }
  return ctx.sim;
}

export const SIM_TOGGLE_RUN: AppCommand = {
  id: 'sim.toggleRun',
  title: 'Play / Pause',
  category: 'Simulation',
  defaultBinding: 'Space',
  isActive: (ctx) => requireSim(ctx).running,
  run: (ctx) => requireSim(ctx).toggleRun(),
};

export const SIM_STEP: AppCommand = {
  id: 'sim.step',
  title: 'Single step',
  category: 'Simulation',
  defaultBinding: '.',
  isEnabled: (ctx) => !requireSim(ctx).running,
  run: (ctx) => requireSim(ctx).step(),
};

export const SIM_RESET: AppCommand = {
  id: 'sim.reset',
  title: 'Reset to seed',
  category: 'Simulation',
  defaultBinding: 'R',
  run: (ctx) => requireSim(ctx).reset(),
};

export const SIM_CLEAR: AppCommand = {
  id: 'sim.clear',
  title: 'Clear grid',
  category: 'Simulation',
  defaultBinding: 'C',
  run: (ctx) => requireSim(ctx).clear(),
};

export const SIM_RANDOM_SOUP: AppCommand = {
  id: 'sim.randomSoup',
  title: 'Random soup',
  category: 'Simulation',
  defaultBinding: 'N',
  run: (ctx) => requireSim(ctx).randomSoup(),
};

export const SIM_SPEED_DOWN: AppCommand = {
  id: 'sim.speedDown',
  title: 'Speed down',
  category: 'Simulation',
  defaultBinding: '[',
  run: (ctx) => {
    const sim = requireSim(ctx);
    sim.setSpeed(stepSpeed(sim.targetTps, -1));
  },
};

export const SIM_SPEED_UP: AppCommand = {
  id: 'sim.speedUp',
  title: 'Speed up',
  category: 'Simulation',
  defaultBinding: ']',
  run: (ctx) => {
    const sim = requireSim(ctx);
    sim.setSpeed(stepSpeed(sim.targetTps, 1));
  },
};

/** Every `sim.*` command this task adds, in the order `PHASE_1_BINDINGS` lists their bindings. */
export const SIM_COMMANDS: readonly AppCommand[] = [
  SIM_TOGGLE_RUN,
  SIM_STEP,
  SIM_SPEED_DOWN,
  SIM_SPEED_UP,
  SIM_RESET,
  SIM_CLEAR,
  SIM_RANDOM_SOUP,
];
