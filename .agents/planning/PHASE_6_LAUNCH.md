# Phase 6 — The Launch

> *"The Launch: final polish of the 'Overview' documentation and demo assets."*
> *"When a user first opens the app, they should be struck by the fact that it's a 'toy' that feels like a professional tool."*

| | |
|---|---|
| **Status** | ☐ Not started |
| **Ships version** | `1.0.0` |
| **Prerequisites** | Phase 5 complete and tagged `v0.6.0`. |
| **Theme of the phase** | **Make it real.** |
| **The demo that proves it** | Send the link to someone who has never heard of Conway's Game of Life. They open it on their phone, play with it for ten minutes, understand what they are looking at, and send it to somebody else. |

---

## 1. Objectives

1. **Production hardening** — the server is safe to expose, the client never white-screens, and every failure has a legible recovery.
2. **Mobile & touch** — the deliberate deferral from Phase 1 is now paid off properly.
3. **Accessibility certification** — a full audit against WCAG 2.2 AA, including screen-reader flows and a non-visual account of the simulation.
4. **Cross-browser & cross-platform matrix** — verified, documented, and honest about what is unsupported.
5. **Documentation** — a README worth landing on, a user guide, a ruleset authoring guide, and an architecture overview.
6. **Demo assets** — the captures and screenshots that make the case before anyone clicks.
7. **Release engineering** — semver automation, changelog generation, container publishing, and a reproducible deploy.
8. **`1.0.0`.**

---

## 2. What "1.0" means for this project

It is a *toy*, and it holds itself to a professional standard. Concretely, at 1.0:

- **It never loses your work.** Autosave, session recovery after a crash, and no silent destructive action anywhere.
- **It never white-screens.** Every error path renders something honest and offers a way forward.
- **It is honest.** No claimed limit we do not meet, no approximation presented as exact, no metric silently downsampled.
- **It is usable by one hand on a phone and by ten fingers on a keyboard.**
- **It is usable by someone who cannot see it**, to a defined and documented extent.
- **It is fast on hardware we do not own.**
- **It is fabulous.** Six themes, sound, motion — and it still runs at 60 fps.

---

## 3. Workstreams & tasks

---

### Workstream A — Production hardening

#### - [ ] P6-A-1 · Server security
**Depends on:** Phase 5 · **Files:** `src/server/{app,middleware}/*`
**Implementation notes** Hand-written middleware (no `helmet` — it is ~30 lines of headers, and the no-bloat rule applies): CSP (with the COOP/COEP from P5-C-2), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS behind TLS. A token-bucket rate limiter per IP for write routes. Body size caps (64 kB rulesets, 4 MB sessions). Strict path sanitisation on every id (re-verifying P1-G-1). WebSocket origin checking and a per-IP connection cap. Structured JSON request logging with **no PII and no user content**.
**Acceptance criteria**
- [ ] A security review of the diff (`/security-review`) reports no findings.
- [ ] Traversal, oversized-body, and rate-limit tests all return correct 4xx responses with useful messages.
- [ ] CSP is enforced with no `unsafe-inline` and no `unsafe-eval`; the app works fully under it.
- [ ] WebSocket connections from a foreign origin are rejected.

#### - [ ] P6-A-2 · Client resilience
**Depends on:** Phase 5 · **Files:** `src/client/{error-boundary,recovery}.ts`
**Implementation notes** A global error handler that renders a legible failure card with the option to *reset the view*, *reload keeping the session*, or *export the session for a bug report* — in that order of destructiveness. Worker crash recovery from the last snapshot (already built in P0-G-3; verify it end to end here). Storage quota, corrupt session, and unreachable-server paths all handled with a specific message.
**Acceptance criteria**
- [ ] A deliberately thrown error in each subsystem (worker, renderer, audio, UI, network) produces a specific, useful message and a working recovery.
- [ ] Killing the worker mid-run recovers without losing more than one keyframe interval of history.
- [ ] A corrupted `localStorage` session is detected and quarantined, not crashed on.
- [ ] There is no code path that renders a blank page (audited and tested).

#### - [ ] P6-A-3 · Docker & deployment
**Depends on:** P6-A-1 · **Files:** `docker/*`, `docs/deployment.md`
**Implementation notes** Final production image: multi-stage, non-root, distroless or alpine, `HEALTHCHECK`, sane defaults via environment variables (`PORT`, `DATA_DIR`, `ENABLE_LIVE`, `HISTORY_CEILING_MB`, `CORS_ORIGINS`), a named volume for `data/`, and resource limits in the compose file. A one-command deploy documented end to end, plus a reverse-proxy example with TLS.
**Acceptance criteria**
- [ ] `docker compose up` on a clean machine with no Node installed serves the complete app.
- [ ] Image < 200 MB, runs as non-root, reports healthy, and survives `docker restart` with data intact.
- [ ] Every environment variable is documented with its default and its effect.
- [ ] A container-scan step in CI reports no high-severity vulnerabilities.

