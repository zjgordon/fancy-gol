/**
 * Composition root (P1-D-1, thinned by P2-G-1). Wires camera, worker, tools, chrome,
 * session, and pickers. Testable seams live in sibling `client/*` modules — this file
 * only composes them. Panels register on the P2-G-2 host — do not invent a second layout.
 */
import { CONWAY, getBuiltin } from '@engine/rules/builtin';
import { RuleValidationError } from '@engine/rules/errors';
import { validateRuleSet } from '@engine/rules/validate';
import { Canvas2DRenderer } from '@render/canvas2d';
import type { Viewport as RenderViewport } from '@render/types';
import { decode as decodeRle } from '@shared/rle';
import { CHUNK_AREA, type PaintOp, type RuleSet } from '@shared/types';
import type { SessionDoc } from '@shared/session';
import { createBenchClient } from '@worker/bench-client';
import { WorkerClient, type FrameEvent } from '@worker/client';
import { FrameGridMirror } from '@worker/frame-view';
import { Camera, EASE_OUT_CUBIC } from '@ui/camera';
import { attachGestures } from '@ui/input/gestures';
import { attachInputRouter } from '@ui/input/router';
import { attachDefaultBindings, PHASE_1_BINDINGS } from '@ui/input/bindings';
import { attachKeymap, Keymap } from '@ui/input/keymap';
import { CommandBus } from '@ui/commands/bus';
import { EditStack } from '@ui/commands/edit-stack';
import type { AppContext, SimControl } from '@ui/commands/registry';
import { SIM_COMMANDS } from '@ui/commands/builtin/sim';
import { attachShell } from '@ui/components/shell';
import { attachPanelHost } from '@ui/shell/panel-host';
import { createTransportControls } from '@ui/components/transport';
import { createSpeedControl, TpsMeter } from '@ui/components/speed';
import { createStatusBar, STATUS_THROTTLE_MS, zoomPercent } from '@ui/components/statusbar';
import {
  attachRulesetPicker,
  defaultMigration,
  openStateMigrationDialog,
  palettesMatch,
} from '@ui/components/ruleset-picker';
import { confirmDialog, openDialog } from '@ui/components/dialog';
import { createToastRegion } from '@ui/components/toast';
import type { FillTool } from '@ui/tools/fill';
import type { Brush } from '@ui/tools/brush';
import type { SelectTool } from '@ui/tools/select';
import type { StampTool } from '@ui/tools/stamp';
import { ThemeRegistry } from '@themes/registry';
import { DEFAULT_DARK_THEME, DEFAULT_THEME } from '@themes/default/theme';
import { chartTokensFromSet } from '@ui/charts/chart';
import { createStatisticsPanel } from '@ui/panels/statistics/panel';
import { openExportDialog } from '@ui/export/dialog';
import { CHART_EXPORT_SCALE, canvasToPngBlob } from '@ui/export/png';
import { LIBRARY_DRAG_TYPE, createLibraryPanel } from '@ui/panels/library/panel';
import { createRulesetStudioPanel, prettyRuleset } from '@ui/panels/ruleset-studio/panel';
import { createAppContext } from './app-context';
import { createViewEditCommands } from './app-commands';
import { playColdStart } from './cold-start';
import {
  FRAMED_RECT,
  INTRO_CAMERA_MS,
  RUN_TPS,
  SEED,
  WIDE_SHOT_RECT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  gunOps,
  primaryLiveState,
} from './demo-seed';
import { createHarness, isTestMode, type FancyGolHarness } from './harness';
import { connectLiveViewer, type LiveConnectionState } from './live-client';
import {
  LIBRARY_OFFLINE_NOTICE,
  bundledCatalog,
  fetchPatternRle,
  loadPatternCatalog,
  stampsFromCatalog,
  type CatalogPattern,
} from './pattern-catalog';
import { builtinRulesetSummaries, userRulesetSummary } from './ruleset-summaries';
import { RulesetThumbnailLoop } from './ruleset-thumbnails';
import { resolveBootSession } from './boot-session';
import {
  buildRulesetShareLink,
  buildSessionDoc,
  buildShareLink,
  captureGridRLE,
  createAutosave,
  resolveSharedRuleset,
} from './session';
import { blobFromText, saveBlob } from '@ui/export/save';
import {
  fetchRemoteUserRulesets,
  loadUserRulesets,
  mergeUserRulesets,
  postUserRuleset,
  realUserRulesetStorage,
  upsertUserRuleset,
  withUserId,
  writeUserRulesets,
} from './user-rulesets';
import { suggestUserRulesetId } from '@shared/user-rulesets';
import { SHELL_THEME, shellPalette } from './shell-theme';
import { gateToolHandlers } from './tool-gate';
import { toWorkerLike } from './worker-adapter';

