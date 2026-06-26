import { simulateTMM } from '../core/tmm2x2Engine.js?v=50';
import { Complex, getEps, getNK, getNKAtWave } from '../core/materials_database.js?v=50';

// Calculează matematic constanta dielectrică pentru medii poroase / hibride
function calcEMA(hostMat, incMat, ff, algo, w) {
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
        
        // Alegem rădăcina fizic validă (k >= 0)
        if (epsEff1.i >= -1e-6 && epsEff2.i < -1e-6) epsEff = epsEff1;
        else if (epsEff2.i >= -1e-6 && epsEff1.i < -1e-6) epsEff = epsEff2;
        else epsEff = (epsEff1.i > epsEff2.i) ? epsEff1 : epsEff2;
    }
    return getNK(epsEff);
}

// Extrage și asignează proprietățile optice (cu Number parsing strict pentru a evita erorile de tip în matrice)
function evalLayersAtWavelength(layersDef, lambda, materialsDB) {
    return layersDef.map(layer => {
        if (layer.type === 'porous') {
            // Definiția materialului poros se află în baza de date, nu direct în obiectul layer
            const porousDef = materialsDB[layer.material] || {};
            
            // Extragem materialul gazdă și incluziunea pe baza definiției din baza de date
            const hostMat = materialsDB[porousDef.host] || { type: 'constant', n: 1.5, k: 0 };
            const incMat = materialsDB[porousDef.inclusion] || { type: 'constant', n: 1.0, k: 0 };
            
            // PROTECȚIE: Preia FF din baza de date dacă Sweep-ul nu l-a suprascris explicit
            const baseFF = porousDef.fraction !== undefined ? Number(porousDef.fraction) : 0.5;
            const safeFF = layer.ff !== undefined ? Number(layer.ff) : baseFF;
            const algo = porousDef.algo || 'MG';
            
            const nk = calcEMA(hostMat, incMat, safeFF, algo, Number(lambda));
            
            // Suprascriere index pt sweep garantată ca număr
            let n_val = layer.n_override !== undefined ? Number(layer.n_override) : nk.n;
            let k_val = layer.k_override !== undefined ? Number(layer.k_override) : nk.k;
            
            return { d: Number(layer.d), n: n_val, k: k_val };
        }
        
        const mat = materialsDB[layer.material] || { type: 'constant', n: 1.5, k: 0 };
        const nk = getNKAtWave(mat, Number(lambda));
        
        let d = Number(layer.d);
        if (layer.type === '2d') {
            d = (Number(layer.count) || 1) * (Number(layer.d_mono) || 0.34);
        }
        
        // Suprascriere index pt sweep garantată ca număr
        let n_val = layer.n_override !== undefined ? Number(layer.n_override) : nk.n;
        let k_val = layer.k_override !== undefined ? Number(layer.k_override) : nk.k;
        
        if (layer.n_shift !== undefined) n_val += Number(layer.n_shift);
        
        return { d: d, n: n_val, k: k_val };
    });
}

function applyParamToState(paramName, paramValue, state) {
    if (paramName.startsWith('mat_')) {
        const idx = parseInt(paramName.split('_')[1], 10);
        if (state.layers[idx]) {
            let matStr = paramValue;
            const match = matStr.match(/^(.*?)\s*\((\d+(\.\d+)?)nm\)$/);
            if (match) {
                state.layers[idx].material = match[1];
                state.layers[idx].d = parseFloat(match[2]);
            } else {
                state.layers[idx].material = matStr;
            }
            // CRITICAL: When sweeping materials, we must remove any cached/overridden n and k
            // that might have been carried over from a previous optimization applied to the base geometry.
            delete state.layers[idx].n_override;
            delete state.layers[idx].k_override;
        }
        return;
    }

    const val = Number(paramValue); // Asigurăm că toți parametrii aplicați sunt de tip float/int

    if (paramName === 'theta') state.theta = val;
    else if (paramName === 'lambda') state.lambda = val;
    else if (paramName.startsWith('d_mat_')) {
        const matName = paramName.replace('d_mat_', '');
        state.layers.forEach(l => { if (l.material === matName) l.d = val; });
        if(state.dbrParams) {
            state.dbrParams.materials.forEach(m => { if (m.material === matName) m.d = val; });
            if (state.dbrParams.defect.material === matName) state.dbrParams.defect.d = val;
        }
    }
    else if (paramName.startsWith('d_')) {
        const idx = parseInt(paramName.split('_')[1], 10);
        if (state.layers[idx]) state.layers[idx].d = val;
    }
    else if (paramName.startsWith('count_')) {
        const idx = parseInt(paramName.split('_')[1], 10);
        if (state.layers[idx]) state.layers[idx].count = Math.round(val);
    }
    else if (paramName.startsWith('ff_')) {
        const idx = parseInt(paramName.split('_')[1], 10);
        if (state.layers[idx]) state.layers[idx].ff = val;
    }
    else if (paramName.startsWith('n_')) {
        const idx = parseInt(paramName.split('_')[1], 10);
        if (state.layers[idx]) state.layers[idx].n_override = val;
    }
    else if (paramName.startsWith('k_')) {
        const idx = parseInt(paramName.split('_')[1], 10);
        if (state.layers[idx]) state.layers[idx].k_override = val;
    }
    else if (paramName === 'dbr_periods') {
        if(state.dbrParams) state.dbrParams.periods = Math.round(val);
    }
    else if (paramName === 'dbr_def_pos') {
        if(state.dbrParams) state.dbrParams.defect.afterPeriod = Math.round(val);
    }
}

