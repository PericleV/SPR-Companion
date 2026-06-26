import { GeometryManager } from './tab2Geometry.js?v=50';
import { simulateTMM } from '../core/tmm2x2Engine.js?v=50';
import { MaterialsDB } from '../core/materials_database.js?v=50';

// Compact Nelder-Mead implementation for Auto-Fit
const nelderMead = (f, x0, tol = 1e-5, maxIter = 1000) => {
    const n = x0.length;
    let p = [x0.slice()];
    for (let i = 0; i < n; i++) {
        let x = x0.slice();
        x[i] = x[i] ? x[i] * 1.05 : 0.001;
        p.push(x);
    }
    let y = p.map(f);
    
    for (let iter = 0; iter < maxIter; iter++) {
        let indices = y.map((val, idx) => idx).sort((a, b) => y[a] - y[b]);
        p = indices.map(i => p[i]);
        y = indices.map(i => y[i]);
        if (Math.abs(y[n] - y[0]) < tol) break;
        
        let pBar = new Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pBar[j] += p[i][j] / n;
        
        let pStar = pBar.map((val, j) => val + 1 * (val - p[n][j]));
        let yStar = f(pStar);
        
        if (yStar < y[n-1] && yStar >= y[0]) { p[n] = pStar; y[n] = yStar; continue; }
        if (yStar < y[0]) {
            let pStarStar = pBar.map((val, j) => val + 2 * (pStar[j] - val));
            let yStarStar = f(pStarStar);
            if (yStarStar < yStar) { p[n] = pStarStar; y[n] = yStarStar; } else { p[n] = pStar; y[n] = yStar; }
            continue;
        }
        
        let pStarStar = pBar.map((val, j) => val - 0.5 * (val - p[n][j]));
        let yStarStar = f(pStarStar);
        if (yStarStar < y[n]) { p[n] = pStarStar; y[n] = yStarStar; } else {
            for (let i = 1; i <= n; i++) {
                p[i] = p[i].map((val, j) => p[0][j] + 0.5 * (val - p[0][j]));
                y[i] = f(p[i]);
            }
        }
    }
    return p[0];
};

