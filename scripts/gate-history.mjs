#!/usr/bin/env node
/**
 * gate-history.mjs — P2-F-3 accumulating flake record (planning/README.md §3.10).
 *
 * Criteria like "non-flaky over 10 CI runs" cannot be proven inside a task.
 * This module is the named place those criteria cite:
 *
 *   gate-history: e2e-nonflake ≥ 10 green
 *
 * Hand-written, bare `node`, no build step. Tests import the pure helpers
 * without spawning Playwright.
 *
 *   node scripts/gate-history.mjs summarize
 *   node scripts/gate-history.mjs cite e2e-nonflake 10
 *   node scripts/gate-history.mjs append --file records.jsonl --id e2e-nonflake --ok ...
 *   node scripts/gate-history.mjs sample --suites e2e,visual --repeats 1 ...
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const RECORD_DIR = join(ROOT, 'docs/gate-history');
export const DEFAULT_RECORDS = join(RECORD_DIR, 'records.jsonl');
export const DEFAULT_INDEX = join(RECORD_DIR, 'INDEX.md');

/** Record ids agents cite. The nightly workflow owns these two; a dedicated
 *  `browser-bench` id can join later without renaming anything. */
export const RECORD_IDS = {
  e2e: 'e2e-nonflake',
  visual: 'visual-nonflake',
};

/** Events that count toward the official (main-branch) streak. */
export const OFFICIAL_EVENTS = new Set(['schedule', 'push', 'workflow_dispatch']);

export const SCHEMA_VERSION = 1;

/**
 * @typedef {object} GateHistoryRecord
 * @property {number} v
 * @property {string} id
 * @property {boolean} ok
 * @property {string} at
 * @property {string} event
 * @property {string} branch
 * @property {string} sha
 * @property {number | null} [runId]
 * @property {string} [runUrl]
 * @property {string} suite
 * @property {number} [repeat]
 * @property {number} [repeats]
 * @property {number} [durationMs]
 * @property {string} [note]
 */

/** @param {string} text */
export function parseRecords(text) {
  const records = [];
  const errors = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      const rec = JSON.parse(line);
      const issues = validateRecord(rec);
      if (issues.length > 0) {
        errors.push(`line ${i + 1}: ${issues.join('; ')}`);
        continue;
      }
      records.push(rec);
    } catch (err) {
      errors.push(`line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { records, errors };
}

/** @param {unknown} rec */
export function validateRecord(rec) {
  const errors = [];
  if (rec === null || typeof rec !== 'object') return ['not an object'];
  const o = /** @type {Record<string, unknown>} */ (rec);
  if (o['v'] !== SCHEMA_VERSION) errors.push(`unsupported v (${o['v']})`);
  if (typeof o['id'] !== 'string' || o['id'] === '') errors.push('missing id');
  if (typeof o['ok'] !== 'boolean') errors.push('ok must be boolean');
  if (typeof o['at'] !== 'string' || o['at'] === '') errors.push('missing at');
  if (typeof o['event'] !== 'string' || o['event'] === '') errors.push('missing event');
  if (typeof o['branch'] !== 'string' || o['branch'] === '') errors.push('missing branch');
  if (typeof o['sha'] !== 'string' || o['sha'] === '') errors.push('missing sha');
  if (typeof o['suite'] !== 'string' || o['suite'] === '') errors.push('missing suite');
  return errors;
}

/** @param {string} path */
export function loadRecords(path = DEFAULT_RECORDS) {
  if (!existsSync(path)) return { records: [], errors: [] };
  return parseRecords(readFileSync(path, 'utf8'));
}

/** Newest-first consecutive `ok: true` for `id`, optionally filtered. */
export function streak(records, id, predicate = () => true) {
  const matching = records.filter((r) => r.id === id && predicate(r));
  matching.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  let n = 0;
  for (const r of matching) {
    if (!r.ok) break;
    n += 1;
  }
  return n;
}

/** Official streak: `main` + schedule/push/workflow_dispatch. */
export function officialStreak(records, id) {
  return streak(records, id, isOfficial);
}

/** @param {GateHistoryRecord} rec */
export function isOfficial(rec) {
  return rec.branch === 'main' && OFFICIAL_EVENTS.has(rec.event);
}

export function cite(id, n) {
  return `gate-history: ${id} ≥ ${n} green`;
}

export function evaluateCite(records, id, n, { official = true } = {}) {
  const actual = official ? officialStreak(records, id) : streak(records, id);
  return {
    ok: actual >= n,
    actual,
    need: n,
    cite: cite(id, n),
    official,
  };
}

/** @param {Partial<GateHistoryRecord> & Pick<GateHistoryRecord, 'id' | 'ok' | 'event' | 'branch' | 'sha' | 'suite'>} fields */
export function makeRecord(fields) {
  return {
    at: fields.at ?? new Date().toISOString(),
    runId: fields.runId ?? null,
    runUrl: fields.runUrl ?? '',
    repeat: fields.repeat ?? 1,
    repeats: fields.repeats ?? 1,
    durationMs: fields.durationMs ?? 0,
    note: fields.note ?? '',
    ...fields,
    v: SCHEMA_VERSION,
  };
}

export function serializeRecords(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
}

export function appendRecord(records, rec) {
  const issues = validateRecord(rec);
  if (issues.length > 0) throw new Error(`invalid record: ${issues.join('; ')}`);
  return [...records, rec];
}

export function formatIndex(records, { generated } = {}) {
  const stamp = generated ?? new Date().toISOString().slice(0, 10);
  const ids = [...new Set([...Object.values(RECORD_IDS), ...records.map((r) => r.id)])].sort();
  const lines = [
    '# Gate history',
    '',
    `Generated ${stamp} by \`scripts/gate-history.mjs\`. Do not hand-edit.`,
    `Source of truth: [\`records.jsonl\`](./records.jsonl). Policy: \`planning/README.md\` §3.10.`,
    '',
    'A task cites this file instead of pretending to run N CI jobs in-process:',
    '',
    '```',
    'gate-history: visual-nonflake ≥ 3 green',
    '```',
    '',
    '**Official** streak counts only samples on `main` from `schedule`, `push`, or `workflow_dispatch`.',
    'Phase-branch dispatch samples prove the mechanism; they do not count toward the cite.',
    '',
    '## Official streaks',
    '',
    '| record-id | official (main) | all-branches | last official |',
    '|---|---:|---:|---|',
  ];
  for (const id of ids) {
    const off = officialStreak(records, id);
    const all = streak(records, id);
    const last = [...records].filter((r) => r.id === id && isOfficial(r)).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const lastCell = last ? `${last.ok ? 'green' : 'red'} ${last.at.slice(0, 10)}` : '—';
    lines.push(`| \`${id}\` | ${off} | ${all} | ${lastCell} |`);
  }
  lines.push('', '## Log (newest first)', '', '| at | id | ok | branch | event | run |', '|---|---|---|---|---|---|');
  const newest = [...records].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  for (const r of newest.slice(0, 50)) {
    const run = r.runUrl ? `[${r.runId ?? 'run'}](${r.runUrl})` : String(r.runId ?? '—');
    lines.push(`| ${r.at} | \`${r.id}\` | ${r.ok ? 'green' : 'red'} | \`${r.branch}\` | ${r.event} | ${run} |`);
  }
  if (newest.length === 0) lines.push('| — | — | — | — | — | no samples yet |');
  lines.push('');
  return lines.join('\n');
}

