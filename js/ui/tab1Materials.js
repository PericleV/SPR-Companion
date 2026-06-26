import { MaterialFormulas } from '../physics/materialsFormulas.js';

// --- Complex Numbers Helpers (needed for EMA Bruggeman/MG calculations) ---
const Complex = {
    add: (a, b) => ({r: a.r + b.r, i: a.i + b.i}),
    sub: (a, b) => ({r: a.r - b.r, i: a.i - b.i}),
    mul: (a, b) => ({r: a.r*b.r - a.i*b.i, i: a.r*b.i + a.i*b.r}),
    div: (a, b) => { const den = b.r*b.r + b.i*b.i; return {r: (a.r*b.r + a.i*b.i)/den, i: (a.i*b.r - a.r*b.i)/den}; },
    mulNum: (a, n) => ({r: a.r*n, i: a.i*n}),
    sqrt: (a) => {
        const mag = Math.sqrt(a.r*a.r + a.i*a.i);
        const r = Math.sqrt((mag + a.r)/2);
        const sign = a.i < 0 ? -1 : 1;
        const i = sign * Math.sqrt((mag - a.r)/2);
        return {r, i};
    }
};

const getEps = (n, k) => ({ r: n*n - k*k, i: 2*n*k });
const getNK = (eps) => {
    const mag = Math.sqrt(eps.r*eps.r + eps.i*eps.i);
    let n = Math.sqrt((mag + eps.r) / 2);
    let k = Math.sqrt((mag - eps.r) / 2);
    if (eps.i < 0) k = -k;
    return {n: n, k: Math.max(0, k)}; 
};

// Extracts n, k for a wavelength from a stored material (used for interpolation and EMA)
function getNKAtWave(mat, w) {
    if (mat.type === 'constant') return {n: mat.n, k: mat.k};
    const d = mat.data;
    if (w <= d[0].w) {
        if (mat.extrap === 'linear' && d.length > 1) {
            const t = (w - d[0].w)/(d[1].w - d[0].w);
            return { n: Math.max(0, d[0].n + t*(d[1].n - d[0].n)), k: Math.max(0, d[0].k + t*(d[1].k - d[0].k)) };
        }
        return {n: d[0].n, k: d[0].k};
    }
    if (w >= d[d.length-1].w) {
        if (mat.extrap === 'linear' && d.length > 1) {
            const l = d.length;
            const t = (w - d[l-2].w)/(d[l-1].w - d[l-2].w);
            return { n: Math.max(0, d[l-2].n + t*(d[l-1].n - d[l-2].n)), k: Math.max(0, d[l-2].k + t*(d[l-1].k - d[l-2].k)) };
        }
        return {n: d[d.length-1].n, k: d[d.length-1].k};
    }
    for(let j=0; j<d.length-1; j++) {
        if(w >= d[j].w && w <= d[j+1].w) {
            const t = (w - d[j].w)/(d[j+1].w - d[j].w);
            return { n: d[j].n + t*(d[j+1].n - d[j].n), k: d[j].k + t*(d[j+1].k - d[j].k) };
        }
    }
    return {n: 1, k: 0};
}

