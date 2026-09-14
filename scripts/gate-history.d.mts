// Hand-written types for gate-history.mjs so the unit spec typechecks.
// The script stays plain JS and runs with bare `node` (P2-F-3).

export interface GateHistoryRecord {
  readonly v: number;
  readonly id: string;
  readonly ok: boolean;
  readonly at: string;
  readonly event: string;
  readonly branch: string;
  readonly sha: string;
  readonly suite: string;
  readonly runId?: number | null;
  readonly runUrl?: string;
  readonly repeat?: number;
  readonly repeats?: number;
  readonly durationMs?: number;
  readonly note?: string;
}

export declare const RECORD_DIR: string;
export declare const DEFAULT_RECORDS: string;
export declare const DEFAULT_INDEX: string;
export declare const RECORD_IDS: { readonly e2e: string; readonly visual: string };
export declare const OFFICIAL_EVENTS: Set<string>;
export declare const SCHEMA_VERSION: number;

export declare function parseRecords(text: string): {
  records: GateHistoryRecord[];
  errors: string[];
};
export declare function validateRecord(rec: unknown): string[];
export declare function loadRecords(path?: string): {
  records: GateHistoryRecord[];
  errors: string[];
};
export declare function streak(
  records: readonly GateHistoryRecord[],
  id: string,
  predicate?: (rec: GateHistoryRecord) => boolean,
): number;
export declare function officialStreak(records: readonly GateHistoryRecord[], id: string): number;
export declare function isOfficial(rec: GateHistoryRecord): boolean;
export declare function cite(id: string, n: number): string;
export declare function evaluateCite(
  records: readonly GateHistoryRecord[],
  id: string,
  n: number,
  opts?: { official?: boolean },
): { ok: boolean; actual: number; need: number; cite: string; official: boolean };
export declare function makeRecord(
  fields: Partial<GateHistoryRecord> &
    Pick<GateHistoryRecord, 'id' | 'ok' | 'event' | 'branch' | 'sha' | 'suite'>,
): GateHistoryRecord;
export declare function serializeRecords(records: readonly GateHistoryRecord[]): string;
export declare function appendRecord(
  records: readonly GateHistoryRecord[],
  rec: GateHistoryRecord,
): GateHistoryRecord[];
export declare function formatIndex(
  records: readonly GateHistoryRecord[],
  opts?: { generated?: string },
): string;
export declare function writeRecords(path: string, records: readonly GateHistoryRecord[]): void;
export declare function writeIndex(
  path: string,
  records: readonly GateHistoryRecord[],
  opts?: { generated?: string },
): void;
export declare function runSuite(
  suite: string,
  opts?: {
    spawn?: (
      command: string,
      args: readonly string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: string },
    ) => { status: number | null };
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): { ok: boolean; durationMs: number; status: number | null };
export declare function sampleSuites(opts: {
  suites: readonly string[];
  repeats: number;
  meta: Pick<GateHistoryRecord, 'event' | 'branch' | 'sha'> &
    Partial<Pick<GateHistoryRecord, 'runId' | 'runUrl' | 'note'>>;
  run?: (suite: string) => { ok: boolean; durationMs: number; status?: number | null };
}): { results: GateHistoryRecord[]; failed: boolean };
