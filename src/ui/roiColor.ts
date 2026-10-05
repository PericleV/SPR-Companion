// Colours of the regions of interest (marks, table rows, metric curves): the metric's own colour, else a default one
// by its place in the list.
const ROI_COLORS = ['#d9534f', '#7b5bd6', '#e0a000', '#4e79a7', '#b07aa1', '#9c755f'];
export const roiColor = (i: number) => ROI_COLORS[i % ROI_COLORS.length];
export const metricColor = (m: { color?: string } | undefined, i: number) => m?.color || roiColor(i);
