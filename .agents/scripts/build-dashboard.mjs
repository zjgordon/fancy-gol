#!/usr/bin/env node
/**
 * build-dashboard.mjs — regenerate .agents/dashboard.html from the phase plans.
 *
 * The phase documents are the tracker. This script reads their task checkboxes
 * and acceptance-criteria checkboxes and rewrites the generated STATE block
 * inside the dashboard. Nothing else in the dashboard is touched.
 *
 * Usage:
 *   node .agents/scripts/build-dashboard.mjs            regenerate in place
 *   node .agents/scripts/build-dashboard.mjs --check    exit 1 if out of date
 *
 * Zero dependencies. Node >= 18.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS = dirname(dirname(fileURLToPath(import.meta.url)));
const PLANNING = join(AGENTS, 'planning');
const DASHBOARD = join(AGENTS, 'dashboard.html');

const BEGIN = '/* <<<STATE:BEGIN>>>';
const END = '/* <<<STATE:END>>> */';

const STATUS = { ' ': 'todo', x: 'done', X: 'done', '~': 'wip', '!': 'blocked', '-': 'cut' };

/** Strip the markdown we do not want inside a JSON string. */
const clean = (s) =>
  s.replace(/\*\*/g, '')
   .replace(/\*/g, '')
   .replace(/`/g, '')
   .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
   .replace(/&/g, 'and')
   .replace(/\s+/g, ' ')
   .trim();

const slug = (s) =>
  clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parsePhase(file) {
  const src = readFileSync(join(PLANNING, file), 'utf8');
  const lines = src.split('\n');

  const n = Number(/^PHASE_(\d)_/.exec(file)[1]);
  const phase = {
    n,
    name: clean((/^#\s+Phase\s+\d+\s+[—-]\s+(.+)$/m.exec(src) || [, 'Untitled'])[1]),
    version: (/\|\s*\*\*Ships version\*\*\s*\|\s*`([^`]+)`/.exec(src) || [, '0.0.0'])[1],
    motto: clean((/\|\s*\*\*Theme of the phase\*\*\s*\|\s*(.+?)\s*\|/.exec(src) || [, ''])[1]),
    demo: clean((/\|\s*\*\*The demo that proves it\*\*\s*\|\s*(.+?)\s*\|\s*$/m.exec(src) || [, ''])[1]),
    doc: file,
    ws: []
  };

  let ws = null;
  let task = null;

  for (const line of lines) {
    const mWs = /^###\s+Workstream\s+([A-Z])\s+[—-]\s+(.+)$/.exec(line);
    const mTask = /^####\s+-\s+\[(.)\]\s+(P\d-[A-Z]-\d+)\s+·\s+(.+)$/.exec(line);
    const mBox = /^\s*-\s+\[(.)\]\s/.exec(line);

    if (mWs) {
      ws = { id: mWs[1], name: clean(mWs[2]), tasks: [] };
      phase.ws.push(ws);
      task = null;
      continue;
    }
    if (mTask) {
      if (!ws) throw new Error(`${file}: task ${mTask[2]} appears before any workstream`);
      const s = STATUS[mTask[1]];
      if (!s) throw new Error(`${file}: unknown status marker "${mTask[1]}" on ${mTask[2]}`);
      task = { id: mTask[2], t: clean(mTask[3]), s, c: 0, cd: 0 };
      ws.tasks.push(task);
      continue;
    }
    // any other heading ends the current task's criteria block
    if (/^#{1,4}\s/.test(line)) { task = null; continue; }
    if (task && mBox) {
      task.c++;
      if (STATUS[mBox[1]] === 'done') task.cd++;
    }
  }
  return phase;
}

const files = readdirSync(PLANNING).filter((f) => /^PHASE_\d_.*\.md$/.test(f)).sort();
if (!files.length) throw new Error('no PHASE_*.md documents found in .agents/planning');
const phases = files.map(parsePhase);

/* ---- derived repo state ------------------------------------------------- */
const isDone = (p) => {
  const countable = p.ws.flatMap((w) => w.tasks).filter((t) => t.s !== 'cut');
  return countable.length > 0 && countable.every((t) => t.s === 'done');
};
const shipped = phases.filter(isDone);
const active = phases.find((p) => !isDone(p));

const state = {
  generated: new Date().toISOString().slice(0, 10),
  repo: {
    branch: active ? (shipped.length === 0 && active.n === 0 && !active.ws.flatMap((w) => w.tasks).some((t) => t.s !== 'todo')
      ? 'main'
      : `phase/${active.n}-${slug(active.name)}`) : 'main',
    version: shipped.length ? shipped[shipped.length - 1].version : '0.0.0',
    target: phases[phases.length - 1].version
  },
  phases
};

/* ---- splice into the dashboard ------------------------------------------ */
const html = readFileSync(DASHBOARD, 'utf8');
const i = html.indexOf(BEGIN);
const j = html.indexOf(END);
if (i === -1 || j === -1) throw new Error('STATE markers not found in dashboard.html');

const header = `${BEGIN} GENERATED BLOCK — do not hand-edit.
   Regenerate with:  node .agents/scripts/build-dashboard.mjs
   Source of truth:  .agents/planning/PHASE_*.md task checkboxes                     */
const PROJECT_STATE = ${JSON.stringify(state)};
`;
const next = html.slice(0, i) + header + html.slice(j);

const tasks = phases.flatMap((p) => p.ws.flatMap((w) => w.tasks));
const countable = tasks.filter((t) => t.s !== 'cut');
const done = countable.filter((t) => t.s === 'done');
const crit = tasks.reduce((a, t) => a + t.c, 0);
const critDone = tasks.reduce((a, t) => a + t.cd, 0);

if (process.argv.includes('--check')) {
  if (next !== html) {
    console.error('✗ dashboard.html is out of date with the phase plans.');
    console.error('  Run: node .agents/scripts/build-dashboard.mjs');
    process.exit(1);
  }
  console.log('✓ dashboard.html is in sync.');
  process.exit(0);
}

writeFileSync(DASHBOARD, next);

const pct = countable.length ? ((done.length / countable.length) * 100).toFixed(1) : '0.0';
console.log(`✓ dashboard.html regenerated`);
console.log(`  phases   ${shipped.length}/${phases.length} shipped   (active: ${active ? `Phase ${active.n} — ${active.name}` : 'none'})`);
console.log(`  tasks    ${done.length}/${countable.length} done (${pct}%)${tasks.length - countable.length ? `, ${tasks.length - countable.length} cut` : ''}`);
console.log(`  criteria ${critDone}/${crit} met`);
console.log(`  version  ${state.repo.version} → ${state.repo.target}   branch: ${state.repo.branch}`);
