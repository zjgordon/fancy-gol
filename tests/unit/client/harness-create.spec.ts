import { describe, expect, it } from 'vitest';
import { createHarness } from '@client/harness';

describe('createHarness', () => {
  it('exposes live getters, not a snapshot', () => {
    let tick = 4;
    const harness = createHarness({
      ready: () => true,
      tick: () => tick,
      population: () => 10,
      running: () => false,
      targetTps: () => 30,
      cellSize: () => 8,
      originX: () => 0,
      originY: () => 0,
      widthPx: () => 100,
      heightPx: () => 80,
      activeToolId: () => 'brush',
      rulesetId: () => 'conway',
      themeId: () => 'default',
      brushSize: () => 1,
      canUndo: () => false,
      canRedo: () => false,
      lastCommands: () => ['sim.step'],
      liveState: () => null,
      liveMessageCount: () => 0,
      lastShareUrl: () => null,
      getCell: () => 1,
      worldToScreen: () => ({ px: 0, py: 0 }),
      screenToWorld: () => ({ x: 0, y: 0 }),
      setCamera: () => {},
      runCommand: () => {},
    });
    expect(harness.ready).toBe(true);
    expect(harness.tick).toBe(4);
    tick = 9;
    expect(harness.tick).toBe(9);
    expect(harness.population).toBe(10);
    expect(harness.running).toBe(false);
    expect(harness.targetTps).toBe(30);
    expect(harness.cellSize).toBe(8);
    expect(harness.originX).toBe(0);
    expect(harness.originY).toBe(0);
    expect(harness.widthPx).toBe(100);
    expect(harness.heightPx).toBe(80);
    expect(harness.activeToolId).toBe('brush');
    expect(harness.rulesetId).toBe('conway');
    expect(harness.themeId).toBe('default');
    expect(harness.brushSize).toBe(1);
    expect(harness.canUndo).toBe(false);
    expect(harness.canRedo).toBe(false);
    expect(harness.lastCommands).toEqual(['sim.step']);
    expect(harness.liveState).toBeNull();
    expect(harness.liveMessageCount).toBe(0);
    expect(harness.lastShareUrl).toBeNull();
    expect(harness.getCell(0, 0)).toBe(1);
    expect(harness.worldToScreen(0, 0)).toEqual({ px: 0, py: 0 });
    expect(harness.screenToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    harness.setCamera({});
    void harness.runCommand('sim.step');
  });
});
