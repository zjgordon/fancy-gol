/**
 * Hand-written colour maths (no-bloat rule: no `culori`/`chroma.js`/`color2k`) shared by every
 * theme (ADR-009: `shared/` may only import itself, and both `themes/` and `ui/` may import
 * `shared/`, so this is the one legal home for logic every theme needs, not just the Default
 * one). Four independent pieces, each usable on its own:
 *
 * - {@link oklch} — OKLCH → sRGB, Björn Ottosson's published (public-domain) reference formulas.
 *   Lets a theme *state* its palette as perceptually-even lightness/chroma/hue and get plain hex
 *   back, computed once, not a per-frame conversion (P1-E-3's "no colour library at runtime").
 * - {@link relativeLuminance} / {@link contrastRatio} / {@link meetsWcagAA} — WCAG 2.x contrast,
 *   the exact check `planning/README.md` §3.7 requires of every theme's chrome text, not just
 *   the Default one.
 * - {@link parseCssColor} / {@link compositeOver} — reading back the `#hex`/`rgb()`/`rgba()`
 *   strings a `TokenSet` actually stores, so contrast can be checked against what a token
 *   *resolves to*, including alpha-blended surfaces composited over a base colour.
 * - {@link simulateColorBlindness} — Machado, Oliveira & Fluck (2009) full-severity protanopia/
 *   deuteranopia simulation matrices (the same ones Chromium's own DevTools vision-deficiency
 *   emulation uses), operating in linear RGB. A *documented approximation*, not a substitute for
 *   real user testing or a screen-reader-grade tool — labelled as such per this project's "never
 *   present an approximation as exact" rule, and used here only to catch a palette that
 *   collapses two states onto the same colour for the ~4% of viewers with red-green colour
 *   vision deficiency, not to certify accessibility on its own.
 */

// -------------------------------------------------------------------------------------------
// sRGB
// -------------------------------------------------------------------------------------------

/** 8-bit-per-channel sRGB. Not exported as a class — every consumer here just needs the shape. */
export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RGBA extends RGB {
  /** `0` (fully transparent) to `1` (fully opaque). */
  readonly a: number;
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** sRGB channel (0-255) → linear-light (0-1), the standard piecewise gamma. */
function srgbToLinearChannel(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-light (0-1, unclamped — a wide-gamut OKLCH colour can overshoot) → sRGB channel (0-1). */
function linearToSrgbChannel(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

// -------------------------------------------------------------------------------------------
// OKLCH → sRGB (Björn Ottosson, https://bottosson.github.io/posts/oklab/ — public domain)
// -------------------------------------------------------------------------------------------

/**
 * `L` 0-1 (perceptual lightness), `C` typically 0-0.4 (chroma; 0 is grey), `hueDeg` 0-360.
 * Out-of-gamut results are clamped per channel rather than gamut-mapped — adequate for a
 * hand-picked palette tuned by inspecting its own output (P1-E-3), not for arbitrary input.
 */
export function oklch(L: number, C: number, hueDeg: number): RGB {
  const hue = (hueDeg * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const linearR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linearG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linearB = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return {
    r: clampByte(linearToSrgbChannel(linearR) * 255),
    g: clampByte(linearToSrgbChannel(linearG) * 255),
    b: clampByte(linearToSrgbChannel(linearB) * 255),
  };
}

// -------------------------------------------------------------------------------------------
// Parsing / compositing the CSS strings a TokenSet actually stores
// -------------------------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

function expandShortHex(hex: string): string {
  return hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
}

/** Parses a `#hex`/`#rgba`/`rgb()`/`rgba()` CSS colour string a `TokenSet` might hold. Returns
 * `null` for anything else (a named colour, a `color-mix()` expression, …) — this project's
 * tokens never use those, so a caller failing loudly on `null` is the honest behaviour. */
export function parseCssColor(value: string): RGBA | null {
  const trimmed = value.trim();
  const hexMatch = HEX_RE.exec(trimmed);
  if (hexMatch) {
    const hex = expandShortHex(hexMatch[1] as string);
    const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    const a = hex.length === 8 ? byte(6) / 255 : 1;
    return { r: byte(0), g: byte(2), b: byte(4), a };
  }
  const fnMatch = RGB_FN_RE.exec(trimmed);
  if (fnMatch) {
    return {
      r: Number(fnMatch[1]),
      g: Number(fnMatch[2]),
      b: Number(fnMatch[3]),
      a: fnMatch[4] === undefined ? 1 : Number(fnMatch[4]),
    };
  }
  return null;
}

/** Alpha-blends `fg` over an opaque `bg` (the "surface floats over the canvas backdrop" case
 * every translucent chrome panel token is). Standard "over" compositing, per channel. */
export function compositeOver(fg: RGBA, bg: RGB): RGB {
  if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b };
  const blend = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: blend(fg.r, bg.r), g: blend(fg.g, bg.g), b: blend(fg.b, bg.b) };
}

/** Parses `value` and, if it carries any transparency, composites it over `base` first — the one
 * call a contrast check needs regardless of whether the token was opaque to begin with. */
export function resolveOpaqueColor(value: string, base: RGB): RGB {
  const rgba = parseCssColor(value);
  if (!rgba) throw new Error(`not a colour this project's tokens ever use: "${value}"`);
  return compositeOver(rgba, base);
}

// -------------------------------------------------------------------------------------------
// WCAG contrast
// -------------------------------------------------------------------------------------------

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (c255: number) => srgbToLinearChannel(c255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black vs white). Order of the two colours doesn't matter. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA: 4.5:1 for normal text, 3:1 for large text (≥18pt, or ≥14pt bold) and UI components. */
export function meetsWcagAA(fg: RGB, bg: RGB, options: { readonly large?: boolean } = {}): boolean {
  return contrastRatio(fg, bg) >= (options.large ? 3 : 4.5);
}

// -------------------------------------------------------------------------------------------
// Colour-vision-deficiency simulation (Machado, Oliveira & Fluck 2009; full severity)
// -------------------------------------------------------------------------------------------

type Matrix3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const PROTANOPIA: Matrix3 = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];

const DEUTERANOPIA: Matrix3 = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

export type ColorBlindnessKind = 'protanopia' | 'deuteranopia';

/** Simulates full-severity red-green colour vision deficiency by applying a published linear-RGB
 * transform matrix. An approximation of a population-average deficiency, not a substitute for
 * testing with real colour-vision-deficient users — see this module's own header note. */
export function simulateColorBlindness(rgb: RGB, kind: ColorBlindnessKind): RGB {
  const m = kind === 'protanopia' ? PROTANOPIA : DEUTERANOPIA;
  const lr = srgbToLinearChannel(rgb.r);
  const lg = srgbToLinearChannel(rgb.g);
  const lb = srgbToLinearChannel(rgb.b);
  const apply = (row: Matrix3[number]) => row[0] * lr + row[1] * lg + row[2] * lb;
  return {
    r: clampByte(linearToSrgbChannel(apply(m[0])) * 255),
    g: clampByte(linearToSrgbChannel(apply(m[1])) * 255),
    b: clampByte(linearToSrgbChannel(apply(m[2])) * 255),
  };
}

/** Plain Euclidean distance in sRGB space, 0 (identical) to ~441 (black vs white). Simple by
 * design: this only ever ranks "closer" vs "further apart" for a handful of hand-picked palette
 * colours, not perceptual uniformity across the whole gamut — {@link oklch} is what handles
 * perceptual evenness for the palette itself. */
export function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
