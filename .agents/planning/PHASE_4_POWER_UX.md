# Phase 4 — Power UX

> *"Command Palette: a 'Power User' mode to jump between brushes, rulesets, and view toggles."*
> *"Time-Traveler UI: a scrubbable timeline to inspect past states or 'rewind' a dying civilization."*
> *"The 'Laboratory' View: a split-screen mode to compare two different rulesets running on the same initial seed."*
> *"Hot-Key Mastery: every major action should be mappable to a keyboard shortcut."*

| | |
|---|---|
| **Status** | ☐ Not started |
| **Ships version** | `0.5.0` |
| **Prerequisites** | Phase 3 complete and tagged `v0.4.0`. |
| **Theme of the phase** | **Make it a pro tool.** |
| **The demo that proves it** | Hit `Mod+K`, type "lab", press Enter. The screen splits: Conway on the left, HighLife on the right, same seed. Run 400 generations. Scrub the shared timeline back to generation 150 and watch both rewind in lockstep, with the divergence chart showing exactly where they parted company. Then rebind every key you have touched and export the profile. |

---

## 1. Objectives

1. **The Command Palette** — fuzzy, fast, contextual, and complete: everything the app can do is one `Mod+K` away.
2. **Hot-Key Mastery** — user-remappable bindings, chords, conflict detection, profiles, import/export, and a cheat sheet.
3. **The Time-Traveler** — a scrubbable timeline over the ADR-007 journal: rewind, reverse-play, step back, keyframe markers, memory budget, and honest timeline forking on edit.
4. **The Laboratory** — split-screen comparison of two simulations with linked or independent controls, a cell-level diff overlay, and divergence metrics.
5. **Sessions & sharing, completed** — named save/load, a session browser, and share links carrying everything.
6. **Onboarding** — a first-run tour and an attract mode that make the "wow" reach people who have never seen a cellular automaton.
7. **Settings** — one coherent place for every preference the previous four phases accumulated.

---

## 2. Architecture introduced in this phase

### 2.1 The palette is a view, not a system

Because Phase 1 required every action to be a registered `AppCommand`, the palette is a renderer over `commandRegistry.all()`. **If a feature is missing from the palette, the bug is that the feature bypassed the registry** — fix it there, never by special-casing the palette.

```
Mod+K ─▶ PaletteOverlay
           ├─ source: commandRegistry.all() filtered by isEnabled(ctx)
           ├─ scorer: fuzzyScore(query, title|keywords|category)   ← shared with P2-B-3
           ├─ ranking: score × recencyBoost × frequencyBoost
           ├─ modes:  ">" commands (default)   "#" patterns
           │          "@" rulesets             "?" help
           │          ":" go to generation     "/" search the library
           └─ preview pane: shows the binding, the description, and for
              patterns/rulesets a live animated thumbnail
```

### 2.2 Time-Traveler over the journal

```
        ┌──────────────────────── retained window ────────────────────────┐
   │◆────────────◆────────────◆────────────◆────────────◆────────────◆│▐ now
   evicted      keyframes every K ticks                              live
        │            ▲                        ▲
        │            │                        └── scrub head (playback position)
        │            └── seek target: clone keyframe + replay deltas
        └── eviction boundary, VISIBLE in the UI with a memory meter
```

**Timeline forking.** Editing while scrubbed back is the interesting case and the one that is usually got wrong. The rule:

1. The user is at generation 150 of a 400-generation history and paints a cell.
2. The UI shows a clear, non-modal prompt **before** committing: *"Editing here will discard generations 151–400. [Fork] [Cancel]"*.
3. On fork, `journal.truncateAfter(150)` runs, the edit applies, and a toast confirms what was discarded.

Silent truncation is forbidden. Losing 250 generations of a beautiful run without warning is the kind of thing people do not forgive.

### 2.3 Laboratory

```
┌────────────────────────────┬────────────────────────────┐
│  Pane A                    │  Pane B                    │
│  worker A, renderer A      │  worker B, renderer B      │
│  ruleset: conway           │  ruleset: highlife         │
│  ─────────────────────────┼──────────────────────────  │
│         shared seed, shared camera (linkable),          │
│         shared transport (linkable), shared timeline    │
└─────────────────────────────────────────────────────────┘
              ▼
   DiffOverlay: cells present in A only / B only / both
   DivergenceChart: |A △ B| over time, plus per-pane population
```

