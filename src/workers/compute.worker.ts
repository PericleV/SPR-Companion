// Computations off the UI thread: chunks of the Simulation's computation, the values of the metrics of a structure,
// batches of optimization candidates.
import { makeLibrary, modelsOf, type Library } from '../physics/library.ts';
import type { MaterialDef, Models } from '../physics/materials.ts';
import { expand } from '../model/structure.ts';
import { contextsOf, metricValues, simulate, simulateCore, toleranceRows } from '../model/run.ts';
import type { Project } from '../model/project.ts';
import { analyzeSweep } from '../model/sweepAnalysis.ts';
import { scanAxisOf } from '../model/analysis.ts';
import { runSweepChunk } from '../model/sweep.ts';
import { evaluateCandidates } from '../model/optimization.ts';
import { sgCalibrate, sgCompute } from '../model/sensorgram.ts';
import type { WorkerReply, WorkerRequest } from './protocol.ts';

let cached: { key: string; lib: Library; models: Models } | null = null;
function libraryOf(materials: MaterialDef[]) {
  const key = JSON.stringify(materials);
  if (cached?.key !== key) {
    const lib = makeLibrary(materials);
    cached = { key, lib, models: modelsOf(lib) };
  }
  return cached;
}

self.onmessage = (e: MessageEvent<WorkerRequest & { id: number }>) => {
  const { id } = e.data;
  try {
    const { lib, models } = libraryOf(e.data.materials);
    let reply: WorkerReply;
    if (e.data.type === 'values') {
      const r = e.data;
      const ex = expand(r.structure, lib, models);
      if (ex.errors.length) reply = { id, ok: true, result: { errors: ex.errors, values: [], xs: [], R: [] } };
      else {
        const s = simulateCore(r.structure, r.it, r.metrics, r.derived ?? [], lib, models);
        const n = s.data.axes[s.data.axes.length - 1].values.length;
        const results = metricValues(s.groups, r.metrics);
        reply = {
          id,
          ok: true,
          result: {
            errors: [],
            values: results.map((x) => x?.values ?? null),
            results: results.map((x) => x ?? null),
            xs: s.data.axes[s.data.axes.length - 1].values.slice(),
            R: Array.from(s.data.fields.R.subarray(0, n)),
            shifts: s.data.shifts.map((x) => ({ key: x.key, R: Array.from(x.R.subarray(0, n)) })),
          },
        };
      }
    } else if (e.data.type === 'analyze') {
      const r = e.data;
      reply = { id, ok: true, result: analyzeSweep(r.data, r.metrics, scanAxisOf(r.it), contextsOf(r.structure, r.it, r.job, lib, models)) };
    } else if (e.data.type === 'simulate') {
      const c = e.data.config;
      const ex = expand(c.structure, lib, models);
      if (ex.errors.length) throw new Error(ex.errors[0]);
      const s = simulate({ ...c, materials: e.data.materials } as Project, lib, models);
      reply = { id, ok: true, result: { data: s.data, groups: s.groups, errors: s.errors ? [s.errors] : [] } };
    } else if (e.data.type === 'tolerance') {
      const r = e.data;
      reply = { id, ok: true, result: toleranceRows(r.structures, r.it, r.metrics, r.derived, r.fields, lib, models) };
    } else if (e.data.type === 'sensorgram' || e.data.type === 'sgcal') {
      const r = e.data;
      const ex = expand(r.structure, lib, models);
      if (ex.errors.length) throw new Error(ex.errors[0]);
      reply = { id, ok: true, result: r.type === 'sensorgram' ? sgCompute(ex, models, r.plan, r.pairs) : sgCalibrate(ex, models, r.plan) };
    } else if (e.data.type === 'sweep') {
      reply = { id, ok: true, result: runSweepChunk(e.data.job, lib, models, e.data.outers) };
    } else {
      reply = { id, ok: true, result: evaluateCandidates(e.data.job, lib, models, e.data.xs) };
    }
    self.postMessage(reply);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies WorkerReply);
  }
};
