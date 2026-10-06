# Flatline

Flatline is a terminal that outlived its operator: amber phosphor on black, a
soft hum, and the after-image of every cell that has been. Live cells are
bright glyphs; dead ones leave a decaying ghost so you can still read where a
pattern *was*. Chrome is monospace and square, borders like box-drawing
characters. Motion is the star — panels type themselves in (never more than
400 ms, even for a large one), values scramble to their new digits, and exits
fall into characters. Reduced motion skips all of that: text is simply there.
Amber is the default phosphor; green and white are the same place with a
different tube.

## Approximations

Canvas2D cannot bend an image into a curved tube, so the **CRT curvature** is a stand-in, not the
real thing (ADR-012 D3): CRT corners drawn as a mask, not a true barrel warp — an edge falloff and
rounded dark corners. It is off at quality 1 and below. The exact warp ships with the WebGL2
renderer in Phase 5.
