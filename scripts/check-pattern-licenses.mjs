#!/usr/bin/env node
/**
 * check-pattern-licenses.mjs — every shipped .rle under patterns/ must carry a name,
 * a discoverer, a source URL, and an allowlisted SPDX identifier (planning/README.md §3.9).
 *
 * Hand-written, bare `node`, no build step. Tests import the pure helpers without
 * walking the real tree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** SPDX identifiers this repo is currently allowed to ship. Grow this when a Class-C source lands. */
export const SPDX_ALLOWLIST = new Set(['CC0-1.0']);

const SOURCE_RE = /^https?:\/\/\S+$/;

export function collectRleFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectRleFiles(full, out);
    else if (name.endsWith('.rle')) out.push(full);
  }
  return out;
}

/**
 * @param {string} text
 * @param {string} label  path or fixture name, used in error messages
 * @returns {string[]}
 */
export function checkPatternText(text, label) {
  const errors = [];
  let name = null;
  let author = null;
  let spdx = null;
  let source = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#N')) {
      name = line.slice(2).trim();
    } else if (line.startsWith('#O')) {
      author = line.slice(2).trim();
    } else if (line.startsWith('#C ') || line.startsWith('#c ')) {
      const rest = line.slice(3).trim();
      const spdxMatch = /^SPDX-License-Identifier:\s*(\S+)/.exec(rest);
      if (spdxMatch) spdx = spdxMatch[1];
      const srcMatch = /^source:\s*(\S+)/.exec(rest);
      if (srcMatch) source = srcMatch[1];
    }
  }

  if (!name) errors.push(`${label}: missing #N name`);
  if (author === null) errors.push(`${label}: missing #O discoverer`);
  else if (author === '') errors.push(`${label}: blank #O (use "unknown" if the discoverer is not recorded)`);
  if (!source) errors.push(`${label}: missing #C source: URL`);
  else if (!SOURCE_RE.test(source)) errors.push(`${label}: source: is not an http(s) URL (${source})`);
  if (!spdx) errors.push(`${label}: missing #C SPDX-License-Identifier`);
  else if (!SPDX_ALLOWLIST.has(spdx)) {
    errors.push(`${label}: SPDX-License-Identifier "${spdx}" is not on the allowlist`);
  }
  return errors;
}

/**
 * @param {string} dir
 * @returns {{ files: string[], errors: string[] }}
 */
export function checkPatternDir(dir) {
  const files = collectRleFiles(dir);
  const errors = [];
  const ids = new Map();
  if (files.length === 0) errors.push(`${dir}: no .rle files`);
  for (const file of files) {
    const id = basename(file, '.rle');
    const prev = ids.get(id);
    if (prev) errors.push(`${file}: duplicate id "${id}" (also ${prev})`);
    ids.set(id, file);
    const text = readFileSync(file, 'utf8');
    const rel = relative(dir, file) || file;
    errors.push(...checkPatternText(text, rel));
  }
  return { files, errors };
}

function main() {
  const dir = join(ROOT, 'patterns');
  const { files, errors } = checkPatternDir(dir);
  if (errors.length > 0) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error('\nPattern licence check failed. See patterns/SOURCES.md and planning/README.md §3.9.');
    process.exit(1);
  }
  console.log(`✓ pattern licences clean (${files.length} files)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
