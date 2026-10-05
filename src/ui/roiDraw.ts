// A ROI being drawn for a metric on a plot (Simulation page): an interval (lo, hi) on curves, or the corners of a
// region on a map ([along, other] — `other` the map's other axis); applied by Confirm in the metric.
export type RoiDraw = { metric: string; plot: string; pts: [number, number][]; other?: string; lo?: number; hi?: number };
