/**
 * The keybinding engine (P1-C-2): normalises a `KeyboardEvent` into a canonical binding string,
 * matches it against registered `{binding -> command}` entries (with chord support, a 1s
 * timeout), and calls `CommandBus.run()` for a match — never while focus is in a text input.
 * Conflicts (the same canonical binding registered twice) throw at registration time, the same
 * "throws loudly" discipline `CommandRegistry` (P1-C-1) and `ToolRegistry` (P1-B-2) established.
 *
 * Canonicalisation rule, chosen to make matching robust without chasing every keyboard-layout
 * edge case (that level of real-world hardening is what P1-H-1's Playwright suite is for — see
 * this task's own deferred criterion): with no Ctrl/Cmd/Alt held, a binding is shift-agnostic
 * for letters/digits (`b` and `Shift+b` both mean `'B'`) and a bare symbol already encodes shift
 * in which character it is (`?` needs no separate `Shift+` prefix — `Shift+/` and `?` are the
 * same physical key, so only one of them may ever be registered, never both). With any of
 * Ctrl/Cmd/Alt held, `Shift` becomes an explicit, required part of the canonical form (`Mod+Z`
 * vs `Mod+Shift+Z` must not collide), since a modified key's `.key` case is not reliably
 * shift-dependent across browsers the way an unmodified key's is.
 */
import type { CommandBus } from '@ui/commands/bus';

export type Platform = () => boolean;

export const SYSTEM_IS_MAC: Platform = () => {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  const ua = navigator.userAgent ?? '';
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);
};

export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

/** How long a chord prefix (`g` waiting for a second `g`) stays pending before it's dropped. */
export const CHORD_TIMEOUT_MS = 1000;

interface StepModifiers {
  readonly ctrl: boolean;
  readonly cmd: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

function canonicalStep(rawKey: string, mods: StepModifiers): string {
  const isAlphaNumeric = /^[a-zA-Z0-9]$/.test(rawKey);
  const hasCtrlCmdAlt = mods.ctrl || mods.cmd || mods.alt;
  const key = rawKey === ' ' || rawKey === 'Space' ? 'Space' : isAlphaNumeric ? rawKey.toUpperCase() : rawKey;

  if (!hasCtrlCmdAlt) {
    // No Ctrl/Cmd/Alt: shift-agnostic for letters/digits; a bare symbol already encodes shift
    // in which character it is — see the module doc.
    return key;
  }
  const prefixes: string[] = [];
  if (mods.ctrl) prefixes.push('Ctrl');
  if (mods.cmd) prefixes.push('Cmd');
  if (mods.alt) prefixes.push('Alt');
  if (mods.shift) prefixes.push('Shift');
  return [...prefixes, key].join('+');
}

function stepFromEvent(e: KeyboardEvent): string {
  return canonicalStep(e.key, { ctrl: e.ctrlKey, cmd: e.metaKey, alt: e.altKey, shift: e.shiftKey });
}

const MODIFIER_NAMES = new Set(['Mod', 'Ctrl', 'Cmd', 'Alt', 'Shift']);

function canonicalizeBindingStep(step: string, isMac: boolean): string {
  // '+' is both the modifier separator and a valid key in its own right (the zoom-in binding).
  // A bare '+' can't be split on '+' the normal way — splitting it yields two empty strings,
  // not a one-element key array — so it needs its own case rather than falling through.
  if (step === '+') {
    return canonicalStep('+', { ctrl: false, cmd: false, alt: false, shift: false });
  }
  const parts = step.split('+');
  const rawKey = parts[parts.length - 1]!;
  const modParts = parts.slice(0, -1);
  const mods: { ctrl: boolean; cmd: boolean; alt: boolean; shift: boolean } = {
    ctrl: false,
    cmd: false,
    alt: false,
    shift: false,
  };
  for (const m of modParts) {
    if (!MODIFIER_NAMES.has(m)) {
      throw new RangeError(`unknown modifier "${m}" in binding step "${step}"`);
    }
    if (m === 'Mod') {
      if (isMac) mods.cmd = true;
      else mods.ctrl = true;
    } else if (m === 'Ctrl') mods.ctrl = true;
    else if (m === 'Cmd') mods.cmd = true;
    else if (m === 'Alt') mods.alt = true;
    else if (m === 'Shift') mods.shift = true;
  }
  return canonicalStep(rawKey, mods);
}

/** Splits a chord binding (`'g g'`) into its canonicalised steps; a non-chord binding has exactly one. */
export function canonicalizeBinding(binding: string, isMac: boolean): readonly string[] {
  return binding
    .trim()
    .split(/\s+/)
    .map((step) => canonicalizeBindingStep(step, isMac));
}

export interface KeymapEntry<A = unknown> {
  readonly binding: string;
  readonly commandId: string;
  readonly arg?: A;
}

interface ResolvedEntry {
  readonly binding: string;
  readonly commandId: string;
  readonly arg?: unknown;
}

export class Keymap {
  private readonly entries = new Map<string, ResolvedEntry>();
  private readonly isMac: boolean;