---

### Workstream B — Mobile & touch

#### - [ ] P6-B-1 · Responsive layout
**Depends on:** Phase 4 · **Files:** `src/ui/components/shell.ts`, `src/ui/layout/*`
**Implementation notes** Breakpoints for phone (< 640 px), tablet, and desktop. On phone: panels become bottom sheets, the toolbar becomes a horizontally scrollable strip, the transport docks above the safe-area inset, and the statistics panel defaults to Simple mode. The canvas never loses more than 55% of the viewport to chrome. Handle `visualViewport`, safe-area insets, and orientation change without resetting the camera.
**Acceptance criteria**
- [ ] Usable at 320 × 568 through 5120 × 2880.
- [ ] Rotating the device preserves camera, selection and tool state.
- [ ] No horizontal page scroll at any width.
- [ ] Visual baselines added for phone and tablet in three themes.

#### - [ ] P6-B-2 · Touch interaction
**Depends on:** P6-B-1 · **Files:** `src/ui/input/touch.ts`
**Implementation notes** One finger paints, two fingers pan and pinch-zoom, long-press opens a context menu, double-tap zooms to fit. Hit targets ≥ 44 px. A palm-rejection heuristic (ignore contacts above a size threshold). Haptics via `navigator.vibrate` where available, respecting reduced-motion. `touch-action: none` on the canvas only.
**Acceptance criteria**
- [ ] Painting a glider on a real phone is easy on the first attempt (tested on at least one iOS and one Android device).
- [ ] Pinch-zoom is smooth at 60 fps and anchors correctly at the pinch midpoint.
- [ ] No accidental painting while panning with two fingers.
- [ ] Every Phase 1–4 feature is reachable on touch or is explicitly documented as desktop-only.

---

### Workstream C — Accessibility certification

#### - [ ] P6-C-1 · WCAG 2.2 AA audit
**Depends on:** Phase 4 · **Files:** `tests/a11y/*`, `docs/accessibility.md`
**Implementation notes** Automated axe-core across every panel × every theme, plus a manual audit of the criteria automation cannot check: focus order, focus visibility, error identification, consistent navigation, target size, dragging alternatives (WCAG 2.2 adds `2.5.7 Dragging Movements` and `2.5.8 Target Size` — both directly relevant to a drawing app, so both need explicit non-drag alternatives).
**Acceptance criteria**
- [ ] Zero axe-core violations across all panels × all six themes.
- [ ] Every drag interaction has a documented non-drag alternative (keyboard or click-click).
- [ ] `docs/accessibility.md` publishes an honest conformance statement including known limitations.

#### - [ ] P6-C-2 · Screen-reader experience
**Depends on:** P6-C-1
**Intent:** A canvas of cells is inherently visual. That is a reason to work harder, not a reason to give up.
**Implementation notes**
- The canvas exposes an `aria-label` and a live-region summary: generation, population, growth classification, detected period, bounding box, and notable events ("period-30 oscillator detected"). Announcements are throttled and user-configurable (off / summary / verbose).
- A **keyboard cell cursor**: arrow keys move a focused cell, `Enter` toggles it, and the state under the cursor is announced. This makes drawing possible without a pointer.
- A text description of the current pattern's neighbourhood on demand ("a 3×3 region: 4 live cells, forming a diagonal").
**Acceptance criteria**
- [ ] Tested with VoiceOver and NVDA: a user can create, run, and observe a simulation entirely non-visually.
- [ ] Live-region announcements are informative and not overwhelming at the default setting.
- [ ] The keyboard cell cursor is discoverable from the help overlay and the palette.

---

### Workstream D — Compatibility

#### - [ ] P6-D-1 · Browser & platform matrix
**Depends on:** Phase 5 · **Files:** `docs/compatibility.md`, `.github/workflows/ci.yml`
**Implementation notes** Verify Chromium, Firefox and WebKit on macOS, Windows, Linux, iOS and Android — current and current-minus-one. Record, per combination: WebGL2, OffscreenCanvas, SharedArrayBuffer, `CompressionStream`, WebAudio, and `showSaveFilePicker` availability, plus the resulting experience. State clearly what is unsupported rather than failing mysteriously.
**Acceptance criteria**
- [ ] The full E2E suite passes on all three engines in CI.
- [ ] `docs/compatibility.md` is complete and accurate, with a per-feature fallback column.
- [ ] An unsupported browser gets a clear message naming what is missing, not a broken page.

