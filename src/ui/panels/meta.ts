/**
 * P3-E-10 — what a heavy panel *is*, separated from what it *does*.
 *
 * The Statistics, Library and Ruleset Studio panels are lazy chunks, but the panel host still has
 * to know each one's id, title and minimum width up front: shortcuts open panels by id, the layout
 * restore reads them, and a placeholder needs a title before any code has loaded. They live here,
 * in a module with no imports, so the entry chunk can use them without importing a panel, and the
 * panel modules take their own spec from the same constants — one source, nothing to drift.
 */
export interface PanelMeta {
  readonly id: string;
  readonly title: string;
  /** Smallest width the panel's controls remain usable. The host clamps resize to this. */
  readonly minWidthPx: number;
}

export const STATS_PANEL_META: PanelMeta = { id: 'stats', title: 'Statistics', minWidthPx: 280 };
export const LIBRARY_PANEL_META: PanelMeta = { id: 'library', title: 'Library', minWidthPx: 320 };
export const STUDIO_PANEL_META: PanelMeta = { id: 'studio', title: 'Ruleset Studio', minWidthPx: 400 };

/** The drag payload a library card carries onto the canvas. Needed at the drop site, not the panel. */
export const LIBRARY_DRAG_TYPE = 'application/x-fancy-gol-pattern';
