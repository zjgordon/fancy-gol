import { describe, expect, it } from 'vitest';
import { bindingTooltip } from '@ui/components/tooltip';
import { Keymap } from '@ui/input/keymap';

describe('bindingTooltip', () => {
  it('appends the live binding from Keymap, not a hardcoded one', () => {
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'Space', commandId: 'sim.toggleRun' });
    expect(bindingTooltip(keymap, 'sim.toggleRun', 'Pause')).toBe('Pause (Space)');
  });

  it('reads whatever is currently registered — the seam Phase 4 remapping will use, with no code change here', () => {
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'X', commandId: 'sim.toggleRun' }); // a hypothetical user remap
    expect(bindingTooltip(keymap, 'sim.toggleRun', 'Pause')).toBe('Pause (X)');
  });

  it('falls back to the plain label when the command has no registered binding', () => {
    const keymap = new Keymap(() => false);
    expect(bindingTooltip(keymap, 'sim.unregistered', 'Mystery')).toBe('Mystery');
  });
});
