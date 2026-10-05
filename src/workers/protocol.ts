// Messages between the pages and the compute workers.
import type { Derived } from '../model/derived.ts';
import type { MaterialDef } from '../physics/materials.ts';
import type { Interrogation } from '../model/analysis.ts';
import type { Metric, MetricResult } from '../model/metrics.ts';
import type { Structure } from '../model/structure.ts';
import type { SweepBlock, SweepJob } from '../model/sweep.ts';
import type { AnalysisGroup, SweepData } from '../model/sweepAnalysis.ts';
import type { EvalJob, Evaluation } from '../model/optimization.ts';
import type { ConfigFields } from '../model/project.ts';
import type { SgCal, SgChunk, SgPlan } from '../model/sensorgram.ts';

// the values of the metrics for one structure (the Simulation's computation, a scan or a map) and its first R curve
export type ValuesRequest = { type: 'values'; materials: MaterialDef[]; structure: Structure; it: Interrogation; metrics: Metric[]; derived?: Derived[] };
// results: each metric's result on the first curve (its marks: the overlays); shifts: R with n + Δn on that curve
export type ValuesResult = { errors: string[]; values: (Record<string, number> | null)[]; xs: number[]; R: number[]; results?: (MetricResult | null)[]; shifts?: { key: string; R: number[] }[] };
// the metrics on computed data (every curve, then the metrics of metrics), off the UI thread
export type AnalyzeRequest = { type: 'analyze'; materials: MaterialDef[]; structure: Structure; it: Interrogation; job: SweepJob; data: SweepData; metrics: Metric[] };
// outers: outer (structural) combinations of the sweep
export type SweepRequest = { type: 'sweep'; materials: MaterialDef[]; job: SweepJob; outers: number[] };

// a batch of optimization candidates (points of the box)
export type EvaluateRequest = { type: 'evaluate'; materials: MaterialDef[]; job: EvalJob; xs: number[][] };

// a whole configuration (a scan, a map or its sweep, the computed quantities, every metric): for compare plots
export type SimulateRequest = { type: 'simulate'; materials: MaterialDef[]; config: ConfigFields };
export type SimulateResult = { data: SweepData; groups: AnalysisGroup[]; errors: string[] };
// samples of the tolerances (Monte Carlo): each structure's response (the fields asked) and its metrics' values
export type TolRequest = { type: 'tolerance'; materials: MaterialDef[]; structures: Structure[]; it: Interrogation; metrics: Metric[]; derived: Derived[]; fields: string[] };
export type TolRow = { fields: Record<string, Float64Array>; values: (Record<string, number> | null)[]; error?: string };
export type TolResult = { xs: number[]; rows: TolRow[] };
// a sensorgram: the reflectance of some (series, time) pairs of its plan, or its calibration
export type SgRequest = { type: 'sensorgram'; materials: MaterialDef[]; structure: Structure; plan: SgPlan; pairs: number[] };
export type SgCalRequest = { type: 'sgcal'; materials: MaterialDef[]; structure: Structure; plan: SgPlan };
export type WorkerRequest = ValuesRequest | AnalyzeRequest | SweepRequest | EvaluateRequest | SimulateRequest | TolRequest | SgRequest | SgCalRequest;
export type WorkerReply = { id: number; ok: true; result: ValuesResult | AnalysisGroup[] | SweepBlock[] | Evaluation[] | SimulateResult | TolResult | SgChunk | SgCal | null } | { id: number; ok: false; error: string };
