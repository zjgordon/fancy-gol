import { expect, test } from '@playwright/test';
import { gotoVisual, volatileMask } from './helpers';

test.describe('screenshot sensitivity', () => {
  test.use({ colorScheme: 'dark' });

  test('a deliberate 2 px padding change is caught', async ({ page }) => {
    await gotoVisual(page);
    const before = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: volatileMask(page),
    });

    await page.addStyleTag({ content: '#chrome-transport { padding: 2px !important; }' });
    const after = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: volatileMask(page),
    });

    expect(after.equals(before), '2px padding on the transport must change the screenshot').toBe(false);
  });
});
