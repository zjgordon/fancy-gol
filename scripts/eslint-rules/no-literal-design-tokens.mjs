/**
 * no-literal-design-tokens — hand-written ESLint rule (P1-E-1), the enforcement half of the
 * design-token contract (`src/themes/types.ts` + `src/themes/tokens.css`, ADR-008).
 *
 * `src/ui/**` may never hardcode a colour or a raw motion duration/size: every such value must
 * come from a `--gol-*` custom property (read in CSS) or a resolved theme value handed in by a
 * caller (read in TS) — never typed directly into a component. This rule is the difference
 * between that being a convention and it being a build failure.
 *
 * No-bloat by design: no `eslint-plugin-*` package, just the plain ESLint rule API this project
 * already depends on. Detection is a small pure function (`findLiteralViolation`), unit-tested
 * directly in `tests/unit/eslint-rules/no-literal-design-tokens.spec.ts` the same way
 * `scripts/check-boundaries.mjs`'s pure functions are — the rule object below is a thin adapter
 * over it.
 */

const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/;
const COLOR_FUNCTION_RE = /\b(?:rgba?|hsla?)\(/i;
const RAW_DURATION_OR_SIZE_RE = /^\d+(?:\.\d+)?(?:ms|px)$/;

/**
 * Given a string literal's value, return a human-readable reason it violates the token contract,
 * or `null` if it's fine. Exported so it can be unit-tested without going through ESLint at all.
 */
export function findLiteralViolation(value) {
  if (typeof value !== 'string') return null;
  if (HEX_COLOR_RE.test(value)) {
    return `a literal hex colour ("${value}")`;
  }
  if (COLOR_FUNCTION_RE.test(value)) {
    return `a literal rgb()/hsl() colour ("${value}")`;
  }
  if (RAW_DURATION_OR_SIZE_RE.test(value)) {
    return `a raw duration/size value ("${value}")`;
  }
  return null;
}

/**
 * `src/ui/overlay/grid-lines.ts` and `src/ui/overlay/selection.ts` both build CSS colour strings
 * at runtime from theme-supplied RGB components (`` `rgba(${r}, ${g}, ${b}, ${a})` ``) — that is
 * exactly the sanctioned pattern (a resolved value assembled from tokens), not a literal, so a
 * template literal only counts as "literal" when it has no interpolation at all.
 */
function isEffectivelyLiteral(templateLiteralNode) {
  return templateLiteralNode.expressions.length === 0;
}

export const noLiteralDesignTokens = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban literal colours (#hex, rgb()/rgba()/hsl()/hsla()) and raw ms/px duration or size strings in src/ui/**; read a --gol-* design token instead (ADR-008, P1-E-1).',
    },
    schema: [],
    messages: {
      literal:
        '{{reason}} is hardcoded here. src/ui/** may not contain design-value literals — read the value from a --gol-* token (see src/themes/tokens.css) instead.',
    },
  },
  create(context) {
    function report(node, value) {
      const reason = findLiteralViolation(value);
      if (reason) context.report({ node, messageId: 'literal', data: { reason } });
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') report(node, node.value);
      },
      TemplateLiteral(node) {
        if (isEffectivelyLiteral(node)) report(node, node.quasis[0].value.cooked);
      },
    };
  },
};
