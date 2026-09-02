// Placeholder boot entry for the toolchain scaffold (P0-A).
// The real client shell — canvas, rAF loop, worker wiring, FPS/tick/population
// readout — is task P0-I-1. This file exists only so `npm run build` has
// something to build while Workstreams B-I land.
const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  root.textContent = 'fancy-gol — Phase 0 foundation in progress.';
}
