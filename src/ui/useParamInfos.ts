import { useMemo } from 'react';
import { useProject } from '../state.tsx';
import { listParams, type ParamInfo } from '../model/params.ts';

// Every parameter of the project (λ and θ both), by key.
export function useParamInfos(): Map<string, ParamInfo> {
  const { project, lib } = useProject();
  const s = project.sim;
  return useMemo(() => {
    const it = { mode: s.mode, lambda: s.lambda, theta: s.theta, from: s.from, to: s.to, points: s.points, pol: s.pol };
    return new Map(listParams(project.structure, it, lib, true).map((p) => [p.key, p]));
  }, [project.structure, lib, s.mode, s.lambda, s.theta, s.from, s.to, s.points, s.pol]);
}
