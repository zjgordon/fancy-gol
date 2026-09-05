/**
 * P1-D-5 — "tooltips that show the command's current keybinding." A pure lookup, not a custom
 * popup widget: every control in this app already shows its tooltip via the native `title`
 * attribute (accessible, keyboard-reachable via the browser's own affordance, zero extra DOM),
 * so what was actually missing wasn't a tooltip *mechanism* — it was reading the binding from
 * `Keymap`, the single live source of truth, instead of a hardcoded string baked in at the call
 * site (`transport.ts`'s original `BUTTONS` table did exactly that).
 *
 * "Display the *user's current* binding, not the default, once Phase 4 adds remapping" (this
 * task's own acceptance criterion) is what this buys for free: `Keymap` is the same registry
 * Phase 4's remapping UI will mutate, so once that exists, every tooltip built through this
 * function updates with it automatically — no change needed here or at any call site.
 */
import type { Keymap } from '@ui/input/keymap';

/** `"${label} (${binding})"`, or just `label` if `commandId` has no registered binding (a
 * disabled/removed keybinding, or a command this build's `Keymap` never got — never throws, a
 * missing tooltip suffix is a cosmetic gap, not a broken control). */
export function bindingTooltip(keymap: Keymap, commandId: string, label: string): string {
  const entry = keymap.list().find((e) => e.commandId === commandId);
  return entry ? `${label} (${entry.binding})` : label;
}
