import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test.describe('/live connect and receive', () => {
  test('opening /live connects and receives a keyframe', async ({ page }) => {
    await gotoApp(page, '/live');
    await expect
      .poll(
        async () =>
          page.evaluate(() => ({
            ready: window.__fancyGol?.ready === true,
            liveState: window.__fancyGol?.liveState ?? null,
            liveMessageCount: window.__fancyGol?.liveMessageCount ?? 0,
          })),
        { timeout: 15_000 },
      )
      .toMatchObject({ ready: true, liveState: 'open' });

    const count = await page.evaluate(() => window.__fancyGol?.liveMessageCount ?? 0);
    expect(count, `expected ≥1 /live message after open; liveState=${await page.evaluate(() => window.__fancyGol?.liveState)}`).toBeGreaterThanOrEqual(1);
  });
});