self.onmessage = function(e) {
    const { 
        sweepConfigs, 
        layers, 
        fixedWavelength, 
        fixedAngle, 
        polarization,
        materialsDB,
        dbrParams,
        isDBRSweep,
        evalMode,
        innerScanConfig
    } = e.data;

    const allResults = [];
    const totalRuns = sweepConfigs.reduce((acc, conf) => acc * conf.values.length, 1);
    let currentRun = 0;

    function runCombinations(configIndex, currentParams) {
        if (configIndex === sweepConfigs.length) {
            // Instanțiem o copie proaspătă a configurației de bază pentru fiecare calcul
            let state = {
                lambda: Number(fixedWavelength),
                theta: Number(fixedAngle),
                layers: JSON.parse(JSON.stringify(layers)),
                dbrParams: JSON.parse(JSON.stringify(dbrParams))
            };

            // 1. Suprascriem variabilele din stivă cu valorile Sweep din iterația curentă
            for (const [pName, pVal] of Object.entries(currentParams)) {
                applyParamToState(pName, pVal, state);
            }

            // 2. Extindere Auto-Builder DBR (Dacă DBR Sweep e activat)
            if (isDBRSweep && state.dbrParams) {
                const dbrLayers = [];
                for (let p = 1; p <= state.dbrParams.periods; p++) {
                    state.dbrParams.materials.forEach(m => dbrLayers.push({ material: m.material, d: Number(m.d), type: 'standard' }));
                    if (state.dbrParams.hasDefect && p === state.dbrParams.defect.afterPeriod) {
                        dbrLayers.push({ material: state.dbrParams.defect.material, d: Number(state.dbrParams.defect.d), type: 'standard' });
                    }
                }
                // Adăugăm DBR-ul nou generat chiar înainte de ultimul strat (substratul)
                state.layers.splice(state.layers.length - 1, 0, ...dbrLayers);
            }

            // 3. Compilarea proprietăților optice (EMA, Dispersie & Suprascriere Indice)
            const activeLayers = evalLayersAtWavelength(state.layers, state.lambda, materialsDB);

            // 4. Simularea
            let metrics = {};
            
            if (evalMode === 'fixed') {
                // Fixed point simulation
                const result = simulateTMM({
                    lambda: state.lambda,
                    theta: state.theta,
                    polarization: polarization || 'TM',
                    layers: activeLayers
                });
                
                metrics = {
                    R: Number(result.R || 0),
                    T: Number(result.T || 0),
                    A: Number(result.A || 0),
                    phaseR: Number(result.phaseR || result.phase_r || 0),
                    phaseT: Number(result.phaseT || result.phase_t || 0)
                };
            } else {
                // Full Inner Scan logic to find Min R, FWHM, Sensitivity
                const runScan = (scanLayers, scanMode, scanMin, scanMax, scanSteps, fixedVal) => {
                    const stepSize = (scanMax - scanMin) / (scanSteps - 1 || 1);
                    const yData = new Float64Array(scanSteps);
                    const xData = new Float64Array(scanSteps);
                    
                    for (let i = 0; i < scanSteps; i++) {
                        const val = scanMin + i * stepSize;
                        xData[i] = val;
                        const lam = scanMode === 'lambda' ? val : fixedVal;
                        const th = scanMode === 'theta' ? val : fixedVal;
                        
                        // We must evaluate at the new lambda!
                        const innerActiveLayers = evalLayersAtWavelength(scanLayers, lam, materialsDB);
                        const res = simulateTMM({ lambda: lam, theta: th, polarization: polarization || 'TM', layers: innerActiveLayers });
                        yData[i] = res.R;
                    }
                    return { x: xData, y: yData };
                };
                
                // Fixed param for inner scan (if scanning theta, fixed is lambda, else fixed is theta)
                const innerFixedVal = innerScanConfig.mode === 'theta' ? state.lambda : state.theta;
                
                // Base scan
                const baseScan = runScan(state.layers, innerScanConfig.mode, innerScanConfig.min, innerScanConfig.max, innerScanConfig.steps, innerFixedVal);
                
                // Calculate Min R
                const findTrueMin = (yArr, xArr) => {
                    let minIdx = 0, minVal = Infinity, maxVal = -Infinity;
                    for (let i = 0; i < yArr.length; i++) {
                        const v = yArr[i];
                        if (Number.isFinite(v)) {
                            if (v < minVal) { minVal = v; minIdx = i; }
                            if (v > maxVal) { maxVal = v; }
                        }
                    }
                    let resPos = xArr[minIdx];
                    if (minIdx > 0 && minIdx < yArr.length - 1) {
                        const x0 = xArr[minIdx], dx = xArr[minIdx] - xArr[minIdx - 1];
                        const y_1 = yArr[minIdx - 1], y0 = yArr[minIdx], y1 = yArr[minIdx + 1];
                        const denom = y1 - 2 * y0 + y_1;
                        if (denom !== 0) resPos = x0 - (dx / 2) * ((y1 - y_1) / denom);
                    }
                    return { minIdx, minR: minVal, maxR: maxVal, resPos };
                };
                
                const baseMins = findTrueMin(baseScan.y, baseScan.x);
                let minR = baseMins.minR, maxR = baseMins.maxR, minIdx = baseMins.minIdx;
                const resPos = baseMins.resPos;
                
                // Calculate FWHM
                const halfMax = minR + (maxR - minR) / 2;
                let leftX = null, rightX = null;
                for (let i = minIdx; i >= 0; i--) {
                    if (baseScan.y[i] > halfMax) {
                        const denom = baseScan.y[i+1] - baseScan.y[i];
                        leftX = denom !== 0 ? baseScan.x[i] + (baseScan.x[i+1] - baseScan.x[i]) * ((halfMax - baseScan.y[i]) / denom) : baseScan.x[i];
                        break;
                    }
                }
                for (let i = minIdx; i < baseScan.y.length; i++) {
                    if (baseScan.y[i] > halfMax) {
                        const denom = baseScan.y[i] - baseScan.y[i-1];
                        rightX = denom !== 0 ? baseScan.x[i-1] + (baseScan.x[i] - baseScan.x[i-1]) * ((halfMax - baseScan.y[i-1]) / denom) : baseScan.x[i-1];
                        break;
                    }
                }
                
                let fwhm = 0;
                if (leftX !== null && rightX !== null) fwhm = rightX - leftX;
                else if (leftX !== null) fwhm = 2 * (resPos - leftX);
                else if (rightX !== null) fwhm = 2 * (rightX - resPos);
                
                // Calculate Sensitivity
                let sensitivity = 0;
                if (innerScanConfig.dn !== 0) {
                    const targetIdx = innerScanConfig.layerIdx === 'auto' ? state.layers.length - 1 : parseInt(innerScanConfig.layerIdx, 10);
                    if (state.layers[targetIdx]) {
                        // Create copy and perturb refractive index
                        const sensLayers = JSON.parse(JSON.stringify(state.layers));
                        // We apply a dynamic shift so the layer retains its dispersion curve
                        sensLayers[targetIdx].n_shift = innerScanConfig.dn;
                        
                        const sensScan = runScan(sensLayers, innerScanConfig.mode, innerScanConfig.min, innerScanConfig.max, innerScanConfig.steps, innerFixedVal);
                        
                        const sensMins = findTrueMin(sensScan.y, sensScan.x);
                        sensitivity = Math.abs(sensMins.resPos - resPos) / innerScanConfig.dn;
                    }
                }
                
                // Store standard metrics at resonance point for compatibility
                const result = simulateTMM({ lambda: (innerScanConfig.mode === 'lambda' ? resPos : innerFixedVal), theta: (innerScanConfig.mode === 'theta' ? resPos : innerFixedVal), polarization: polarization || 'TM', layers: activeLayers });
                
                metrics = {
                    R: Number(result.R || 0),
                    T: Number(result.T || 0),
                    A: Number(result.A || 0),
                    phaseR: Number(result.phaseR || result.phase_r || 0),
                    phaseT: Number(result.phaseT || result.phase_t || 0),
                    minR: minR,
                    resPos: resPos,
                    fwhm: fwhm,
                    sensitivity: sensitivity
                };
            }
            
            allResults.push({
                params: { ...currentParams },
                metrics: metrics
            });

            currentRun++;
            if (currentRun % Math.max(1, Math.floor(totalRuns / 20)) === 0) {
                self.postMessage({ type: 'progress', percent: Math.round((currentRun / totalRuns) * 100) });
            }
            return;
        }

        // Recursivitate: Construim Produsul Cartezian N-Dimensional
        const config = sweepConfigs[configIndex];
        for (const val of config.values) {
            currentParams[config.param] = val;
            runCombinations(configIndex + 1, currentParams);
        }
    }

    runCombinations(0, {});

    self.postMessage({ 
        type: 'done', 
        results: allResults,
        sweepConfigs: sweepConfigs 
    });
};
