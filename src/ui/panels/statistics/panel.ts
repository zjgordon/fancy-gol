/**
 * Statistics panel (P2-D-3). Simple: three numbers a child can read, plus a
 * sparkline. Advanced: every metric on the wire, the cycle finding, growth,
 * entropy, stacked states, and a phase trail. Hosted by P2-G-2 — this file
 * only mounts content.
 */
import type { StatsCycleFinding, StatsWindowPoint } from '@shared/protocol';
import type { MotionSignature } from '@themes/types';
import { Chart, ChartLoop, type ChartTokens, type ChartWindow } from '@ui/charts/chart';
import { drawPhase } from '@ui/charts/phase';
import { linearScale } from '@ui/charts/scale';
import { drawStackedArea, stackStateAreas, withChartAlpha } from '@ui/charts/series';
import { drawSparkline } from '@ui/charts/sparkline';
import type { PanelSpec } from '@ui/shell/panel-host';
import {
  describeCycleFinding,
  formatBbox,
  formatCentroid,
  formatCount,
  formatDensity,
  formatHash,
  formatSigned,
} from './copy';

export const STATS_PANEL_ID = 'stats';
export const STATS_PANEL_MIN_WIDTH = 280;

export type StatsPanelMode = 'simple' | 'advanced';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StatsLive {
  readonly tick: number;
  readonly population: number;
  readonly births: number;
  readonly deaths: number;
  readonly transitions: number;
  readonly activity: number;
  readonly activeChunks: number;
  readonly stepMicros: number;
}

export interface StatsReports {
  readonly entropyLabel: string;
  readonly growthLabel: string;
  readonly cycle: StatsCycleFinding | null;
  readonly windowLabel: string;
  readonly flux: Int32Array;
}

export interface StatisticsPanelOptions {
  readonly tokens: ChartTokens;
  readonly motion: MotionSignature;
  readonly ctxFor?: (canvas: HTMLCanvasElement) => Canvas2DContext | null;
  readonly loop?: ChartLoop;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onModeChange?: (mode: StatsPanelMode) => void;
}

export interface StatisticsPanel {
  readonly spec: PanelSpec;
  readonly root: HTMLElement;
  setTokens(tokens: ChartTokens): void;
  setMotion(motion: MotionSignature): void;
  setMode(mode: StatsPanelMode): void;
  getMode(): StatsPanelMode;
  updateLive(live: StatsLive): void;
  setWindow(window: ChartWindow, reports: StatsReports): void;
  dismissFinding(): void;
  dispose(): void;
}

const SPARK_CAP = 128;
const CHART_H = 140;

function metric(dl: HTMLDListElement, term: string, value: string): HTMLElement {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.append(dt, dd);
  return dd;
}

function hero(label: string): { article: HTMLElement; value: HTMLElement } {
  const article = document.createElement('article');
  article.className = 'stats-hero';
  const k = document.createElement('p');
  k.className = 'stats-hero-label';
  k.textContent = label;
  const value = document.createElement('p');
  value.className = 'stats-hero-value';
  value.textContent = '0';
  article.append(k, value);
  return { article, value };
}

