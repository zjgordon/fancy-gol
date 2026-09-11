/**
 * Re-export of the shared Mulberry32. Canonical home is `src/shared/rng.ts` (P2-A-1) so `ui/`
 * can import the same class without crossing into `engine/`. Existing `@engine/rng` imports
 * keep working.
 */
export { Mulberry32 } from '../shared/rng.js';
