import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePattern, sniffPatternFormat, type PatternFormat } from '@engine/patterns/sniff';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');

function collect(dir: string, ext: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f));
}

describe('pattern format sniffing (P2-A-3)', () => {
  it('picks the right decoder for every fixture without an extension hint', () => {
    const cases: Array<{ files: string[]; format: PatternFormat }> = [
      { files: collect(join(ROOT, 'tests/fixtures/rle/corpus'), '.rle'), format: 'rle' },
      { files: collect(join(ROOT, 'tests/fixtures/rle/canonical'), '.rle'), format: 'rle' },
      { files: collect(join(ROOT, 'tests/fixtures/patterns/plaintext'), '.cells'), format: 'plaintext' },
      { files: collect(join(ROOT, 'tests/fixtures/patterns/life106'), '.life'), format: 'life106' },
    ];
    let n = 0;
    for (const { files, format } of cases) {
      expect(files.length, format).toBeGreaterThan(0);
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        // Strip the extension from the assertion name so a regression can't "cheat" on the path.
        expect(sniffPatternFormat(text), file.replace(/\.[^.]+$/, '')).toBe(format);
        const decoded = decodePattern(text);
        expect(decoded.format).toBe(format);
        expect(decoded.pattern.width).toBeGreaterThanOrEqual(0);
        expect(decoded.pattern.height).toBeGreaterThanOrEqual(0);
        n += 1;
      }
    }
    expect(n).toBeGreaterThanOrEqual(40);
  });

  it('sniffs a headerless coordinate list as Life 1.06 and a bare .O* grid as plaintext', () => {
    expect(sniffPatternFormat('0 0\n1 0\n2 0\n')).toBe('life106');
    expect(sniffPatternFormat('.O.\n..O\nOOO\n')).toBe('plaintext');
    expect(sniffPatternFormat('x = 3, y = 3\nbo$2bo$3o!')).toBe('rle');
  });

  it('rejects bytes that match none of the three formats', () => {
    expect(() => sniffPatternFormat('this is not a pattern\n')).toThrow(/unrecognised/);
  });
});
