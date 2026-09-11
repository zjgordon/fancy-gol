import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  checkPatternDir,
  checkPatternText,
  SPDX_ALLOWLIST,
} from '../../../scripts/check-pattern-licenses.mjs';

const GOOD = [
  '#N Glider',
  '#O Richard K. Guy, 1970',
  '#C SPDX-License-Identifier: CC0-1.0',
  '#C source: https://conwaylife.com/wiki/Glider',
  'x = 3, y = 3',
  'bo$2bo$3o!',
].join('\n');

describe('check-pattern-licenses', () => {
  it('allowlists CC0-1.0', () => {
    expect(SPDX_ALLOWLIST.has('CC0-1.0')).toBe(true);
  });

  it('accepts a complete header', () => {
    expect(checkPatternText(GOOD, 'glider.rle')).toEqual([]);
  });

  it('fails on missing #N, blank #O, missing source, or a non-allowlisted SPDX', () => {
    expect(checkPatternText(GOOD.replace('#N Glider\n', ''), 'x')).toEqual(
      expect.arrayContaining([expect.stringMatching(/missing #N/)]),
    );
    expect(checkPatternText(GOOD.replace('#O Richard K. Guy, 1970', '#O'), 'x')).toEqual(
      expect.arrayContaining([expect.stringMatching(/blank #O/)]),
    );
    expect(checkPatternText(GOOD.replace('#O Richard K. Guy, 1970\n', ''), 'x')).toEqual(
      expect.arrayContaining([expect.stringMatching(/missing #O/)]),
    );
    expect(checkPatternText(GOOD.replace('#C source: https://conwaylife.com/wiki/Glider\n', ''), 'x')).toEqual(
      expect.arrayContaining([expect.stringMatching(/missing #C source/)]),
    );
    expect(checkPatternText(GOOD.replace('https://conwaylife.com/wiki/Glider', 'not-a-url'), 'x')).toEqual(
      expect.arrayContaining([expect.stringMatching(/not an http/)]),
    );
    expect(checkPatternText(GOOD.replace('CC0-1.0', 'MIT'), 'x')).toEqual(
      expect.arrayContaining([expect.stringMatching(/not on the allowlist/)]),
    );
  });

  it('walks a directory and reports duplicate ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gol-lic-'));
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'ok.rle'), GOOD);
    writeFileSync(join(dir, 'nested', 'ok.rle'), GOOD);
    writeFileSync(join(dir, 'bad.rle'), 'x = 1, y = 1\no!\n');
    const { errors } = checkPatternDir(dir);
    expect(errors.some((e) => /duplicate id "ok"/.test(e))).toBe(true);
    expect(errors.some((e) => /bad\.rle/.test(e))).toBe(true);
  });

  it('flags an empty tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gol-lic-empty-'));
    expect(checkPatternDir(dir).errors[0]).toMatch(/no \.rle files/);
  });

  it('the shipped patterns/ tree is clean', () => {
    const root = fileURLToPath(new URL('../../../patterns', import.meta.url));
    expect(checkPatternDir(root).errors).toEqual([]);
  });
});

describe('licence scaffolding (P2-B-1)', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));

  it('records the LifeWiki footer verbatim with the 2026-09-11 verification date', () => {
    const sources = readFileSync(join(root, 'patterns/SOURCES.md'), 'utf8');
    expect(sources).toContain('verified 2026-09-11');
    expect(sources).toContain(
      'All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available',
    );
    expect(sources).toContain('Class A–D');
    expect(sources).toMatch(/two layers/i);
  });

  it('ships MIT for code and CC0-1.0 full text for content', () => {
    const license = readFileSync(join(root, 'LICENSE'), 'utf8');
    expect(license).toMatch(/MIT License/);
    const cc0 = readFileSync(join(root, 'LICENSES/CC0-1.0.txt'), 'utf8');
    expect(cc0).toMatch(/CC0 1\.0 Universal/);
    const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
    expect(notice).toMatch(/MIT/);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      license: string;
      private: boolean;
    };
    expect(pkg.license).toBe('MIT');
    expect(pkg.private).toBe(true);
  });
});
