/**
 * Overlay catalogue metadata on a parsed Life-family rule without losing the
 * notation parser as the single source of B/S/G digits.
 */
import { SCHEMA_VERSION } from '../schema';
import { parseRuleNotation } from '../parse';
import type { BuiltinRuleSet, BuiltinTag } from './types';

export interface LifeMeta {
  readonly id: string;
  readonly notation: string;
  readonly name: string;
  readonly description: string;
  readonly author?: string;
  readonly year?: number;
  readonly tags: readonly BuiltinTag[];
}

export function fromNotation(meta: LifeMeta): BuiltinRuleSet {
  const parsed = parseRuleNotation(meta.notation);
  const base: BuiltinRuleSet = {
    version: SCHEMA_VERSION,
    id: meta.id,
    name: meta.name,
    description: meta.description,
    states: parsed.states,
    neighborhood: parsed.neighborhood,
    transition: parsed.transition,
    boundary: 'toroidal',
    tags: meta.tags,
  };
  const extra: { author?: string; year?: number } = {};
  if (meta.author !== undefined) extra.author = meta.author;
  if (meta.year !== undefined) extra.year = meta.year;
  return { ...base, ...extra };
}
