/**
 * Generations-family builtins. Star Wars is the 4-state crowd-pleaser; Bloomerang
 * is the long-decay showcase (24 states — too many for lutN, so it compiles as
 * a closure, which is the point of shipping it).
 */
import { fromNotation } from './from-notation';

export const STAR_WARS = fromNotation({
  id: 'star-wars',
  notation: 'B345/S2/G4',
  name: 'Star Wars',
  description:
    'A 4-state Generations rule (B345/S2/C4): cells are born on 3–5, survive on 2, then age through two decaying states. Named by Mirek Wójtowicz; produces exploding, filamentary growth that looks a lot like a space battle.',
  author: 'Mirek Wójtowicz',
  tags: ['chaotic', 'multi-state'],
});

export const BLOOMERANG = fromNotation({
  id: 'bloomerang',
  notation: 'B34678/S234/G24',
  name: 'Bloomerang',
  description:
    'A 24-state Generations rule (S234/B34678/24 in Golly order). Long decay trails bloom and rebound — the catalogue representative of "a Generations rule that is not Star Wars", and a compiler stress-test: 24 states miss lutN and run as a closure.',
  tags: ['multi-state'],
});
