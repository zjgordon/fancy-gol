import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import { createRulesetStudioPanel, STUDIO_PANEL_ID } from '@ui/panels/ruleset-studio/panel';
import { attachPanelHost } from '@ui/shell/panel-host';

const CONWAY_TEXT = readFileSync(join(process.cwd(), 'tests/fixtures/rules/valid/conway.json'), 'utf8');

function validate(value: unknown) {
  try {
    return { ok: true as const, value: validateRuleSet(value) };
  } catch (error) {
    if (error instanceof RuleValidationError) return { ok: false as const, issues: error.issues };
    throw error;
  }
}

describe('studio save, share, import', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup(extras: {
    onSave?: (value: unknown) => void;
    onExport?: (value: unknown) => void;
    onShare?: (value: unknown) => void;
    readImportFile?: () => Promise<string | null>;
  } = {}) {
    const panel = createRulesetStudioPanel({
      initialText: CONWAY_TEXT,
      validate,
      validateDelayMs: 0,
      lineHeightPx: () => 16,
      ...extras,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1200 });
    host.register(panel.spec);
    host.open(STUDIO_PANEL_ID);
    return { panel, host };
  }

  it('saves, exports, and copies a share link for a valid document', () => {
    const onSave = vi.fn();
    const onExport = vi.fn();
    const onShare = vi.fn();
    const { panel, host } = setup({ onSave, onExport, onShare });
    panel.root.querySelector<HTMLButtonElement>('.studio-save')!.click();
    panel.root.querySelector<HTMLButtonElement>('.studio-export')!.click();
    panel.root.querySelector<HTMLButtonElement>('.studio-share')!.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0]?.[0] as { id: string }).id).toBe('conway');
    panel.dispose();
    host.dispose();
  });

  it('surfaces structured issues when importing a malformed file', async () => {
    const { panel, host } = setup({
      readImportFile: () => Promise.resolve('{ "version": 1, "id": "" }'),
    });
    panel.root.querySelector<HTMLButtonElement>('.studio-import')!.click();
    await vi.waitFor(() => {
      expect(panel.isValid()).toBe(false);
    });
    const issues = panel.locateIssues();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.path.includes('id') || issue.message.length > 0)).toBe(true);
    expect(panel.root.querySelector('.studio-issue')).not.toBeNull();
    panel.dispose();
    host.dispose();
  });

  it('loads imported JSON into the editor when the file is valid', async () => {
    const next = CONWAY_TEXT.replace('"id": "conway"', '"id": "highlife"').replace(
      '"born": [3]',
      '"born": [3, 6]',
    );
    const { panel, host } = setup({ readImportFile: () => Promise.resolve(next) });
    panel.root.querySelector<HTMLButtonElement>('.studio-import')!.click();
    await vi.waitFor(() => {
      expect(panel.isValid()).toBe(true);
    });
    expect((panel.getParsed() as { id: string }).id).toBe('highlife');
    panel.dispose();
    host.dispose();
  });

  it('disables Save when the editor is invalid', () => {
    const { panel, host } = setup({ onSave: vi.fn() });
    panel.setText('{');
    expect(panel.root.querySelector<HTMLButtonElement>('.studio-save')!.disabled).toBe(true);
    panel.dispose();
    host.dispose();
  });
});
