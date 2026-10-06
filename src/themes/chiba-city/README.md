# Chiba-City

Chiba-City is a night market that never closed: near-black air, a cyan grid that
recedes into haze, and cells that ignite white-hot on birth then cool through
ice to deep green as they age. Chrome is monospace, angular, thin-neon — a
terminal that answers in one frame, with a mechanical overshoot rather than a
bounce. Scanlines are dpr-pitched so they never moiré; bloom stays on live
cells; chromatic fringe lives only at the viewport edge. Sound is filtered
square blips, a low modem-hum, and a click when you change tools. It is the
first of the six that is a *place*, not a palette.

## Approximations

Canvas2D has no cheap per-pixel warp, so one effect here is a stand-in, not the real thing
(ADR-012 D3). **Chromatic aberration** is an additive red and blue fringe on the left and right
edges — colour fringe on the left and right edges, not a radial warp. The exact radial effect ships
with the WebGL2 renderer in Phase 5.
