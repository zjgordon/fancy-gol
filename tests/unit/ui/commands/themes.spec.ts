import { describe, expect, it } from 'vitest';
import { CommandBus } from '@ui/commands/bus';
import { CommandRegistry, type AppContext, type ThemeControl } from '@ui/commands/registry';
import { THEME_CYCLE, buildThemeCommands, themeSelectCommand } from '@ui/commands/builtin/themes';
import { ToolRegistry } from '@ui/tools/registry';
import { attachDefaultBindings, PHASE_1_BINDINGS } from '@ui/input/bindings';
import { Keymap } from '@ui/input/keymap';

function fakeThemes(active = 'default'): ThemeControl & { activated: string[] } {
  const ids = ['default', 'chiba-city', 'flatline'] as const;
  let current = active;
  const activated: string[] = [];
  return {
    activated,
    get activeId() {
      return current;
    },
    list: () =>
      ids.map((id) => ({
        id,
        name: id,
        cost: 'low' as const,
      })),
    activate(id) {
      current = id;
      activated.push(id);
    },
    cycle() {
      const i = ids.indexOf(current as (typeof ids)[number]);
      const next = ids[(i + 1) % ids.length]!;
      void this.activate(next);
    },
  };
}

describe('theme commands', () => {
  it('registers one select command per theme plus cycle', () => {
    const cmds = buildThemeCommands([
      { id: 'default', name: 'Default', cost: 'low' },
      { id: 'void-walker', name: 'Void-Walker', cost: 'high' },
    ]);
    expect(cmds.map((c) => c.id)).toEqual([
      'theme.select.default',
      'theme.select.void-walker',
      'theme.cycle',
    ]);
    expect(THEME_CYCLE.defaultBinding).toBe('Mod+Shift+T');
    expect(themeSelectCommand('x', 'X').noBinding).toBe(true);
  });

  it('activate and cycle drive ThemeControl', async () => {
    const themes = fakeThemes();
    const registry = new CommandRegistry();
    for (const cmd of buildThemeCommands(themes.list())) registry.register(cmd);
    const context: AppContext = { toolRegistry: new ToolRegistry(), themes };
    const bus = new CommandBus(registry, context);

    await bus.run('theme.select.chiba-city');
    expect(themes.activated).toEqual(['chiba-city']);
    expect(themes.activeId).toBe('chiba-city');
    expect(registry.get('theme.select.chiba-city')?.isActive?.(context)).toBe(true);

    await bus.run('theme.cycle');
    expect(themes.activeId).toBe('flatline');
  });

  it('Mod+Shift+T is wired through the default bindings table', () => {
    expect(PHASE_1_BINDINGS.some((e) => e.commandId === 'theme.cycle' && e.binding === 'Mod+Shift+T')).toBe(
      true,
    );
    const registry = new CommandRegistry();
    registry.register(THEME_CYCLE);
    const keymap = new Keymap();
    const n = attachDefaultBindings(keymap, registry);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('throws when ThemeControl is missing', async () => {
    const registry = new CommandRegistry();
    registry.register(THEME_CYCLE);
    const context: AppContext = { toolRegistry: new ToolRegistry() };
    const bus = new CommandBus(registry, context);
    await expect(bus.run('theme.cycle')).rejects.toThrow(/ThemeControl/);
  });
});
