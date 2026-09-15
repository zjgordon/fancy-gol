# Sandbox feedback — Playwright Chromium install (`PLAYWRIGHT_BROWSERS_PATH`)

**Audience:** workspace / platform team (remediation), not a product change.
**Repo:** `fancy-gol`. Branch at writing: `phase/3-theme-engine`.
**Date:** 2026-09-15.
**Recorded by:** agent session on host `56d384aae06f` (user `abc`, uid 1000).
**Related:** `.agents/artifacts/SANDBOX-FEEDBACK-01.md` §6 (Node skew, `npm_config_devdir`);
Phase 2 already papered over a *revision* mismatch (`chromium-1237` vs suite `1243`) in
`scripts/capture-phase2-demo.mjs`. This note is the *permission* failure that blocked
installing 1243 at all.

P3-C-1 (Default theme upgrade) needed new Playwright visual baselines for panels/charts.
`npx playwright install chromium` ran for ~8 minutes and exited 1. New visual specs were
**not** committed; P3-D-2 still owns the 48 per-theme screenshots. The product files are
honest. This is environmental.

---

## 1. What we need from you

Agents in this sandbox cannot install or refresh Playwright browsers. The suite (`@playwright/test`
1.63.0) wants **Chromium revision 1243** (`browserVersion` 153.0.8010.12). The image only
ships **1237**, and the directory that Playwright is told to use is root-owned and not
writable by `uid 1000`.

If you only fix one thing: **make the Playwright browser cache writable by the agent user,
and pre-install the revision the repo's Playwright pin actually launches.**

---

## 2. Topology (as observed)

Same two-container layout as SANDBOX-FEEDBACK-01. Relevant facts for this bug:

```
┌─ agent container (this shell) ─────────────────────────────────┐
│  hostname 56d384aae06f, user abc (uid 1000)                    │
│  Node v24.20.0, npm 11.19.0                                    │
│  PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright   ← not writable   │
│  /opt/ms-playwright/chromium-1237              ← present        │
│  /opt/ms-playwright/chromium-1243              ← missing        │
│  DISPLAY=:1.0  (Playwright MCP can drive a real Chromium)      │
└────────────────────────────────────────────────────────────────┘
```

| Item | Value |
|---|---|
| Agent is a container | `/.dockerenv` present |
| Playwright npm | `playwright-core@1.63.0` (`package.json` `@playwright/test ^1.63.0`) |
| Expected Chromium | revision **1243** (`node_modules/playwright-core/browsers.json`) |
| Installed Chromium | revision **1237** only (`chromium-1237`, `chromium_headless_shell-1237`) |
| Browser cache | `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` |
| Cache owner | `root:root`, mode `drwxr-xr-x` (755) |
| Agent write probe | `touch /opt/ms-playwright/__probe_write` → `Permission denied` |
| Home cache | `$HOME/.cache/ms-playwright` exists and is owned by `abc`, but Playwright never uses it because `PLAYWRIGHT_BROWSERS_PATH` is set |
| Display | `DISPLAY=:1.0` (MCP browser works; `npx playwright test` does not) |

CI (`ubuntu-latest`) is unaffected: `.github/workflows/ci.yml` and `nightly-flake.yml`
run `npx playwright install --with-deps` on a writable runner cache.

---

## 3. Blocker — `npx playwright install chromium`

### What the product needs

