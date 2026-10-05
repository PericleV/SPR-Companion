// What the run's results show (Optimization page): the solutions checked (each with its colour), the criteria and
// filters that rank them, the views of the front, the columns of the results table. Kept while the run's result is
// there (across the pages); a new run, or Clear, starts afresh.
import { useSyncExternalStore } from 'react';
import type { RankCriterion, RankFilter, RankMethod } from '../model/optimization.ts';

export const SOLUTION_COLORS = ['#2563eb', '#e07b39', '#7b5bd6', '#d9534f', '#2e9d5b', '#e0a000', '#9c755f', '#b07aa1'];
export const MAX_CHECKED = 8;

export type RunViewState = {
  run: number; // the run's start (its identity)
  checked: { i: number; color: string }[]; // solutions (front indices) shown, in the order checked
  criteria: RankCriterion[];
  filters: RankFilter[];
  method: RankMethod;
  views: { x: number; y: number }[]; // the front's views: quantities (indices in the run's objectives)
  columns: string[] | null; // the results table: 'metricId|key' (null: the run's goals)
};

let state: RunViewState | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const fresh = (run: number, views: { x: number; y: number }[]): RunViewState => ({ run, checked: [], criteria: [], filters: [], method: 'ideal', views, columns: null });

export function useRunView(run: number, firstView: { x: number; y: number }): [RunViewState, (patch: Partial<RunViewState> | ((s: RunViewState) => Partial<RunViewState>)) => void] {
  const s = useSyncExternalStore(subscribe, () => state);
  const cur = s && s.run === run ? s : fresh(run, [firstView]);
  const set = (patch: Partial<RunViewState> | ((s: RunViewState) => Partial<RunViewState>)) => {
    const base = state && state.run === run ? state : fresh(run, [firstView]);
    state = { ...base, ...(typeof patch === 'function' ? patch(base) : patch) };
    listeners.forEach((l) => l());
  };
  return [cur, set];
}
export const clearRunView = () => {
  state = null;
  listeners.forEach((l) => l());
};
// the next colour not used by the checked solutions
export const nextColor = (checked: { color: string }[]) => SOLUTION_COLORS.find((c) => !checked.some((x) => x.color === c)) ?? SOLUTION_COLORS[checked.length % SOLUTION_COLORS.length];