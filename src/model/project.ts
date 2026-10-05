// A project: the user's own materials, the structure, the exposed parameters, the metrics and the settings of each
// page. Plain JSON (saved in the browser and to files).
import type { MaterialDef } from '../physics/materials.ts';
import type { FieldSettings, Interrogation } from './analysis.ts';
import type { Structure } from './structure.ts';
import { FIELDS, newPlot, type FieldKey, type PlotSpec, type SweepSettings } from './sweep.ts';
import type { Derived } from './derived.ts';
import type { FitComponent } from '../engine/fitmodels.ts';
import { newMetric, polyOfZone, uniqueRef, type Metric, type SensTarget } from './metrics.ts';
import { sweepValues, withScanParams, type Exposed } from './exposed.ts';
import type { ParamRef } from './params.ts';
import { defaultOpt, type OptRecord, type OptSettings } from './optimization.ts';
import { defaultSprDesign, type SprDesign } from './sprGa.ts';
import type { TolSettings } from './tolerance.ts';
import type { SgSettings } from './sensorgram.ts';

// auto: one scan (or a small map) recomputed as the project changes (false: on Run only; sweeps are always on Run)
export type SimSettings = Interrogation & { field: FieldSettings; auto?: boolean };

// colors: the colour of a material in the drawings and field maps (over the library's); derived: computed quantities
// (formulas of the computed fields); notes: free text (an example's notes, the user's own)
export type Project = {
  version: 2;
  name: string;
  notes: string;
  materials: MaterialDef[];
  colors: Record<string, string>;
  structure: Structure;
  sim: SimSettings;
  params: Exposed[];
  metrics: Metric[];
  derived: Derived[];
  sweep: SweepSettings;
  opt: OptSettings;
  spr: SprDesign; // the layer-sequence GA (Optimization page)
  light?: 'normal' | 'left' | 'right'; // the light's arrow on the drawing of the stack
  // the configurations: each a structure with everything computed on it (its interrogation, parameters, sweep,
  // metrics, plots, computed quantities, optimization); the current one (configId) lives in the fields above, which
  // the pages edit — its entry in `configs` is refreshed from them (configsOf)
  configs: Config[];
  configId: string;
  // the comparisons between configurations (the Compare page): plots of curves of any configuration
  // views: plots of one configuration each (its response, the values of its metrics along a swept parameter, the
  // field inside its stack), side by side
  // sg: the sensorgrams of configurations side by side (which, what is drawn, each its own experiment or the current one's)
  // tables: the results of chosen metrics, configuration by configuration
  compare: { plots: PlotSpec[]; views?: PlotSpec[]; sg?: CompareSg; tables?: MetricTableSpec[] };
  // the optimizations applied to this configuration (written on Apply; shown on the Compare page)
  optLog?: OptRecord[];
  // the tolerances (Monte Carlo) of this configuration: the variations, the samples, the pass / fail criteria
  tol?: TolSettings;
  // the sensorgram of this configuration: the analyte, the surface, the kinetics, where the signal changes, the
  // read-out and the instrument (model/sensorgram.ts; absent: the defaults)
  sg?: Partial<SgSettings>;
};
export type CompareSg = { configs: string[]; show: string; series: 'last' | 'all'; same: boolean };
// cols: 'ref|quantity' of a metric (the same ref in every configuration)
// points: per configuration with a sweep, the points shown (row keys: indices of its axes; absent: all)
export type MetricTableSpec = { id: string; title?: string; configs: string[]; cols: string[]; points?: Record<string, string[]> };

// What belongs to a configuration (the rest — materials, notes, colours, the layer GA — to the project).
export type ConfigFields = Pick<Project, 'structure' | 'sim' | 'params' | 'metrics' | 'derived' | 'sweep' | 'opt' | 'light' | 'optLog' | 'tol' | 'sg'>;
export type Config = { id: string; name: string } & ConfigFields;
export const fieldsOf = (p: ConfigFields): ConfigFields => ({ structure: p.structure, sim: p.sim, params: p.params, metrics: p.metrics, derived: p.derived, sweep: p.sweep, opt: p.opt, light: p.light, optLog: p.optLog, tol: p.tol, sg: p.sg });

// Every configuration, the current one as edited.
export const configsOf = (p: Project): Config[] => p.configs.map((c) => (c.id === p.configId ? { ...c, ...fieldsOf(p) } : c));
export const currentConfig = (p: Project): Config => configsOf(p).find((c) => c.id === p.configId)!;

