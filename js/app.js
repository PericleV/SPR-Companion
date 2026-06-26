import { MaterialsManager } from './ui/tab1Materials.js?v=50';
import { GeometryManager } from './ui/tab2Geometry.js?v=50';
import { SimulationManager } from './ui/tab3Simulation.js?v=50';
import { SweepManager } from './ui/tab4Sweep.js?v=50';
import { OptimizationManager } from './ui/tab5Optimization.js?v=50';
import { WorkspaceManager } from './ui/workspaceManager.js?v=50';

document.addEventListener('DOMContentLoaded', () => {
    
    console.log("🚀 Initializing SPR Companion...");

    // Initialize Global Registry Buffers
    window.PlotRegistry = window.PlotRegistry || {};
    window.SimulationHistory = window.SimulationHistory || {};
    
    // --- Global Tooltip Setup ---
    const globalTooltip = document.createElement('div');
    globalTooltip.className = 'global-tooltip-box';
    document.body.appendChild(globalTooltip);

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('.custom-tooltip');
        if (!target) return;
        
        const text = target.getAttribute('data-tooltip');
        if (!text) return;
        
        globalTooltip.textContent = text;
        
        // Need to temporarily show it to get accurate dimensions
        globalTooltip.style.visibility = 'hidden';
        globalTooltip.classList.add('show');
        
        const rect = target.getBoundingClientRect();
        const ttWidth = globalTooltip.offsetWidth;
        const ttHeight = globalTooltip.offsetHeight;
        
        let top = rect.top - ttHeight - 10;
        let left = rect.left + (rect.width / 2) - (ttWidth / 2);
        
        globalTooltip.classList.remove('bottom-arrow');
        if (top < 10) {
            top = rect.bottom + 10;
            globalTooltip.classList.add('bottom-arrow');
        }
        
        if (left < 10) left = 10;
        if (left + ttWidth > window.innerWidth - 10) {
            left = window.innerWidth - ttWidth - 10;
        }
        
        globalTooltip.style.top = top + 'px';
        globalTooltip.style.left = left + 'px';
        globalTooltip.style.visibility = ''; // restore normal visibility cascade
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.custom-tooltip')) {
            globalTooltip.classList.remove('show');
        }
    });
    
    window.addEventListener('scroll', () => {
        if (globalTooltip.classList.contains('show')) globalTooltip.classList.remove('show');
    }, true);
    // ----------------------------
    
    window.getCSSColor = function(varName) {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    };
    
    window.getPlotThemeColors = function() {
        return {
            bg: window.getCSSColor('--plot-bg'),
            grid: window.getCSSColor('--plot-grid'),
            text: window.getCSSColor('--plot-text')
        };
    };

    // 1. Initialize Web Workers
    const tmmWorker = new Worker('./js/workers/tmm.worker.js?v=50', { type: 'module' });
    tmmWorker.onmessage = function(e) {
        if (e.data.type === 'error') {
            console.error("TMM Worker Exception:", e.data.stack);
            alert("Worker Error: " + e.data.message);
            document.getElementById('status-indicator').innerHTML = '<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> Simulation Failed';
        } else if (e.data.type === 'result1D' && typeof SimulationManager.handleWorkerResult === 'function') {
            SimulationManager.handleWorkerResult(e.data);
            document.getElementById('status-indicator').innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Simulation Complete';
        }
    };
    tmmWorker.onerror = (err) => console.error("TMM Worker Error:", err);

    const sweepWorker = new Worker('./js/workers/sweep.worker.js?v=50', { type: 'module' });
    sweepWorker.onmessage = function(e) {
        if (['resultSweep', 'sweepProgress', 'sweepDone'].includes(e.data.type) && typeof SweepManager.handleWorkerResult === 'function') {
            SweepManager.handleWorkerResult(e.data);
            if (e.data.type === 'sweepDone') {
                document.getElementById('status-indicator').innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Sweep Complete';
            }
        }
    };
    sweepWorker.onerror = (err) => console.error("Sweep Worker Error:", err);

    // --- INITIALIZE THEME FIRST ---
    const themeToggleBtn = document.getElementById('btn-theme-toggle');
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('theme') || 'dark';
    
    if (savedTheme === 'light') {
        root.setAttribute('data-theme', 'light');
        if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun" style="color: #f59e0b;"></i> Switch';
        const label = document.getElementById('theme-label');
        if (label) label.innerText = 'Theme: Light';
    }

    // 2. Initialize Modules (Tabs)
    try { MaterialsManager.init(); } catch(e) { console.error("Error initializing Materials:", e); }
    try { GeometryManager.init(); } catch(e) { console.error("Error initializing Geometry:", e); }
    try { SimulationManager.init(tmmWorker); } catch(e) { console.error("Error initializing Simulation:", e); }
    try { SweepManager.init(sweepWorker); } catch(e) { console.error("Error initializing Sweep:", e); }
    try { OptimizationManager.init(); } catch(e) { console.error("Error initializing Optimization:", e); }
    try { WorkspaceManager.init(); } catch(e) { console.error("Error initializing WorkspaceManager:", e); }

    // --- THEME TOGGLE LOGIC (Events) ---
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDark = !root.hasAttribute('data-theme') || root.getAttribute('data-theme') === 'dark';
            if (isDark) {
                root.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
                themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun" style="color: #f59e0b;"></i> Switch';
                const label = document.getElementById('theme-label');
                if (label) label.innerText = 'Theme: Light';
            } else {
                root.removeAttribute('data-theme');
                localStorage.setItem('theme', 'dark');
                themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i> Switch';
                const label = document.getElementById('theme-label');
                if (label) label.innerText = 'Theme: Dark';
            }
            updatePlotlyThemes();
        });
    }

    function updatePlotlyThemes() {
        const colors = window.getPlotThemeColors();
        if (window.PlotRegistry) {
            Object.keys(window.PlotRegistry).forEach(graphId => {
                const gd = document.getElementById(graphId);
                if (gd && window.PlotRegistry[graphId].layout) {
                    const layoutUpdate = {
                        paper_bgcolor: colors.bg,
                        plot_bgcolor: colors.bg,
                        font: { color: colors.text },
                        'xaxis.gridcolor': colors.grid,
                        'xaxis.zerolinecolor': colors.grid,
                        'yaxis.gridcolor': colors.grid,
                        'yaxis.zerolinecolor': colors.grid
                    };
                    Plotly.relayout(gd, layoutUpdate).catch(e => console.log('Graph not ready:', e));
                }
            });
        }
    }

    // --- GLOBAL CONFIGURATION BAR LOGIC (DBR Auto-Compression) ---
    const updateGlobalConfigBar = () => {
        const stackContainer = document.getElementById('global-config-stack');
        if (!stackContainer || !GeometryManager.layers) return;

        const layers = GeometryManager.layers;
        if (layers.length < 2) return;

        // Check if active configuration is optimized
        const nameInput = document.getElementById('config-name-input');
        const configName = nameInput ? nameInput.value.trim() : 'Configuration';
        const isOptimized = configName.includes('(optimized)');
        const baseName = configName.replace(' (optimized)', '');
        
        const configLabel = document.querySelector('.global-config-bar .config-label');
        if (configLabel) {
            if (isOptimized) {
                configLabel.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right: 8px;"></i> Structure: <span style="font-weight: 700; margin-left: 6px; color: var(--text-main);">${baseName}</span> <span style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; margin-left: 10px; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); border: 1px solid rgba(255,255,255,0.2); display: inline-flex; align-items: center; gap: 4px; text-transform: uppercase;"><i class="fa-solid fa-bolt"></i> Optimized</span>`;
            } else {
                configLabel.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right: 8px;"></i> Structure: <span style="font-weight: 700; margin-left: 6px; color: var(--text-main);">${baseName}</span>`;
            }
        }

        let compressed = [];
        let i = 1; // Start after the incident layer

        // Greedy algorithm to detect repeating sequences (DBR stack)
        while (i < layers.length - 1) {
            let bestPeriod = 1;
            let bestSeqLen = 1;
            let maxSearchLen = Math.min(5, Math.floor((layers.length - 1 - i) / 2));

            for (let seqLen = 1; seqLen <= maxSearchLen; seqLen++) {
                let periods = 1;
                while (i + (periods + 1) * seqLen <= layers.length - 1) {
                    let match = true;
                    for (let j = 0; j < seqLen; j++) {
                        if (layers[i + j].material !== layers[i + periods * seqLen + j].material) {
                            match = false; break;
                        }
                    }
                    if (match) periods++;
                    else break;
                }
                if (periods > bestPeriod) {
                    bestPeriod = periods;
                    bestSeqLen = seqLen;
                }
            }

            if (bestPeriod > 1) {
                compressed.push({ isGroup: true, sequence: layers.slice(i, i + bestSeqLen), periods: bestPeriod });
                i += bestPeriod * bestSeqLen;
            } else {
                compressed.push({ isGroup: false, layer: layers[i], originalIndex: i });
                i++;
            }
        }

        // Generate the visual representation (HTML) of the compressed stack
        let html = `
            <div class="layer-pill incident" title="Incident Wave">
                <span class="layer-color-dot" style="background-color: ${layers[0].color};"></span>
                <span style="font-weight: 600;">${layers[0].material}</span> <span style="opacity:0.5; font-size:0.75rem; font-weight:normal; margin-left:2px;">(Incident)</span>
            </div>
            <i class="fa-solid fa-angle-right layer-arrow"></i>
        `;

        compressed.forEach((item) => {
            if (item.isGroup) {
                const matNames = item.sequence.map(l => l.material).join(' / ');
                const colors = item.sequence.map(l => l.color);
                const bgGradient = colors.length >= 2 ? `linear-gradient(90deg, ${colors[0]} 50%, ${colors[1]} 50%)` : colors[0];
                
                html += `
                    <div class="layer-pill" title="Periodic DBR Structure" style="border-color: rgba(147, 51, 234, 0.3); background: linear-gradient(135deg, rgba(147, 51, 234, 0.1), rgba(147, 51, 234, 0.02));">
                        <span class="layer-color-dot" style="background: ${bgGradient};"></span>
                        <b style="color: #c084fc;">[ ${matNames} ] &times; ${item.periods}</b>
                    </div>
                `;
            } else {
                const layer = item.layer;
                let label = `<span style="font-weight: 600;">${layer.material}</span>`;
                if (layer.label.trim() !== '') label += ` <span style="opacity:0.5; font-size:0.75rem; font-weight:normal; margin-left:2px;">(${layer.label})</span>`;
                else label += layer.type === '2d' ? ` <span style="opacity:0.5; font-size:0.75rem; font-weight:normal; margin-left:2px;">(${layer.count}x)</span>` : ` <span style="opacity:0.5; font-size:0.75rem; font-weight:normal; margin-left:2px;">(${Number(layer.d).toFixed(2).replace(/\.?0+$/, '')} nm)</span>`;

                html += `
                    <div class="layer-pill" title="Individual Layer">
                        <span class="layer-color-dot" style="background-color: ${layer.color};"></span>
                        ${label}
                    </div>
                `;
            }
            html += `<i class="fa-solid fa-angle-right layer-arrow"></i>`;
        });

        // Final Substrate
        const sub = layers[layers.length - 1];
        html += `
            <div class="layer-pill substrate" title="Substrate / Exit">
                <span class="layer-color-dot" style="background-color: ${sub.color};"></span>
                <span style="font-weight: 600;">${sub.material}</span> <span style="opacity:0.5; font-size:0.75rem; font-weight:normal; margin-left:2px;">(Substrate)</span>
            </div>
        `;

        stackContainer.innerHTML = html;
    };

    document.addEventListener('geometryUpdated', updateGlobalConfigBar);
    setTimeout(updateGlobalConfigBar, 300);

    const configBar = document.getElementById('global-config-bar');
    if (configBar) configBar.style.display = 'none'; // Initially hidden on Home tab

    // --- Mobile Menu Logic ---
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const mobileOverlay = document.getElementById('mobile-overlay');

    function closeSidebar() {
        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            if (mobileOverlay) mobileOverlay.classList.remove('active');
        }
    }

    if (mobileMenuToggle && sidebar && mobileOverlay) {
        mobileMenuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            mobileOverlay.classList.toggle('active');
            setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 300);
        });
        mobileOverlay.addEventListener('click', closeSidebar);
    }

    // 3. Navigation Logic and Plotly Dimensions Fix
    const navLinks = document.querySelectorAll('.nav-links li');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            closeSidebar(); // Ensure it closes on mobile
            navLinks.forEach(li => li.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));
            
            const targetId = link.getAttribute('data-target');
            link.classList.add('active');
            
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');

            if (configBar) {
                configBar.style.display = targetId === 'tab-home' ? 'none' : 'flex';
            }

            // Critical Fix: Force Plotly elements to resize after 100ms when display block/flex is resolved
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                const plots = document.querySelectorAll('.js-plotly-plot');
                plots.forEach(plot => {
                    try { Plotly.Plots.resize(plot); } catch(err) {}
                });
            }, 100);
        });
    });
});
