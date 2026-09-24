/**
 * Derive chrome contrast pairs from the `ColorTokens` contract (P3-D-3).
 *
 * Roles are classified by name from ADR-008 / `themes/types.ts` — never by
 * hand-listing hex values per theme. A translucent token is resolved against
 * `bg` before comparison (the real canvas backdrop).
 */
import {
  contrastRatio,
  resolveOpaqueColor,
  type RGB,
} from '@shared/color';
import type { ColorTokens } from '@themes/types';

const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** Panel / page backdrops text sits on. */
const BACKDROP_ROLES = ['bg', 'surface', 'elevated'] as const satisfies readonly (keyof ColorTokens)[];

/** Foreground text roles that must clear AA on every backdrop. */
const TEXT_ROLES = ['text', 'muted'] as const satisfies readonly (keyof ColorTokens)[];

/** Fill roles that carry `onAccent` as their label colour. */
const FILL_ROLES = [
  'accent',
  'accentStrong',
  'accentPressed',
  'danger',
  'dangerStrong',
  'success',
  'successStrong',
] as const satisfies readonly (keyof ColorTokens)[];

export interface ContrastPair {
  readonly label: string;
  readonly fg: RGB;
  readonly bg: RGB;
  /** WCAG AA threshold: 4.5 for text, 3 for large / UI. */
  readonly minRatio: number;
}

/**
 * Every pairing the chrome actually produces from a `ColorTokens` set.
 * Asserting `Object.keys(ColorTokens)` coverage keeps new roles from slipping in unchecked.
 */
export function deriveChromeContrastPairs(color: ColorTokens): readonly ContrastPair[] {
  const keys = Object.keys(color) as (keyof ColorTokens)[];
  for (const role of [...BACKDROP_ROLES, ...TEXT_ROLES, ...FILL_ROLES, 'onAccent'] as const) {
    if (!keys.includes(role)) {
      throw new Error(`ColorTokens is missing role "${role}" — update deriveChromeContrastPairs`);
    }
  }

  const canvas = resolveOpaqueColor(color.bg, BLACK);
  const backdrops = BACKDROP_ROLES.map((role) => ({
    role,
    rgb: resolveOpaqueColor(color[role], canvas),
  }));

  const pairs: ContrastPair[] = [];

  for (const textRole of TEXT_ROLES) {
    const fg = resolveOpaqueColor(color[textRole], canvas);
    for (const { role: bgRole, rgb: bg } of backdrops) {
      pairs.push({
        label: `${textRole}/${bgRole}`,
        fg,
        bg,
        minRatio: 4.5,
      });
    }
  }

  const onAccent = resolveOpaqueColor(color.onAccent, canvas);
  for (const fillRole of FILL_ROLES) {
    pairs.push({
      label: `onAccent/${fillRole}`,
      fg: onAccent,
      bg: resolveOpaqueColor(color[fillRole], canvas),
      minRatio: 4.5,
    });
  }

  return pairs;
}

export function assertPairMeetsAa(pair: ContrastPair): void {
  const ratio = contrastRatio(pair.fg, pair.bg);
  if (ratio < pair.minRatio) {
    throw new Error(
      `${pair.label}: contrast ${ratio.toFixed(2)}:1 is below WCAG AA ${pair.minRatio}:1`,
    );
  }
}