#### - [ ] P6-D-2 · Progressive enhancement audit
**Depends on:** P6-D-1
**Acceptance criteria**
- [ ] The app is fully functional with the server unreachable (built-in rulesets, bundled patterns, local sessions).
- [ ] The app is fully functional with audio blocked, storage blocked, WebGL2 absent, and workers absent (documented degraded mode) — each verified by a test.
- [ ] Every degradation is announced once, non-intrusively, and never repeatedly.

---

### Workstream E — Documentation

#### - [ ] P6-E-1 · README
**Depends on:** all · **Files:** `README.md`
**Implementation notes** Opens with the inception premise verbatim, then an animated demo above the fold, then a 30-second quick start (`docker compose up`), then a features section organised by *what you can do* rather than by what we built, then screenshots of all six themes, then links to the guides, then the agentic-experiment note (*"A full agentic coding experiment, all agent files in repo"*) — which is genuinely part of this project's story and should be told, not buried.
**Acceptance criteria**
- [ ] A reader who knows nothing about cellular automata understands what this is within 15 seconds.
- [ ] Every claim in the README is true and verified (especially performance numbers).
- [ ] All six themes are shown.

#### - [ ] P6-E-2 · User guide
**Depends on:** Phase 4 · **Files:** `docs/guide/*.md`
**Contents:** getting started; drawing and tools; the pattern library; understanding the statistics; time travel; the laboratory; themes and sound; keyboard reference; sharing and saving; a glossary of cellular-automaton terms written for a beginner.
**Acceptance criteria**
- [ ] Every feature in the app appears in the guide.
- [ ] The glossary defines every term the UI uses (still life, oscillator, spaceship, methuselah, puffer, agar, heat, period, B/S notation…).
- [ ] Screenshots are current and generated by a script so they can be regenerated on change.

#### - [ ] P6-E-3 · Ruleset authoring guide
**Depends on:** Phase 2 · **Files:** `docs/ruleset-authoring.md`
**Implementation notes** From `B3/S23` to a multi-state weighted terrain rule, with a worked example at each level of the schema, a troubleshooting section keyed to the validator's actual error messages, and a gallery of interesting rules to start from.
**Acceptance criteria**
- [ ] Every `TransitionSpec` kind has a complete worked example that a reader can paste into the studio and run.
- [ ] Every validator error message appears in the troubleshooting index.
- [ ] A person unfamiliar with cellular automata can follow it to a working custom rule.

#### - [ ] P6-E-4 · Architecture & contribution docs
**Depends on:** all · **Files:** `ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/{performance,time-model,accessibility,compatibility,deployment}.md`
**Acceptance criteria**
- [ ] `ARCHITECTURE.md` reflects the shipped system and links every ADR; any ADR amended during the build is reconciled.
- [ ] `CONTRIBUTING.md` states the layering rules, the no-bloat rule, the test bar, and the commit conventions.
- [ ] `.agents/` is explained: what the inception document is, what these phase plans are, and how the agentic build actually went — including what was cut and why.

---

### Workstream F — Demo assets

#### - [ ] P6-F-1 · Capture pipeline
**Depends on:** P4-E-2 · **Files:** `scripts/capture.mjs`, `docs/demo/*`
**Implementation notes** A scripted, deterministic capture driving the real app through Playwright: the attract-mode sequence, a drawing session, a theme cycle, a rewind, a laboratory comparison, and the Phase 5 orbital zoom. Output as MP4 and optimised GIF/WebP. Deterministic so it regenerates identically.
**Acceptance criteria**
- [ ] All captures regenerate from one command.
- [ ] The hero animation is < 5 MB and looks excellent on GitHub's dark and light backgrounds.
- [ ] No capture shows a bug, a placeholder, or a debug readout.

#### - [ ] P6-F-2 · Screenshot set
**Depends on:** P6-F-1
**Acceptance criteria**
- [ ] All six themes captured at a consistent, flattering moment of the same simulation.
- [ ] Panel screenshots for library, statistics, studio, timeline and laboratory.
- [ ] Phone and desktop layouts both represented.
- [ ] Regenerable by script; committed at a sensible resolution and total size.

---

### Workstream G — Release engineering