Two independent `WorkerClient`s. Link toggles for camera, transport, and timeline (each independently linkable — a researcher will want camera linked but transport free). A third mode overlays the two grids in a single view with A/B/both colour coding, which is often more revealing than side-by-side.

### 2.4 New files

```
src/ui/
├── palette/{overlay,scorer,modes,ranking}.ts
├── keybindings/{editor,profiles,conflicts,cheatsheet}.ts
├── timeline/{timeline,scrubber,markers,memory-meter,fork-prompt}.ts
├── laboratory/{lab-view,pane,diff-overlay,divergence-chart,link-controls}.ts
├── onboarding/{tour,attract-mode}.ts
└── panels/settings/*
src/client/{multi-sim.ts, session-browser.ts}
```

---

## 3. Workstreams & tasks

---

### Workstream A — Command Palette

#### - [ ] P4-A-1 · Fuzzy scorer
**Depends on:** P2-B-3 · **Files:** `src/ui/palette/scorer.ts`
**Implementation notes** Promote the Phase 2 library matcher to a shared module. Subsequence match with gap penalties, bonuses for word-boundary and camelCase-boundary hits, an exact-prefix bonus, and a returned match-index array for highlighting. ~80 lines, hand-written per the no-bloat rule.
**Acceptance criteria**
- [ ] `"tgl"` ranks "Toggle Grid Lines" above "Toggle Chrome" (acronym bonus), asserted in a table-driven test of ≥ 40 query/expectation pairs.
- [ ] Scoring 1,000 candidates takes < 1 ms.
- [ ] Returned match indices highlight exactly the matched characters.

#### - [ ] P4-A-2 · Palette overlay
**Depends on:** P4-A-1, P1-C-1 · **Files:** `src/ui/palette/overlay.ts`
**Implementation notes** Opens in < 50 ms, filters as you type with no perceptible lag, arrow/Enter/Escape navigation, shows each command's **current** binding on the right, and a preview pane. Results are grouped by category with recents pinned at the top on an empty query. Full ARIA combobox semantics. Motion comes from the active theme's signature — the palette should feel like it belongs to Chiba-City when Chiba-City is on.
**Acceptance criteria**
- [ ] Every registered command is reachable; the P1-C-1 orphan test is extended to assert palette reachability.
- [ ] Typing latency < 16 ms with the full command set plus 250 patterns plus all rulesets.
- [ ] Screen-reader announces the active option and the result count.
- [ ] Closing restores focus to the previously focused element.

#### - [ ] P4-A-3 · Palette modes
**Depends on:** P4-A-2
**Implementation notes** Prefix-switched modes per §2.1. `#` searches the pattern library and places the result as a stamp; `@` switches ruleset; `:` jumps the timeline to a generation (accepting `+50`/`-50` relative forms); `/` searches library metadata; `?` searches help topics. Mode is also selectable by clicking a chip, so the feature is discoverable without knowing the prefixes.
**Acceptance criteria**
- [ ] Each mode has an E2E spec driving it end to end.
- [ ] An unrecognised prefix falls back to command search rather than showing nothing.
- [ ] Mode chips make every prefix discoverable without documentation.

---

### Workstream B — Hot-Key Mastery

#### - [ ] P4-B-1 · Binding editor
**Depends on:** P1-C-2 · **Files:** `src/ui/keybindings/editor.ts`
**Implementation notes** A searchable table of every command with its current and default binding. "Record" captures the next chord literally, including modifiers, and shows it in platform-correct notation (`⌘` vs `Ctrl`). Reset-one and reset-all. Bindings persist and are included in the session document.
**Acceptance criteria**
- [ ] Every command in the registry appears in the editor.
- [ ] Recording captures multi-key chords (`g` then `g`) and modifier combinations correctly on macOS, Windows and Linux keyboard layouts.
- [ ] A non-US layout (AZERTY, Dvorak) records physical keys sensibly — document the chosen `code`-vs-`key` policy and test it.

#### - [ ] P4-B-2 · Conflict detection & profiles
**Depends on:** P4-B-1 · **Files:** `src/ui/keybindings/{conflicts,profiles}.ts`
**Implementation notes** Detect exact duplicates and **chord-prefix shadowing** (binding `g` when `g g` exists). Warn inline with the conflicting command named and a one-click resolution. Profiles: Default, Vim-flavoured, and a user profile; export/import as JSON.
**Acceptance criteria**
- [ ] Assigning an already-used chord surfaces the conflict before it is saved, naming the other command.
- [ ] Prefix shadowing is detected (this is the subtle one — test it explicitly).
- [ ] A profile exported on one machine imports identically on another platform, with `Mod` correctly re-resolved.