export function switchConfig(p: Project, id: string): Project {
  const all = configsOf(p);
  const c = all.find((x) => x.id === id);
  return c && id !== p.configId ? { ...p, configs: all, configId: id, ...fieldsOf(c) } : p;
}
let configCounter = 0;
const newConfigId = () => `cf${Date.now().toString(36)}${configCounter++}`;
// A new configuration after the current one (a copy of it, or a new structure), made current.
export function addConfig(p: Project, how: 'copy' | 'new'): Project {
  const all = configsOf(p);
  const cur = all.find((c) => c.id === p.configId)!;
  const fields = how === 'copy' ? (structuredClone(fieldsOf(p)) as ConfigFields) : fieldsOf(defaultProject());
  const name = how === 'copy' ? `${cur.name} (copy)` : `Configuration ${all.length + 1}`;
  const c: Config = { id: newConfigId(), name, ...fields };
  const at = all.findIndex((x) => x.id === p.configId) + 1;
  return switchConfig({ ...p, configs: [...all.slice(0, at), c, ...all.slice(at)] }, c.id);
}
export function removeConfig(p: Project, id: string): Project {
  const all = configsOf(p);
  if (all.length < 2) return p;
  const i = all.findIndex((c) => c.id === id);
  // (the current one removed: the one before it becomes current, else the one after)
  const q = id === p.configId ? switchConfig(p, all[i - 1]?.id ?? all[i + 1].id) : { ...p, configs: all };
  return { ...q, configs: configsOf(q).filter((c) => c.id !== id) };
}
// Another project's configurations (an example) added after the current one, the first of them made current: its own
// materials come along (one whose id is taken by a different material is renamed, in its configurations too), its
// colours where the project has none, and its compare plots (on its configurations).
export function addConfigsFrom(p: Project, given: Project, name?: string): Project {
  // (read like a stored project: defaults, migrations)
  const other = parseProject(stringifyProject(given)) ?? given;
  const all = configsOf(p);
  const theirs = configsOf(other);
  const materials = [...p.materials];
  const renames: [string, string][] = [];
  for (const m of other.materials) {
    const mine = materials.find((x) => x.id === m.id);
    if (!mine) materials.push(m);
    else if (JSON.stringify(mine) !== JSON.stringify(m)) {
      let id = `${m.id}-2`;
      for (let k = 3; materials.some((x) => x.id === id); k++) id = `${m.id}-${k}`;
      materials.push({ ...m, id });
      renames.push([m.id, id]);
    }
  }
  const remap = <T,>(v: T): T => (renames.length ? (JSON.parse(renames.reduce((s, [a, b]) => s.split(`"${a}"`).join(`"${b}"`), JSON.stringify(v))) as T) : v);
  const ids = new Map(theirs.map((c) => [c.id, newConfigId()]));
  const added: Config[] = theirs.map((c) => ({ ...remap(c), id: ids.get(c.id)!, name: theirs.length > 1 ? `${c.name}` : (name ?? c.name) }));
  const plots = (other.compare?.plots ?? []).map((pl) => ({ ...pl, id: `${pl.id}-${ids.get(theirs[0].id)}`, curves: pl.curves?.map((c) => ({ ...c, config: ids.get(c.config) ?? c.config })) }));
  const at = all.findIndex((c) => c.id === p.configId) + 1;
  const views = (other.compare?.views ?? []).map((v) => ({ ...v, id: `-`, config: ids.get(v.config ?? '') ?? v.config }));
  const q: Project = { ...p, materials, colors: { ...other.colors, ...p.colors }, configs: [...all.slice(0, at), ...added, ...all.slice(at)], compare: { ...p.compare, plots: [...(p.compare?.plots ?? []), ...plots], views: [...(p.compare?.views ?? []), ...views] } };
  return switchConfig(q, added[0].id);
}
// A change to a configuration's fields, the current one or another.
export function updateConfig(p: Project, id: string, fn: (c: ConfigFields) => ConfigFields): Project {
  if (id === p.configId) return { ...p, ...fn(fieldsOf(p)) };
  return { ...p, configs: p.configs.map((c) => (c.id === id ? { ...c, ...fn(fieldsOf(c)) } : c)) };
}
export const renameConfig = (p: Project, id: string, name: string): Project => ({ ...p, configs: p.configs.map((c) => (c.id === id ? { ...c, name } : c)) });
export const moveConfig = (p: Project, id: string, by: -1 | 1): Project => {
  const all = configsOf(p);
  const i = all.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= all.length) return p;
  [all[i], all[j]] = [all[j], all[i]];
  return { ...p, configs: all };
};

