/**
 * Structured validation errors, shared by rule parsing/validation (P0-D-2) and anything else
 * in the engine that rejects malformed rule data (e.g. custom neighbourhood offsets). Errors
 * are always plural and carry a real JSON pointer `path` so Phase 2's editor can render them
 * inline next to the offending JSON.
 */
export interface RuleValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
}

export class RuleValidationError extends Error {
  readonly issues: readonly RuleValidationIssue[];

  constructor(issues: readonly RuleValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'RuleValidationError';
    this.issues = issues;
  }
}
