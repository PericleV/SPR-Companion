import { GeometryManager } from './tab2Geometry.js?v=50';
import { MaterialsDB } from '../core/materials_database.js?v=50';

export const SweepManager = {
    worker: null,
    lastSweepData: null,

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
        } catch (e) { console.error("Error synchronizing MaterialsDB in Tab4:", e); }
    },

    init() {
        this.container = document.getElementById('sweep-container');
        this.worker = new Worker(`./js/workers/sweep.worker.js?v=${Date.now()}`, { type: 'module' });
        
        this.syncMaterialsDB(); 
        
        this.render();
        this.bindEvents();
        this.worker.onerror = (e) => {
            console.error("Sweep Worker Error:", e);
            alert("A critical error occurred in the sweep worker. See console for details.");
            document.getElementById('sweep-status').innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-danger);"></i> Error occurred`;
        };

        this.worker.onmessage = (e) => {
            if(e.data.type === 'progress') {
                document.getElementById('sweep-status').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Calculating: ${e.data.percent}%`;
            } else if(e.data.type === 'done') {
                document.getElementById('sweep-status').innerHTML = `<i class="fa-solid fa-check"></i> Generation Complete!`;
                this.lastSweepData = e.data;
                this.updateVisualizationUI();
                this.plotData();
            }
        };

        document.addEventListener('materialsUpdated', () => {
            this.syncMaterialsDB();
            this.refreshAllParamOptions(); 
            this.showSyncWarning();
        });

        document.addEventListener('geometryUpdated', () => {
            this.refreshAllParamOptions();
            this.showSyncWarning();
        });

        this.addSweepParam(); 
    },

    showSyncWarning() {
        const warning = document.getElementById('sweep-sync-warning');
        if (warning && this.lastSweepData) {
            warning.style.display = 'block';
        }
    },

    hideSyncWarning() {
        const warning = document.getElementById('sweep-sync-warning');
        if (warning) warning.style.display = 'none';
    },

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div style="display: flex; gap: 30px; height: 100%;">
                
                <!-- Configuration Panel -->
                <div style="width: 380px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto;">
                    
                    <div id="sweep-sync-warning" class="bg-warning text-main" style="display: none; padding: 10px; border-radius: 6px; border: 1px solid var(--color-warning-alt); font-size: 0.9rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Stack configuration changed. Results may be out of date. Please re-run the sweep.
                    </div>

                    <div style="background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color);">
                        <h3 style="color: var(--text-main); margin-bottom: 15px;"><i class="fa-solid fa-table-cells"></i> Multi-Parameter Sweep</h3>
                        
                        <div id="sweep-params-container" style="display: flex; flex-direction: column; gap: 15px; margin-bottom: 15px;">
                            <!-- Dynamically generated parameters -->
                        </div>

                        <button id="btn-add-param" style="width: 100%; background: var(--bg-sidebar); color: var(--accent-blue); border: 1px dashed var(--accent-blue); padding: 8px; border-radius: 6px; cursor: pointer; margin-bottom: 20px;">
                            <i class="fa-solid fa-plus"></i> Add Parameter
                        </button>

                        <!-- Evaluation Mode -->
                        <div style="margin-bottom: 15px; background: var(--bg-main); padding: 10px; border-radius: 6px;">
                            <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Evaluation Mode <span class="custom-tooltip" data-tooltip="Single Point computes metrics at a specific angle and wavelength. Angle/Wavelength Scan sweeps that parameter to compute advanced metrics like Minimum Reflectance (resonance dip), FWHM, and Sensitivity.">?</span></label>
                            <select id="sweep-eval-mode" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 10px;">
                                <option value="fixed">Single Point (Fixed Angle & Wavelength)</option>
                                <option value="scan_theta">Angle Scan (Enables MinR, FWHM, Sens)</option>
                                <option value="scan_lambda">Wavelength Scan (Enables MinR, FWHM, Sens)</option>
                            </select>
                            
                            <!-- Polarization -->
                            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                                <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Polarization</span>
                                    <select id="sweep-polarization" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                        <option value="TM">TM (p-pol)</option>
                                        <option value="TE">TE (s-pol)</option>
                                    </select>
                                </div>
                            </div>
                            
                            <!-- Fixed Point Config -->
                            <div id="sweep-config-fixed" style="display: flex; gap: 10px;">
                                <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Angle (deg) <span class="custom-tooltip" data-tooltip="Fixed angle of incidence for Single Point evaluation.">?</span></span><input type="number" id="sweep-fixed-theta" value="45" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                                <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Lambda (nm) <span class="custom-tooltip" data-tooltip="Fixed wavelength for Single Point evaluation.">?</span></span><input type="number" id="sweep-fixed-lambda" value="633" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                            </div>
                            
                            <!-- Scan Config -->
                            <div id="sweep-config-scan" style="display: none; flex-direction: column; gap: 10px;">
                                <div style="display: flex; gap: 10px;">
                                    <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Min</span><input type="number" id="sweep-scan-min" value="0" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                                    <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Max</span><input type="number" id="sweep-scan-max" value="90" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                                    <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Steps</span><input type="number" id="sweep-scan-steps" value="300" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                                </div>
                                <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; margin-top: 5px;">
                                    <span class="text-muted" style="font-size: 0.75rem; display: block; margin-bottom: 5px;">Sensitivity Setup</span>
                                    <div style="display: flex; gap: 10px;">
                                        <div style="flex: 0 0 60px;"><span class="text-muted" style="font-size: 0.75rem;">Δn <span class="custom-tooltip" data-tooltip="Refractive index shift applied to calculate Sensitivity (S = ΔResonance / Δn).">?</span></span>
                                            <input type="number" id="sweep-sens-dn" value="0.005" step="0.001" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                        </div>
                                        <div style="flex: 1;"><span class="text-muted" style="font-size: 0.75rem;">Layer for Δn</span>
                                            <select id="sweep-sens-layer" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                                <option value="auto">Auto (Last Layer)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button id="btn-run-sweep" class="bg-purple" style="width: 100%; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: 0.2s;">
                            <i class="fa-solid fa-play"></i> Run Sweep
                        </button>
                        <p id="sweep-status" class="text-purple-alt" style="margin-top: 15px; text-align: center; font-size: 0.9em;"></p>
                    </div>
                </div>
                
                <!-- Visualization Panel -->
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; padding-right: 5px;">
                    <div style="background: var(--bg-card); padding: 15px 20px; border-radius: 12px; border: 1px solid var(--border-color); display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end;">
                        <div>
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Plot Type</label>
                            <select id="vis-plot-type" class="vis-control" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                <option value="1d">1D (Overlaid Lines)</option>
                                <option value="2d">2D (Heatmap)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Active Metric</label>
                            <select id="vis-metric" class="vis-control" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                <option value="R">Reflectance (R)</option><option value="T">Transmittance (T)</option><option value="A">Absorbance (A)</option>
                                <option value="phaseR">Reflection Phase</option><option value="phaseT">Transmission Phase</option>
                                <optgroup label="Advanced (Scan Mode Only)">
                                    <option value="minR">Minimum Reflectance (Dip)</option>
                                    <option value="resPos">Resonance Position (Angle/nm)</option>
                                    <option value="fwhm">FWHM (Width)</option>
                                    <option value="sensitivity">Sensitivity (S)</option>
                                </optgroup>
                            </select>
                        </div>
                        <div>
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">X Axis</label>
                            <select id="vis-x" class="vis-control" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></select>
                        </div>
                        <div>
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Y Axis</label>
                            <select id="vis-y" class="vis-control" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></select>
                        </div>
                        <div>
                            <label id="vis-group-label" style="font-size: 0.75rem; color: var(--text-muted); display: block;">Overlap / Z Axis</label>
                            <select id="vis-overlap" class="vis-control" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></select>
                        </div>
                        <div>
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Line Style (1D)</label>
                            <select id="vis-line-style" class="vis-control" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                <option value="lines">Lines</option>
                                <option value="markers">Points</option>
                                <option value="lines+markers">Lines & Points</option>
                            </select>
                        </div>
                        <div id="vis-filters-container" style="display: flex; gap: 10px; border-left: 1px solid var(--border-color); padding-left: 15px;">
                            <!-- Dynamic filters for the rest of parameters (Z-slices) -->
                        </div>
                    </div>

                    <!-- Graph Container -->
                    <div style="flex: 0 0 450px; min-width: 0; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column; padding: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
                            <h4 style="color: var(--text-main); margin: 0; font-size: 1.05rem;"><i class="fa-solid fa-chart-area"></i> Sweep Visualization</h4>
                            <div style="display: flex; gap: 15px; align-items: center;">
                                <label id="toggle-sweep-profiles-container" style="display: none; align-items: center; gap: 5px; color: var(--text-main); font-size: 0.85rem; cursor: pointer;">
                                    <input type="checkbox" id="toggle-sweep-profiles" checked> Show Cross-Section Profiles
                                </label>
                                <button id="btn-sweep-export-csv" style="background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s;" title="Download sweep data (CSV)"><i class="fa-solid fa-download"></i> Export CSV</button>
                            </div>
                        </div>
                        <div style="flex: 1; position: relative; min-width: 0; min-height: 0; width: 100%; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden;">
                            <div id="sweep-plot" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                        </div>
                    </div>
                    
                    <!-- Profile Explorer (Visible only in 2D mode) -->
                    <div id="sweep-profile-explorer" style="display: none; flex-direction: column; gap: 15px;">
                        <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color);">
                            <h4 style="color: var(--text-main); margin: 0 0 15px 0; font-size: 0.95rem;"><i class="fa-solid fa-crosshairs"></i> 2D Heatmap Cross-Section Profiles</h4>
                            
                            <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 5px;">
                                    <div style="display: flex; justify-content: space-between;">
                                        <label style="font-size: 0.8rem; color: var(--text-muted);">Horizontal Slice at Y = <span id="sweep-val-y-label" style="color: var(--accent-blue); font-weight: bold;">-</span></label>
                                    </div>
                                    <input type="range" id="sweep-slider-y" min="0" max="0" value="0" style="width: 100%;">
                                </div>
                                
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 5px;">
                                    <div style="display: flex; justify-content: space-between;">
                                        <label style="font-size: 0.8rem; color: var(--text-muted);">Vertical Slice at X = <span id="sweep-val-x-label" style="color: var(--accent-blue); font-weight: bold;">-</span></label>
                                    </div>
                                    <input type="range" id="sweep-slider-x" min="0" max="0" value="0" style="width: 100%;">
                                </div>
                            </div>
                        </div>

                        <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 300px; background: var(--bg-card); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                    <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-main);">Horizontal Profile</span>
                                    <button id="btn-export-profile-horiz" style="background: none; border: none; color: var(--accent-blue); cursor: pointer; font-size: 0.8rem;"><i class="fa-solid fa-download"></i> CSV</button>
                                </div>
                                <div style="height: 200px; position: relative;">
                                    <div id="sweep-profile-horiz-plot" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                                </div>
                            </div>
                            
                            <div style="flex: 1; min-width: 300px; background: var(--bg-card); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                    <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-main);">Vertical Profile</span>
                                    <button id="btn-export-profile-vert" style="background: none; border: none; color: var(--accent-blue); cursor: pointer; font-size: 0.8rem;"><i class="fa-solid fa-download"></i> CSV</button>
                                </div>
                                <div style="height: 200px; position: relative;">
                                    <div id="sweep-profile-vert-plot" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const tc = window.getPlotThemeColors();
        const initialLayout = { 
            paper_bgcolor: tc.bg, 
            plot_bgcolor: tc.bg, 
            font: { color: tc.text },
            xaxis: { gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { gridcolor: tc.grid, zerolinecolor: tc.grid },
            showlegend: true,
            margin: { t: 40, r: 20, l: 60, b: 40 }
        };

        Plotly.newPlot('sweep-plot', [], initialLayout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['sweep-plot'] = { data: [], layout: initialLayout };
        
        const profLayout = { paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text }, margin: { t: 10, r: 10, l: 50, b: 40 }, xaxis: { gridcolor: tc.grid }, yaxis: { gridcolor: tc.grid } };
        Plotly.newPlot('sweep-profile-horiz-plot', [], profLayout, { responsive: true, displayModeBar: false });
        Plotly.newPlot('sweep-profile-vert-plot', [], profLayout, { responsive: true, displayModeBar: false });
        window.PlotRegistry['sweep-profile-horiz-plot'] = { data: [], layout: profLayout };
        window.PlotRegistry['sweep-profile-vert-plot'] = { data: [], layout: profLayout };
    },

    getParamOptionsHTML() {
        this.syncMaterialsDB(); 
        
        let opts = `<option value="theta">Incident Angle (deg)</option><option value="lambda">Wavelength (nm)</option>`;
        
        if (GeometryManager.layers) {
            GeometryManager.layers.forEach((layer, idx) => {
                const matInfo = MaterialsDB[layer.material];
                const layerType = (matInfo && matInfo.category) ? matInfo.category : layer.type;

                if (layerType === '2d') {
                    opts += `<option value="count_${idx}">No. Layers (N) Layer ${idx} (${layer.material})</option>`;
                } else {
                    opts += `<option value="d_${idx}">Thickness Layer ${idx} (${layer.material}) [nm]</option>`;
                }
                
                opts += `<option value="mat_${idx}">Material Layer ${idx} (${layer.material})</option>`;
                
                if (layerType === 'porous') {
                    opts += `<option value="ff_${idx}">Fill Factor (f) Layer ${idx} (${layer.material})</option>`;
                }

                opts += `<option value="n_${idx}">Real Refractive Index (n) Layer ${idx} (${layer.material})</option>`;
                opts += `<option value="k_${idx}">Imaginary/Extinction Index (k) Layer ${idx} (${layer.material})</option>`;
            });
            
            opts += `<optgroup label="Global Material Thickness">`;
            const uniqueMats = [...new Set(GeometryManager.layers.filter(l => l.type !== '2d').map(l => l.material))];
            uniqueMats.forEach(m => {
                opts += `<option value="d_mat_${m}">All layers of '${m}' [nm]</option>`;
            });
            opts += `</optgroup>`;
        }
        
        opts += `<optgroup label="DBR Auto-Builder (Warning: Regenerates stack)">`;
        opts += `<option value="dbr_periods">DBR: Number of Periods (N)</option>`;
        opts += `<option value="dbr_def_pos">DBR: Defect Position (Cavity)</option>`;
        opts += `</optgroup>`;
        
        return opts;
    },

    refreshAllParamOptions() {
        const selects = document.querySelectorAll('.param-select');
        selects.forEach(select => {
            const currentVal = select.value;
            select.innerHTML = this.getParamOptionsHTML();
            if ([...select.options].some(o => o.value === currentVal)) {
                select.value = currentVal;
            }
        });
        
        // Also update Sensitivity Layer dropdown
        const sensSelect = document.getElementById('sweep-sens-layer');
        if (sensSelect) {
            const currVal = sensSelect.value;
            sensSelect.innerHTML = '<option value="auto">Auto (Last Layer)</option>';
            if (GeometryManager.layers) {
                GeometryManager.layers.forEach((l, i) => {
                    sensSelect.innerHTML += `<option value="${i}">Layer ${i} (${l.material})</option>`;
                });
            }
            if ([...sensSelect.options].some(o => o.value === currVal)) {
                sensSelect.value = currVal;
            }
        }
    },

    addSweepParam() {
        const container = document.getElementById('sweep-params-container');
        const id = Date.now();
        const html = `
            <div class="sweep-param-row" id="param-${id}" style="background: var(--bg-main); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); position: relative;">
                <button class="btn-remove-param text-danger" data-id="${id}" style="position: absolute; top: 5px; right: 5px; background: none; border: none; cursor: pointer;"><i class="fa-solid fa-times"></i></button>
                <select class="param-select" style="width: 90%; margin-bottom: 10px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    ${this.getParamOptionsHTML()}
                </select>
                <select class="mode-select" style="width: 100%; margin-bottom: 10px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    <option value="range">Interval (Start -> Stop)</option>
                    <option value="discrete">Discrete Values (,)</option>
                </select>
                <div class="range-inputs" style="display: flex; gap: 5px;">
                    <input type="number" step="any" class="min-input" placeholder="Min" value="0" style="width: 33%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    <input type="number" step="any" class="max-input" placeholder="Max" value="90" style="width: 33%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    <input type="number" class="steps-input" placeholder="Steps" value="100" style="width: 33%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                </div>
                <div class="discrete-inputs" style="display: none;">
                    <input type="text" class="discrete-input" placeholder="e.g., 1.33, 1.34, 1.35" value="1.33, 1.34" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        const newRow = document.getElementById(`param-${id}`);
        newRow.querySelector('.mode-select').addEventListener('change', (e) => {
            newRow.querySelector('.range-inputs').style.display = e.target.value === 'range' ? 'flex' : 'none';
            newRow.querySelector('.discrete-inputs').style.display = e.target.value === 'discrete' ? 'block' : 'none';
        });
        newRow.querySelector('.param-select').addEventListener('change', (e) => {
            const isMat = e.target.value.startsWith('mat_');
            const modeSelect = newRow.querySelector('.mode-select');
            if (isMat) {
                modeSelect.value = 'discrete';
                modeSelect.dispatchEvent(new Event('change'));
                modeSelect.style.display = 'none'; // Only discrete mode makes sense for materials
                const input = newRow.querySelector('.discrete-input');
                input.placeholder = "e.g. Au, 10, 20, Ag, 15";
                input.title = "Syntax: Material1, thick1, thick2, Material2, thick1";
                if (!input.value || input.value === "1.33, 1.34" || input.value === "1.33, 1.34, 1.35") {
                    input.value = "Au, 30, Au, 40, Au, 50, Ag, 30, Ag, 40";
                }
            } else {
                modeSelect.style.display = 'block';
                const input = newRow.querySelector('.discrete-input');
                input.placeholder = "e.g., 1.33, 1.34, 1.35";
                input.title = "";
                if (input.value === "Au, 30, Au, 40, Au, 50, Ag, 30, Ag, 40") {
                    input.value = "1.33, 1.34";
                }
            }
        });
        newRow.querySelector('.param-select').dispatchEvent(new Event('change')); // trigger initially
        newRow.querySelector('.btn-remove-param').addEventListener('click', () => newRow.remove());
    },

    bindEvents() {
        document.getElementById('btn-add-param').addEventListener('click', () => this.addSweepParam());
        
        document.getElementById('sweep-eval-mode').addEventListener('change', (e) => {
            const mode = e.target.value;
            document.getElementById('sweep-config-fixed').style.display = mode === 'fixed' ? 'flex' : 'none';
            document.getElementById('sweep-config-scan').style.display = mode !== 'fixed' ? 'flex' : 'none';
        });

        document.getElementById('btn-run-sweep').addEventListener('click', () => {
            this.hideSyncWarning();
            this.syncMaterialsDB(); 

            const configs = [];
            let hasError = false;
            document.querySelectorAll('.sweep-param-row').forEach(row => {
                if (hasError) return;
                const param = row.querySelector('.param-select').value;
                const mode = row.querySelector('.mode-select').value;
                let values = [];
                if (mode === 'range') {
                    const min = parseFloat(row.querySelector('.min-input').value);
                    const max = parseFloat(row.querySelector('.max-input').value);
                    const steps = parseInt(row.querySelector('.steps-input').value, 10);
                    if (isNaN(min) || isNaN(max) || isNaN(steps) || steps <= 0) {
                        alert("Invalid range parameters for " + param);
                        hasError = true;
                        return;
                    }
                    for (let i = 0; i < steps; i++) values.push(min + (max - min) * (i / (Math.max(1, steps - 1))));
                } else {
                    if (param.startsWith('mat_')) {
                        const rawVals = row.querySelector('.discrete-input').value
                            .split(',')
                            .map(v => v.trim())
                            .filter(v => v.length > 0);
                        
                        let currentMat = null;
                        let hasThicknessForMat = false;
                        
                        for (let v of rawVals) {
                            if (MaterialsDB[v]) {
                                if (currentMat && !hasThicknessForMat) {
                                    values.push(currentMat);
                                }
                                currentMat = v;
                                hasThicknessForMat = false;
                            } else if (!isNaN(parseFloat(v))) {
                                if (currentMat) {
                                    values.push(`${currentMat} (${parseFloat(v)}nm)`);
                                    hasThicknessForMat = true;
                                } else {
                                    alert("Thickness value '" + v + "' found before any material name for " + param);
                                    hasError = true;
                                    return;
                                }
                            } else {
                                alert("Invalid material or thickness: " + v);
                                hasError = true;
                                return;
                            }
                        }
                        if (currentMat && !hasThicknessForMat) {
                            values.push(currentMat);
                        }

                        if(values.length === 0) {
                            alert("Invalid or unknown materials for " + param + ". Please check your syntax.");
                            hasError = true;
                            return;
                        }
                    } else {
                        values = row.querySelector('.discrete-input').value
                            .split(',')
                            .map(v => parseFloat(v.trim()))
                            .filter(v => !isNaN(v));
                        if(values.length === 0) {
                            alert("Invalid numerical values for " + param);
                            hasError = true;
                            return;
                        }
                    }
                }
                
                if (values.length > 0) {
                    configs.push({ param, values });
                }
            });

            if (hasError || configs.length === 0) {
                document.getElementById('sweep-progress-container').style.display = 'none';
                return;
            }

            const hasDBRSweep = configs.some(c => c.param.startsWith('dbr_') || c.param.startsWith('d_mat_'));
            let baseLayers = JSON.parse(JSON.stringify(GeometryManager.layers));
            
            if (hasDBRSweep) {
                if (!confirm("Warning: Sweeping global or DBR parameters will regenerate the base structure (Incident Medium -> DBR -> Substrate). Manually added intermediate layers will be lost in this plot. Continue?")) {
                    return;
                }
                baseLayers = [baseLayers[0], baseLayers[baseLayers.length - 1]];
            }

            const fixedWav = parseFloat(document.getElementById('sweep-fixed-lambda').value);
            const fixedAng = parseFloat(document.getElementById('sweep-fixed-theta').value);
            if (isNaN(fixedWav) || isNaN(fixedAng)) {
                alert("Please enter valid base values for fixed parameters.");
                return;
            }

            const evalMode = document.getElementById('sweep-eval-mode').value;
            let innerScanConfig = null;
            if (evalMode !== 'fixed') {
                innerScanConfig = {
                    mode: evalMode === 'scan_theta' ? 'theta' : 'lambda',
                    min: parseFloat(document.getElementById('sweep-scan-min').value),
                    max: parseFloat(document.getElementById('sweep-scan-max').value),
                    steps: parseInt(document.getElementById('sweep-scan-steps').value, 10),
                    dn: parseFloat(document.getElementById('sweep-sens-dn').value),
                    layerIdx: document.getElementById('sweep-sens-layer').value
                };
            }

            this.worker.postMessage({
                sweepConfigs: configs,
                layers: baseLayers,
                materialsDB: JSON.parse(JSON.stringify(MaterialsDB)),
                dbrParams: JSON.parse(JSON.stringify(GeometryManager.dbrParams)),
                isDBRSweep: hasDBRSweep,
                polarization: document.getElementById('sweep-polarization')?.value || 'TM',
                fixedWavelength: fixedWav,
                fixedAngle: fixedAng,
                evalMode: evalMode,
                innerScanConfig: innerScanConfig
            });
        });

        document.getElementById('vis-plot-type').addEventListener('change', () => {
            this.updateVisualizationUI(false);
        });
        document.getElementById('vis-x').addEventListener('change', () => this.updateVisualizationUI(true));
        document.getElementById('vis-y').addEventListener('change', () => this.updateVisualizationUI(true));
        document.getElementById('vis-overlap').addEventListener('change', () => this.updateVisualizationUI(true));
        
        // Profile Explorer Events
        document.getElementById('sweep-slider-x').addEventListener('input', () => this.drawProfiles());
        document.getElementById('sweep-slider-y').addEventListener('input', () => this.drawProfiles());
        document.getElementById('btn-export-profile-horiz').addEventListener('click', () => this.exportProfileCSV('horizontal'));
        document.getElementById('btn-export-profile-vert').addEventListener('click', () => this.exportProfileCSV('vertical'));
        document.getElementById('toggle-sweep-profiles').addEventListener('change', (e) => {
            const explorer = document.getElementById('sweep-profile-explorer');
            if (explorer && this.lastRenderedData && this.lastRenderedData.plotType === '2d') {
                explorer.style.display = e.target.checked ? 'flex' : 'none';
                if (e.target.checked) this.drawProfiles();
            }
        });
        document.getElementById('vis-metric').addEventListener('change', () => this.updateVisualizationUI());
        document.getElementById('vis-line-style').addEventListener('change', () => this.plotData());
        
        document.getElementById('btn-sweep-export-csv').addEventListener('click', () => this.exportSweepCSV());
    },

    exportSweepCSV() {
        if (!this.lastSweepData || this.lastSweepData.results.length === 0) {
            alert("No sweep data available to export.");
            return;
        }

        const metrics = ['R', 'T', 'A', 'phaseR', 'phaseT', 'minR', 'fwhm', 'resPos', 'sensitivity'];
        const params = this.lastSweepData.sweepConfigs.map(c => c.param);
        
        let csv = params.join(',') + ',' + metrics.join(',') + '\n';
        
        this.lastSweepData.results.forEach(res => {
            let row = [];
            params.forEach(p => row.push(res.params[p]));
            metrics.forEach(m => row.push(res.metrics[m] !== undefined ? res.metrics[m] : ''));
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "parameter_sweep_data.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    updateVisualizationUI(preserveFilters = false) {
        if (!this.lastSweepData) return;
        const variedParams = this.lastSweepData.sweepConfigs.map(c => c.param);
        const metric = document.getElementById('vis-metric').value;
        const is2d = document.getElementById('vis-plot-type').value === '2d';
        
        const metricLabel = document.getElementById('vis-metric').options[document.getElementById('vis-metric').selectedIndex].text;
        
        document.getElementById('vis-group-label').innerText = is2d ? 'Z Axis (Color)' : 'Overlap / Group By';
        
        const xSel = document.getElementById('vis-x');
        const ySel = document.getElementById('vis-y');
        const overSel = document.getElementById('vis-overlap');
        
        if (!preserveFilters) {
            let opts = `<option value="metric_${metric}">${metricLabel}</option>`;
            variedParams.forEach(p => opts += `<option value="param_${p}">Parameter: ${p}</option>`);
            
            xSel.innerHTML = opts;
            ySel.innerHTML = opts;
            
            let overOpts = is2d ? '' : '<option value="none">None</option>';
            overOpts += opts;
            overSel.innerHTML = overOpts;
            
            xSel.value = `param_${variedParams[0]}`;
            if (is2d) {
                ySel.value = variedParams.length > 1 ? `param_${variedParams[1]}` : `param_${variedParams[0]}`;
                overSel.value = `metric_${metric}`;
            } else {
                ySel.value = `metric_${metric}`;
                overSel.value = variedParams.length > 1 ? `param_${variedParams[1]}` : 'none';
            }
        }

        const currX = xSel.value;
        const currY = ySel.value;
        const currOver = overSel.value;
        const filterContainer = document.getElementById('vis-filters-container');
        filterContainer.innerHTML = '';

        variedParams.forEach(p => {
            const pKey = `param_${p}`;
            if (pKey !== currX && pKey !== currY && pKey !== currOver) {
                const values = [...new Set(this.lastSweepData.results.map(r => r.params[p]))];
                values.sort((a,b) => (typeof a === 'string' ? a.localeCompare(b) : a - b));
                let filterHtml = `<div><label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Fix ${p}</label>
                                  <select class="vis-filter vis-control" data-param="${p}" style="padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">`;
                values.forEach(v => filterHtml += `<option value="${v}">${typeof v === 'string' ? v : (Number.isInteger(v) ? v : v.toFixed(4))}</option>`);
                filterHtml += `</select></div>`;
                filterContainer.insertAdjacentHTML('beforeend', filterHtml);
            }
        });

        document.querySelectorAll('.vis-filter').forEach(el => el.addEventListener('change', () => this.plotData()));
        this.plotData();
    },

    plotData() {
        const data = this.lastSweepData;
        if (!data || data.results.length === 0) return;

        const plotType = document.getElementById('vis-plot-type').value;
        const metric = document.getElementById('vis-metric').value;
        const xSel = document.getElementById('vis-x').value;
        const ySel = document.getElementById('vis-y').value;
        const overSel = document.getElementById('vis-overlap').value;
        const lineStyle = document.getElementById('vis-line-style').value;
        
        const getValue = (row, key) => {
            if (key.startsWith('param_')) return row.params[key.substring(6)];
            if (key.startsWith('metric_')) return row.metrics[key.substring(7)];
            return null;
        };

        const filters = {};
        document.querySelectorAll('.vis-filter').forEach(el => {
            const p = el.dataset.param;
            filters[p] = p.startsWith('mat_') ? el.value : parseFloat(el.value);
        });

        let filtered = data.results.filter(r => {
            for (let p in filters) {
                if (p.startsWith('mat_')) {
                    if (r.params[p] !== filters[p]) return false;
                } else {
                    if (Math.abs(r.params[p] - filters[p]) > 1e-6) return false;
                }
            }
            return true;
        });

        const sortFunc = (a, b) => (typeof a === 'string' ? a.localeCompare(b) : a - b);

        const tc = window.getPlotThemeColors();
        const layout = {
            title: `Parameter Sweep`,
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: xSel.replace('param_','').replace('metric_',''), gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: ySel.replace('param_','').replace('metric_',''), gridcolor: tc.grid, zerolinecolor: tc.grid },
            margin: { t: 40, r: 20, l: 60, b: 40 },
            showlegend: true
        };
        const traces = [];

        if (plotType === '1d') {
            if (overSel === 'none') {
                filtered.sort((a, b) => sortFunc(getValue(a, xSel), getValue(b, xSel)));
                traces.push({
                    x: filtered.map(r => getValue(r, xSel)),
                    y: filtered.map(r => getValue(r, ySel)),
                    type: 'scatter', mode: lineStyle, line: { width: 3 }
                });
            } else {
                const groups = {};
                filtered.forEach(r => {
                    const overVal = getValue(r, overSel);
                    if (!groups[overVal]) groups[overVal] = [];
                    groups[overVal].push(r);
                });

                for (let overVal in groups) {
                    groups[overVal].sort((a, b) => sortFunc(getValue(a, xSel), getValue(b, xSel)));
                    traces.push({
                        x: groups[overVal].map(r => getValue(r, xSel)),
                        y: groups[overVal].map(r => getValue(r, ySel)),
                        name: `${overSel.replace('param_','')} = ${typeof overVal === 'string' && isNaN(parseFloat(overVal)) ? overVal : Number(parseFloat(overVal).toFixed(4))}`,
                        type: 'scatter', mode: lineStyle, line: { width: 2 }
                    });
                }
            }
        } else if (plotType === '2d') {
            const xValues = [...new Set(filtered.map(r => getValue(r, xSel)))].sort(sortFunc);
            const yValues = [...new Set(filtered.map(r => getValue(r, ySel)))].sort(sortFunc);
            
            if (xValues.length * yValues.length > 250000) {
                alert("Too many unique X/Y combinations for a 2D Heatmap (Grid size: " + xValues.length + " x " + yValues.length + "). Please select discrete sweep parameters for X and Y axes, or reduce your sweep resolution.");
                return;
            }

            const fastLookup = new Map();
            filtered.forEach(r => {
                const rX = getValue(r, xSel);
                const rY = getValue(r, ySel);
                const kX = typeof rX === 'number' ? rX.toFixed(6) : String(rX);
                const kY = typeof rY === 'number' ? rY.toFixed(6) : String(rY);
                fastLookup.set(`${kX}_|_${kY}`, r);
            });

            const zMatrix = yValues.map(yVal => {
                const kY = typeof yVal === 'number' ? yVal.toFixed(6) : String(yVal);
                return xValues.map(xVal => {
                    const kX = typeof xVal === 'number' ? xVal.toFixed(6) : String(xVal);
                    const point = fastLookup.get(`${kX}_|_${kY}`);
                    return point ? getValue(point, overSel) : null;
                });
            });

            traces.push({
                z: zMatrix,
                x: xValues,
                y: yValues,
                type: 'heatmap',
                colorscale: 'Viridis'
            });
        }

        Plotly.newPlot('sweep-plot', traces, layout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['sweep-plot'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };

        const explorer = document.getElementById('sweep-profile-explorer');
        const toggleContainer = document.getElementById('toggle-sweep-profiles-container');
        const toggleCheckbox = document.getElementById('toggle-sweep-profiles');

        if (plotType === '2d' && traces.length > 0) {
            if (toggleContainer) toggleContainer.style.display = 'flex';
            if (explorer) explorer.style.display = (toggleCheckbox && toggleCheckbox.checked) ? 'flex' : 'none';
            this.lastRenderedData = {
                plotType: '2d', 
                xVals: traces[0].x, 
                yVals: traces[0].y, 
                zMat: traces[0].z,
                xTitle: (layout.xaxis.title && layout.xaxis.title.text) ? layout.xaxis.title.text : (layout.xaxis.title || 'X'), 
                yTitle: (layout.yaxis.title && layout.yaxis.title.text) ? layout.yaxis.title.text : (layout.yaxis.title || 'Y'), 
                zTitle: overSel.replace('param_','').replace('metric_','')
            };
            document.getElementById('sweep-slider-x').max = traces[0].x.length - 1;
            document.getElementById('sweep-slider-y').max = traces[0].y.length - 1;
            
            const curX = parseInt(document.getElementById('sweep-slider-x').value) || 0;
            const curY = parseInt(document.getElementById('sweep-slider-y').value) || 0;
            if (curX >= traces[0].x.length) document.getElementById('sweep-slider-x').value = Math.floor(traces[0].x.length/2);
            if (curY >= traces[0].y.length) document.getElementById('sweep-slider-y').value = Math.floor(traces[0].y.length/2);
            
            if (toggleCheckbox && toggleCheckbox.checked) {
                this.drawProfiles();
            }
        } else {
            if (toggleContainer) toggleContainer.style.display = 'none';
            if (explorer) explorer.style.display = 'none';
            this.lastRenderedData = null;
        }
    },


    drawProfiles() {
        if (!this.lastRenderedData || this.lastRenderedData.plotType !== '2d') return;
        
        const xIdx = parseInt(document.getElementById('sweep-slider-x').value);
        const yIdx = parseInt(document.getElementById('sweep-slider-y').value);
        
        const { xVals, yVals, zMat, xTitle, yTitle, zTitle } = this.lastRenderedData;
        
        if (!xVals || !yVals || !zMat || isNaN(xIdx) || isNaN(yIdx)) return;

        const xVal = xVals[xIdx];
        const yVal = yVals[yIdx];

        const xTitleClean = xTitle || 'X';
        const yTitleClean = yTitle || 'Y';

        document.getElementById('sweep-val-x-label').innerText = `(${xTitleClean} = ${xVal.toFixed(4)})`;
        document.getElementById('sweep-val-y-label').innerText = `(${yTitleClean} = ${yVal.toFixed(4)})`;

        // Let's modify the parent element's innerHTML slightly to remove the hardcoded 'at X =' and 'at Y ='
        // because we are injecting the actual axis names now.
        const yLabelSpan = document.getElementById('sweep-val-y-label');
        if (yLabelSpan && yLabelSpan.parentElement) {
            const parent = yLabelSpan.parentElement;
            parent.childNodes[0].textContent = "Horizontal Slice ";
        }
        const xLabelSpan = document.getElementById('sweep-val-x-label');
        if (xLabelSpan && xLabelSpan.parentElement) {
            const parent = xLabelSpan.parentElement;
            parent.childNodes[0].textContent = "Vertical Slice ";
        }

        const horizZ = zMat[yIdx]; // The entire row
        const vertZ = zMat.map(row => row[xIdx]); // The column
        
        const tc = window.getPlotThemeColors();
        const cStyle = window.getCSSColor('--accent-blue') || '#3b82f6';
        const cStyle2 = window.getCSSColor('--accent-green') || '#10b981';

        Plotly.react('sweep-profile-horiz-plot', [{
            x: xVals, y: horizZ, type: 'scatter', mode: 'lines', line: { color: cStyle, width: 2 }
        }], {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            margin: { t: 10, r: 10, l: 50, b: 40 },
            xaxis: { gridcolor: tc.grid, title: xTitle },
            yaxis: { gridcolor: tc.grid, title: zTitle }
        });

        Plotly.react('sweep-profile-vert-plot', [{
            x: yVals, y: vertZ, type: 'scatter', mode: 'lines', line: { color: cStyle2, width: 2 }
        }], {
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            margin: { t: 10, r: 10, l: 50, b: 40 },
            xaxis: { gridcolor: tc.grid, title: yTitle },
            yaxis: { gridcolor: tc.grid, title: zTitle }
        });

        // Update crosshairs
        const mainPlot = document.getElementById('sweep-plot');
        if (mainPlot.layout) {
            const crosshairColor = root.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
            const shapes = [
                { type: 'line', x0: xVal, x1: xVal, y0: yVals[0], y1: yVals[yVals.length-1], line: { color: crosshairColor, width: 1, dash: 'dot' } },
                { type: 'line', x0: xVals[0], x1: xVals[xVals.length-1], y0: yVal, y1: yVal, line: { color: crosshairColor, width: 1, dash: 'dot' } }
            ];
            Plotly.relayout(mainPlot, { shapes: shapes });
        }
    },

    exportProfileCSV(type) {
        if (!this.lastRenderedData || this.lastRenderedData.plotType !== '2d') return;
        
        const xIdx = parseInt(document.getElementById('sweep-slider-x').value);
        const yIdx = parseInt(document.getElementById('sweep-slider-y').value);
        const { xVals, yVals, zMat, xTitle, yTitle, zTitle } = this.lastRenderedData;
        
        let csvContent = "data:text/csv;charset=utf-8,";
        let filename = "";

        if (type === 'horizontal') {
            const yVal = yVals[yIdx];
            csvContent += `${xTitle},${zTitle}\n`;
            const row = zMat[yIdx];
            for (let i = 0; i < xVals.length; i++) {
                csvContent += `${xVals[i]},${row[i]}\n`;
            }
            filename = `horizontal_profile_Y_${yVal.toFixed(2)}.csv`;
        } else {
            const xVal = xVals[xIdx];
            csvContent += `${yTitle},${zTitle}\n`;
            const col = zMat.map(r => r[xIdx]);
            for (let i = 0; i < yVals.length; i++) {
                csvContent += `${yVals[i]},${col[i]}\n`;
            }
            filename = `vertical_profile_X_${xVal.toFixed(2)}.csv`;
        }

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
};
