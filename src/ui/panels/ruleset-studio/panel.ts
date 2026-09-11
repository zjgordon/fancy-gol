/**
 * Ruleset Studio (P2-E-1, P2-E-2). "Rule-God Status." A G-2 panel that hosts
 * the form builder and the hand-written JSON editor — this file only mounts
 * content; it does not invent a second dock.
 *
 * Validation is injected: `ui/` cannot import `@engine`, so the composition root
 * passes `validateRuleSet` (and the apply path that talks to the worker).
 */
import type { PanelSpec } from '@ui/shell/panel-host';
import {
  createJsonEditor,
  STUDIO_VALIDATE_DELAY_MS,
  type EditorTimers,
  type JsonEditor,
} from './editor';
import { createStudioForm, type StudioForm } from './form';
import { locatePointer, syntaxErrorLocation } from './json-pointer';
import {
  documentFromUnknown,
  emptyLifeDocument,
  formatNotation,
  mergeDocument,
  type StudioDocument,
} from './model';
import type { LocatedStudioIssue, StudioIssue, StudioValidate } from './types';

export const STUDIO_PANEL_ID = 'studio';
export const STUDIO_PANEL_MIN_WIDTH = 400;

export { STUDIO_VALIDATE_DELAY_MS };

export interface RulesetStudioOptions {
  readonly initialText?: string;
  readonly validate: StudioValidate;
  readonly onApply?: (value: unknown, opts: { reset: boolean }) => void | Promise<void>;
  readonly validateDelayMs?: number;
  readonly timers?: EditorTimers;
  readonly lineHeightPx?: () => number;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
}

export interface RulesetStudioPanel {
  readonly spec: PanelSpec;
  readonly root: HTMLElement;
  readonly editor: JsonEditor;
  readonly form: StudioForm;
  getText(): string;
  setText(text: string): void;
  setDocument(value: unknown): void;
  isValid(): boolean;
  getParsed(): unknown;
  getFormDocument(): StudioDocument;
  getResetOnApply(): boolean;
  setResetOnApply(reset: boolean): void;
  locateIssues(): readonly LocatedStudioIssue[];
  dispose(): void;
}

export function prettyRuleset(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Live B/S badge from the parsed transition — the engine reads these arrays, not a label. */
export function lifeNotationFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const transition = (value as { transition?: unknown }).transition;
  if (typeof transition !== 'object' || transition === null) return null;
  const t = transition as { born?: unknown; survive?: unknown };
  if (!Array.isArray(t.born) || !Array.isArray(t.survive)) return null;
  if (!t.born.every((n) => typeof n === 'number') || !t.survive.every((n) => typeof n === 'number')) return null;
  const born = [...t.born].sort((a, b) => a - b).join('');
  const survive = [...t.survive].sort((a, b) => a - b).join('');
  return `B${born}/S${survive}`;
}

function locateIssues(text: string, issues: readonly StudioIssue[]): LocatedStudioIssue[] {
  return issues.map((issue) => {
    const loc = locatePointer(text, issue.path) ?? { offset: 0, line: 1, column: 1 };
    return { ...issue, line: loc.line, column: loc.column };
  });
}

