/**
 * The Phase 1 default-bindings table (phase doc §Workstream C, "Default bindings (Phase 1
 * set)"), as data — not code, the same discipline P1-B-5/P1-B-6 already established for the
 * RLE codec and the stamp library. Most of these command ids don't exist as real `AppCommand`s
 * yet (`sim.*`, `view.*`, `edit.*`, `session.*`, `brush.setSize`, `help.cheatsheet` are all
 * future tasks — only the eight `tool.select.*` ids exist today, from P1-C-1). Every entry is
 * still listed here now: `attachDefaultBindings` only ever registers an entry whose command id
 * is actually present in the given `CommandRegistry`, silently skipping the rest — each future
 * task that adds one of those commands makes its binding live automatically, with no change to
 * this file needed.
 *
 * Two omissions from the source table, both deliberate:
 * - `,` "Step back" and `Mod+K` "Command palette" are explicitly marked *(Phase 4)* in the
 *   table itself — not part of "the Phase 1 set" despite appearing in it for full-layout
 *   context. Left unregistered here; Phase 4 adds them.
 * - The table's `Shift+/` → "Shortcut cheat sheet" and `?` → "Help" are the same physical key
 *   on a US layout (`?` **is** `Shift+/`) and, per this module's canonicalisation rule
 *   (`keymap.ts`'s doc comment), *must* collide — registering both would trip the very conflict
 *   detection this task requires. Treated as one action, one binding: `?` → `help.cheatsheet`.
 */
import type { CommandRegistry } from '@ui/commands/registry';
import type { Keymap, KeymapEntry } from './keymap';

export const PHASE_1_BINDINGS: readonly KeymapEntry[] = [
  { binding: 'Space', commandId: 'sim.toggleRun' },
  { binding: '.', commandId: 'sim.step' },
  { binding: '[', commandId: 'sim.speedDown' },
  { binding: ']', commandId: 'sim.speedUp' },
  { binding: 'R', commandId: 'sim.reset' },
  { binding: 'C', commandId: 'sim.clear' },
  { binding: 'N', commandId: 'sim.randomSoup' },
  { binding: '+', commandId: 'view.zoomIn' },
  { binding: '-', commandId: 'view.zoomOut' },
  { binding: '0', commandId: 'view.zoomToFit' },
  { binding: 'Mod+Z', commandId: 'edit.undo' },
  { binding: 'Mod+Shift+Z', commandId: 'edit.redo' },
  { binding: 'Mod+C', commandId: 'edit.copy' },
  { binding: 'Mod+X', commandId: 'edit.cut' },
  { binding: 'Mod+V', commandId: 'edit.paste' },
  { binding: 'Mod+S', commandId: 'session.save' },
  { binding: 'B', commandId: 'tool.select.brush' },
  { binding: 'E', commandId: 'tool.select.eraser' },
  { binding: 'L', commandId: 'tool.select.line' },
  { binding: 'U', commandId: 'tool.select.rect' },
  { binding: 'O', commandId: 'tool.select.ellipse' },
  { binding: 'G', commandId: 'tool.select.fill' },
  { binding: 'S', commandId: 'tool.select.select' },
  { binding: 'M', commandId: 'tool.select.stamp' },
  ...Array.from({ length: 9 }, (_, i) => ({ binding: String(i + 1), commandId: 'brush.setSize', arg: i + 1 })),
  { binding: '?', commandId: 'help.cheatsheet' },
];

/**
 * Registers every entry whose command id is already present in `registry`, skipping the rest.
 * Returns the number actually registered, so a caller (or a test) can assert on progress as
 * future tasks land their commands.
 */
export function attachDefaultBindings(keymap: Keymap, registry: CommandRegistry): number {
  let registered = 0;
  for (const entry of PHASE_1_BINDINGS) {
    if (!registry.get(entry.commandId)) continue;
    keymap.register(entry);
    registered++;
  }
  return registered;
}
