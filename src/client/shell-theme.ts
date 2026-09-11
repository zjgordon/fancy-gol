/**
 * Provisional cell colours for the composition root (P2-G-1). Pending a theme-driven
 * palette on every boot path, this ramp keeps multi-state rulesets visually distinct.
 */
import type { CompiledTheme } from '@render/types';
import type { StateId } from '@shared/types';

const STATE_COLOR_RAMP: readonly string[] = ['#7cf9d0', '#ffb454', '#ff6b81', '#9d7cf9', '#5ed6ae', '#f9e27c'];
const DEAD_COLOR = '#05070a';

export function shellPalette(state: StateId): string {
  if (state === 0) return DEAD_COLOR;
  return STATE_COLOR_RAMP[(state - 1) % STATE_COLOR_RAMP.length]!;
}

export const SHELL_THEME: CompiledTheme = {
  id: 'shell-default',
  background: DEAD_COLOR,
  palette: (state) => shellPalette(state),
};
