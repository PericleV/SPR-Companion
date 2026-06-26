import { MaterialsDB } from '../core/materials_database.js?v=50';

export const GeometryManager = {
    layers: [
        { material: 'BK7', d: 0, color: '', label: 'Prism/Substrate', labelPos: 'center', type: 'standard' }, 
        { material: 'Au', d: 50, color: '', label: '', labelPos: 'center', type: 'standard' },      
        { material: 'Air', d: 0, color: '', label: 'Detection Medium', labelPos: 'center', type: 'standard' }       
    ],

    isDBRActive: false,

    dbrParams: {
        matCount: 2,
        materials: [{ material: 'TiO2', d: 100 }, { material: 'SiO2', d: 100 }],
        periods: 5,
        hasDefect: false,
        defect: { material: 'Air', d: 200, afterPeriod: 2 }
    },

    init() {
        this.container = document.getElementById('geometry-container');
        this.syncMaterialsDB(); 
        if (!this.layers[0].color) {
            this.layers[0].color = this.getDefaultColor('BK7');
            this.layers[1].color = this.getDefaultColor('Au');
            this.layers[2].color = this.getDefaultColor('Air');
        }
        this.render();
        this.updateConfigDropdown(); 
        
        document.addEventListener('materialsUpdated', () => {
            this.syncMaterialsDB();
            
            // Ensure no layer is using a deleted material
            const availableMaterials = Object.keys(MaterialsDB);
            if (availableMaterials.length > 0) {
                this.layers.forEach(l => {
                    if (!availableMaterials.includes(l.material)) {
                        l.material = availableMaterials[0];
                    }
                });
            }

            this.renderDBRBuilder();
            this.renderLayers();
        });
            
        const btnExportGeom = document.getElementById('btn-export-geom');
        if(btnExportGeom) btnExportGeom.addEventListener('click', () => {
            const config = {
                layers: this.layers,
                dbrParams: this.dbrParams,
                isDBR: this.isDBR,
                isGrating: this.isGrating,
                gratingParams: this.gratingParams
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
            const a = document.createElement('a');
            a.setAttribute("href", dataStr);
            a.setAttribute("download", "geometry_config.json");
            document.body.appendChild(a);
            a.click();
            a.remove();
        });

        const btnImportGeom = document.getElementById('btn-import-geom');
        if(btnImportGeom) btnImportGeom.addEventListener('click', () => {
            document.getElementById('file-import-geom').click();
        });

        const fileImportGeom = document.getElementById('file-import-geom');
        if(fileImportGeom) fileImportGeom.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const config = JSON.parse(event.target.result);
                    if(config.layers) this.layers = config.layers;
                    if(config.dbrParams) this.dbrParams = config.dbrParams;
                    if(config.isDBR !== undefined) this.isDBR = config.isDBR;
                    if(config.isGrating !== undefined) this.isGrating = config.isGrating;
                    if(config.gratingParams) this.gratingParams = config.gratingParams;
                    
                    document.getElementById('geom-dbr-toggle').checked = this.isDBR;
                    document.getElementById('geom-grating-toggle').checked = this.isGrating;
                    
                    this.renderLayers();
                    this.renderPreview();
                    alert("Geometry configuration imported successfully!");
                } catch(err) {
                    alert("Error parsing JSON file!");
                    console.error(err);
                }
            };
            reader.readAsText(file);
        });
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
        } catch (e) {}
    },

    render() {
        if (!this.container) return;

        let html = `
            <div style="display: flex; gap: 30px; height: 100%; overflow: hidden;">
                <!-- Left Column: Settings, DBR Builder, Layers (Scrollable) -->
                <div style="width: 500px; display: flex; flex-direction: column; gap: 25px; overflow-y: auto; padding-right: 10px; padding-bottom: 20px;">
                    
                    <!-- Dynamic Optimization Notification & Comparison Banner -->
                    <div id="opt-notification-banner" style="display: none; flex-direction: column; gap: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-green); padding: 15px; border-radius: 12px; margin-bottom: 0px; font-size: 0.85rem; color: var(--text-main); flex-shrink: 0;">
                    </div>

                    <!-- Save/Load Panel -->
                    <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color); flex-shrink: 0;">
                        <h3 style="color: var(--text-main); margin-bottom: 15px; margin-top: 0; font-size: 1.1rem;"><i class="fa-solid fa-floppy-disk"></i> Configuration Manager</h3>
                        <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                            <input type="text" id="config-name-input" placeholder="Configuration Name..." value="Configuration 1" style="flex: 1; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                            <button id="btn-save-config" style="background: var(--accent-blue); color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: 0.2s;"><i class="fa-solid fa-save"></i> Save</button>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <select id="config-load-select" style="flex: 1; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                <option value="">-- Saved Configurations --</option>
                            </select>
                            <button id="btn-load-config" style="background: var(--bg-sidebar); color: white; border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: 0.2s;"><i class="fa-solid fa-folder-open"></i> Load</button>
                            <button id="btn-delete-config" class="text-danger border-danger" style="background: transparent; border-width: 1px; border-style: solid; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: 0.2s;" title="Delete Configuration"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>

                    <!-- DBR Builder Panel -->
                    <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color); flex-shrink: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" id="toggle-dbr-btn">
                            <h3 style="color: var(--text-main); margin: 0; font-size: 1.1rem;"><i class="fa-solid fa-layer-group"></i> DBR Auto-Builder</h3>
                            <i class="fa-solid fa-chevron-down" id="dbr-icon" style="transition: transform 0.3s;"></i>
                        </div>
                        <div id="dbr-builder-content" style="display: none; margin-top: 15px;"></div>
                    </div>

                    <!-- Layers Edit Panel -->
                    <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color); flex: 1; display: flex; flex-direction: column;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h3 style="color: var(--text-main); margin: 0; font-size: 1.1rem;"><i class="fa-solid fa-bars-staggered"></i> Layers (0 = Incident)</h3>
                            <div style="display: flex; gap: 10px;">
                                <button id="btn-reset-stack" class="text-danger border-danger" style="background: transparent; border-width: 1px; border-style: solid; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; transition: 0.2s;"><i class="fa-solid fa-rotate-right"></i> Reset</button>
                                <button id="btn-add-layer" style="background: var(--accent-green); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;"><i class="fa-solid fa-plus"></i> Add Layer</button>
                            </div>
                        </div>
                        <div id="layers-list" style="display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 5px;"></div>
                    </div>
                </div>

                <!-- Right Column: Stack Preview (Fixed, no scroll) -->
                <div style="flex: 1; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); position: relative; display: flex; flex-direction: column; overflow: hidden;">
                    
                    <div style="padding: 15px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-sidebar); z-index: 10;">
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <button id="btn-reverse-light" style="background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: 0.2s;">
                                <i class="fa-solid fa-arrows-up-down text-warning-alt"></i> Reverse Illumination
                            </button>
                            <label style="display: flex; align-items: center; gap: 5px; color: var(--text-main); font-size: 0.85rem; cursor: pointer;">
                                <input type="checkbox" id="chk-show-labels" checked> Show Labels
                            </label>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button id="btn-export-png" style="background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: 0.2s;">
                                <i class="fa-solid fa-file-image"></i> Export PNG
                            </button>
                            <button id="btn-export-svg" style="background: var(--accent-blue); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: 0.2s;">
                                <i class="fa-solid fa-vector-square"></i> Export SVG
                            </button>
                        </div>
                    </div>

                    <!-- Fixed container to scale layers (no scroll) -->
                    <div id="stack-wrapper" style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; overflow: hidden; background: var(--bg-main);">
                        
                        <div id="light-arrow" class="text-warning-alt" style="display: flex; flex-direction: column; align-items: center; margin-bottom: 10px; flex-shrink: 0;">
                            <span style="font-size: 0.85rem; font-weight: bold; margin-bottom: 2px;">Incident Wave</span>
                            <i class="fa-solid fa-arrow-down fa-2x"></i>
                        </div>

                        <!-- Stack preview with absolute height: 450px -->
                        <div id="stack-preview" style="width: 180px; height: 450px; display: flex; flex-direction: column; border: 2px solid var(--border-color); border-radius: 6px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5); overflow: visible; background: var(--bg-main);">
                            <!-- Generated from JS using proportional flex-grow -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
        this.renderDBRBuilder();
        this.renderLayers();
        this.attachEvents();
    },

    renderDBRBuilder() {
        const container = document.getElementById('dbr-builder-content');
        if (!container) return;
        const availableMaterials = Object.keys(MaterialsDB);

        let matHtml = '';
        this.dbrParams.materials.forEach((m, i) => {
            const matOptions = availableMaterials.map(mat => `<option value="${mat}" ${m.material === mat ? 'selected' : ''}>${mat}</option>`).join('');
            matHtml += `
                <div style="display: flex; gap: 10px; margin-bottom: 8px; align-items: center;">
                    <span style="color: var(--text-muted); font-size: 0.8rem; width: 25px;">M${i+1}</span>
                    <select class="dbr-mat-select" data-index="${i}" style="flex: 1; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">${matOptions}</select>
                    <input type="number" class="dbr-mat-d" data-index="${i}" value="${m.d}" style="width: 80px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" placeholder="d (nm)">
                </div>
            `;
        });

        const defectMatOptions = availableMaterials.map(mat => `<option value="${mat}" ${this.dbrParams.defect.material === mat ? 'selected' : ''}>${mat}</option>`).join('');

        container.innerHTML = `
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px;">
                <label style="font-size: 0.85rem; color: var(--text-main); flex: 1;">Materials per period: <span class="custom-tooltip" data-tooltip="Number of alternating materials in one period of the Distributed Bragg Reflector (e.g., 2 for TiO2/SiO2).">?</span></label>
                <input type="number" id="dbr-mat-count" value="${this.dbrParams.matCount}" min="1" max="5" style="width: 70px; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
            </div>
            <div style="background: var(--bg-main); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">${matHtml}</div>
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
                <label style="font-size: 0.85rem; color: var(--text-main); flex: 1;">Number of Periods (N):</label>
                <input type="number" id="dbr-periods" value="${this.dbrParams.periods}" min="1" style="width: 70px; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
            </div>
            <div style="background: var(--bg-main); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--border-color);">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-main); cursor: pointer; margin-bottom: ${this.dbrParams.hasDefect ? '10px' : '0'};">
                    <input type="checkbox" id="dbr-has-defect" ${this.dbrParams.hasDefect ? 'checked' : ''}> Defect Layer (Cavity) <span class="custom-tooltip" data-tooltip="Inserts an extra layer breaking the periodicity, creating a localized optical mode (Tamm/defect state) inside the bandgap.">?</span>
                </label>
                <div id="dbr-defect-config" style="display: ${this.dbrParams.hasDefect ? 'block' : 'none'}; padding-top: 10px; border-top: 1px dashed var(--border-color);">
                    <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px;">
                        <span style="color: var(--text-muted); font-size: 0.8rem; width: 45px;">Material</span>
                        <select id="dbr-def-mat" style="flex: 1; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">${defectMatOptions}</select>
                        <input type="number" id="dbr-def-d" value="${this.dbrParams.defect.d}" style="width: 80px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span style="color: var(--text-muted); font-size: 0.8rem; flex: 1;">Insert after period no:</span>
                        <input type="number" id="dbr-def-pos" value="${this.dbrParams.defect.afterPeriod}" min="1" style="width: 70px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                    </div>
                </div>
            </div>
            <button id="btn-generate-dbr" style="width: 100%; background: var(--accent-blue); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">
                <i class="fa-solid fa-magic"></i> Build and Add to Stack
            </button>
        `;

        document.getElementById('dbr-mat-count').addEventListener('change', (e) => this.updateDBRMatCount(parseInt(e.target.value)));
        document.getElementById('dbr-periods').addEventListener('change', (e) => this.dbrParams.periods = parseInt(e.target.value));
        document.getElementById('dbr-has-defect').addEventListener('change', (e) => { this.dbrParams.hasDefect = e.target.checked; this.renderDBRBuilder(); });
        document.querySelectorAll('.dbr-mat-select').forEach(el => el.addEventListener('change', e => this.dbrParams.materials[e.target.dataset.index].material = e.target.value));
        document.querySelectorAll('.dbr-mat-d').forEach(el => el.addEventListener('change', e => this.dbrParams.materials[e.target.dataset.index].d = parseFloat(e.target.value)));
        
        const defMat = document.getElementById('dbr-def-mat'); if(defMat) defMat.addEventListener('change', e => this.dbrParams.defect.material = e.target.value);
        const defD = document.getElementById('dbr-def-d'); if(defD) defD.addEventListener('change', e => this.dbrParams.defect.d = parseFloat(e.target.value));
        const defPos = document.getElementById('dbr-def-pos'); if(defPos) defPos.addEventListener('change', e => this.dbrParams.defect.afterPeriod = parseInt(e.target.value));

        document.getElementById('btn-generate-dbr').addEventListener('click', () => this.buildDBR());
    },

    updateDBRMatCount(count) {
        count = Math.max(1, Math.min(5, isNaN(count) ? 1 : count));
        this.dbrParams.matCount = count;
        const oldMats = this.dbrParams.materials;
        this.dbrParams.materials = Array.from({length: count}, (_, i) => oldMats[i] || { material: 'TiO2', d: 100 });
        this.renderDBRBuilder();
    },

    getDefaultColor(mat) {
        if (!window.getCSSColor) return '#64748b';
        const colors = { 
            'Air': window.getCSSColor('--layer-air'), 
            'H2O': window.getCSSColor('--layer-h2o'), 
            'BK7': window.getCSSColor('--layer-glass'), 
            'SiO2': window.getCSSColor('--layer-sio2'), 
            'TiO2': window.getCSSColor('--layer-tio2'), 
            'Au': window.getCSSColor('--layer-gold'), 
            'Ag': window.getCSSColor('--layer-silver') 
        };
        return colors[mat] || window.getCSSColor('--layer-default');
    },

    buildDBR() {
        this.syncMaterialsDB();
        const params = this.dbrParams;
        const newLayers = [];

        for (let p = 1; p <= params.periods; p++) {
            params.materials.forEach(m => newLayers.push({ material: m.material, d: m.d, color: this.getDefaultColor(m.material), label: '', labelPos: 'center' }));
            if (params.hasDefect && p === params.defect.afterPeriod) {
                newLayers.push({ material: params.defect.material, d: params.defect.d, color: this.getDefaultColor(params.defect.material), label: 'Defect', labelPos: 'right' });
            }
        }
        this.layers.splice(this.layers.length - 1, 0, ...newLayers);
        
        this.clearOptimizationState();
        this.isDBRActive = true;
        this.renderLayers();
    },

    clearOptimizationState() {
        if (window.optimizedLayersData) {
            window.optimizedLayersData = null;
        }
        const nameInput = document.getElementById('config-name-input');
        if (nameInput && nameInput.value.includes('(optimized)')) {
            nameInput.value = nameInput.value.replace(' (optimized)', '');
            const select = document.getElementById('config-load-select');
            if (select) select.value = '';
        }
        this.updateOptimizationBanner();
        this.isDBRActive = false;
    },

    updateOptimizationBanner() {
        const banner = document.getElementById('opt-notification-banner');
        if (!banner) return;

        const nameInput = document.getElementById('config-name-input');
        const currentName = nameInput ? nameInput.value.trim() : '';
        
        if (!currentName.includes('(optimized)')) {
            banner.style.display = 'none';
            banner.innerHTML = '';
            return;
        }

        banner.style.display = 'flex';
        
        const originalName = currentName.replace(' (optimized)', '');
        const configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
        const originalLayers = configs[originalName];

        if (!originalLayers) {
            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-green); font-weight: bold; margin-bottom: 5px;">
                    <i class="fa-solid fa-circle-check"></i> Optimized Configuration Active
                </div>
                <p style="margin: 0; color: var(--text-muted); font-size: 0.8rem;">
                    This structure was generated using Genetic Optimization. (Original structure <i>"${originalName}"</i> was not found in saved list to compare parameters).
                </p>
            `;
            return;
        }

        let diffHTML = '';
        let hasDiff = false;

        for (let i = 1; i < this.layers.length - 1; i++) {
            const origL = originalLayers[i];
            const optL = this.layers[i];

            if (!origL || !optL) continue;

            let layerDiffs = [];
            if (origL.material !== optL.material) {
                layerDiffs.push(`Material: ${origL.material} &rarr; ${optL.material}`);
            }
            if (origL.type === '2d' && optL.type === '2d') {
                if (origL.count !== optL.count) {
                    layerDiffs.push(`Layers N: ${origL.count} &rarr; ${optL.count}`);
                }
            } else {
                if (Math.abs(origL.d - optL.d) > 0.01) {
                    layerDiffs.push(`Thickness: ${origL.d.toFixed(1)} nm &rarr; ${optL.d.toFixed(1)} nm`);
                }
            }
            if (origL.type === 'porous' && optL.type === 'porous') {
                const origFF = origL.ff !== undefined ? origL.ff : 0.5;
                const optFF = optL.ff !== undefined ? optL.ff : 0.5;
                if (Math.abs(origFF - optFF) > 0.005) {
                    layerDiffs.push(`Fill Factor f: ${origFF.toFixed(2)} &rarr; ${optFF.toFixed(2)}`);
                }
            }

            if (layerDiffs.length > 0) {
                hasDiff = true;
                diffHTML += `
                    <div style="margin-top: 5px; font-size: 0.8rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 5px;">
                        <span style="font-weight: bold; color: var(--accent-blue);">Layer ${i} (${optL.material}):</span>
                        <ul style="margin: 2px 0 0 15px; padding: 0; list-style-type: square; color: var(--text-muted);">
                            ${layerDiffs.map(d => `<li>${d}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
        }

        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-green); font-weight: bold; margin-bottom: 5px;">
                <i class="fa-solid fa-circle-check"></i> Optimized Configuration Active
            </div>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.8rem;">
                Compared with original structure <b>"${originalName}"</b>:
            </p>
            <div style="max-height: 120px; overflow-y: auto; margin-top: 5px; padding-right: 5px;">
                ${hasDiff ? diffHTML : '<div style="color: var(--text-muted); font-style: italic; font-size: 0.8rem; margin-top: 5px;">No parameter differences detected (or DBR structure optimized).</div>'}
            </div>
        `;
    },

    renderLayers() {
        this.syncMaterialsDB(); 
        
        // Dynamically update the optimization banner
        this.updateOptimizationBanner();

        const listDiv = document.getElementById('layers-list');
        const previewDiv = document.getElementById('stack-preview');
        listDiv.innerHTML = '';
        previewDiv.innerHTML = '';

        const availableMaterials = Object.keys(MaterialsDB);

        this.layers.forEach((layer, index) => {
            const matInfo = MaterialsDB[layer.material];
            if (matInfo && matInfo.category) {
                layer.type = matInfo.category;
                if (layer.type === '2d') {
                    layer.d_mono = matInfo.d_mono || 0.34;
                    if (!layer.count) layer.count = layer.d ? Math.max(1, Math.round(layer.d / layer.d_mono)) : 1;
                    layer.d = layer.count * layer.d_mono;
                }
            } else if (!layer.type) layer.type = 'standard';

            if(layer.label === undefined) layer.label = '';
            if(layer.labelPos === undefined) layer.labelPos = 'center';

            const isSemiInfinite = (index === 0 || index === this.layers.length - 1);
            const isFirstIntermediate = index === 1;
            const isLastIntermediate = index === this.layers.length - 2;
            
            const matOptions = availableMaterials.map(m => `<option value="${m}" ${layer.material === m ? 'selected' : ''}>${m}</option>`).join('');
            
            const typeDisplay = layer.type === 'standard' ? 'Bulk' : (layer.type === 'porous' ? 'Porous / EMA' : '2D');
            
            const btnUp = (!isSemiInfinite && !isFirstIntermediate) ? `<button class="btn-action" data-index="${index}" data-action="up" style="background: var(--bg-sidebar); border: 1px solid var(--border-color); color: var(--text-main); padding: 4px 8px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-arrow-up"></i></button>` : '';
            const btnDown = (!isSemiInfinite && !isLastIntermediate) ? `<button class="btn-action" data-index="${index}" data-action="down" style="background: var(--bg-sidebar); border: 1px solid var(--border-color); color: var(--text-main); padding: 4px 8px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-arrow-down"></i></button>` : '';
            const btnDelete = (!isSemiInfinite) ? `<button class="btn-action text-danger" data-index="${index}" data-action="delete" style="background: transparent; border: none; padding: 4px 8px; cursor: pointer;" title="Delete Layer"><i class="fa-solid fa-trash"></i></button>` : '';
            // Left panel UI construction
            listDiv.innerHTML += `
                <div style="background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; position: relative;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;">
                        <span style="color: var(--text-main); font-weight: bold; font-size: 0.9rem;">Layer ${index} ${isSemiInfinite ? (index===0?'(Incident)':'(Substrate)') : ''}</span>
                        <div style="display: flex; gap: 4px;">${btnUp} ${btnDown} ${btnDelete}</div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Type</label>
                            <input type="text" disabled value="${typeDisplay}" style="width: 100%; padding: 6px; background: var(--bg-main); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 4px; cursor: not-allowed; opacity: 0.8;">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Material</label>
                            <select class="input-material" data-index="${index}" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">${matOptions}</select>
                        </div>
                        <div style="width: 60px;">
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Color</label>
                            <input type="color" class="input-color" data-index="${index}" value="${layer.color}" style="width: 100%; height: 30px; padding: 2px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        ${layer.type === '2d' ? `
                            <div style="flex: 1;">
                                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Layers (N) <span class="custom-tooltip" data-tooltip="Number of atomic/molecular layers. Total thickness = N * d_mono.">?</span></label>
                                <input type="number" class="input-count" data-index="${index}" value="${layer.count || 1}" min="1" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                            <div style="flex: 1;">
                                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">d_mono(nm) <span class="custom-tooltip" data-tooltip="Thickness of a single monolayer of this 2D material.">?</span></label>
                                <input type="number" disabled value="${layer.d_mono || 0.34}" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                        ` : `
                            <div style="flex: 1;">
                                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Thickness (nm) <span class="custom-tooltip" data-tooltip="Physical thickness of the layer. Incident/Substrate are assumed semi-infinite.">?</span></label>
                                <input type="${isSemiInfinite ? 'text' : 'number'}" class="input-d" data-index="${index}" value="${isSemiInfinite ? 'semi infinite' : layer.d}" ${isSemiInfinite ? 'disabled' : ''} style="width: 100%; padding: 6px; background: ${isSemiInfinite ? 'var(--bg-main)' : 'var(--bg-card)'}; color: ${isSemiInfinite ? 'var(--text-muted)' : 'white'}; border: 1px solid var(--border-color); border-radius: 4px;">
                            </div>
                        `}
                        <div style="flex: 1.5;">
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Label</label>
                            <input type="text" class="input-label" data-index="${index}" value="${layer.label}" placeholder="e.g., Cavity..." style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Position</label>
                            <select class="input-label-pos" data-index="${index}" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                <option value="center" ${layer.labelPos === 'center' ? 'selected' : ''}>Center</option>
                                <option value="left" ${layer.labelPos === 'left' ? 'selected' : ''}>Left</option>
                                <option value="right" ${layer.labelPos === 'right' ? 'selected' : ''}>Right</option>
                            </select>
                        </div>
                    </div>
                    


                </div>
            `;

        });

        // Proportional Preview (Right side)
        let compressed = [];
        let i = 0;
        while (i < this.layers.length) {
            let bestPeriod = 1;
            let bestSeqLen = 1;
            let maxSearchLen = (i === 0 || i === this.layers.length - 1) ? 0 : Math.min(5, Math.floor((this.layers.length - 1 - i) / 2));
            for (let seqLen = 1; seqLen <= maxSearchLen; seqLen++) {
                let periods = 1;
                while (i + (periods + 1) * seqLen <= this.layers.length - 2) {
                    let match = true;
                    for (let j = 0; j < seqLen; j++) {
                        if (this.layers[i + j].material !== this.layers[i + periods * seqLen + j].material || this.layers[i + j].d !== this.layers[i + periods * seqLen + j].d) {
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
                compressed.push({ isGroup: true, sequence: this.layers.slice(i, i + bestPeriod * bestSeqLen), seqLen: bestSeqLen, periods: bestPeriod, startIndex: i });
                i += bestPeriod * bestSeqLen;
            } else {
                compressed.push({ isGroup: false, layer: this.layers[i], index: i });
                i++;
            }
        }

        const renderSingleLayerPreview = (layer, index, hideLabel = false) => {
            const isSemiInfinite = (index === 0 || index === this.layers.length - 1);
            const labelText = layer.label.trim() !== '' ? layer.label : layer.material;
            let displayLabel = `${labelText} `;
            if (!isSemiInfinite) displayLabel += layer.type === '2d' ? `(${layer.count}x)` : `(${Number(layer.d).toFixed(2).replace(/\.?0+$/, '')} nm)`;

            let bgStyle = `background-color: ${layer.color};`;
            if (layer.type === 'porous') bgStyle = `background: repeating-linear-gradient(45deg, ${layer.color}, ${layer.color} 5px, rgba(255,255,255,0.3) 5px, rgba(255,255,255,0.3) 10px);`;
            else if (layer.type === '2d') bgStyle = `background: repeating-linear-gradient(0deg, ${layer.color}, ${layer.color} 3px, rgba(255,255,255,0.5) 3px, rgba(255,255,255,0.5) 6px);`;

            let flexStyle = isSemiInfinite ? 'flex: 0 0 45px;' : `flex: ${Math.max(0.1, layer.d)} 1 0%; min-height: 4px;`;

            let labelContent = '';
            if (!hideLabel) {
                let lPos = layer.labelPos;
                if (!isSemiInfinite && layer.d < 20 && lPos === 'center') lPos = 'right';

                if (lPos === 'left') {
                    labelContent = `<div style="position: absolute; right: 100%; padding-right: 15px; top: 50%; transform: translateY(-50%); white-space: nowrap; font-size: 0.85rem; font-weight: bold; color: var(--text-main);"><span style="color:var(--text-main);">${displayLabel}</span> <span style="color:var(--text-muted);">&rarr;</span></div>`;
                } else if (lPos === 'right') {
                    labelContent = `<div style="position: absolute; left: 100%; padding-left: 15px; top: 50%; transform: translateY(-50%); white-space: nowrap; font-size: 0.85rem; font-weight: bold; color: var(--text-main);"><span style="color:var(--text-muted);">&larr;</span> ${displayLabel}</div>`;
                } else {
                    labelContent = `<span class="center-label" style="background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; white-space: nowrap; pointer-events: none; opacity: 1; transition: opacity 0.2s;">${displayLabel}</span>`;
                }
            }

            return `
                <div class="stack-layer-preview" id="preview-layer-${index}" style="${flexStyle} ${bgStyle} width: 100%; display: flex; align-items: center; justify-content: center; position: relative; border-bottom: ${index === this.layers.length - 1 ? 'none' : '1px solid rgba(0,0,0,0.4)'}; border-top-left-radius: ${index === 0 ? '4px' : '0'}; border-top-right-radius: ${index === 0 ? '4px' : '0'}; border-bottom-left-radius: ${index === this.layers.length - 1 ? '4px' : '0'}; border-bottom-right-radius: ${index === this.layers.length - 1 ? '4px' : '0'};">
                    ${labelContent}
                </div>
            `;
        };

        compressed.forEach(item => {
            if (!item.isGroup) {
                previewDiv.innerHTML += renderSingleLayerPreview(item.layer, item.index, false);
            } else {
                let innerHTML = '';
                let groupFlex = 0;
                item.sequence.forEach((l, idx) => {
                    groupFlex += Math.max(0.1, l.d);
                    innerHTML += renderSingleLayerPreview(l, item.startIndex + idx, true);
                });

                const matNames = item.sequence.slice(0, item.seqLen).map(l => l.material).join(' / ');
                previewDiv.innerHTML += `
                    <div style="display: flex; flex-direction: row; width: 100%; flex: ${groupFlex} 1 0%; position: relative;">
                        <div style="flex: 1; display: flex; flex-direction: column;">
                            ${innerHTML}
                        </div>
                        <div style="position: absolute; right: -12px; top: 0; bottom: 0; width: 8px; border-top: 2px solid var(--text-muted); border-bottom: 2px solid var(--text-muted); border-right: 2px solid var(--text-muted); border-radius: 0 4px 4px 0;"></div>
                        <div style="position: absolute; left: 100%; padding-left: 18px; top: 50%; transform: translateY(-50%); white-space: nowrap; display: flex; align-items: center;">
                            <span style="color: var(--text-main); font-weight: bold; font-size: 0.85rem;">[ ${matNames} ] &times; ${item.periods}</span>
                        </div>
                    </div>
                `;
            }
        });

        // Hide central labels based on user toggle
        setTimeout(() => {
            const chk = document.getElementById('chk-show-labels');
            const showLabels = chk ? chk.checked : true;
            document.querySelectorAll('.stack-layer-preview').forEach(layerDiv => {
                const label = layerDiv.querySelector('.center-label');
                if (label) {
                    label.style.opacity = showLabels ? '1' : '0';
                }
            });
        }, 50);

        this.attachInputEvents();
        document.dispatchEvent(new Event('geometryUpdated'));
    },

    attachEvents() {
        const toggleDbr = document.getElementById('toggle-dbr-btn');
        if (toggleDbr) toggleDbr.addEventListener('click', () => {
            const content = document.getElementById('dbr-builder-content');
            const icon = document.getElementById('dbr-icon');
            if (content.style.display === 'none') { content.style.display = 'block'; icon.style.transform = 'rotate(180deg)'; } 
            else { content.style.display = 'none'; icon.style.transform = 'rotate(0deg)'; }
        });

        document.getElementById('btn-reverse-light').addEventListener('click', () => { this.layers.reverse(); this.renderLayers(); });
        document.getElementById('btn-add-layer').addEventListener('click', () => {
            this.layers.splice(this.layers.length - 1, 0, { material: 'SiO2', d: 20, color: this.getDefaultColor('SiO2'), label: '', labelPos: 'center', type: 'standard' });
            this.clearOptimizationState();
            this.renderLayers();
        });
        document.getElementById('btn-reset-stack').addEventListener('click', () => {
            if (confirm('Are you sure you want to reset the entire stack?')) {
                this.layers = [
                    { material: 'BK7', d: 0, color: this.getDefaultColor('BK7'), label: 'Prism/Substrate', labelPos: 'center', type: 'standard' }, 
                    { material: 'Au', d: 50, color: this.getDefaultColor('Au'), label: '', labelPos: 'center', type: 'standard' },      
                    { material: 'Air', d: 0, color: this.getDefaultColor('Air'), label: 'Detection Medium', labelPos: 'center', type: 'standard' }       
                ];
                this.clearOptimizationState();
                this.renderLayers();
            }
        });

        document.getElementById('btn-save-config').addEventListener('click', () => this.saveConfiguration());
        document.getElementById('btn-load-config').addEventListener('click', () => this.loadConfiguration());
        document.getElementById('btn-delete-config').addEventListener('click', () => this.deleteConfiguration());

        document.getElementById('btn-export-svg').addEventListener('click', () => this.exportStackImage('svg'));
        document.getElementById('btn-export-png').addEventListener('click', () => this.exportStackImage('png'));
        document.getElementById('chk-show-labels').addEventListener('change', () => this.renderLayers());
    },

    attachInputEvents() {
        document.querySelectorAll('.input-material').forEach(s => s.addEventListener('change', e => {
            const l = this.layers[e.target.dataset.index]; l.material = e.target.value;
            const m = MaterialsDB[l.material];
            if (m && m.category) { l.type = m.category; if (l.type === '2d') { l.d_mono = m.d_mono || 0.34; l.d = (l.count || 1) * l.d_mono; } }
            this.clearOptimizationState();
            this.renderLayers();
        }));
        document.querySelectorAll('.input-count').forEach(i => i.addEventListener('change', e => {
            const l = this.layers[e.target.dataset.index]; l.count = parseFloat(e.target.value) || 1; l.d = l.count * l.d_mono; this.clearOptimizationState(); this.renderLayers();
        }));
        document.querySelectorAll('.input-d').forEach(i => i.addEventListener('change', e => { this.layers[e.target.dataset.index].d = parseFloat(e.target.value); this.clearOptimizationState(); this.renderLayers(); }));
        document.querySelectorAll('.input-label').forEach(i => i.addEventListener('change', e => { this.layers[e.target.dataset.index].label = e.target.value; this.clearOptimizationState(); this.renderLayers(); }));
        document.querySelectorAll('.input-label-pos').forEach(s => s.addEventListener('change', e => { this.layers[e.target.dataset.index].labelPos = e.target.value; this.clearOptimizationState(); this.renderLayers(); }));
        document.querySelectorAll('.input-color').forEach(i => {
            i.addEventListener('change', e => { this.layers[e.target.dataset.index].color = e.target.value; this.clearOptimizationState(); this.renderLayers(); });
        });

        document.querySelectorAll('.btn-action').forEach(b => b.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.index);
            const act = e.currentTarget.dataset.action;
            if (act === 'delete') this.layers.splice(idx, 1);
            else if (act === 'up' && idx > 1) { const t = this.layers[idx-1]; this.layers[idx-1] = this.layers[idx]; this.layers[idx] = t; }
            else if (act === 'down' && idx < this.layers.length - 2) { const t = this.layers[idx+1]; this.layers[idx+1] = this.layers[idx]; this.layers[idx] = t; }
            this.clearOptimizationState();
            this.renderLayers();
        }));
    },

    exportStackImage(format) {
        const width = 600;
        const height = 800;
        const semiHeight = 60;
        const minIntermHeight = 6;
        const paddingTop = 40;
        const paddingBottom = 40;
        
        let totalD = 0;
        for(let i=1; i<this.layers.length-1; i++) totalD += parseFloat(this.layers[i].d) || 0;
        if (totalD === 0) totalD = 1;
        
        const chk = document.getElementById('chk-show-labels');
        const showLabels = chk ? chk.checked : true;
        
        const availHeight = height - (2 * semiHeight) - paddingTop - paddingBottom;
        
        let svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family: sans-serif;">
            <defs>
        `;
        
        this.layers.forEach((l, i) => {
            if (l.type === 'porous') {
                svg += `<pattern id="pat-porous-${i}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <rect width="10" height="10" fill="${l.color}" />
                            <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(0,0,0,0.2)" stroke-width="5" />
                        </pattern>`;
            } else if (l.type === '2d') {
                svg += `<pattern id="pat-2d-${i}" width="6" height="6" patternUnits="userSpaceOnUse">
                            <rect width="6" height="6" fill="${l.color}" />
                            <line x1="0" y1="3" x2="6" y2="3" stroke="rgba(0,0,0,0.3)" stroke-width="3" />
                        </pattern>`;
            }
        });
        
        svg += `</defs>`;

        let currentY = paddingTop;
        const rectWidth = 260;
        const rectX = (width - rectWidth) / 2;

        let rawHeights = [];
        let totalRaw = 0;
        for(let i=1; i<this.layers.length-1; i++) {
            let h = (this.layers[i].d / totalD) * availHeight;
            if(h < minIntermHeight) h = minIntermHeight;
            rawHeights.push(h);
            totalRaw += h;
        }
        let scale = totalRaw > availHeight ? (availHeight / totalRaw) : 1;

        this.layers.forEach((layer, i) => {
            let h = semiHeight;
            if (i > 0 && i < this.layers.length - 1) h = rawHeights[i-1] * scale;

            let fillAttr = layer.color;
            if (layer.type === 'porous') fillAttr = `url(#pat-porous-${i})`;
            else if (layer.type === '2d') fillAttr = `url(#pat-2d-${i})`;

            svg += `<rect x="${rectX}" y="${currentY}" width="${rectWidth}" height="${h}" fill="${fillAttr}" stroke="var(--border-color)" stroke-width="1.5" />`;
            
            let labelText = layer.label || layer.material;
            if (i > 0 && i < this.layers.length - 1) labelText += layer.type === '2d' ? ` (${layer.count}x)` : ` (${layer.d}nm)`;

            if (showLabels) {
                if (layer.labelPos === 'left') {
                    svg += `<text x="${rectX - 15}" y="${currentY + h/2}" text-anchor="end" fill="var(--text-main)" font-size="14" font-weight="bold" dominant-baseline="middle" style="paint-order: stroke; stroke: var(--bg-main); stroke-width: 3px;">${labelText} →</text>`;
                } else if (layer.labelPos === 'right') {
                    svg += `<text x="${rectX + rectWidth + 15}" y="${currentY + h/2}" text-anchor="start" fill="var(--text-main)" font-size="14" font-weight="bold" dominant-baseline="middle" style="paint-order: stroke; stroke: var(--bg-main); stroke-width: 3px;">← ${labelText}</text>`;
                } else if (h >= 18) { 
                    svg += `<rect x="${rectX + rectWidth/2 - 60}" y="${currentY + h/2 - 12}" width="120" height="24" rx="4" fill="var(--bg-main)" opacity="0.8" stroke="var(--border-color)" stroke-width="1" />`;
                    svg += `<text x="${rectX + rectWidth/2}" y="${currentY + h/2 + 1}" fill="var(--text-main)" font-size="12" font-weight="bold" dominant-baseline="middle" text-anchor="middle">${labelText}</text>`;
                }
            }
            currentY += h;
        });

        svg += `</svg>`;

        if (format === 'svg') {
            const blob = new Blob([svg], {type: 'image/svg+xml;charset=utf-8'});
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Plasmonic_Structure.svg';
            a.click();
        } else if (format === 'png') {
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, width, height);

            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = 'Plasmonic_Structure.png';
                a.click();
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }
    },

    saveConfiguration() {
        const name = document.getElementById('config-name-input').value.trim();
        if (!name) return alert("Please enter a name!");
        let configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
        configs[name] = JSON.parse(JSON.stringify(this.layers));
        localStorage.setItem('plasmonic_configs', JSON.stringify(configs));
        this.updateConfigDropdown();
        document.getElementById('config-load-select').value = name;
        this.updateOptimizationBanner();
        alert('Configuration saved!');
    },

    loadConfiguration() {
        const name = document.getElementById('config-load-select').value;
        if (!name) return;
        let configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
        if (configs[name]) { 
            this.layers = JSON.parse(JSON.stringify(configs[name])); 
            document.getElementById('config-name-input').value = name; 
            this.renderLayers(); 
        }
    },

    deleteConfiguration() {
        const name = document.getElementById('config-load-select').value;
        if (!name) return;
        if (confirm(`Delete ${name}?`)) {
            let configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
            delete configs[name]; localStorage.setItem('plasmonic_configs', JSON.stringify(configs));
            this.updateConfigDropdown(); document.getElementById('config-name-input').value = '';
            this.updateOptimizationBanner();
        }
    },

    updateConfigDropdown() {
        const select = document.getElementById('config-load-select');
        if (!select) return;
        let configs = JSON.parse(localStorage.getItem('plasmonic_configs') || '{}');
        select.innerHTML = '<option value="">-- Saved Configurations --</option>';
        Object.keys(configs).sort().forEach(name => select.innerHTML += `<option value="${name}">${name}</option>`);
    }
};
