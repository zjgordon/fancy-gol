import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { CommandBus } from '@ui/commands/bus';
import { CommandRegistry, type AppCommand, type AppContext } from '@ui/commands/registry';
import { attachKeymap, Keymap } from '@ui/input/keymap';
import { ToolRegistry } from '@ui/tools/registry';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import {
  createRulesetStudioPanel,
  lifeNotationFrom,
  prettyRuleset,
  STUDIO_PANEL_ID,
  STUDIO_PANEL_MIN_WIDTH,
} from '@ui/panels/ruleset-studio/panel';
import { attachPanelHost } from '@ui/shell/panel-host';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

const CONWAY_TEXT = readFileSync(join(process.cwd(), 'tests/fixtures/rules/valid/conway.json'), 'utf8');

function validate(value: unknown) {
  try {
    return { ok: true as const, value: validateRuleSet(value) };
  } catch (error) {
    if (error instanceof RuleValidationError) return { ok: false as const, issues: error.issues };
    throw error;
  }
}

function cmd(id: string, run: (ctx: AppContext) => void): AppCommand {
  return { id, title: id, category: 'Edit', noBinding: true, run };
}

describe('createRulesetStudioPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup(text = CONWAY_TEXT) {
    const onApply = vi.fn();
    const panel = createRulesetStudioPanel({
      initialText: text,
      validate,
      onApply,
      validateDelayMs: 0,
      lineHeightPx: () => 16,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1200 });
    host.register(panel.spec);
    host.open(STUDIO_PANEL_ID);
    return { panel, host, onApply };
  }

  it('edits B3/S23 to B36/S23 and applies without resetting the grid', () => {
    const { panel, host, onApply } = setup();
    expect(lifeNotationFrom(panel.getParsed())).toBe('B3/S23');
    const next = CONWAY_TEXT.replace('"born": [3]', '"born": [3, 6]');
    panel.setText(next);
    expect(panel.isValid()).toBe(true);
    expect(lifeNotationFrom(panel.getParsed())).toBe('B36/S23');
    expect(panel.root.querySelector('.studio-badge')?.textContent).toBe('B36/S23');
    expect(panel.getResetOnApply()).toBe(false);
    const applied = panel.getParsed();
    panel.root.querySelector<HTMLButtonElement>('.studio-apply')!.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(applied, { reset: false });
    panel.dispose();
    host.dispose();
  });

  it('renders every validator issue on its line with the hint', () => {
    const { panel, host } = setup();
    const broken = `{
  "version": 1,
  "id": "conway",
  "name": "Conway",
  "states": [
    { "id": 0, "name": "dead", "kind": "dead", "countsAsAlive": false },
    { "id": 1, "name": "alive", "kind": "live", "countsAsAlive": true }
  ],
  "neighborhood": { "kind": "moore", "radius": 1 },
  "transition": {
    "kind": "totalistic",
    "born": [
      9,
      10
    ],
    "survive": [2, 3]
  },
  "boundary": "toroidal"
}`;
    panel.setText(broken);
    const issues = panel.locateIssues();
    expect(issues.length).toBeGreaterThanOrEqual(2);
    for (const issue of issues) {
      expect(issue.line).toBeGreaterThan(0);
      const lineText = panel.getText().split('\n')[issue.line - 1] ?? '';
      if (issue.path.endsWith('/born/0')) expect(lineText).toContain('9');
      if (issue.path.endsWith('/born/1')) expect(lineText).toContain('10');
      expect(issue.hint ?? issue.message).toBeTruthy();
      expect(panel.root.textContent).toContain(issue.hint ?? issue.message);
    }
    const errLines = panel.root.querySelectorAll('.studio-gutter-err');
    expect(errLines.length).toBeGreaterThanOrEqual(2);
    expect(panel.root.querySelectorAll('.studio-hint').length).toBeGreaterThanOrEqual(2);
    panel.dispose();
    host.dispose();
  });

  it('handles a 2,000-line ruleset without input lag (> 55 fps while typing)', () => {
    const keys = Array.from({ length: 1996 }, (_, i) => `  "k${String(i)}": ${String(i)},`);
    const fat = `{\n  "pad": {\n${keys.join('\n')}\n    "tail": 0\n  }\n}`;
    expect(fat.split('\n').length).toBeGreaterThanOrEqual(2000);
    const panel = createRulesetStudioPanel({
      initialText: fat,
      validate,
      validateDelayMs: 60_000,
      lineHeightPx: () => 16,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1200 });
    host.register(panel.spec);
    host.open(STUDIO_PANEL_ID);
    const textarea = panel.editor.textarea;
    Object.defineProperty(textarea, 'clientHeight', { value: 320, configurable: true });
    textarea.scrollTop = 800;
    panel.editor.paint();
    textarea.value = fat.replace('"tail": 0', '"tail": 1');
    const t0 = performance.now();
    textarea.dispatchEvent(new Event('input'));
    const elapsed = performance.now() - t0;
    const painted = panel.root.querySelectorAll('.studio-gutter-line').length;
    expect(painted).toBeLessThan(40);
    if (!UNDER_COVERAGE) expect(elapsed).toBeLessThan(1000 / 55);
    panel.dispose();
    host.dispose();
  });

  it('Mod+Z in the editor undoes text, not grid edits', () => {
    const undo = vi.fn();
    const registry = new CommandRegistry();
    registry.register(cmd('edit.undo', undo));
    const bus = new CommandBus(registry, { toolRegistry: new ToolRegistry() });
    const keymap = new Keymap(() => false);
    keymap.register({ binding: 'Mod+Z', commandId: 'edit.undo' });
    const { panel, host } = setup();
    attachKeymap(keymap, window, bus);
    const textarea = panel.editor.textarea;
    textarea.focus();
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(undo).not.toHaveBeenCalled();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(undo).toHaveBeenCalledTimes(1);
    panel.dispose();
    host.dispose();
  });

  it('has zero axe-core violations on the panel root', async () => {
    const { panel, host } = setup();
    expect((await axe.run(panel.root)).violations).toEqual([]);
    panel.dispose();
    host.dispose();
  });

  it('declares a usable minimum width and pretty-prints a document', () => {
    const { panel, host } = setup();
    expect(STUDIO_PANEL_MIN_WIDTH).toBeGreaterThanOrEqual(360);
    panel.setDocument(JSON.parse(CONWAY_TEXT));
    expect(panel.getText()).toBe(prettyRuleset(JSON.parse(CONWAY_TEXT)));
    panel.setResetOnApply(true);
    expect(panel.getResetOnApply()).toBe(true);
    panel.dispose();
    host.dispose();
  });
});
