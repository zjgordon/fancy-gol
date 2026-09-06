/**
 * The design-token and theme contract (ADR-008, P1-E-1).
 *
 * `TokenSet` enumerates every value the UI chrome will ever need — colour, type, space, radius,
 * shadow and motion — each one applied by `themes/registry.ts` (P1-E-2) as a `--gol-*` custom
 * property on `:root`. Components never hold a literal: they read `var(--gol-*)` from CSS, and
 * the ESLint rule at `scripts/eslint-rules/no-literal-design-tokens.mjs` (wired into
 * `eslint.config.js` for `src/ui/**`) makes that a build failure, not a convention.
 *
 * `ThemeModule` is ADR-008's full contract. Phase 1's Default theme (P1-E-3) only ever
 * populates `id`, `name`, `tokens`, `palette` and `motion` — the render hooks, `sound` and
 * `shaders` fields are Phase 3 scope, declared as optional here now so the registry (P1-E-2)
 * and every later theme slot in without a breaking change to this file or its callers.
 */
import type { CellPalette, Viewport } from '@render/types';
import type { StateId } from '@shared/types';

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

/** Every role-based colour the chrome consumes. Names are roles, never theme-specific — see this
 * task's own acceptance criterion: no `--gol-neon-pink`, only what the role *does*. */
