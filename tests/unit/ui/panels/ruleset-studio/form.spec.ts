import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileNeighborhood } from '@engine/neighborhood';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import {
  createRulesetStudioPanel,
  prettyRuleset,
  STUDIO_PANEL_ID,
} from '@ui/panels/ruleset-studio/panel';
import {
  applyBornSurvive,
  documentFromUnknown,
  emptyLifeDocument,
  formatNotation,
  mergeDocument,
  mulberry32,
  viewsAgree,
} from '@ui/panels/ruleset-studio/model';
import { offsetsFor, unpackCompiled } from '@ui/panels/ruleset-studio/offsets';
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

describe('studio form sync', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup(text = CONWAY_TEXT) {
    const panel = createRulesetStudioPanel({
      initialText: text,
      validate,
      validateDelayMs: 0,
      lineHeightPx: () => 16,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1200 });
    host.register(panel.spec);
    host.open(STUDIO_PANEL_ID);
    return { panel, host };
  }

  function assertConverged(panel: ReturnType<typeof createRulesetStudioPanel>): void {
    const formDoc = panel.getFormDocument();
    const json = JSON.parse(panel.getText()) as unknown;
    expect(viewsAgree(formDoc, panel.form.getNotation(), json)).toBe(true);
    const parsed = documentFromUnknown(json)!;
    expect(parsed.transition.born).toEqual([...formDoc.transition.born]);
    expect(parsed.transition.survive).toEqual([...formDoc.transition.survive]);
    expect(formatNotation(parsed)).toBe(panel.form.getNotation());
  }

  it('keeps form, notation, and JSON consistent across random edits of all three', () => {
    const { panel, host } = setup();
    const rng = mulberry32(20260911);
    const pick = (n: number): number => Math.floor(rng() * n);

    for (let i = 0; i < 40; i++) {
      const which = pick(3);
      if (which === 0) {
        const field = rng() < 0.5 ? 'born' : 'survive';
        panel.form.toggle(field, pick(9));
      } else if (which === 1) {
        const next = applyBornSurvive(panel.getFormDocument(), rng() < 0.5 ? 'born' : 'survive', [
          pick(9),
          pick(9),
        ]);
        expect(panel.form.setNotation(formatNotation(next))).toBe(true);
      } else {
        const next = applyBornSurvive(panel.getFormDocument(), 'born', [3, pick(9)]);
        panel.setText(prettyRuleset(mergeDocument(JSON.parse(panel.getText()), next)));
      }
      assertConverged(panel);
    }
    panel.dispose();
    host.dispose();
  });

  it('paints neighbourhood cells that match the compiled offset table', () => {
    const { panel, host } = setup();
    const select = panel.root.querySelector<HTMLSelectElement>('select[aria-label="Neighbourhood"]')!;
    select.value = 'hex';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const figures = [...panel.root.querySelectorAll<HTMLElement>('.studio-diagram')];
    expect(figures).toHaveLength(2);
    const compiled = compileNeighborhood({ kind: 'hex' });
    const even = figures[0]!.dataset['offsets']!.split(' ').map((p) => {
      const [dx, dy] = p.split(',').map(Number);
      return [dx, dy] as [number, number];
    });
    const odd = figures[1]!.dataset['offsets']!.split(' ').map((p) => {
      const [dx, dy] = p.split(',').map(Number);
      return [dx, dy] as [number, number];
    });
    expect(even).toEqual(unpackCompiled(compiled.offsetsByParity[0]));
    expect(odd).toEqual(unpackCompiled(compiled.offsetsByParity[1]));
    expect(even).toEqual(offsetsFor({ kind: 'hex' }, 0));

    select.value = 'moore-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const moore = compileNeighborhood({ kind: 'moore', radius: 1 });
    const painted = [...panel.root.querySelectorAll<HTMLElement>('.studio-diagram-nb')].map((el) => [
      Number(el.dataset['dx']),
      Number(el.dataset['dy']),
    ]);
    expect(painted).toEqual(unpackCompiled(moore.offsetsByParity[0]));
    panel.dispose();
    host.dispose();
  });

  it('Randomise writes a valid rule and names its temperament', () => {
    const { panel, host } = setup();
    panel.form.setConstraints({ birthDensity: 0.3, surviveDensity: 0.3, symmetry: 0.2 });
    const doc = panel.form.randomise(7);
    expect(() => validateRuleSet(mergeDocument({}, doc))).not.toThrow();
    expect(panel.isValid()).toBe(true);
    expect(panel.root.querySelector('.studio-temper')?.textContent).toMatch(/looks (explosive|chaotic|stable|maze-like)/);
    expect(emptyLifeDocument().transition.born).toEqual([3]);
    panel.dispose();
    host.dispose();
  });
});
