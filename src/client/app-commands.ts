/**
 * View/edit commands the composition root registers (P2-G-1). Dependencies are injected so
 * this file never touches `window` or a live worker.
 */
import type { PaintOp, Rect } from '@shared/types';
import type { Camera } from '@ui/camera';
import type { AppCommand } from '@ui/commands/registry';

export interface ViewEditCommandDeps {
  readonly camera: Camera;
  readonly fitRect: Rect;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  readonly undo: () => readonly PaintOp[] | null | undefined;
  readonly redo: () => readonly PaintOp[] | null | undefined;
  readonly commitPaint: (ops: readonly PaintOp[], record?: boolean) => void;
  readonly copy: () => void;
  readonly cut: () => readonly PaintOp[];
  readonly paste: () => void;
  readonly setBrushSize: (size: number) => void;
  readonly save: () => void;
  readonly cheatsheet: () => void;
}

export function createViewEditCommands(deps: ViewEditCommandDeps): readonly AppCommand<number | void>[] {
  return [
    {
      id: 'view.zoomIn',
      title: 'Zoom in',
      category: 'View',
      defaultBinding: '+',
      run: () => deps.camera.zoomAt(deps.camera.widthPx / 2, deps.camera.heightPx / 2, 1.1),
    },
    {
      id: 'view.zoomOut',
      title: 'Zoom out',
      category: 'View',
      defaultBinding: '-',
      run: () => deps.camera.zoomAt(deps.camera.widthPx / 2, deps.camera.heightPx / 2, 1 / 1.1),
    },
    {
      id: 'view.zoomToFit',
      title: 'Zoom to fit',
      category: 'View',
      defaultBinding: '0',
      run: () => deps.camera.fitTo(deps.fitRect, 40),
    },
    {
      id: 'edit.undo',
      title: 'Undo',
      category: 'Edit',
      defaultBinding: 'Mod+Z',
      isEnabled: () => deps.canUndo(),
      run: () => {
        const ops = deps.undo();
        if (ops) deps.commitPaint(ops, false);
      },
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      category: 'Edit',
      defaultBinding: 'Mod+Shift+Z',
      isEnabled: () => deps.canRedo(),
      run: () => {
        const ops = deps.redo();
        if (ops) deps.commitPaint(ops, false);
      },
    },
    {
      id: 'edit.copy',
      title: 'Copy',
      category: 'Edit',
      defaultBinding: 'Mod+C',
      run: () => deps.copy(),
    },
    {
      id: 'edit.cut',
      title: 'Cut',
      category: 'Edit',
      defaultBinding: 'Mod+X',
      run: () => deps.commitPaint(deps.cut()),
    },
    {
      id: 'edit.paste',
      title: 'Paste',
      category: 'Edit',
      defaultBinding: 'Mod+V',
      run: () => deps.paste(),
    },
    {
      id: 'session.save',
      title: 'Save session',
      category: 'Edit',
      defaultBinding: 'Mod+S',
      run: () => deps.save(),
    },
    {
      id: 'brush.setSize',
      title: 'Set brush size',
      category: 'Tools',
      defaultBinding: '1',
      run: (_ctx, arg) => {
        deps.setBrushSize(typeof arg === 'number' ? arg : 1);
      },
    },
    {
      id: 'help.cheatsheet',
      title: 'Shortcut cheat sheet',
      category: 'Help',
      defaultBinding: '?',
      run: () => deps.cheatsheet(),
    },
  ];
}
