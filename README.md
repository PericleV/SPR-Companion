# SPR Companion
**Advanced Computational Platform for Nanophotonics and SPR Sensor Design**
## Overview
SPR Companion is an open-source, browser-based computational platform developed for the simulation, multidimensional analysis, and inverse design of planar multilayer nanophotonic structures. 
The core simulation engine implements an analytical 4x4 Transfer Matrix Method (TMM), enabling the precise calculation of optical responses (reflectance, transmittance, absorptance) across complex stratified media. This includes support for isotropic and anisotropic materials, 2D materials, and porous effective mediums. Furthermore, the platform integrates heuristic and gradient-based machine learning algorithms to perform autonomous inverse design and multi-objective optimization of optical structures, specifically targeting Surface Plasmon Resonance (SPR) and Tamm plasmon polariton sensors.
## Core Capabilities
### 1. Database & Materials
A flexible module for defining precise optical properties:
*   **Constant Media:** Standard isotropic and anisotropic refractive indices.
*   **Dispersive Media:** Import tabulated dispersive data (CSV/TXT) for wavelength-dependent refractive indices ($n, k$).
*   **Analytic Models:** Built-in evaluation of standard dispersion formulas (Drude, Sellmeier).
*   **Effective Medium Approximations (EMA):** Dynamic calculation of optical responses for porous materials and metamaterials.
*   **Integrated Digitizer:** Extract numerical datasets directly from literature plots.
### 2. Geometry Design
*   Assemble arbitrary layer sequences, from fundamental Kretschmann configurations to complex Distributed Bragg Reflectors (DBRs) and defect layers.
*   Export and import complete workspace configurations (geometry and materials) as structured JSON files for reproducibility.
### 3. Setup & Simulation
*   **Interrogation Modes:** Perform Angular (fixed wavelength) and Spectral (fixed angle) interrogations.
*   **Data Analysis:** Automated curve fitting to identify resonance dips and track phase singularities.
*   **Performance Metrics:** Automatic extraction of critical sensor parameters, including Sensitivity ($S$), Full Width at Half Maximum (FWHM), Figure of Merit (FOM), and Minimum Reflectance ($R_{min}$).
### 4. Parameter Sweep
*   Systematically iterate over geometric thicknesses or material parameters.
*   Generate high-resolution 1D plots, 2D heatmaps, and dispersion curves to identify optimal coupling regimes.
### 5. Inverse Design & Optimization
A dedicated module for structural optimization, enabling targeted inverse design:
*   **Algorithms:** Includes Single-Objective Genetic Algorithm (SOGA), Non-dominated Sorting Genetic Algorithm II (NSGA-II) for Pareto fronts, Particle Swarm Optimization (PSO), and Gradient Descent utilizing the ADAM optimizer.
*   **Implementation:** Define strict structural boundaries, optimize for multiple concurrent objectives (e.g., maximize Sensitivity while minimizing FWHM), or perform curve-fitting to match a target optical response.
## Architecture and Dependencies
SPR Companion utilizes a pure client-side architecture, eliminating the need for backend computations or server dependencies:
*   **Core:** HTML5, CSS3, and ES6 JavaScript.
*   **Computation:** [Math.js](https://mathjs.org/) for complex number arithmetic and matrix operations required by the 4x4 TMM engine.
*   **Visualization:** [Plotly.js](https://plotly.com/javascript/) for 2D and 3D data rendering.
## Authors
*   **Pericle Varasteanu** - Nanobiotechnology Laboratory, National Institute for Research and Development in Microtechnologies (IMT Bucharest).
## License
This project is licensed under the MIT License - see the LICENSE file for details.
