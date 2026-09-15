import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { noCssTransitionOnChrome } from '../../../scripts/eslint-rules/no-css-transition-on-chrome.mjs';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-css-transition-on-chrome (ESLint rule)', () => {
  it('flags style.transition assignment in a dialog module', () => {
    tester.run('local/no-css-transition-on-chrome', noCssTransitionOnChrome, {
      valid: [
        {
          code: 'el.style.opacity = "1";',
          filename: '/workspace/src/ui/components/dialog.ts',
        },
      ],
      invalid: [
        {
          code: 'el.style.transition = "opacity 150ms linear";',
          filename: '/workspace/src/ui/components/dialog.ts',
          errors: [{ messageId: 'forbidden' }],
        },
        {
          code: 'const css = "transition: opacity 1s";',
          filename: '/workspace/src/ui/components/toast.ts',
          errors: [{ messageId: 'forbidden' }],
        },
      ],
    });
  });

  it('ignores unrelated files', () => {
    tester.run('local/no-css-transition-on-chrome', noCssTransitionOnChrome, {
      valid: [
        {
          code: 'el.style.transition = "opacity 150ms linear";',
          filename: '/workspace/src/ui/camera.ts',
        },
      ],
      invalid: [],
    });
  });
});
