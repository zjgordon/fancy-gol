import { describe, expect, it } from 'vitest';
import { SHELL_THEME, shellPalette } from '@client/shell-theme';

describe('shellPalette', () => {
  it('keeps dead as the backdrop and cycles live states', () => {
    expect(shellPalette(0)).toBe(SHELL_THEME.background);
    expect(shellPalette(1)).not.toBe(shellPalette(0));
    expect(shellPalette(7)).toBe(shellPalette(1));
    expect(SHELL_THEME.palette(3, 0)).toBe(shellPalette(3));
  });
});
