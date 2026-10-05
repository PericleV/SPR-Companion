# SPR Companion 2

Simulation, parameter sweeps and optimization of surface plasmon resonance (SPR) sensors and distributed Bragg
reflectors (DBR), in the browser. A classic web app (pages and tables) built on the physics and the algorithms of
[SPR Forge](https://periclev.github.io/spr-forge/).

**Use it online:** [periclev.github.io/SPR-Companion](https://periclev.github.io/SPR-Companion/) — nothing to install; your projects stay in
your browser.

## Running it

Requirements: Node.js 22.18 or newer (24 LTS recommended: the checks run TypeScript directly).

```bash
npm install
npm run dev      # development server on http://localhost:5173
npm run build    # static site in dist/
npm run check    # physics and algorithm checks
npx tsc -b && npx oxlint
```

## Structure

- `src/physics/` — from SPR Forge, unchanged: TMM (Byrnes formulation, real arithmetic), fields inside the stack,
  material models (constant, tabulated, dispersion formulas, Drude-Lorentz, effective media, doped semiconductors),
  the built-in library (refractiveindex.info data; the anisotropic entries are left out).
- `src/engine/` — from SPR Forge: optimizers (`optimize.ts`: Adam, DE, Nelder-Mead, GA, PSO, NSGA-II, LM, SA),
  resonance metrics (with the dip located by a parabola, a centroid or a polynomial), objectives, fit models, the SPR
  design GA over layer sequences (`sprDesign.ts`), binding kinetics (`kinetics.ts`: 1:1, mass transport, bivalent,
  heterogeneous ligand, two-state, polymer swelling; random sequential adsorption and the double layer), the measuring
  instrument (`instrument.ts`: beam spread, source bandwidth, detector noise).
- `src/model/` — new: the structure (films and DBR blocks with periods, λ₀/4 layers, cavities at any position, mirrored
  periods, closing layer, reversed illumination) and its optical response; the sensorgram (`sensorgram.ts`: the binding
  layer and the bulk index at every time, the read-out, calibration, detection limit, steady state, the planner of a
  concentration series); rough interfaces (`rough.ts`: a random profile, an effective or a graded interface layer,
  cut into slices of an effective medium; after SPR Forge's engine/rough.ts).
- `src/plot/` — SPR Forge's SVG / canvas plots (lines, maps) and figure export (SVG, PNG, CSV).
- `src/pages/` — the pages of the app.
- `scripts/check.ts` — the checks: TMM vs analytic formulas and a reference implementation, field energy balance, DBR
  mirror and microcavity vs analytic values, SPR sensitivity vs the plasmon condition, optimizers on benchmarks,
  the published SPR sensor of Sebek et al. (ACS Omega 8, 20792 (2023)); the sensorgram: kinetics vs analytic solutions,
  the signal vs direct transfer matrices, Jung et al. (Langmuir 14, 5636 (1998)), the Biacore calibration, the maximum
  coverage of myoglobin on silica of Wasilewska et al. (IJERPH 18, 4944 (2021)); the roughness: profile statistics, thickness
  kept, interface layers vs explicit stacks, SPR Forge's numbers, DBR realizations, mean / median over realizations.

## License

[MIT](LICENSE).
