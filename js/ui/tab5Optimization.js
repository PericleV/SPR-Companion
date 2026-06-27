import { GeometryManager } from './tab2Geometry.js?v=53';
import { MaterialsDB } from '../core/materials_database.js?v=53';
import { evaluateTargetModel, Evaluator } from '../core/geneticAlgo.js?v=53';

export const OptimizationManager = {
    worker: null,
    isOptimizing: false,

    // Data for plots and state
    initialResponse: null,
    bestResponse: null,
    bestGenome: null, 
    convergenceHistory: { x: [], y: [] }, 
    
    // NSGA-II States (Pareto Front)
    currentParetoFront: null,
    selectedParetoIndex: 0,
    
    targetComponentsMap: {},
    currentTargetMetric: null,

    syncMaterialsDB() {},

    init() {
        this.container = document.getElementById('optimization-container');
        this.metricCounter = 1;
        this.globalObjCounter = 1;
        
        this.syncMaterialsDB(); 
        
        this.render();
        this.attachEvents();
        this.updateVariablesList();
        
        this.addMetricRow();
        this.addGlobalObjRow();

        document.addEventListener('geometryUpdated', () => {
            this.updateVariablesList();
            this.updateSensLayers();
            this.showSyncWarning();
        });
        document.addEventListener('materialsUpdated', () => {
            this.syncMaterialsDB();
            this.updateVariablesList();
            this.showSyncWarning();
        });
    },

    showSyncWarning() {
        const warning = document.getElementById('opt-sync-warning');
        if (warning && this.bestResponse) {
            warning.style.display = 'block';
        }
    },

    hideSyncWarning() {
        const warning = document.getElementById('opt-sync-warning');
        if (warning) warning.style.display = 'none';
    },

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <style>
                #optimization-container details summary::-webkit-details-marker { display: none; }
                #optimization-container details summary { list-style: none; }
                #optimization-container details[open] summary .toggle-arrow { transform: rotate(180deg); }
            </style>
            
            <div class="mobile-stack-row" style="display: flex; gap: 20px; height: 100%; overflow: hidden;">
                
                <!-- Left Column: Optimization Configuration -->
                <div class="mobile-col-full" style="width: 360px; display: flex; flex-direction: column; gap: 25px; overflow-y: auto; padding-right: 10px; padding-bottom: 20px; flex-shrink: 0;">
                    
                    <div id="opt-sync-warning" class="bg-warning text-main" style="display: none; padding: 10px; border-radius: 6px; border: 1px solid var(--color-warning-alt); font-size: 0.9rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Stack configuration changed. Results may be out of date. Please re-run the optimization.
                    </div>

                    <!-- 1. Algorithm Settings -->
                    <details style="flex-shrink: 0; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden;">
                        <summary style="padding: 15px; color: var(--text-main); font-weight: bold; cursor: pointer; outline: none; display: flex; align-items: center; gap: 10px;">
                            <i class="fa-solid fa-gear" style="color: var(--accent-blue);"></i> Algorithm Settings
                            <i class="fa-solid fa-chevron-down toggle-arrow" style="margin-left: auto; transition: transform 0.3s ease; color: var(--text-muted);"></i>
                        </summary>
                        <div style="padding: 0 15px 15px 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: 1px solid rgba(255,255,255,0.05);">
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);" title="Primary optimization method">Algorithm Type</label>
                                <select id="opt-algo-type" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    <option value="sga">Single Objective (SGA)</option>
                                    <option value="nsga2">Multi Objective (NSGA-II)</option>
                                    <option value="pso">Particle Swarm (PSO)</option>
                                    <option value="gd">Gradient Descent (Inverse Design)</option>
                                </select>
                            </div>
                            <div id="opt-container-sga-only">
                                <label style="font-size: 0.75rem; color: var(--text-muted);" title="Parent selection method (SGA only)">Selection (SGA)</label>
                                <select id="opt-selection-type" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    <option value="tournament">Tournament</option>
                                    <option value="roulette">Roulette Wheel</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Population Size</label>
                                <input type="number" id="opt-pop-size" value="50" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Max Generations</label>
                                <input type="number" id="opt-generations" value="100" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div id="opt-pareto-filter-container" style="display: none;">
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Pareto Filter (%) <span class="custom-tooltip" data-tooltip="Minimum relative difference between Pareto solutions to be considered distinct.">?</span></label>
                                <input type="number" step="0.1" id="opt-pareto-epsilon" value="1.5" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);" title="Leave empty for random seed">Seed (Optional)</label>
                                <input type="text" id="opt-seed" placeholder="e.g. 1234" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            
                            <!-- SBX & Poly Params -->
                            <div style="grid-column: span 2; border-bottom: 1px solid rgba(255,255,255,0.05); margin-top: 5px; padding-bottom: 5px;">
                                <span style="font-size: 0.8rem; color: var(--accent-blue);"><i class="fa-solid fa-dna"></i> Advanced Genetic Operators</span>
                            </div>
                            
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Crossover Prob. (%) <span class="custom-tooltip" data-tooltip="Simulated Binary Crossover (SBX) Probability.">?</span></label>
                                <input type="number" id="opt-crossover-rate" value="90" max="100" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Crossover Eta (ηc) <span class="custom-tooltip" data-tooltip="Distribution index for SBX (typically 10-20). Higher means offspring are closer to parents.">?</span></label>
                                <input type="number" id="opt-crossover-eta" value="20" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Mutation Prob. (%) <span class="custom-tooltip" data-tooltip="Polynomial Mutation Probability.">?</span></label>
                                <input type="number" id="opt-mutation-rate" value="10" max="100" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Mutation Eta (ηm) <span class="custom-tooltip" data-tooltip="Distribution index for mutation (typically 10-20).">?</span></label>
                                <input type="number" id="opt-mutation-eta" value="20" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                        </div>

                        <!-- PSO Params -->
                        <div id="opt-settings-pso" style="grid-column: span 2; display: none; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 10px;">
                            <div style="grid-column: span 3; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">
                                <span style="font-size: 0.8rem; color: var(--accent-blue);"><i class="fa-solid fa-atom"></i> PSO Parameters</span>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Inertia (w) <span class="custom-tooltip" data-tooltip="Inertia Weight (w). Controls how much of the previous velocity is kept.">?</span></label>
                                <input type="number" id="opt-pso-w" value="0.729" step="0.001" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Cognitive (c1) <span class="custom-tooltip" data-tooltip="Cognitive Coefficient (c1). Pulls particle towards its own best position.">?</span></label>
                                <input type="number" id="opt-pso-c1" value="1.494" step="0.001" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Social (c2) <span class="custom-tooltip" data-tooltip="Social Coefficient (c2). Pulls particle towards the global best position.">?</span></label>
                                <input type="number" id="opt-pso-c2" value="1.494" step="0.001" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                        </div>
                        <!-- GD Params -->
                        <div id="opt-settings-gd" style="grid-column: span 2; display: none; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                            <div style="grid-column: span 2; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">
                                <span style="font-size: 0.8rem; color: var(--accent-blue);"><i class="fa-solid fa-arrow-trend-down"></i> Gradient Descent Parameters</span>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Learning Rate <span class="custom-tooltip" data-tooltip="Learning Rate (Alpha). Controls the step size during gradient descent.">?</span></label>
                                <input type="number" id="opt-gd-lr" value="0.01" step="0.001" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Momentum <span class="custom-tooltip" data-tooltip="Momentum. Helps accelerate gradient vectors in the right directions.">?</span></label>
                                <input type="number" id="opt-gd-momentum" value="0.9" step="0.01" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                        </div>
                    </details>

                    <!-- 2. Evaluation Environment -->
                    <details open style="flex-shrink: 0; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden;">
                        <summary style="padding: 15px; color: var(--text-main); font-weight: bold; cursor: pointer; outline: none; display: flex; align-items: center; gap: 10px;">
                            <i class="fa-solid fa-microscope" style="color: var(--accent-green);"></i> Evaluation Environment
                            <i class="fa-solid fa-chevron-down toggle-arrow" style="margin-left: auto; transition: transform 0.3s ease; color: var(--text-muted);"></i>
                        </summary>
                        <div style="padding: 0 15px 15px 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: 1px solid rgba(255,255,255,0.05);">
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Scan Mode</label>
                                <select id="opt-sim-mode" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    <option value="theta">Angle (deg)</option>
                                    <option value="lambda">Spectrum (nm)</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Polarization</label>
                                <select id="opt-sim-pol" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    <option value="TM">TM (p-pol)</option>
                                    <option value="TE">TE (s-pol)</option>
                                </select>
                            </div>
                            <div>
                                <label id="label-opt-range" style="font-size: 0.75rem; color: var(--text-muted);">Scan Range</label>
                                <div style="display: flex; gap: 5px;">
                                    <input type="number" id="opt-sim-start" value="0" style="width: 50%; min-width: 0; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Start">
                                    <input type="number" id="opt-sim-end" value="90" style="width: 50%; min-width: 0; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Stop">
                                </div>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Resolution (No. Steps)</label>
                                <input type="number" id="opt-sim-steps" value="100" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div style="grid-column: span 2;">
                                <label id="label-opt-fixed" style="font-size: 0.75rem; color: var(--text-muted);">Fixed Parameter (nm/deg)</label>
                                <input type="number" id="opt-sim-fixed" value="633" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                        </div>
                    </details>

                    <!-- 3. Variables -->
                    <div style="flex-shrink: 0; background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h3 style="color: var(--text-main); margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-sliders"></i> Optimization Parameters</h3>
                            <button id="btn-refresh-vars" style="background: transparent; border: none; color: var(--accent-blue); cursor: pointer;" title="Sync from Tab 2"><i class="fa-solid fa-rotate-right"></i></button>
                        </div>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">Check layers and define parameter bounds (Min - Max).</p>
                        
                        <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                            <button id="btn-select-all-vars" style="flex: 1; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: 0.2s;"><i class="fa-solid fa-check-double" style="color: var(--accent-green);"></i> Select All</button>
                            <button id="btn-deselect-all-vars" style="flex: 1; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: 0.2s;"><i class="fa-solid fa-square" style="color: var(--text-muted);"></i> Deselect All</button>
                        </div>

                        <div id="opt-variables-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 250px; overflow-y: auto; padding-right: 5px;">
                        </div>
                    </div>

                    <!-- 4. Metrics, Objective Functions & Constraints -->
                    <div style="flex-shrink: 0; background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column;">
                        
                        <!-- 4.1 Metrics -->
                        <div style="margin-bottom: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h3 style="color: var(--accent-green); margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-chart-bar"></i> 1. Metrics (Variables M)</h3>
                                <button id="btn-add-metric" style="background: var(--accent-green); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; width: 115px; display: inline-flex; justify-content: center; align-items: center; gap: 4px; box-sizing: border-box;"><i class="fa-solid fa-plus"></i> Metric</button>
                            </div>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">Define spectrum measurements to use in formulas (e.g., M1, M2).</p>
                            <div id="opt-metrics-list" style="display: flex; flex-direction: column; gap: 8px;">
                            </div>
                        </div>

                        <!-- 4.2 Global Objectives -->
                        <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h3 style="color: var(--accent-blue); margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-bullseye"></i> 2. Global Objectives</h3>
                                <button id="btn-add-global-obj" style="background: var(--accent-blue); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; width: 115px; display: none; justify-content: center; align-items: center; gap: 4px; box-sizing: border-box;"><i class="fa-solid fa-plus"></i> Objective</button>
                            </div>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">Combine metrics via formulas (e.g., <code>M1 * 0.5 + M2</code>, or <code>M2 / M1</code> for Figure of Merit).</p>
                            <div id="opt-global-obj-list" style="display: flex; flex-direction: column; gap: 8px;">
                            </div>
                        </div>
                        
                        <!-- 4.3 Constraints -->
                        <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 15px; margin-top: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h3 class="text-danger" style="margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-lock"></i> 3. Constraints (Optional)</h3>
                                <button id="btn-add-constraint" class="bg-danger" style="color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; width: 115px; display: inline-flex; justify-content: center; align-items: center; gap: 4px; box-sizing: border-box;"><i class="fa-solid fa-plus"></i> Constraint</button>
                            </div>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">Strict boundary rules (e.g., <code>M1 < 0.1</code>). Non-compliant solutions receive a fitness penalty.</p>
                            <div id="opt-constraints-list" style="display: flex; flex-direction: column; gap: 8px;">
                            </div>
                        </div>
                        
                    </div>

                    <button id="btn-run-opt" class="bg-purple" style="flex-shrink: 0; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 1.1rem; cursor: pointer; transition: 0.2s; display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: auto;">
                        <i class="fa-solid fa-play"></i> Start Optimization
                    </button>
                </div>

                <!-- Right Column -->
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden;">
                    
                    <div style="display: flex; border-bottom: 1px solid var(--border-color); background: var(--bg-main); flex-shrink: 0;">
                        <button id="btn-tab-rezultate" class="right-tab-btn active" style="flex: 1; padding: 15px; background: transparent; border: none; color: var(--accent-blue); border-bottom: 3px solid var(--accent-blue); font-weight: bold; cursor: pointer; transition: 0.2s;"><i class="fa-solid fa-chart-line"></i> Optimization Results</button>
                        <button id="btn-tab-curvefit" class="right-tab-btn" style="flex: 1; padding: 15px; background: transparent; border: none; color: var(--text-muted); border-bottom: 3px solid transparent; font-weight: bold; cursor: pointer; transition: 0.2s;"><i class="fa-solid fa-bezier-curve"></i> Target Curve Designer (CurveFit)</button>
                    </div>

                    <div id="view-rezultate" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; padding: 15px; overflow-y: auto;">
                        <div style="background: var(--bg-main); padding: 12px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border-color); flex-shrink: 0;">
                            <div id="opt-status-text" style="color: var(--text-main); font-weight: bold;">
                                <i class="fa-solid fa-circle-info" style="color: var(--accent-blue);"></i> Waiting for configuration...
                            </div>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <div id="opt-progress-bar" style="width: 200px; height: 10px; background: var(--bg-card); border-radius: 5px; overflow: hidden; display: none;">
                                    <div id="opt-progress-fill" style="height: 100%; width: 0%; background: var(--accent-green); transition: width 0.2s;"></div>
                                </div>
                                <button id="btn-export-population" style="display: none; background: var(--bg-card); color: var(--accent-blue); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.8rem; transition: 0.2s;"><i class="fa-solid fa-download"></i> Pop. History CSV</button>
                            </div>
                        </div>

                        <div id="opt-final-parameters" style="background: rgba(16, 185, 129, 0.1); padding: 12px 20px; border-radius: 8px; border: 1px solid var(--accent-green); display: none; flex-direction: column; gap: 10px; flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="color: var(--accent-green); margin: 0; font-size: 0.95rem;"><i class="fa-solid fa-check-circle"></i> Current Optimal Parameters</h4>
                                <button id="btn-send-geometry" style="background: var(--accent-green); color: white; padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 0.85rem; font-weight: bold; transition: 0.2s;"><i class="fa-solid fa-share-square"></i> Send to Geometry Design</button>
                            </div>
                            
                            <select id="opt-pareto-select" style="margin-top: 10px; width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-main); color: var(--text-main); display: none;">
                                <option value="">-- Select Pareto Solution --</option>
                            </select>
                            <button id="btn-export-population" style="margin-top: 10px; width: 100%; padding: 8px; border: 1px solid var(--accent-green); border-radius: 6px; background: transparent; color: var(--accent-green); cursor: pointer; display: none;">
                                <i class="fa-solid fa-file-export"></i> Export Population History (CSV)
                            </button>