  constructor(isMac: Platform = SYSTEM_IS_MAC) {
    this.isMac = isMac();
  }

  /**
   * Registers a binding. Throws if its canonical form collides with an already-registered one
   * — "conflicts are detected at registration and reported", not silently last-write-wins.
   */
  register<A>(entry: KeymapEntry<A>): void {
    const steps = canonicalizeBinding(entry.binding, this.isMac);
    const key = steps.join(' ');
    const existing = this.entries.get(key);
    if (existing) {
      throw new Error(
        `keybinding conflict: "${entry.binding}" (${entry.commandId}) collides with the ` +
          `already-registered "${existing.binding}" (${existing.commandId})`,
      );
    }
    this.entries.set(key, { binding: entry.binding, commandId: entry.commandId, arg: entry.arg });
  }

  /** The registered entry whose full canonical steps exactly equal `steps`, if any. */
  match(steps: readonly string[]): ResolvedEntry | undefined {
    return this.entries.get(steps.join(' '));
  }

  /** Whether `steps` is a (possibly complete) prefix of any registered binding's steps. */
  hasPrefix(steps: readonly string[]): boolean {
    const prefix = steps.join(' ');
    for (const key of this.entries.keys()) {
      if (key === prefix || key.startsWith(`${prefix} `)) return true;
    }
    return false;
  }

  list(): readonly ResolvedEntry[] {
    return [...this.entries.values()];
  }
}

export interface KeymapTarget {
  addEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void): void;
}

function defaultIsTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') {
    const nonTextTypes = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);
    return !nonTextTypes.has((target as HTMLInputElement).type);
  }
  return target.isContentEditable;
}

export interface AttachKeymapOptions {
  readonly timers?: Timers;
  /** Defaults to excluding `<textarea>`, text-type `<input>`s, and `contenteditable` elements. */
  readonly isTextInput?: (target: EventTarget | null) => boolean;
}

export interface KeymapController {
  /** The chord steps matched so far while a multi-step binding is pending; `[]` when idle. For a future "pending chord" UI indicator. */
  readonly pendingChordSteps: readonly string[];
  dispose(): void;
}

/** Attaches `keymap` to `target`'s keydown events, dispatching matches through `bus`. */
export function attachKeymap(
  keymap: Keymap,
  target: KeymapTarget,
  bus: CommandBus,
  options: AttachKeymapOptions = {},
): KeymapController {
  const timers = options.timers ?? REAL_TIMERS;
  const isTextInput = options.isTextInput ?? defaultIsTextInput;

  let pending: string[] = [];
  let timeoutHandle: number | null = null;

  function clearPending(): void {
    pending = [];
    if (timeoutHandle !== null) {
      timers.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function startPending(steps: string[]): void {
    pending = steps;
    if (timeoutHandle !== null) timers.clearTimeout(timeoutHandle);
    timeoutHandle = timers.setTimeout(clearPending, CHORD_TIMEOUT_MS);
  }

  /** Tries to resolve `steps` (exact match, then prefix-continuation). Returns whether it consumed the event. */
  function tryDispatch(steps: string[], e: KeyboardEvent): boolean {
    const exact = keymap.match(steps);
    if (exact) {
      e.preventDefault();
      clearPending();
      void bus.run(exact.commandId, exact.arg);
      return true;
    }
    if (keymap.hasPrefix(steps)) {
      e.preventDefault();
      startPending(steps);
      return true;
    }
    return false;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isTextInput(e.target)) return;
    const step = stepFromEvent(e);

    if (pending.length > 0) {
      if (tryDispatch([...pending, step], e)) return;
      // The chord didn't continue — drop it and re-evaluate this key as a fresh first step,
      // rather than swallowing it silently.
      clearPending();
    }
    tryDispatch([step], e);
  }

  target.addEventListener('keydown', onKeyDown);

  return {
    get pendingChordSteps() {
      return pending;
    },
    dispose(): void {
      clearPending();
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