export function createStatisticsPanel(opts: StatisticsPanelOptions): StatisticsPanel {
  let tokens = opts.tokens;
  let motion = opts.motion;
  let mode: StatsPanelMode = 'simple';
  let dismissedAt: number | null = null;
  let latestCycle: StatsCycleFinding | null = null;
  let windowData: ChartWindow | null = null;
  let reports: StatsReports | null = null;
  let live: StatsLive = {
    tick: 0,
    population: 0,
    births: 0,
    deaths: 0,
    transitions: 0,
    activity: 0,
    activeChunks: 0,
    stepMicros: 0,
  };

  const spark = new Float64Array(SPARK_CAP);
  let sparkLen = 0;
  let sparkI = 0;

  const root = document.createElement('div');
  root.className = 'stats-panel';

  const finding = document.createElement('div');
  finding.className = 'stats-finding';
  finding.hidden = true;
  const findingText = document.createElement('p');
  findingText.className = 'stats-finding-text';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'stats-finding-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss finding');
  dismiss.textContent = 'Dismiss';
  finding.append(findingText, dismiss);

  const toggle = document.createElement('div');
  toggle.className = 'stats-mode';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Statistics detail');
  const simpleBtn = document.createElement('button');
  simpleBtn.type = 'button';
  simpleBtn.textContent = 'Simple';
  const advancedBtn = document.createElement('button');
  advancedBtn.type = 'button';
  advancedBtn.textContent = 'Advanced';
  toggle.append(simpleBtn, advancedBtn);

  const simple = document.createElement('div');
  simple.className = 'stats-simple';
  const popHero = hero('Alive now');
  const fluxHero = hero('Born / died');
  const genHero = hero('Generation');
  const heroes = document.createElement('div');
  heroes.className = 'stats-heroes';
  heroes.append(popHero.article, fluxHero.article, genHero.article);
  const sparkCanvas = document.createElement('canvas');
  sparkCanvas.className = 'stats-spark';
  sparkCanvas.setAttribute('aria-hidden', 'true');
  simple.append(heroes, sparkCanvas);

  const advanced = document.createElement('div');
  advanced.className = 'stats-advanced';
  advanced.hidden = true;
  const growthEl = document.createElement('p');
  growthEl.className = 'stats-report';
  const entropyEl = document.createElement('p');
  entropyEl.className = 'stats-report';
  const windowEl = document.createElement('p');
  windowEl.className = 'stats-window-label';
  const metrics = document.createElement('dl');
  metrics.className = 'stats-metrics';
  const ddTick = metric(metrics, 'Generation', '0');
  const ddPop = metric(metrics, 'Population', '0');
  const ddBirths = metric(metrics, 'Births', '0');
  const ddDeaths = metric(metrics, 'Deaths', '0');
  const ddTransitions = metric(metrics, 'Transitions', '0');
  const ddActivity = metric(metrics, 'Activity', '0');
  const ddDensity = metric(metrics, 'Density', '—');
  const ddBbox = metric(metrics, 'Live box', '—');
  const ddCentroid = metric(metrics, 'Centroid', '—');
  const ddEntropy = metric(metrics, 'Entropy', '—');
  const ddHash = metric(metrics, 'Hash', '—');
  const ddChunks = metric(metrics, 'Active chunks', '0');
  const ddStep = metric(metrics, 'Step', '—');
  const ddFlux = metric(metrics, 'Flux', '—');
  const ddStates = metric(metrics, 'Per state', '—');

  const popCanvas = document.createElement('canvas');
  popCanvas.className = 'stats-chart';
  const stackCanvas = document.createElement('canvas');
  stackCanvas.className = 'stats-chart';
  const entropyCanvas = document.createElement('canvas');
  entropyCanvas.className = 'stats-chart';
  const phaseCanvas = document.createElement('canvas');
  phaseCanvas.className = 'stats-chart';
  popCanvas.setAttribute('aria-label', 'Population over time');
  stackCanvas.setAttribute('aria-label', 'Live states stacked');
  entropyCanvas.setAttribute('aria-label', 'Entropy over time');
  phaseCanvas.setAttribute('aria-label', 'Population versus births');

  advanced.append(
    growthEl,
    entropyEl,
    windowEl,
    metrics,
    popCanvas,
    stackCanvas,
    entropyCanvas,
    phaseCanvas,
  );
  root.append(finding, toggle, simple, advanced);

  const ownLoop = opts.loop ?? new ChartLoop();
  let popChart: Chart | null = null;
  let entropyChart: Chart | null = null;
  let advancedReady = false;

  function ctxOf(canvas: HTMLCanvasElement): Canvas2DContext | null {
    return opts.ctxFor?.(canvas) ?? canvas.getContext('2d');
  }

  function sparkValues(): number[] {
    const out: number[] = [];
    const n = sparkLen;
    const start = sparkLen === SPARK_CAP ? sparkI : 0;
    for (let i = 0; i < n; i++) out.push(spark[(start + i) % SPARK_CAP]!);
    return out;
  }

  function drawSpark(): void {
    const ctx = ctxOf(sparkCanvas);
    if (!ctx) return;
    const w = Math.max(1, sparkCanvas.clientWidth || 240);
    const h = Math.max(1, sparkCanvas.clientHeight || 48);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    sparkCanvas.width = Math.round(w * dpr);
    sparkCanvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawSparkline(ctx, sparkValues(), { x: 2, y: 2, width: w - 4, height: h - 4 }, {
      stroke: tokens.accent,
      fill: withChartAlpha(tokens.accent, 0.22),
      dot: tokens.accentStrong,
    });
  }

  function ensureAdvanced(): void {
    if (advancedReady) return;
    const ctxPop = ctxOf(popCanvas);
    const ctxEnt = ctxOf(entropyCanvas);
    if (!ctxPop || !ctxEnt) return;
    popChart = new Chart({
      canvas: popCanvas,
      ctx: ctxPop,
      tokens,
      width: Math.max(240, popCanvas.clientWidth || 280),
      height: CHART_H,
      loop: ownLoop,
    });
    entropyChart = new Chart({
      canvas: entropyCanvas,
      ctx: ctxEnt,
      tokens,
      width: Math.max(240, entropyCanvas.clientWidth || 280),
      height: CHART_H,
      series: [{ id: 'entropy', label: 'Entropy', color: 'accentStrong', value: (p) => p.entropy }],
      loop: ownLoop,
    });
    advancedReady = true;
    if (windowData) {
      popChart.setData(windowData);
      entropyChart.setData(windowData);
    }
  }

  function drawExtras(): void {
    if (!windowData) return;
    const points = windowData.points;
    const w = Math.max(240, stackCanvas.clientWidth || 280);
    const h = CHART_H;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const stackCtx = ctxOf(stackCanvas);
    if (stackCtx) {
      stackCanvas.width = Math.round(w * dpr);
      stackCanvas.height = Math.round(h * dpr);
      stackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stackCtx.clearRect(0, 0, w, h);
      if (points.length > 0) {
        const stacked = stackStateAreas(points);
        let yHi = 1;
        for (const p of points) if (p.population > yHi) yHi = p.population;
        const x0 = points[0]!.tick;
        const x1 = points[points.length - 1]!.tick;
        const xScale = linearScale([x0, x1 === x0 ? x0 + 1 : x1], [8, w - 8]);
        const yScale = linearScale([0, yHi], [h - 8, 8]);
        const fills = stacked.layers.map((_, i) => {
          const ramp = [tokens.accent, tokens.success, tokens.danger, tokens.accentStrong, tokens.muted];
          return ramp[i % ramp.length]!;
        });
        drawStackedArea(stackCtx, points, xScale, yScale, stacked, fills);
      }
    }

    const phaseCtx = ctxOf(phaseCanvas);
    if (phaseCtx) {
      phaseCanvas.width = Math.round(w * dpr);
      phaseCanvas.height = Math.round(h * dpr);
      phaseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      phaseCtx.clearRect(0, 0, w, h);
      drawPhase({
        ctx: phaseCtx,
        plot: { x: 8, y: 8, width: w - 16, height: h - 16 },
        points,
        x: (p) => p.population,
        y: (p) => p.births,
        fade: { curve: motion.easings.standard, durationMs: motion.durationMs.slow },
        style: { color: tokens.accent },
      });
    }
  }

  function syncMode(): void {
    const advancedOn = mode === 'advanced';
    simple.hidden = advancedOn;
    advanced.hidden = !advancedOn;
    simpleBtn.setAttribute('aria-pressed', advancedOn ? 'false' : 'true');
    advancedBtn.setAttribute('aria-pressed', advancedOn ? 'true' : 'false');
    if (advancedOn) {
      ensureAdvanced();
      drawExtras();
    } else {
      drawSpark();
    }
  }

  function syncFinding(): void {
    if (!latestCycle || dismissedAt === latestCycle.detectedAt) {
      finding.hidden = true;
      return;
    }
    finding.hidden = false;
    findingText.textContent = describeCycleFinding(latestCycle);
  }

  function lastPoint(): StatsWindowPoint | null {
    const pts = windowData?.points;
    return pts && pts.length > 0 ? pts[pts.length - 1]! : null;
  }

  function syncAdvancedText(): void {
    growthEl.textContent = reports?.growthLabel ?? 'Growth — waiting for samples';
    entropyEl.textContent = reports?.entropyLabel ?? 'Entropy — waiting for a scan';
    windowEl.textContent = reports?.windowLabel ?? '';
    const p = lastPoint();
    ddTick.textContent = formatCount(live.tick);
    ddPop.textContent = formatCount(p?.population ?? live.population);
    ddBirths.textContent = formatCount(p?.births ?? live.births);
    ddDeaths.textContent = formatCount(p?.deaths ?? live.deaths);
    ddTransitions.textContent = formatCount(p?.transitions ?? live.transitions);
    ddActivity.textContent = formatCount(p?.activity ?? live.activity);
    ddDensity.textContent = p ? formatDensity(p.density) : '—';
    ddBbox.textContent = p ? formatBbox(p.bbox) : '—';
    ddCentroid.textContent = p ? formatCentroid(p.centroid) : '—';
    ddEntropy.textContent = p ? p.entropy.toFixed(2) : '—';
    ddHash.textContent = p ? formatHash(p.hash) : '—';
    ddChunks.textContent = formatCount(live.activeChunks);
    ddStep.textContent = Number.isFinite(live.stepMicros) ? `${(live.stepMicros / 1000).toFixed(2)} ms` : '—';
    const flux = reports?.flux;
    if (flux && flux.length > 0) {
      const bits: string[] = [];
      for (let i = 0; i < flux.length && i < 16; i++) {
        if (flux[i] !== 0) bits.push(`${i}:${formatSigned(flux[i]!)}`);
      }
      ddFlux.textContent = bits.length > 0 ? bits.join(' ') : 'none';
    } else {
      ddFlux.textContent = '—';
    }
    if (p) {
      const parts: string[] = [];
      for (let i = 0; i < p.perState.length && i < 16; i++) {
        const n = p.perState[i] ?? 0;
        if (n > 0) parts.push(`${i}:${formatCount(n)}`);
      }
      ddStates.textContent = parts.length > 0 ? parts.join(' ') : 'none';
    } else {
      ddStates.textContent = '—';
    }
  }

  function pushSpark(pop: number): void {
    spark[sparkI] = pop;
    sparkI = (sparkI + 1) % SPARK_CAP;
    if (sparkLen < SPARK_CAP) sparkLen += 1;
  }

  simpleBtn.addEventListener('click', () => {
    if (mode === 'simple') return;
    mode = 'simple';
    syncMode();
    opts.onModeChange?.(mode);
  });
  advancedBtn.addEventListener('click', () => {
    if (mode === 'advanced') return;
    mode = 'advanced';
    syncMode();
    opts.onModeChange?.(mode);
  });
  dismiss.addEventListener('click', () => {
    dismissedAt = latestCycle?.detectedAt ?? live.tick;
    syncFinding();
  });

  syncMode();

  const spec: PanelSpec = {
    id: STATS_PANEL_ID,
    title: 'Statistics',
    minWidthPx: STATS_PANEL_MIN_WIDTH,
    mount(body) {
      body.appendChild(root);
      syncMode();
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
    setTokens(next) {
      tokens = next;
      popChart?.setTokens(next);
      entropyChart?.setTokens(next);
      if (mode === 'simple') drawSpark();
      else drawExtras();
    },
    setMotion(next) {
      motion = next;
      if (mode === 'advanced') drawExtras();
    },
    setMode(next) {
      if (mode === next) return;
      mode = next;
      syncMode();
    },
    getMode: () => mode,
    updateLive(next) {
      live = next;
      popHero.value.textContent = formatCount(next.population);
      fluxHero.value.textContent = `${formatSigned(next.births)} / ${formatCount(next.deaths)}`;
      genHero.value.textContent = formatCount(next.tick);
      pushSpark(next.population);
      if (mode === 'simple') drawSpark();
      else syncAdvancedText();
    },
    setWindow(win, nextReports) {
      windowData = win;
      reports = nextReports;
      latestCycle = nextReports.cycle;
      syncFinding();
      syncAdvancedText();
      popChart?.setData(win);
      entropyChart?.setData(win);
      if (mode === 'advanced') drawExtras();
    },
    dismissFinding() {
      dismissedAt = latestCycle?.detectedAt ?? live.tick;
      syncFinding();
    },
    dispose() {
      popChart?.dispose();
      entropyChart?.dispose();
      popChart = null;
      entropyChart = null;
      if (!opts.loop) ownLoop.stop();
      root.remove();
    },
  };
}
