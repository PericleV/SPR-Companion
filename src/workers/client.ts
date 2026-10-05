// Worker clients: a pool that runs requests in parallel (sweeps), and the Simulation's own worker where only the
// latest request matters.
import type { AnalyzeRequest, ValuesRequest, ValuesResult, SweepRequest, WorkerReply, WorkerRequest } from './protocol.ts';
import type { AnalysisGroup } from '../model/sweepAnalysis.ts';
import type { SweepBlock } from '../model/sweep.ts';

const spawn = () => new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });

export class Pool {
  private workers: Worker[];
  private idle: Worker[];
  private queue: { msg: WorkerRequest; resolve: (r: unknown) => void; reject: (e: Error) => void }[] = [];
  private pending = new Map<number, { w: Worker; resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private next = 0;
  private closed = false;

  constructor(size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) {
    this.workers = Array.from({ length: size }, () => {
      const w = spawn();
      w.onmessage = (e: MessageEvent<WorkerReply>) => this.done(e.data);
      w.onerror = (e) => this.fail(w, e.message || 'worker error');
      return w;
    });
    this.idle = this.workers.slice();
  }

  get size() {
    return this.workers.length;
  }

  run<T>(msg: WorkerRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) return reject(new Error('stopped'));
      this.queue.push({ msg, resolve: resolve as (r: unknown) => void, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = this.next++;
      this.pending.set(id, { w, resolve: job.resolve, reject: job.reject });
      w.postMessage({ ...job.msg, id });
    }
  }

  private done(r: WorkerReply) {
    const p = this.pending.get(r.id);
    if (!p) return;
    this.pending.delete(r.id);
    this.idle.push(p.w);
    if (r.ok) p.resolve(r.result);
    else p.reject(new Error(r.error));
    this.pump();
  }

  private fail(w: Worker, message: string) {
    for (const [id, p] of this.pending)
      if (p.w === w) {
        this.pending.delete(id);
        p.reject(new Error(message));
      }
  }

  terminate() {
    this.closed = true;
    this.workers.forEach((w) => w.terminate());
    for (const p of this.pending.values()) p.reject(new Error('stopped'));
    for (const q of this.queue) q.reject(new Error('stopped'));
    this.pending.clear();
    this.queue = [];
  }
}

// The Simulation's worker: a request supersedes the one still running (that worker is replaced, its result dropped).
let simWorker: Pool | null = null;
let simBusy = false;
let latest = 0;
export async function valuesLatest(req: ValuesRequest): Promise<ValuesResult | null> {
  const ticket = ++latest;
  if (simWorker && simBusy) {
    simWorker.terminate();
    simWorker = null;
  }
  simWorker ??= new Pool(1);
  const w = simWorker;
  simBusy = true;
  try {
    const r = await w.run<ValuesResult>(req);
    return ticket === latest ? r : null;
  } catch (e) {
    if (ticket !== latest) return null;
    throw e;
  } finally {
    if (ticket === latest) simBusy = false;
  }
}

// The Simulation's single scan (a sweep request of one outer combination), the latest request only.
let scanWorker: Pool | null = null;
let scanBusy = false;
let scanTicket = 0;
export async function sweepLatest(req: SweepRequest): Promise<SweepBlock[] | null> {
  const ticket = ++scanTicket;
  if (scanWorker && scanBusy) {
    scanWorker.terminate();
    scanWorker = null;
  }
  scanWorker ??= new Pool(1);
  const w = scanWorker;
  scanBusy = true;
  try {
    const r = await w.run<SweepBlock[]>(req);
    return ticket === scanTicket ? r : null;
  } catch (e) {
    if (ticket !== scanTicket) return null;
    throw e;
  } finally {
    if (ticket === scanTicket) scanBusy = false;
  }
}

// The metrics of the Simulation's data, the latest request only (a worker of its own).
let anWorker: Pool | null = null;
let anBusy = false;
let anTicket = 0;
export async function analyzeLatest(req: AnalyzeRequest): Promise<AnalysisGroup[] | null> {
  const ticket = ++anTicket;
  if (anWorker && anBusy) {
    anWorker.terminate();
    anWorker = null;
  }
  anWorker ??= new Pool(1);
  const w = anWorker;
  anBusy = true;
  try {
    const r = await w.run<AnalysisGroup[]>(req);
    return ticket === anTicket ? r : null;
  } catch (e) {
    if (ticket !== anTicket) return null;
    throw e;
  } finally {
    if (ticket === anTicket) anBusy = false;
  }
}

// One-off computations (e.g. the response of an optimization's best), queued in a worker of their own.
let aux: Pool | null = null;
export const valuesOnce = (req: ValuesRequest) => (aux ??= new Pool(1)).run<ValuesResult>(req);

// A pool kept between runs (its workers keep their modules and their library: no start-up at every Run), recreated
// after it was terminated (a Stop drops the work still queued); `warm` starts it before it is needed.
export function persistentPool() {
  let pool: Pool | null = null;
  return {
    get: () => (pool ??= new Pool()),
    warm: () => void (pool ??= new Pool()),
    reset: () => {
      pool?.terminate();
      pool = null;
    },
  };
}

export const runSweepChunks = (pool: Pool, req: Omit<SweepRequest, 'outers'>, outers: number[]) => pool.run<SweepBlock[]>({ ...req, outers });