#### - [ ] P4-B-3 · Cheat sheet
**Depends on:** P4-B-1 · **Files:** `src/ui/keybindings/cheatsheet.ts`
**Implementation notes** `Shift+/` opens a full-screen, categorised, printable overlay showing every current binding, rendered with the active theme's motion signature. Include a "print/export as PNG" so people can stick it on a wall — small touch, real delight.
**Acceptance criteria**
- [ ] Reflects live user bindings, not defaults.
- [ ] Prints legibly on A4 and Letter in every theme.
- [ ] Opens in < 100 ms with all bindings shown.

---

### Workstream C — The Time-Traveler

#### - [ ] P4-C-1 · Timeline data bridge
**Depends on:** P0-F-1 · **Files:** `src/worker/handler.ts`, `src/shared/protocol.ts`
**Implementation notes** Add `seek`, `truncateAfter`, and `historyInfo` to the worker protocol (the `seek` command was reserved in ADR-006 precisely for this). `historyInfo` returns the retained range, keyframe ticks, byte usage, and the configured ceiling. Seeking must be interruptible: a fast scrub issues many seeks and only the latest matters — cancel superseded work rather than queueing it.
**Acceptance criteria**
- [ ] Scrubbing rapidly across 5,000 generations never queues more than one pending seek.
- [ ] `seek` to any retained tick reproduces state byte-identically (re-verifying the P0-F-1 guarantee through the full protocol path).
- [ ] Seeking outside the retained window returns a structured error the UI renders as "this far back is no longer retained", with the retained range shown.

#### - [ ] P4-C-2 · Timeline UI
**Depends on:** P4-C-1 · **Files:** `src/ui/timeline/*`
**Implementation notes**
- A scrubber spanning the retained window with keyframe tick marks, the eviction boundary rendered as a distinct "here be dragons" edge, and the live head at the right.
- A **population sparkline drawn behind the scrubber** (data already exists from Phase 2) so users scrub toward interesting moments rather than blindly. This is the detail that turns the timeline from a control into an instrument.
- Reverse play at 0.25×–4×, frame-step back (`,`) and forward (`.`), and a "return to live" button.
- A memory meter showing retained generations and bytes against the ceiling, with the ceiling adjustable in settings.
- Optional user-placed bookmarks with labels.
**Acceptance criteria**
- [ ] Scrubbing 4,000 generations back stays above 30 fps and settles in < 250 ms.
- [ ] Reverse play at 1× is visually smooth (no stutter) on the reference machine.
- [ ] The eviction boundary is unmistakable, and scrubbing into it explains rather than fails.
- [ ] Bookmarks survive save/load and appear in share links.

#### - [ ] P4-C-3 · Timeline forking
**Depends on:** P4-C-2 · **Files:** `src/ui/timeline/fork-prompt.ts`
**Implementation notes** Exactly the flow in §2.2. Also handle the pause-scrub-resume case: pressing play while scrubbed back must ask whether to resume from here (discarding the future) or return to live.
**Acceptance criteria**
- [ ] No path exists that discards history without an explicit confirmation (E2E specs cover edit-while-scrubbed, play-while-scrubbed, and stamp-while-scrubbed).
- [ ] After a fork, the timeline, stats series, and cycle detector are all consistent with the new history — no stale data from the discarded branch.
- [ ] The discarded generation count is stated in the confirmation and the toast.

#### - [ ] P4-C-4 · Undo vs. time travel clarity
**Depends on:** P4-C-2, P1-C-3
**Intent:** Two rewind mechanisms in one app will confuse people unless the UI is deliberate about it.
**Implementation notes** Undo (`Mod+Z`) reverses *your edits*. The timeline reverses *the simulation*. Label them differently, place them apart, and add a first-use explainer on each. Undoing an edit made before a scrub must behave sanely — define the semantics explicitly, document them in `docs/time-model.md`, and test them.
**Acceptance criteria**
- [ ] `docs/time-model.md` states the interaction rules unambiguously.
- [ ] Edge cases are covered by tests: undo after scrub, scrub after undo, undo after fork, redo after fork.
- [ ] User testing with three people finds no confusion about which control does what.

---

### Workstream D — The Laboratory