export interface ColorTokens {
  readonly bg: string;
  readonly surface: string;
  readonly elevated: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly accentPressed: string;
  readonly onAccent: string;
  readonly scrim: string;
  readonly danger: string;
  readonly dangerStrong: string;
  readonly success: string;
  readonly successStrong: string;
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

/** 6 sizes, small to large. Named, not numbered — a theme reshuffling the scale never forces a
 * component to know that `lg` used to be `18px`. */
export type FontSizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

/** 3 weights. `bold` is reserved for the rare emphatic label; most chrome text is `regular`. */
export type FontWeightKey = 'regular' | 'medium' | 'bold';

/** 2 letter-spacings: prose stays `normal`, small-caps-style headings (e.g. the ruleset picker's
 * group titles) use `wide`. */
export type LetterSpacingKey = 'normal' | 'wide';

export interface TypeTokens {
  readonly fontFamily: string;
  readonly fontFamilyMono: string;
  readonly size: Readonly<Record<FontSizeKey, string>>;
  readonly weight: Readonly<Record<FontWeightKey, number>>;
  readonly letterSpacing: Readonly<Record<LetterSpacingKey, string>>;
}

// ---------------------------------------------------------------------------------------------
// Space, radius, shadow
// ---------------------------------------------------------------------------------------------

/** A 7-step space scale, the same shape `.agents/dashboard.html`'s own hand-rolled scale uses —
 * one steady progression for every gap, padding and margin in the chrome. */
export type SpaceKey = '1' | '2' | '3' | '4' | '5' | '6' | '7';

export type RadiusKey = 'sm' | 'md' | 'lg';

export type ShadowKey = 'sm' | 'md' | 'lg';

// ---------------------------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------------------------

/** 4 durations: `instant` for state that must never visibly animate (a toggle under
 * `prefers-reduced-motion`), `fast`/`slow` for the two speeds already load-bearing in
 * `client/index.html`'s interim tokens (chrome fade, region stagger), `slower` for the rare
 * full-scene transition (a theme switch's own cross-fade, Phase 3). */
export type DurationKey = 'instant' | 'fast' | 'slow' | 'slower';

/** 5 easings. `standard` is the curve already shipping in `client/index.html`
 * (`cubic-bezier(0.22, 0.61, 0.36, 1)`) and the one `ui/overlay/grid-lines.ts`'s `SMOOTHSTEP`
 * placeholder and `ui/overlay/selection.ts`'s march animation are provisionally standing in for
 * — see this task's own follow-up note. `bounce` exists purely because Agit-Prop applies to
 * motion too: a purely linear/eased UI is the "just okay" this project refuses to ship. */
export type EasingKey = 'linear' | 'standard' | 'decelerate' | 'accelerate' | 'bounce';

export interface MotionTokens {
  readonly duration: Readonly<Record<DurationKey, string>>;
  readonly easing: Readonly<Record<EasingKey, string>>;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

/** Non-colour, non-motion chrome effects. `blur.chrome` is already load-bearing in
 * `client/index.html` (the panel backdrop blur, with a `@supports not` fallback). A single entry
 * today; a theme with heavier post-processing (Phase 3) grows this, it never shrinks it. */
export interface EffectTokens {
  readonly blur: Readonly<{ chrome: string }>;
}

// ---------------------------------------------------------------------------------------------
// The token set
// ---------------------------------------------------------------------------------------------

/** Every design token the UI will ever need, grouped by kind. Applied wholesale to `:root` by
 * `themes/registry.ts`'s `activate()` (P1-E-2); `themes/tokens.css` is this same contract
 * expressed as documented CSS custom properties with Default-theme fallback values, so the app
 * never has an undefined `--gol-*` variable even before any JS runs. */
export interface TokenSet {
  readonly color: ColorTokens;
  readonly type: TypeTokens;
  readonly space: Readonly<Record<SpaceKey, string>>;
  readonly radius: Readonly<Record<RadiusKey, string>>;
  readonly shadow: Readonly<Record<ShadowKey, string>>;
  readonly motion: MotionTokens;
  readonly effect: EffectTokens;
}

// ---------------------------------------------------------------------------------------------
// Motion signature — the non-CSS half of "motion"
// ---------------------------------------------------------------------------------------------

/** A resolved easing curve: `t` in `[0, 1]` (elapsed / total), returns the eased progress. Same
 * shape as `ui/overlay/grid-lines.ts`'s `FadeCurve` and the `Easing` parameter `ui/camera.ts`'s
 * `animateTo` already accepts — this is the type those provisional call sites rewire onto. */
export type Easing = (t: number) => number;

/** The non-CSS twin of `TokenSet.motion`: code that animates a canvas, a camera move, or a
 * dash-offset (nothing a CSS transition can reach) needs the *durations as numbers* and the
 * *easings as functions*, not `var(--gol-*)` strings a `<canvas>` context can't resolve. Same
 * named keys as `TokenSet.motion` by design, so a theme author states one set of intentions and
 * both projections agree. `enter` is the staggered choreography `ui/components/shell.ts`'s
 * `playIntro` already needs (its `INTRO_STAGGER_MS` is exactly this, provisionally). */
export interface MotionSignature {
  readonly durationMs: Readonly<Record<DurationKey, number>>;
  readonly easings: Readonly<Record<EasingKey, Easing>>;
  readonly enter: { readonly delayStepMs: number };
}

// ---------------------------------------------------------------------------------------------
// Theme module (ADR-008)
// ---------------------------------------------------------------------------------------------

/** A 2D canvas context, whichever surface backs it. Duplicated locally rather than imported from
 * `ui/overlay/grid-lines.ts` — deliberate per-module-boundary duplication, the same treatment
 * that module's own `Camera`/`Clock` pair already got (see Phase 1's own architecture notes). */
type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The minimum a `drawCellOverride` hook (Phase 3) needs to paint one cell: which state it's in,
 * where it is, and how long it's been there — the same `(state, age)` pair `CellPalette` already
 * takes, plus the position a palette function doesn't need. Provisional shape: no Phase 3 theme
 * exists yet to prove it against a second call site. */
export interface CellDrawInfo {
  readonly state: StateId;
  readonly x: number;
  readonly y: number;
  readonly age: number;
}

/**
 * A theme is a module, not a stylesheet (ADR-008). Phase 1 populates `id`, `name`, `tokens`,
 * `palette`, `motion` and `cost` only (`themes/default/theme.ts`, P1-E-3, "no render hooks, no
 * post-processing"); everything below `cost` is Phase 3 scope, optional so this interface never
 * needs a breaking change when the six themes arrive.
 */
export interface ThemeModule {
  readonly id: string;
  readonly name: string;
  readonly tokens: TokenSet;
  /** `StateId → colour ramp by age` (ADR-008) — the exact function shape `render/types.ts`'s
   * `CellPalette` already defines; a theme just supplies one, computed however it likes (P1-E-3:
   * "OKLCH-derived, computed at build time into plain sRGB values — no colour library at
   * runtime"). Not redefined here: `render/types.ts`'s own doc comment already calls this file
   * an extension of that shape, not a replacement for it. */
  readonly palette: CellPalette;
  readonly motion: MotionSignature;
  /** `SoundPack` — Phase 3. `src/audio/types.ts` doesn't exist yet, so this is honestly `unknown`
   * rather than a type this task would have to invent and then discard. */
  readonly sound?: unknown;
  readonly drawBackground?: (ctx: Canvas2DContext, vp: Viewport, tick: number) => void;
  readonly drawCellOverride?: (ctx: Canvas2DContext, cell: CellDrawInfo) => void;
  readonly postProcess?: (ctx: Canvas2DContext, vp: Viewport, tick: number) => void;
  readonly shaders?: { readonly vertex: string; readonly fragment: string };
  /** Drives the Phase 3 auto-degrade governor (ADR-008's guard rail). Every theme states its own
   * cost; Phase 1's Default is always `'low'` — "it must be the *fastest* theme" (P1-E-3). */
  readonly cost: 'low' | 'medium' | 'high';
}
