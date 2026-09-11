import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  SRC,
  MATRIX,
  PURE_LAYERS,
  isImportAllowed,
  resolveSpecifier,
  scanForbiddenGlobals,
} from '../../scripts/check-boundaries.mjs';

describe('boundary matrix (ADR-009)', () => {
  it('rejects ui/ importing an engine internal', () => {
    expect(isImportAllowed('ui', 'engine/simulation')).toBe(false);
  });

  it('rejects engine/ importing from render/', () => {
    expect(isImportAllowed('engine', 'render/canvas2d')).toBe(false);
  });

  it('allows engine/ importing shared/types', () => {
    expect(isImportAllowed('engine', 'shared/types')).toBe(true);
    expect(isImportAllowed('engine', 'shared/types.ts')).toBe(true);
  });

  it('allows engine/ to import any shared/ module (pure-logic lane, P2-A-1)', () => {
    expect(MATRIX['engine']).toContain('shared');
    expect(isImportAllowed('engine', 'shared/rle')).toBe(true);
    expect(isImportAllowed('engine', 'shared/rng')).toBe(true);
    expect(isImportAllowed('engine', 'shared/protocol')).toBe(true);
  });

  it('allows a layer to import from itself', () => {
    expect(isImportAllowed('worker', 'worker/handler')).toBe(true);
  });

  it('allows client/ to import everything except server/', () => {
    expect(isImportAllowed('client', 'engine/index')).toBe(true);
    expect(isImportAllowed('client', 'ui/hud')).toBe(true);
    expect(isImportAllowed('client', 'server/app')).toBe(false);
  });

  it('allows ui/ to import the full themes/ layer but only render/types', () => {
    expect(isImportAllowed('ui', 'themes/void-walker')).toBe(true);
    expect(isImportAllowed('ui', 'render/types')).toBe(true);
    expect(isImportAllowed('ui', 'render/canvas2d')).toBe(false);
  });
});

describe('specifier resolution', () => {
  it('resolves an alias import to its src-relative path', () => {
    expect(resolveSpecifier('@engine/simulation', join(SRC, 'worker'))).toBe(
      'engine/simulation',
    );
  });

  it('resolves a relative import against the importing file directory', () => {
    expect(resolveSpecifier('./chunk', join(SRC, 'engine/grid'))).toBe('engine/grid/chunk');
    expect(resolveSpecifier('../types', join(SRC, 'engine/grid'))).toBe('engine/types');
  });

  it('leaves bare package specifiers unresolved (external)', () => {
    expect(resolveSpecifier('vitest', join(SRC, 'engine'))).toBeNull();
  });

  it('strips a trailing .js from a relative import (server-side code names the compiled output, same module identity)', () => {
    expect(resolveSpecifier('./chunk.js', join(SRC, 'engine/grid'))).toBe('engine/grid/chunk');
    expect(resolveSpecifier('../types.js', join(SRC, 'engine/grid'))).toBe('engine/types');
    expect(resolveSpecifier('../../shared/types.js', join(SRC, 'server/store'))).toBe('shared/types');
  });
});

describe('forbidden globals in src/engine/** and src/shared/**', () => {
  it('catches a window reference', () => {
    const hits = scanForbiddenGlobals('export function boot() {\n  window.title = "x";\n}');
    expect(hits).toContainEqual({ global: 'window', line: 2 });
  });

  it('does not flag identifiers that merely contain a forbidden name', () => {
    const hits = scanForbiddenGlobals('const windowSize = 4;\nconst myConsole = {};');
    expect(hits).toHaveLength(0);
  });

  it('does not flag a forbidden name used as a property access', () => {
    const hits = scanForbiddenGlobals('foo.window;\nbar.console.log();');
    expect(hits).toHaveLength(0);
  });

  it('does not flag a forbidden name mentioned only in a comment', () => {
    const hits = scanForbiddenGlobals(
      '// this must never call performance.now() or new Date()\n/** window, document */\nexport const x = 1;',
    );
    expect(hits).toHaveLength(0);
  });

  it('does not flag a forbidden name mentioned only in a string or template literal', () => {
    const hits = scanForbiddenGlobals(
      "const a = 'a rule document must be a JSON object';\n" +
        'const b = "no console.log here";\n' +
        'const c = `performance and window are just words`;',
    );
    expect(hits).toHaveLength(0);
  });

  it('still catches a forbidden global right after a string literal on the same line', () => {
    const hits = scanForbiddenGlobals("const a = 'document'; window.title = 'x';");
    expect(hits).toContainEqual({ global: 'window', line: 1 });
  });

  it('is clean for pure engine and shared code', () => {
    const hits = scanForbiddenGlobals('export const add = (a: number, b: number) => a + b;');
    expect(hits).toHaveLength(0);
  });

  it('treats engine and shared as the same purity scan (ADR-009)', () => {
    expect(PURE_LAYERS.has('engine')).toBe(true);
    expect(PURE_LAYERS.has('shared')).toBe(true);
    expect(PURE_LAYERS.has('ui')).toBe(false);
  });

  it('finds no forbidden globals in the real shared/ tree', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) files.push(full);
      }
    };
    walk(join(SRC, 'shared'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(scanForbiddenGlobals(readFileSync(file, 'utf8')), file).toEqual([]);
    }
  });
});
