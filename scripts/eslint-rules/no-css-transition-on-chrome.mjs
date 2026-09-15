/**
 * no-css-transition-on-chrome — P3-A-6.
 *
 * Panels, dialogs, toasts and tooltips must animate through `themes/motion/animate`, never a
 * raw CSS `transition` (or `element.style.transition = …`). Hand-written rule, No Bloat.
 */

const FORBIDDEN_FILES = /(panel-host|dialog|toast|tooltip)\.ts$/;

/**
 * True when a string literal looks like a CSS transition declaration.
 * Exported for direct unit tests.
 */
export function isCssTransitionLiteral(value) {
  if (typeof value !== 'string') return false;
  return /(?:^|[;\s{])transition(?:-delay|-duration|-property|-timing-function)?\s*:/i.test(
    value,
  ) || value.trim().toLowerCase().startsWith('transition');
}

export const noCssTransitionOnChrome = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban CSS transition on panel/dialog/toast/tooltip components — use themes/motion/animate (P3-A-6).',
    },
    schema: [],
    messages: {
      forbidden:
        'Raw CSS transition is banned on panel/dialog/toast/tooltip — use motion.animate(el, kind) (P3-A-6).',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? '';
    if (!FORBIDDEN_FILES.test(filename.replace(/\\/g, '/'))) {
      return {};
    }

    function reportIfTransitionString(node, value) {
      if (isCssTransitionLiteral(value)) {
        context.report({ node, messageId: 'forbidden' });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') reportIfTransitionString(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          reportIfTransitionString(node, node.quasis[0].value.cooked ?? '');
        }
      },
      AssignmentExpression(node) {
        const left = node.left;
        if (
          left.type === 'MemberExpression' &&
          !left.computed &&
          left.property.type === 'Identifier' &&
          left.property.name === 'transition'
        ) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};
