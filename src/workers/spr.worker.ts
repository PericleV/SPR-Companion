// Worker of the layer-sequence genetic algorithm (spr-forge's sprDesign.worker.ts): runs it off the UI thread; progress
// at most ~7 times per second; 'stop' ends it after the current generation.
import { runSprGa, type SprProblem, type SprProgress, type SprSettings } from '../engine/sprDesign.ts';

export type SprMsg = { type: 'start'; problem: SprProblem; settings: SprSettings } | { type: 'stop' };
export type SprOut = { type: 'progress'; progress: SprProgress } | { type: 'done'; progress?: SprProgress; error?: string };

let stop = false;

self.onmessage = async (e: MessageEvent<SprMsg>) => {
  const m = e.data;
  if (m.type === 'stop') {
    stop = true;
    return;
  }
  stop = false;
  let last = 0;
  try {
    const result = await runSprGa(
      m.problem,
      m.settings,
      (p) => {
        const now = Date.now();
        if (now - last < 150) return;
        last = now;
        self.postMessage({ type: 'progress', progress: p } satisfies SprOut);
      },
      // yielding lets the 'stop' message in
      { stopped: () => stop, tick: () => new Promise((r) => setTimeout(r, 0)) },
    );
    self.postMessage({ type: 'done', progress: result } satisfies SprOut);
  } catch (err) {
    self.postMessage({ type: 'done', error: err instanceof Error ? err.message : String(err) } satisfies SprOut);
  }
};
