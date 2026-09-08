import { expect, test, type Page } from '@playwright/test';
import { PHASE_1_BINDINGS } from '../../src/ui/input/bindings';
import { clickWorld, confirmClear, dismissDialog, gotoApp, lastCommands, viewportCenterCell, waitForCell } from './helpers';

function playwrightKey(binding: string): string {
  if (binding === 'Space') return 'Space';
  return binding.replace(/^Mod\+/, 'ControlOrMeta+');
}

/** Fire a binding the way a real keydown looks to `attachKeymap` (it matches `event.key`). */
async function pressBinding(page: Page, binding: string): Promise<void> {
  if (binding === '+' || binding === '?') {
    // Playwright has no portable physical key for `+`/`?` across layouts. The keymap
    // canonicalises on `event.key`, so synthesize that.
    await page.evaluate((key) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }, binding);
    return;
  }
  if (binding === 'Mod+S' || binding === 'Mod+Z' || binding === 'Mod+Shift+Z') {
    // WebKit on Linux CI intercepts the real ControlOrMeta chords (Save / Undo / Redo).
    // Synthesize a cancelable keydown the keymap still matches, without the browser chrome.
    const shift = binding.includes('Shift');
    const key = binding.endsWith('+Z') || binding.endsWith('Z') ? (shift ? 'Z' : 'z') : 's';
    await page.evaluate(
      ({ k, sh }) => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: k,
            code: k.toUpperCase() === 'S' ? 'KeyS' : 'KeyZ',
            ctrlKey: true,
            metaKey: true,
            shiftKey: sh,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { k: key, sh: shift },
    );
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

    await pressBinding(page, 'Mod+Z');
    await pressBinding(page, 'Mod+Shift+Z');
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
