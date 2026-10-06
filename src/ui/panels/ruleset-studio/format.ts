/** A ruleset as the pretty-printed JSON a person would save or share. No imports: safe for the entry chunk. */
export function prettyRuleset(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
