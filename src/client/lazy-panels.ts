/**
 * P3-E-10 — the three heavy panels, as lazy facades.
 *
 * Each facade exposes the panel's own API to the composition root, so `main.ts` reads exactly as it
 * did when the panels were eager, but the panel module (and, for Statistics, the charts it draws)
 * is a dynamic import that runs the first time the panel is opened — or earlier, on a hover or
 * focus of its toolbar button (`preload`).
 *
 * Only **types** are imported statically from the panel modules. A single value import (a constant,
 * a helper) would pull the whole panel back into the entry chunk, which is why the ids live in
 * `ui/panels/meta.ts` and the pretty-printer in `ruleset-studio/format.ts`. The `client-js-gzip`
 * gate measures by import reachability, so a slip here fails the build's bench, not silently.
 *
 * State the app sets before a panel exists is either handed to its factory when it is finally
 * created (the Studio's document, the Statistics tokens) or recorded and replayed once (see
 * `LazyPanel.apply`).
 */
import type { ChartTokens } from '@ui/charts/chart';
import type { PanelMeta } from '@ui/panels/meta';
import { LIBRARY_PANEL_META, STATS_PANEL_META, STUDIO_PANEL_META } from '@ui/panels/meta';
import type { LibraryPanel, LibraryPanelOptions } from '@ui/panels/library/panel';
import type { RulesetStudioOptions, RulesetStudioPanel } from '@ui/panels/ruleset-studio/panel';
import type { StatisticsPanel } from '@ui/panels/statistics/panel';
import type { PanelSpec } from '@ui/shell/panel-host';
import type { MotionSignature, TokenSet } from '@themes/types';
import { LazyPanel, type LazyPanelOptions } from './lazy-panel';

/** What every lazy panel facade offers the composition root besides its panel's own methods. */
export interface LazyPanelHandle {
  readonly spec: PanelSpec;
  readonly meta: PanelMeta;
  /** Start fetching the panel's chunk now (a hover on its button). Never throws; resolves when loaded. */
  preload(): Promise<void>;
}

function handle<P extends { readonly spec: PanelSpec }>(meta: PanelMeta, lazy: LazyPanel<P>): LazyPanelHandle {
  return {
    spec: lazy.spec,
    meta,
    preload: () =>
      lazy.preload().then(
        () => undefined,
        () => undefined,
      ),
  };
}

// ---------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------

export interface LazyStatisticsDeps extends LazyPanelOptions {
  readonly tokens: TokenSet;
  readonly motion: MotionSignature;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onExport: () => void;
}

export interface LazyStatisticsPanel extends LazyPanelHandle {
  setTokens(tokens: TokenSet): void;
  setMotion(motion: MotionSignature): void;
  updateLive: StatisticsPanel['updateLive'];
  setWindow: StatisticsPanel['setWindow'];
  /** Loads the panel first if needed: an export must find the charts whether or not the panel was ever opened. */
  snapshotCharts(...args: Parameters<StatisticsPanel['snapshotCharts']>): Promise<ReturnType<StatisticsPanel['snapshotCharts']>>;
}

