import { describe, expect, it } from 'vitest';
import { Camera } from '@ui/camera';
import { createViewEditCommands } from '@client/app-commands';
import { WIDE_SHOT_RECT } from '@client/demo-seed';

describe('createViewEditCommands', () => {
  it('zooms, undoes, and saves through injected deps — never a live worker', () => {
    const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 8, originX: 0, originY: 0 });
    const before = camera.cellSize;
    const paints: unknown[] = [];
    let saved = false;
    const cmds = createViewEditCommands({
      camera,
      fitRect: WIDE_SHOT_RECT,
      canUndo: () => true,
      canRedo: () => false,
      undo: () => [{ x: 1, y: 1, state: 0 }],
      redo: () => null,
      commitPaint: (ops) => {
        paints.push(ops);
      },
      copy: () => {},
      cut: () => [],
      paste: () => {},
      setBrushSize: () => {},
      save: () => {
        saved = true;
      },
      cheatsheet: () => {},
    });
    const byId = Object.fromEntries(cmds.map((c) => [c.id, c]));
    const ctx = { toolRegistry: { active: null } } as never;
    void byId['view.zoomIn']!.run(ctx, undefined);
    expect(camera.cellSize).toBeGreaterThan(before);
    void byId['view.zoomOut']!.run(ctx, undefined);
    void byId['view.zoomToFit']!.run(ctx, undefined);
    void byId['edit.undo']!.run(ctx, undefined);
    expect(paints).toHaveLength(1);
    void byId['edit.redo']!.run(ctx, undefined);
    expect(paints).toHaveLength(1);
    void byId['edit.copy']!.run(ctx, undefined);
    void byId['edit.cut']!.run(ctx, undefined);
    expect(paints).toHaveLength(2);
    void byId['edit.paste']!.run(ctx, undefined);
    void byId['brush.setSize']!.run(ctx, 3);
    void byId['brush.setSize']!.run(ctx, undefined);
    void byId['session.save']!.run(ctx, undefined);
    expect(saved).toBe(true);
    void byId['help.cheatsheet']!.run(ctx, undefined);
    expect(byId['edit.undo']!.isEnabled?.(ctx)).toBe(true);
    expect(byId['edit.redo']!.isEnabled?.(ctx)).toBe(false);
    expect(cmds.map((c) => c.id)).toContain('help.cheatsheet');
  });

  it('skips commit when undo is empty and applies redo when present', () => {
    const camera = new Camera({ widthPx: 800, heightPx: 600, cellSize: 8, originX: 0, originY: 0 });
    const paints: unknown[] = [];
    const cmds = createViewEditCommands({
      camera,
      fitRect: WIDE_SHOT_RECT,
      canUndo: () => false,
      canRedo: () => true,
      undo: () => null,
      redo: () => [{ x: 2, y: 2, state: 1 }],
      commitPaint: (ops) => {
        paints.push(ops);
      },
      copy: () => {},
      cut: () => [],
      paste: () => {},
      setBrushSize: () => {},
      save: () => {},
      cheatsheet: () => {},
    });
    const byId = Object.fromEntries(cmds.map((c) => [c.id, c]));
    const ctx = { toolRegistry: { active: null } } as never;
    void byId['edit.undo']!.run(ctx, undefined);
    expect(paints).toHaveLength(0);
    void byId['edit.redo']!.run(ctx, undefined);
    expect(paints).toHaveLength(1);
  });
});