export const MaterialsManager = {
    // Internal state
    plottedMaterials: new Set(),
    
    // DB with full support for 2D and Porous materials
    db: {
        'BK7': { category: 'standard', type: 'constant', n: 1.515, k: 0.0 }, 
        'SiO2': { category: 'standard', type: 'constant', n: 1.457, k: 0.0 }, 
        'TiO2': { category: 'standard', type: 'constant', n: 2.41, k: 0.0 },
        'Air': { category: 'standard', type: 'constant', n: 1.0, k: 0.0 }, 
        'H2O': { category: 'standard', type: 'constant', n: 1.333, k: 0.0 },
        'Graphene': { category: '2d', type: 'constant', d_mono: 0.34, n: 2.5, k: 1.2 },
        'Au': { 
            category: 'standard', type: 'dispersive', 
            data: [
                { w: 400, n: 1.658, k: 1.956 }, { w: 450, n: 1.500, k: 1.880 }, 
                { w: 500, n: 0.849, k: 1.892 }, { w: 550, n: 0.331, k: 2.324 }, 
                { w: 600, n: 0.200, k: 3.000 }, { w: 650, n: 0.142, k: 3.697 },
                { w: 700, n: 0.131, k: 4.062 }, { w: 800, n: 0.150, k: 5.280 },
                { w: 900, n: 0.170, k: 6.200 }, { w: 1000, n: 0.200, k: 7.100 }
            ] 
        },
        'Ag': { 
            category: 'standard', type: 'dispersive', 
            data: [
                { w: 400, n: 0.05, k: 1.93 }, { w: 500, n: 0.05, k: 3.13 }, 
                { w: 600, n: 0.06, k: 4.15 }, { w: 700, n: 0.04, k: 5.12 }, 
                { w: 800, n: 0.04, k: 5.99 }, { w: 1000, n: 0.04, k: 7.20 }
            ] 
        }
    },

    init() {
        this.container = document.getElementById('materials-container');
        this.selectedMaterial = 'Au';
        this.plottedMaterials = new Set([this.selectedMaterial]);
        
        // Load from LocalStorage
        const savedDB = localStorage.getItem('plasmonic_materials');
        if (savedDB) {
            try {
                const parsed = JSON.parse(savedDB);
                for (const [key, val] of Object.entries(parsed)) {
                    // Upgrade legacy structures if they exist
                    if (val.category === undefined) val.category = 'standard';
                    if (val.type === undefined) val.type = Array.isArray(val) ? 'dispersive' : 'constant';
                    this.db[key] = val;
                }
            } catch (e) { console.error("Error loading materials from storage", e); }
        }

        this.render();
        this.attachEvents();
        this.viewMaterial(this.selectedMaterial);
    },

    saveToStorage() {
        const customMats = {};
        const predefined = ['BK7', 'SiO2', 'TiO2', 'Air', 'H2O', 'Au', 'Ag', 'Graphene'];
        for (const [key, val] of Object.entries(this.db)) {
            if (!predefined.includes(key)) customMats[key] = val;
        }
        localStorage.setItem('plasmonic_materials', JSON.stringify(customMats));
    },

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="mobile-stack-row" style="display: flex; gap: 20px; height: 100%; overflow: hidden;">
                
                <!-- Left Column: Materials List -->
                <div class="mobile-col-full" style="width: 360px; display: flex; flex-direction: column; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden; flex-shrink: 0;">
                    <div style="padding: 15px; border-bottom: 1px solid var(--border-color); background: var(--bg-sidebar);">
                        <h3 style="color: var(--text-main); margin: 0; font-size: 1.1rem;"><i class="fa-solid fa-database"></i> Library</h3>
                    </div>
                    <div id="mat-list-container" style="flex: 1; overflow-y: auto; padding: 20px;">
                        <!-- Dynamically Generated -->
                    </div>
                    <div style="padding: 15px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar); display: flex; flex-direction: column; gap: 8px;">
                        <button id="btn-show-add-modal" style="width: 100%; background: var(--accent-green); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">
                            <i class="fa-solid fa-plus"></i> New Material
                        </button>
                        <button id="btn-delete-selected-mat-sidebar" style="width: 100%; background: transparent; color: var(--text-danger, #ff4c4c); border: 1px solid var(--text-danger, #ff4c4c); padding: 8px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s; display: none;">
                            <i class="fa-solid fa-trash-can"></i> Delete Selected Material
                        </button>
                    </div>
                </div>

                <!-- Central Column: Details and Plot (Unified) -->
                <div class="mobile-col-full" style="flex: 1; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; padding-right: 5px;">
                    
                    <div style="background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <h2 id="mat-view-title" style="color: var(--accent-blue); margin: 0; font-size: 1.8rem;">Material Name</h2>
                                <p id="mat-view-type" style="color: var(--text-muted); font-size: 0.9rem; margin-top: 5px;">Material Type</p>
                            </div>
                            <button id="btn-delete-mat" class="text-danger border-danger" style="background: transparent; border-width: 1px; border-style: solid; padding: 6px 12px; border-radius: 6px; cursor: pointer; display: none;"><i class="fa-solid fa-trash"></i> Delete</button>
                        </div>

                        <!-- Plot Options -->
                        <div style="display: flex; gap: 15px; align-items: center; background: var(--bg-main); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); flex-wrap: wrap;">
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span style="font-size: 0.85rem; color: var(--text-muted);"><i class="fa-solid fa-eye"></i> Plot Range:</span>
                                <input type="number" id="plot-w-min" value="300" title="Min Wavelength (nm)" style="width: 80px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem;">
                                <span style="color: var(--text-muted);">-</span>
                                <input type="number" id="plot-w-max" value="1200" title="Max Wavelength (nm)" style="width: 80px; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem;">
                            </div>
                            
                            <div style="width: 1px; height: 20px; background: var(--border-color);"></div>
                            
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span style="font-size: 0.85rem; color: var(--accent-blue);"><i class="fa-solid fa-chart-line"></i> Y1 (Left):</span>
                                <select id="plot-y1-select" style="padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem;">
                                    <option value="n">Refractive Index (n)</option>
                                    <option value="k">Extinction Coeff. (k)</option>
                                    <option value="eps_r">Permittivity Real (ε_r)</option>
                                    <option value="eps_i">Permittivity Imag. (ε_i)</option>
                                </select>
                            </div>

                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span style="font-size: 0.85rem; color: var(--accent-green);"><i class="fa-solid fa-chart-line"></i> Y2 (Right):</span>
                                <select id="plot-y2-select" style="padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem;">
                                    <option value="k">Extinction Coeff. (k)</option>
                                    <option value="n">Refractive Index (n)</option>
                                    <option value="eps_r">Permittivity Real (ε_r)</option>
                                    <option value="eps_i">Permittivity Imag. (ε_i)</option>
                                </select>
                            </div>
                        </div>

                        <!-- Plot Container -->
                        <div id="mat-graph-container" style="flex: 1; min-height: 550px; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border-color); padding: 10px; display: flex; flex-direction: column;">
                            <div style="flex: 1; position: relative; min-width: 0; min-height: 0; width: 100%;">
                                <div id="mat-dispersion-plot" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ADD MATERIAL MODAL -->
            <div id="add-mat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; justify-content: center; align-items: center;">
                <div style="background: var(--bg-card); width: 950px; max-width: 95%; border-radius: 12px; border: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
                    <div style="padding: 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-sidebar);">
                        <h3 style="margin: 0; color: var(--text-main);">Add New Material</h3>
                        <button id="btn-close-modal" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.2rem;"><i class="fa-solid fa-times"></i></button>
                    </div>
                    
                    <div style="padding: 20px; display: flex; flex-direction: column; gap: 15px; max-height: 75vh; overflow-y: auto;">
                        <div>
                            <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Material Name (Unique)</label>
                            <input type="text" id="new-mat-name" placeholder="e.g., Al2O3" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                        </div>

                        <div>
                            <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Material Category</label>
                            <select id="new-mat-category" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                <option value="standard">Standard (Bulk)</option>
                                <option value="porous">Porous / Alloy (EMA Method)</option>
                                <option value="2d">2D Material (Thickness controlled by Layers N)</option>
                            </select>
                        </div>

                        <!-- EMA / Porous Config -->
                        <div id="new-mat-porous-zone" style="display: none; flex-direction: column; gap: 15px; background: rgba(168, 85, 247, 0.1); padding: 15px; border-radius: 8px; border: 1px dashed var(--color-purple-alt);">
                            <span class="text-purple-alt" style="font-size: 0.8rem;"><i class="fa-solid fa-flask"></i> EMA Module: Generates an effective medium by mixing two existing materials. The resulting dispersion curve will be precalculated automatically.</span>
                            <div style="display: flex; gap: 15px;">
                                <div style="flex: 1;">
                                    <label style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Host Medium</label>
                                    <select id="new-mat-host" class="ema-select" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></select>
                                </div>
                                <div style="flex: 1;">
                                    <label style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Inclusion Material / Void</label>
                                    <select id="new-mat-inc" class="ema-select" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></select>
                                </div>
                            </div>
                            <div style="display: flex; gap: 15px;">
                                <div style="flex: 1;">
                                    <label style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Fill Factor / Volume Fraction (f) <span class="custom-tooltip" data-tooltip="Fraction of the inclusion material in the host medium (0 to 1). E.g. 0.5 means 50% inclusion, 50% host.">?</span></label>
                                    <input type="number" id="new-mat-ff" value="0.5" step="0.05" min="0" max="1" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                </div>
                                <div style="flex: 1;">
                                    <label style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 5px;">EMA Model <span class="custom-tooltip" data-tooltip="Maxwell-Garnett is best for dilute inclusions (f < 0.3). Bruggeman is better for randomly mixed composites of roughly equal fractions.">?</span></label>
                                    <select id="new-mat-algo" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                        <option value="MG">Maxwell-Garnett</option>
                                        <option value="Bruggeman">Bruggeman</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- 2D Zone -->
                        <div id="new-mat-2d-zone" style="display: none; background: rgba(56, 189, 248, 0.1); padding: 15px; border-radius: 8px; border: 1px dashed var(--color-light-blue);">
                            <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Monolayer Thickness (nm) <span class="custom-tooltip" data-tooltip="Physical thickness of a single atomic/molecular layer of this 2D material. E.g. Graphene is typically 0.34 nm.">?</span></label>
                            <input type="number" id="new-mat-dmono" value="0.34" step="0.01" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                        </div>

                        <!-- Optical Data Config -->
                        <div id="new-mat-data-zone" style="display: flex; flex-direction: column; gap: 15px;">
                            <div>
                                <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Data Source (Optical Properties)</label>
                                <select id="new-mat-type" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                    <option value="constant">Constant</option>
                                    <option value="dispersive">Dispersive</option>
                                    <option value="formula">Analytic Formula (Sellmeier, Drude, etc.)</option>
                                </select>
                            </div>

                            <!-- Constant Zone -->
                            <div id="new-mat-const-zone" style="display: flex; flex-direction: column; gap: 15px;">
                                <div>
                                    <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Data Format</label>
                                    <select id="new-mat-const-format" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                        <option value="nk">n, k</option>
                                        <option value="eps">ε_r, ε_i</option>
                                    </select>
                                </div>
                                <div style="display: flex; gap: 15px;">
                                    <div style="flex: 1;">
                                        <label id="new-mat-const-label-1" style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Refractive Index (n)</label>
                                        <input type="number" id="new-mat-n" value="1.5" step="0.001" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                    </div>
                                    <div style="flex: 1;">
                                        <label id="new-mat-const-label-2" style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Extinction Coeff. (k)</label>
                                        <input type="number" id="new-mat-k" value="0.0" step="0.001" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                    </div>
                                </div>
                            </div>

                            <!-- Dispersive Zone -->
                            <div id="new-mat-disp-zone" style="display: none; flex-direction: column; gap: 15px;">
                                <div style="display: flex; gap: 15px; align-items: flex-end;">
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Data Format</label>
                                        <select id="new-mat-data-format" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                            <option value="nk">Wavelength, n, k</option>
                                            <option value="eps">Wavelength, ε_r, ε_i</option>
                                        </select>
                                    </div>
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Interpolation</label>
                                        <select id="new-mat-interp" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                            <option value="spline">Cubic Spline (Smooth)</option>
                                            <option value="linear">Linear</option>
                                        </select>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 15px; align-items: flex-end;">
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Number of Points</label>
                                        <input type="number" id="new-mat-points" value="500" min="10" max="5000" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Resolution of the generated dispersion curve">
                                    </div>
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Extrapolation</label>
                                        <select id="new-mat-extrap" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                            <option value="constant">Constant</option>
                                            <option value="linear">Linear</option>
                                        </select>
                                    </div>
                                </div>
                                
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 5px;">
                                        <div style="display: flex; gap: 10px; align-items: center;">
                                            <label id="new-mat-data-label" style="font-size: 0.85rem; color: var(--text-muted); display: block;">Paste Data Here (Wavelength   n   k)</label>
                                            <select id="new-mat-data-unit" style="padding: 2px 5px; font-size: 0.8rem; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Select the unit of your pasted/imported wavelengths">
                                                <option value="nm">nm</option>
                                                <option value="um">μm</option>
                                                <option value="eV">eV</option>
                                                <option value="1/cm">cm⁻¹</option>
                                            </select>
                                        </div>
                                        <div style="display: flex; gap: 10px;">
                                            <button id="btn-open-digitizer" style="font-size: 0.8rem; background: rgba(16, 185, 129, 0.1); color: var(--accent-green); padding: 4px 10px; border-radius: 4px; cursor: pointer; border: 1px solid rgba(16, 185, 129, 0.3); transition: all 0.2s;"><i class="fa-solid fa-crosshairs"></i> Digitize from Image</button>
                                            <label for="ri-file-upload" style="font-size: 0.8rem; background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); padding: 4px 10px; border-radius: 4px; cursor: pointer; border: 1px solid rgba(59, 130, 246, 0.3); transition: all 0.2s;"><i class="fa-solid fa-file-import"></i> Import refractiveindex.info</label>
                                            <input type="file" id="ri-file-upload" accept=".csv,.txt,.yml,.yaml" style="display: none;">
                                        </div>
                                    </div>
                                    <span style="font-size: 0.75rem; color: var(--text-muted);">Copy directly from Excel/CSV, import a file, or digitize a plot image.</span>
                                    <textarea id="new-mat-data" rows="8" placeholder="Example:\n400 1.5 0.1\n500 1.45 0.08\n600 1.42 0.05" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; font-family: monospace; margin-top: 5px;"></textarea>
                                </div>
                            </div>

                            <!-- Analytic Formula Zone -->
                            <div id="new-mat-formula-zone" style="display: none; flex-direction: column; gap: 15px;">
                                <div>
                                    <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Formula Type</label>
                                    <select id="new-mat-formula-type" style="width: 100%; padding: 10px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                        <option value="sellmeier">Sellmeier Equation</option>
                                        <option value="drude">Drude Model</option>
                                        <option value="drude-lorentz">Drude-Lorentz Model</option>
                                        <option value="kubo">Kubo Formula (Graphene)</option>
                                    </select>
                                </div>

                                <div id="formula-params-container" style="display: flex; flex-direction: column; gap: 15px; background: rgba(59, 130, 246, 0.05); padding: 15px; border-radius: 8px; border: 1px dashed var(--accent-blue);">
                                    <!-- Dynamic parameters will go here -->
                                </div>

                                <div style="display: flex; gap: 15px; align-items: flex-end;">
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Wavelength Range (nm)</label>
                                        <div style="display: flex; gap: 5px; align-items: center;">
                                            <input type="number" id="formula-w-min" value="300" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Min">
                                            <span style="color: var(--text-muted);">-</span>
                                            <input type="number" id="formula-w-max" value="1200" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Max">
                                        </div>
                                    </div>
                                    <div style="flex: 1;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Points</label>
                                        <input type="number" id="formula-points" value="500" min="10" max="5000" style="width: 100%; padding: 8px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                    <div style="padding: 20px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; background: var(--bg-sidebar);">
                        <button id="btn-save-mat" style="background: var(--accent-blue); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer;">Save Material</button>
                    </div>
                </div>
            </div>
        `;

        const tc = window.getPlotThemeColors();
        const initialLayout = { paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text }};
        Plotly.newPlot('mat-dispersion-plot', [], initialLayout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['mat-dispersion-plot'] = { data: [], layout: initialLayout };
        
        // Export and Import logic removed as per user request

        this.renderMaterialList();
        this.populateEMASelects();
    },

    attachEvents() {
        // Range Updates
        document.getElementById('plot-w-min').addEventListener('change', () => this.plotDispersion());
        document.getElementById('plot-w-max').addEventListener('change', () => this.plotDispersion());
        if(document.getElementById('plot-y1-select')) document.getElementById('plot-y1-select').addEventListener('change', () => this.plotDispersion());
        if(document.getElementById('plot-y2-select')) document.getElementById('plot-y2-select').addEventListener('change', () => this.plotDispersion());

        // RefractiveIndex Importer
        const riUpload = document.getElementById('ri-file-upload');
        if (riUpload) {
            riUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.parseRefractiveIndexFile(ev.target.result);
                };
                reader.readAsText(file);
                e.target.value = '';
            });
        }

        // Image Digitizer
        const btnDigi = document.getElementById('btn-open-digitizer');
        if (btnDigi) {
            btnDigi.addEventListener('click', () => {
                window.open('digitizer.html?v=37', 'ImageDigitizer', 'width=1100,height=750,resizable=yes');
            });
        }
        
        // Listen for data from the Digitizer window
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'DIGITIZER_DATA') {
                const typeDropdown = document.getElementById('new-mat-type');
                if (typeDropdown) {
                    typeDropdown.value = 'dispersive';
                    typeDropdown.dispatchEvent(new Event('change'));
                }
                
                const dataArea = document.getElementById('new-mat-data');
                if (dataArea) {
                    dataArea.value = e.data.data;
                    const origBorder = dataArea.style.border;
                    dataArea.style.border = '2px solid var(--accent-green)';
                    setTimeout(() => { dataArea.style.border = origBorder; }, 800);
                }
            }
        });

        // List Navigation & Checkbox plot toggling
        document.getElementById('mat-list-container').addEventListener('click', (e) => {
            const btn = e.target.closest('.mat-list-item');
            if (btn) {
                if (e.target.classList.contains('mat-plot-toggle')) {
                    const matKey = e.target.dataset.mat;
                    if (e.target.checked) this.plottedMaterials.add(matKey);
                    else this.plottedMaterials.delete(matKey);
                    
                    this.plotDispersion();
                    return; 
                }

                this.selectedMaterial = btn.dataset.mat;
                this.renderMaterialList();
                this.viewMaterial(this.selectedMaterial);
            }
        });

        // Delete Material
        document.getElementById('btn-delete-mat').addEventListener('click', () => {
            const predefined = ['BK7', 'SiO2', 'TiO2', 'Air', 'H2O', 'Au', 'Ag', 'Graphene'];
            if (predefined.includes(this.selectedMaterial)) return alert("Cannot delete a system predefined material.");
            
            if(confirm(`Are you sure you want to delete material ${this.selectedMaterial}?`)) {
                this.plottedMaterials.delete(this.selectedMaterial);
                delete this.db[this.selectedMaterial];
                
                this.saveToStorage();
                document.dispatchEvent(new CustomEvent('materialsUpdated'));
                
                this.selectedMaterial = 'BK7';
                this.plottedMaterials.add(this.selectedMaterial);
                
                this.renderMaterialList();
                this.populateEMASelects();
                this.viewMaterial(this.selectedMaterial);
            }
        });

        // Delete Selected Material (Sidebar button)
        const btnDeleteSidebar = document.getElementById('btn-delete-selected-mat-sidebar');
        if (btnDeleteSidebar) {
            btnDeleteSidebar.addEventListener('click', () => {
                const predefined = ['BK7', 'SiO2', 'TiO2', 'Air', 'H2O', 'Au', 'Ag', 'Graphene'];
                if (predefined.includes(this.selectedMaterial)) return alert("Cannot delete a system predefined material.");
                
                if(confirm(`Are you sure you want to delete material ${this.selectedMaterial}?`)) {
                    this.plottedMaterials.delete(this.selectedMaterial);
                    delete this.db[this.selectedMaterial];
                    
                    this.saveToStorage();
                    document.dispatchEvent(new CustomEvent('materialsUpdated'));
                    
                    this.selectedMaterial = 'BK7';
                    this.plottedMaterials.add(this.selectedMaterial);
                    
                    this.renderMaterialList();
                    this.populateEMASelects();
                    this.viewMaterial(this.selectedMaterial);
                }
            });
        }

        // Add Material Modal events
        const modal = document.getElementById('add-mat-modal');
        document.getElementById('btn-show-add-modal').addEventListener('click', () => modal.style.display = 'flex');
        document.getElementById('btn-close-modal').addEventListener('click', () => modal.style.display = 'none');
        
        document.getElementById('new-mat-category').addEventListener('change', (e) => {
            const cat = e.target.value;
            document.getElementById('new-mat-porous-zone').style.display = cat === 'porous' ? 'flex' : 'none';
            document.getElementById('new-mat-2d-zone').style.display = cat === '2d' ? 'block' : 'none';
            document.getElementById('new-mat-data-zone').style.display = cat === 'porous' ? 'none' : 'flex';
        });

        document.getElementById('new-mat-type').addEventListener('change', (e) => {
            const val = e.target.value;
            document.getElementById('new-mat-const-zone').style.display = val === 'constant' ? 'flex' : 'none';
            document.getElementById('new-mat-disp-zone').style.display = val === 'dispersive' ? 'flex' : 'none';
            document.getElementById('new-mat-formula-zone').style.display = val === 'formula' ? 'flex' : 'none';
            if (val === 'formula') this.renderFormulaUI();
        });

        document.getElementById('new-mat-formula-type').addEventListener('change', () => this.renderFormulaUI());

        document.getElementById('new-mat-data-format').addEventListener('change', (e) => {
            const label = document.getElementById('new-mat-data-label');
            if (label) {
                if (e.target.value === 'eps') {
                    label.innerText = 'Paste Data Here (Wavelength   ε_r   ε_i)';
                } else {
                    label.innerText = 'Paste Data Here (Wavelength   n   k)';
                }
            }
        });

        document.getElementById('new-mat-const-format').addEventListener('change', (e) => {
            const l1 = document.getElementById('new-mat-const-label-1');
            const l2 = document.getElementById('new-mat-const-label-2');
            if (l1 && l2) {
                if (e.target.value === 'eps') {
                    l1.innerText = 'Permittivity (ε_r)';
                    l2.innerText = 'Permittivity (ε_i)';
                } else {
                    l1.innerText = 'Refractive Index (n)';
                    l2.innerText = 'Extinction Coeff. (k)';
                }
            }
        });

        document.getElementById('btn-save-mat').addEventListener('click', () => this.saveNewMaterial());
    },

    renderFormulaUI() {
        const type = document.getElementById('new-mat-formula-type').value;
        const container = document.getElementById('formula-params-container');
        if (!container) return;

        let html = '';
        if (type === 'sellmeier') {
            html += `
                <div style="font-size: 0.8rem; color: var(--accent-blue); margin-bottom: 5px;"><i class="fa-solid fa-square-root-variable"></i> n²(λ) = 1 + (B₁λ²)/(λ²-C₁) + (B₂λ²)/(λ²-C₂) + (B₃λ²)/(λ²-C₃)</div>
                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">B₁</label><input type="number" id="f-sell-b1" value="0.6961663" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">C₁ (μm²)</label><input type="number" id="f-sell-c1" value="0.0046791" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">B₂</label><input type="number" id="f-sell-b2" value="0.4079426" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">C₂ (μm²)</label><input type="number" id="f-sell-c2" value="0.013512" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">B₃</label><input type="number" id="f-sell-b3" value="0.8974794" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">C₃ (μm²)</label><input type="number" id="f-sell-c3" value="97.9340" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
            `;
        } else if (type === 'drude') {
            html += `
                <div style="font-size: 0.8rem; color: var(--accent-blue); margin-bottom: 5px;"><i class="fa-solid fa-square-root-variable"></i> ε(ω) = ε_∞ - ω_p² / (ω² + i·γ·ω)</div>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">ε_∞ (High freq. permittivity)</label><input type="number" id="f-drude-epsinf" value="1.0" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-end;">
                    <div style="flex: 2;"><label style="font-size: 0.8rem; color: var(--text-muted);">Plasma Freq (ω_p)</label><input type="number" id="f-drude-wp" value="9.0" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;">
                        <select id="f-drude-wp-unit" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            <option value="eV">eV</option><option value="rad/s">rad/s</option><option value="Hz">Hz</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-end; margin-top: 10px;">
                    <div style="flex: 2;"><label style="font-size: 0.8rem; color: var(--text-muted);">Damping / Collision Rate (γ)</label><input type="number" id="f-drude-gamma" value="0.1" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;">
                        <select id="f-drude-gamma-unit" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                            <option value="eV">eV</option><option value="rad/s">rad/s</option><option value="Hz">Hz</option>
                        </select>
                    </div>
                </div>
            `;
        } else if (type === 'drude-lorentz') {
            html += `
                <div style="font-size: 0.8rem; color: var(--accent-blue); margin-bottom: 5px;"><i class="fa-solid fa-square-root-variable"></i> ε(ω) = ε_drude + Σ ( f_j·ω_pj² / (ω_0j² - ω² - i·γ_j·ω) )</div>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">ε_∞ (High freq. permittivity)</label><input type="number" id="f-dl-epsinf" value="1.0" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
                <!-- Drude Base -->
                <div style="font-size: 0.8rem; font-weight: bold; color: var(--text-main);">Drude Base</div>
                <div style="display: flex; gap: 5px; align-items: flex-end;">
                    <div style="flex: 1;"><input type="number" id="f-dl-wp" value="9.0" step="any" placeholder="ω_p" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Plasma Frequency ω_p"></div>
                    <div style="flex: 1;"><input type="number" id="f-dl-gamma" value="0.1" step="any" placeholder="γ" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Damping γ"></div>
                    <select id="f-dl-unit" style="padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Unit for all Drude inputs">
                        <option value="eV">eV</option><option value="rad/s">rad/s</option>
                    </select>
                </div>
                
                <!-- Lorentz Oscillators -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                    <div style="font-size: 0.8rem; font-weight: bold; color: var(--text-main);">Lorentz Oscillators</div>
                    <button id="btn-add-lorentz" style="background: var(--accent-green); color: white; border: none; border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; cursor: pointer;">+ Add</button>
                </div>
                <div id="dl-oscillators" style="display: flex; flex-direction: column; gap: 5px;"></div>
            `;
        } else if (type === 'kubo') {
            html += `
                <div style="font-size: 0.8rem; color: var(--accent-blue); margin-bottom: 5px;"><i class="fa-solid fa-square-root-variable"></i> Kubo Formula for 2D Graphene Conductivity</div>
                <div style="display: flex; gap: 10px; margin-bottom: 5px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">Chem. Potential μ_c (eV)</label><input type="number" id="f-kubo-mu" value="0.4" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">Temperature T (K)</label><input type="number" id="f-kubo-t" value="300" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">Scattering Rate Γ (eV)</label><input type="number" id="f-kubo-gamma" value="0.01" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                    <div style="flex: 1;"><label style="font-size: 0.8rem; color: var(--text-muted);">Effective Thickness d (nm)</label><input type="number" id="f-kubo-d" value="0.34" step="any" style="width: 100%; padding: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;"></div>
                </div>
            `;
        }

        container.innerHTML = html;

        if (type === 'drude-lorentz') {
            const oscContainer = document.getElementById('dl-oscillators');
            const addOsc = () => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.gap = '5px';
                div.innerHTML = `
                    <input type="number" class="dl-osc-wp" placeholder="ω_p" step="any" style="flex: 1; min-width: 0; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Oscillator Strength/Plasma Freq">
                    <input type="number" class="dl-osc-w0" placeholder="ω_0" step="any" style="flex: 1; min-width: 0; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Resonance Freq">
                    <input type="number" class="dl-osc-gamma" placeholder="γ" step="any" style="flex: 1; min-width: 0; padding: 6px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;" title="Damping">
                    <button class="btn-rm-osc" style="background: none; border: none; color: var(--text-danger); cursor: pointer;"><i class="fa-solid fa-times"></i></button>
                `;
                div.querySelector('.btn-rm-osc').addEventListener('click', () => div.remove());
                oscContainer.appendChild(div);
            };
            addOsc(); // Add one by default
            document.getElementById('btn-add-lorentz').addEventListener('click', addOsc);
        }
    },

    renderMaterialList() {
        const container = document.getElementById('mat-list-container');
        if (!container) return;

        let html = '';
        for (const [key, val] of Object.entries(this.db)) {
            let icon = '<i class="fa-solid fa-cube" style="color: var(--text-muted);"></i>';
            if (val.category === 'porous') icon = '<i class="fa-solid fa-flask text-purple-alt"></i>';
            else if (val.category === '2d') icon = '<i class="fa-solid fa-layer-group text-light-blue"></i>';
            else if (val.type === 'dispersive') icon = '<i class="fa-solid fa-chart-area" style="color: var(--accent-blue);"></i>';
            
            const isActive = key === this.selectedMaterial;
            const isPlotted = this.plottedMaterials.has(key);
            const bg = isActive ? 'var(--bg-card-hover)' : 'transparent';
            const border = isActive ? 'border-left: 3px solid var(--accent-blue);' : 'border-left: 3px solid transparent;';
            
            html += `
                <div class="mat-list-item" data-mat="${key}" style="display: flex; align-items: center; gap: 10px; padding: 10px 15px; cursor: pointer; background: ${bg}; ${border} transition: 0.2s; border-radius: 4px; margin-bottom: 2px;">
                    <input type="checkbox" class="mat-plot-toggle" data-mat="${key}" ${isPlotted ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;" title="Show on plot">
                    ${icon}
                    <span style="color: var(--text-main); font-weight: ${isActive ? 'bold' : 'normal'}; flex: 1;">${key}</span>
                </div>
            `;
        }
        container.innerHTML = html;
    },

    populateEMASelects() {
        const hostSel = document.getElementById('new-mat-host');
        const incSel = document.getElementById('new-mat-inc');
        if (!hostSel || !incSel) return;

        let opts = '';
        for (const key of Object.keys(this.db)) opts += `<option value="${key}">${key}</option>`;
        
        hostSel.innerHTML = opts;
        incSel.innerHTML = opts;
        hostSel.value = 'BK7';
        incSel.value = 'Air';
    },

    viewMaterial(matKey) {
        const mat = this.db[matKey];
        if (!mat) return;

        document.getElementById('mat-view-title').innerText = matKey;
        
        const predefined = ['BK7', 'SiO2', 'TiO2', 'Air', 'H2O', 'Au', 'Ag', 'Graphene'];
        const isCustom = !predefined.includes(matKey);
        
        const btnDelete = document.getElementById('btn-delete-mat');
        if (btnDelete) btnDelete.style.display = isCustom ? 'inline-block' : 'none';
        
        const btnDeleteSidebar = document.getElementById('btn-delete-selected-mat-sidebar');
        if (btnDeleteSidebar) btnDeleteSidebar.style.display = isCustom ? 'block' : 'none';

        let typeStr = '';
        if (mat.category === 'porous') typeStr = `<i class="fa-solid fa-flask"></i> Porous Material (EMA ${mat.algo}) - Host: ${mat.host}, Inclusion/Void: ${mat.inclusion}, f=${mat.ff}`;
        else if (mat.category === '2d') typeStr = `<i class="fa-solid fa-layer-group"></i> 2D Material (Monolayer = ${mat.d_mono} nm) - ${mat.type === 'constant' ? 'Isotropic' : 'Dispersive'}`;
        else typeStr = `<i class="fa-solid fa-cube"></i> Standard Material - ${mat.type === 'constant' ? 'Isotropic' : 'Dispersive'}`;
        
        document.getElementById('mat-view-type').innerHTML = typeStr;

        this.plotDispersion();
    },

    plotDispersion() {
        const wMin = parseFloat(document.getElementById('plot-w-min').value) || 300;
        const wMax = parseFloat(document.getElementById('plot-w-max').value) || 1200;
        const points = 300;
        const step = (wMax - wMin) / points;

        const y1Type = document.getElementById('plot-y1-select') ? document.getElementById('plot-y1-select').value : 'n';
        const y2Type = document.getElementById('plot-y2-select') ? document.getElementById('plot-y2-select').value : 'k';

        const traces = [];
        const dashStyles = ['solid', 'dash', 'dot', 'dashdot'];
        
        const colorsN = ['#3b82f6', '#0ea5e9', '#6366f1', '#2dd4bf', '#8b5cf6'];
        const colorsK = ['#ef4444', '#f97316', '#f43f5e', '#ec4899', '#be123c'];
        let colorIdx = 0;

        if (this.plottedMaterials.size === 0) {
             const tc = window.getPlotThemeColors();
             const emptyLayout = { paper_bgcolor: tc.bg, plot_bgcolor: tc.bg };
             Plotly.react('mat-dispersion-plot', [], emptyLayout, { responsive: true, displayModeBar: true });
             window.PlotRegistry = window.PlotRegistry || {};
             window.PlotRegistry['mat-dispersion-plot'] = { data: [], layout: emptyLayout };
             return;
        }

        this.plottedMaterials.forEach(matKey => {
            const mat = this.db[matKey];
            if (!mat) return;

            const wArr = [], y1Arr = [], y2Arr = [];
            for (let i = 0; i <= points; i++) {
                const w = wMin + i * step;
                const nk = getNKAtWave(mat, w);
                wArr.push(w);
                
                const eps = { r: nk.n*nk.n - nk.k*nk.k, i: 2*nk.n*nk.k };
                
                if (y1Type === 'n') y1Arr.push(nk.n);
                else if (y1Type === 'k') y1Arr.push(nk.k);
                else if (y1Type === 'eps_r') y1Arr.push(eps.r);
                else if (y1Type === 'eps_i') y1Arr.push(eps.i);

                if (y2Type === 'n') y2Arr.push(nk.n);
                else if (y2Type === 'k') y2Arr.push(nk.k);
                else if (y2Type === 'eps_r') y2Arr.push(eps.r);
                else if (y2Type === 'eps_i') y2Arr.push(eps.i);
            }

            const cStyle = dashStyles[colorIdx % dashStyles.length];
            const cN = colorsN[colorIdx % colorsN.length];
            const cK = colorsK[colorIdx % colorsK.length];

            traces.push({
                x: wArr, y: y1Arr, name: `${y1Type} (${matKey})`,
                type: 'scatter', mode: 'lines',
                line: { color: cN, width: 2.5, dash: cStyle }
            });

            traces.push({
                x: wArr, y: y2Arr, name: `${y2Type} (${matKey})`,
                type: 'scatter', mode: 'lines', yaxis: 'y2',
                line: { color: cK, width: 2.5, dash: cStyle }
            });
            
            colorIdx++;
        });

        const shapes = [];
        this.plottedMaterials.forEach(matKey => {
            const mat = this.db[matKey];
            if (!mat || mat.type !== 'dispersive' || !mat.data || mat.data.length === 0) return;
            const wStart = mat.data[0].w;
            const wEnd = mat.data[mat.data.length - 1].w;
            if (wStart >= wMin && wStart <= wMax) {
                shapes.push({
                    type: 'line', x0: wStart, x1: wStart, y0: 0, y1: 1, yref: 'paper',
                    line: { color: window.getCSSColor('--text-muted'), width: 1.5, dash: 'dot' }
                });
            }
            if (wEnd >= wMin && wEnd <= wMax) {
                shapes.push({
                    type: 'line', x0: wEnd, x1: wEnd, y0: 0, y1: 1, yref: 'paper',
                    line: { color: window.getCSSColor('--text-muted'), width: 1.5, dash: 'dot' }
                });
            }
        });

        const tc = window.getPlotThemeColors();
        const y1TitleMap = { 'n': 'Refractive Index (n)', 'k': 'Extinction Coeff. (k)', 'eps_r': 'Permittivity (ε_r)', 'eps_i': 'Permittivity (ε_i)' };
        const y2TitleMap = { 'n': 'Refractive Index (n)', 'k': 'Extinction Coeff. (k)', 'eps_r': 'Permittivity (ε_r)', 'eps_i': 'Permittivity (ε_i)' };

        const layout = {
            shapes: shapes,
            paper_bgcolor: tc.bg, plot_bgcolor: tc.bg, font: { color: tc.text },
            xaxis: { title: 'Wavelength (nm)', gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis: { title: y1TitleMap[y1Type] || 'Y1', titlefont: {color: 'var(--accent-blue)'}, tickfont: {color: 'var(--accent-blue)'}, gridcolor: tc.grid, zerolinecolor: tc.grid },
            yaxis2: { title: y2TitleMap[y2Type] || 'Y2', titlefont: {color: 'var(--accent-green)'}, tickfont: {color: 'var(--accent-green)'}, overlaying: 'y', side: 'right', gridcolor: tc.grid, zerolinecolor: tc.grid },
            margin: { t: 30, b: 40, l: 60, r: 60 },
            showlegend: true,
            legend: { x: 0, y: 1.1, orientation: 'h' }
        };

        Plotly.react('mat-dispersion-plot', traces, layout, { responsive: true, displayModeBar: true });
        
        window.PlotRegistry = window.PlotRegistry || {};
        window.PlotRegistry['mat-dispersion-plot'] = { data: JSON.parse(JSON.stringify(traces)), layout: JSON.parse(JSON.stringify(layout)) };
    },

    precomputeEMAData(hostMat, incMat, ff, algo) {
        const data = [];
        for (let w = 200; w <= 2500; w += 2) {
            const h = getNKAtWave(hostMat, w);
            const i = getNKAtWave(incMat, w);
            const epsH = getEps(h.n, h.k);
            const epsI = getEps(i.n, i.k);
            
            let epsEff;
            if (algo === 'MG') {
                const diff = Complex.sub(epsI, epsH);
                const term1 = Complex.add(epsI, Complex.mulNum(epsH, 2));
                const num = Complex.add(term1, Complex.mulNum(diff, 2*ff));
                const den = Complex.sub(term1, Complex.mulNum(diff, ff));
                epsEff = Complex.mul(epsH, Complex.div(num, den));
            } else {
                const termH = Complex.mulNum(epsH, 2 - 3*ff);
                const termI = Complex.mulNum(epsI, 3*ff - 1);
                const B = Complex.add(termH, termI);
                const B2 = Complex.mul(B, B);
                const eightIH = Complex.mulNum(Complex.mul(epsI, epsH), 8);
                const delta = Complex.add(B2, eightIH);
                const rootDelta = Complex.sqrt(delta);
                
                let epsEff1 = Complex.div(Complex.add(B, rootDelta), {r:4, i:0});
                let epsEff2 = Complex.div(Complex.sub(B, rootDelta), {r:4, i:0});
                
                if (epsEff1.i >= -1e-6 && epsEff2.i < -1e-6) epsEff = epsEff1;
                else if (epsEff2.i >= -1e-6 && epsEff1.i < -1e-6) epsEff = epsEff2;
                else epsEff = (epsEff1.i > epsEff2.i) ? epsEff1 : epsEff2;
            }
            
            const nk = getNK(epsEff);
            data.push({ w, n: nk.n, k: nk.k }); 
        }
        return data;
    },

    parseRefractiveIndexFile(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#') && !l.includes('REFERENCES:') && !l.includes('COMMENTS:'));
        
        let n_data = [];
        let k_data = [];
        
        let currentMode = 'nk';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('wl,n') || line.includes('wl, n') || line.toLowerCase() === 'wl n') {
                currentMode = 'n';
                continue;
            }
            if (line.includes('wl,k') || line.includes('wl, k') || line.toLowerCase() === 'wl k') {
                currentMode = 'k';
                continue;
            }
            if (line.includes('wl,n,k') || line.includes('wl, n, k')) {
                currentMode = 'nk';
                continue;
            }
            if (line.includes('data:') || line.includes('type: tabulated')) {
                continue;
            }

            const parts = line.split(/[\s,;]+/).filter(p => p !== '');
            if (parts.length >= 2) {
                const w = parseFloat(parts[0]);
                if (isNaN(w)) continue;
                
                if (currentMode === 'nk' && parts.length >= 3) {
                    const n = parseFloat(parts[1]);
                    const k = parseFloat(parts[2]);
                    if (!isNaN(n) && !isNaN(k)) {
                        n_data.push({w, v: n});
                        k_data.push({w, v: k});
                    }
                } else if (currentMode === 'n') {
                    const n = parseFloat(parts[1]);
                    if (!isNaN(n)) n_data.push({w, v: n});
                } else if (currentMode === 'k') {
                    const k = parseFloat(parts[1]);
                    if (!isNaN(k)) k_data.push({w, v: k});
                } else {
                    if (parts.length >= 3) {
                        const n = parseFloat(parts[1]);
                        const k = parseFloat(parts[2]);
                        if (!isNaN(n) && !isNaN(k)) {
                            n_data.push({w, v: n});
                            k_data.push({w, v: k});
                        }
                    }
                }
            }
        }
        
        if (n_data.length === 0 && k_data.length === 0) {
            alert('Could not parse any valid optical data from this file. Make sure it contains tabulated wavelengths, n, and/or k values.');
            return;
        }

        const interpolate = (arr, targetW) => {
            if (arr.length === 0) return 0;
            if (arr.length === 1) return arr[0].v;
            if (targetW <= arr[0].w) return arr[0].v;
            if (targetW >= arr[arr.length - 1].w) return arr[arr.length - 1].v;
            
            for (let i = 0; i < arr.length - 1; i++) {
                if (targetW >= arr[i].w && targetW <= arr[i + 1].w) {
                    const diff = arr[i + 1].w - arr[i].w;
                    const t = diff === 0 ? 0 : (targetW - arr[i].w) / diff;
                    return arr[i].v + t * (arr[i + 1].v - arr[i].v);
                }
            }
            return 0;
        };

        n_data.sort((a, b) => a.w - b.w);
        k_data.sort((a, b) => a.w - b.w);

        let w_set = new Set();
        n_data.forEach(d => w_set.add(d.w));
        k_data.forEach(d => w_set.add(d.w));
        
        let w_arr = Array.from(w_set).sort((a, b) => a - b);
        let sum_w = w_arr.reduce((a, b) => a + b, 0);
        let avg_w = sum_w / w_arr.length;
        
        // Auto-detect unit and update the dropdown, but do NOT scale the values here.
        // We let the Save Material logic do the scaling so the user can visually verify and correct if wrong.
        const unitDropdown = document.getElementById('new-mat-data-unit');
        if (unitDropdown) {
            if (avg_w < 15) {
                unitDropdown.value = 'um'; // Likely micrometers or eV. We default to um.
            } else if (avg_w > 1000 && avg_w < 30000) {
                unitDropdown.value = '1/cm'; // Likely wavenumbers
            } else {
                unitDropdown.value = 'nm'; // Likely nm
            }
        }

        let outputLines = [];
        for (let w of w_arr) {
            let n_val = (n_data.length > 0) ? interpolate(n_data, w) : 1.0;
            let k_val = (k_data.length > 0) ? interpolate(k_data, w) : 0.0;
            
            let n_str = n_val.toFixed(5);
            let k_str = k_val.toFixed(5);
            
            outputLines.push(`${w}\t${n_str}\t${k_str}`);
        }
        
        const dataArea = document.getElementById('new-mat-data');
        if (dataArea) {
            dataArea.value = outputLines.join('\n');
            const origBorder = dataArea.style.border;
            dataArea.style.border = '2px solid var(--accent-green)';
            setTimeout(() => { dataArea.style.border = origBorder; }, 800);
        }
    },

    saveNewMaterial() {
        try {
            const name = document.getElementById('new-mat-name').value.trim();
            if (!name) return alert("Please enter a name!");
            if (this.db[name]) {
            if(!confirm("A material with this name already exists. Overwrite?")) return;
        }

        const category = document.getElementById('new-mat-category').value;
        let newMat = { category: category };

        if (category === 'porous') {
            const hostKey = document.getElementById('new-mat-host').value;
            const incKey = document.getElementById('new-mat-inc').value;
            const ff = parseFloat(document.getElementById('new-mat-ff').value);
            const algo = document.getElementById('new-mat-algo').value;

            if (isNaN(ff) || ff < 0 || ff > 1) return alert("The volume fraction (f) must be between 0 and 1.");
            
            newMat.host = hostKey;
            newMat.inclusion = incKey;
            newMat.ff = ff;
            newMat.algo = algo;
            
            newMat.type = 'dispersive';
            newMat.data = this.precomputeEMAData(this.db[hostKey], this.db[incKey], ff, algo);

        } else {
            if (category === '2d') {
                newMat.d_mono = parseFloat(document.getElementById('new-mat-dmono').value) || 0.34;
            }

            const type = document.getElementById('new-mat-type').value;

            if (type === 'formula') {
                newMat.type = 'dispersive'; // We convert formulas to tabulated dispersive data
                const fType = document.getElementById('new-mat-formula-type').value;
                const wMin = parseFloat(document.getElementById('formula-w-min').value) || 300;
                const wMax = parseFloat(document.getElementById('formula-w-max').value) || 1200;
                const points = parseInt(document.getElementById('formula-points').value) || 500;
                
                let params = {};
                if (fType === 'sellmeier') {
                    params = {
                        B1: parseFloat(document.getElementById('f-sell-b1').value) || 0,
                        C1: parseFloat(document.getElementById('f-sell-c1').value) || 0,
                        B2: parseFloat(document.getElementById('f-sell-b2').value) || 0,
                        C2: parseFloat(document.getElementById('f-sell-c2').value) || 0,
                        B3: parseFloat(document.getElementById('f-sell-b3').value) || 0,
                        C3: parseFloat(document.getElementById('f-sell-c3').value) || 0,
                        unit: 'um'
                    };
                } else if (fType === 'drude') {
                    params = {
                        eps_inf: parseFloat(document.getElementById('f-drude-epsinf').value) || 1,
                        wp: parseFloat(document.getElementById('f-drude-wp').value) || 0,
                        gamma: parseFloat(document.getElementById('f-drude-gamma').value) || 0,
                        wp_unit: document.getElementById('f-drude-wp-unit').value,
                        gamma_unit: document.getElementById('f-drude-gamma-unit').value
                    };
                } else if (fType === 'drude-lorentz') {
                    params = {
                        eps_inf: parseFloat(document.getElementById('f-dl-epsinf').value) || 1,
                        drude: {
                            wp: parseFloat(document.getElementById('f-dl-wp').value) || 0,
                            gamma: parseFloat(document.getElementById('f-dl-gamma').value) || 0,
                            wp_unit: document.getElementById('f-dl-unit').value,
                            gamma_unit: document.getElementById('f-dl-unit').value
                        },
                        oscillators: []
                    };
                    const oscs = document.querySelectorAll('#dl-oscillators > div');
                    oscs.forEach(osc => {
                        const wp = parseFloat(osc.querySelector('.dl-osc-wp').value) || 0;
                        const w0 = parseFloat(osc.querySelector('.dl-osc-w0').value) || 0;
                        const gamma = parseFloat(osc.querySelector('.dl-osc-gamma').value) || 0;
                        if (wp || w0 || gamma) {
                            params.oscillators.push({ wp, w0, gamma, unit: document.getElementById('f-dl-unit').value });
                        }
                    });
                } else if (fType === 'kubo') {
                    params = {
                        muc: parseFloat(document.getElementById('f-kubo-mu').value) || 0.4,
                        T: parseFloat(document.getElementById('f-kubo-t').value) || 300,
                        gamma: parseFloat(document.getElementById('f-kubo-gamma').value) || 0.01,
                        d: parseFloat(document.getElementById('f-kubo-d').value) || 0.34
                    };
                }

                const finalData = [];
                const step = (wMax - wMin) / (points - 1);
                for (let i = 0; i < points; i++) {
                    const w = wMin + i * step;
                    let nk = {n:1, k:0};
                    if (fType === 'sellmeier') nk = MaterialFormulas.evaluateSellmeier(w, params);
                    else if (fType === 'drude') nk = MaterialFormulas.evaluateDrude(w, params);
                    else if (fType === 'drude-lorentz') nk = MaterialFormulas.evaluateDrudeLorentz(w, params);
                    else if (fType === 'kubo') nk = MaterialFormulas.evaluateKubo(w, params);
                    finalData.push({ w, n: nk.n, k: nk.k });
                }
                newMat.data = finalData;
                newMat.extrap = 'constant';

            } else if (type === 'constant') {
                newMat.type = 'constant';
                let v1 = parseFloat(document.getElementById('new-mat-n').value);
                let v2 = parseFloat(document.getElementById('new-mat-k').value);
                if(isNaN(v1) || isNaN(v2)) return alert("Invalid values!");
                
                if (document.getElementById('new-mat-const-format').value === 'eps') {
                    const nk = getNK({ r: v1, i: v2 });
                    newMat.n = nk.n;
                    newMat.k = nk.k;
                } else {
                    newMat.n = v1;
                    newMat.k = v2;
                }
            } else {
                const rawData = document.getElementById('new-mat-data').value;
                const lines = rawData.split('\n');
                let parsedData = [];
                
                for (let line of lines) {
                    const parts = line.trim().split(/[\s,\t]+/).map(parseFloat);
                    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        const k_val = (parts.length >= 3 && !isNaN(parts[2])) ? Math.abs(parts[2]) : 0;
                        parsedData.push({ w: parts[0], n: parts[1], k: k_val });
                    }
                }
                
                if (parsedData.length < 2) return alert("Error processing the table. At least 2 rows are required.");
                
                // Convert Wavelengths based on selected unit
                const dataUnit = document.getElementById('new-mat-data-unit').value;
                for (let p of parsedData) {
                    if (dataUnit === 'um') {
                        p.w = p.w * 1000;
                    } else if (dataUnit === 'eV') {
                        p.w = 1239.84193 / p.w;
                    } else if (dataUnit === '1/cm') {
                        p.w = 1e7 / p.w;
                    }
                }
                
                parsedData.sort((a, b) => a.w - b.w);
                
                const uniqueParsedData = [];
                for (let i = 0; i < parsedData.length; i++) {
                    if (i === 0 || parsedData[i].w !== parsedData[i - 1].w) {
                        uniqueParsedData.push(parsedData[i]);
                    }
                }
                parsedData = uniqueParsedData;
                
                const format = document.getElementById('new-mat-data-format').value;
                if (format === 'eps') {
                    for (let p of parsedData) {
                        const nk = getNK({ r: p.n, i: p.k });
                        p.n = nk.n;
                        p.k = nk.k;
                    }
                }

                const interpType = document.getElementById('new-mat-interp').value;
                const points = parseInt(document.getElementById('new-mat-points').value) || 500;
                
                const wArr = parsedData.map(p => p.w);
                const nArr = parsedData.map(p => p.n);
                const kArr = parsedData.map(p => p.k);

                const finalData = [];
                const wMin = wArr[0];
                const wMax = wArr[wArr.length - 1];
                const step = (wMax - wMin) / (points - 1);

                if (interpType === 'spline' && parsedData.length > 2) {
                    const createSpline = (x, y) => {
                        const n = x.length - 1;
                        const a = y.slice();
                        const b = new Float64Array(n);
                        const d = new Float64Array(n);
                        const h = new Float64Array(n);
                        const alpha = new Float64Array(n);
                        const c = new Float64Array(n + 1);
                        const l = new Float64Array(n + 1);
                        const mu = new Float64Array(n + 1);
                        const z = new Float64Array(n + 1);

                        for (let i = 0; i < n; i++) h[i] = x[i + 1] - x[i];
                        for (let i = 1; i < n; i++) alpha[i] = (3 / h[i]) * (a[i + 1] - a[i]) - (3 / h[i - 1]) * (a[i] - a[i - 1]);

                        l[0] = 1; mu[0] = 0; z[0] = 0;
                        for (let i = 1; i < n; i++) {
                            l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
                            mu[i] = h[i] / l[i];
                            z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
                        }
                        l[n] = 1; z[n] = 0; c[n] = 0;
                        for (let j = n - 1; j >= 0; j--) {
                            c[j] = z[j] - mu[j] * c[j + 1];
                            b[j] = (a[j + 1] - a[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
                            d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
                        }
                        return (t) => {
                            if (t <= x[0]) return a[0];
                            if (t >= x[n]) return a[n];
                            let i = 0, j = n;
                            while (i <= j) {
                                let mid = Math.floor((i + j) / 2);
                                if (x[mid] <= t && t <= x[mid + 1]) { i = mid; break; }
                                if (t < x[mid]) j = mid - 1;
                                else i = mid + 1;
                            }
                            i = Math.min(Math.max(i, 0), n - 1);
                            const dx = t - x[i];
                            return a[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx;
                        };
                    };
                    const splineN = createSpline(wArr, nArr);
                    const splineK = createSpline(wArr, kArr);
                    for (let i = 0; i < points; i++) {
                        const w = wMin + i * step;
                        finalData.push({ w, n: Math.max(0, splineN(w)), k: Math.max(0, splineK(w)) });
                    }
                } else {
                    // Linear interpolation (also fallback for spline with <= 2 points)
                    for (let i = 0; i < points; i++) {
                        const w = wMin + i * step;
                        let valN = nArr[0], valK = kArr[0];
                        for(let j = 0; j < parsedData.length - 1; j++) {
                            if (w >= wArr[j] && w <= wArr[j+1]) {
                                const diff = wArr[j+1] - wArr[j];
                                const t = diff === 0 ? 0 : (w - wArr[j]) / diff;
                                valN = nArr[j] + t * (nArr[j+1] - nArr[j]);
                                valK = kArr[j] + t * (kArr[j+1] - kArr[j]);
                                break;
                            }
                        }
                        finalData.push({ w, n: Math.max(0, valN), k: Math.max(0, valK) });
                    }
                }

                newMat.type = 'dispersive';
                newMat.extrap = document.getElementById('new-mat-extrap').value;
                newMat.data = finalData;
            }
        }

        this.db[name] = newMat;
        this.saveToStorage();
        
        document.dispatchEvent(new CustomEvent('materialsUpdated'));
        
        document.getElementById('add-mat-modal').style.display = 'none';
        document.getElementById('new-mat-name').value = '';
        document.getElementById('new-mat-data').value = '';
        
        this.plottedMaterials.clear();
        this.plottedMaterials.add(name);
        
            this.selectedMaterial = name;
            this.renderMaterialList();
            this.populateEMASelects();
            this.viewMaterial(name);
        } catch (err) {
            console.error(err);
            alert("A apărut o eroare la salvarea materialului:\n" + err.message + "\n" + err.stack);
        }
    }
};
