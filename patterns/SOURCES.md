# Pattern sources and licensing

This file is the policy for everything under `patterns/`. It is not a dump of other
people's catalogues.

## 1. Two layers

Licensing is two decisions, not one.

| Layer | What | Licence |
|---|---|---|
| **Code** | `src/`, `scripts/`, `tests/`, project config | MIT (`LICENSE`, `package.json` `"license": "MIT"`) |
| **Content** | every `patterns/**/*.rle`, this file's table | **per item** — no blanket content licence |

Policy in one sentence: **take facts, write your own words.** Name, discoverer, year,
period, speed, population, bounding box, and the cell layout are treated as facts.
Library descriptions are written here; they are never pasted from a wiki.

## 2. Provenance classes (allowlist)

Class A–D are the only dispositions this catalogue recognises. Class D is omitted, never shipped.

| Class | Meaning | SPDX / disposition |
|---|---|---|
| **A** | Originated here (agent-generated, hand-drawn, own soup search) | `CC0-1.0` |
| **B** | Canonical historical configuration; attributed; treated as fact | `CC0-1.0` + `SPDX-FileCopyrightText: none claimed (configuration; see SOURCES.md §2)` |
| **C** | Named collection with published terms that permit redistribution | Terms recorded verbatim in this table; per-file SPDX from the allowlist |
| **D** | Unclear provenance | **Omitted.** Never shipped. |

The seed set in P2-B-1 is Class B unless a file's `#C` lines say otherwise. `scripts/check-pattern-licenses.mjs`
fails the build unless every shipped `.rle` has `#N`, `#O` (`unknown` is allowed, blank is not), a
`source:` URL, and an allowlisted `SPDX-License-Identifier`.

## 3. LifeWiki terms (operator-verified 2026-09-11)

Read from the LifeWiki site footer at https://conwaylife.com/wiki/ (conwaylife.com), recorded
verbatim:

> All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available
> under the Creative Commons CC0 License; text in the other namespaces is available under the
> Creative Commons Attribution-ShareAlike License; additional terms may apply.

The footer does not state a BY-SA version number. This catalogue uses LifeWiki **structured
data / facts** (CC0) and original descriptions. Wiki prose is not embedded. `LICENSES/CC0-1.0.txt`
is the content licence in use for the seed set; BY-SA is not in `LICENSES/` because no Class-C
source that requires it has been imported.

## 4. Per-source table

| Source | What we take | Class | Terms (verbatim / summary) | Seed patterns |
|---|---|---|---|---|
| LifeWiki (conwaylife.com) | Facts: names, discoverers, years, periods, speeds, layouts | B | Footer quoted in §3, verified 2026-09-11. Structured data CC0; wiki text BY-SA (unused here). | Conway staples, HighLife seed, Day & Night seed, Seeds cluster, Brian's Brain spark |
| LifeWiki + *Mathematics and Construction* book RLEs | Additional Conway facts (space rake, puffer 2, twin bees, New gun 1, switch-engine family, Semi-Snark) | B | Same footer as §3. Book pages publish RLE as structured pattern data; descriptions original. | P2-B-5 Conway completion set |
| WireWorld (Brian Silverman, 1987) | Canonical diode layout as a historical configuration | B | Configuration treated as fact; description original | `wireworld-diode` |
| fancy-gol P2-B-5 | Class A barcodes, WireWorld gate sketches, Highlands documented soup, Brian's Brain ships found by search | A | Originated here, CC0 | Other-ruleset minimums; constellation pairs |

Individual `source:` URLs are on each file's `#C` lines. Do not wholesale-mirror an archive.
Hand-pick, attribute, verify by simulation, or omit.