#### - [ ] P6-G-1 · Version & changelog automation
**Depends on:** P0-A-6 · **Files:** `scripts/release.mjs`, `.github/workflows/release.yml`
**Implementation notes** Derive the next semver from conventional commits since the last tag, generate the changelog section (merging any hand-written `[Unreleased]` prose rather than discarding it — hand-written entries are usually better), tag, and publish. ~150 lines, hand-written. A dry-run mode is mandatory.
**Acceptance criteria**
- [ ] A dry run against real history produces a correct version bump and an accurate changelog.
- [ ] Hand-written `[Unreleased]` entries survive generation.
- [ ] The release workflow is idempotent and safe to re-run.

#### - [ ] P6-G-2 · Container publishing
**Depends on:** P6-A-3, P6-G-1
**Acceptance criteria**
- [ ] Tagged releases publish a multi-arch image (amd64 + arm64) to the registry.
- [ ] Images carry OCI labels including source revision and version.
- [ ] The published image passes the same healthcheck and smoke test as the local build.

#### - [ ] P6-G-3 · Release candidate QA
**Depends on:** all above · **Files:** `docs/release-checklist.md`
**Implementation notes** A written, repeatable checklist executed manually against the RC: every feature exercised, every theme, every browser, mobile, keyboard-only, screen-reader, offline, and a long-running soak (2 hours at high TPS, watching memory).
**Acceptance criteria**
- [ ] The checklist is executed and its results recorded in the release PR.
- [ ] The 2-hour soak shows flat memory and no degradation.
- [ ] Every issue found is either fixed or explicitly accepted and documented as a known limitation.

#### - [ ] P6-G-4 · Cut `1.0.0`
**Depends on:** P6-G-3
**Acceptance criteria**
- [ ] All phase gates from Phases 0–6 green simultaneously on `main`.
- [ ] `CHANGELOG.md` has a complete, dated `[1.0.0]` entry telling the story of all seven phases.
- [ ] Tagged `v1.0.0`, image published, demo assets live in the README.
- [ ] A short retrospective in `.agents/docs/RETROSPECTIVE.md`: what the agentic build got right, what it got wrong, what was cut, and what the next version should do.

---

## 4. Quality gates for Phase 6

| Gate | Threshold |
|---|---|
| All Phase 0–5 gates | green simultaneously on `main` |
| Security review | zero findings on the server surface |
| CSP | enforced, no `unsafe-inline`, no `unsafe-eval`, app fully functional |
| White-screen paths | zero (audited and tested) |
| Mobile | fully usable at 320 px; verified on real iOS and Android devices |
| WCAG 2.2 AA | zero automated violations; manual audit passed; conformance statement published |
| Screen reader | a simulation can be created, run and observed entirely non-visually |
| Browser matrix | E2E green on Chromium, Firefox, WebKit; matrix documented |
| Offline | fully functional with the server unreachable |
| Container | < 200 MB, non-root, multi-arch, no high-severity CVEs |
| Soak | 2 hours at high TPS with flat memory |
| Documentation | every feature documented; every README claim verified |
| Demo assets | regenerable by script; hero animation < 5 MB |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Mobile support was deferred to Phase 6 and turns out to be a rewrite. | Launch slips badly. | Phase 1 already required 320 px layout correctness and touch pan/zoom/paint. P6-B is refinement, not invention. If it is not, that is a Phase 1 defect and should be escalated immediately rather than absorbed. |
| Accessibility findings arrive too late to fix cheaply. | Ship with known exclusions. | axe-core has been a gate since Phase 1 and per-theme since Phase 3. P6-C adds the manual and screen-reader work only. |
| The README overclaims performance. | Credibility damage on day one. | Every number in the README must cite the benchmark that produced it and the machine it ran on. This is an explicit acceptance criterion. |
| `/live` is abused once public. | Ops burden, possible takedown. | Read-only, rate-limited, connection-capped, origin-checked, and behind `ENABLE_LIVE` (default off in the published image, documented). |
| The "1.0" bar becomes infinite polish. | Never ships. | §2 defines 1.0 concretely in seven bullets. Anything else is 1.1. Cut, record in the retrospective, and ship. |
| Demo assets show an old build. | Embarrassing and misleading. | Captures are script-generated from the real RC and regenerated as the last step before tagging. |

---

## 6. Definition of Done — Phase 6 (and the project)

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 6 quality gates (§4) green, with every earlier phase's gates green simultaneously.
- [ ] All seven bullets of §2 ("What 1.0 means") are demonstrably true.
- [ ] `v1.0.0` is tagged, the image is published, and `docker compose up` on a clean machine gives a stranger the complete application.
- [ ] Someone who has never heard of Conway's Game of Life used it for ten minutes and sent it to somebody else.
- [ ] `.agents/docs/RETROSPECTIVE.md` is written.
- [ ] It is, verifiably, fabulous.
