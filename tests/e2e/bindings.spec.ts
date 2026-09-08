import { expect, test, type Page } from '@playwright/test';
import { PHASE_1_BINDINGS } from '../../src/ui/input/bindings';
import { clickWorld, confirmClear, dismissDialog, gotoApp, lastCommands, viewportCenterCell, waitForCell } from './helpers';

function playwrightKey(binding: string): string {
  if (binding === 'Space') return 'Space';
  return binding.replace(/^Mod\+/, 'ControlOrMeta+');
}

/** Install once: stop browser chrome from eating Ctrl+S / Ctrl+Z before our keymap. */
async function ensureModGuard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __fancyGolModGuard?: boolean };
    if (w.__fancyGolModGuard) return;
    w.__fancyGolModGuard = true;
    // Capture phase so we mark the event before WebKit's default Save/Undo handling.
    // Other listeners (including attachKeymap) still run — preventDefault does not stop them.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === 's' || k === 'z') e.preventDefault();
      },
      true,
    );
  });
}

/**
 * Fire a binding the way a real keydown looks to `attachKeymap` (it matches `event.key`).
 * Mod chords use Playwright's trusted keyboard API — WebKit ignores ctrlKey/metaKey on
 * synthetic `new KeyboardEvent(...)` (untrusted), so page.evaluate dispatch never matches
 * `Mod+…` there. A capture-phase guard blocks browser Save/Undo chrome from swallowing them.
 */
async function pressBinding(page: Page, binding: string): Promise<void> {
  if (binding === '+' || binding === '?') {
    // Playwright has no portable physical key for `+`/`?` across layouts. The keymap
    // canonicalises on `event.key`, so synthesize that (no modifiers — WebKit-safe).
    await page.evaluate((key) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }, binding);
    return;
  }
  if (binding.startsWith('Mod+')) {
    await ensureModGuard(page);
    const shift = binding.includes('Shift+');
    const raw = binding.slice(binding.lastIndexOf('+') + 1);
    const key = raw.length === 1 ? raw.toLowerCase() : raw;
    await page.keyboard.down('Control');
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.press(key);
    if (shift) await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    return;
  }
  await page.keyboard.press(playwrightKey(binding));
}

test.describe('Phase 1 keybindings', () => {
  test('every PHASE_1_BINDINGS entry fires its command in a real browser', async ({ page }) => {
    await gotoApp(page);
    await confirmClear(page);
    await page.keyboard.press('b');

    const cell = await viewportCenterCell(page);
    await clickWorld(page, cell.x, cell.y);
    await waitForCell(page, cell.x, cell.y, 1);

    // Undo/redo must fire while the edit stack still has the paint — later sim.clear /
    // reset / soup would disable them and bus.run would no-op without recording.
    await pressBinding(page, 'Mod+Z');
    await pressBinding(page, 'Mod+Shift+Z');

    const seen = new Set<string>();
    for (const entry of PHASE_1_BINDINGS) {
      if (entry.commandId === 'sim.toggleRun') continue;
      if (entry.commandId === 'edit.undo' || entry.commandId === 'edit.redo') continue;
      await pressBinding(page, entry.binding);
      if (entry.commandId === 'sim.clear' || entry.commandId === 'help.cheatsheet') {
        await dismissDialog(page);
      }
      seen.add(entry.commandId);
    }

    await page.keyboard.press('Space');

    const commands = await lastCommands(page);
    const fired = new Set(commands);
    for (const entry of PHASE_1_BINDINGS) {
      expect(fired, `binding ${entry.binding} → ${entry.commandId}`).toContain(entry.commandId);
    }
    expect(seen.size).toBeGreaterThan(0);

    await page.keyboard.press('5');
    expect(await page.evaluate(() => window.__fancyGol?.brushSize)).toBe(5);
  });
});
