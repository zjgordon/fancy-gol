/**
 * Studio-facing validation shapes (P2-E-1). Mirrors the engine's `RuleValidationIssue`
 * without importing `@engine` — `ui/` may not reach that layer (ADR-009).
 */

export interface StudioIssue {
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
}

export interface LocatedStudioIssue extends StudioIssue {
  readonly line: number;
  readonly column: number;
}

export type StudioValidation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly StudioIssue[] };

export type StudioValidate = (value: unknown) => StudioValidation;
