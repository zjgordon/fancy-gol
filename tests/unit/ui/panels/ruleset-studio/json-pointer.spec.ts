import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  indexJsonPointers,
  locatePointer,
  offsetToLineCol,
  syntaxErrorLocation,
  lineStarts,
} from '@ui/panels/ruleset-studio/json-pointer';

const CONWAY = readFileSync(join(process.cwd(), 'tests/fixtures/rules/valid/conway.json'), 'utf8');
const BORN_OOB = readFileSync(
  join(process.cwd(), 'tests/fixtures/rules/invalid/totalistic-born-out-of-range.json'),
  'utf8',
);

describe('indexJsonPointers', () => {
  it('maps /transition/born/0 onto the 3 in the Conway fixture', () => {
    const loc = locatePointer(CONWAY, '/transition/born/0');
    expect(loc).not.toBeNull();
    expect(CONWAY[loc!.offset]).toBe('3');
    expect(loc!.line).toBeGreaterThan(1);
    const line = CONWAY.split('\n')[loc!.line - 1]!;
    expect(line).toContain('3');
  });

  it('maps /transition/born/0 onto the illegal 9', () => {
    const loc = locatePointer(BORN_OOB, '/transition/born/0');
    expect(loc).not.toBeNull();
    expect(BORN_OOB[loc!.offset]).toBe('9');
    expect(BORN_OOB.split('\n')[loc!.line - 1]).toContain('9');
  });

  it('records the document root at pointer ""', () => {
    const index = indexJsonPointers('{\n  "id": "x"\n}');
    expect(index.get('')?.line).toBe(1);
    expect(index.get('/id')?.line).toBe(2);
  });

  it('escapes ~ and / in object keys', () => {
    const text = '{ "a/b": 1, "c~d": 2 }';
    const index = indexJsonPointers(text);
    expect(index.has('/a~1b')).toBe(true);
    expect(index.has('/c~0d')).toBe(true);
  });

  it('walks to a parent when the exact pointer is missing', () => {
    const loc = locatePointer('{ "transition": { "born": [3] } }', '/transition/born/99');
    expect(loc).not.toBeNull();
    expect(loc!.line).toBe(1);
  });
});

describe('syntaxErrorLocation', () => {
  it('reads a V8 position N message', () => {
    const text = '{ "a": 1, }';
    const loc = syntaxErrorLocation(text, new Error('Unexpected token } in JSON at position 10'));
    expect(loc.offset).toBe(10);
    expect(loc.line).toBe(1);
  });

  it('reads a line/column message', () => {
    const text = '{\n  "a":\n}';
    const loc = syntaxErrorLocation(text, new Error('JSON.parse: unexpected character at line 3 column 1 of the JSON data'));
    expect(loc.line).toBe(3);
    expect(loc.column).toBe(1);
  });

  it('falls back to line 1', () => {
    expect(syntaxErrorLocation('{}', 'nope')).toEqual({ offset: 0, line: 1, column: 1 });
  });
});

describe('offsetToLineCol', () => {
  it('treats the first character as line 1 column 1', () => {
    expect(offsetToLineCol(lineStarts('ab\ncd'), 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineCol(lineStarts('ab\ncd'), 3)).toEqual({ line: 2, column: 1 });
  });
});