export const defaultField = (): FieldSettings => ({ on: false, at: 'metric', metric: 'res', value: 0, zIn: 300, zOut: 300, show: 'E2', part: 'abs2', medium: { kind: 'exit' } });

export const defaultSim = (): SimSettings => ({
  mode: 'theta',
  lambda: 633,
  theta: 0,
  from: 60,
  to: 80,
  points: 2001,
  pol: 'p',
  tFrom: 0,
  tTo: 40,
  tPoints: 81,
  field: defaultField(),
});

export const defaultSweep = (): SweepSettings => ({ axes: [], fields: [...FIELDS], plots: [newPlot({ id: 'main', title: 'Response', left: ['R'] })] });

// A resonance (its FWHM, position, depth) and its sensitivity to the exit medium.
// The R at the resonance, the FWHM and S exposed for the objectives.
export const sprMetrics = (dn = 0.001): Metric[] => [
  newMetric('fwhm', { id: 'res', ref: 'res', label: 'Resonance', expose: ['R', 'width'] }),
  newMetric('sens', { id: 'sens', ref: 'sens', label: 'Sensitivity', dn, expose: ['S'] }),
];

export function defaultProject(): Project {
  const sim = defaultSim();
  return {
    version: 2,
    name: 'Kretschmann SPR sensor',
    notes: '',
    materials: [],
    colors: {},
    derived: [],
    structure: {
      incident: { id: 'BK7' },
      blocks: [{ kind: 'film', id: 'ag', label: 'metal', mat: { id: 'Ag' }, d: 50, layers2D: 1 }],
      exit: { id: 'Water' },
    },
    sim,
    params: withScanParams([], sim),
    metrics: sprMetrics(),
    sweep: defaultSweep(),
    opt: defaultOpt(),
    spr: defaultSprDesign(),
    // (its single configuration: refreshed from the fields above when read — examples change those)
    configs: [{ id: 'c1', name: 'Configuration 1' } as Config],
    configId: 'c1',
    compare: { plots: [], views: [] },
  };
}

// JSON keeps no NaN (open ROI bounds): written as null, read back as NaN.
// (every configuration written as it is, the current one from the fields the pages edit)
export const stringifyProject = (p: Project, indent?: number) => JSON.stringify(p.configs?.length ? { ...p, configs: configsOf(p) } : p, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), indent);
const num = (v: unknown) => (typeof v === 'number' ? v : NaN);

// Version 1: regions of interest with one sensitivity setting, sweep axes holding their own values.
type V1 = {
  sim?: { rois?: { id: string; label: string; lo: number | null; hi: number | null; kind: 'dip' | 'peak' }[]; sens?: { on: boolean; dn: number; target: SensTarget }; field?: { on: boolean; roi: number; at: string; value: number; zIn: number; zOut: number } };
  sweep?: { axes?: { ref: ParamRef; mode: 'range' | 'list'; from: number; to: number; steps: number; list: string; mats: string[] }[] };
};

function fromV1(p: V1 & Record<string, unknown>): Partial<Project> {
  const rois = p.sim?.rois ?? [];
  const sens = p.sim?.sens;
  const taken: string[] = [];
  const add = (m: Metric) => (taken.push(m.ref), m);
  const metrics: Metric[] = rois.flatMap((r) => [
    add(newMetric('fwhm', { id: r.id, label: r.label, feature: r.kind, lo: num(r.lo), hi: num(r.hi) }, taken)),
    ...(sens?.on ? [add(newMetric('sens', { id: `${r.id}-S`, label: `${r.label}: S`, feature: r.kind, lo: num(r.lo), hi: num(r.hi), dn: sens.dn, target: sens.target }, taken))] : []),
  ]);
  const f = p.sim?.field;
  const params: Exposed[] = (p.sweep?.axes ?? []).map((a, i) => ({
    id: `p1-${i}`,
    ref: a.ref,
    name: `parameter ${i + 1}`,
    sweep: { mode: a.mode === 'list' ? 'list' : 'count', from: a.from, to: a.to, step: (a.to - a.from) / Math.max(1, a.steps - 1) || 1, count: a.steps, list: a.list, integer: false },
    mats: a.mats ?? [],
    opt: { on: false, min: a.from, max: a.to, integer: false },
  }));
  const { rois: _r, sens: _s, ...sim } = (p.sim ?? {}) as Record<string, unknown>;
  void _r;
  void _s;
  return {
    sim: { ...defaultSim(), ...(sim as Partial<SimSettings>), field: { ...defaultField(), on: !!f?.on, at: f?.at === 'value' ? 'value' : 'metric', metric: rois[f?.roi ?? 0]?.id ?? '', value: f?.value ?? 0, zIn: f?.zIn ?? 300, zOut: f?.zOut ?? 300 } },
    metrics: metrics.length ? metrics : sprMetrics(),
    params,
    sweep: { ...defaultSweep(), axes: params.map((x) => x.id) },
  };
}

