/**
 * User-facing stats copy (P2-D-3). Numbers stay numbers; approximations always
 * say so. `ui/` formats the worker's `StatsCycleFinding` — it does not import
 * the engine's detector.
 */
import type { StatsCycleFinding } from '@shared/protocol';

export function describeCycleFinding(finding: StatsCycleFinding): string {
  const at = `at generation ${finding.detectedAt}`;
  if (finding.kind === 'spaceship') {
    const { x, y } = finding.displacement;
    return `Period ${finding.period} spaceship detected ${at} (Δ${x}, Δ${y})`;
  }
  if (finding.kind === 'windowed') {
    return `Period ${finding.period} gun detected ${at}`;
  }
  return `Period ${finding.period} oscillator detected ${at}`;
}

export function formatCount(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

export function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded.toLocaleString('en-US')}`;
  return rounded.toLocaleString('en-US');
}

export function formatDensity(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export function formatHash(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

export function formatBbox(b: { x: number; y: number; width: number; height: number }): string {
  if (b.width <= 0 || b.height <= 0) return 'empty';
  return `${b.width}×${b.height} at (${b.x}, ${b.y})`;
}

export function formatCentroid(c: { x: number; y: number }): string {
  return `(${c.x.toFixed(2)}, ${c.y.toFixed(2)})`;
}
