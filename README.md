SPR Companion

Advanced Computational Platform for Nanophotonics and SPR Sensor Design

Overview

SPR Companion is an open-source, browser-based computational platform developed for the rigorous simulation, multi-dimensional analysis, and inverse design of planar multilayer nanophotonic structures.

The core simulation engine implements an analytical Transfer Matrix Method (TMM), enabling the precise calculation of optical responses (Reflectance, Transmittance, Absorptance, Phase) across complex stratified media. It provides comprehensive support for standard bulk materials, 2D materials, and porous effective mediums. Furthermore, the platform integrates heuristic and gradient-based algorithms to perform autonomous structural optimization, explicitly targeting Surface Plasmon Resonance (SPR) and localized resonance sensors.

Access the application directly in your browser: https://periclev.github.io/SPR-Companion/

Core Capabilities

1. Database & Materials

A highly flexible module for defining and managing precise optical properties ($n, k, \varepsilon$):

Material Types: Support for Bulk isotropic media, 2D Materials (defined by layer thickness), and Porous Media (requires pre-existing Host/Inclusion materials, configurable Fill Factor, and choice of Maxwell Garnett or Bruggeman Effective Medium Approximations).

Optical Definitions: Choose from Constant indices, Dispersive data, or Analytical models (e.g., Drude, Drude-Lorentz-Kubo for Graphene).

Data Ingestion: Import tabulated dispersive data from CSV (compatible with refractiveindex.info), or utilize the Integrated Plot Digitizer to extract numerical parameters directly from literature images.

Processing: Features automatic data interpolation (Spline or Linear) with user-defined point counts, alongside Constant or Linear extrapolation options. View and superimpose properties across custom wavelength ranges.

2. Geometry Design

Stack Configuration: Assemble arbitrary layer sequences. The system includes a one-click "Reverse Illumination" toggle and automatic material type detection (e.g., seamlessly prompting for layer counts when utilizing 2D materials).

Auto DBR Builder: Instantly generate Distributed Bragg Reflectors by defining the constituent materials per period, thicknesses, total periods, and defect layer specifications (material and insertion point).

Workspace Management: Export structural geometries as PNG/SVG figures, and save or load complete system configurations for strict reproducibility.

3. Setup & Simulation

Interrogation Modes: Perform Angular or Spectral interrogations with full control over fixed parameters, intervals, resolution, and polarization.

Optical Outputs: Calculate $R, T, A$, and phase shifts ($\phi_R, \phi_T$).

Performance Metrics: Automatically extract FWHM, Minimum Reflectance, Bandgap, and Central Bandgap. Calculate Sensitivity ($S$) for a custom index variation ($\Delta n$). The active modulating layer can be designated anywhere within the stack, not just at the final sensing medium.

Advanced Analysis: Define custom Regions of Interest (ROI) to isolate metrics for multiple distinct peaks/dips. Fit generated resonance data using Lorentz, Fano, Coupled Oscillators, or complex combinations.

Field Distribution: Compute and visualize electromagnetic field intensity propagation through the entire depth of the sensor stack. Export all arrays to CSV.

4. Parameter Sweep

Systematically map the optical response by sweeping single or multiple geometric/material variables (1D or 2D).

Sweep Modes: Includes Fast Single Point scans (for rapid calculation without metric extraction), alongside comprehensive Angle and Wavelength Scans (enabling full extraction of MinR, FWHM, and Sensitivity).

Visualization & Export: Generate high-resolution 1D plots, 2D heatmaps, and full dispersion curves. Compute performance matrices for all parameter combinations and export massive sweep datasets to CSV.

5. Inverse Design & Optimization

A dedicated structural optimization module that eliminates manual trial-and-error design.

Algorithms: Implements Single-Objective Genetic Algorithm (SOGA), Non-dominated Sorting Genetic Algorithm II (NSGA-II) for Pareto front evaluation, Particle Swarm Optimization (PSO), and Gradient Descent.

Optimization Variables: Tune layer thicknesses, execute discrete material selection (Scrambler), optimize DBR period counts, group specific materials, define 2D layer counts, and optimize Porous Fill Factors.

Custom Objectives: Build composite multi-objective functions. Target global/local reflectivity, perform curve-fitting to specific responses, utilize regional averaging, or maximize Sensitivity for specific $\Delta n$ variations subject to physical constraints.

Workflow Integration: Optimized solutions (and selected Pareto front candidates from NSGA-II) are automatically loaded back into the Geometry Design module. Full optimization histories are exportable to CSV.

Architecture

SPR Companion utilizes a pure client-side architecture, ensuring rapid computation without backend dependencies or server latency. All data processing remains local to your browser.

Core UI/UX: HTML5, CSS3, and ES6 JavaScript.

Computation Engine: Math.js for the complex number arithmetic and matrix operations fundamental to the 4x4 TMM engine.

Visualization: Plotly.js for rendering dynamic, high-performance 2D and 3D data arrays.

Authors

Pericle Varasteanu - Nanobiotechnology Laboratory, National Institute for Research and Development in Microtechnologies (IMT Bucharest).

License

This project is licensed under the MIT License - see the LICENSE file for details.