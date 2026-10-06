/**
 * no-per-frame-pixel-io — P3-E-5 (ADR-012 rule 1).
 *
 * Inside an effect pass's `render` / `renderTimed`, pixels are never read back or written by hand:
 * no `readSourcePixels`, `getImageData`, `putImageData`, `createImageData`, and no typed-array or
 * `ImageData` allocation. Those are what made P3-D-4's themes cost 40–110 ms a frame and paint
 * nothing. Bake at activation or resize (a `bake*` / `resize` method is fine); composite per frame.
 * Hand-written rule, No Bloat.
 */

const FRAME_METHODS = new Set(['render', 'renderTimed']);
const PIXEL_CALLS = new Set(['readSourcePixels', 'getImageData', 'putImageData', 'createImageData']);
const BUFFER_TYPES = new Set([
  'ImageData',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
  'ArrayBuffer',
]);

function keyName(node) {
  const key = node.key;
  if (!key || node.computed) return null;
  return key.type === 'Identifier' ? key.name : null;
}

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

export const noPerFramePixelIo = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban pixel read-back/write and typed-array allocation inside effect-pass render methods (ADR-012 rule 1).',
    },
    schema: [],
    messages: {
      pixelCall:
        '`{{name}}` inside a per-frame render method. Bake at activation/resize and composite with drawImage (ADR-012 rule 1).',
      allocation:
        '`new {{name}}` inside a per-frame render method. Allocate at activation/resize, never per frame (ADR-012 rule 1).',
    },
  },
  create(context) {
    let depth = 0;
    const isFrameMethod = (node) => {
      const fn = node.value;
      if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression')) return false;
      return FRAME_METHODS.has(keyName(node) ?? '');
    };
    const enter = (node) => {
      if (isFrameMethod(node)) depth += 1;
    };
    const leave = (node) => {
      if (isFrameMethod(node)) depth -= 1;
    };
    return {
      MethodDefinition: enter,
      'MethodDefinition:exit': leave,
      Property: enter,
      'Property:exit': leave,
      PropertyDefinition: enter,
      'PropertyDefinition:exit': leave,
      CallExpression(node) {
        if (depth === 0) return;
        const name = calleeName(node.callee);
        if (name && PIXEL_CALLS.has(name)) context.report({ node, messageId: 'pixelCall', data: { name } });
      },
      NewExpression(node) {
        if (depth === 0) return;
        if (node.callee.type === 'Identifier' && BUFFER_TYPES.has(node.callee.name)) {
          context.report({ node, messageId: 'allocation', data: { name: node.callee.name } });
        }
      },
    };
  },
};
