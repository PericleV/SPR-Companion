// The data of configurations (for the Compare page): each computed in a worker — its scan,
// map or sweep, its computed quantities and every metric — when first needed and again when it changes.
import { useEffect, useRef, useState } from 'react';
import { useProject } from '../state.tsx';
import { configsOf, fieldsOf } from '../model/project.ts';
import { Pool } from '../workers/client.ts';
import type { SimulateResult } from '../workers/protocol.ts';

export type OtherData = { status: 'computing' } | { status: 'error'; error: string } | ({ status: 'done' } & SimulateResult);

let pool: Pool | null = null;

export function useOtherConfigs(ids: string[]): Record<string, OtherData> {
  const { project } = useProject();
  const [state, setState] = useState<Record<string, { key: string; d: OtherData }>>({});
  // (a result is kept if its configuration has not changed since — its key — and the page is still there)
  const mounted = useRef(true);
  const asked = useRef<Record<string, string>>({}); // the version of each configuration requested
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const all = configsOf(project);
  const wanted = [...new Set(ids)].filter((id) => all.some((c) => c.id === id));
  // (what changes the data: not the plots, the optimization settings or its record)
  const keyOf = (c: (typeof all)[number]) => JSON.stringify({ s: c.structure, sim: c.sim, p: c.params, m: c.metrics, d: c.derived, a: c.sweep.axes, f: c.sweep.fields, mat: project.materials });
  const keys = Object.fromEntries(wanted.map((id) => [id, keyOf(all.find((c) => c.id === id)!)]));
  const keyAll = JSON.stringify(keys);
  useEffect(() => {
    for (const id of wanted) {
      const key = keys[id];
      if (asked.current[id] === key) continue;
      const c = all.find((x) => x.id === id)!;
      asked.current[id] = key;
      pool ??= new Pool(1);
      pool
        .run<SimulateResult>({ type: 'simulate', materials: project.materials, config: fieldsOf(c) })
        .then((r) => mounted.current && setState((s) => (asked.current[id] === key ? { ...s, [id]: { key, d: { status: 'done', ...r } } } : s)))
        .catch((e: Error) => mounted.current && setState((s) => (asked.current[id] === key ? { ...s, [id]: { key, d: { status: 'error', error: e.message } } } : s)));
    }
  }, [keyAll]); // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(wanted.map((id) => [id, state[id]?.key === keys[id] ? state[id].d : { status: 'computing' }]));
}