Phase 3 Workstream C/D visual gates (`tests/visual/**`, P3-D-2's 48 per-theme baselines)
and any agent who adds a `toHaveScreenshot` assertion. Playwright resolves browsers from
`PLAYWRIGHT_BROWSERS_PATH`, then looks for `chromium-1243` / `chromium_headless_shell-1243`.
1237 is the wrong binary; launching 1.63.0 against it fails, which is why
`scripts/capture-phase2-demo.mjs` already special-cases 1237 for a *demo GIF* (not a pixel
gate).

### What happens

From an agent shell in this workspace, 2026-09-15:

```text
$ npx playwright install chromium
Failed to install browsers
Error: EACCES: permission denied, mkdir '/opt/ms-playwright/__dirlock'
```

Elapsed ~470 s before the failure was reported (the process sat silent for most of that).
`__dirlock` did not exist afterwards — the `mkdir` never succeeded.

Confirmed independently of Playwright:

```text
$ ls -ld /opt/ms-playwright
drwxr-xr-x 6 root root ... /opt/ms-playwright

$ touch /opt/ms-playwright/__probe_write
touch: cannot touch '/opt/ms-playwright/__probe_write': Permission denied

$ ls /opt/ms-playwright
chromium-1237
chromium_headless_shell-1237
ffmpeg-1011
.links
```

Playwright 1.63.0's `browsers.json` (abridged):

```json
{ "name": "chromium", "revision": "1243", "browserVersion": "153.0.8010.12" }
{ "name": "chromium-headless-shell", "revision": "1243", "browserVersion": "153.0.8010.12" }
```

So two independent problems stack:

1. **Revision skew** — image has 1237, package wants 1243. Already noted in
   `PHASE_2_LIBRARY_AND_STATS.md` (demo GIF capture) and `scripts/capture-phase2-demo.mjs`.
2. **Cache is not writable** — even a correct `playwright install` cannot create 1243 (or
   `__dirlock`) under `/opt/ms-playwright`.

(1) without (2) would still let an agent install. (2) is what makes (1) unfixable from
inside the sandbox.

### What we did not do (and should not have to)

- `sudo` an install into `/opt/ms-playwright`.
- Unset `PLAYWRIGHT_BROWSERS_PATH` so Playwright falls back to `$HOME/.cache/ms-playwright`
  (that would be an agent-local workaround; the next session image would still be wrong).
- Re-baseline visual screenshots against whatever Chromium MCP happens to drive.
- Weaken `maxDiffPixelRatio` or skip the visual project in CI.

P3-C-1 therefore kept the existing P1-H-2 Default baselines and left new panel/chart
shots to P3-D-2. Unit tests covered the theme contract instead.

---

## 4. Suggested remediations (in preference order)

1. **Pre-install revision 1243 (and headless-shell 1243) into `/opt/ms-playwright`** in the
   agent image, matching `playwright-core@1.63.0`. Keep `ffmpeg-1011` (already present).
   When the repo bumps Playwright, bump the image in lockstep.
2. **Make the cache writable by uid 1000**, *or* chown `/opt/ms-playwright` to `abc`, *or*
   point `PLAYWRIGHT_BROWSERS_PATH` at a uid-1000 directory that already contains 1243.
   Agents must be able to run `npx playwright install chromium` after a pin bump without
   waiting for an image rebuild.
3. **Drop `PLAYWRIGHT_BROWSERS_PATH`** if the intended cache is `$HOME/.cache/ms-playwright`
   (writable today). Then either pre-seed 1243 there, or allow the install to hit
   Playwright's CDN from the agent.
4. If (1)–(3) are out of scope: **document the limitation** next to the sandbox README
   (“visual and e2e Playwright are CI-only; this image has Chromium 1237 and cannot
   install 1243”). Agents will keep proving themes with Vitest + the MCP browser and will
   not claim pixel gates from this environment.

A workaround we did **not** take: rewriting `playwright.config.ts` to `executablePath` 1237
for the visual project. That would make local baselines incomparable to CI (1243).

---

## 5. Reproduction checklist for the platform team

From an agent shell in this workspace:

```bash
echo "PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"
# expect /opt/ms-playwright

ls -ld /opt/ms-playwright
# expect drwxr-xr-x root root  — failure: not writable by uid 1000

ls /opt/ms-playwright
# today: chromium-1237, chromium_headless_shell-1237, ffmpeg-1011
# success: also chromium-1243 and chromium_headless_shell-1243

id   # expect uid=1000(abc)

touch /opt/ms-playwright/__probe_write && rm /opt/ms-playwright/__probe_write
# success: file creates; today: Permission denied

npx playwright install chromium
# success: exits 0, 1243 appears under $PLAYWRIGHT_BROWSERS_PATH
# today: EACCES mkdir '/opt/ms-playwright/__dirlock'

npx playwright test --project=visual --list
# should list tests/visual/*.spec.ts without "Executable doesn't exist" on 1243
```

`npm run verify` does **not** run Playwright (typecheck / lint / boundaries / vitest / build
only). The hole only shows up on `npm run e2e`, the visual project, or an agent adding a
screenshot assertion.

---

## 6. Impact on remaining work

| Work | Status here |
|---|---|
| `npm run verify` | Unblocked (no Playwright). |
| P3-C-1 Default visual extras | Deferred; existing P1-H-2 baselines kept. |
| P3-C-2…C-6 theme visual ACs (scanline moiré at dpr 1/1.5/2/3, etc.) | Unit-tested where possible; pixel screenshots wait on this fix or on CI. |
| P3-D-2 48 per-theme baselines | Blocked in-sandbox. Can land from CI / a writable machine. |
| Phase 1/2 e2e locally | Same install wall; CI still installs `--with-deps`. |
| Playwright MCP (`DISPLAY=:1.0`) | Still works for manual browser checks; it is not the visual-regression browser. |

---

## 7. What already works (so you don’t over-fix)

- `npm run verify` on this agent.
- Playwright MCP navigating `http://sandbox-dind:<port>` (see SANDBOX-FEEDBACK-01 §4).
- CI `e2e` / `visual` jobs on `ubuntu-latest` (`npx playwright install --with-deps`).
- Demo GIF capture falling back to `chromium-1237` (`scripts/capture-phase2-demo.mjs`) —
  labelled, not a pixel gate.
- `$HOME/.cache/ms-playwright` is writable; it is simply unused while
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`.