#### - [ ] P4-D-1 · Multi-simulation host
**Depends on:** P0-G-3 · **Files:** `src/client/multi-sim.ts`
**Implementation notes** Generalise the single `WorkerClient` into a keyed collection so panes are symmetric — no "primary" special case. Frame coalescing and buffer ping-pong must remain per-pane. Guard total memory: two 4096² simulations plus two histories can exceed a tab's budget, so the history ceiling is split across panes and surfaced.
**Acceptance criteria**
- [ ] Two 1M-cell simulations run concurrently at ≥ 30 fps each on the reference machine.
- [ ] Closing a pane fully terminates its worker and releases its memory (leak test).
- [ ] Total history memory across panes respects the global ceiling.

#### - [ ] P4-D-2 · Lab layout & link controls
**Depends on:** P4-D-1 · **Files:** `src/ui/laboratory/{lab-view,pane,link-controls}.ts`
**Implementation notes** Vertical or horizontal split with a draggable divider; independently toggleable links for camera, transport, and timeline; per-pane ruleset, theme *(yes — comparing themes side by side is genuinely useful and costs nothing)*, and speed. "Same seed" is the default and is one click to re-randomise for both.
**Acceptance criteria**
- [ ] With camera linked, panning one pane pans the other with zero drift over 1,000 pan operations.
- [ ] With transport linked, both panes are at the identical generation at all times (asserted continuously in an E2E run).
- [ ] Unlinking mid-run leaves both panes in a valid state and re-linking snaps to the leader with a stated policy.
- [ ] The divider is keyboard-adjustable.

#### - [ ] P4-D-3 · Diff overlay
**Depends on:** P4-D-2 · **Files:** `src/ui/laboratory/diff-overlay.ts`
**Implementation notes** A third view mode compositing both grids with A-only / B-only / both colour coding drawn from theme tokens (so it works in all six themes). Diffing is chunk-summary-first: compare chunk population and hash before descending to cells, so identical regions cost nothing.
**Acceptance criteria**
- [ ] Diff of two identical 1M-cell grids costs < 2 ms (proving the chunk-summary short-circuit works).
- [ ] Colour coding is distinguishable in every theme and under simulated colour-blindness.
- [ ] The diff is correct: a property test against a brute-force cell-by-cell comparison over 500 random grid pairs.

#### - [ ] P4-D-4 · Divergence metrics
**Depends on:** P4-D-3, P2-D-2 · **Files:** `src/ui/laboratory/divergence-chart.ts`
**Implementation notes** Chart symmetric difference |A △ B|, Jaccard similarity, per-pane population, and the **first divergence generation** called out prominently. Add a "run until divergence" command that steps both panes until they differ and stops — the exact tool for studying how B36/S23 departs from B3/S23.
**Acceptance criteria**
- [ ] First-divergence detection is exact and reported with its generation number.
- [ ] "Run until divergence" stops on the correct generation for a known Conway/HighLife pair (committed fixture).
- [ ] Divergence charts use the Phase 2 chart module unchanged — no chart code is duplicated here.

---

### Workstream E — Sessions, onboarding, settings

#### - [ ] P4-E-1 · Named sessions & browser
**Depends on:** P1-F-1 · **Files:** `src/client/session-browser.ts`, `src/server/routes/sessions.ts`
**Implementation notes** Save/load named sessions locally (IndexedDB for size — `localStorage` cannot hold a large grid) and to the server when available. The browser shows a thumbnail, ruleset, generation, and date. `SessionDoc` v3 adds panes, timeline bookmarks, keybinding profile, and theme; migrations from v1 and v2 are mandatory and tested.
**Acceptance criteria**
- [ ] A v1 session (Phase 1) and a v2 session (Phase 2) both load correctly into v3.
- [ ] A 1M-cell session saves and loads in < 2 s.
- [ ] Session thumbnails are generated locally without blocking the UI.

