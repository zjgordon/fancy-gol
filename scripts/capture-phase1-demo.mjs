/**
 * Capture docs/demo/phase-1.gif — draw, pan, zoom, run.
 * Run: npm run build && PLAYWRIGHT_BROWSERS_PATH=0 node scripts/capture-phase1-demo.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRAMES = join(ROOT, 'docs/demo/.phase-1-frames');
const OUT = join(ROOT, 'docs/demo/phase-1.gif');
const PORT = Number(process.env['E2E_PORT'] ?? 8080);
const BASE = `http://127.0.0.1:${PORT}`;

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

try {
  await waitHealth();
  const browser = await chromium.launch();
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

  await page.keyboard.press('b');
  await shot();

  const cell = await page.evaluate(() => {
    const api = window.__fancyGol;
    const w = api.screenToWorld(api.widthPx / 2, api.heightPx / 2);
    return { x: Math.round(w.x), y: Math.round(w.y) };
  });
  const glider = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  for (const [dx, dy] of glider) {
    const pt = await page.evaluate(
      ({ wx, wy }) => {
        const api = window.__fancyGol;
        const canvas = document.querySelector('#scene');
        const rect = canvas.getBoundingClientRect();
        const s = api.worldToScreen(wx + 0.25, wy + 0.25);
        return { x: rect.left + s.px, y: rect.top + s.py };
      },
      { wx: cell.x + dx, wy: cell.y + dy },
    );
    await page.mouse.click(pt.x, pt.y);
    await shot();
  }

  const canvasBox = await page.locator('#scene').boundingBox();
  if (!canvasBox) throw new Error('no canvas');
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  for (let step = 0; step < 8; step++) {
    await page.mouse.move(cx + step * 24, cy + step * 8);
    await shot();
  }
  await page.mouse.up({ button: 'middle' });

  for (let z = 0; z < 6; z++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(50);
    await shot();
  }
  for (let z = 0; z < 4; z++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(50);
    await shot();
  }

  await page.keyboard.press('Space');
  for (let t = 0; t < 12; t++) {
    await page.waitForTimeout(80);
    await shot();
  }
  await page.keyboard.press('Space');
  await shot();

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
    writeFileSync(join(ROOT, 'docs/demo/phase-1-ffmpeg.log'), ff.stderr || ff.stdout || '');
    throw new Error(`ffmpeg failed: ${ff.stderr}`);
  }
  console.log(`wrote ${OUT} (${i} frames)`);
} finally {
  child.kill('SIGTERM');
  rmSync(FRAMES, { recursive: true, force: true });
}
