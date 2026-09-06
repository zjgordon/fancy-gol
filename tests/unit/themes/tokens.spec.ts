import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `process.cwd()`-relative, not `import.meta.url`-relative: under the jsdom test project (this
// file's own home), `import.meta.url` isn't a `file://` URL, so `fileURLToPath` throws.
const CSS = readFileSync(join(process.cwd(), 'src/themes/tokens.css'), 'utf8');

/** Every `--gol-<name>: <value>;` declaration line, paired with its trailing `/* ... *\/` comment
 * (or `null` if it has none). Declarations in this file are single-line by design so this simple
 * line-based scan is exact, not a heuristic. */
function declarations(css: string): Array<{ name: string; line: string; comment: string | null }> {
  const out: Array<{ name: string; line: string; comment: string | null }> = [];
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    const decl = /^(--gol-[a-z0-9-]+):\s*[^;]+;/.exec(line);
    if (!decl) continue;
    const comment = /\/\*(.*)\*\/\s*$/.exec(line);
    out.push({ name: decl[1] as string, line, comment: comment ? (comment[1] as string).trim() : null });
  }
  return out;
}

describe('themes/tokens.css — the token contract (P1-E-1)', () => {
  const decls = declarations(CSS);

  it('declares at least one token per required category', () => {
    expect(decls.length).toBeGreaterThan(40);
  });

  it('documents every variable with a comment stating its purpose and its Default value', () => {
    for (const { name, comment } of decls) {
      expect(comment, `${name} has no trailing comment`).not.toBeNull();
      expect(comment as string, `${name}'s comment doesn't state a Default value`).toMatch(/Default:/);
      // "purpose" — a comment that's *only* "Default: ..." with nothing else isn't documentation.
      expect((comment as string).length, `${name}'s comment is too short to state a purpose`).toBeGreaterThan(
        'Default: '.length + 3,
      );
    }
  });

  it('names every token by role, never by theme — no theme-specific words', () => {
    const themeWords = ['neon', 'chiba', 'flatline', 'synthwave', 'void-walker', 'sids-place', 'pink', 'cyan'];
    for (const { name } of decls) {
      for (const word of themeWords) {
        expect(name.toLowerCase(), `${name} contains theme-specific word "${word}"`).not.toContain(word);
      }
    }
  });

  it('covers every required colour role', () => {
    const roles = [
      'bg',
      'surface',
      'elevated',
      'border',
      'border-strong',
      'text',
      'muted',
      'accent',
      'accent-strong',
      'accent-pressed',
      'on-accent',
      'scrim',
      'danger',
      'danger-strong',
      'success',
      'success-strong',
    ];
    for (const role of roles) {
      expect(decls.map((d) => d.name)).toContain(`--gol-color-${role}`);
    }
  });

  it('declares 6 font sizes, 3 weights and 2 letter-spacings', () => {
    const names = decls.map((d) => d.name);
    expect(names.filter((n) => n.startsWith('--gol-font-size-'))).toHaveLength(6);
    expect(names.filter((n) => n.startsWith('--gol-font-weight-'))).toHaveLength(3);
    expect(names.filter((n) => n.startsWith('--gol-letter-spacing-'))).toHaveLength(2);
  });

  it('declares a 7-step space scale', () => {
    for (let i = 1; i <= 7; i++) {
      expect(decls.map((d) => d.name)).toContain(`--gol-space-${i}`);
    }
  });

  it('declares a 3-step radius scale and a 3-step shadow scale', () => {
    const names = decls.map((d) => d.name);
    for (const key of ['sm', 'md', 'lg']) {
      expect(names).toContain(`--gol-radius-${key}`);
      expect(names).toContain(`--gol-shadow-${key}`);
    }
  });

  it('declares 4 motion durations and 5 easings', () => {
    const names = decls.map((d) => d.name);
    expect(names.filter((n) => n.startsWith('--gol-duration-'))).toHaveLength(4);
    expect(names.filter((n) => n.startsWith('--gol-ease-'))).toHaveLength(5);
  });
});
