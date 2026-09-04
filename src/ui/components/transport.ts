/**
 * P1-D-2 — the transport bar: play/pause, single step, step-back (present but disabled — "never
 * ship a mystery"), reset, clear, random soup. Every button is a thin `bus.run('sim.<id>')` call,
 * never a handler touching state directly — "if a user can do it, it is a registered command"
 * (Phase 1 §2.2) — so each button's keyboard equivalent is automatically whatever
 * `sim.ts`/`bindings.ts` already registered for that command id, with zero duplication here.
 *
 * `update()` is called by the composition root whenever `AppContext.sim`'s live state might have
 * changed (every delivered worker frame, and immediately after any transport action, since a
 * paused sim delivers no further frames to hang an update off of) — the same imperative
 * "component doesn't own a subscription, the caller pushes" shape `client/main.ts`'s own stat
 * readouts already use; `src/client/store.ts`'s observable state (§2.6's file tree) isn't built
 * by any task yet, so this doesn't invent a second, inconsistent state-propagation mechanism
 * ahead of it.
 */
import type { CommandBus } from '@ui/commands/bus';

export interface TransportState {
  readonly running: boolean;
}

export interface TransportControls {
  readonly root: HTMLElement;
  update(state: TransportState): void;
  dispose(): void;
}

interface ButtonSpec {
  readonly commandId: string;
  readonly label: string;
  readonly binding: string;
}

const BUTTONS: readonly ButtonSpec[] = [
  { commandId: 'sim.toggleRun', label: 'Pause', binding: 'Space' },
  { commandId: 'sim.step', label: 'Step', binding: '.' },
  { commandId: 'sim.reset', label: 'Reset', binding: 'R' },
  { commandId: 'sim.clear', label: 'Clear', binding: 'C' },
  { commandId: 'sim.randomSoup', label: 'Soup', binding: 'N' },
];

export function createTransportControls(bus: CommandBus): TransportControls {
  const root = document.createElement('div');
  root.className = 'chrome-panel controls';

  const buttons = new Map<string, HTMLButtonElement>();
  for (const spec of BUTTONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = spec.label;
    button.title = `${spec.label} (${spec.binding})`;
    button.addEventListener('click', () => void bus.run(spec.commandId));
    buttons.set(spec.commandId, button);
    root.appendChild(button);
  }

  const stepBackButton = document.createElement('button');
  stepBackButton.type = 'button';
  stepBackButton.textContent = 'Step back';
  stepBackButton.disabled = true;
  stepBackButton.title = 'Coming in Phase 4';
  stepBackButton.setAttribute('aria-disabled', 'true');
  // Placed after Step, before Reset — matches the transport's left-to-right playback order
  // (back, forward) a researcher would expect once P4-C's time-traveler ships this for real.
  buttons.get('sim.step')!.insertAdjacentElement('afterend', stepBackButton);

  const playPauseButton = buttons.get('sim.toggleRun')!;
  const stepButton = buttons.get('sim.step')!;

  function update(state: TransportState): void {
    playPauseButton.textContent = state.running ? 'Pause' : 'Play';
    playPauseButton.title = `${state.running ? 'Pause' : 'Play'} (Space)`;
    playPauseButton.setAttribute('aria-pressed', String(state.running));
    stepButton.disabled = state.running;
  }

  return {
    root,
    update,
    dispose(): void {
      // No external (window/document) listeners are attached — every listener here is on an
      // element `root` owns, so removing `root` from the DOM is all disposal ever needs.
    },
  };
}
