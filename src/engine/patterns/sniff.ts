/**
 * Pattern-format sniffing (P2-A-3). Classifies RLE, Life plaintext (`.cells`), and Life 1.06
 * from the bytes alone — no filename, no extension. Distinctive headers win; otherwise the
 * data lines vote (integer pairs vs `.O*` rows vs RLE `x =` / `$` / `!`).
 */
import { decode as decodeRle, PatternParseError, type RlePattern } from '../../shared/rle.js';
import { decode as decodeLife106, toRlePattern } from './life106.js';
import { decode as decodePlaintext } from './plaintext.js';

export type PatternFormat = 'rle' | 'plaintext' | 'life106';

const LIFE106_HEADER = /^#Life\s+1\.06\b/i;
const RLE_HEADER = /^\s*x\s*=/;
const COORD_LINE = /^[+-]?\d+\s+[+-]?\d+\s*$/;
const PLAINTEXT_ROW = /^[.O*o ]*$/;

export function sniffPatternFormat(text: string): PatternFormat {
  const lines = text.split(/\r?\n/);
  let dataLines = 0;
  let coordLines = 0;
  let plaintextRows = 0;
  let hasLife106 = false;
  let hasBangMeta = false;
  let hasBangComment = false;
  let hasRleHeader = false;
  let hasRleMeta = false;
  let hasRleBody = false;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (LIFE106_HEADER.test(trimmed)) {
      hasLife106 = true;
      continue;
    }
    if (/^!Name:/i.test(trimmed) || /^!Author:/i.test(trimmed)) {
      hasBangMeta = true;
      continue;
    }
    if (trimmed.startsWith('!')) {
      hasBangComment = true;
      continue;
    }
    if (RLE_HEADER.test(trimmed)) {
      hasRleHeader = true;
      continue;
    }
    if (/^#[NOCPcr]/i.test(trimmed) || trimmed.startsWith('#CXRLE')) {
      hasRleMeta = true;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    dataLines += 1;
    if (COORD_LINE.test(trimmed)) coordLines += 1;
    if (PLAINTEXT_ROW.test(trimmed) && /[O*o]/.test(trimmed)) plaintextRows += 1;
    if (/[$!]/.test(trimmed)) hasRleBody = true;
  }

  if (hasLife106) return 'life106';
  if (hasRleHeader) return 'rle';
  if (hasBangMeta || hasBangComment) return 'plaintext';
  if (hasRleMeta || hasRleBody) return 'rle';
  if (dataLines > 0 && coordLines === dataLines) return 'life106';
  if (dataLines > 0 && plaintextRows === dataLines) return 'plaintext';

  throw new PatternParseError(
    'unrecognised pattern format',
    1,
    1,
    'expected RLE (`x = W, y = H`), Life plaintext (`!Name:` / `.O*` rows), or Life 1.06 (`#Life 1.06`)',
  );
}

export function decodePattern(text: string): { format: PatternFormat; pattern: RlePattern } {
  const format = sniffPatternFormat(text);
  if (format === 'rle') return { format, pattern: decodeRle(text) };
  if (format === 'plaintext') return { format, pattern: decodePlaintext(text) };
  return { format, pattern: toRlePattern(decodeLife106(text)) };
}