// A stored project, or null when it is not one. Version 1 files are converted; missing settings get their defaults;
// metrics get their formula names; a fit of the first version 2 (sim.fit) becomes a Fit metric.
export function parseProject(text: string): Project | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown> & { version?: number };
    if (!raw || !raw.structure || !Array.isArray(raw.materials)) return null;
    const p = (raw.version === 1 ? { ...raw, ...fromV1(raw as V1 & Record<string, unknown>), version: 2 } : raw) as Partial<Project> & { sim?: { fit?: { lo: number; hi: number; comps: FitComponent[] } } };
    if (p.version !== 2) return null;
    const { fit: oldFit, ...simRest } = (p.sim ?? {}) as SimSettings & { fit?: { lo: number; hi: number; comps: FitComponent[] } };
    const sim = { ...defaultSim(), ...simRest } as SimSettings;
    sim.field = { ...defaultField(), ...sim.field };
    const taken: string[] = [];
    const fixMetric = (m: Metric): Metric => {
      const ref = m.ref && !taken.includes(m.ref) ? m.ref : uniqueRef(m.label || m.kind, taken);
      taken.push(ref);
      // zone points of the first versions: a closed region (its top and bottom edited too)
      const pts = m.follow?.pts.map((q) => ({ y: num(q.y), lo: num(q.lo), hi: num(q.hi) })) ?? [];
      const follow = m.follow ? { ...m.follow, pts, poly: m.follow.poly ?? (pts.length >= 2 ? polyOfZone(pts) : undefined) } : undefined;
      return { ...m, ref, lo: num(m.lo), hi: num(m.hi), ...(follow ? { follow } : {}) };
    };
    // a dispersion metric of the first sweeps: a dispersion fit of the two branch positions (metrics of metrics)
    type OldDisp = Omit<Metric, 'kind'> & { kind: string; disp?: { lower: string; upper: string; axis: string; model: 'linear' | 'angle'; lo: number; hi: number } };
    const fromDisp = (m: OldDisp): Metric =>
      m.kind !== 'dispersion'
        ? (m as Metric)
        : {
            ...m,
            kind: 'fit',
            source: `metrics:${sim.mode === 'theta' ? 'theta' : 'lambda'}`,
            along: m.disp?.axis,
            field: `${m.disp?.lower}.pos`,
            field2: `${m.disp?.upper}.pos`,
            lo: num(m.disp?.lo),
            hi: num(m.disp?.hi),
            fit: { comps: [], guess: false, run: true, mode: 'dispersion', model: m.disp?.model ?? 'linear' },
          };
    const metrics = ((p.metrics ?? []) as OldDisp[]).map(fromDisp).map(fixMetric);
    // λ / θ are no longer swept parameters: a sweep of the other one became a dispersion map
    const scanSwept = ((p.sweep as Partial<SweepSettings> | undefined)?.axes ?? []).find((id) => id === (sim.mode === 'theta' ? 'lambda' : 'theta'));
    if (scanSwept && sim.mode !== 'map') {
      const x = (p.params ?? []).find((q) => q.id === scanSwept);
      const vals = x ? (sweepValues(x, undefined) as number[]) : [];
      if (vals.length > 1) {
        const own = { from: sim.from, to: sim.to, points: sim.points };
        if (sim.mode === 'lambda') Object.assign(sim, { mode: 'map', tFrom: vals[0], tTo: vals[vals.length - 1], tPoints: vals.length });
        else {
          // an angular scan swept over λ: the same curves (along θ, one per λ) in a map
          Object.assign(sim, { mode: 'map', from: vals[0], to: vals[vals.length - 1], points: vals.length, tFrom: own.from, tTo: own.to, tPoints: own.points });
          for (let k = 0; k < metrics.length; k++) if (!metrics[k].along && (!metrics[k].source || metrics[k].source === 'response')) metrics[k] = { ...metrics[k], along: 'theta' };
        }
      }
    }
    if (oldFit?.comps?.length) metrics.push(fixMetric(newMetric('fit', { label: 'Fit', lo: num(oldFit.lo), hi: num(oldFit.hi), fit: { comps: oldFit.comps, guess: false } })));
    // the sweep (now part of the Simulation): its analyses join the metrics; plots of an older shape are replaced
    const old = (p.sweep ?? {}) as Partial<SweepSettings> & { analyses?: Metric[]; base?: unknown; inner?: unknown; point?: unknown };
    for (const a of old.analyses ?? []) if (!metrics.some((m) => m.id === a.id)) metrics.push(fixMetric(a));
    const plots = (old.plots ?? []).filter((pl) => Array.isArray((pl as Partial<PlotSpec>).left) && !pl.source?.startsWith('disp:'));
    const sweep: SweepSettings = {
      axes: (old.axes ?? []).filter((id) => id !== 'lambda' && id !== 'theta'),
      fields: old.fields?.length ? [...new Set<FieldKey>(['R', ...(old.fields as FieldKey[]).filter((f) => (FIELDS as readonly string[]).includes(f))])] : [...FIELDS],
      plots: plots.length ? plots.map((pl, i) => ({ ...pl, title: pl.title ?? (i === 0 ? 'Response' : `Plot ${i + 1}`) })) : defaultSweep().plots,
    };
    // the field distribution was a card of its own: now a plot (its data: the field inside the stack)
    if (sim.field.on) {
      if (!sweep.plots.some((pl) => pl.source === 'field')) sweep.plots.push(newPlot({ title: 'Field distribution', source: 'field', left: [], field: { ...sim.field } }));
      sim.field = { ...sim.field, on: false };
    }
    const opt = { ...defaultOpt(), ...p.opt } as OptSettings;
    const spr = { ...defaultSprDesign(), ...p.spr } as SprDesign;
    const out = { ...defaultProject(), ...p, notes: p.notes ?? '', derived: p.derived ?? [], colors: p.colors ?? {}, sim, metrics, params: withScanParams(p.params ?? [], sim), sweep, opt, spr } as Project;
    // the configurations: the current one from the fields above, each other one read like a project of its own
    const raws = (Array.isArray(raw.configs) ? raw.configs : []) as (Partial<Config> & Record<string, unknown>)[];
    const cid = typeof raw.configId === 'string' && raws.some((c) => c.id === raw.configId) ? raw.configId : (raws[0]?.id ?? 'c1');
    const configs: Config[] = raws.length
      ? raws.map((c, i) => {
          const id = typeof c.id === 'string' ? c.id : `c${i + 1}`;
          const name = typeof c.name === 'string' && c.name ? c.name : `Configuration ${i + 1}`;
          if (id === cid) return { id, name, ...fieldsOf(out) };
          const { id: _i, name: _n, ...fields } = c;
          void _i;
          void _n;
          const q = parseProject(JSON.stringify({ ...p, ...fields, version: 2, configs: [], configId: undefined }));
          return { id, name, ...fieldsOf(q ?? defaultProject()) };
        })
      : [{ id: cid, name: 'Configuration 1', ...fieldsOf(out) }];
    // compare plots inside a configuration (the first version of them): moved to the project's Compare page
    const moved: PlotSpec[] = [];
    const strip = (c: Config): Config => {
      const cmp = c.sweep.plots.filter((pl) => pl.source === 'compare');
      if (!cmp.length) return c;
      moved.push(...cmp);
      const rest = c.sweep.plots.filter((pl) => pl.source !== 'compare');
      return { ...c, sweep: { ...c.sweep, plots: rest.length ? rest : defaultSweep().plots } };
    };
    const all = configs.map(strip);
    const cur = all.find((c) => c.id === cid)!;
    const before = (p as Partial<Project>).compare?.plots ?? [];
    const views = ((p as Partial<Project>).compare?.views ?? []).filter((v) => all.some((c) => c.id === v.config));
    return { ...out, ...fieldsOf(cur), configs: all, configId: cid, compare: { ...(p as Partial<Project>).compare, plots: [...before, ...moved], views } };
  } catch {
    return null;
  }
}
