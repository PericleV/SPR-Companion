// The pages of the app, in the order of the menu (Materials: with the Notes, below the pages in the sidebar).
export type PageId = 'home' | 'materials' | 'structure' | 'simulation' | 'sensorgram' | 'optimization' | 'tolerances' | 'compare';

export const PAGES: { id: PageId; title: string; blurb: string; topbar?: boolean }[] = [
  { id: 'home', title: 'Home', blurb: '' },
  { id: 'structure', title: 'Structure', blurb: 'The stack as a table: films and DBR blocks (period, number of periods, λ₀/4 layers, cavities at any position), the roughness of any interface, reverse illumination; "Add parameter" picks what is swept or optimized (a thickness, a material, n or k, the periods…).' },
  { id: 'simulation', title: 'Simulation', blurb: 'Angular or spectral interrogation, optionally for every combination of swept parameters: R, T, A, phases, complex amplitudes and formulas of them; metrics with their ROI, fits, dispersions; curves on two Y axes and maps; fields inside the stack; the realizations of a rough interface (all, mean, median).' },
  { id: 'sensorgram', title: 'Sensorgram', blurb: 'A binding experiment on the structure: the analyte and the surface (ligand sites or random adsorption, the double layer), binding kinetics along a protocol of injections, a series of concentrations (and a planner for it); the binding layer and the bulk index recomputed at every time, read through the instrument; calibration, detection limit, steady state.' },
  { id: 'optimization', title: 'Optimization', blurb: 'Adam, DE, Nelder-Mead, GA, PSO, simulated annealing, Levenberg-Marquardt, NSGA-II over continuous, integer and material variables; rough structures averaged over realizations; SPR design by layer sequences.' },
  { id: 'tolerances', title: 'Tolerances', blurb: 'Fabrication tolerances by Monte Carlo: thickness, n and k variations of chosen layers and media (uniform or Gaussian, independent or systematic, limited); the spread of the response and of every metric, pass / fail criteria and the yield.' },
  { id: 'compare', title: 'Compare', blurb: 'Every configuration side by side: its stack, layers, interrogation, parameters and the optimizations applied; plots of curves of any configuration; views of one configuration each; tables of their metrics; their sensorgrams.' },
  { id: 'materials', title: 'Materials', blurb: 'The library (refractiveindex.info data, 2D materials) and your own materials: constant, tabulated CSV, dispersion formulas, Drude-Lorentz, porous effective media.', topbar: true },
];

export const pageOf = (hash: string): PageId => {
  const id = hash.replace(/^#\/?/, '');
  if (id === 'sweep') return 'simulation'; // (the sweep is part of the Simulation)
  return PAGES.some((p) => p.id === id) ? (id as PageId) : 'home';
};
