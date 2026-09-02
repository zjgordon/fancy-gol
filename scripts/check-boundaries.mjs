#!/usr/bin/env node
/**
 * check-boundaries.mjs — machine-enforce ADR-009's layering matrix and the
 * "Pure Logic" rule (src/engine/** touches no DOM/Node/I-O global).
 *
 * Hand-written per the no-bloat rule: a regex import scan, no TypeScript API.
 * Usage: node scripts/check-boundaries.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SRC = join(ROOT, 'src');

/** ADR-009 dependency matrix. Each layer may always import from itself. */
export const MATRIX = {
  engine: ['engine', 'shared/types'],
  shared: ['shared'],
  worker: ['worker', 'engine', 'shared'],
  render: ['render', 'shared', 'themes/types'],
  themes: ['themes', 'shared', 'render/types', 'audio/types'],
  audio: ['audio', 'shared'],
  ui: ['ui', 'shared', 'render/types', 'themes', 'audio'],
  client: ['client', 'engine', 'shared', 'worker', 'render', 'ui', 'themes', 'audio'],
  server: ['server', 'engine', 'shared'],
};

const ALIASES = ['engine', 'shared', 'render', 'ui', 'themes', 'worker'];

/** Global identifiers forbidden anywhere under src/engine/**. */
export const FORBIDDEN_ENGINE_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'fetch',
  'console',
  'process',
  'require',
  'performance',
  // Not in ADR-009's list, but time must be injected (src/engine/clock.ts, P0-B-3) —
  // `Date` is just as much a hidden non-determinism source as `performance`.
  'Date',
];

const IMPORT_RE = /(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;

/** Pull every module specifier a file imports or re-exports from. */
export function extractImports(source) {
  const specs = new Set();
  for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    for (const m of source.matchAll(re)) specs.add(m[1]);
  }
  return [...specs];
}

/** Resolve a specifier to a `src/`-relative path, or null if it is an external package. */
export function resolveSpecifier(spec, fromFileDir) {
  if (spec.startsWith('.')) {
    const abs = resolve(fromFileDir, spec);
    const rel = relative(SRC, abs).split('\\').join('/');
    return rel.startsWith('..') ? null : rel;
  }
  const alias = ALIASES.find((a) => spec === `@${a}` || spec.startsWith(`@${a}/`));
  if (alias) return spec.replace(`@${alias}`, alias);
  return null; // bare package specifier — not layer-checked
}

function firstSegment(relPath) {
  return relPath.split('/')[0];
}

/** Does an allowed-list entry (e.g. "render/types") cover this target path? */
function matches(allowedEntry, targetRelPath) {
  return (
    targetRelPath === allowedEntry ||
    targetRelPath === `${allowedEntry}.ts` ||
    targetRelPath === `${allowedEntry}.tsx` ||
    targetRelPath.startsWith(`${allowedEntry}/`)
  );
}

export function isImportAllowed(fromLayer, targetRelPath) {
  const allowed = MATRIX[fromLayer];
  if (!allowed) return false;
  return allowed.some((entry) => matches(entry, targetRelPath));
}

/** Blank out comment bodies (preserving line breaks and column count) so prose mentioning a
 *  forbidden word (e.g. a TSDoc comment explaining *why* `performance` is banned) doesn't
 *  trip the scanner. Imperfect for comment-like text inside string literals — acceptable for
 *  an ~100-line hand-written tool. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

export function scanForbiddenGlobals(source) {
  const hits = [];
  const lines = stripComments(source).split('\n');
  for (const global of FORBIDDEN_ENGINE_GLOBALS) {
    const re = new RegExp(`(?<![.\\w$])${global}(?![\\w$])`, 'g');
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push({ global, line: i + 1 });
      re.lastIndex = 0;
    });
  }
  return hits;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function main() {
  if (!existsSync(SRC)) {
    console.log('✓ boundaries clean (src/ does not exist yet)');
    return;
  }

  let ok = true;
  const files = walk(SRC);

  for (const file of files) {
    const relFromSrc = relative(SRC, file).split('\\').join('/');
    const layer = firstSegment(relFromSrc);
    const source = readFileSync(file, 'utf8');

    if (MATRIX[layer]) {
      for (const spec of extractImports(source)) {
        const target = resolveSpecifier(spec, dirname(file));
        if (target === null) continue; // external package
        if (!isImportAllowed(layer, target)) {
          ok = false;
          console.error(`✗ ${relative(ROOT, file)}: ${layer}/ may not import "${spec}" (→ ${target})`);
        }
      }
    }

    if (layer === 'engine') {
      for (const hit of scanForbiddenGlobals(source)) {
        ok = false;
        console.error(`✗ ${relative(ROOT, file)}:${hit.line}: forbidden global "${hit.global}" in src/engine/**`);
      }
    }
  }

  if (ok) {
    console.log(`✓ boundaries clean (${files.length} files scanned)`);
  } else {
    console.error('\nBoundary check failed. See ADR-009 for the layering matrix.');
    process.exit(1);
  }
}

// Only run the filesystem walk when invoked directly, so tests can import the
// pure functions above without touching disk.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