export function createLazyStatisticsPanel(deps: LazyStatisticsDeps): LazyStatisticsPanel {
  // The newest theme tokens and motion, so a panel created late is born in the current theme.
  let tokens = deps.tokens;
  let motion = deps.motion;
  let toChartTokens: ((tokens: TokenSet) => ChartTokens) | null = null;

  const lazy = new LazyPanel<StatisticsPanel>(
    STATS_PANEL_META,
    async () => {
      const [{ createStatisticsPanel }, { chartTokensFromSet }] = await Promise.all([
        import('@ui/panels/statistics/panel'),
        import('@ui/charts/chart'),
      ]);
      toChartTokens = chartTokensFromSet;
      return createStatisticsPanel({
        tokens: chartTokensFromSet(tokens),
        motion,
        onOpen: deps.onOpen,
        onClose: deps.onClose,
        onExport: deps.onExport,
      });
    },
    deps.onLoadError ? { onLoadError: deps.onLoadError } : {},
  );

  return {
    ...handle(STATS_PANEL_META, lazy),
    setTokens(next) {
      tokens = next;
      if (lazy.loaded && toChartTokens) lazy.loaded.setTokens(toChartTokens(next));
    },
    setMotion(next) {
      motion = next;
      lazy.loaded?.setMotion(next);
    },
    updateLive: (live) => lazy.apply('updateLive', (panel) => panel.updateLive(live)),
    setWindow: (window, reports) => lazy.apply('setWindow', (panel) => panel.setWindow(window, reports)),
    async snapshotCharts(scale, copy) {
      const panel = await lazy.preload();
      return panel.snapshotCharts(scale, copy);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------------------------

export interface LazyLibraryDeps extends LazyPanelOptions {
  readonly entries: NonNullable<LibraryPanelOptions['entries']>;
  readonly catalogSource: NonNullable<LibraryPanelOptions['catalogSource']>;
  readonly activeRuleset: string;
  readonly onPick: NonNullable<LibraryPanelOptions['onPick']>;
  readonly onIsolate: NonNullable<LibraryPanelOptions['onIsolate']>;
}

export interface LazyLibraryPanel extends LazyPanelHandle {
  setEntries: LibraryPanel['setEntries'];
  setActiveRuleset: LibraryPanel['setActiveRuleset'];
}

export function createLazyLibraryPanel(deps: LazyLibraryDeps): LazyLibraryPanel {
  const lazy = new LazyPanel<LibraryPanel>(
    LIBRARY_PANEL_META,
    async () => {
      const { createLibraryPanel } = await import('@ui/panels/library/panel');
      return createLibraryPanel({ onPick: deps.onPick, onIsolate: deps.onIsolate });
    },
    deps.onLoadError ? { onLoadError: deps.onLoadError } : {},
  );
  // The starting catalogue and ruleset are recorded like any later change, so they replay in order.
  lazy.apply('setEntries', (panel) => panel.setEntries(deps.entries, deps.catalogSource));
  lazy.apply('setActiveRuleset', (panel) => panel.setActiveRuleset(deps.activeRuleset));

  return {
    ...handle(LIBRARY_PANEL_META, lazy),
    setEntries: (entries, source) => lazy.apply('setEntries', (panel) => panel.setEntries(entries, source)),
    setActiveRuleset: (id) => lazy.apply('setActiveRuleset', (panel) => panel.setActiveRuleset(id)),
  };
}

// ---------------------------------------------------------------------------------------------
// Ruleset Studio
// ---------------------------------------------------------------------------------------------

export interface LazyStudioDeps extends Omit<RulesetStudioOptions, 'initialText'>, LazyPanelOptions {
  /** The document the editor opens on. Later `setDocument` calls replace it before the panel exists. */
  readonly initialDocument: unknown;
}

export interface LazyStudioPanel extends LazyPanelHandle {
  setDocument: RulesetStudioPanel['setDocument'];
}

export function createLazyStudioPanel(deps: LazyStudioDeps): LazyStudioPanel {
  const { initialDocument, onLoadError, ...options } = deps;
  // The newest document: a panel created late opens on it rather than on a stale one.
  let document = initialDocument;

  const lazy = new LazyPanel<RulesetStudioPanel>(
    STUDIO_PANEL_META,
    async () => {
      const { createRulesetStudioPanel } = await import('@ui/panels/ruleset-studio/panel');
      return createRulesetStudioPanel({ ...options, initialText: JSON.stringify(document, null, 2) });
    },
    onLoadError ? { onLoadError } : {},
  );

  return {
    ...handle(STUDIO_PANEL_META, lazy),
    setDocument(value) {
      document = value;
      lazy.loaded?.setDocument(value);
    },
  };
}
