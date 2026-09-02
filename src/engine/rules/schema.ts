/**
 * The persisted shape of a rule document (ADR-001's `RuleSet` plus a schema version), and the
 * exact semantics of each `TransitionSpec` kind. This is the contract worked out in full,
 * with copy-pasteable examples, in `docs/ruleset-schema.md` — read that first if you're
 * writing a rule by hand.
 */
import type { RuleSet } from '../types';

/** Bumped whenever the persisted shape changes, so a future editor can migrate old documents. */
export const SCHEMA_VERSION = 1;

/** A `RuleSet` as it exists on disk or over the wire: the in-memory shape plus its version. */
export interface RuleSetDocument extends RuleSet {
  readonly version: number;
}

/**
 * `stateTable`'s indexing scheme (not fully pinned by ADR-001, specified here): a fully dense
 * transition table, `table[state * radix ** neighbourCount + Σ neighbourState_i * radix ** i]`,
 * where neighbour `i` is enumerated in the compiled neighbourhood's own offset order.
 * `radix` is the rule's state count. This is exact and unambiguous but grows as
 * `states * radix ** neighbourCount` — the compiler (P0-D-4) only chooses the `denseTable`
 * strategy when that fits under its size budget; larger rules (e.g. WireWorld's real 8-neighbour
 * table) still validate and run, generated programmatically rather than hand-written.
 */
export const STATE_TABLE_INDEXING_NOTE =
  'table[state * radix**neighbourCount + sum(neighbourState_i * radix**i)]';