export const SimulationManager = {
    worker: null,
    fieldWorker: null, 
    lastWorkerData: null,
    lastFieldData: null, // Stores field status for exports
    fitComponents: [], 
    currentStats: null, 
    sensData: null, 

    // UI Overlay states
    showResOverlay: false,
    showFwhmOverlay: false,
    showDbrCenterOverlay: false,
    showDbrBandgapOverlay: false,
    showSensOverlay: false,
    showFieldOverlay: false, 

    getSafeData(dataObj, metric) {
        if (!dataObj) return null;
        if (dataObj[metric] !== undefined) return dataObj[metric];
        if (dataObj[metric.toLowerCase()] !== undefined) return dataObj[metric.toLowerCase()];
        if (dataObj[metric.toUpperCase()] !== undefined) return dataObj[metric.toUpperCase()];
        return null;
    },

    syncMaterialsDB() {
        try {
            const savedDB = localStorage.getItem('plasmonic_materials');
            if (savedDB) {
                const parsed = JSON.parse(savedDB);
                const predefined = ['BK7', 'SiO2', 'TiO2', 'Air', 'H2O', 'Au', 'Ag', 'Graphene'];
                for (const key in MaterialsDB) {
                    if (!predefined.includes(key)) delete MaterialsDB[key];
                }
                Object.assign(MaterialsDB, parsed); 
            }
        } catch (e) { console.error("Error synchronizing MaterialsDB in Tab3:", e); }
    },

    init(workerInstance) {
        this.worker = workerInstance;
        this.worker.onerror = (e) => {
            console.error("Simulation Worker Error:", e);
            alert("A critical error occurred in the simulation worker. See console for details.");
            const btn = document.getElementById('btn-run-sim');
            if(btn) {
                btn.innerHTML = '<i class="fa-solid fa-play"></i> Run Simulation';
                btn.disabled = false;
            }
        };
        this.syncMaterialsDB();
        
        // Instantiate a separate worker for Electric Field calculation
        this.fieldWorker = new Worker('./js/workers/Edistribution.worker.js?v=50');
        this.fieldWorker.onmessage = (e) => {
            this.lastFieldData = e.data;
            this.renderFieldPlot(e.data);
        };
        this.fieldWorker.onerror = (e) => {
            console.error("Field Worker Error:", e);
            alert("An error occurred during field computation. See console for details.");
        };

        this.container = document.getElementById('simulation-container');
        this.render();
        this.attachEvents();

        // Listen to updates from Tab 1 and Tab 2
        document.addEventListener('materialsUpdated', () => {
            this.syncMaterialsDB();
            this.showSyncWarning();
        });
        document.addEventListener('geometryUpdated', () => {
            this.showSyncWarning();
        });
    },

    showSyncWarning() {
        const warning = document.getElementById('sim-sync-warning');
        if (warning && this.lastWorkerData) {
            warning.style.display = 'block';
        }
    },

    hideSyncWarning() {
        const warning = document.getElementById('sim-sync-warning');
        if (warning) warning.style.display = 'none';
    },

    render() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 20px; height: 100%; overflow: hidden;">
                
                <div id="sim-sync-warning" class="bg-warning text-main" style="display: none; padding: 10px; border-radius: 6px; margin-bottom: 0px; border: 1px solid var(--color-warning-alt); flex-shrink: 0; font-size: 0.9rem;">
                    <i class="fa-solid fa-triangle-exclamation"></i> Stack configuration changed. Results may be out of date. Please re-run the simulation.
                </div>

                <!-- TOP Section: Horizontal Parameters -->
                <div style="background: var(--bg-card); padding: 15px 20px; border-radius: 12px; border: 1px solid var(--border-color); display: flex; gap: 15px; align-items: flex-end; flex-wrap: wrap; flex-shrink: 0;">
                    <div style="flex: 1; min-width: 140px;">
                        <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Scan Mode <span class="custom-tooltip" data-tooltip="Angle scan varies the angle of incidence at a fixed wavelength. Spectrum scan varies the wavelength at a fixed angle.">?</span></label>
                        <select id="sim-scan-type" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                            <option value="theta">SPR Scan (Angle)</option>
                            <option value="lambda">LSPR / DBR Scan (Spectrum)</option>
                        </select>
                    </div>

                    <div style="flex: 1; min-width: 90px;">
                        <label id="label-sim-start" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Min (deg) <span class="custom-tooltip" data-tooltip="Starting value for the sweep.">?</span></label>
                        <input type="number" id="sim-start" value="0" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                    </div>
                    
                    <div style="flex: 1; min-width: 90px;">
                        <label id="label-sim-end" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Max (deg) <span class="custom-tooltip" data-tooltip="Ending value for the sweep.">?</span></label>
                        <input type="number" id="sim-end" value="90" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                    </div>

                    <div style="flex: 1; min-width: 90px;">
                        <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Resolution (Steps) <span class="custom-tooltip" data-tooltip="Number of data points to compute. Higher values give smoother curves but take longer.">?</span></label>
                        <input type="number" id="sim-steps" value="500" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                    </div>

                    <div style="flex: 1; min-width: 120px;">
                        <label id="label-sim-fixed" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Wavelength (nm) <span class="custom-tooltip" data-tooltip="The fixed parameter value during the scan.">?</span></label>
                        <input type="number" id="sim-fixed-val" value="633" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                    </div>

                    <div style="flex: 1; min-width: 100px;">
                        <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Polarization <span class="custom-tooltip" data-tooltip="TM (p-polarized) light is required to excite surface plasmons. TE (s-polarized) does not excite SPR but is useful for dielectric DBRs.">?</span></label>
                        <select id="sim-polarization" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                            <option value="TM">TM (p-pol)</option>
                            <option value="TE">TE (s-pol)</option>
                        </select>
                    </div>

                    <div style="flex: 1; min-width: 120px;">
                        <button id="btn-run-sim" style="width: 100%; background: var(--accent-blue); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.2s;"><i class="fa-solid fa-play"></i> Simulate</button>
                    </div>
                </div>

                <!-- MAIN Section: Left Toolbar & Right Graphs -->
                <div class="mobile-stack-row" style="display: flex; gap: 20px; flex: 1; min-height: 0;">
                    
                    <!-- Analysis Sidebar -->
                    <div class="mobile-col-full" style="width: 360px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; padding-right: 5px;">
                        
                        <!-- Data Analysis -->
                        <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color);">
                            <h3 style="color: var(--text-main); margin-bottom: 10px; font-size: 1.1rem;"><i class="fa-solid fa-chart-line"></i> Analysis & Metrics</h3>
                            <select id="analysis-trace" style="width: 100%; padding: 8px; margin-bottom: 15px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                <option value="R">Reflectance</option>
                                <option value="T">Transmittance</option>
                                <option value="A">Absorbance</option>
                                <option value="phaseR">Reflection Phase</option>
                                <option value="phaseT">Transmission Phase</option>
                            </select>
                            
                            <!-- Metric Tabs (SPR vs DBR) -->
                            <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                                <button id="tab-btn-spr" class="metric-tab active" style="flex: 1; padding: 8px; background: var(--accent-blue); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">SPR Metrics (Dip)</button>
                                <button id="tab-btn-dbr" class="metric-tab" style="flex: 1; padding: 8px; background: var(--bg-main); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">DBR Metrics (Peak)</button>
                            </div>

                            <!-- SPR Metrics Panel -->
                            <div id="panel-spr" style="background: var(--bg-main); padding: 10px; border-radius: 6px; font-size: 0.9rem; color: var(--text-main); margin-bottom: 15px;">
                                <div id="spr-stats-text" style="color: var(--accent-green); margin-bottom: 10px;">Run simulation for statistics.</div>
                                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem;">
                                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="chk-res-overlay"> Show Resonance Position (Dip)
                                    </label>
                                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="chk-fwhm-overlay"> Show Resonance Width (FWHM)
                                    </label>
                                </div>
                            </div>

                            <!-- DBR Metrics Panel -->
                            <div id="panel-dbr" style="display: none; background: var(--bg-main); padding: 10px; border-radius: 6px; font-size: 0.9rem; color: var(--text-main); margin-bottom: 15px;">
                                <div id="dbr-stats-text" style="color: #fbbf24; margin-bottom: 10px;">Run simulation for DBR statistics.</div>
                                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem;">
                                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="chk-dbr-center"> Show Band Center (Peak)
                                    </label>
                                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="chk-dbr-bandgap"> Show Bandgap Width (&Delta;&lambda;)
                                    </label>
                                </div>
                            </div>

                            <!-- Electric Field Calculation Button -->
                            <button id="btn-show-field" style="width: 100%; background: #3b82f6; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 15px;">
                                <i class="fa-solid fa-bolt"></i> Calculate Field Distribution |E|²
                            </button>
                            
                            <!-- Sensitivity -->
                            <div style="background: var(--bg-main); padding: 10px; border-radius: 6px;">
                                <label style="font-size: 0.8rem; color: var(--text-muted);">Sensitivity (Shift / Δn)</label>
                                <div style="display: flex; gap: 10px; margin-top: 5px;">
                                    <input type="number" id="sens-delta-n" value="0.005" step="0.001" style="width: 40%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    <select id="sens-layer" style="width: 60%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></select>
                                </div>
                                <button id="btn-calc-sens" style="width: 100%; margin-top: 10px; background: var(--bg-card-hover); color: var(--text-main); border: none; padding: 6px; border-radius: 4px; cursor: pointer; transition: 0.2s;">Calculate S</button>
                                <div id="sens-result" style="margin-top: 8px; font-size: 0.85rem; color: #fbbf24;"></div>
                                <div style="margin-top: 8px; font-size: 0.8rem;">
                                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="chk-sens-overlay" disabled> Show shifted curve (Sensitivity)
                                    </label>
                                </div>
                            </div>
                        </div>

                        <!-- Mathematical Fitting -->
                        <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color);">
                            <h3 style="color: var(--text-main); margin-bottom: 10px; font-size: 1.1rem;"><i class="fa-solid fa-square-root-variable"></i> Mathematical Fitting</h3>
                            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                                <select id="fit-type" style="flex: 1; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    <option value="lorentz">Lorentz</option><option value="fano">Fano</option><option value="coupled">Coupled Oscillators</option>
                                </select>
                                <button id="btn-add-fit" style="background: var(--accent-green); color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-plus"></i></button>
                            </div>
                            
                            <div id="fit-components-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 200px; overflow-y: auto;"></div>
                            
                            <div style="display: flex; gap: 10px; margin-top: 15px;">
                                <button id="btn-auto-fit" style="flex: 1; background: #9333ea; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; transition: 0.2s;">Auto-Fit (NM)</button>
                            </div>
                        </div>
                    </div>

                    <!-- Graph Container (Principal & Field) -->
                    <div class="mobile-col-full" style="flex: 1; display: flex; flex-direction: column; gap: 25px; overflow-y: auto; padding-right: 15px; padding-bottom: 20px;">
                        
                        <!-- Main Graph -->
                        <div style="flex: 0 0 400px; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column; padding: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
                                <h4 style="color: var(--text-main); margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-chart-area"></i> Optical Response</h4>
                                <div style="display: flex; gap: 10px;">
                                    <button id="btn-export-main" style="background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s;" title="Download graph data (CSV)"><i class="fa-solid fa-download"></i> Export CSV</button>
                                </div>
                            </div>
                            <div id="analysis-graph" style="flex: 1; width: 100%; background: var(--bg-main); border-radius: 8px;"></div>
                        </div>

                        <!-- Field Profile Graph (Hidden by default) -->
                        <div id="field-graph-container" style="display: none; flex: 0 0 400px; position: relative; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); padding: 15px; flex-direction: column; margin-top: 5px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                                <div style="display: flex; align-items: center; gap: 15px;">
                                    <h4 id="field-title-label" style="color: var(--text-main); margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-bolt"></i> Electric Field Distribution |E|²</h4>
                                    <div id="field-metrics-container" style="display: flex; gap: 10px; font-size: 0.9rem; font-weight: bold;"></div>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                                    <div style="display: flex; gap: 10px; align-items: center; background: var(--bg-main); padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                                        <input type="checkbox" id="field-show-lp" checked style="cursor: pointer;">
                                        <label for="field-show-lp" style="font-size: 0.8rem; color: var(--text-muted); cursor: pointer;"><i class="fa-solid fa-ruler-horizontal"></i> Show Lp</label>
                                    </div>
                                    <div style="display: flex; gap: 10px; align-items: center; background: var(--bg-main); padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                                        <label style="font-size: 0.8rem; color: var(--text-muted);"><i class="fa-solid fa-crosshairs"></i> Evaluate at X:</label>
                                        <input type="number" id="field-eval-x" value="45" step="0.1" style="width: 75px; padding: 4px 8px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Evaluation point (deg / nm)">
                                    </div>
                                    <div style="display: flex; gap: 10px; align-items: center; background: var(--bg-main); padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                                        <label style="font-size: 0.8rem; color: var(--text-muted);"><i class="fa-solid fa-arrows-left-right"></i> Depth (nm):</label>
                                        <input type="number" id="field-z-min" data-auto="true" style="width: 75px; padding: 4px 8px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Start (Incident Medium)">
                                        <span style="color: var(--text-muted);">to</span>
                                        <input type="number" id="field-z-max" data-auto="true" style="width: 75px; padding: 4px 8px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Stop (Substrate)">
                                    </div>
                                    <div style="display: flex; gap: 10px; align-items: center; background: var(--bg-main); padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                                        <label style="font-size: 0.8rem; color: var(--text-muted);">Component:</label>
                                        <select id="field-component-select" style="padding: 4px 8px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                            <option value="e_tot" selected>|E|² (Total Electric)</option>
                                            <option value="ex">|Ex|²</option>
                                            <option value="ey">|Ey|²</option>
                                            <option value="ez">|Ez|²</option>
                                            <option value="h_tot">|H|² (Total Magnetic)</option>
                                            <option value="hx">|Hx|²</option>
                                            <option value="hy">|Hy|²</option>
                                            <option value="hz">|Hz|²</option>
                                            <option value="sz">Poynting (Sz)</option>
                                        </select>
                                    </div>
                                    <button id="btn-recalc-field" style="background: var(--bg-main); color: var(--accent-green); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s;" title="Recalculate"><i class="fa-solid fa-rotate-right"></i> Recalc</button>
                                    <button id="btn-export-field" style="background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s;" title="Download field data (CSV)"><i class="fa-solid fa-download"></i> Export CSV</button>
                                </div>
                            </div>
                            <div id="field-graph" style="flex: 1; width: 100%; background: var(--bg-main); border-radius: 8px;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    attachEvents() {
        document.getElementById('sim-scan-type').addEventListener('change', (e) => {
            const scanMode = e.target.value;
            const lblStart = document.getElementById('label-sim-start');
            const lblEnd = document.getElementById('label-sim-end');
            const lblFixed = document.getElementById('label-sim-fixed');
            const inputStart = document.getElementById('sim-start');
            const inputEnd = document.getElementById('sim-end');
            const inputFixed = document.getElementById('sim-fixed-val');

            if (scanMode === 'theta') {
                lblStart.innerText = 'Min (deg)';
                lblEnd.innerText = 'Max (deg)';
                lblFixed.innerText = 'Fixed Lambda (nm)';
                inputStart.value = 0;
                inputEnd.value = 90;
                inputFixed.value = 633;
                
                document.getElementById('tab-btn-spr').click();
            } else {
                lblStart.innerText = 'Min (nm)';
                lblEnd.innerText = 'Max (nm)';
                lblFixed.innerText = 'Fixed Angle (deg)';
                inputStart.value = 400;
                inputEnd.value = 1000;
                inputFixed.value = 0; 
                
                document.getElementById('tab-btn-dbr').click();
            }
        });

        document.getElementById('btn-run-sim').addEventListener('click', () => this.runSimulation());
        
        document.getElementById('analysis-trace').addEventListener('change', () => {
            this.updateAnalysisStats();
            this.drawAnalysisGraph();
            
            if (this.lastWorkerData) {
                const configName = `Sim_${Date.now().toString().slice(-4)}`;
                const metric = document.getElementById('analysis-trace').value;
                const yData = this.getSafeData(this.lastWorkerData.data, metric);
                if (yData) {
                    window.SimulationHistory = window.SimulationHistory || {};
                    window.SimulationHistory[configName] = {
                        name: configName,
                        x: Array.from(this.lastWorkerData.data.x),
                        y: Array.from(yData),
                        metric: metric,
                        variable: this.lastWorkerData.variable,
                        polarization: document.getElementById('sim-polarization').value,
                        layers: JSON.parse(JSON.stringify(GeometryManager.layers))
                    };
                }
            }
        });

        document.getElementById('btn-calc-sens').addEventListener('click', () => this.calculateSensitivity());
        
        document.getElementById('btn-add-fit').addEventListener('click', () => {
            const type = document.getElementById('fit-type').value;
            this.addFitComponent(type);
        });

        document.getElementById('btn-auto-fit').addEventListener('click', () => this.runAutoFit());

        // Tab Switching Logic (SPR vs DBR)
        const btnSpr = document.getElementById('tab-btn-spr');
        const btnDbr = document.getElementById('tab-btn-dbr');
        const pnlSpr = document.getElementById('panel-spr');
        const pnlDbr = document.getElementById('panel-dbr');

        btnSpr.addEventListener('click', () => {
            btnSpr.style.background = 'var(--accent-blue)';
            btnSpr.style.color = 'white';
            btnSpr.style.border = 'none';
            btnDbr.style.background = 'var(--bg-main)';
            btnDbr.style.color = 'var(--text-muted)';
            btnDbr.style.border = '1px solid var(--border-color)';
            pnlSpr.style.display = 'block';
            pnlDbr.style.display = 'none';
        });

        btnDbr.addEventListener('click', () => {
            btnDbr.style.background = '#fbbf24'; 
            btnDbr.style.color = '#000';
            btnDbr.style.border = 'none';
            btnSpr.style.background = 'var(--bg-main)';
            btnSpr.style.color = 'var(--text-muted)';
            btnSpr.style.border = '1px solid var(--border-color)';
            pnlDbr.style.display = 'block';
            pnlSpr.style.display = 'none';
        });

        // Overlay Checkboxes (SPR)
        document.getElementById('chk-res-overlay').addEventListener('change', e => {
            this.showResOverlay = e.target.checked;
            this.drawAnalysisGraph();
        });
        document.getElementById('chk-fwhm-overlay').addEventListener('change', e => {
            this.showFwhmOverlay = e.target.checked;
            this.drawAnalysisGraph();
        });

        // Overlay Checkboxes (DBR)
        document.getElementById('chk-dbr-center').addEventListener('change', e => {
            this.showDbrCenterOverlay = e.target.checked;
            this.drawAnalysisGraph();
        });
        document.getElementById('chk-dbr-bandgap').addEventListener('change', e => {
            this.showDbrBandgapOverlay = e.target.checked;
            this.drawAnalysisGraph();
        });

        document.getElementById('chk-sens-overlay').addEventListener('change', e => {
            this.showSensOverlay = e.target.checked;
            this.drawAnalysisGraph();
        });

        // Electric Field Button
        const btnField = document.getElementById('btn-show-field');
        btnField.addEventListener('click', () => {
            this.showFieldOverlay = !this.showFieldOverlay;
            if (this.showFieldOverlay) {
                btnField.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Hide Field Distribution';
                btnField.style.background = '#ef4444'; 
                this.triggerFieldWorker();
            } else {
                btnField.innerHTML = '<i class="fa-solid fa-bolt"></i> Calculate Field Distribution |E|²';
                btnField.style.background = '#3b82f6';
                document.getElementById('field-graph-container').style.display = 'none';
                Plotly.Plots.resize('analysis-graph');
            }
        });

        // Field Controls
        document.getElementById('field-eval-x').addEventListener('change', () => {
            if (this.lastFieldData) this.renderFieldPlot(this.lastFieldData);
        });
        document.getElementById('field-show-lp').addEventListener('change', () => {
            if (this.lastFieldData) this.renderFieldPlot(this.lastFieldData);
        });

        document.getElementById('btn-export-field').addEventListener('click', () => { if(this.showFieldOverlay) this.triggerFieldWorker(); });
        
        const zMinInput = document.getElementById('field-z-min');
        const zMaxInput = document.getElementById('field-z-max');
        zMinInput.addEventListener('input', () => { zMinInput.removeAttribute('data-auto'); });
        zMaxInput.addEventListener('input', () => { zMaxInput.removeAttribute('data-auto'); });

        zMinInput.addEventListener('change', () => { if(this.showFieldOverlay) this.triggerFieldWorker(); });
        zMaxInput.addEventListener('change', () => { if(this.showFieldOverlay) this.triggerFieldWorker(); });

        document.getElementById('btn-recalc-field').addEventListener('click', () => { if(this.showFieldOverlay) this.triggerFieldWorker(); });
        document.getElementById('field-component-select').addEventListener('change', () => { if(this.showFieldOverlay) this.triggerFieldWorker(); });

        // CSV Export Events
        document.getElementById('btn-export-main').addEventListener('click', () => this.exportMainGraphCSV());
        document.getElementById('btn-export-field').addEventListener('click', () => this.exportFieldGraphCSV());
    },

    getEvaluatedLayers(lambda) {
        this.syncMaterialsDB(); 
        return GeometryManager.layers.map(layer => {
            const matInfo = MaterialsDB[layer.material];
            if (!matInfo) return { d: layer.d, n: 1.5, k: 0, color: layer.color, label: layer.label };
            
            let n = matInfo.n !== undefined ? matInfo.n : 1.5;
            let k = matInfo.k !== undefined ? matInfo.k : 0;

            if (matInfo.type === 'dispersive' && matInfo.data) {
                const mat = matInfo.data;
                if (mat.length === 0) {
                    n = 1.5; k = 0;
                } else if (lambda <= mat[0].w) { n = mat[0].n; k = mat[0].k; }
                else if (lambda >= mat[mat.length-1].w) { n = mat[mat.length-1].n; k = mat[mat.length-1].k; }
                else {
                    for(let j=0; j<mat.length-1; j++) {
                        if(lambda >= mat[j].w && lambda <= mat[j+1].w) {
                            const diff = mat[j+1].w - mat[j].w;
                            const t = diff === 0 ? 0 : (lambda - mat[j].w)/diff;
                            n = mat[j].n + t*(mat[j+1].n - mat[j].n);
                            k = mat[j].k + t*(mat[j+1].k - mat[j].k);
                            break;
                        }
                    }
                }
            }
            return { d: layer.d, n: n, k: k, color: layer.color, label: layer.label || layer.material };
        });
    },

    runSimulation() {
        this.syncMaterialsDB(); 
        
        const start = parseFloat(document.getElementById('sim-start').value);
        const end = parseFloat(document.getElementById('sim-end').value);
        const steps = parseInt(document.getElementById('sim-steps').value, 10);
        const variable = document.getElementById('sim-scan-type').value;
        const fixedParam = parseFloat(document.getElementById('sim-fixed-val').value);
        const polarization = document.getElementById('sim-polarization').value;

        if (isNaN(start) || isNaN(end) || isNaN(steps) || isNaN(fixedParam) || steps <= 0) {
            alert("Please enter valid numerical values for the simulation parameters.");
            return;
        }

        this.hideSyncWarning();
        this.sensData = null;
        document.getElementById('sens-result').innerHTML = '';
        document.getElementById('chk-sens-overlay').disabled = true;
        document.getElementById('chk-sens-overlay').checked = false;
        this.showSensOverlay = false;

        const sensSel = document.getElementById('sens-layer');
        sensSel.innerHTML = '';
        GeometryManager.layers.forEach((l, i) => { sensSel.innerHTML += `<option value="${i}">Layer ${i} (${l.material})</option>`; });
        sensSel.value = GeometryManager.layers.length - 1; 

        const processedLayers = GeometryManager.layers.map(layer => {
            const matInfo = MaterialsDB[layer.material];
            if (!matInfo) return { d: layer.d, material: layer.material, isDispersive: false, n: 1.5, k: 0, dispersionData: null, type: layer.type, ff: layer.ff };
            
            const isDispersive = matInfo.type === 'dispersive';
            return { 
                d: layer.d, 
                material: layer.material, 
                isDispersive: isDispersive, 
                n: isDispersive ? null : matInfo.n, 
                k: isDispersive ? null : matInfo.k, 
                dispersionData: isDispersive ? matInfo.data : null,
                type: layer.type,
                ff: layer.ff
            };
        });

        this.worker.postMessage({ type: 'simulate1D', payload: { start, end, steps, variable, fixedParam, polarization, layers: processedLayers, materialsDB: MaterialsDB } });
    },

    handleWorkerResult(data) {
        this.lastWorkerData = data;
        
        // Automatic field evaluation point setup
        const variable = document.getElementById('sim-scan-type').value;
        const rData = this.getSafeData(data.data, 'R'); 
        if (rData) {
            const isSPR = document.getElementById('panel-spr').style.display !== 'none';
            if (variable === 'theta' || isSPR) {
                let minR = Infinity, minIdx = 0;
                for(let i=0; i<rData.length; i++) {
                    if (Number.isFinite(rData[i]) && rData[i] < minR) { minR = rData[i]; minIdx = i; }
                }
                const dipX = data.data.x[minIdx] || 0;
                document.getElementById('field-eval-x').value = dipX.toFixed(3);
            } else {
                let maxR = -Infinity, maxIdx = 0;
                for(let i=0; i<rData.length; i++) {
                    if (Number.isFinite(rData[i]) && rData[i] > maxR) { maxR = rData[i]; maxIdx = i; }
                }
                const peakX = data.data.x[maxIdx] || 0;
                document.getElementById('field-eval-x').value = peakX.toFixed(3);
            }
        }

        this.updateAnalysisStats();
        this.drawAnalysisGraph();
        
        // Save successfully simulated curves to window.SimulationHistory
        const configName = `Sim_${Date.now().toString().slice(-4)}`;
        const metric = document.getElementById('analysis-trace').value;
        const yData = this.getSafeData(data.data, metric);
        if (yData) {
            window.SimulationHistory = window.SimulationHistory || {};
            window.SimulationHistory[configName] = {
                name: configName,
                x: Array.from(data.data.x),
                y: Array.from(yData),
                metric: metric,
                variable: data.variable,
                polarization: document.getElementById('sim-polarization').value,
                layers: JSON.parse(JSON.stringify(GeometryManager.layers))
            };
        }
        
        if (this.showFieldOverlay) {
            this.triggerFieldWorker();
        }
    },

    updateAnalysisStats() {
        if (!this.lastWorkerData) return;
        const metric = document.getElementById('analysis-trace').value;
        const yData = this.getSafeData(this.lastWorkerData.data, metric);
        if (!yData) return;
        const xData = this.lastWorkerData.data.x;

        // SPR calculations (Min search)
        let minVal = Infinity, maxVal = -Infinity;
        let minIdx = 0, maxIdx = 0;
        for (let i = 0; i < yData.length; i++) {
            const v = yData[i];
            if (Number.isFinite(v)) {
                if (v < minVal) { minVal = v; minIdx = i; }
                if (v > maxVal) { maxVal = v; maxIdx = i; }
            }
        }
        if (minVal === Infinity) { minVal = 0; minIdx = 0; }
        if (maxVal === -Infinity) { maxVal = 0; maxIdx = 0; }

        const minX = xData[minIdx] !== undefined ? xData[minIdx] : 0;
        const maxX = xData[maxIdx] !== undefined ? xData[maxIdx] : 0;
        const baselineMax = maxVal;
        const baselineMin = minVal;
        
        const halfMaxSpr = minVal + (baselineMax - minVal) / 2;
        let leftX_spr = null, rightX_spr = null, isTruncatedSpr = false;
        
        for (let i = minIdx; i >= 0; i--) {
            if (yData[i] > halfMaxSpr) {
                const denom = yData[i+1] - yData[i];
                leftX_spr = denom !== 0 ? xData[i] + (xData[i+1] - xData[i]) * ((halfMaxSpr - yData[i]) / denom) : xData[i];
                break;
            }
        }
        for (let i = minIdx; i < yData.length; i++) {
            if (yData[i] > halfMaxSpr) {
                const denom = yData[i] - yData[i-1];
                rightX_spr = denom !== 0 ? xData[i-1] + (xData[i] - xData[i-1]) * ((halfMaxSpr - yData[i-1]) / denom) : xData[i-1];
                break;
            }
        }

        let fwhmValSpr = 0, fwhmStrSpr = "N/A";

        if (leftX_spr !== null && rightX_spr !== null) {
            fwhmValSpr = rightX_spr - leftX_spr;
            fwhmStrSpr = fwhmValSpr.toFixed(3);
        } else if (leftX_spr !== null && rightX_spr === null) {
            fwhmValSpr = 2 * (minX - leftX_spr); 
            fwhmStrSpr = `~${fwhmValSpr.toFixed(3)}*`;
            rightX_spr = leftX_spr + fwhmValSpr; 
            isTruncatedSpr = true;
        } else if (rightX_spr !== null && leftX_spr === null) {
            fwhmValSpr = 2 * (rightX_spr - minX);
            fwhmStrSpr = `~${fwhmValSpr.toFixed(3)}*`;
            leftX_spr = rightX_spr - fwhmValSpr; 
            isTruncatedSpr = true;
        }

        // DBR calculations (Peak and bandgap width search)
        const halfMaxDbr = baselineMin + (maxVal - baselineMin) / 2; 

        let leftX_dbr = null, rightX_dbr = null, isTruncatedDbr = false;

        for (let i = maxIdx; i >= 0; i--) {
            if (yData[i] < halfMaxDbr) { 
                const denom = yData[i+1] - yData[i];
                leftX_dbr = denom !== 0 ? xData[i] + (xData[i+1] - xData[i]) * ((halfMaxDbr - yData[i]) / denom) : xData[i];
                break;
            }
        }
        for (let i = maxIdx; i < yData.length; i++) {
            if (yData[i] < halfMaxDbr) { 
                const denom = yData[i] - yData[i-1];
                rightX_dbr = denom !== 0 ? xData[i-1] + (xData[i] - xData[i-1]) * ((halfMaxDbr - yData[i-1]) / denom) : xData[i-1];
                break;
            }
        }

        let bandgapVal = 0, bandgapStr = "N/A";

        if (leftX_dbr !== null && rightX_dbr !== null) {
            bandgapVal = rightX_dbr - leftX_dbr;
            bandgapStr = bandgapVal.toFixed(3);
        } else if (leftX_dbr !== null && rightX_dbr === null) {
            bandgapVal = 2 * (maxX - leftX_dbr); 
            bandgapStr = `~${bandgapVal.toFixed(3)}*`;
            rightX_dbr = leftX_dbr + bandgapVal; 
            isTruncatedDbr = true;
        } else if (rightX_dbr !== null && leftX_dbr === null) {
            bandgapVal = 2 * (rightX_dbr - maxX);
            bandgapStr = `~${bandgapVal.toFixed(3)}*`;
            leftX_dbr = rightX_dbr - bandgapVal; 
            isTruncatedDbr = true;
        }

        // Globally cache computed statistics
        this.currentStats = { 
            spr: { minVal, minX, baseline: baselineMax, halfMax: halfMaxSpr, fwhm: fwhmValSpr, leftX: leftX_spr, rightX: rightX_spr, isTruncated: isTruncatedSpr },
            dbr: { maxVal, maxX, baseline: baselineMin, halfMax: halfMaxDbr, bandgap: bandgapVal, leftX: leftX_dbr, rightX: rightX_dbr, isTruncated: isTruncatedDbr }
        };

        // Update DOM - SPR Panel
        document.getElementById('spr-stats-text').innerHTML = `
            <b>Dip (Min):</b> ${minVal.toFixed(4)} at X = ${minX.toFixed(3)}<br>
            <b>FWHM:</b> ${fwhmStrSpr} <span class="text-muted" style="font-size: 0.75rem;">${isTruncatedSpr ? '(Partial estimate)' : ''}</span>
        `;

        // Update DOM - DBR Panel
        document.getElementById('dbr-stats-text').innerHTML = `
            <b>Center ($\lambda_c$):</b> ${maxX.toFixed(3)}<br>
            <b>Max ${metric}:</b> ${(maxVal * 100).toFixed(2)}%<br>
            <b>Bandgap ($\Delta\lambda$):</b> ${bandgapStr} <span class="text-muted" style="font-size: 0.75rem;">${isTruncatedDbr ? '(Estimate)' : ''}</span>
        `;
    },

    calculateSensitivity() {
        if (!this.lastWorkerData) return;
        this.syncMaterialsDB();

        const deltaN = parseFloat(document.getElementById('sens-delta-n').value);
        const layerIdx = parseInt(document.getElementById('sens-layer').value, 10);
        const metric = document.getElementById('analysis-trace').value;
        const variable = this.lastWorkerData.variable;
        
        const yDataOld = this.getSafeData(this.lastWorkerData.data, metric);
        if (!yDataOld) return;
        
        const findTrueMin = (yArr) => {
            let minIdx = 0, minVal = Infinity;
            for (let i = 0; i < yArr.length; i++) {
                if (Number.isFinite(yArr[i]) && yArr[i] < minVal) { minVal = yArr[i]; minIdx = i; }
            }
            const xArr = this.lastWorkerData.data.x;
            if (minIdx === 0 || minIdx === yArr.length - 1) return xArr[minIdx];
            const x0 = xArr[minIdx], dx = xArr[minIdx] - xArr[minIdx - 1];
            const y_1 = yArr[minIdx - 1], y0 = yArr[minIdx], y1 = yArr[minIdx + 1];
            const denom = y1 - 2 * y0 + y_1;
            return denom === 0 ? x0 : x0 - (dx / 2) * ((y1 - y_1) / denom);
        };

        const minXOld = findTrueMin(yDataOld);

        const layers = JSON.parse(JSON.stringify(GeometryManager.layers));
        const processedLayers = layers.map(layer => {
            const matInfo = MaterialsDB[layer.material];
            if (!matInfo) return { d: layer.d, n: 1.5, k: 0, isDispersive: false, dispersionData: null };
            
            const isDispersive = matInfo.type === 'dispersive';
            return { 
                d: layer.d, 
                n: isDispersive ? null : matInfo.n, 
                k: isDispersive ? null : matInfo.k, 
                isDispersive: isDispersive, 
                dispersionData: isDispersive ? matInfo.data : null 
            };
        });

        const start = parseFloat(document.getElementById('sim-start').value);
        const end = parseFloat(document.getElementById('sim-end').value);
        const steps = parseInt(document.getElementById('sim-steps').value, 10);
        const fixedParam = parseFloat(document.getElementById('sim-fixed-val').value);
        const polarization = document.getElementById('sim-polarization').value;
        
        let newYData = new Float64Array(steps);
        
        const evalDisp = (L, lam) => L.map((l, i) => {
            let baseN, baseK;
            if(!l.isDispersive) {
                baseN = l.n;
                baseK = l.k;
            } else {
                const d = l.dispersionData;
                if(!d || d.length === 0) { baseN = 1.5; baseK = 0; }
                else if (lam <= d[0].w) { baseN = d[0].n; baseK = d[0].k; }
                else if (lam >= d[d.length-1].w) { baseN = d[d.length-1].n; baseK = d[d.length-1].k; }
                else {
                    for(let j=0; j<d.length-1; j++) if(lam>=d[j].w && lam<=d[j+1].w) {
                        const diff = d[j+1].w - d[j].w;
                        const t = diff === 0 ? 0 : (lam-d[j].w)/diff;
                        baseN = d[j].n+t*(d[j+1].n-d[j].n);
                        baseK = d[j].k+t*(d[j+1].k-d[j].k);
                        break;
                    }
                }
            }
            if (i === layerIdx) baseN += deltaN;
            return { d: l.d, n: baseN, k: baseK };
        });

        for (let i = 0; i < steps; i++) {
            const currentVal = start + i * ((end - start) / (steps - 1));
            const lambda = variable === 'lambda' ? currentVal : fixedParam;
            const theta = variable === 'theta' ? currentVal : fixedParam;
            
            const actL = evalDisp(processedLayers, lambda);
            const res = simulateTMM({ lambda, theta, polarization, layers: actL });
            
            let val = res[metric];
            if (val === undefined) val = res[metric.toLowerCase()];
            if (val === undefined) val = res[metric.toUpperCase()];
            if (val === undefined) val = 0;
            
            newYData[i] = val;
        }

        const findNewTrueMin = (yArr) => {
            let minIdx = 0, minVal = Infinity;
            for (let i = 0; i < yArr.length; i++) {
                if (Number.isFinite(yArr[i]) && yArr[i] < minVal) { minVal = yArr[i]; minIdx = i; }
            }
            const stepSize = (end - start) / (steps - 1);
            if (minIdx === 0 || minIdx === yArr.length - 1) return start + minIdx * stepSize;
            const x0 = start + minIdx * stepSize, dx = stepSize;
            const y_1 = yArr[minIdx - 1], y0 = yArr[minIdx], y1 = yArr[minIdx + 1];
            const denom = y1 - 2 * y0 + y_1;
            return denom === 0 ? x0 : x0 - (dx / 2) * ((y1 - y_1) / denom);
        };

        const newMinX = findNewTrueMin(newYData);

        const S = Math.abs(newMinX - minXOld) / deltaN;
        document.getElementById('sens-result').innerHTML = `New Dip: ${newMinX.toFixed(3)} | S = <b>${S.toFixed(1)}</b>`;
        
        this.sensData = { x: this.lastWorkerData.data.x, y: newYData, metric: metric };
        
        const chkOverlay = document.getElementById('chk-sens-overlay');
        chkOverlay.disabled = false;
        chkOverlay.checked = true;
        this.showSensOverlay = true;
        
        this.drawAnalysisGraph();
    },

    triggerFieldWorker() {
        const container = document.getElementById('field-graph-container');
        if (!this.showFieldOverlay) {
            container.style.display = 'none';
            Plotly.Plots.resize('analysis-graph');
            return;
        }

        container.style.display = 'flex';
        Plotly.Plots.resize('analysis-graph');

        const variable = document.getElementById('sim-scan-type').value;
        const fixedParam = parseFloat(document.getElementById('sim-fixed-val').value);
        const polarization = document.getElementById('sim-polarization').value;

        // Auto-calculate depth if the user hasn't modified it
        const zMinInput = document.getElementById('field-z-min');
        const zMaxInput = document.getElementById('field-z-max');
        let zMin = parseFloat(zMinInput.value) || -100;
        let zMax = parseFloat(zMaxInput.value) || 300;

        let evalPointX = parseFloat(document.getElementById('field-eval-x').value);
        if (isNaN(evalPointX)) {
            evalPointX = variable === 'theta' ? 45 : 600; 
        }

        const lambda_res = variable === 'lambda' ? evalPointX : fixedParam;
        const theta_res = variable === 'theta' ? evalPointX : fixedParam;

        const evaluatedLayers = this.getEvaluatedLayers(lambda_res);
        
        if (zMinInput.hasAttribute('data-auto') && zMaxInput.hasAttribute('data-auto')) {
            let totalD = 0;
            evaluatedLayers.forEach(l => { totalD += (l.d || 0); });
            zMin = -100;
            zMax = totalD + 100;
            zMinInput.value = zMin;
            zMaxInput.value = zMax;
        }

        document.getElementById('field-graph').innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="margin-right:10px;"></i> Calculating field distribution...</div>';

        this.fieldWorker.postMessage({
            layersDef: evaluatedLayers,
            lambda: lambda_res,
            theta: theta_res,
            pol: polarization,
            zMin: zMin,
            zMax: zMax
        });
    },

    renderFieldPlot(fieldData) {
        // Render Penetration Depth if available
        const metricsContainer = document.getElementById('field-metrics-container');
        if (metricsContainer) {
            if (fieldData.penetrationDepth && fieldData.penetrationDepth > 0) {
                metricsContainer.innerHTML = `<span style="color: var(--accent-green); background: rgba(16, 185, 129, 0.1); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);">Penetration Depth (L<sub>p</sub>) = ${fieldData.penetrationDepth.toFixed(2)} nm</span>`;
            } else {
                metricsContainer.innerHTML = '';
            }
        }

        const compSelect = document.getElementById('field-component-select');
        const compVal = compSelect ? compSelect.value : 'e_tot';
        const compName = compSelect ? compSelect.options[compSelect.selectedIndex].text : '|E|²';
        
        const yData = (fieldData.components && fieldData.components[compVal]) ? fieldData.components[compVal] : fieldData.E_intensity;

        // Update Title
        const titleLabel = document.getElementById('field-title-label');
        if(titleLabel) titleLabel.innerHTML = `<i class="fa-solid fa-bolt"></i> Electromagnetic Field: ${compName}`;

        const traces = [{
            x: fieldData.z_points,
            y: yData,
            name: compName,
            type: 'scatter',
            line: { color: window.getCSSColor('--color-danger'), width: 2 },
            fill: 'tozeroy',
            fillcolor: 'rgba(239, 68, 68, 0.1)'
        }];

        const shapes = fieldData.layer_boundaries.map(b => ({
            type: 'rect',
            xref: 'x', yref: 'paper',
            x0: b.start, y0: 0,
            x1: b.end, y1: 1,
            fillcolor: b.color,
            opacity: 0.2,
            line: { width: 1, color: 'rgba(255,255,255,0.2)' }
        }));

        const annotations = fieldData.layer_boundaries.map(b => ({
            x: (b.start + b.end) / 2,
            y: 0.95,
            xref: 'x', yref: 'paper',
            text: b.name.substring(0, 15),
            showarrow: false,
            font: { color: '#ffffff', size: 10 },
            textangle: b.end - b.start < 30 ? -90 : 0
        }));

        const showLpCheckbox = document.getElementById('field-show-lp');
        const showLp = showLpCheckbox ? showLpCheckbox.checked : false;

        if (showLp && fieldData.penetrationDepth && fieldData.penetrationDepth > 0) {
            const subBoundary = fieldData.layer_boundaries[fieldData.layer_boundaries.length - 1];
            if (subBoundary) {
                const z_interface = subBoundary.start;
                const z_lp = z_interface + fieldData.penetrationDepth;
                
                let I0 = 0;
                const yArr = (fieldData.components && fieldData.components[compVal]) ? fieldData.components[compVal] : fieldData.E_intensity;
                for(let i=0; i<fieldData.z_points.length; i++) {
                    if (fieldData.z_points[i] >= z_interface - 1e-6) {
                        I0 = yArr[i];
                        break;
                    }
                }
                const I_target = I0 / Math.E;

                shapes.push({
                    type: 'line',
                    xref: 'x', yref: 'paper',
                    x0: z_lp, x1: z_lp,
                    y0: 0, y1: 1,
                    line: { color: 'rgba(16, 185, 129, 0.8)', width: 2, dash: 'dash' }
                });

                shapes.push({
                    type: 'line',
                    xref: 'paper', yref: 'y',
                    x0: 0, x1: 1,
                    y0: I_target, y1: I_target,
                    line: { color: 'rgba(16, 185, 129, 0.8)', width: 1, dash: 'dot' }
                });

                annotations.push({
                    x: z_lp,
                    y: I_target,
                    xref: 'x', yref: 'y',
                    text: `Lp = ${fieldData.penetrationDepth.toFixed(2)} nm`,
                    showarrow: true,
                    arrowhead: 2,
                    ax: 40,
                    ay: -40,
                    font: { color: '#10b981', size: 12, weight: 'bold' }
                });
            }
        }

        const tc = window.getPlotThemeColors();
        
        // Decide y-axis title based on component type
        let yAxisTitle = compName;
        if (!compVal.startsWith('sz')) {
            yAxisTitle += ' / Incident';
        }

        const layout = {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: 'Depth (nm) [0 = Incident Interface]', gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: yAxisTitle, gridcolor: tc.grid, zerolinecolor: tc.grid },
            margin: { t: 30, b: 40, l: 60, r: 20 },
            shapes: shapes,
            annotations: annotations,
            showlegend: false
        };

        document.getElementById('field-graph').innerHTML = '';
        Plotly.newPlot('field-graph', traces, layout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['field-graph'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    drawAnalysisGraph() {
        if (!this.lastWorkerData) return;
        const metric = document.getElementById('analysis-trace').value;
        const xData = this.lastWorkerData.data.x;
        const yData = this.getSafeData(this.lastWorkerData.data, metric);
        if (!yData) return;

        const xTitle = this.lastWorkerData.variable === 'theta' ? 'Incident Angle (degrees)' : 'Wavelength (nm)';
        const metricLabels = { 'R': 'Reflectance (R)', 'T': 'Transmittance (T)', 'A': 'Absorbance (A)', 'phaseR': 'Reflection Phase', 'phaseT': 'Transmission Phase' };

        const traces = [{ x: xData, y: yData, name: `Data (${metric})`, type: 'scatter', line: { color: window.getCSSColor('--layer-tio2'), width: 3 } }];

        if (this.fitComponents.length > 0) {
            const yFit = xData.map(x => this.evaluateFitModel(x));
            traces.push({ x: xData, y: yFit, name: 'Model Fit', type: 'scatter', line: { color: window.getCSSColor('--color-success'), width: 2, dash: 'dot' } });
        }

        if (this.showSensOverlay && this.sensData && this.sensData.metric === metric) {
            traces.push({ x: this.sensData.x, y: this.sensData.y, name: 'Sensitivity', type: 'scatter', line: { color: window.getCSSColor('--color-warning-alt'), width: 2, dash: 'dash' } });
        }

        let annotations = [];

        // Overlay SPR (Minim)
        if (this.showResOverlay && this.currentStats && this.currentStats.spr) {
            const spr = this.currentStats.spr;
            traces.push({
                x: [spr.minX], y: [spr.minVal],
                name: 'Dip SPR', mode: 'markers', marker: { color: window.getCSSColor('--color-danger'), size: 10, symbol: 'x' }
            });
            annotations.push({
                x: spr.minX, y: spr.minVal,
                text: `Dip: ${spr.minX.toFixed(2)}`, showarrow: true, ax: 0, ay: 30,
                font: { color: window.getCSSColor('--color-danger') }, arrowcolor: window.getCSSColor('--color-danger')
            });
        }

        // Overlay SPR (FWHM)
        if (this.showFwhmOverlay && this.currentStats && this.currentStats.spr.leftX !== null && this.currentStats.spr.rightX !== null) {
            const spr = this.currentStats.spr;
            traces.push({
                x: [spr.leftX, spr.rightX], y: [spr.halfMax, spr.halfMax],
                name: 'FWHM', mode: 'lines+markers', line: { color: window.getCSSColor('--accent-blue'), width: 2 }, marker: { size: 6 }
            });
            annotations.push({
                x: (spr.leftX + spr.rightX) / 2, y: spr.halfMax,
                text: `FWHM: ${spr.fwhm.toFixed(3)}${spr.isTruncated ? '*' : ''}`,
                showarrow: true, ax: 0, ay: -30, font: { color: window.getCSSColor('--accent-blue') }, arrowcolor: window.getCSSColor('--accent-blue')
            });
        }

        // Overlay DBR (Center / Peak)
        if (this.showDbrCenterOverlay && this.currentStats && this.currentStats.dbr) {
            const dbr = this.currentStats.dbr;
            traces.push({
                x: [dbr.maxX], y: [dbr.maxVal],
                name: 'DBR Peak', mode: 'markers', marker: { color: window.getCSSColor('--color-warning-alt'), size: 10, symbol: 'star' }
            });
            annotations.push({
                x: dbr.maxX, y: dbr.maxVal,
                text: `λ_c: ${dbr.maxX.toFixed(2)}`, showarrow: true, ax: 0, ay: -30,
                font: { color: window.getCSSColor('--color-warning-alt') }, arrowcolor: window.getCSSColor('--color-warning-alt')
            });
        }

        // Overlay DBR (Bandgap)
        if (this.showDbrBandgapOverlay && this.currentStats && this.currentStats.dbr.leftX !== null && this.currentStats.dbr.rightX !== null) {
            const dbr = this.currentStats.dbr;
            traces.push({
                x: [dbr.leftX, dbr.rightX], y: [dbr.halfMax, dbr.halfMax],
                name: 'BandGAP', mode: 'lines+markers', line: { color: window.getCSSColor('--color-success'), width: 2 }, marker: { size: 6 }
            });
            annotations.push({
                x: (dbr.leftX + dbr.rightX) / 2, y: dbr.halfMax,
                text: `Δλ: ${dbr.bandgap.toFixed(3)}${dbr.isTruncated ? '*' : ''}`,
                showarrow: true, ax: 0, ay: 30, font: { color: window.getCSSColor('--color-success') }, arrowcolor: window.getCSSColor('--color-success')
            });
        }

        const tc = window.getPlotThemeColors();
        const layout = {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: xTitle, gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: metricLabels[metric] || metric, gridcolor: tc.grid, zerolinecolor: tc.grid },
            margin: { t: 30, b: 50, l: 60, r: 20 },
            showlegend: true,
            annotations: annotations
        };

        Plotly.newPlot('analysis-graph', traces, layout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['analysis-graph'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    addFitComponent(type) {
        const id = Date.now() + '-' + Math.floor(Math.random() * 1000);
        let y0 = 1, A = -0.5, xc = 45, w = 2;
        
        if (this.currentStats && this.currentStats.spr) {
            y0 = Number(this.currentStats.spr.baseline.toFixed(4));
            A = Number((this.currentStats.spr.minVal - this.currentStats.spr.baseline).toFixed(4));
            xc = Number(this.currentStats.spr.minX.toFixed(4));
            w = Number(this.currentStats.spr.fwhm.toFixed(4));
        }

        let comp = { id, type, y0, A, xc, w };
        if (type === 'fano') comp.q = 1;
        if (type === 'coupled') comp = { id, type, y0, A1: A, w1: xc, g1: w, w2: xc + 2, g2: w/2, k: 1 };
        
        this.fitComponents.push(comp);
        this.renderFitComponents();
        this.drawAnalysisGraph();
    },

    renderFitComponents() {
        const list = document.getElementById('fit-components-list');
        
        let fullHtml = '';
        this.fitComponents.forEach((c) => {
            let html = `<div style="background: var(--bg-main); padding: 8px; border-radius: 4px; position: relative;">
                <b style="color:var(--accent-blue); font-size:0.8rem;">${c.type.toUpperCase()}</b>
                <button class="btn-del-fit text-danger" data-id="${c.id}" style="position:absolute; right:5px; top:5px; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-times"></i></button>
                <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;">`;
            
            Object.keys(c).forEach(key => {
                if (key !== 'id' && key !== 'type') {
                    html += `<div style="display:flex; flex-direction:column; width: 45%;">
                        <span class="text-muted" style="font-size:0.7rem;">${key}</span>
                        <input type="number" class="fit-param-input" data-id="${c.id}" data-key="${key}" value="${c[key]}" step="0.1" style="padding:4px; background:var(--bg-card); color: var(--text-main); border:1px solid var(--border-color);">
                    </div>`;
                }
            });
            html += `</div></div>`;
            fullHtml += html;
        });

        list.innerHTML = fullHtml;

        document.querySelectorAll('.fit-param-input').forEach(el => {
            el.addEventListener('change', (e) => {
                const comp = this.fitComponents.find(c => c.id === e.target.dataset.id);
                if (comp) {
                    comp[e.target.dataset.key] = parseFloat(e.target.value);
                    this.drawAnalysisGraph();
                }
            });
        });

        document.querySelectorAll('.btn-del-fit').forEach(el => {
            el.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-del-fit');
                if (btn) {
                    this.fitComponents = this.fitComponents.filter(c => c.id !== btn.dataset.id);
                    this.renderFitComponents();
                    this.drawAnalysisGraph();
                }
            });
        });
    },

    evaluateFitModel(x) {
        let y = 0;
        for (let c of this.fitComponents) {
            if (c.type === 'lorentz') {
                y += c.y0 + c.A * (c.w * c.w) / (Math.pow(x - c.xc, 2) + c.w * c.w);
            } else if (c.type === 'fano') {
                y += c.y0 + c.A * Math.pow(c.q * c.w + (x - c.xc), 2) / (Math.pow(x - c.xc, 2) + c.w * c.w);
            } else if (c.type === 'coupled') {
                const dx = (x - c.w1) - c.k*c.k * (x - c.w2) / (Math.pow(x-c.w2, 2) + c.g2*c.g2);
                const dy = c.g1 + c.k*c.k * c.g2 / (Math.pow(x-c.w2, 2) + c.g2*c.g2);
                y += c.y0 + c.A1 / (dx*dx + dy*dy);
            }
        }
        return y;
    },

    runAutoFit() {
        if (!this.lastWorkerData || this.fitComponents.length === 0) return;
        const metric = document.getElementById('analysis-trace').value;
        const xData = this.lastWorkerData.data.x;
        const yData = this.getSafeData(this.lastWorkerData.data, metric);
        if (!yData) return;

        const getP = () => this.fitComponents.flatMap(c => Object.keys(c).filter(k => k!=='id' && k!=='type').map(k => c[k]));
        const setP = (arr) => {
            let i = 0;
            this.fitComponents.forEach(c => {
                Object.keys(c).filter(k => k!=='id' && k!=='type').forEach(k => { c[k] = arr[i++]; });
            });
        };

        const objectiveFunc = (pArray) => {
            setP(pArray);
            let sse = 0;
            for (let i = 0; i < xData.length; i++) {
                sse += Math.pow(this.evaluateFitModel(xData[i]) - yData[i], 2);
            }
            return sse;
        };

        const startParams = getP();
        const optimized = nelderMead(objectiveFunc, startParams);
        setP(optimized); 
        
        this.renderFitComponents(); 
        this.drawAnalysisGraph();
    },

    exportMainGraphCSV() {
        if (!this.lastWorkerData) {
            alert("No data to export. Run a simulation first!");
            return;
        }

        const metric = document.getElementById('analysis-trace').value;
        const xData = this.lastWorkerData.data.x;
        const yData = this.getSafeData(this.lastWorkerData.data, metric);
        
        if (!yData) {
            alert("No valid data found for " + metric);
            return;
        }
        
        let csvStr = "";

        if (this.fitComponents.length > 0) {
            csvStr += "# --- MATHEMATICAL FITTING DATA ---\n";
            this.fitComponents.forEach((c, idx) => {
                csvStr += `# Component ${idx + 1} (${c.type.toUpperCase()}): `;
                const params = Object.keys(c)
                    .filter(k => k !== 'id' && k !== 'type')
                    .map(k => `${k}=${c[k]}`)
                    .join(', ');
                csvStr += `${params}\n`;
            });
            csvStr += "# ------------------------------\n\n";
        }

        const xTitle = this.lastWorkerData.variable === 'theta' ? 'Angle (deg)' : 'Wavelength (nm)';
        let headers = [xTitle, `Raw Data (${metric})`];
        
        let yFit = null;
        if (this.fitComponents.length > 0) {
            headers.push("Model Fit");
            yFit = xData.map(x => this.evaluateFitModel(x));
        }

        let ySens = null;
        if (this.showSensOverlay && this.sensData && this.sensData.metric === metric) {
            headers.push("Shifted Sensitivity");
            ySens = this.sensData.y;
        }

        csvStr += headers.join(",") + "\n";

        for (let i = 0; i < xData.length; i++) {
            let row = [xData[i], yData[i]];
            if (yFit) row.push(yFit[i]);
            if (ySens) row.push(ySens[i]);
            csvStr += row.join(",") + "\n";
        }

        this.downloadCSV(csvStr, `Simulation_${metric}_${this.lastWorkerData.variable}.csv`);
    },

    exportFieldGraphCSV() {
        if (!this.lastFieldData) {
            alert("No data for electric field. Calculate the distribution first!");
            return;
        }

        let csvStr = "Depth Z (nm),Intensity |E|^2\n";
        for (let i = 0; i < this.lastFieldData.z_points.length; i++) {
            csvStr += `${this.lastFieldData.z_points[i]},${this.lastFieldData.E_intensity[i]}\n`;
        }

        this.downloadCSV(csvStr, "Field_Distribution_E.csv");
    },

    downloadCSV(csvString, filename) {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
