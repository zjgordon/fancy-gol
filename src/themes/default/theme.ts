/**
 * The Default theme (P1-E-3): "the same as you'd expect on every linux distribution ever
 * released. But very compatible and good for large grids" (INCEPTION.md). No render hooks, no
 * post-processing, `cost: 'low'` — the honest baseline every Phase 3 theme degrades to.
 *
 * `DEFAULT_THEME` is the `AdaptiveThemeModule` a caller actually registers
 * (`themeRegistry.register(DEFAULT_THEME)`, `activate('default')`) — `themes/registry.ts` (P1-E-2)
 * picks `DEFAULT_LIGHT_THEME` or `DEFAULT_DARK_THEME` from `prefers-color-scheme` and re-picks
 * live if it changes. Nothing in this file registers or activates anything for production use —
 * that wiring (a boot sequence choosing a theme, a renderer receiving `CompiledTheme`s) is a
 * mechanical follow-up for whichever task plugs a renderer and `client/main.ts` together, the
 * same "this task builds the seam, a later one plugs into it" split `themes/registry.ts`'s own
 * header note already applies to itself.
 */
import type { AdaptiveThemeModule } from '@themes/registry';
import type { ThemeModule } from '@themes/types';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from './tokens';
import { DARK_STATE_RAMP, LIGHT_STATE_RAMP, makeDefaultPalette } from './palette';

/** All five easings resolve to the identity function pending a real `MotionSignature` consumer —
 * nothing in Phase 1 drives non-CSS motion off a theme yet (`ui/overlay/grid-lines.ts`'s
 * `FadeCurve` and `ui/overlay/selection.ts`'s `marchPeriodMs` are still their own hand-written
 * provisionals, per P1-E-1's own follow-up note; this is genuinely unconsumed until whichever
 * task rewires them). Kept honest rather than guessed: an identity easing is indistinguishable
 * from "not yet wired", never a fabricated curve shape no design ever specified. */
const IDENTITY_MOTION: ThemeModule['motion'] = {
  durationMs: { instant: 0, fast: 150, slow: 600, slower: 900 },
  easings: {
    linear: (t) => t,
    standard: (t) => t,
    decelerate: (t) => t,
    accelerate: (t) => t,
    bounce: (t) => t,
  },
  enter: { delayStepMs: 40 },
};

export const DEFAULT_DARK_THEME: ThemeModule = {
  id: 'default-dark',
  name: 'Default (dark)',
  tokens: DEFAULT_DARK_TOKENS,
  palette: makeDefaultPalette(DARK_STATE_RAMP, DEFAULT_DARK_TOKENS.color.bg),
  motion: IDENTITY_MOTION,
  cost: 'low',
};

export const DEFAULT_LIGHT_THEME: ThemeModule = {
  id: 'default-light',
  name: 'Default (light)',
  tokens: DEFAULT_LIGHT_TOKENS,
  palette: makeDefaultPalette(LIGHT_STATE_RAMP, DEFAULT_LIGHT_TOKENS.color.bg),
  motion: IDENTITY_MOTION,
  cost: 'low',
};

/** The id a theme picker actually lists and selects — `themes/registry.ts`'s
 * `AdaptiveThemeModule`, resolved to whichever of the two modules above matches
 * `prefers-color-scheme` at activation time. */
export const DEFAULT_THEME: AdaptiveThemeModule = {
  kind: 'adaptive',
  id: 'default',
  name: 'Default',
  light: DEFAULT_LIGHT_THEME,
  dark: DEFAULT_DARK_THEME,
};
