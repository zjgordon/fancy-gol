/**
 * P3-D-1 — Theme commands: one `theme.select.<id>` per registered theme, plus
 * `theme.cycle` on `Mod+Shift+T`. Phase 4's palette picks these up for free.
 */
import type { AppCommand, AppContext, ThemeControl } from '@ui/commands/registry';
import type { ThemeModule } from '@themes/types';

function requireThemes(ctx: AppContext): ThemeControl {
  if (!ctx.themes) {
    throw new Error('theme.* command run without a ThemeControl on AppContext — was one ever constructed?');
  }
  return ctx.themes;
}

export function themeSelectCommand(id: string, name: string): AppCommand {
  return {
    id: `theme.select.${id}`,
    title: `Theme: ${name}`,
    category: 'Theme',
    keywords: ['theme', 'skin', name.toLowerCase()],
    noBinding: true,
    isActive: (ctx) => requireThemes(ctx).activeId === id,
    run: (ctx) => requireThemes(ctx).activate(id),
  };
}

export const THEME_CYCLE: AppCommand = {
  id: 'theme.cycle',
  title: 'Cycle theme',
  category: 'Theme',
  keywords: ['theme', 'cycle', 'next'],
  defaultBinding: 'Mod+Shift+T',
  run: (ctx) => requireThemes(ctx).cycle(),
};

/** Build select commands for every theme currently listed, plus the cycle command. */
export function buildThemeCommands(
  themes: readonly { readonly id: string; readonly name: string; readonly cost: ThemeModule['cost'] }[],
): readonly AppCommand[] {
  return [...themes.map((t) => themeSelectCommand(t.id, t.name)), THEME_CYCLE];
}