#### - [ ] P4-E-2 · First-run tour & attract mode
**Depends on:** P4-A-2 · **Files:** `src/ui/onboarding/*`
**Intent:** The inception document's "wow" factor, aimed squarely at someone who has never heard of Conway.
**Implementation notes**
- **Attract mode:** on an untouched app, after 45 s idle, the simulation transitions into a curated sequence — a gun, then a puffer, then a multi-state terrain rule, then a rule-random showcase — with the camera moving cinematically and captions naming what is happening. Any input exits instantly. This is also the demo reel for the README.
- **Tour:** 6 steps maximum, skippable and resumable, each one *doing* something rather than pointing at it (the tour draws a glider for you and runs it). Never modal-blocks the canvas.
**Acceptance criteria**
- [ ] The tour is completable in < 90 s and can be re-run from Help.
- [ ] Any input exits attract mode within one frame.
- [ ] Attract mode never starts if the user has ever edited anything in this session.
- [ ] Tested with three people who have never used a cellular automaton; all three can draw a pattern and run it afterwards.

#### - [ ] P4-E-3 · Settings panel
**Depends on:** P3-D-1, P4-B-1 · **Files:** `src/ui/panels/settings/*`
**Implementation notes** Consolidate everything accumulated across four phases: theme, quality pin, audio volumes, reduced motion override, history ceiling and keyframe interval, autosave interval, grid-line behaviour, default ruleset, keybinding profile, telemetry (there is none — say so explicitly), and reset-to-defaults. Every setting is a registered command so the palette can toggle it.
**Acceptance criteria**
- [ ] Every persisted preference in the codebase appears here (audited against the storage schema by a test).
- [ ] Settings apply live, with no reload.
- [ ] Reset-to-defaults genuinely restores a first-run state, including keybindings and layout.

---

## 4. Quality gates for Phase 4

| Gate | Threshold |
|---|---|
| All Phase 0–3 gates | still green |
| Palette coverage | 100% of registered commands reachable; zero orphans |
| Palette latency | open < 50 ms; keystroke-to-results < 16 ms |
| Timeline seek | 4,000 generations back in < 250 ms; ≥ 30 fps while scrubbing |
| History integrity | `seek` byte-identical to re-simulation, 200 random ticks |
| Destructive history loss | impossible without explicit confirmation (E2E-proven, 3 paths) |
| Laboratory | 2 × 1M-cell sims at ≥ 30 fps each; identical-grid diff < 2 ms |
| Camera link drift | zero over 1,000 pan operations |
| Session migration | v1 and v2 documents load into v3 |
| Keybindings | conflicts and prefix-shadowing detected; profiles round-trip cross-platform |
| Onboarding | 3 novices independently draw and run a pattern after the tour |
| Memory | flat over a 30-minute session with 2 panes, history, and theme switching |

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Two panes × history × effects exceeds a browser tab's memory. | Tab crash — the worst possible failure. | Global history ceiling split across panes, a visible memory meter, an eviction policy that reports, and an explicit soft-limit warning before the hard limit. Test at the limit deliberately. |
| Timeline forking silently discards a long run. | Unforgivable data loss. | No-silent-truncation is a gate with three E2E specs. The confirmation states the exact generation count being discarded. |
| Undo and time travel confuse users. | Two good features cancel out. | `docs/time-model.md`, deliberate visual separation, first-use explainers, and user testing as an acceptance criterion (P4-C-4). |
| The palette becomes the only way to reach some features. | Discoverability collapses for non-power-users. | Rule: every palette-reachable feature also has a visible affordance somewhere. Audited by a checklist test that flags palette-only commands. |
| Attract mode is charming once, then irritating. | Users disable it and resent it. | 45 s idle threshold, never after any edit, instant exit, and a permanent off switch in settings. |
| Laboratory doubles the surface area of every future change. | Every later feature costs 2×. | Panes are symmetric with no primary special case (P4-D-1). Any component that cannot run in a pane is a bug found now, not in Phase 5. |
| Scrub-seek storms starve the worker. | Unresponsive UI during scrubbing. | Interruptible seeks with supersede-not-queue semantics, gated by test (P4-C-1). |

---

## 6. Definition of Done — Phase 4

- [ ] Every task above is `- [x]` or `- [-]` with a recorded reason.
- [ ] All Phase 4 quality gates (§4) green in CI on `main`.
- [ ] Every single feature in the application is reachable from the command palette and from a keyboard shortcut.
- [ ] No user action can discard history without an explicit, informative confirmation.
- [ ] The Laboratory can compare two rulesets on one seed and say exactly where they diverged.
- [ ] Three people who have never seen a cellular automaton complete the tour and successfully draw and run a pattern.
- [ ] `CHANGELOG.md` has a dated `[0.5.0]` entry; the commit is tagged `v0.5.0`.
- [ ] `docs/demo/phase-4.*` shows the palette, a rewind, and a laboratory comparison.
