import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATTERN_COLLECTION_CREDITS } from '@ui/panels/library/credits';

const SOURCES = readFileSync(join(process.cwd(), 'patterns/SOURCES.md'), 'utf8');

function tableSources(markdown: string): string[] {
  const section = markdown.split('## 4.')[1] ?? '';
  const names: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| Source') || line.startsWith('|---')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const name = cells[1];
    if (name && name !== 'Source') names.push(name);
  }
  return names;
}

describe('PATTERN_COLLECTION_CREDITS', () => {
  it('lists every SOURCES.md collection and its recorded terms', () => {
    const listed = tableSources(SOURCES);
    expect(listed.length).toBe(PATTERN_COLLECTION_CREDITS.length);
    expect(listed.length).toBeGreaterThan(0);
    for (const credit of PATTERN_COLLECTION_CREDITS) {
      const inTable = listed.some(
        (name) => name.includes(credit.source) || credit.source.includes(name.replace(/\*/g, '')),
      );
      expect(inTable, credit.source).toBe(true);
      expect(credit.terms.length).toBeGreaterThan(8);
      expect(credit.what.length).toBeGreaterThan(8);
    }
  });
});
