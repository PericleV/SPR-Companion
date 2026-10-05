// Runs of the Tolerances page: the samples (the nominal structure first) split between the workers of a pool, in
// chunks (progress, Stop). One run per configuration; its state outlives the page.
import { useSyncExternalStore } from 'react';
import type { MaterialDef } from '../physics/materials.ts';
import type { Interrogation } from '../model/analysis.ts';
import type { Derived } from '../model/derived.ts';
import type { Metric } from '../model/metrics.ts';
import type { TolSample, TolVariation } from '../model/tolerance.ts';
import { persistentPool } from './client.ts';
import type { TolResult, TolRow } from './protocol.ts';

export type TolRun = {
  status: 'running' | 'done' | 'stopped' | 'error';
  done: number; // samples computed (the nominal included)
  total: number;
  started: number;
  elapsed: number;
  xs: number[];
  rows: (TolRow | undefined)[]; // [nominal, ...samples]
  dev: number[][]; // per sample row, per variation: its mean deviation
  variations: TolVariation[]; // as run
  metrics: Metric[];
  it: Interrogation;
  key: string; // what it was run on (a change: the results are out of date)
  message?: string;
};

const runs = new Map<string, TolRun>();
let snapshot: Record<string, TolRun> = {};
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = Object.fromEntries(runs);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useTolRuns = () => useSyncExternalStore(subscribe, () => snapshot);

const shared = persistentPool();
export const warmTol = () => shared.warm();
// the run of each configuration: a token (a newer run or a Stop makes the results of the older one ignored)
const tokens = new Map<string, number>();
let tokenCount = 0;
const set = (config: string, patch: Partial<TolRun>) => {
  const r = runs.get(config);
  if (r) runs.set(config, { ...r, ...patch, elapsed: Date.now() - r.started });
  emit();
};

export function startTol(config: string, materials: MaterialDef[], samples: TolSample[], it: Interrogation, metrics: Metric[], derived: Derived[], fields: string[], variations: TolVariation[], key: string) {
  tokens.delete(config);
  const pool = shared.get();
  const token = ++tokenCount;
  tokens.set(config, token);
  const live = () => tokens.get(config) === token;
  const rows: (TolRow | undefined)[] = new Array(samples.length);
  runs.set(config, { status: 'running', done: 0, total: samples.length, started: Date.now(), elapsed: 0, xs: [], rows, dev: samples.map((s) => s.dev), variations, metrics, it, key });
  emit();
  // chunks: a few per worker (progress), at most 25 samples each
  const chunk = Math.max(1, Math.min(25, Math.ceil(samples.length / (pool.size * 4))));
  let done = 0;
  const jobs: Promise<void>[] = [];
  for (let from = 0; from < samples.length; from += chunk) {
    const part = samples.slice(from, from + chunk);
    jobs.push(
      pool.run<TolResult>({ type: 'tolerance', materials, structures: part.map((s) => s.structure), it, metrics, derived, fields }).then((r) => {
        if (!live()) return;
        r.rows.forEach((row, j) => (rows[from + j] = row));
        done += part.length;
        const cur = runs.get(config);
        set(config, { done, rows: rows.slice(), ...(cur && !cur.xs.length && r.xs.length ? { xs: r.xs } : {}) });
      }),
    );
  }
  Promise.all(jobs)
    .then(() => {
      if (!live()) return;
      tokens.delete(config);
      set(config, { status: 'done' });
    })
    .catch((e: Error) => {
      if (!live()) return;
      tokens.delete(config);
      if (!tokens.size) shared.reset();
      set(config, { status: 'error', message: e.message });
    });
}

export function stopTol(config: string) {
  if (!tokens.has(config)) return;
  tokens.delete(config);
  if (!tokens.size) shared.reset();
  set(config, { status: 'stopped' });
}

export function clearTol(config: string) {
  stopTol(config);
  runs.delete(config);
  emit();
}