export function writeRecords(path, records) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeRecords(records));
}

export function writeIndex(path, records, opts) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatIndex(records, opts));
}

function parseCli(argv) {
  const out = { command: argv[0] ?? 'summarize', rest: [], flags: {} };
  const flags = out.flags;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') flags.file = argv[++i];
    else if (a === '--index') flags.index = argv[++i];
    else if (a === '--id') flags.id = argv[++i];
    else if (a === '--ok') flags.ok = true;
    else if (a === '--fail') flags.ok = false;
    else if (a === '--event') flags.event = argv[++i];
    else if (a === '--branch') flags.branch = argv[++i];
    else if (a === '--sha') flags.sha = argv[++i];
    else if (a === '--run-id') flags.runId = Number(argv[++i]);
    else if (a === '--run-url') flags.runUrl = argv[++i];
    else if (a === '--suite') flags.suite = argv[++i];
    else if (a === '--suites') flags.suites = argv[++i];
    else if (a === '--repeats') flags.repeats = Number(argv[++i]);
    else if (a === '--repeat') flags.repeat = Number(argv[++i]);
    else if (a === '--note') flags.note = argv[++i];
    else if (a === '--duration-ms') flags.durationMs = Number(argv[++i]);
    else if (a === '--all-branches') flags.allBranches = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else out.rest.push(a);
  }
  return out;
}

function printHelp() {
  console.log(`gate-history.mjs — accumulating flake record (P2-F-3)

Commands:
  summarize [--file records.jsonl] [--index INDEX.md]
  cite <record-id> <n> [--file records.jsonl] [--all-branches]
  append --id e2e-nonflake --ok|--fail --event schedule --branch main --sha <hex> --suite e2e
  sample --suites e2e,visual --repeats 1 --branch <name> --sha <hex> --event schedule
`);
}

const SUITE_ARGS = {
  e2e: ['playwright', 'test', '--project=chromium', '--project=firefox', '--project=webkit'],
  visual: ['playwright', 'test', '--project=visual'],
};