const bootStart = performance.now();
declare global {
  interface Window {
    __fancyGolFirstFrameMs?: number;
    __fancyGol?: FancyGolHarness;
  }
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`client shell: missing required element "${selector}"`);
  return el;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function main(): void {
  const testMode = isTestMode();
  const canvas = requireElement<HTMLCanvasElement>('#scene');

  const shell = attachShell({
    root: document,
    ...(testMode ? { reducedMotion: () => true } : {}),
  });

  const renderer = new Canvas2DRenderer();
  const mirror = new FrameGridMirror();
  const client = new WorkerClient({
    spawn: () => toWorkerLike(new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' })),
  });

  const camera = new Camera({ widthPx: window.innerWidth, heightPx: window.innerHeight });
  camera.fitTo(WIDE_SHOT_RECT, 40);
  const framedTarget = (() => {
    const scratch = new Camera({ widthPx: camera.widthPx, heightPx: camera.heightPx });
    scratch.fitTo(FRAMED_RECT, 24);
    return { originX: scratch.originX, originY: scratch.originY, cellSize: scratch.cellSize };
  })();

  let hasFrame = false;
  let lastTick = 0;
  let lastPopulation = 0;
  let lastBirths = 0;
  let lastDeaths = 0;
  let lastTransitions = 0;
  let lastActivity = 0;
  let lastActiveChunks = 0;
  let lastStepMicros = 0;
  let lastPerState: Uint32Array = new Uint32Array(CONWAY.states.length);
  let fps = 0;
  let lastFrameAt: number | null = null;
  let cursorWorld: { x: number; y: number } | null = null;
  let activeRuleset: RuleSet = CONWAY;
  let sessionSeed = SEED;
  const editStack = new EditStack();
  const commandLog: string[] = [];
  let lastShareUrl: string | null = null;
  let liveState: LiveConnectionState | null = null;
  let liveMessageCount = 0;
  let harnessReady = false;

  function motionReduced(): boolean {
    return testMode || reducedMotion();
  }

  const themeRegistry = new ThemeRegistry();
  themeRegistry.register(DEFAULT_THEME);

  function toRenderViewport(): RenderViewport {
    const dpr = window.devicePixelRatio || 1;
    return {
      originX: camera.originX,
      originY: camera.originY,
      cellSize: camera.cellSize * dpr,
      widthPx: Math.max(1, Math.round(camera.widthPx * dpr)),
      heightPx: Math.max(1, Math.round(camera.heightPx * dpr)),
      dpr,
    };
  }

  function applyViewport(): void {
    const vp = toRenderViewport();
    renderer.resize(vp.widthPx, vp.heightPx, vp.dpr);
    renderer.setViewport(vp);
    if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
  }

  function renderFrame(frame: FrameEvent): void {
    mirror.applyChunks(frame.chunks);
    if (camera.dirty) {
      renderer.setViewport(toRenderViewport());
      camera.clearDirty();
    }
    renderer.draw({ cells: mirror.view(), dirty: frame.dirty, tick: frame.tick });
    hasFrame = true;
    lastTick = frame.tick;
    lastPopulation = frame.stats.population;
    lastBirths = frame.stats.births;
    lastDeaths = frame.stats.deaths;
    lastTransitions = frame.stats.transitions;
    lastActivity = frame.stats.births + frame.stats.deaths + frame.stats.transitions;
    lastActiveChunks = frame.stats.activeChunks;
    lastStepMicros = frame.stats.stepMicros;
    lastPerState = frame.stats.perState;
    statsPanel.updateLive({
      tick: lastTick,
      population: lastPopulation,
      births: lastBirths,
      deaths: lastDeaths,
      transitions: lastTransitions,
      activity: lastActivity,
      activeChunks: lastActiveChunks,
      stepMicros: lastStepMicros,
    });

    const now = performance.now();
    if (lastFrameAt !== null) {
      const instant = 1000 / Math.max(1, now - lastFrameAt);
      fps = fps === 0 ? instant : fps * 0.9 + instant * 0.1;
    }
    lastFrameAt = now;
    if (window.__fancyGolFirstFrameMs === undefined) {
      window.__fancyGolFirstFrameMs = now - bootStart;
    }
    tpsMeter.sample(frame.tick, now);
    syncSimUI();
  }

  function cameraRedrawLoop(): void {
    if (camera.dirty && hasFrame) {
      renderer.setViewport(toRenderViewport());
      renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      camera.clearDirty();
    }
    requestAnimationFrame(cameraRedrawLoop);
  }

  const toasts = createToastRegion();
  const autosave = createAutosave({
    buildDoc: snapshotDoc,
    notify: (message) => toasts.show(message),
  });
  const panelHost = attachPanelHost({
    mount: shell.panelDock,
    onLayoutChange: () => autosave.scheduleSave(),
  });
  let statsOpen = false;
  let openExport: () => void = () => {};
  const statsPanel = createStatisticsPanel({
    tokens: chartTokensFromSet(DEFAULT_DARK_THEME.tokens),
    motion: DEFAULT_DARK_THEME.motion,
    onOpen: () => {
      statsOpen = true;
      void refreshStatsWindow();
    },
    onClose: () => {
      statsOpen = false;
    },
    onExport: () => openExport(),
  });
  panelHost.register(statsPanel.spec);

  async function refreshStatsWindow(): Promise<void> {
    if (!statsOpen) return;
    try {
      const reply = await client.statsWindow(Math.max(0, lastTick - 2048), lastTick, 200);
      statsPanel.setWindow(
        {
          points: reply.points,
          tier: reply.tier,
          aggregated: reply.aggregated,
          downsampled: reply.downsampled,
          sourceCount: reply.sourceCount,
          label: reply.label,
        },
        {
          entropyLabel: reply.entropyLabel,
          growthLabel: reply.growthLabel,
          cycle: reply.cycle,
          windowLabel: reply.label,
          flux: reply.flux,
        },
      );
    } catch {
      // Worker not ready yet — the next poll retries.
    }
  }

  function commitPaint(ops: readonly PaintOp[], record = true): void {
    if (ops.length === 0) return;
    if (record) {
      const grid = mirror.view();
      const inverse = ops.map((op) => ({ x: op.x, y: op.y, state: grid.get(op.x, op.y) }));
      editStack.record({ forward: ops, inverse });
    }
    void client.send({ cmd: 'paint', ops });
    autosave.scheduleSave();
  }

  const { context: toolContext, registry } = createAppContext({
    getGrid: () => mirror.view(),
    onPaint: (ops) => {
      commitPaint(ops);
      if (toolContext.toolRegistry.active?.id === 'fill') {
        const fillTool = toolContext.toolRegistry.get('fill') as FillTool | undefined;
        if (fillTool?.capped) {
          toasts.show(`Flood fill stopped at ${fillTool.cap.toLocaleString()} cells — the pattern may be incomplete.`);
        }
      }
    },
  });
  for (const cmd of SIM_COMMANDS) registry.register(cmd);

  const tpsMeter = new TpsMeter();
  let simRunning = !testMode;
  let targetTps = RUN_TPS;
  const simControl: SimControl = {
    get running() {
      return simRunning;
    },
    get targetTps() {
      return targetTps;
    },
    get actualTps() {
      return tpsMeter.actualTps;
    },
    toggleRun() {
      simRunning = !simRunning;
      tpsMeter.reset();
      void client.send(simRunning ? { cmd: 'run', tps: targetTps } : { cmd: 'pause' });
      syncSimUI();
    },
    step() {
      void client.send({ cmd: 'step', n: 1 });
    },
    reset() {
      void (async () => {
        await client.send({ cmd: 'clear' });
        mirror.reset();
        if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
        await client.send({ cmd: 'paint', ops: gunOps(20, 20, primaryLiveState(activeRuleset)) });
      })();
    },
    clear() {
      void (async () => {
        const confirmed = await confirmDialog({
          title: 'Clear the grid?',
          message: 'Every live cell will be removed. This cannot be undone.',
          confirmLabel: 'Clear',
          destructive: true,
        });
        if (!confirmed) return;
        await client.send({ cmd: 'clear' });
        mirror.reset();
        if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      })();
    },
    randomSoup() {
      void client.send({
        cmd: 'seedRandom',
        density: 0.3,
        seed: testMode ? sessionSeed : (Math.floor(Math.random() * 0xffffffff) >>> 0),
      });
    },
    setSpeed(tps: number) {
      targetTps = tps;
      tpsMeter.reset();
      if (simRunning) void client.send({ cmd: 'run', tps: targetTps });
      syncSimUI();
    },
  };
  const context: AppContext = { ...toolContext, sim: simControl };

  const gestures = attachGestures(camera, canvas, { reducedMotion: () => motionReduced() });
  attachInputRouter(camera, canvas, gateToolHandlers(gestures, context.toolRegistry.handlers));
  context.toolRegistry.attachEscapeHandling(window);

  function currentBrush(): Brush {
    return context.toolRegistry.get('brush') as Brush;
  }
  function currentSelect(): SelectTool {
    return context.toolRegistry.get('select') as SelectTool;
  }
  function currentThemeId(): string {
    return themeRegistry.getPersistedId() ?? 'default';
  }

  for (const cmd of createViewEditCommands({
    camera,
    fitRect: WIDE_SHOT_RECT,
    canUndo: () => editStack.canUndo,
    canRedo: () => editStack.canRedo,
    undo: () => editStack.undo(),
    redo: () => editStack.redo(),
    commitPaint,
    copy: () => currentSelect().copy(),
    cut: () => currentSelect().cut(),
    paste: () => currentSelect().paste(),
    setBrushSize: (size) => {
      currentBrush().size = size;
      const eraser = context.toolRegistry.get('eraser') as { size: number } | undefined;
      if (eraser) eraser.size = size;
    },
    save: () => {
      void saveAndShare();
    },
    cheatsheet: () => {
      const handle = openDialog({ title: 'Keyboard shortcuts' });
      const list = document.createElement('dl');
      list.className = 'dialog-message';
      for (const entry of PHASE_1_BINDINGS) {
        if (entry.commandId === 'brush.setSize' && entry.arg !== 1) continue;
        const dt = document.createElement('dt');
        dt.textContent = entry.binding;
        const dd = document.createElement('dd');
        dd.textContent = entry.commandId;
        list.append(dt, dd);
      }
      handle.panel.append(list);
    },
  })) {
    registry.register(cmd);
  }

  const bus = new CommandBus(registry, context, {
    onRun: (id) => {
      commandLog.push(id);
      if (!id.startsWith('tool.select.')) return;
      canvas.style.cursor = context.toolRegistry.active?.cursor ?? 'default';
    },
  });
  const keymap = new Keymap();
  attachDefaultBindings(keymap, registry);
  attachKeymap(keymap, window, bus);
  canvas.style.cursor = context.toolRegistry.active?.cursor ?? 'default';

  const transport = createTransportControls(bus, keymap);
  const speed = createSpeedControl((tps) => simControl.setSpeed(tps));
  shell.transport.append(transport.root, speed.root);

  function syncSimUI(): void {
    transport.update({ running: simControl.running });
    speed.update({ targetTps: simControl.targetTps, actualTps: simControl.actualTps });
  }
  syncSimUI();

  const statusBar = createStatusBar();
  shell.status.appendChild(statusBar.root);

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const world = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    cursorWorld = { x: Math.round(world.x), y: Math.round(world.y) };
  });
  canvas.addEventListener('pointerleave', () => {
    cursorWorld = null;
  });

  function syncStatusBar(): void {
    const cellUnderCursor = cursorWorld
      ? (() => {
          const id = mirror.view().get(cursorWorld.x, cursorWorld.y);
          const def = activeRuleset.states.find((s) => s.id === id);
          return { id, name: def?.name ?? String(id) };
        })()
      : null;
    statusBar.update({
      generation: lastTick,
      population: lastPopulation,
      chips: activeRuleset.states.map((s) => ({
        id: s.id,
        name: s.name,
        count: lastPerState[s.id] ?? 0,
        color: (themeRegistry.getCompiledTheme() ?? SHELL_THEME).palette(s.id, 0),
      })),
      cursor: cursorWorld,
      cellUnderCursor,
      zoomPercent: zoomPercent(camera.cellSize),
      fps,
      stepMs: lastStepMicros / 1000,
      renderMs: renderer.readStats().frameMs,
      memoryBytes: mirror.pageCount * CHUNK_AREA,
    });
  }

  const userStorage = realUserRulesetStorage();
  let userRulesets: RuleSet[] = [];

  function rememberUserRulesets(raw: readonly unknown[]): void {
    const next: RuleSet[] = [];
    for (const item of raw) {
      try {
        next.push(validateRuleSet(item));
      } catch {
        // skip a corrupt local entry rather than emptying the catalogue
      }
    }
    userRulesets = next;
  }

  function persistUserRulesets(): void {
    if (userStorage) writeUserRulesets(userStorage, userRulesets);
  }

  function rulesetById(id: string): RuleSet | undefined {
    return getBuiltin(id) ?? userRulesets.find((rs) => rs.id === id);
  }

  function pickerEntries() {
    return [...builtinRulesetSummaries(), ...userRulesets.map((rs) => userRulesetSummary(rs))];
  }

  function refreshPicker(): void {
    const open = rulesetPicker.open;
    thumbnails.clear();
    rulesetPicker.setEntries(pickerEntries());
    rulesetPicker.setActive(activeRuleset.id);
    if (open) thumbnails.start();
  }

  rememberUserRulesets(loadUserRulesets(userStorage));
  let editUserRuleset: (id: string) => void = () => {};

  const thumbnails = new RulesetThumbnailLoop({
    getRuleset: rulesetById,
    themeFor: (id) => ({ id: `thumb-${id}`, background: SHELL_THEME.background, palette: (state) => shellPalette(state) }),
  });
  const rulesetPicker = attachRulesetPicker({
    entries: pickerEntries(),
    activeId: activeRuleset.id,
    onThumbnailCreated: (id, el) => thumbnails.register(id, el),
    onOpenChange: (isOpen) => (isOpen ? thumbnails.start() : thumbnails.stop()),
    onEdit: (id) => editUserRuleset(id),
    onConfirm: (id, migration) => {
      const target = rulesetById(id);
      if (!target) return;
      void (async () => {
        await client.send({
          cmd: 'setRuleset',
          ruleset: target,
          ...(migration ? { migration: activeRuleset.states.map((s) => migration.get(s.id) ?? 0) } : {}),
        });
        activeRuleset = target;
        lastPerState = new Uint32Array(target.states.length);
        rulesetPicker.setActive(id);
        libraryPanel.setActiveRuleset(id);
        studioPanel.setDocument(target);
        autosave.scheduleSave();
      })();
    },
  });
  shell.toolbar.appendChild(rulesetPicker.root);

  const stampTool = toolContext.toolRegistry.get('stamp') as StampTool;
  let catalog: readonly CatalogPattern[] = bundledCatalog();

  async function resolvePatternRle(id: string): Promise<{ entry: CatalogPattern; rle: string } | null> {
    const entry = catalog.find((p) => p.id === id);
    if (!entry) return null;
    const rle = entry.rle ?? (await fetchPatternRle(id));
    return { entry, rle };
  }

  async function pickPattern(id: string): Promise<void> {
    const resolved = await resolvePatternRle(id);
    if (!resolved) return;
    const { entry, rle } = resolved;
    stampTool.replaceLibrary([...stampTool.list().filter((s) => s.id !== id), { id, name: entry.name, rle }]);
    stampTool.select(id);
    toolContext.toolRegistry.activate('stamp');
    canvas.style.cursor = stampTool.cursor;
  }

  async function isolatePattern(id: string): Promise<void> {
    const resolved = await resolvePatternRle(id);
    if (!resolved) return;
    const confirmed = await confirmDialog({
      title: 'Run in isolation?',
      message: `Clear the grid and place ${resolved.entry.name} alone? The current pattern will be lost.`,
      confirmLabel: 'Run alone',
      destructive: true,
    });
    if (!confirmed) return;
    await client.send({ cmd: 'clear' });
    mirror.reset();
    const ops = decodeRle(resolved.rle)
      .cells.filter((c) => c.state !== 0)
      .map((c) => ({ x: c.x, y: c.y, state: c.state }));
    if (ops.length > 0) await client.send({ cmd: 'paint', ops });
    if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
  }

  const libraryPanel = createLibraryPanel({
    entries: catalog,
    catalogSource: 'bundled',
    activeRuleset: activeRuleset.id,
    onPick: (id) => void pickPattern(id),
    onIsolate: (id) => void isolatePattern(id),
  });
  panelHost.register(libraryPanel.spec);

  const libraryToggle = document.createElement('button');
  libraryToggle.type = 'button';
  libraryToggle.className = 'pattern-toggle';
  libraryToggle.setAttribute('aria-label', 'Open pattern library');
  libraryToggle.textContent = 'Library';
  libraryToggle.addEventListener('click', () => panelHost.open('library'));
  shell.toolbar.appendChild(libraryToggle);

  const benchClient = createBenchClient(() =>
    toWorkerLike(new Worker(new URL('../worker/bench.worker.ts', import.meta.url), { type: 'module' })),
  );

  const studioPanel = createRulesetStudioPanel({
    initialText: JSON.stringify(activeRuleset, null, 2),
    validate: (value) => {
      try {
        return { ok: true, value: validateRuleSet(value) };
      } catch (error) {
        if (error instanceof RuleValidationError) return { ok: false, issues: error.issues };
        throw error;
      }
    },
    runBattery: (value, opts) => benchClient.run(value, opts),
    onSave: (value) => {
      const named = withUserId(validateRuleSet(value));
      userRulesets = upsertUserRuleset(userRulesets, named);
      persistUserRulesets();
      studioPanel.setDocument(named);
      refreshPicker();
      toasts.show('Saved to this browser.');
      void postUserRuleset(named, fetch).then((id) => {
        if (id) toasts.show('Also saved on this server.');
      });
    },
    onExport: (value) => {
      const named = withUserId(validateRuleSet(value));
      const slug = suggestUserRulesetId(named.id).slice('user:'.length);
      void saveBlob(blobFromText(prettyRuleset(named), 'application/json'), `${slug}.golrule.json`);
    },
    onShare: (value) => {
      const named = withUserId(validateRuleSet(value));
      void buildRulesetShareLink(named, `${window.location.origin}${window.location.pathname}`).then((url) => {
        const clip = navigator.clipboard;
        if (!clip) {
          toasts.show(url);
          return;
        }
        void clip.writeText(url).then(
          () => toasts.show('Share link copied — no account needed.'),
          () => toasts.show(url),
        );
      });
    },
    readImportFile: () =>
      new Promise<string | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.golrule.json,application/json';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          void file.text().then(resolve, () => resolve(null));
        });
        input.click();
      }),
    onApply: async (value, { reset }) => {
      const target = validateRuleSet(value);
      let migration: number[] | undefined;
      if (!palettesMatch(activeRuleset.states, target.states)) {
        const { result } = openStateMigrationDialog({
          title: `Apply ${target.name}`,
          oldStates: activeRuleset.states,
          newStates: target.states,
        });
        const map = await result;
        if (!map) return;
        migration = activeRuleset.states.map((s) => map.get(s.id) ?? 0);
      }
      await client.send({
        cmd: 'setRuleset',
        ruleset: target,
        ...(migration ? { migration } : {}),
      });
      activeRuleset = target;
      lastPerState = new Uint32Array(target.states.length);
      rulesetPicker.setActive(target.id);
      libraryPanel.setActiveRuleset(target.id);
      if (reset) {
        await client.send({ cmd: 'clear' });
        mirror.reset();
        if (hasFrame) renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      }
      autosave.scheduleSave();
    },
  });
  panelHost.register(studioPanel.spec);
  editUserRuleset = (id) => {
    const target = rulesetById(id);
    if (!target) return;
    studioPanel.setDocument(target);
    panelHost.open('studio');
  };

  const studioToggle = document.createElement('button');
  studioToggle.type = 'button';
  studioToggle.className = 'pattern-toggle';
  studioToggle.setAttribute('aria-label', 'Open ruleset studio');
  studioToggle.textContent = 'Studio';
  studioToggle.addEventListener('click', () => panelHost.open('studio'));
  shell.toolbar.appendChild(studioToggle);

  function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    const dest = document.createElement('canvas');
    dest.width = src.width;
    dest.height = src.height;
    dest.getContext('2d')?.drawImage(src, 0, 0);
    return dest;
  }

  openExport = () => {
    openExportDialog({
      async series() {
        const reply = await client.statsWindow(0, lastTick, 4096);
        return {
          points: reply.points,
          tier: reply.tier,
          aggregated: reply.aggregated,
          downsampled: reply.downsampled,
          sourceCount: reply.sourceCount,
          label: reply.label,
        };
      },
      async charts() {
        const snaps = statsPanel.snapshotCharts(CHART_EXPORT_SCALE, copyCanvas);
        const out: { name: string; blob: Blob }[] = [];
        for (const snap of snaps) out.push({ name: snap.name, blob: await canvasToPngBlob(snap.canvas) });
        return out;
      },
      gridRle: () => captureGridRLE(mirror.view()).rle,
      selectionRle: () => currentSelect().selectionRle(),
      viewPng: () => canvasToPngBlob(canvas),
    });
  };

  const exportToggle = document.createElement('button');
  exportToggle.type = 'button';
  exportToggle.className = 'pattern-toggle';
  exportToggle.setAttribute('aria-label', 'Export data');
  exportToggle.textContent = 'Export';
  exportToggle.addEventListener('click', () => openExport());
  shell.toolbar.appendChild(exportToggle);

  canvas.addEventListener('dragover', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer?.getData(LIBRARY_DRAG_TYPE) || e.dataTransfer?.getData('text/plain');
    if (!id) return;
    const rect = canvas.getBoundingClientRect();
    const world = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    void (async () => {
      const resolved = await resolvePatternRle(id);
      if (!resolved) return;
      await pickPattern(id);
      const origin = { x: Math.round(world.x), y: Math.round(world.y) };
      const ops = decodeRle(resolved.rle)
        .cells.filter((c) => c.state !== 0)
        .map((c) => ({ x: origin.x + c.x, y: origin.y + c.y, state: c.state }));
      if (ops.length > 0) commitPaint(ops);
    })();
  });

  void loadPatternCatalog().then((result) => {
    catalog = result.patterns;
    libraryPanel.setEntries(result.patterns, result.source);
    const withRle = stampsFromCatalog(result.patterns);
    if (withRle.length > 0) stampTool.replaceLibrary(withRle);
    libraryToggle.textContent = result.source === 'bundled' ? 'Library · starter' : 'Library';
    if (result.source === 'bundled') toasts.show(LIBRARY_OFFLINE_NOTICE);
  });

  function snapshotDoc(): SessionDoc {
    return buildSessionDoc({
      ruleset: { kind: 'builtin', id: activeRuleset.id },
      grid: mirror.view(),
      tick: lastTick,
      seed: sessionSeed,
      camera: { originX: camera.originX, originY: camera.originY, cellSize: camera.cellSize },
      theme: currentThemeId(),
      activeToolId: context.toolRegistry.active?.id ?? 'brush',
      panels: panelHost.getLayout(),
    });
  }

  async function saveAndShare(): Promise<void> {
    autosave.saveNow();
    const result = await buildShareLink(snapshotDoc(), {
      baseUrl: `${window.location.origin}${window.location.pathname}`,
      postServerSession: async (doc) => {
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc),
        });
        if (!response.ok) throw new Error(`session save failed: ${response.status}`);
        return (await response.json()) as { id: string; shareUrl: string };
      },
    });
    lastShareUrl = result.url;
    const hash = new URL(result.url).hash;
    if (hash) history.replaceState(null, '', hash);
    toasts.show('Session saved — share the URL to restore it.');
  }

  function connectLiveIfNeeded(): void {
    if (window.location.pathname !== '/live') return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    connectLiveViewer({
      url: `${protocol}://${window.location.host}/live`,
      onStateChange: (state) => {
        liveState = state;
      },
      onMessage: () => {
        liveMessageCount += 1;
      },
    });
  }

  function publishHarness(): void {
    if (!testMode) return;
    window.__fancyGol = createHarness({
      ready: () => harnessReady,
      tick: () => lastTick,
      population: () => lastPopulation,
      running: () => simRunning,
      targetTps: () => targetTps,
      cellSize: () => camera.cellSize,
      originX: () => camera.originX,
      originY: () => camera.originY,
      widthPx: () => camera.widthPx,
      heightPx: () => camera.heightPx,
      activeToolId: () => context.toolRegistry.active?.id ?? null,
      rulesetId: () => activeRuleset.id,
      themeId: () => currentThemeId(),
      brushSize: () => currentBrush().size,
      canUndo: () => editStack.canUndo,
      canRedo: () => editStack.canRedo,
      lastCommands: () => commandLog,
      liveState: () => liveState,
      liveMessageCount: () => liveMessageCount,
      lastShareUrl: () => lastShareUrl,
      getCell: (x, y) => mirror.view().get(x, y),
      worldToScreen: (x, y) => camera.worldToScreen(x, y),
      screenToWorld: (px, py) => camera.screenToWorld(px, py),
      setCamera: (pose) => {
        if (pose.originX !== undefined) camera.originX = pose.originX;
        if (pose.originY !== undefined) camera.originY = pose.originY;
        if (pose.cellSize !== undefined) camera.cellSize = pose.cellSize;
      },
      runCommand: (id) => bus.run(id),
    });
  }

  async function boot(): Promise<void> {
    const restored = await resolveBootSession({
      hash: window.location.hash,
      testMode,
      confirmOverwrite: () =>
        confirmDialog({
          title: 'Load shared session?',
          message: 'This will replace your current autosave.',
          confirmLabel: 'Load',
        }),
      fetchServerSession: async (id) => {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!response.ok) return null;
        const raw: unknown = await response.json();
        return raw;
      },
    });
    const themeId = restored?.theme ?? themeRegistry.getPersistedId() ?? 'default';
    try {
      themeRegistry.activate(themeId);
    } catch {
      themeRegistry.activate('default');
    }
    const compiled = themeRegistry.getCompiledTheme();
    if (compiled) renderer.setTheme(compiled);
    themeRegistry.subscribe(({ theme, compiled: next }) => {
      renderer.setTheme(next);
      statsPanel.setTokens(chartTokensFromSet(theme.tokens));
      statsPanel.setMotion(theme.motion);
      if (hasFrame) {
        renderer.setViewport(toRenderViewport());
        renderer.draw({ cells: mirror.view(), dirty: null, tick: lastTick });
      }
    });

    await renderer.init(canvas);
    applyViewport();
    requestAnimationFrame(cameraRedrawLoop);
    setInterval(syncStatusBar, STATUS_THROTTLE_MS);
    setInterval(() => {
      if (statsOpen) void refreshStatsWindow();
    }, 50);

    client.onFrame((frame) => {
      renderFrame(frame);
      if (!harnessReady) {
        harnessReady = true;
        publishHarness();
      }
    });

    if (restored) {
      activeRuleset = restored.ruleset;
      sessionSeed = restored.seed;
      lastPerState = new Uint32Array(restored.ruleset.states.length);
      rulesetPicker.setActive(restored.ruleset.id);
      libraryPanel.setActiveRuleset(restored.ruleset.id);
      studioPanel.setDocument(restored.ruleset);
      await client.send({
        cmd: 'init',
        ruleset: restored.ruleset,
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        seed: restored.seed,
      });
      if (restored.paintOps.length > 0) {
        await client.send({ cmd: 'paint', ops: restored.paintOps });
      }
      camera.originX = restored.camera.originX;
      camera.originY = restored.camera.originY;
      camera.cellSize = restored.camera.cellSize;
      if (context.toolRegistry.get(restored.activeToolId)) {
        context.toolRegistry.activate(restored.activeToolId);
        canvas.style.cursor = context.toolRegistry.active?.cursor ?? 'default';
      }
      if (restored.panels) panelHost.applyLayout(restored.panels);
    } else {
      await client.send({ cmd: 'init', ruleset: CONWAY, width: WORLD_WIDTH, height: WORLD_HEIGHT, seed: sessionSeed });
      await client.send({ cmd: 'paint', ops: gunOps(20, 20, primaryLiveState(activeRuleset)) });
    }

    const sharedRule = await resolveSharedRuleset(window.location.hash);
    if (sharedRule) {
      try {
        const incoming = validateRuleSet(sharedRule);
        let migration: number[] | undefined;
        if (!palettesMatch(activeRuleset.states, incoming.states)) {
          const map = defaultMigration(activeRuleset.states, incoming.states);
          migration = activeRuleset.states.map((s) => map.get(s.id) ?? 0);
        }
        await client.send({
          cmd: 'setRuleset',
          ruleset: incoming,
          ...(migration ? { migration } : {}),
        });
        activeRuleset = incoming;
        lastPerState = new Uint32Array(incoming.states.length);
        rulesetPicker.setActive(incoming.id);
        libraryPanel.setActiveRuleset(incoming.id);
        studioPanel.setDocument(incoming);
      } catch {
        // a corrupt #r: fragment is "no share", not a crash
      }
    }

    void fetchRemoteUserRulesets(fetch).then((remote) => {
      if (remote.length === 0) return;
      rememberUserRulesets(mergeUserRulesets(userRulesets, remote));
      persistUserRulesets();
      refreshPicker();
    });

    if (!testMode) {
      await client.send({ cmd: 'run', tps: RUN_TPS });
      playColdStart({
        camera,
        framed: framedTarget,
        durationMs: INTRO_CAMERA_MS,
        easing: EASE_OUT_CUBIC,
        reducedMotion: motionReduced(),
        playChrome: () => {
          void shell.playIntro();
        },
        onCancel: (settle) => {
          for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
            window.addEventListener(type, settle, { once: true });
          }
        },
      });
    } else {
      camera.originX = restored?.camera.originX ?? framedTarget.originX;
      camera.originY = restored?.camera.originY ?? framedTarget.originY;
      camera.cellSize = restored?.camera.cellSize ?? framedTarget.cellSize;
      void shell.playIntro();
      publishHarness();
    }

    connectLiveIfNeeded();
  }

  window.addEventListener('resize', () => {
    camera.resize(window.innerWidth, window.innerHeight);
    applyViewport();
  });

  boot().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const root = document.querySelector<HTMLDivElement>('#app');
    if (root) root.insertAdjacentHTML('beforeend', `<pre style="color:#ff8080;padding:12px">${message}</pre>`);
  });
}

main();
