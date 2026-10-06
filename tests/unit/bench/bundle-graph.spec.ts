/**
 * P3-E-10 — the graph behind `client-js-gzip`. A bundle-size gate that mis-reads the bundle blesses
 * a bad build, so the reader is tested against hand-written chunk text.
 */
import { describe, expect, it } from 'vitest';
import { entryChunksFromHtml, initialLoadChunks, staticImports } from '../../bench/bundle-graph';

describe('entryChunksFromHtml', () => {
  it('finds module scripts and modulepreload links, whatever the attribute order', () => {
    const html = `<head>
      <link rel="icon" href="data:," />
      <script type="module" crossorigin src="/assets/index-AAA.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js">
      <link href="/assets/late-CCC.js" rel="modulepreload">
      <link rel="stylesheet" href="/assets/index-DDD.css">
      <script src="/assets/classic-EEE.js"></script>
    </head>`;
    expect(entryChunksFromHtml(html)).toEqual(['index-AAA.js', 'vendor-BBB.js', 'late-CCC.js']);
  });

  it('returns nothing for a page with no module entry', () => {
    expect(entryChunksFromHtml('<html><body></body></html>')).toEqual([]);
  });
});

describe('staticImports', () => {
  it('reads named, namespace and side-effect imports', () => {
    const code = `import{t as e}from"./a-1.js";import * as n from "./b-2.js";import"./c-3.js";import d,{f}from'./d-4.js';`;
    expect(staticImports(code)).toEqual(['a-1.js', 'b-2.js', 'c-3.js', 'd-4.js']);
  });

  it('ignores dynamic imports, import.meta, and non-chunk specifiers', () => {
    const code = [
      'const x=()=>import(`./lazy-9.js`);',
      'const y=import("./lazy-8.js");',
      'const u=new URL("./w.js",import.meta.url);',
      'import{z}from"react";',
      'const s="import {a} from \'./not-an-import.css\'";',
    ].join('');
    expect(staticImports(code)).toEqual([]);
  });
});

describe('initialLoadChunks', () => {
  const chunks = new Map<string, string>([
    ['index-A.js', 'import{r}from"./runtime-R.js";import{s}from"./shared-S.js";const l=()=>import(`./panel-P.js`);'],
    ['runtime-R.js', 'export const r=1;'],
    ['shared-S.js', 'import"./deep-D.js";export const s=1;'],
    ['deep-D.js', ''],
    ['panel-P.js', 'import{s}from"./shared-S.js";export const p=1;'],
    ['sim.worker-W.js', 'import{r}from"./runtime-R.js";'],
    ['bench.worker-X.js', ''],
    ['theme-chiba-city-T.js', 'import{s}from"./shared-S.js";'],
  ]);

  it('follows static imports transitively and leaves lazy chunks out', () => {
    const initial = initialLoadChunks(['index-A.js'], chunks);
    expect([...initial].sort()).toEqual(['deep-D.js', 'index-A.js', 'runtime-R.js', 'shared-S.js']);
  });

  it('adds a startup worker and its closure, but not other workers', () => {
    const initial = initialLoadChunks(['index-A.js'], chunks, ['sim.worker']);
    expect(initial.has('sim.worker-W.js')).toBe(true);
    expect(initial.has('bench.worker-X.js')).toBe(false);
  });

  it('COUNTS a chunk that is lazy by name but statically imported by the entry', () => {
    // The regression this metric exists to catch: someone adds a static import of a panel from the
    // entry, and the "lazy" chunk quietly ships on every page load. A name-based exclusion would hide it.
    const regressed = new Map(chunks);
    regressed.set('index-A.js', `${chunks.get('index-A.js')!}import{p}from"./panel-P.js";`);
    expect(initialLoadChunks(['index-A.js'], regressed).has('panel-P.js')).toBe(true);
  });

  it('fails loudly when the entry names a chunk that was not emitted', () => {
    expect(() => initialLoadChunks(['missing-M.js'], chunks)).toThrow(/was not emitted/);
  });

  it('terminates on an import cycle', () => {
    const cyclic = new Map([
      ['a.js', 'import"./b.js";'],
      ['b.js', 'import"./a.js";'],
    ]);
    expect([...initialLoadChunks(['a.js'], cyclic)].sort()).toEqual(['a.js', 'b.js']);
  });
});
