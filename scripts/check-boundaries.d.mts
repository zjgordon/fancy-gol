// Hand-written type declarations for check-boundaries.mjs so tests/unit/boundaries.spec.ts
// can typecheck it. The script itself stays plain JS — it must run with a bare `node`, no
// build step (P0-A-5).
export declare const SRC: string;
export declare const MATRIX: Record<string, string[]>;
export declare const FORBIDDEN_ENGINE_GLOBALS: string[];

export declare function extractImports(source: string): string[];
export declare function resolveSpecifier(spec: string, fromFileDir: string): string | null;
export declare function isImportAllowed(fromLayer: string, targetRelPath: string): boolean;
export declare function scanForbiddenGlobals(
  source: string,
): Array<{ global: string; line: number }>;
