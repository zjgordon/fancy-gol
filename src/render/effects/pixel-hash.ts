/**
 * P3-A-5 — FNV-1a hash over an RGBA buffer. Deterministic pixel fingerprint for effect tests
 * (PHASE_3 P3-A-5: recorder / pixel hash).
 */
export function hashPixels(data: ArrayLike<number>, length = data.length): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < length; i++) {
    h ^= data[i]! & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
