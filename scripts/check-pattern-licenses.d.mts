export declare const SPDX_ALLOWLIST: Set<string>;
export declare function collectRleFiles(dir: string, out?: string[]): string[];
export declare function checkPatternText(text: string, label: string): string[];
export declare function checkPatternDir(dir: string): { files: string[]; errors: string[] };