<div id="opt-final-parameters-list" style="display: flex; flex-wrap: wrap; gap: 10px;"></div>
                        </div>

                        <div id="opt-objectives-comparison" style="background: var(--bg-card); padding: 12px 20px; border-radius: 8px; border: 1px solid var(--border-color); display: none; flex-direction: column; gap: 10px; flex-shrink: 0;">
                            <h4 style="color: var(--accent-blue); margin: 0; font-size: 0.95rem;"><i class="fa-solid fa-bullseye"></i> Objectives: Initial vs Optimized</h4>
                            <div id="opt-objectives-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
                        </div>

                        <div style="flex: 0 0 380px; min-width: 0; background: var(--bg-main); border-radius: 8px; display: flex; flex-direction: column; padding: 10px; flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding: 0 10px;">
                                <h4 style="color: var(--text-main); margin: 0; font-size: 0.9rem;">Optimized vs Initial Response</h4>
                                <button id="btn-csv-response" style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 0.75rem; transition: 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'"><i class="fa-solid fa-download"></i> CSV</button>
                            </div>
                            <div style="flex: 1; position: relative; min-width: 0; min-height: 0; width: 100%;">
                                <div id="opt-response-graph" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                            </div>
                        </div>

                        <div id="opt-pareto-container" style="display: none; flex: 0 0 380px; min-width: 0; background: var(--bg-main); border-radius: 8px; flex-direction: column; padding: 10px; flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding: 0 10px;">
                                <h4 style="color: var(--accent-green); margin: 0; font-size: 0.9rem;"><i class="fa-solid fa-chart-scatter"></i> Pareto Front (Select a solution point)</h4>
                                <button id="btn-csv-pareto" style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 0.75rem; transition: 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'"><i class="fa-solid fa-download"></i> CSV</button>
                            </div>
                            <div style="flex: 1; position: relative; min-width: 0; min-height: 0; width: 100%;">
                                <div id="opt-pareto-graph" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                            </div>
                        </div>

                        <div style="flex: 0 0 300px; min-width: 0; background: var(--bg-main); border-radius: 8px; display: flex; flex-direction: column; padding: 10px; flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding: 0 10px;">
                                <h4 style="color: var(--text-main); margin: 0; font-size: 0.9rem;">Fitness Convergence History</h4>
                                <button id="btn-csv-convergence" style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 0.75rem; transition: 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'"><i class="fa-solid fa-download"></i> CSV</button>
                            </div>
                            <div style="flex: 1; position: relative; min-width: 0; min-height: 0; width: 100%;">
                                <div id="opt-convergence-graph" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                            </div>
                        </div>
                    </div>

                    <div id="view-curvefit" style="flex: 1; min-width: 0; display: none; flex-direction: column; gap: 15px; padding: 15px; overflow-y: auto;">
                        <div style="background: var(--bg-main); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <div>
                                    <h3 style="color: var(--text-main); margin: 0; font-size: 1.1rem;">Analytical Curve Designer</h3>
                                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 5px;">Define the ideal spectrum response curve here. Select "CurveFit Error" on the left panel to use this target.</p>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <span style="font-size: 0.8rem; color: var(--text-muted);">Target for:</span>
                                    <select id="target-metric-select" style="padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; min-width: 80px;">
                                        <option value="">-- None --</option>
                                    </select>
                                    <select id="target-comp-type" style="padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                        <option value="step">Band / Step</option>
                                        <option value="lorentz">Lorentzian</option>
                                        <option value="fano">Fano Resonance</option>
                                        <option value="coupled">Coupled Oscillators</option>
                                    </select>
                                    <button id="btn-add-target-comp" style="background: var(--accent-blue); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-plus"></i> Component</button>
                                </div>
                            </div>
                            
                            <div id="target-components-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 200px; overflow-y: auto; padding-right: 5px;">
                            </div>
                        </div>

                        <div style="flex: 0 0 400px; min-width: 0; background: var(--bg-main); border-radius: 8px; display: flex; flex-direction: column; padding: 10px; flex-shrink: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding: 0 10px;">
                                <h4 style="color: var(--accent-blue); margin: 0; font-size: 0.9rem;">Target Curve Mathematical Preview</h4>
                                <button id="btn-csv-target" style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 0.75rem; transition: 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'"><i class="fa-solid fa-download"></i> CSV</button>
                            </div>
                            <div style="flex: 1; position: relative; min-width: 0; min-height: 0; width: 100%;">
                                <div id="opt-target-graph" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;

        const tc = window.getPlotThemeColors();
        const initialLayout = { paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: 'X', gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: 'Y', gridcolor: tc.grid, zerolinecolor: tc.grid }
        };
        Plotly.newPlot('opt-response-graph', [], initialLayout, { responsive: true, displayModeBar: true });
        Plotly.newPlot('opt-convergence-graph', [], initialLayout, { responsive: true, displayModeBar: true });
        Plotly.newPlot('opt-target-graph', [], initialLayout, { responsive: true, displayModeBar: true });
        Plotly.newPlot('opt-pareto-graph', [], initialLayout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['opt-response-graph'] = { data: [], layout: initialLayout };
        window.PlotRegistry['opt-convergence-graph'] = { data: [], layout: initialLayout };
        window.PlotRegistry['opt-target-graph'] = { data: [], layout: initialLayout };
        window.PlotRegistry['opt-pareto-graph'] = { data: [], layout: initialLayout };
    },

    attachEvents() {
        document.getElementById('btn-tab-rezultate').addEventListener('click', (e) => this.switchRightTab('rezultate', e.target));
        document.getElementById('btn-tab-curvefit').addEventListener('click', (e) => this.switchRightTab('curvefit', e.target));

        document.getElementById('opt-sim-mode').addEventListener('change', (e) => {
            const isAngle = e.target.value === 'theta';
            document.getElementById('label-opt-fixed').innerText = isAngle ? 'Fixed Wavelength (nm)' : 'Fixed Angle (deg)';
            
            // Automatically reset to sane defaults to prevent accidental TIR or invalid responses
            const fixedInput = document.getElementById('opt-sim-fixed');
            if (isAngle && fixedInput.value === '0') fixedInput.value = '633';
            else if (!isAngle && fixedInput.value === '633') fixedInput.value = '0';
            
            this.drawTargetGraph(); 
        });

        document.getElementById('opt-algo-type').addEventListener('change', (e) => {
            const isNsga2 = e.target.value === 'nsga2';
            const isPso = e.target.value === 'pso';
            const isGd = e.target.value === 'gd';
            
            document.getElementById('opt-settings-pso').style.display = isPso ? 'grid' : 'none';
            document.getElementById('opt-settings-gd').style.display = isGd ? 'grid' : 'none';
            
            document.getElementById('btn-add-global-obj').style.display = isNsga2 ? 'block' : 'none';
            document.getElementById('opt-selection-type').parentElement.style.opacity = (isNsga2 || isPso || isGd) ? '0.5' : '1';
            document.getElementById('opt-selection-type').disabled = (isNsga2 || isPso || isGd); 
            
            const gaOptions = document.querySelectorAll('#opt-crossover-rate, #opt-crossover-eta, #opt-mutation-rate, #opt-mutation-eta');
            gaOptions.forEach(opt => {
                opt.parentElement.style.opacity = (isPso || isGd) ? '0.5' : '1';
                opt.disabled = (isPso || isGd);
            });
            
            if (!isNsga2) {
                const rows = document.querySelectorAll('.global-obj-row');
                for (let i = 1; i < rows.length; i++) rows[i].remove();
            }
            
            const filterContainer = document.getElementById('opt-pareto-filter-container');
            if (filterContainer) filterContainer.style.display = isNsga2 ? 'block' : 'none';
        });
        
        // Initialize Pareto filter visibility on load
        const initialAlgo = document.getElementById('opt-algo-type').value;
        const filterContainerInit = document.getElementById('opt-pareto-filter-container');
        if (filterContainerInit) filterContainerInit.style.display = initialAlgo === 'nsga2' ? 'block' : 'none';

        document.getElementById('btn-refresh-vars').addEventListener('click', () => this.updateVariablesList());
        document.getElementById('btn-add-metric').addEventListener('click', () => this.addMetricRow());
        document.getElementById('btn-add-global-obj').addEventListener('click', () => this.addGlobalObjRow());
        document.getElementById('btn-add-constraint').addEventListener('click', () => this.addConstraintRow());
        
        document.getElementById('btn-add-target-comp').addEventListener('click', () => {
            const type = document.getElementById('target-comp-type').value;
            this.addTargetComponent(type);
        });

        const targetMetricSelect = document.getElementById('target-metric-select');
        if (targetMetricSelect) {
            targetMetricSelect.addEventListener('change', (e) => {
                this.currentTargetMetric = e.target.value;
                if (this.currentTargetMetric && !this.targetComponentsMap[this.currentTargetMetric]) {
                    this.targetComponentsMap[this.currentTargetMetric] = [];
                }
                this.renderTargetComponents();
                this.drawTargetGraph();
            });
        }

        document.getElementById('btn-run-opt').addEventListener('click', () => this.toggleOptimization());

        const btnApplyOpt = document.getElementById('btn-apply-opt-geometry');
        if (btnApplyOpt) {
            btnApplyOpt.addEventListener('click', () => {
                if (!this.bestGenome || !this.lastOptimizationConfig) return;
                this.applyAndSaveOptimizedResult(this.lastOptimizationConfig);
                alert('Successfully applied optimal solution! Redirecting to Geometry Design...');
                const geomTabBtn = document.querySelector('li[data-target="tab-geometry"]');
                if (geomTabBtn) geomTabBtn.click();
            });
        }
        
        const btnSendGeometry = document.getElementById('btn-send-geometry');
        if (btnSendGeometry) {
            btnSendGeometry.addEventListener('click', () => {
                if (!this.bestGenome || !this.lastOptimizationConfig) return;
                try {
                    this.applyAndSaveOptimizedResult(this.lastOptimizationConfig);
                    // Switch to Geometry Tab
                    const tabBtn = document.querySelector('button[onclick="switchTab(\'tab2\')"]');
                    if (tabBtn) tabBtn.click();
                    else if (typeof switchTab === 'function') switchTab('tab2');
                } catch(e) {
                    console.error("Failed to send geometry:", e);
                }
            });
        }
        
        const paretoSelect = document.getElementById('opt-pareto-select');
        if (paretoSelect) {
            paretoSelect.addEventListener('change', (e) => {
                const idx = parseInt(e.target.value);
                if (!isNaN(idx) && this.currentParetoFront && this.currentParetoFront[idx]) {
                    this.selectedParetoIndex = idx;
                    this.compareParetoIndices = new Set();
                    
                    const sol = this.currentParetoFront[idx];
                    const conf = this.lastOptimizationConfig;
                    this.bestGenomeRaw = sol.genome;
                    this.bestGenome = conf ? conf.variables.map((v, i) => ({ layerIndex: v.layerIndex, param: v.param, val: sol.genome[i], allowedMaterials: v.allowedMaterials, originalMaterial: conf.baseLayers[v.layerIndex] ? conf.baseLayers[v.layerIndex].material : null })) : sol.genome;
                    this.bestResponse = sol.response;
                    
                    if (conf) {
                        this.updateFinalParametersUI();
                        this.drawResponsePlot(conf);
                        this.drawParetoPlot(conf);
                    }
                }
            });
        }


        document.getElementById('btn-select-all-vars').addEventListener('click', () => {
            document.querySelectorAll('.var-checkbox:not([disabled])').forEach(cb => cb.checked = true);
        });
        document.getElementById('btn-deselect-all-vars').addEventListener('click', () => {
            document.querySelectorAll('.var-checkbox:not([disabled])').forEach(cb => cb.checked = false);
        });

        document.getElementById('btn-csv-response').addEventListener('click', () => this.exportCSV('opt-response-graph', 'optimization_response.csv'));
        document.getElementById('btn-csv-pareto').addEventListener('click', () => this.exportCSV('opt-pareto-graph', 'pareto_front.csv'));
        document.getElementById('btn-csv-convergence').addEventListener('click', () => this.exportCSV('opt-convergence-graph', 'fitness_convergence.csv'));
        document.getElementById('btn-csv-target').addEventListener('click', () => this.exportCSV('opt-target-graph', 'target_curve.csv'));

        document.getElementById('opt-pareto-graph').on('plotly_click', (data) => {
            if (data.points && data.points.length > 0) {
                const idx = data.points[0].pointIndex !== undefined ? data.points[0].pointIndex : data.points[0].pointNumber;
                if (!this.compareParetoIndices) this.compareParetoIndices = new Set();
                
                if (data.event && data.event.shiftKey) {
                    if (this.compareParetoIndices.has(idx)) {
                        this.compareParetoIndices.delete(idx);
                    } else {
                        this.compareParetoIndices.add(idx);
                    }
                } else {
                    this.compareParetoIndices.clear();
                    this.compareParetoIndices.add(idx);
                }
                
                this.selectParetoSolution(idx, this.lastOptimizationConfig || this.getOptimizationConfig());
            }
        });

        this.drawTargetGraph(); 
    },

    exportCSV(graphId, filename) {
        window.PlotRegistry = window.PlotRegistry || {};
        const graphData = window.PlotRegistry[graphId];
        if (!graphData || !graphData.data || graphData.data.length === 0) {
            return alert("No plotted data on graph to export!");
        }

        let csvContent = "";
        let headers = [];
        let maxLen = 0;

        graphData.data.forEach((trace, i) => {
            let name = (trace.name || `Series_${i+1}`).replace(/,/g, ''); 
            headers.push(`${name}_X`, `${name}_Y`);
            if (trace.x && trace.x.length > maxLen) maxLen = trace.x.length;
        });
        csvContent += headers.join(",") + "\n";

        for (let i = 0; i < maxLen; i++) {
            let row = [];
            graphData.data.forEach(trace => {
                row.push(trace.x && trace.x[i] !== undefined ? trace.x[i] : "");
                row.push(trace.y && trace.y[i] !== undefined ? trace.y[i] : "");
            });
            csvContent += row.join(",") + "\n";
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    switchRightTab(tabName, btnElement) {
        document.querySelectorAll('.right-tab-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.color = 'var(--text-muted)';
            btn.style.borderBottomColor = 'transparent';
        });
        btnElement.classList.add('active');
        btnElement.style.color = 'var(--accent-blue)';
        btnElement.style.borderBottomColor = 'var(--accent-blue)';

        document.getElementById('view-rezultate').style.display = tabName === 'rezultate' ? 'flex' : 'none';
        document.getElementById('view-curvefit').style.display = tabName === 'curvefit' ? 'flex' : 'none';

        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            ['opt-response-graph', 'opt-pareto-graph', 'opt-convergence-graph', 'opt-target-graph'].forEach(id => {
                const el = document.getElementById(id);
                if(el && el.data) {
                    try { Plotly.Plots.resize(el); } catch(e) {}
                }
            });
        }, 50);

        if(tabName === 'curvefit') this.drawTargetGraph();
        else this.drawResponsePlot(this.getOptimizationConfig());
    },

    updateVariablesList() {
        this.syncMaterialsDB(); 
        const container = document.getElementById('opt-variables-list');
        container.innerHTML = '';
        
        GeometryManager.layers.forEach((layer, idx) => {
            const isSemiInfinite = (idx === 0 || idx === GeometryManager.layers.length - 1);
            
            const matInfo = MaterialsDB[layer.material];
            const effectiveType = (matInfo && matInfo.category) ? matInfo.category : (layer.type || 'standard');
            
            const addVarRow = (param, label, min, max, step) => {
                const html = `
                    <div style="background: var(--bg-main); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" class="var-checkbox" data-idx="${idx}" data-param="${param}" ${isSemiInfinite ? 'disabled' : ''} style="cursor: pointer;">
                        <span style="color: var(--text-main); font-size: 0.85rem; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="Layer ${idx} (${layer.material})">L${idx} (${layer.material})</span>
                        
                        <div style="display: flex; gap: 5px; flex: 1; align-items: center;">
                            <span style="font-size: 0.75rem; color: var(--text-muted); width: 25px;">${label}:</span>
                            <input type="number" class="var-min" data-idx="${idx}" data-param="${param}" value="${min}" placeholder="Min" ${isSemiInfinite ? 'disabled' : ''} step="${step}" style="width: 45%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                            <span style="font-size: 0.75rem; color: var(--text-muted);">-</span>
                            <input type="number" class="var-max" data-idx="${idx}" data-param="${param}" value="${max}" placeholder="Max" ${isSemiInfinite ? 'disabled' : ''} step="${step}" style="width: 45%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', html);
            };

            const addScramblerRow = (disabled) => {
                const html = `
                    <div style="background: var(--bg-main); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px; margin-top: -8px; border-top: none; border-top-left-radius: 0; border-top-right-radius: 0;">
                        <input type="checkbox" class="var-checkbox var-scramble-checkbox" data-idx="${idx}" data-param="material" ${disabled ? 'disabled' : ''} style="cursor: pointer;">
                        <span style="color: var(--text-main); font-size: 0.85rem; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="Scramble Material"><i class="fa-solid fa-shuffle" style="color: var(--accent-blue);"></i> Scramble Mat.</span>
                        
                        <div style="display: flex; gap: 5px; flex: 1; align-items: center;">
                            <input type="text" class="var-allowed-materials" data-idx="${idx}" value="${layer.material}" placeholder="e.g. Au, Ag, BK7" ${disabled ? 'disabled' : ''} style="width: 100%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;" title="Comma separated materials">
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', html);
            };

            if (isSemiInfinite) {
                addVarRow('d', 'd', 0, 0, 1);
                addScramblerRow(true);
            } else {
                if (effectiveType === '2d') {
                    const N = layer.count || 1;
                    addVarRow('count', 'N', Math.max(1, N - 2), N + 5, 1);
                } else if (effectiveType === 'porous') {
                    addVarRow('d', 'd', Math.max(1, (layer.d * 0.5).toFixed(1)), (layer.d * 1.5).toFixed(1), 0.1);
                    const baseFF = matInfo && matInfo.fraction !== undefined ? Number(matInfo.fraction) : 0.5;
                    const safeFF = layer.ff !== undefined ? Number(layer.ff) : baseFF;
                    addVarRow('ff', 'f', Math.max(0, (safeFF - 0.2).toFixed(2)), Math.min(1, (safeFF + 0.2).toFixed(2)), 0.01);
                } else {
                    addVarRow('d', 'd', Math.max(1, (layer.d * 0.5).toFixed(1)), (layer.d * 1.5).toFixed(1), 0.1);
                    addScramblerRow(false);
                }
            }
        });

        // --- DBR Auto-Builder Parameters ---
        const dbr = GeometryManager.isDBRActive ? GeometryManager.dbrParams : null;
        if (dbr) {
            container.insertAdjacentHTML('beforeend', `
                <details style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                    <summary style="font-size: 0.85rem; color: var(--accent-blue); cursor: pointer; display: flex; align-items: center; gap: 8px; outline: none; margin-bottom: 8px;">
                        <i class="fa-solid fa-layer-group"></i> DBR Parameters (Auto-Builder)
                        <i class="fa-solid fa-chevron-down toggle-arrow" style="margin-left: auto; transition: transform 0.3s ease; color: var(--text-muted);"></i>
                    </summary>
                    <div id="dbr-params-inner" style="display: flex; flex-direction: column; gap: 8px;"></div>
                </details>
            `);
            
            const dbrContainer = container.querySelector('#dbr-params-inner');
            
            const addDBRRow = (param, title, shortTitle, min, max, step) => {
                const html = `
                    <div style="background: var(--bg-main); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" class="var-checkbox" data-idx="0" data-param="${param}" style="cursor: pointer;">
                        <span style="color: var(--text-main); font-size: 0.85rem; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${title}">${shortTitle}</span>
                        <div style="display: flex; gap: 5px; flex: 1; align-items: center;">
                            <input type="number" class="var-min" value="${min}" placeholder="Min" step="${step}" style="width: 45%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                            <span style="font-size: 0.75rem; color: var(--text-muted);">-</span>
                            <input type="number" class="var-max" value="${max}" placeholder="Max" step="${step}" style="width: 45%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                        </div>
                    </div>`;
                dbrContainer.insertAdjacentHTML('beforeend', html);
            };

            addDBRRow('dbr_periods', 'DBR Number of Periods (N)', 'DBR Periods (N)', Math.max(1, dbr.periods - 2), dbr.periods + 5, 1);
            
            dbr.materials.forEach((m, mIdx) => {
                addDBRRow(`dbr_mat_${mIdx}_d`, `DBR Period M${mIdx+1} Thickness`, `M${mIdx+1} d`, Math.max(1, (m.d * 0.5).toFixed(1)), (m.d * 1.5).toFixed(1), 0.1);
            });
            
            if (dbr.hasDefect) {
                addDBRRow('dbr_def_d', `DBR Defect Layer Thickness`, `Defect d`, Math.max(1, (dbr.defect.d * 0.5).toFixed(1)), (dbr.defect.d * 1.5).toFixed(1), 0.1);
                addDBRRow('dbr_def_pos', `DBR Defect Position (after period N)`, `Defect Pos`, 1, dbr.periods, 1);
            }
        }
        
        // --- Global Material Thickness Parameters ---
        const uniqueMats = [...new Set(GeometryManager.layers.filter(l => l.type !== '2d').map(l => l.material))];
        if (uniqueMats.length > 0) {
            container.insertAdjacentHTML('beforeend', `
                <details style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                    <summary style="font-size: 0.85rem; color: var(--accent-green); cursor: pointer; display: flex; align-items: center; gap: 8px; outline: none; margin-bottom: 8px;">
                        <i class="fa-solid fa-layer-group"></i> Global Material Thickness (All Layers)
                        <i class="fa-solid fa-chevron-down toggle-arrow" style="margin-left: auto; transition: transform 0.3s ease; color: var(--text-muted);"></i>
                    </summary>
                    <div id="global-mat-params-inner" style="display: flex; flex-direction: column; gap: 8px;"></div>
                </details>
            `);
            const globalMatContainer = container.querySelector('#global-mat-params-inner');
            const addGlobalMatRow = (param, title, shortTitle, min, max, step) => {
                const html = `
                    <div style="background: var(--bg-main); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" class="var-checkbox" data-idx="0" data-param="${param}" style="cursor: pointer;">
                        <span style="color: var(--text-main); font-size: 0.85rem; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${title}">${shortTitle}</span>
                        <div style="display: flex; gap: 5px; flex: 1; align-items: center;">
                            <input type="number" class="var-min" value="${min}" placeholder="Min" step="${step}" style="width: 45%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                            <span style="font-size: 0.75rem; color: var(--text-muted);">-</span>
                            <input type="number" class="var-max" value="${max}" placeholder="Max" step="${step}" style="width: 45%; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                        </div>
                    </div>`;
                globalMatContainer.insertAdjacentHTML('beforeend', html);
            };

            uniqueMats.forEach(m => {
                let d = 50;
                let foundL = GeometryManager.layers.find(l => l.material === m && l.type !== '2d' && l.d > 0);
                if (foundL) d = foundL.d;
                if (GeometryManager.isDBRActive && GeometryManager.dbrParams) {
                    let foundM = GeometryManager.dbrParams.materials.find(x => x.material === m);
                    if (foundM) d = foundM.d;
                }
                
                addGlobalMatRow(`d_mat_${m}`, `Optimize all '${m}' layers together`, `All ${m} thick.`, Math.max(1, (d * 0.5).toFixed(1)), (d * 1.5).toFixed(1), 0.1);
            });
        }
    },

    addMetricRow() {
        const container = document.getElementById('opt-metrics-list');
        const id = Date.now() + Math.floor(Math.random() * 1000);
        const mId = 'M' + (this.metricCounter++);
        
        const html = `
            <div class="metric-row" id="metric-${id}" data-mid="${mId}" style="background: var(--bg-main); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); position: relative;">
                <button class="btn-del-metric text-danger" style="position: absolute; right: 5px; top: 5px; background: none; border: none; cursor: pointer;"><i class="fa-solid fa-times"></i></button>
                
                <div style="display: flex; gap: 10px; margin-bottom: 8px; margin-right: 20px; align-items: center; flex-wrap: wrap;">
                    <span class="metric-id-label" style="font-weight: bold; color: var(--accent-green); width: 30px;">${mId}</span>
                    <select class="metric-type" style="flex: 1; min-width: 120px; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                        <option value="R">Reflectance (R) Min</option>
                        <option value="T">Transmittance (T) Min</option>
                        <option value="A">Absorbance (A) Min</option>
                        <option value="AverageR">Average Reflectance</option>
                        <option value="AverageT">Average Transmittance</option>
                        <option value="AverageA">Average Absorbance</option>
                        <option value="FWHM">Dip Width (FWHM)</option>
                        <option value="Sensitivity">Sensitivity (S)</option>
                        <option value="FOM">Figure of Merit (FOM)</option>
                        <option value="ResonancePosition">Resonance Position (Dip/Peak)</option>
                        <option value="BandCenter">Band Center (DBR)</option>
                        <option value="BandgapWidth">Bandgap Width (DBR)</option>
                        <option value="MaxPhaseDerivativeR">Max Phase Derivative (R)</option>
                        <option value="MaxPhaseDerivativeT">Max Phase Derivative (T)</option>
                        <option value="curvefit">Curve Match Penalty (Error)</option>
                    </select>
                </div>
                
                <div class="metric-interval-div" style="display: flex; gap: 10px; align-items: center; padding-left: 40px; margin-top: 5px;"></div>
                <div class="metric-sens-div" style="display: none; gap: 10px; align-items: center; margin-top: 8px; padding-left: 40px; flex-wrap: wrap;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); width: 65px;">Delta n:</span>
                    <input type="number" step="0.001" class="metric-delta-n" value="0.005" style="flex: 1; min-width: 50px; max-width: 80px; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;" title="Refractive index variation">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">Layer:</span>
                    <select class="metric-sens-layer" style="flex: 1; min-width: 60px; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                    </select>
                </div>
                <div class="metric-curvefit-div" style="display: none; gap: 10px; align-items: center; margin-top: 8px; padding-left: 40px; flex-wrap: wrap;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); width: 65px;">Fit Param:</span>
                    <select class="metric-curvefit-param" style="flex: 1; min-width: 60px; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                        <option value="R">Reflectance (R)</option>
                        <option value="T">Transmittance (T)</option>
                        <option value="A">Absorbance (A)</option>
                        <option value="phaseR">Phase (R)</option>
                        <option value="phaseT">Phase (T)</option>
                    </select>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        const newRow = document.getElementById(`metric-${id}`);
        
        const updateUI = () => {
            const type = newRow.querySelector('.metric-type').value;
            const intervalDiv = newRow.querySelector('.metric-interval-div');
            const sensDiv = newRow.querySelector('.metric-sens-div');
            const curvefitDiv = newRow.querySelector('.metric-curvefit-div');

            if (type === 'Sensitivity' || type === 'FOM') {
                sensDiv.style.display = 'flex';
            } else {
                sensDiv.style.display = 'none';
            }

            if (type === 'curvefit') curvefitDiv.style.display = 'flex';
            else curvefitDiv.style.display = 'none';

            intervalDiv.style.display = 'flex';
            intervalDiv.style.flexWrap = 'wrap'; 
            intervalDiv.innerHTML = `
                <span style="font-size: 0.75rem; color: var(--text-muted); width: 65px; white-space: nowrap;">Apply on X:</span>
                <div style="display: flex; gap: 5px; flex: 1; min-width: 120px;">
                    <input type="number" class="metric-xmin" value="0" style="flex: 1; min-width: 0; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem; text-align: center;">
                    <span style="color: var(--text-muted); display: flex; align-items: center;">-</span>
                    <input type="number" class="metric-xmax" value="90" style="flex: 1; min-width: 0; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem; text-align: center;">
                </div>
            `;
            this.updateTargetMetricDropdown();
        };

        newRow.querySelector('.metric-type').addEventListener('change', updateUI);
        
        newRow.querySelector('.btn-del-metric').addEventListener('click', () => {
            if (document.querySelectorAll('.metric-row').length <= 1) {
                return alert("You must define at least one metric!");
            }
            newRow.remove();
            this.updateTargetMetricDropdown();
        });
        
        updateUI(); 
        this.updateSensLayers();
    },

    updateSensLayers() {
        const layers = GeometryManager.layers;
        const selects = document.querySelectorAll('.metric-sens-layer');
        selects.forEach(select => {
            const currentVal = select.value;
            select.innerHTML = '';
            layers.forEach((l, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `L${idx+1} (${l.material})`;
                select.appendChild(opt);
            });
            if (!currentVal) {
                select.value = layers.length - 1; 
            } else {
                select.value = currentVal;
            }
        });
    },

    addGlobalObjRow() {
        const container = document.getElementById('opt-global-obj-list');
        const id = Date.now() + Math.floor(Math.random() * 1000);
        const objId = 'Obj' + (this.globalObjCounter++);
        
        const html = `
            <div class="global-obj-row" id="gobj-${id}" style="background: var(--bg-main); padding: 10px; border-radius: 6px; border: 1px solid var(--accent-blue); position: relative; display: flex; flex-direction: column; gap: 8px;">
                <button class="btn-del-gobj text-danger" style="position: absolute; right: 5px; top: 5px; background: none; border: none; cursor: pointer;"><i class="fa-solid fa-times"></i></button>
                
                <div style="display: flex; align-items: center; gap: 10px; margin-right: 20px;">
                    <span class="obj-id-label" style="font-weight: bold; color: var(--accent-blue); width: 40px;">${objId}</span>
                    <select class="gobj-goal" style="flex: 1; min-width: 0; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                        <option value="min">Minimize Result</option>
                        <option value="max">Maximize Result</option>
                    </select>
                </div>
                
                <div style="display: flex; align-items: center; gap: 10px; padding-left: 50px; flex-wrap: wrap;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Formula:</span>
                    <input type="text" class="gobj-formula" value="M1" placeholder="e.g., M1 * 0.5 + M2" style="flex: 1; min-width: 80px; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; font-family: monospace;">
                </div>
                <div class="gobj-curvefit-hint" style="display: none; padding-left: 50px; margin-top: 5px; font-size: 0.75rem; color: #fbbf24;">
                    <i class="fa-solid fa-triangle-exclamation"></i> <b>Hint:</b> Your formula contains a Curve Match Penalty. You usually want to <b>Minimize Result</b>.
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        const newRow = document.getElementById(`gobj-${id}`);
        newRow.querySelector('.btn-del-gobj').addEventListener('click', () => {
            if (document.querySelectorAll('.global-obj-row').length <= 1) {
                return alert("The algorithm requires at least one global objective defined!");
            }
            newRow.remove();
        });

        const formulaInput = newRow.querySelector('.gobj-formula');
        const goalSelect = newRow.querySelector('.gobj-goal');
        const hintDiv = newRow.querySelector('.gobj-curvefit-hint');

        const updateHint = () => {
            const curveFitIds = Array.from(document.querySelectorAll('.metric-row'))
                .filter(r => r.querySelector('.metric-type').value === 'curvefit')
                .map(r => r.dataset.mid);
            const hasCurveFit = curveFitIds.some(id => formulaInput.value.includes(id));
            if (hasCurveFit && goalSelect.value === 'max') {
                hintDiv.style.display = 'block';
            } else {
                hintDiv.style.display = 'none';
            }
        };

        formulaInput.addEventListener('input', updateHint);
        goalSelect.addEventListener('change', updateHint);
        setTimeout(updateHint, 100);
    },

    addConstraintRow() {
        const container = document.getElementById('opt-constraints-list');
        const id = Date.now() + Math.floor(Math.random() * 1000);
        
        const html = `
            <div class="constraint-row border-danger" id="constr-${id}" style="background: var(--bg-main); padding: 10px; border-radius: 6px; border-width: 1px; border-style: solid; position: relative; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <button class="btn-del-constr text-danger" style="position: absolute; right: 5px; top: 5px; background: none; border: none; cursor: pointer;"><i class="fa-solid fa-times"></i></button>
                <span style="font-size: 0.8rem; color: var(--text-muted); width: 80px;">Condition:</span>
                <input type="text" class="constr-formula" placeholder="e.g., M1 < 0.05" style="flex: 1; min-width: 100px; padding: 4px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; font-family: monospace; margin-right: 20px;">
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        document.getElementById(`constr-${id}`).querySelector('.btn-del-constr').addEventListener('click', function() {
            this.closest('.constraint-row').remove();
        });
    },    updateTargetMetricDropdown() {
        const select = document.getElementById('target-metric-select');
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- None --</option>';
        let hasCurveFit = false;
        document.querySelectorAll('.metric-row').forEach(row => {
            const mId = row.dataset.mid;
            const type = row.querySelector('.metric-type').value;
            if (type === 'curvefit') {
                hasCurveFit = true;
                const opt = document.createElement('option');
                opt.value = mId;
                opt.textContent = mId;
                select.appendChild(opt);
                if (!this.targetComponentsMap[mId]) {
                    this.targetComponentsMap[mId] = [];
                }
            }
        });
        if (hasCurveFit) {
            const options = Array.from(select.options).map(o => o.value).filter(v => v);
            if (options.includes(currentVal)) {
                select.value = currentVal;
                this.currentTargetMetric = currentVal;
            } else if (options.includes(this.currentTargetMetric)) {
                select.value = this.currentTargetMetric;
            } else {
                select.value = options[0];
                this.currentTargetMetric = options[0];
            }
        } else {
            this.currentTargetMetric = null;
        }
        this.renderTargetComponents();
        this.drawTargetGraph();
    },

    addTargetComponent(type) {
        if (!this.currentTargetMetric) {
            return alert('Please select a metric first from the "Target for" dropdown.');
        }
        if (!this.targetComponentsMap[this.currentTargetMetric]) {
            this.targetComponentsMap[this.currentTargetMetric] = [];
        }
        const id = Date.now() + '-' + Math.floor(Math.random() * 1000);
        let comp = { id, type };
        
        if (type === 'step') {
            comp.xmin = 40; comp.xmax = 50; comp.yval = 0; comp.ybase = 1;
        } else if (type === 'lorentz') {
            comp.y0 = 1; comp.A = -1; comp.xc = 45; comp.w = 2;
        } else if (type === 'fano') {
            comp.y0 = 1; comp.A = -1; comp.xc = 45; comp.w = 2; comp.q = 1;
        } else if (type === 'coupled') {
            comp.y0 = 1; comp.A1 = -1; comp.w1 = 45; comp.g1 = 2; comp.w2 = 47; comp.g2 = 1; comp.k = 1;
        }
        
        this.targetComponentsMap[this.currentTargetMetric].push(comp);
        this.renderTargetComponents();
        this.drawTargetGraph();
    },

    renderTargetComponents() {
        const list = document.getElementById('target-components-list');
        list.innerHTML = '';
        if (!this.currentTargetMetric || !this.targetComponentsMap[this.currentTargetMetric]) return;
        
        let fullHtml = '';
        const currentComps = this.targetComponentsMap[this.currentTargetMetric];
        currentComps.forEach((c) => {
            let label = c.type;
            if (c.type === 'step') label = 'Step / Interval';
            
            let html = `<div style="background: var(--bg-card); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); position: relative;">
                <b class="text-purple" style="font-size:0.8rem;">${c.type.toUpperCase()}</b>
                <button class="btn-del-target text-danger" data-id="${c.id}" style="position:absolute; right:5px; top:5px; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-times"></i></button>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">`;
            
            Object.keys(c).forEach(key => {
                if (key !== 'id' && key !== 'type') {
                    html += `<div style="display:flex; flex-direction:column; flex: 1; min-width: 60px;">
                        <span class="text-muted" style="font-size:0.7rem;">${key}:</span>
                        <input type="number" class="target-param-input" data-id="${c.id}" data-key="${key}" value="${c[key]}" step="0.1" style="padding:4px; background:var(--bg-main); color: var(--text-main); border:1px solid var(--border-color); border-radius: 4px;">
                    </div>`;
                }
            });
            html += `</div></div>`;
            fullHtml += html;
        });
        
        list.innerHTML = fullHtml;

        document.querySelectorAll('.target-param-select').forEach(el => {
            el.addEventListener('change', (e) => {
                const comp = this.targetComponentsMap[this.currentTargetMetric].find(c => c.id === e.target.dataset.id);
                if (comp) {
                    comp[e.target.dataset.key] = e.target.value;
                    this.drawTargetGraph();
                }
            });
        });

        document.querySelectorAll('.target-param-input').forEach(el => {
            el.addEventListener('input', (e) => {
                const comp = this.targetComponentsMap[this.currentTargetMetric].find(c => c.id === e.target.dataset.id);
                if (comp) {
                    comp[e.target.dataset.key] = parseFloat(e.target.value);
                    this.drawTargetGraph();
                }
            });
        });

        document.querySelectorAll('.btn-del-target').forEach(el => {
            el.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-del-target');
                if (btn) {
                    this.targetComponentsMap[this.currentTargetMetric] = this.targetComponentsMap[this.currentTargetMetric].filter(c => c.id !== btn.dataset.id);
                    this.renderTargetComponents();
                    this.drawTargetGraph();
                }
            });
        });
    },

    drawTargetGraph() {
        const start = parseFloat(document.getElementById('opt-sim-start').value) || 0;
        const end = parseFloat(document.getElementById('opt-sim-end').value) || 90;
        const mode = document.getElementById('opt-sim-mode').value;
        
        const xTitle = mode === 'theta' ? 'Incident Angle (degrees)' : 'Wavelength (nm)';
        
        const xData = [];
        const yData = [];
        const steps = 300;
        const stepSize = (end - start) / steps;
        
        for(let i=0; i<=steps; i++) {
            let x = start + i * stepSize;
            xData.push(x);
            yData.push(evaluateTargetModel(x, this.targetComponentsMap[this.currentTargetMetric] || []));
        }

        const traces = [{
            x: xData,
            y: yData,
            name: 'Mathematical Target Curve',
            type: 'scatter',
            line: { color: 'var(--color-success)', width: 3 },
            fill: 'tozeroy',
            fillcolor: 'rgba(16, 185, 129, 0.1)'
        }];
        const tc = window.getPlotThemeColors();
        const layout = {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: xTitle, gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: 'Target Value (Y)', gridcolor: tc.grid, zerolinecolor: tc.grid },
            margin: { t: 40, r: 20, l: 60, b: 40 }
        };

        Plotly.react('opt-target-graph', traces, layout);
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['opt-target-graph'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    getOptimizationConfig() {
        this.syncMaterialsDB(); 

        const variables = [];
        let hasDBROpt = false;
        let hasError = false;

        document.querySelectorAll('.var-checkbox:checked').forEach(cb => {
            if (hasError) return;
            const idx = parseInt(cb.dataset.idx);
            const param = cb.dataset.param;
            const row = cb.closest('div');
            
            if (param.startsWith('dbr_') || (param.startsWith('d_mat_') && GeometryManager.isDBRActive)) {
                hasDBROpt = true;
            }

            if (param === 'material') {
                const allowedStr = row.querySelector('.var-allowed-materials').value;
                const allowedMaterials = allowedStr.split(',').map(s => s.trim()).filter(s => s.length > 0 && MaterialsDB[s]);
                if (allowedMaterials.length > 0) {
                    variables.push({
                        layerIndex: idx,
                        param: param,
                        min: 0,
                        max: allowedMaterials.length - 1,
                        allowedMaterials: allowedMaterials
                    });
                }
            } else {
                const minVal = parseFloat(row.querySelector('.var-min').value);
                const maxVal = parseFloat(row.querySelector('.var-max').value);
                
                if (minVal > maxVal) {
                    alert(`Invalid optimization bounds for parameter '${param}'. Min cannot be greater than Max.`);
                    hasError = true;
                    return;
                }
                if (minVal < 0 && !param.includes('pos')) {
                    alert(`Invalid optimization bounds for parameter '${param}'. Physical thickness or repetition count cannot be negative.`);
                    hasError = true;
                    return;
                }

                variables.push({
                    layerIndex: idx,
                    param: param,
                    min: minVal,
                    max: maxVal
                });
            }
        });

        if (hasError) return null;

        const metrics = [];
        document.querySelectorAll('.metric-row').forEach(row => {
            const m = {
                id: row.dataset.mid,
                type: row.querySelector('.metric-type').value,
                xMin: parseFloat(row.querySelector('.metric-xmin') ? row.querySelector('.metric-xmin').value : 0),
                xMax: parseFloat(row.querySelector('.metric-xmax') ? row.querySelector('.metric-xmax').value : 90),
                deltaN: row.querySelector('.metric-delta-n') ? parseFloat(row.querySelector('.metric-delta-n').value) : 0.005
            };
            const sensLayerSel = row.querySelector('.metric-sens-layer');
            if (sensLayerSel) m.layerIdx = parseInt(sensLayerSel.value);
            const fitParamSel = row.querySelector('.metric-curvefit-param');
            if (fitParamSel) m.curvefitParam = fitParamSel.value;
            metrics.push(m);
        });

        const globalObjectives = [];
        document.querySelectorAll('.global-obj-row').forEach(row => {
            globalObjectives.push({
                goal: row.querySelector('.gobj-goal').value,
                formula: row.querySelector('.gobj-formula').value
            });
        });

        const constraints = [];
        document.querySelectorAll('.constraint-row').forEach(row => {
            const formula = row.querySelector('.constr-formula').value.trim();
            if (formula) constraints.push({ formula });
        });

        let baseLayers = JSON.parse(JSON.stringify(GeometryManager.layers));
        if (hasDBROpt) {
            const numDBRLayers = GeometryManager.dbrParams.periods * GeometryManager.dbrParams.materials.length + (GeometryManager.dbrParams.hasDefect ? 1 : 0);
            baseLayers.splice(baseLayers.length - 1 - numDBRLayers, numDBRLayers);
        }

        const processedLayers = baseLayers.map(layer => {
            const mat = MaterialsDB[layer.material] || { type: 'constant', n: 1.5, k: 0 };
            const isDispersive = mat.type === 'dispersive';
            return { 
                d: layer.d, 
                material: layer.material, 
                isDispersive, 
                n: isDispersive ? null : mat.n, 
                k: isDispersive ? null : mat.k, 
                dispersionData: isDispersive ? mat.data : null,
                type: layer.type,
                ff: layer.ff
            };
        });

        const uiSteps = parseInt(document.getElementById('opt-sim-steps').value || 100, 10);

        const popSize = parseInt(document.getElementById('opt-pop-size').value);
        const generations = parseInt(document.getElementById('opt-generations').value);
        const paretoEpsilon = parseFloat(document.getElementById('opt-pareto-epsilon') ? document.getElementById('opt-pareto-epsilon').value : 1.5) / 100.0;
        const crossRate = parseFloat(document.getElementById('opt-crossover-rate').value);
        const crossEta = parseFloat(document.getElementById('opt-crossover-eta').value);
        const mutRate = parseFloat(document.getElementById('opt-mutation-rate').value);
        const mutEta = parseFloat(document.getElementById('opt-mutation-eta').value);
        
        const simStart = parseFloat(document.getElementById('opt-sim-start').value);
        const simEnd = parseFloat(document.getElementById('opt-sim-end').value);
        const simFixed = parseFloat(document.getElementById('opt-sim-fixed').value);

        if ([popSize, generations, crossRate, crossEta, mutRate, mutEta, simStart, simEnd, simFixed, uiSteps].some(isNaN)) {
            alert("Please enter valid numerical values for all optimization settings.");
            return null;
        }

        if (popSize <= 0 || generations <= 0 || uiSteps <= 0) {
            alert("Population size, generations, and simulation steps must be greater than 0.");
            return null;
        }

        return {
            algoType: document.getElementById('opt-algo-type').value,
            selectionType: document.getElementById('opt-selection-type').value,
            popSize: popSize,
            generations: generations,
            paretoEpsilon: paretoEpsilon,
            
            crossoverRate: crossRate / 100,
            crossoverEta: crossEta,
            mutationRate: mutRate / 100.0,
            mutationEta: mutEta,
            psoW: parseFloat(document.getElementById('opt-pso-w').value) || 0.729,
            psoC1: parseFloat(document.getElementById('opt-pso-c1').value) || 1.494,
            psoC2: parseFloat(document.getElementById('opt-pso-c2').value) || 1.494,
            gdLr: parseFloat(document.getElementById('opt-gd-lr').value) || 0.01,
            gdMomentum: parseFloat(document.getElementById('opt-gd-momentum').value) || 0.9,
            
            sim: {
                mode: document.getElementById('opt-sim-mode').value,
                pol: document.getElementById('opt-sim-pol').value,
                start: simStart,
                end: simEnd,
                fixed: simFixed,
                steps: uiSteps 
            },
            
            materialsDB: JSON.parse(JSON.stringify(MaterialsDB)), 
            dbrParams: JSON.parse(JSON.stringify(GeometryManager.dbrParams)),
            isDBROpt: hasDBROpt,
            processedLayers: processedLayers,
            baseLayers: baseLayers,
            variables: variables,
            metrics: metrics,
            globalObjectives: globalObjectives,
            constraints: constraints, 
            targetComponentsMap: this.targetComponentsMap 
        };
    },

    toggleOptimization() {
        this.hideSyncWarning();
        const btn = document.getElementById('btn-run-opt');
        
        if (this.isOptimizing) {
            if (this.worker) this.worker.terminate();
            if (this.updateInterval) clearInterval(this.updateInterval);
            this.isOptimizing = false;
            btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Optimization';
            btn.style.backgroundColor = 'var(--color-purple)';
            document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-stop text-danger"></i> Optimization stopped manually.';
            document.getElementById('opt-progress-bar').style.display = 'none';
            return;
        }

        const config = this.getOptimizationConfig();
        if (!config) return;
        if (config.variables.length === 0) return alert("Select at least one layer parameter to optimize!");
        if (config.metrics.length === 0) return alert("Add at least one metric!");
        if (config.globalObjectives.length === 0) return alert("Add at least one global objective!");
        for (let go of config.globalObjectives) {
            if (!go.formula.trim()) return alert("Global objective formulas cannot be empty!");
        }

        // Save current configuration to localStorage so the Geometry diff banner knows the EXACT structure that was optimized
        const currentName = GeometryManager.currentConfigName || 'Configuration 1';
        const configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
        configs[currentName] = JSON.parse(JSON.stringify(GeometryManager.layers));
        localStorage.setItem('plasmonic_configs', JSON.stringify(configs));

        this.switchRightTab('rezultate', document.getElementById('btn-tab-rezultate'));

        document.getElementById('opt-final-parameters').style.display = 'none';
        document.getElementById('opt-objectives-comparison').style.display = 'none';
        document.getElementById('opt-pareto-container').style.display = 'none';

        // --- Calculate Initial Objectives ---
        try {
            const evaluator = new Evaluator(config);
            let originalLayers = JSON.parse(JSON.stringify(config.baseLayers));
            if (config.isDBROpt && config.dbrParams) {
                const newLayers = [];
                for (let p = 1; p <= config.dbrParams.periods; p++) {
                    config.dbrParams.materials.forEach(m => newLayers.push({ material: m.material, d: m.d, type: 'standard' }));
                    if (config.dbrParams.hasDefect && p === config.dbrParams.defect.afterPeriod) {
                        newLayers.push({ material: config.dbrParams.defect.material, d: config.dbrParams.defect.d, type: 'standard' });
                    }
                }
                originalLayers.splice(originalLayers.length - 1, 0, ...newLayers);
            }
            config.sim.materialsDB = config.materialsDB;
            const response = evaluator.runSimulationSequence(originalLayers, config.sim);
            const metricValues = config.metrics.map(m => evaluator.computeSingleMetric(m, response, originalLayers));
            this.initialMetricValues = metricValues;
            
            this.initialObjectivesInfo = config.globalObjectives.map((go, i) => {
                let val = 1e6;
                try { val = evaluator.globalObjectives[i].func(...metricValues); } catch(e) {}
                return { formula: go.formula, goal: go.goal, val: val };
            });
        } catch(e) {
            console.error("Failed to compute initial objectives", e);
            this.initialObjectivesInfo = null;
        }

        this.isOptimizing = true;
        this.lastOptimizationConfig = config;
        this.populationHistory = [];
        document.getElementById('btn-export-population').style.display = 'none';
        
        this.convergenceHistory = { x: [], y: [] };
        this.currentParetoFront = null;
        this.selectedParetoIndex = 0;
        
        this.bestResponse = null;
        this.compareParetoIndices = new Set();
        this.bestGenome = null;
        
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Optimization';
        btn.style.backgroundColor = window.getCSSColor('--color-danger');
        
        document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-blue);"></i> Running initial simulation...';
        document.getElementById('opt-progress-bar').style.display = 'block';
        const paretoSelect = document.getElementById('opt-pareto-select');
        if (paretoSelect) paretoSelect.style.display = 'none';
        const btnExportPop = document.getElementById('btn-export-population');
        if (btnExportPop) btnExportPop.style.display = 'none';
        document.getElementById('opt-progress-fill').style.width = '0%';

        if (this.initialResponse && document.getElementById('config-name-input').value.includes('(optimized)')) {
            document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-dna fa-spin text-purple-alt"></i> Genetic Algorithm active...';
            this.updateInterval = setInterval(() => {
                const isSpinning = document.getElementById('opt-status-text').innerHTML.includes('fa-spin');
                if(!isSpinning) {
                    document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-dna fa-spin text-purple-alt"></i> Genetic Algorithm active...';
                }
            }, 1000);
            this.startWorker(config);
        } else {
            this.calculateInitialResponse(config).then(() => {
                document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-dna fa-spin text-purple-alt"></i> Genetic Algorithm active...';
                this.updateInterval = setInterval(() => {
                    const isSpinning = document.getElementById('opt-status-text').innerHTML.includes('fa-spin');
                    if(!isSpinning) {
                        document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-dna fa-spin text-purple-alt"></i> Genetic Algorithm active...';
                    }
                }, 1000);
                this.startWorker(config);
            });
        }
    },

    calculateInitialResponse(config) {
        return new Promise((resolve) => {
            const tempWorker = new Worker('./js/workers/tmm.worker.js?v=53', { type: 'module' });
            
            let initialLayers = config.processedLayers;
            if (config.isDBROpt && config.dbrParams) {
                initialLayers = JSON.parse(JSON.stringify(config.processedLayers));
                const newLayers = [];
                for (let p = 1; p <= config.dbrParams.periods; p++) {
                    config.dbrParams.materials.forEach(m => {
                        const matDef = MaterialsDB[m.material] || { type: 'constant', n: 1.5, k: 0 };
                        const isDisp = matDef.type === 'dispersive';
                        newLayers.push({ 
                            material: m.material, d: m.d, isDispersive: isDisp, 
                            n: isDisp ? null : matDef.n, k: isDisp ? null : matDef.k, 
                            dispersionData: isDisp ? matDef.data : null 
                        });
                    });
                    if (config.dbrParams.hasDefect && p === config.dbrParams.defect.afterPeriod) {
                        const matDef = MaterialsDB[config.dbrParams.defect.material] || { type: 'constant', n: 1.5, k: 0 };
                        const isDisp = matDef.type === 'dispersive';
                        newLayers.push({ 
                            material: config.dbrParams.defect.material, d: config.dbrParams.defect.d, isDispersive: isDisp, 
                            n: isDisp ? null : matDef.n, k: isDisp ? null : matDef.k, 
                            dispersionData: isDisp ? matDef.data : null 
                        });
                    }
                }
                initialLayers.splice(initialLayers.length - 1, 0, ...newLayers);
            }

            tempWorker.postMessage({ 
                type: 'simulate1D', 
                payload: { 
                    start: config.sim.start, end: config.sim.end, steps: config.sim.steps, 
                    variable: config.sim.mode, fixedParam: config.sim.fixed, 
                    polarization: config.sim.pol, layers: initialLayers,
                    materialsDB: config.materialsDB
                } 
            });

            tempWorker.onmessage = (e) => {
                if (e.data.type === 'result1D') {
                    this.initialResponse = e.data.data;
                    this.drawResponsePlot(config);
                    tempWorker.terminate();
                    resolve();
                } else if (e.data.type === 'error') {
                    console.error('Initial simulation error:', e.data.message);
                    tempWorker.terminate();
                    resolve(); // resolve anyway so optimization can continue
                }
            };
            tempWorker.onerror = (e) => {
                console.error('Initial simulation worker error:', e);
                tempWorker.terminate();
                resolve(); // resolve anyway so optimization can continue
            };
        });
    },

    startWorker(config) {
        this.worker = new Worker('./js/workers/optimization.worker.js?v=53', { type: 'module' });
        
        this.worker.onerror = (e) => {
            if (this.updateInterval) clearInterval(this.updateInterval);
            console.error("Optimization Worker Error:", e);
            alert("A critical error occurred in the optimization worker. See console for details.");
            this.isOptimizing = false;
            const btn = document.getElementById('btn-run-opt');
            btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Optimization';
            btn.style.backgroundColor = 'var(--color-purple)';
            document.getElementById('opt-status-text').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-danger"></i> Error occurred`;
        };
        
        this.worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'error') {
                if (this.updateInterval) clearInterval(this.updateInterval);
                console.error("Optimization Worker Error:", msg.message, msg.stack);
                alert("Worker Error: " + msg.message);
                this.isOptimizing = false;
                const btn = document.getElementById('btn-run-opt');
                btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Optimization';
                btn.style.backgroundColor = 'var(--color-purple)';
                document.getElementById('opt-status-text').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-danger"></i> Error: ${msg.message}`;
                return;
            }
            if (msg.type === 'progress') {
                if (msg.population) this.populationHistory.push({ gen: msg.generation, pop: msg.population });
                const pct = Math.round((msg.generation / config.generations) * 100);
                document.getElementById('opt-progress-fill').style.width = `${pct}%`;
                
                if (config.algoType === 'nsga2' && msg.paretoFront) {
                    document.getElementById('opt-status-text').innerHTML = `<i class="fa-solid fa-dna text-purple-alt"></i> Gen ${msg.generation} / ${config.generations} | Pareto Front: ${msg.paretoFront.length} solutions`;
                    
                    this.currentParetoFront = msg.paretoFront;
                    document.getElementById('opt-pareto-container').style.display = 'flex';
                    
                    if (this.selectedParetoIndex === null || this.selectedParetoIndex >= this.currentParetoFront.length) {
                        this.selectedParetoIndex = 0;
                    }
                    
                    const sol = this.currentParetoFront[this.selectedParetoIndex];
                    this.bestResponse = sol.response;
                    this.bestGenomeRaw = sol.genome;
                    this.bestGenome = config.variables.map((v, i) => ({ layerIndex: v.layerIndex, param: v.param, val: sol.genome[i], allowedMaterials: v.allowedMaterials, originalMaterial: config.baseLayers[v.layerIndex] ? config.baseLayers[v.layerIndex].material : null }));
                    
                    this.drawParetoPlot(config);
                    
                    this.convergenceHistory.x.push(msg.generation);
                    this.convergenceHistory.y.push(sol.fitness || sol.objectives[0]);
                } 
                else {
                    document.getElementById('opt-status-text').innerHTML = `<i class="fa-solid fa-dna text-purple-alt"></i> Gen ${msg.generation} / ${config.generations} | Best Fitness: ${msg.bestFitness.toExponential(3)}`;
                    
                    this.convergenceHistory.x.push(msg.generation);
                    this.convergenceHistory.y.push(msg.bestFitness);
                    
                    this.bestResponse = msg.bestResponse;
                    this.bestGenomeRaw = msg.bestGenome;
                    this.bestGenome = config.variables.map((v, i) => ({ layerIndex: v.layerIndex, param: v.param, val: msg.bestGenome[i], allowedMaterials: v.allowedMaterials, originalMaterial: config.baseLayers[v.layerIndex] ? config.baseLayers[v.layerIndex].material : null }));
                }
                
                
                if (config.isMultiObjective && msg.paretoFront) {
                    this.currentParetoFront = msg.paretoFront;
                    const sel = document.getElementById('opt-pareto-select');
                    sel.style.display = 'block';
                    sel.innerHTML = '<option value="">-- Select Pareto Solution --</option>';
                    msg.paretoFront.forEach((sol, i) => {
                        sel.innerHTML += `<option value="${i}">Solution ${i+1}: Obj1=${sol.objectives[0].toExponential(3)}, Obj2=${sol.objectives[1].toExponential(3)}</option>`;
                    });
                    this.selectedParetoIndex = 0;
                    sel.value = "0";
                }

                    this.updateFinalParametersUI();
                this.drawResponsePlot(config);
                this.drawConvergencePlot();
            } 
            else if (msg.type === 'done') {
                document.getElementById('btn-export-population').style.display = (this.populationHistory && this.populationHistory.length > 0) ? 'block' : 'none';
                if (this.updateInterval) clearInterval(this.updateInterval);
                this.isOptimizing = false;
                const btn = document.getElementById('btn-run-opt');
                btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Optimization';
                btn.style.backgroundColor = 'var(--color-purple)';
                
                if (msg.reason === 'convergence') {
                    document.getElementById('opt-status-text').innerHTML = `<i class="fa-solid fa-check-double" style="color: var(--accent-green);"></i> Optimization stopped early (Convergence at gen ${msg.generation}).`;
                } else {
                    document.getElementById('opt-status-text').innerHTML = '<i class="fa-solid fa-check" style="color: var(--accent-green);"></i> Optimization Complete!';
                }
                
                document.getElementById('opt-progress-bar').style.display = 'none';

                if (this.bestGenome) {
                    this.updateFinalParametersUI();
                    this.renderObjectivesComparison(config);
                    this.applyAndSaveOptimizedResult(config);
                }
            }
        };

        this.worker.postMessage({ config: config });
    },

    selectParetoSolution(index, config) {
        if (!this.currentParetoFront || !this.currentParetoFront[index]) return;
        
        this.selectedParetoIndex = index;
        const sol = this.currentParetoFront[index];
        this.bestGenomeRaw = sol.genome;
        this.bestResponse = sol.response;
        
        try {
            this.bestGenome = config.variables.map((v, i) => ({ 
                layerIndex: v.layerIndex, param: v.param, 
                val: sol.genome[i] !== undefined ? sol.genome[i] : 0, 
                allowedMaterials: v.allowedMaterials, 
                originalMaterial: config.baseLayers[v.layerIndex] ? config.baseLayers[v.layerIndex].material : null 
            }));
            this.updateFinalParametersUI();
        } catch(e) {
            console.error("UI update failed:", e);
        }
        
        try { this.renderObjectivesComparison(config); } catch(e) { console.error("Obj comp failed", e); }
        try { this.drawParetoPlot(config, true); } catch(e) { console.error("Pareto plot failed", e); }
        try { this.drawResponsePlot(config); } catch(e) { console.error("Response plot failed", e); }
        
        try {
            this.applyAndSaveOptimizedResult(config);
        } catch(e) {
            console.error("Geometry sync failed:", e);
        }
        const sel = document.getElementById('opt-pareto-select');
        if (sel) sel.value = index;

    },

    applyAndSaveOptimizedResult(config) {
        if (!this.bestGenome) return;

        if (config.isDBROpt) {
            this.bestGenome.forEach(g => {
                if (g.param === 'dbr_periods') {
                    GeometryManager.dbrParams.periods = Math.round(g.val);
                } else if (g.param === 'dbr_def_pos') {
                    GeometryManager.dbrParams.defect.afterPeriod = Math.round(g.val);
                } else if (g.param === 'dbr_def_d') {
                    GeometryManager.dbrParams.defect.d = parseFloat(g.val);
                } else if (g.param.startsWith('dbr_mat_')) {
                    const match = g.param.match(/dbr_mat_(\d+)_d/);
                    if (match) {
                        const mIdx = parseInt(match[1]);
                        if (GeometryManager.dbrParams.materials[mIdx]) {
                            GeometryManager.dbrParams.materials[mIdx].d = parseFloat(g.val);
                        }
                    }
                } else if (g.param.startsWith('d_mat_')) {
                    const matName = g.param.replace('d_mat_', '');
                    GeometryManager.layers.forEach(l => { if (l.material === matName && l.type !== '2d') l.d = parseFloat(g.val); });
                    if (GeometryManager.dbrParams) {
                        GeometryManager.dbrParams.materials.forEach(m => { if (m.material === matName) m.d = parseFloat(g.val); });
                        if (GeometryManager.dbrParams.hasDefect && GeometryManager.dbrParams.defect.material === matName) {
                            GeometryManager.dbrParams.defect.d = parseFloat(g.val);
                        }
                    }
                }
            });
            GeometryManager.layers = [GeometryManager.layers[0], GeometryManager.layers[GeometryManager.layers.length - 1]];
            GeometryManager.buildDBR();
        } else {
            this.bestGenome.forEach(g => {
                if (g.param.startsWith('d_mat_')) {
                    const matName = g.param.replace('d_mat_', '');
                    GeometryManager.layers.forEach(l => { if (l.material === matName && l.type !== '2d') l.d = parseFloat(g.val); });
                    if (GeometryManager.dbrParams) {
                        GeometryManager.dbrParams.materials.forEach(m => { if (m.material === matName) m.d = parseFloat(g.val); });
                        if (GeometryManager.dbrParams.hasDefect && GeometryManager.dbrParams.defect.material === matName) {
                            GeometryManager.dbrParams.defect.d = parseFloat(g.val);
                        }
                    }
                    return; // skip individual layer
                }
                const layer = GeometryManager.layers[g.layerIndex];
                if (layer) {
                    if (g.param === 'd') {
                        layer.d = parseFloat(g.val);
                    } else if (g.param === 'count') {
                        layer.count = Math.round(g.val);
                        if (layer.d_mono) {
                            layer.d = layer.count * layer.d_mono;
                        }
                    } else if (g.param === 'ff') {
                        layer.ff = parseFloat(g.val);
                    } else if (g.param === 'material') {
                        let finalMat = g.val;
                        if (g.allowedMaterials) {
                            const matIdx = Math.max(0, Math.min(g.allowedMaterials.length - 1, Math.round(g.val)));
                            finalMat = g.allowedMaterials[matIdx];
                        }
                        layer.material = finalMat;
                        if (MaterialsDB && MaterialsDB[finalMat]) {
                            layer.type = MaterialsDB[finalMat].category || 'standard';
                        }
                        delete layer.n_override;
                        delete layer.k_override;
                    }
                }
            });
            GeometryManager.renderLayers();
        }
        
        // Notify the rest of the application that the geometry has changed
        document.dispatchEvent(new Event('geometryUpdated'));

        const originalName = document.getElementById('config-name-input').value.trim() || 'Configuration 1';
        
        // Ensure clean original and optimized names
        const originalNameClean = originalName.replace(' (optimized)', '').trim();
        const optName = originalNameClean + ' (optimized)';
        
        let configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
        configs[optName] = JSON.parse(JSON.stringify(GeometryManager.layers));
        localStorage.setItem('plasmonic_configs', JSON.stringify(configs));
        
        document.getElementById('config-name-input').value = optName;
        GeometryManager.updateConfigDropdown();
        document.getElementById('config-load-select').value = optName;

        // Auto-Inject Simulation Response curves into window.SimulationHistory
        window.SimulationHistory = window.SimulationHistory || {};
        
        let primaryMetric = 'R';
        const validMetric = config.metrics.find(m => ['R', 'T', 'A'].includes(m.type));
        if (validMetric) primaryMetric = validMetric.type;

        // Save base pre-optimized curve
        if (this.initialResponse) {
            window.SimulationHistory[originalNameClean] = {
                name: originalNameClean,
                x: Array.from(this.initialResponse.x),
                y: Array.from(this.initialResponse[primaryMetric]),
                metric: primaryMetric,
                variable: config.sim.mode,
                polarization: config.sim.pol,
                layers: JSON.parse(JSON.stringify(config.baseLayers))
            };
        }

        // Save optimized curve
        if (this.bestResponse) {
            window.SimulationHistory[optName] = {
                name: optName,
                x: Array.from(this.bestResponse.x),
                y: Array.from(this.bestResponse[primaryMetric]),
                metric: primaryMetric,
                variable: config.sim.mode,
                polarization: config.sim.pol,
                layers: JSON.parse(JSON.stringify(GeometryManager.layers))
            };
        }

        // Update the Geometry comparison banner instantly
        GeometryManager.updateOptimizationBanner();
    },

    updateFinalParametersUI() {
        if(!this.bestGenome) return;
        const finalParamsContainer = document.getElementById('opt-final-parameters');
        const finalParamsList = document.getElementById('opt-final-parameters-list');
        
        finalParamsContainer.style.display = 'flex';
        finalParamsList.innerHTML = this.bestGenome.map(g => {
            let unit = '';
            let valNum = Number(g.val) || 0;
            let valStr = valNum.toFixed(3);
            let extraInfo = '';
            
            if (g.param === 'd' || g.param.includes('_d')) unit = ' nm';
            if (g.param === 'count' || g.param.includes('periods') || g.param.includes('pos')) { unit = ''; valStr = Math.round(valNum).toString(); }
            if (g.param === 'ff') { unit = ''; }
            if (g.param === 'material' && g.allowedMaterials) {
                const matIdx = Math.max(0, Math.min(g.allowedMaterials.length - 1, Math.round(valNum)));
                valStr = g.allowedMaterials[matIdx];
                unit = '';
                if (g.originalMaterial && g.originalMaterial !== valStr) {
                    extraInfo = ` <span style="color: var(--text-muted); font-size: 0.8rem;">(was ${g.originalMaterial})</span>`;
                }
            }
            
            let label = `Layer ${g.layerIndex} (${g.param})`;
            if (g.param.startsWith('dbr_')) {
                if (g.param === 'dbr_periods') label = 'DBR Periods (N)';
                else if (g.param.includes('mat_0')) label = 'DBR M1 Thickness';
                else if (g.param.includes('mat_1')) label = 'DBR M2 Thickness';
                else if (g.param.includes('mat_2')) label = 'DBR M3 Thickness';
                else if (g.param.includes('def_d')) label = 'DBR Defect Thickness';
                else if (g.param === 'dbr_def_pos') label = 'DBR Defect Position';
            } else if (g.param.startsWith('d_mat_')) {
                const matName = g.param.replace('d_mat_', '');
                label = `All '${matName}' Thick.`;
            } else if (g.param === 'count') {
                label = `Layer ${g.layerIndex} (N)`;
            } else if (g.param === 'ff') {
                label = `Layer ${g.layerIndex} (f)`;
            }

            return `<span style="background: var(--bg-card); padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; border: 1px solid rgba(16, 185, 129, 0.4); color: var(--text-muted);">
                <span style="text-transform: capitalize;">${label}</span>: <b style="color: var(--text-main); font-size: 0.95rem;">${valStr}${unit}</b>${extraInfo}
            </span>`;
        }).join('');
        
        finalParamsContainer.style.display = 'flex';
    },

    drawParetoPlot(config, updateOnlyColors = false) {
        if (!this.currentParetoFront || this.currentParetoFront.length === 0) return;
        
        const numObjs = config.globalObjectives.length;
        const cDanger = window.getCSSColor('--color-danger') || 'red';
        const cBlue = window.getCSSColor('--accent-blue') || 'blue';
        const colors = this.currentParetoFront.map((_, i) => i === this.selectedParetoIndex ? cDanger : cBlue);
        
        // Slightly larger for 3D so they are visible
        const baseSizes = this.currentParetoFront.map((_, i) => i === this.selectedParetoIndex ? 12 : 8);
        const sizes = numObjs >= 3 ? baseSizes.map(s => s * 0.7) : baseSizes;

        if (updateOnlyColors) {
            const graphDiv = document.getElementById('opt-pareto-graph');
            if (graphDiv && graphDiv.data && graphDiv.data.length > 0) {
                Plotly.restyle(graphDiv, {
                    'marker.color': [colors],
                    'marker.size': [sizes]
                }, [0]);
                return;
            }
        }

        const obj1Name = config.globalObjectives[0] ? `Obj 1: ${config.globalObjectives[0].formula}` : 'Objective 1';
        const obj2Name = config.globalObjectives[1] ? `Obj 2: ${config.globalObjectives[1].formula}` : 'Objective 2';
        const obj3Name = config.globalObjectives[2] ? `Obj 3: ${config.globalObjectives[2].formula}` : 'Objective 3';

        const xData = this.currentParetoFront.map(sol => sol.objectives[0]);
        const yData = numObjs > 1 ? this.currentParetoFront.map(sol => sol.objectives[1]) : this.currentParetoFront.map((_, i) => i);
        const zData = numObjs > 2 ? this.currentParetoFront.map(sol => sol.objectives[2]) : null;

        const hoverTexts = this.currentParetoFront.map((sol, i) => {
            let txt = `<b>Solution ${i}</b><br>`;
            config.globalObjectives.forEach((go, j) => {
                let val = sol.objectives[j];
                txt += `Obj ${j+1} (${go.formula}): ${val.toExponential(3)}<br>`;
            });
            return txt;
        });

        const tc = window.getPlotThemeColors();
        let traces = [];
        let layout = {};

        if (numObjs >= 3) {
            traces = [{
                x: xData, y: yData, z: zData,
                mode: 'markers',
                type: 'scatter3d',
                marker: { color: colors, size: sizes, line: { color: '#ffffff', width: 1 } },
                text: hoverTexts,
                hoverinfo: 'text',
                name: 'Pareto Front'
            }];
            layout = {
                paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
                scene: {
                    xaxis: { title: obj1Name, gridcolor: tc.grid, zerolinecolor: tc.grid, backgroundcolor: tc.bg },
                    yaxis: { title: obj2Name, gridcolor: tc.grid, zerolinecolor: tc.grid, backgroundcolor: tc.bg },
                    zaxis: { title: obj3Name, gridcolor: tc.grid, zerolinecolor: tc.grid, backgroundcolor: tc.bg }
                },
                margin: { t: 30, r: 20, l: 20, b: 20 },
                showlegend: false
            };
        } else {
            traces = [{
                x: xData, y: yData,
                mode: 'markers',
                type: 'scatter',
                marker: { color: colors, size: sizes, line: { color: '#ffffff', width: 1 } },
                text: hoverTexts,
                hoverinfo: 'text',
                name: 'Pareto Front'
            }];
            layout = {
                paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
                xaxis: { title: obj1Name, gridcolor: tc.grid, zerolinecolor: tc.grid },
                yaxis: { title: obj2Name, gridcolor: tc.grid, zerolinecolor: tc.grid },
                margin: { t: 30, r: 20, l: 50, b: 40 },
                showlegend: false
            };
        }

        Plotly.react('opt-pareto-graph', traces, layout);
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['opt-pareto-graph'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    drawResponsePlot(config) {
        const traces = [];
        const xTitle = config.sim.mode === 'theta' ? 'Angle (deg)' : 'Wavelength (nm)';
        
        let primaryMetric = 'R';
        const validMetric = config.metrics.find(m => ['R', 'T', 'A'].includes(m.type) || m.type === 'curvefit');
        if (validMetric) {
            primaryMetric = validMetric.type === 'curvefit' ? (validMetric.curvefitParam || 'R') : validMetric.type;
        }

        if (this.initialResponse) {
            traces.push({
                x: Array.from(this.initialResponse.x),
                y: Array.from(this.initialResponse[primaryMetric]),
                name: `Initial (${primaryMetric})`,
                type: 'scatter',
                line: { color: 'rgba(148, 163, 184, 0.5)', width: 2, dash: 'dash' }
            });
        }

        if (this.compareParetoIndices && this.compareParetoIndices.size > 0 && this.currentParetoFront) {
            this.compareParetoIndices.forEach(idx => {
                if (idx !== this.selectedParetoIndex && this.currentParetoFront[idx]) {
                    traces.push({
                        x: Array.from(this.currentParetoFront[idx].response.x),
                        y: Array.from(this.currentParetoFront[idx].response[primaryMetric] || this.currentParetoFront[idx].response.R),
                        name: `Sol ${idx} (${primaryMetric})`,
                        type: 'scatter',
                        line: { color: 'rgba(16, 185, 129, 0.7)', width: 2, dash: 'dot' }
                    });
                }
            });
        }

        if (this.bestResponse) {
            let traceName = `Optimized (${primaryMetric})`;
            if (this.selectedParetoIndex !== undefined) {
                traceName = `Optimized - Sol ${this.selectedParetoIndex} (${primaryMetric})`;
            }
            traces.push({
                x: this.bestResponse.x,
                y: this.bestResponse[primaryMetric],
                name: traceName,
                type: 'scatter',
                line: { color: window.getCSSColor('--layer-tio2') || 'rgba(139, 92, 246, 1)', width: 3 }
            });
        }

        const curveFitMetrics = config.metrics.filter(m => m.type === 'curvefit');
        if (curveFitMetrics.length > 0 && this.initialResponse) {
            curveFitMetrics.forEach(m => {
                const targetComps = config.targetComponentsMap[m.id] || [];
                if (targetComps.length > 0) {
                    const yTarget = Array.from(this.initialResponse.x).map(x => evaluateTargetModel(x, targetComps));
                    traces.push({
                        x: Array.from(this.initialResponse.x),
                        y: yTarget,
                        name: `Target Curve (${m.id})`,
                        type: 'scatter',
                        line: { color: 'rgba(16, 185, 129, 0.7)', width: 2, dash: 'dot' }
                    });
                }
            });
        }
        const tc = window.getPlotThemeColors();
        const layout = {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: xTitle, gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: primaryMetric, gridcolor: tc.grid, zerolinecolor: tc.grid, range: [0, 1.05] },
            margin: { t: 30, r: 20, l: 50, b: 40 },
            showlegend: true,
            legend: { x: 0, y: 1, bgcolor: 'rgba(0,0,0,0.5)' }
        };

        Plotly.react('opt-response-graph', traces, layout);
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['opt-response-graph'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    drawConvergencePlot() {
        if (!this.convergenceHistory || this.convergenceHistory.x.length === 0) return;

        const hasNegativeOrZero = this.convergenceHistory.y.some(v => v <= 0);
        const yData = hasNegativeOrZero ? this.convergenceHistory.y : this.convergenceHistory.y.map(v => Math.max(1e-10, v));
        const yType = hasNegativeOrZero ? 'linear' : 'log';

        const traces = [{
            x: this.convergenceHistory.x,
            y: yData,
            name: 'Optimized Fitness',
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: window.getCSSColor('--color-success'), width: 2 },
            marker: { size: 6, color: window.getCSSColor('--accent-blue') }
        }];
        const tc = window.getPlotThemeColors();
        const layout = {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: 'Generation', gridcolor: tc.grid, zerolinecolor: tc.grid, rangemode: 'tozero' },
            yaxis: { title: 'Fitness Error (Lower is Better)', type: yType, gridcolor: tc.grid, zerolinecolor: tc.grid, exponentformat: 'e' },
            margin: { t: 30, r: 20, l: 60, b: 40 },
            showlegend: false
        };

        Plotly.react('opt-convergence-graph', traces, layout);
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['opt-convergence-graph'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    renderObjectivesComparison(config) {
        if (!this.initialObjectivesInfo || !this.bestGenomeRaw) return;
        
        const container = document.getElementById('opt-objectives-comparison');
        const list = document.getElementById('opt-objectives-list');
        list.innerHTML = '';
        
        try {
            const evaluator = new Evaluator(config);
            const evaluation = evaluator.evaluateGenome(this.bestGenomeRaw);
            
            if (config.metrics && config.metrics.length > 0 && this.initialMetricValues) {
                list.insertAdjacentHTML('beforeend', `<div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 5px; font-weight: bold;"><i class="fa-solid fa-chart-bar"></i> Metrics</div>`);
                config.metrics.forEach((m, i) => {
                    const initM = this.initialMetricValues[i];
                    const finalM = evaluation.metricValues[i];
                    
                    const mHtml = `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card); padding: 4px 15px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 4px; font-size: 0.9rem;">
                            <span style="font-family: monospace; color: var(--text-muted);">M${i+1} (${m.type})</span>
                            <div style="display: flex; gap: 15px; align-items: center;">
                                <span style="color: var(--text-muted);">Initial: <strong style="color: var(--text-main);">${initM.toExponential(3)}</strong></span>
                                <span style="color: var(--text-muted);"><i class="fa-solid fa-arrow-right"></i></span>
                                <span style="color: var(--text-main);">Final: <strong>${finalM.toExponential(3)}</strong></span>
                            </div>
                        </div>
                    `;
                    list.insertAdjacentHTML('beforeend', mHtml);
                });
                
                if (config.globalObjectives && config.globalObjectives.length > 0) {
                    list.insertAdjacentHTML('beforeend', `<div style="height: 1px; background: var(--border-color); margin: 4px 0;"></div>`);
                }
            }
            
            const finalObjectivesRaw = config.globalObjectives.map((go, i) => {
                let val = 1e6;
                try { val = evaluator.globalObjectives[i].func(...evaluation.metricValues); } catch(e) {}
                return val;
            });
            
            if (this.initialObjectivesInfo && this.initialObjectivesInfo.length > 0) {
                list.insertAdjacentHTML('beforeend', `<div style="font-size: 0.8rem; color: var(--accent-blue); margin: 10px 0 5px 0; font-weight: bold;"><i class="fa-solid fa-bullseye"></i> Global Objectives</div>`);
            }
            
            this.initialObjectivesInfo.forEach((initObj, i) => {
                const finalVal = finalObjectivesRaw[i];
                const isMax = initObj.goal === 'max';
                
                let color = 'var(--text-main)';
                if (initObj.val !== 1e6 && finalVal !== 1e6) {
                    if ((isMax && finalVal > initObj.val) || (!isMax && finalVal < initObj.val)) {
                        color = 'var(--accent-green)';
                    } else if (finalVal === initObj.val) {
                        color = 'var(--text-muted)';
                    } else {
                        color = '#ef4444';
                    }
                }
                
                const html = `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-main); padding: 8px 15px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <span style="font-family: monospace; color: var(--text-muted);">${initObj.formula} (${initObj.goal})</span>
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <span style="color: var(--text-muted);">Initial: <strong style="color: var(--text-main);">${initObj.val.toExponential(3)}</strong></span>
                            <span style="color: ${color};"><i class="fa-solid fa-arrow-right"></i></span>
                            <span style="color: ${color};">Final: <strong>${finalVal.toExponential(3)}</strong></span>
                        </div>
                    </div>
                `;
                list.insertAdjacentHTML('beforeend', html);
            });
            
            container.style.display = 'flex';
        } catch(e) {
            console.error("Failed to render objective comparison", e);
        }
        document.getElementById('btn-export-population').addEventListener('click', () => {
            if (!this.populationHistory || this.populationHistory.length === 0) return;
            
            // Build CSV
            let csv = "Generation,AgentIndex,Fitness,";
            
            // Variables headers
            const vars = [];
            document.querySelectorAll('.var-checkbox:checked').forEach(el => {
                vars.push(el.nextElementSibling.innerText);
            });
            csv += vars.join(",") + "\n";
            
            this.populationHistory.forEach(h => {
                h.pop.forEach((agent, i) => {
                    csv += `${h.gen},${i},${agent.fitness},`;
                    csv += agent.genome.join(",") + "\n";
                });
            });
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'optimization_population_history.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

    }
};



