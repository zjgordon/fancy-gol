/**
 * P3-E-10 — which emitted chunks are loaded at startup.
 *
 * `client-js-gzip` gates *initial-load* JavaScript: the entry chunk `index.html` names, everything
 * it reaches through **static** imports, and the workers the app starts at boot. That is a graph
 * question, deliberately not a naming one. Excluding chunks by prefix (`theme-*`) would let a lazy
 * chunk that has been accidentally imported by the entry vanish from the count while still
 * shipping on every page load, which is exactly the regression the metric exists to catch.
 *
 * Operates on source text, not on the bundler's API, so it measures what actually shipped and is
 * unit-testable against hand-written chunk text.
 */

/** `import{a as b}from"./x.js"` and `import"./x.js"`, but not `import("./x.js")` or `import.meta`. */
const STATIC_IMPORT = /\bimport\s*(?:[\w$*\s,{}]+?\s*from\s*)?(["'])(\.\/[^"']+\.js)\1/g;

const TAG = /<(script|link)\b([^>]*)>/gi;

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
  return match ? match[1]! : null;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** File names `index.html` loads eagerly: module scripts and modulepreload links. */
export function entryChunksFromHtml(html: string): string[] {
  const entries: string[] = [];
  for (const [, tag, attrs] of html.matchAll(TAG)) {
    const target =
      tag!.toLowerCase() === 'script'
        ? attribute(attrs!, 'type') === 'module'
          ? attribute(attrs!, 'src')
          : null
        : attribute(attrs!, 'rel') === 'modulepreload'
          ? attribute(attrs!, 'href')
          : null;
    if (target && target.endsWith('.js')) entries.push(basename(target));
  }
  return entries;
}

/** The chunk file names `code` imports **statically** (never `import()`). */
export function staticImports(code: string): string[] {
  const out: string[] = [];
  for (const match of code.matchAll(STATIC_IMPORT)) out.push(basename(match[2]!));
  return out;
}

/**
 * Every chunk loaded at startup: the entries, their static-import closure, and any chunk whose file
 * name starts with one of `startupWorkers` (a worker is its own entry, not an import of the page's)
 * together with its closure. `chunks` maps file name → source text.
 */
export function initialLoadChunks(
  entries: readonly string[],
  chunks: ReadonlyMap<string, string>,
  startupWorkers: readonly string[] = [],
): Set<string> {
  const roots = [...entries];
  for (const name of chunks.keys()) {
    if (startupWorkers.some((worker) => name.startsWith(`${worker}-`) || name === `${worker}.js`)) roots.push(name);
  }
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    const code = chunks.get(name);
    if (code === undefined) throw new Error(`bundle-graph: "${name}" is imported or named by the entry but was not emitted`);
    seen.add(name);
    for (const dep of staticImports(code)) queue.push(dep);
  }
  return seen;
}
