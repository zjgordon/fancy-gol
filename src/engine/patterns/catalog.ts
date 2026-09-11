/**
 * Parse a catalogue `.rle` into a {@link CatalogEntry}. Pure: takes text, returns
 * metadata. Disk walking stays in tests and in `scripts/check-pattern-licenses.mjs`.
 */
import { canonicalHash } from './normalize.js';
import { isCatalogCategory, type CatalogEntry } from './catalog-types.js';
import { decode } from '../../shared/rle.js';

export class CatalogParseError extends Error {
  readonly id: string;

  constructor(id: string, message: string) {
    super(`${id}: ${message}`);
    this.name = 'CatalogParseError';
    this.id = id;
  }
}

const FIELD = /^(SPDX-License-Identifier|SPDX-FileCopyrightText|source|verified|ruleset|category|period|speed|heat|aliases|tags|year|description)\s*:\s*(.*)$/;

const YEAR_SUFFIX = /^(.*?),\s*(\d{4})$/;

function csv(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function last(fields: Map<string, string[]>, key: string): string | undefined {
  const list = fields.get(key);
  if (!list || list.length === 0) return undefined;
  return list[list.length - 1];
}

function joined(fields: Map<string, string[]>, key: string): string {
  return (fields.get(key) ?? []).join(' ').trim();
}

function parseYear(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function parseCatalogEntry(id: string, text: string): CatalogEntry {
  const fields = new Map<string, string[]>();
  let name = '';
  let authorRaw = '';

  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('#N')) name = raw.slice(2).trim();
    else if (raw.startsWith('#O')) authorRaw = raw.slice(2).trim();
    else if (raw.startsWith('#C ') || raw.startsWith('#c ')) {
      const rest = raw.slice(3).trim();
      const m = FIELD.exec(rest);
      if (m) {
        const key = m[1]!;
        const val = m[2]!.trim();
        const list = fields.get(key);
        if (list) list.push(val);
        else fields.set(key, [val]);
      }
    }
  }

  if (!name) throw new CatalogParseError(id, 'missing #N name');
  if (!authorRaw) throw new CatalogParseError(id, 'missing #O discoverer');

  const yearField = parseYear(last(fields, 'year'));
  const yearMatch = YEAR_SUFFIX.exec(authorRaw);
  const discoverer = yearMatch ? yearMatch[1]!.trim() : authorRaw;
  const yearFromAuthor = yearMatch ? Number(yearMatch[2]) : null;
  const year = yearField !== undefined ? yearField : yearFromAuthor;

  const source = last(fields, 'source');
  if (!source) throw new CatalogParseError(id, 'missing #C source:');

  const spdxLicense = last(fields, 'SPDX-License-Identifier');
  if (!spdxLicense) throw new CatalogParseError(id, 'missing SPDX-License-Identifier');

  const ruleset = last(fields, 'ruleset');
  if (!ruleset) throw new CatalogParseError(id, 'missing #C ruleset:');

  const categoryRaw = last(fields, 'category');
  if (!categoryRaw) throw new CatalogParseError(id, 'missing #C category:');
  if (!isCatalogCategory(categoryRaw)) {
    throw new CatalogParseError(id, `unknown category "${categoryRaw}"`);
  }

  const description = joined(fields, 'description');
  if (!description) throw new CatalogParseError(id, 'missing #C description:');

  const periodRaw = last(fields, 'period');
  let period: number | null = null;
  if (periodRaw !== undefined && periodRaw !== 'none') {
    const n = Number(periodRaw);
    if (!Number.isFinite(n)) throw new CatalogParseError(id, `bad period "${periodRaw}"`);
    period = n;
  }

  const speedRaw = last(fields, 'speed');
  const speed = !speedRaw || speedRaw === 'none' ? null : speedRaw;

  const heatRaw = last(fields, 'heat');
  let heat: number | null = null;
  if (heatRaw !== undefined && heatRaw !== 'none') {
    const n = Number(heatRaw);
    if (!Number.isFinite(n)) throw new CatalogParseError(id, `bad heat "${heatRaw}"`);
    heat = n;
  }

  const pattern = decode(text);
  let population = 0;
  for (const cell of pattern.cells) {
    if (cell.state !== 0) population += 1;
  }

  return {
    id,
    name,
    aliases: csv(last(fields, 'aliases')),
    ruleset,
    category: categoryRaw,
    discoverer,
    year,
    width: pattern.width,
    height: pattern.height,
    population,
    period,
    speed,
    heat,
    description,
    source,
    tags: csv(last(fields, 'tags')),
    canonicalHash: canonicalHash(pattern),
    spdxLicense,
  };
}
