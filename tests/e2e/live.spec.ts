import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test.describe('/live connect and receive', () => {
  test('opening /live connects and receives a keyframe', async ({ page }) => {
    await gotoApp(page, '/live');
    await page.waitForFunction(
      () => window.__fancyGol?.liveState === 'open' && (window.__fancyGol?.liveMessageCount ?? 0) >= 1,
      null,
      { timeout: 15_000 },
    );
    expect(await page.evaluate(() => window.__fancyGol?.liveState)).toBe('open');
    expect(await page.evaluate(() => window.__fancyGol?.liveMessageCount ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
