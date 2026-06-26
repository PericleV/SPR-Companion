import { GeometryManager } from './tab2Geometry.js?v=53';

export const AnalysisManager = {
    container: null,
    
    // UI Elements
    modeSelect: null,
    configsSelect: null,
    btnRunAnalysis: null,
    plotContainer: null,

    // Internal State
    baselineConfig: null, // Pentru Differential Mode

    init(tmmWorker) {
        this.container = document.getElementById('analysis-container');
        if (!this.container) return;

        // Nu avem nevoie de worker propriu deocamdată, ne bazăm pe istoricul salvat de Tab 3 
        // sau rulăm sincron dacă e nevoie de o simulare rapidă.

        this.renderUI();
        this.bindEvents();
        
        // Ascultăm când se schimbă tab-ul pentru a reîmprospăta lista de configurații
        const navLinks = document.querySelectorAll('.nav-links li');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (link.getAttribute('data-target') === 'tab-analysis') {
                    this.refreshConfigsList();
                }
            });
        });
    },

    renderUI() {
        this.container.innerHTML = `
            <div class="mobile-stack-row" style="display: flex; gap: 20px; height: 100%; min-height: 600px;">
                
                <!-- Left Panel: Controls -->
                <div style="flex: 0 0 300px; display: flex; flex-direction: column; gap: 15px; background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); overflow-y: auto;">
                    <h3 style="margin-bottom: 10px; color: var(--text-main); font-size: 1.1rem;"><i class="fa-solid fa-microscope text-warning" style="margin-right: 8px;"></i>Analysis Mode</h3>
                    
                    <div class="form-group">
                        <label>Select Tool</label>
                        <select id="analysis-mode" class="input-modern" style="width: 100%;">
                            <option value="compare">Overlay Comparison (R, T, A)</option>
                            <option value="derivatives">Derivative Spectroscopy (1st & 2nd)</option>
                            <option value="phase">Phase & Group Delay (GVD)</option>
                            <option value="differential">Differential Signal (\u0394R)</option>
                        </select>
                    </div>

                    <hr style="border: none; border-top: 1px solid var(--border-color); margin: 5px 0;">

                    <h3 style="margin-bottom: 5px; color: var(--text-main); font-size: 1.1rem;"><i class="fa-solid fa-folder-open" style="margin-right: 8px;"></i>Workspace Configurations</h3>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0;">Configs are automatically saved here when you run a simulation in Tab 3.</p>

                    <div id="analysis-configs-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; max-height: 250px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; background: var(--bg-main);">
                        <!-- Injected dynamically -->
                    </div>
                    
                    <div id="baseline-selector-container" style="display: none; flex-direction: column; gap: 5px;">
                        <label style="font-size: 0.85rem; color: var(--accent-blue); font-weight: bold;">Select Baseline (for \u0394R)</label>
                        <select id="analysis-baseline" class="input-modern" style="width: 100%;"></select>
                    </div>

                    <div style="flex-grow: 1;"></div>
                    
                    <button id="btn-run-analysis" class="btn-primary" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px; font-size: 1.05rem; padding: 12px;">
                        <i class="fa-solid fa-chart-line"></i> Generate Analysis
                    </button>
                    <button id="btn-clear-workspace" class="btn-danger" style="width: 100%; margin-top: 10px;">
                        <i class="fa-solid fa-trash"></i> Clear Workspace
                    </button>
                </div>

                <!-- Right Panel: Plot -->
                <div style="flex: 1; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); padding: 20px; display: flex; flex-direction: column;">
                    <div id="analysis-plot" style="flex: 1; width: 100%; min-height: 500px;"></div>
                </div>

            </div>
        `;

        this.modeSelect = document.getElementById('analysis-mode');
        this.btnRunAnalysis = document.getElementById('btn-run-analysis');
        this.plotContainer = document.getElementById('analysis-plot');
    },

    bindEvents() {
        this.modeSelect.addEventListener('change', () => {
            const baselineContainer = document.getElementById('baseline-selector-container');
            if (this.modeSelect.value === 'differential') {
                baselineContainer.style.display = 'flex';
            } else {
                baselineContainer.style.display = 'none';
            }
        });

        this.btnRunAnalysis.addEventListener('click', () => this.runAnalysis());
        
        document.getElementById('btn-clear-workspace').addEventListener('click', () => {
            window.SimulationHistory = {};
            this.refreshConfigsList();
            Plotly.purge(this.plotContainer);
        });
    },

    refreshConfigsList() {
        const listDiv = document.getElementById('analysis-configs-list');
        const baselineSelect = document.getElementById('analysis-baseline');
        
        listDiv.innerHTML = '';
        baselineSelect.innerHTML = '';
        
        const history = window.SimulationHistory || {};
        const keys = Object.keys(history);

        if (keys.length === 0) {
            listDiv.innerHTML = '<span style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">No configurations saved. Run a simulation in Tab 3 first.</span>';
            return;
        }

        keys.forEach(k => {
            const itemHtml = `
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 5px; background: var(--bg-card-hover); border-radius: 4px;">
                    <input type="checkbox" class="config-checkbox" value="${k}" checked>
                    <span style="font-size: 0.9rem; color: var(--text-main);">${k}</span>
                </label>
            `;
            listDiv.insertAdjacentHTML('beforeend', itemHtml);
            
            const option = document.createElement('option');
            option.value = k;
            option.textContent = k;
            baselineSelect.appendChild(option);
        });
    },

    getSelectedConfigs() {
        const checkboxes = document.querySelectorAll('.config-checkbox:checked');
        const selected = [];
        checkboxes.forEach(cb => {
            if (window.SimulationHistory[cb.value]) {
                selected.push(window.SimulationHistory[cb.value]);
            }
        });
        return selected;
    },

    runAnalysis() {
        const mode = this.modeSelect.value;
        const configs = this.getSelectedConfigs();
        
        if (configs.length === 0) {
            alert("Please select at least one configuration to analyze.");
            return;
        }

        Plotly.purge(this.plotContainer);

        switch (mode) {
            case 'compare':
                this.plotComparison(configs);
                break;
            case 'derivatives':
                this.plotDerivatives(configs);
                break;
            case 'phase':
                this.plotPhase(configs);
                break;
            case 'differential':
                this.plotDifferential(configs);
                break;
        }
    },

    getCommonLayout(title, xTitle, yTitle) {
        const theme = window.getPlotThemeColors();
        return {
            title: { text: title, font: { color: theme.text } },
            paper_bgcolor: theme.bg,
            plot_bgcolor: theme.bg,
            font: { color: theme.text },
            xaxis: { title: xTitle, gridcolor: theme.grid, zerolinecolor: theme.grid },
            yaxis: { title: yTitle, gridcolor: theme.grid, zerolinecolor: theme.grid },
            margin: { l: 60, r: 40, t: 60, b: 60 },
            hovermode: 'closest',
            legend: { font: { color: theme.text }, bgcolor: 'transparent' }
        };
    },

    plotComparison(configs) {
        const traces = [];
        const theme = window.getPlotThemeColors();
        
        let xTitle = "Variable";
        let yTitle = "Reflectance (R)";

        configs.forEach((cfg, idx) => {
            xTitle = cfg.variable === 'theta' ? 'Angle (\u00B0)' : 'Wavelength (nm)';
            
            traces.push({
                x: cfg.x,
                y: cfg.fullResults.R, // Default overlay Reflectance
                mode: 'lines',
                name: `${cfg.name} (R)`,
                line: { width: 2 }
            });
            
            // Daca vrem sa afisam si Transmisia, o punem intr-o linie intrerupta
            // traces.push({
            //     x: cfg.x,
            //     y: cfg.fullResults.T,
            //     mode: 'lines',
            //     name: `${cfg.name} (T)`,
            //     line: { width: 2, dash: 'dash' }
            // });
        });

        const layout = this.getCommonLayout('Overlay Comparison (Reflectance)', xTitle, yTitle);
        Plotly.newPlot(this.plotContainer, traces, layout, { responsive: true, displaylogo: false });
    },

    plotDerivatives(configs) {
        const traces = [];
        let xTitle = "Variable";

        configs.forEach((cfg, idx) => {
            xTitle = cfg.variable === 'theta' ? 'Angle (\u00B0)' : 'Wavelength (nm)';
            const x = cfg.x;
            const y = cfg.fullResults.R; // Calculam derivata pe R
            
            const dx = [];
            const dy1 = []; // Prima derivata
            const dy2 = []; // A doua derivata

            for (let i = 1; i < x.length - 1; i++) {
                const h1 = x[i] - x[i-1];
                const h2 = x[i+1] - x[i];
                const h = (h1 + h2) / 2; // approximation for non-uniform spacing just in case, but usually uniform
                
                // Central difference
                const dev1 = (y[i+1] - y[i-1]) / (2 * h);
                const dev2 = (y[i+1] - 2*y[i] + y[i-1]) / (h * h);
                
                dx.push(x[i]);
                dy1.push(dev1);
                dy2.push(dev2);
            }

            traces.push({
                x: dx,
                y: dy1,
                mode: 'lines',
                name: `${cfg.name} (1st Deriv dR/dx)`,
                line: { width: 2 }
            });
            
            traces.push({
                x: dx,
                y: dy2,
                mode: 'lines',
                name: `${cfg.name} (2nd Deriv d\u00B2R/dx\u00B2)`,
                yaxis: 'y2',
                line: { width: 2, dash: 'dot' }
            });
        });

        const layout = this.getCommonLayout('Derivative Spectroscopy', xTitle, '1st Derivative');
        layout.yaxis2 = {
            title: '2nd Derivative',
            overlaying: 'y',
            side: 'right',
            gridcolor: window.getPlotThemeColors().grid
        };
        
        Plotly.newPlot(this.plotContainer, traces, layout, { responsive: true, displaylogo: false });
    },

    unwrapPhase(phaseArray) {
        let unwrapped = [phaseArray[0]];
        let offset = 0;
        for (let i = 1; i < phaseArray.length; i++) {
            let diff = phaseArray[i] - phaseArray[i-1];
            if (diff > Math.PI) offset -= 2 * Math.PI;
            else if (diff < -Math.PI) offset += 2 * Math.PI;
            unwrapped.push(phaseArray[i] + offset);
        }
        return unwrapped;
    },

    plotPhase(configs) {
        const traces = [];
        let xTitle = "Variable";

        const C_NM_S = 299792458 * 1e9; // viteza luminii in nm/s

        configs.forEach((cfg) => {
            xTitle = cfg.variable === 'theta' ? 'Angle (\u00B0)' : 'Wavelength (nm)';
            const x = cfg.x;
            const phase = this.unwrapPhase(cfg.fullResults.phaseR);
            
            traces.push({
                x: x,
                y: phase,
                mode: 'lines',
                name: `${cfg.name} (\u03A6)`,
                line: { width: 2 }
            });

            // Daca sweep-ul e pe lungime de unda, putem aproxima Group Delay
            if (cfg.variable === 'lambda') {
                const gd_x = [];
                const gd_y = []; // in femtosecunde
                
                for (let i = 1; i < x.length - 1; i++) {
                    const h = (x[i+1] - x[i-1]) / 2;
                    const dPhi_dLambda = (phase[i+1] - phase[i-1]) / (2 * h);
                    
                    // omega = 2 * PI * c / lambda
                    // d(omega)/d(lambda) = -2 * PI * c / lambda^2
                    // GD = d(Phi)/d(omega) = d(Phi)/d(lambda) / (d(omega)/d(lambda))
                    
                    const lambda = x[i];
                    const dOmega_dLambda = - (2 * Math.PI * C_NM_S) / (lambda * lambda);
                    const GD_seconds = dPhi_dLambda / dOmega_dLambda; 
                    const GD_fs = GD_seconds * 1e15; // conversie in femtosecunde

                    gd_x.push(lambda);
                    gd_y.push(GD_fs);
                }

                traces.push({
                    x: gd_x,
                    y: gd_y,
                    mode: 'lines',
                    name: `${cfg.name} (Group Delay)`,
                    yaxis: 'y2',
                    line: { width: 2, dash: 'dash' }
                });
            }
        });

        const layout = this.getCommonLayout('Phase & Group Delay', xTitle, 'Phase (rad)');
        if (configs.some(c => c.variable === 'lambda')) {
            layout.yaxis2 = {
                title: 'Group Delay (fs)',
                overlaying: 'y',
                side: 'right',
                gridcolor: window.getPlotThemeColors().grid
            };
        }

        Plotly.newPlot(this.plotContainer, traces, layout, { responsive: true, displaylogo: false });
    },

    plotDifferential(configs) {
        const baselineName = document.getElementById('analysis-baseline').value;
        const baselineCfg = window.SimulationHistory[baselineName];

        if (!baselineCfg) {
            alert("Please select a valid baseline configuration.");
            return;
        }

        const traces = [];
        let xTitle = baselineCfg.variable === 'theta' ? 'Angle (\u00B0)' : 'Wavelength (nm)';

        configs.forEach((cfg) => {
            if (cfg.name === baselineName) return; // nu comparam baseline-ul cu el insusi
            
            // Asumam ca array-ul x are aceeasi lungime si scara (Sweep identic)
            // Pentru precizie maxima ar trebui interpolat, dar in 99% din cazuri sweep-ul e la fel.
            if (cfg.x.length !== baselineCfg.x.length) {
                console.warn(`Sweep resolution mismatch for ${cfg.name} vs Baseline.`);
                return;
            }

            const diffY = [];
            for(let i=0; i<cfg.x.length; i++) {
                diffY.push(cfg.fullResults.R[i] - baselineCfg.fullResults.R[i]);
            }

            traces.push({
                x: cfg.x,
                y: diffY,
                mode: 'lines',
                name: `\u0394R: ${cfg.name} - ${baselineName}`,
                line: { width: 2 }
            });
        });

        if (traces.length === 0) {
            alert("No configuration selected other than the baseline itself.");
            return;
        }

        const layout = this.getCommonLayout('Differential Signal (\u0394R)', xTitle, '\u0394 Reflectance (a.u.)');
        Plotly.newPlot(this.plotContainer, traces, layout, { responsive: true, displaylogo: false });
    }
};

