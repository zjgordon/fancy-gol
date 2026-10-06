import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { noPerFramePixelIo } from '../../../scripts/eslint-rules/no-per-frame-pixel-io.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('no-per-frame-pixel-io (ESLint rule, P3-E-5)', () => {
  it('fires on pixel IO and buffer allocation inside render / renderTimed, and only there', () => {
    tester.run('local/no-per-frame-pixel-io', noPerFramePixelIo, {
      valid: [
        // Baking at activation / resize is the point of the rule.
        { code: 'class P { bake() { const i = ctx.createImageData(8, 8); ctx.putImageData(i, 0, 0); } }' },
        { code: 'class P { resize() { this.buf = new Uint8ClampedArray(64); } }' },
        { code: 'class P { render(ctx) { ctx.drawImage(this.tile, 0, 0); ctx.fillRect(0, 0, 1, 1); } }' },
        { code: 'const p = { resize() { new Float32Array(4); } };' },
      ],
      invalid: [
        { code: 'class P { render(ctx) { ctx.getImageData(0, 0, 8, 8); } }', errors: [{ messageId: 'pixelCall' }] },
        { code: 'class P { renderTimed(ctx) { ctx.putImageData(img, 0, 0); } }', errors: [{ messageId: 'pixelCall' }] },
        { code: 'class P { render(ctx) { readSourcePixels(a, 1, 1); } }', errors: [{ messageId: 'pixelCall' }] },
        { code: 'class P { render(ctx) { ctx.createImageData(8, 8); } }', errors: [{ messageId: 'pixelCall' }] },
        { code: 'class P { render() { const b = new Uint8ClampedArray(64); } }', errors: [{ messageId: 'allocation' }] },
        { code: 'class P { render() { new ImageData(2, 2); } }', errors: [{ messageId: 'allocation' }] },
        // A closure inside render is still per-frame.
        { code: 'class P { render(ctx) { [1].forEach(() => ctx.getImageData(0, 0, 1, 1)); } }', errors: [{ messageId: 'pixelCall' }] },
        // Object-literal passes (test doubles, factory passes).
        { code: 'const p = { render(ctx) { new Float64Array(8); } };', errors: [{ messageId: 'allocation' }] },
      ],
    });
  });
});
