# Synthwave

Synthwave is the future as imagined in 1984: a magenta-to-cyan sky, a
horizon sun, and a perspective floor grid whose vanishing point drifts with
the camera — never loud enough to steal the simulation. Cells are neon with
hard chromatic edges; age walks the hue from hot pink toward ice cyan so a
running world reads as a light show that still encodes real data. Chrome is
italic, chrome-gradient, pink-glow on focus. Motion snaps with a slight
elastic overshoot. Sound is analog saw plucks with detune, gated reverb on
the big beats, and an arpeggiated ambient bed whose tempo tracks simulation
speed without a click when the slider moves.

## Approximations

Canvas2D has no cheap per-pixel warp, so one effect here is a stand-in, not the real thing
(ADR-012 D3). **Chromatic aberration** is an additive red and blue fringe on the left and right
edges — colour fringe on the left and right edges, not a radial warp. The exact radial effect ships
with the WebGL2 renderer in Phase 5.