export function createRulesetStudioPanel(opts: RulesetStudioOptions): RulesetStudioPanel {
  let parsed: unknown = null;
  let valid = false;
  let applying = false;
  let syncingFromForm = false;

  const root = document.createElement('div');
  root.className = 'studio-panel';

  const toolbar = document.createElement('div');
  toolbar.className = 'studio-toolbar';

  const badge = document.createElement('p');
  badge.className = 'studio-badge';
  badge.textContent = '—';

  const status = document.createElement('p');
  status.className = 'studio-status';
  status.setAttribute('aria-live', 'polite');
  status.id = 'studio-status';

  const resetLabel = document.createElement('label');
  resetLabel.className = 'studio-reset';
  const reset = document.createElement('input');
  reset.type = 'checkbox';
  reset.id = 'studio-reset-on-apply';
  const resetText = document.createElement('span');
  resetText.textContent = 'Reset grid on apply';
  resetLabel.append(reset, resetText);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'studio-apply';
  applyBtn.textContent = 'Apply';
  applyBtn.disabled = true;

  toolbar.append(badge, resetLabel, applyBtn);

  const issueList = document.createElement('ul');
  issueList.className = 'studio-issue-list';
  issueList.id = 'studio-issues';
  issueList.setAttribute('aria-label', 'Validation issues');

  const editor = createJsonEditor({
    value: opts.initialText ?? '',
    validateDelayMs: opts.validateDelayMs ?? STUDIO_VALIDATE_DELAY_MS,
    ...(opts.timers ? { timers: opts.timers } : {}),
    ...(opts.lineHeightPx ? { lineHeightPx: opts.lineHeightPx } : {}),
    onIdle: (text) => validateText(text),
  });
  editor.textarea.setAttribute('aria-describedby', 'studio-status studio-issues');

  let startingDoc = emptyLifeDocument();
  try {
    startingDoc = documentFromUnknown(JSON.parse(opts.initialText ?? '')) ?? startingDoc;
  } catch {
    // Empty or invalid JSON — the form still opens on Conway so a child has chips to press.
  }

  const form = createStudioForm({
    document: startingDoc,
    onChange: (doc) => {
      syncingFromForm = true;
      const merged = mergeDocument(parsed ?? doc, doc);
      editor.setValue(prettyRuleset(merged), { emitIdle: false });
      validateText(editor.getValue());
      syncingFromForm = false;
    },
  });

  root.append(toolbar, status, form.root, editor.root, issueList);

  function paintIssues(located: readonly LocatedStudioIssue[]): void {
    editor.setIssues(located);
    issueList.replaceChildren();
    for (const issue of located) {
      const li = document.createElement('li');
      li.className = 'studio-issue';
      const where = document.createElement('span');
      where.className = 'studio-issue-line';
      where.textContent = `Line ${String(issue.line)}`;
      const msg = document.createElement('span');
      msg.className = 'studio-issue-msg';
      msg.textContent = issue.hint ? `${issue.message} — ${issue.hint}` : issue.message;
      li.append(where, msg);
      issueList.appendChild(li);
    }
  }

  function validateText(text: string): LocatedStudioIssue[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      parsed = null;
      valid = false;
      badge.textContent = '—';
      status.textContent = 'The editor is empty.';
      applyBtn.disabled = true;
      paintIssues([]);
      return [];
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const loc = syntaxErrorLocation(text, error);
      const hint = error instanceof Error ? error.message : String(error);
      const located: LocatedStudioIssue[] = [
        { path: '', message: 'JSON syntax error', hint, line: loc.line, column: loc.column },
      ];
      parsed = null;
      valid = false;
      badge.textContent = '—';
      status.textContent = `1 issue — line ${String(loc.line)}`;
      applyBtn.disabled = true;
      paintIssues(located);
      return located;
    }
    const result = opts.validate(value);
    if (result.ok) {
      parsed = result.value;
      valid = true;
      const formDoc = documentFromUnknown(result.value);
      badge.textContent = formDoc ? formatNotation(formDoc) : (lifeNotationFrom(result.value) ?? 'Valid rule');
      status.textContent = 'Ready to apply — the grid will keep running.';
      applyBtn.disabled = applying;
      paintIssues([]);
      if (formDoc && !syncingFromForm) form.setDocument(formDoc);
      return [];
    }
    const located = locateIssues(text, result.issues);
    parsed = null;
    valid = false;
    badge.textContent = lifeNotationFrom(value) ?? '—';
    status.textContent =
      located.length === 1 ? '1 issue' : `${String(located.length)} issues`;
    applyBtn.disabled = true;
    paintIssues(located);
    return located;
  }

  applyBtn.addEventListener('click', () => {
    const located = validateText(editor.getValue());
    if (located.length > 0 || parsed === null || !valid) return;
    applying = true;
    applyBtn.disabled = true;
    const done = Promise.resolve(opts.onApply?.(parsed, { reset: reset.checked }));
    void done.finally(() => {
      applying = false;
      applyBtn.disabled = !valid;
    });
  });

  validateText(editor.getValue());

  const spec: PanelSpec = {
    id: STUDIO_PANEL_ID,
    title: 'Ruleset Studio',
    minWidthPx: STUDIO_PANEL_MIN_WIDTH,
    mount(body) {
      body.appendChild(root);
      editor.paint();
      opts.onOpen?.();
    },
    unmount() {
      root.remove();
      opts.onClose?.();
    },
  };

  return {
    spec,
    root,
    editor,
    form,
    getText: () => editor.getValue(),
    setText(text) {
      editor.setValue(text);
    },
    setDocument(value) {
      editor.setValue(prettyRuleset(value));
    },
    isValid: () => valid,
    getParsed: () => parsed,
    getFormDocument: () => form.getDocument(),
    getResetOnApply: () => reset.checked,
    setResetOnApply(next) {
      reset.checked = next;
    },
    locateIssues: () => editor.getIssues(),
    dispose() {
      form.dispose();
      editor.dispose();
      root.remove();
    },
  };
}
