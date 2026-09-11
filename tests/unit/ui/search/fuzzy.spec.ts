import { describe, expect, it } from 'vitest';
import { rankFuzzy, scoreFuzzy } from '@ui/search/fuzzy';

/** P4-A-1 bar: table-driven ranking. Each row asserts `winner` outranks `loser`. */
const RANK_PAIRS: readonly { query: string; winner: string; loser: string }[] = [
  { query: 'tgl', winner: 'Toggle Grid Lines', loser: 'Toggle Chrome' },
  { query: 'tgl', winner: 'Toggle Grid Lines', loser: 'Start Legal' },
  { query: 'tg', winner: 'Toggle Grid', loser: 'Retag' },
  { query: 'cmd', winner: 'Command Palette', loser: 'Random' },
  { query: 'pal', winner: 'Command Palette', loser: 'Play' },
  { query: 'play', winner: 'Play', loser: 'Display' },
  { query: 'rst', winner: 'Reset Simulation', loser: 'Forest' },
  { query: 'sv', winner: 'Save Session', loser: 'Observe' },
  { query: 'ld', winner: 'Load Session', loser: 'World' },
  { query: 'zw', winner: 'Zoom Window', loser: 'Fizzle' },
  { query: 'gg', winner: 'Gosper Glider Gun', loser: 'Egg' },
  { query: 'gosp', winner: 'Gosper glider gun', loser: 'Grasp' },
  { query: 'gun', winner: 'Gosper glider gun', loser: 'begun' },
  { query: 'hlp', winner: 'Help Topics', loser: 'Alpha' },
  { query: 'th', winner: 'Theme', loser: 'Width' },
  { query: 'br', winner: 'Brush', loser: 'Number' },
  { query: 'er', winner: 'Eraser', loser: 'Newer' },
  { query: 'sel', winner: 'Select', loser: 'Herself' },
  { query: 'fill', winner: 'Fill', loser: 'Fiddle' },
  { query: 'pan', winner: 'Pan', loser: 'Companion' },
  { query: 'stp', winner: 'Step Once', loser: 'Stopwatch' },
  { query: 'pse', winner: 'Pause', loser: 'Expose' },
  { query: 'clr', winner: 'Clear Grid', loser: 'Colorise' },
  { query: 'rnd', winner: 'Random Soup', loser: 'Round' },
  { query: 'fit', winner: 'Fit Pattern', loser: 'Benefit' },
  { query: 'copy', winner: 'Copy', loser: 'Copyright' },
  { query: 'cut', winner: 'Cut', loser: 'Execute' },
  { query: 'pst', winner: 'Paste', loser: 'Post' },
  { query: 'udo', winner: 'Undo', loser: 'Audio' },
  { query: 'rdo', winner: 'Redo', loser: 'Radio' },
  { query: 'lib', winner: 'Library', loser: 'Liability' },
  { query: 'stat', winner: 'Statistics', loser: 'Estate' },
  { query: 'rule', winner: 'Ruleset Studio', loser: 'Unruly' },
  { query: 'ww', winner: 'WireWorld', loser: 'Wow' },
  { query: 'con', winner: 'Conway', loser: 'Beacon' },
  { query: 'gl', winner: 'Glider', loser: 'Legal' },
  { query: 'p30', winner: 'p30', loser: 'p3' },
  { query: 'osc', winner: 'Oscillator', loser: 'Cost' },
  { query: 'ship', winner: 'Spaceship', loser: 'Worship' },
  { query: 'meth', winner: 'Methuselah', loser: 'Theme' },
  { query: 'ac', winner: 'Acorn', loser: 'Beacon' },
];

function better(query: string, winner: string, loser: string): void {
  const ranked = rankFuzzy(query, [winner, loser], (s) => [s]);
  expect(ranked[0]?.item, `"${query}" should prefer "${winner}" over "${loser}"`).toBe(winner);
}

describe('scoreFuzzy', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(scoreFuzzy('xyz', 'Glider')).toBeNull();
  });

  it('returns match indices that highlight exactly the matched characters', () => {
    const hit = scoreFuzzy('gosp', 'Gosper glider gun');
    expect(hit).not.toBeNull();
    const picked = [...hit!.indices].map((i) => 'Gosper glider gun'[i]).join('');
    expect(picked.toLowerCase()).toBe('gosp');
    expect(hit!.indices).toEqual([...hit!.indices].sort((a, b) => a - b));
  });

  it('gives an exact-prefix bonus so a leading match outranks a buried one', () => {
    const prefix = scoreFuzzy('go', 'Gosper');
    const buried = scoreFuzzy('go', 'ago');
    expect(prefix).not.toBeNull();
    expect(buried).not.toBeNull();
    expect(prefix!.score).toBeGreaterThan(buried!.score);
  });
});

describe('rankFuzzy (P4-A-1 table)', () => {
  it(`ranks ${RANK_PAIRS.length} query pairs with acronym and boundary bonuses`, () => {
    expect(RANK_PAIRS.length).toBeGreaterThanOrEqual(40);
    for (const row of RANK_PAIRS) better(row.query, row.winner, row.loser);
  });

});