/**
 * @param {string} suite
 * @param {{ spawn?: typeof spawnSync, cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function runSuite(suite, opts = {}) {
  const args = SUITE_ARGS[suite];
  if (!args) throw new Error(`unknown suite "${suite}" (want e2e or visual)`);
  const spawn = opts.spawn ?? spawnSync;
  const t0 = Date.now();
  const r = spawn('npx', args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}), E2E_SKIP_BUILD: '1', CI: 'true' },
    stdio: 'inherit',
  });
  return { ok: r.status === 0, durationMs: Date.now() - t0, status: r.status };
}

export function sampleSuites({
  suites,
  repeats,
  meta,
  run = runSuite,
}) {
  const results = [];
  let failed = false;
  for (const suite of suites) {
    const id = RECORD_IDS[suite] ?? `${suite}-nonflake`;
    for (let i = 1; i <= repeats; i++) {
      const { ok, durationMs } = run(suite);
      if (!ok) failed = true;
      results.push(
        makeRecord({
          id,
          ok,
          suite,
          repeat: i,
          repeats,
          durationMs,
          ...meta,
        }),
      );
    }
  }
  return { results, failed };
}

function main(argv) {
  const { command, rest, flags } = parseCli(argv);
  if (flags.help || command === 'help') {
    printHelp();
    return 0;
  }
  const file = flags.file ?? DEFAULT_RECORDS;
  const indexPath = flags.index ?? DEFAULT_INDEX;

  if (command === 'summarize') {
    const { records, errors } = loadRecords(file);
    if (errors.length > 0) {
      for (const e of errors) console.error(`✗ ${e}`);
      return 1;
    }
    writeIndex(indexPath, records);
    process.stdout.write(formatIndex(records));
    return 0;
  }

  if (command === 'cite') {
    const id = rest[0];
    const n = Number(rest[1]);
    if (!id || !Number.isInteger(n) || n < 1) {
      console.error('usage: gate-history.mjs cite <record-id> <n>');
      return 2;
    }
    const { records, errors } = loadRecords(file);
    if (errors.length > 0) {
      for (const e of errors) console.error(`✗ ${e}`);
      return 1;
    }
    const r = evaluateCite(records, id, n, { official: !flags.allBranches });
    console.log(`${r.cite}  actual=${r.actual}  ${r.ok ? 'MET' : 'UNMET'}  (${r.official ? 'official/main' : 'all-branches'})`);
    return r.ok ? 0 : 1;
  }

  if (command === 'append') {
    const ok = flags.ok;
    if (typeof ok !== 'boolean' || !flags.id || !flags.event || !flags.branch || !flags.sha || !flags.suite) {
      console.error('append requires --id --ok|--fail --event --branch --sha --suite');
      return 2;
    }
    const { records, errors } = loadRecords(file);
    if (errors.length > 0) {
      for (const e of errors) console.error(`✗ ${e}`);
      return 1;
    }
    const rec = makeRecord({
      id: flags.id,
      ok,
      event: flags.event,
      branch: flags.branch,
      sha: flags.sha,
      suite: flags.suite,
      runId: Number.isFinite(flags.runId) ? flags.runId : null,
      runUrl: flags.runUrl ?? '',
      repeat: flags.repeat ?? 1,
      repeats: flags.repeats ?? 1,
      durationMs: flags.durationMs ?? 0,
      note: flags.note ?? '',
    });
    const next = appendRecord(records, rec);
    writeRecords(file, next);
    writeIndex(indexPath, next);
    console.log(`appended ${rec.id} ${rec.ok ? 'green' : 'red'} (${next.length} records)`);
    return rec.ok ? 0 : 1;
  }

  if (command === 'sample') {
    const suites = String(flags.suites ?? 'e2e,visual')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const repeats = Number.isInteger(flags.repeats) && flags.repeats > 0 ? flags.repeats : 1;
    if (!flags.event || !flags.branch || !flags.sha) {
      console.error('sample requires --event --branch --sha');
      return 2;
    }
    const { records, errors } = loadRecords(file);
    if (errors.length > 0) {
      for (const e of errors) console.error(`✗ ${e}`);
      return 1;
    }
    const { results, failed } = sampleSuites({
      suites,
      repeats,
      meta: {
        event: flags.event,
        branch: flags.branch,
        sha: flags.sha,
        runId: Number.isFinite(flags.runId) ? flags.runId : null,
        runUrl: flags.runUrl ?? '',
        note: flags.note ?? '',
      },
    });
    let next = records;
    for (const rec of results) next = appendRecord(next, rec);
    writeRecords(file, next);
    writeIndex(indexPath, next);
    for (const rec of results) {
      console.log(`${rec.suite}#${rec.repeat} ${rec.ok ? 'green' : 'red'} ${rec.durationMs}ms`);
    }
    return failed ? 1 : 0;
  }

  console.error(`unknown command "${command}"`);
  printHelp();
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
