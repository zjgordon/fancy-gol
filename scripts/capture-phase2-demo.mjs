/**
 * Capture docs/demo/phase-2.gif — library drop, live charts, HighLife apply.
 * Run: npm run build && node scripts/capture-phase2-demo.mjs
 *
 * Sibling of capture-phase1-demo.mjs. The general pipeline is P6-F-1
 * (`scripts/capture.mjs`); this stays a short phase-proof walk until then.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRAMES = join(ROOT, 'docs/demo/.phase-2-frames');
const OUT = join(ROOT, 'docs/demo/phase-2.gif');
const PORT = Number(process.env['E2E_PORT'] ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME_1237 = '/opt/ms-playwright/chromium-1237/chrome-linux64/chrome';

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const child = spawn('node', ['dist/server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ENABLE_LIVE: '1' },
  stdio: 'ignore',
});

async function waitHealth(ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become healthy');
}

function frame(n) {
  return join(FRAMES, `f${String(n).padStart(3, '0')}.png`);
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    if (!existsSync(CHROME_1237)) throw err;
    console.warn('Playwright default Chromium missing; using chromium-1237 for the demo GIF');
    return chromium.launch({ executablePath: CHROME_1237 });
  }
}

try {
  await waitHealth();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('gol.session');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/?test=1`);
  await page.waitForFunction(() => window.__fancyGol?.ready === true);

  await page.keyboard.press('c');
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
  await page.waitForFunction(() => window.__fancyGol?.population === 0);

  let i = 0;
  const shot = async () => {
    await page.screenshot({ path: frame(i++), type: 'png' });
  };

  await page.getByRole('tab', { name: 'Library' }).click();
  await shot();

  const search = page.getByLabel('Search patterns');
  await search.fill('Gosper');
  const card = page.locator('[data-id="gosper-gun"]');
  await card.waitFor({ state: 'visible' });
  await shot();

  const canvas = page.locator('#scene');
  const cardBox = await card.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!cardBox || !canvasBox) throw new Error('no card or canvas box');
  // Drop on open grid: clear of the toolbar (left, centred) and the transport dock (bottom
  // centre), with room down-and-right for the gun's glider stream.
  const from = { x: cardBox.x + Math.min(48, cardBox.width / 2), y: cardBox.y + 24 };
  const to = { x: canvasBox.x + canvasBox.width * 0.3, y: canvasBox.y + canvasBox.height * 0.22 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await shot();
  const steps = 8;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * s) / steps,
      from.y + ((to.y - from.y) * s) / steps,
    );
    await shot();
  }
  // The pointer frames above are the real gesture; the drop itself is dispatched because
  // Playwright's synthetic mouse does not drive HTML5 drag-and-drop. This is the same
  // `LIBRARY_DRAG_TYPE` DataTransfer the canvas listener consumes in production, so the
  // outcome on screen is the one a user's drag produces — not a synthetic paint.
  await page.evaluate(({ id, x, y }) => {
    const el = document.querySelector('#scene');
    if (!(el instanceof HTMLCanvasElement)) throw new Error('no canvas');
    const dt = new DataTransfer();
    dt.setData('application/x-fancy-gol-pattern', id);
    dt.setData('text/plain', id);
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }, { id: 'gosper-gun', x: to.x, y: to.y });
  await page.mouse.up();
  const dropped = await page.evaluate(() => window.__fancyGol?.population ?? 0);
  if (dropped === 0) {
    await card.click();
    await page.getByRole('button', { name: 'Stamp' }).click();
    await page.mouse.click(to.x, to.y);
  }
  await page.waitForFunction(() => (window.__fancyGol?.population ?? 0) > 0);
  await shot();

  await page.getByRole('tab', { name: 'Statistics' }).click();
  await page.keyboard.press('Space');
  for (let t = 0; t < 10; t++) {
    await page.waitForTimeout(120);
    await shot();
  }
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.waitForTimeout(200);
  await shot();

  await page.getByRole('tab', { name: 'Ruleset Studio' }).click();
  await shot();

  const notation = page.getByLabel('Rule notation');
  await notation.fill('B36/S23');
  await notation.blur();
  await page.waitForFunction(() => {
    const btn = document.querySelector('.studio-apply');
    return btn instanceof HTMLButtonElement && !btn.disabled;
  });
  await shot();

  const reset = page.locator('#studio-reset-on-apply');
  if (await reset.isChecked()) await reset.uncheck();
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(200);
  await shot();

  await page.getByRole('tab', { name: 'Statistics' }).click();
  // Advanced mode is taller than the dock, so the charts start below the fold. Scroll to them:
  // the divergence after the rule change is the point of the last beat.
  await page.locator('.panel-host-panel').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  // Long enough for the growth classifier to reach its 64-sample floor rather than ending the
  // demo on "insufficient data".
  for (let t = 0; t < 18; t++) {
    await page.waitForTimeout(140);
    await shot();
  }

  await browser.close();

  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      '8',
      '-i',
      join(FRAMES, 'f%03d.png'),
      '-vf',
      'scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse',
      OUT,
    ],
    { encoding: 'utf8' },
  );
  if (ff.status !== 0) {
    writeFileSync(join(ROOT, 'docs/demo/phase-2-ffmpeg.log'), ff.stderr || ff.stdout || '');
    throw new Error(`ffmpeg failed: ${ff.stderr}`);
  }
  console.log(`wrote ${OUT} (${i} frames)`);
} finally {
  child.kill('SIGTERM');
  rmSync(FRAMES, { recursive: true, force: true });
}
