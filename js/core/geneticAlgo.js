import { simulateTMM } from './tmm2x2Engine.js?v=53';
import { Complex, getEps, getNK, getNKAtWave } from './materials_database.js?v=53';


// --- PRNG pt Reproductibilitate ---
let prngState = null;

function xmur3(str) {
    for(var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = h << 13 | h >>> 19;
    }
    return function() {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }
}

function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

export function setPRNGSeed(seedStr) {
    if (!seedStr) {
        prngState = null;
    } else {
        const seed = xmur3(seedStr)();
        prngState = mulberry32(seed);
    }
}

function randomFunc() {
    return prngState ? prngState() : Math.random();
}

// --- Funcții Auxiliare: Dispersie și Modele Matematice ---

export function calcEMA(hostMat, incMat, ff, algo, w) {
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

export function evaluateLayersDispersion(layersDef, lambda, materialsDB) {
    return layersDef.map(layer => {
        const matDef = materialsDB[layer.material] || { type: 'constant', n: 1.5, k: 0 };
        const effectiveType = matDef.category || layer.type || 'standard';

        // Dacă este poros, calculăm dinamic EMA
        if (effectiveType === 'porous') {
            const hostMat = materialsDB[matDef.host] || { type: 'constant', n: 1.5, k: 0 };
            const incMat = materialsDB[matDef.inclusion] || { type: 'constant', n: 1.0, k: 0 };
            
            const baseFF = matDef.fraction !== undefined ? Number(matDef.fraction) : 0.5;
            const safeFF = layer.ff !== undefined ? Number(layer.ff) : baseFF;
            
            const nk = calcEMA(hostMat, incMat, safeFF, matDef.algo || 'MG', Number(lambda));
            return { d: Number(layer.d), n: nk.n, k: nk.k };
        }
        
        const nk = getNKAtWave(matDef, Number(lambda));
        
        let d = Number(layer.d);
        if (effectiveType === '2d') {
            const d_mono = Number(matDef.d_mono) || Number(layer.d_mono) || 0.34;
            d = Math.max(1, Math.round(Number(layer.count) || 1)) * d_mono;
        }
        
        return { d: d, n: nk.n, k: nk.k };
    });
}

export function evaluateTargetModel(x, targetComponents) {
    let y = 0;
    let hasStep = false;
    let stepY = 0;

    for (let c of targetComponents) {
        if (c.type === 'lorentz') {
            y += c.y0 + c.A * (c.w * c.w) / (Math.pow(x - c.xc, 2) + c.w * c.w);
        } else if (c.type === 'fano') {
            y += c.y0 + c.A * Math.pow(c.q * c.w + (x - c.xc), 2) / (Math.pow(x - c.xc, 2) + c.w * c.w);
        } else if (c.type === 'coupled') {
            const dx = (x - c.w1) - c.k * c.k * (x - c.w2) / (Math.pow(x - c.w2, 2) + c.g2 * c.g2);
            const dy = c.g1 + c.k * c.k * c.g2 / (Math.pow(x - c.w2, 2) + c.g2 * c.g2);
            y += c.y0 + c.A1 / (dx * dx + dy * dy);
        } else if (c.type === 'step') {
            hasStep = true;
            if (x >= c.xmin && x <= c.xmax) stepY += c.yval;
            else stepY += c.ybase;
        }
    }
    
    if (hasStep && targetComponents.length === 1) return stepY;
    if (hasStep) return stepY + y;
    return y;
}

// --- Evaluatorul Principal de Performanță (Fitness) ---
export class Evaluator {
    constructor(config) {
        this.config = config;
        this.metricIds = config.metrics.map(m => m.id);
        
        this.globalObjectives = config.globalObjectives.map(go => {
            try {
                const func = new Function(...this.metricIds, 'return ' + go.formula);
                return { func, goal: go.goal };
            } catch (e) {
                console.error("Eroare la parsarea formulei obiectivului: ", go.formula);
                return { func: () => 999999, goal: 'min' };
            }
        });
        
        this.constraints = (config.constraints || []).map(c => {
            try {
                const func = new Function(...this.metricIds, 'return ' + c.formula);
                
                let penaltyFunc = null;
                const match = c.formula.match(/^\s*([a-zA-Z0-9_]+)\s*(<|<=|>|>=)\s*([0-9.eE+-]+)\s*$/);
                if (match) {
                    const metricName = match[1];
                    const op = match[2];
                    const limit = parseFloat(match[3]);
                    const metricIdx = this.metricIds.indexOf(metricName);
                    
                    if (metricIdx !== -1) {
                        penaltyFunc = (...metrics) => {
                            const val = metrics[metricIdx];
                            let violation = 0;
                            if ((op === '<' || op === '<=') && val > limit) violation = val - limit;
                            if ((op === '>' || op === '>=') && val < limit) violation = limit - val;
                            
                            if (violation > 0) return 1e6 + violation * 1e5;
                            return 0;
                        };
                    }
                }
                
                return { func, penaltyFunc, formula: c.formula };
            } catch (e) {
                return null;
            }
        }).filter(c => c !== null);
    }

    runSimulationSequence(layers, simConfig, sensShift = null) {
        const results = { 
            x: new Float64Array(simConfig.steps), 
            R: new Float64Array(simConfig.steps), 
            T: new Float64Array(simConfig.steps), 
            A: new Float64Array(simConfig.steps),
            phaseR: new Float64Array(simConfig.steps),
            phaseT: new Float64Array(simConfig.steps)
        };
        const stepSize = (simConfig.end - simConfig.start) / (simConfig.steps - 1);

        for (let i = 0; i < simConfig.steps; i++) {
            const currentVal = simConfig.start + i * stepSize;
            results.x[i] = currentVal;
            const lambda = simConfig.mode === 'lambda' ? currentVal : simConfig.fixed;
            const theta = simConfig.mode === 'theta' ? currentVal : simConfig.fixed;

            const evaluatedLayers = evaluateLayersDispersion(layers, lambda, this.config.materialsDB);
            
            if (sensShift && evaluatedLayers[sensShift.layerIdx]) {
                evaluatedLayers[sensShift.layerIdx].n += sensShift.deltaN;
            }

            const simRes = simulateTMM({ lambda, theta, polarization: simConfig.pol, layers: evaluatedLayers });

            results.R[i] = simRes.R;
            results.T[i] = simRes.T;
            results.A[i] = simRes.A;
            results.phaseR[i] = simRes.phaseR !== undefined ? simRes.phaseR : 0;
            results.phaseT[i] = simRes.phaseT !== undefined ? simRes.phaseT : 0;
        }
        return results;
    }

    computeSingleMetric(metric, response, layers) {
        const { type, xMin, xMax, deltaN } = metric;
        let xArr = response.x;
        
        let startIndex = 0;
        let endIndex = xArr.length - 1;

        if (typeof xMin !== 'undefined' && typeof xMax !== 'undefined') {
            const numXMin = Number(xMin);
            const numXMax = Number(xMax);
            for (let i = 0; i < xArr.length; i++) {
                if (xArr[i] >= numXMin) { startIndex = i; break; }
            }
            for (let i = xArr.length - 1; i >= 0; i--) {
                if (xArr[i] <= numXMax) { endIndex = i; break; }
            }
        }
        
        xArr = xArr.subarray(startIndex, endIndex + 1);
        const subRes = {
            x: xArr,
            R: response.R.subarray(startIndex, endIndex + 1),
            T: response.T.subarray(startIndex, endIndex + 1),
            A: response.A.subarray(startIndex, endIndex + 1),
            phaseR: response.phaseR.subarray(startIndex, endIndex + 1),
            phaseT: response.phaseT.subarray(startIndex, endIndex + 1)
        };

        if (xArr.length === 0) return 999;
        
        if (type === 'curvefit') {
            let error = 0;
            const targetParam = metric.curvefitParam || 'R';
            const targetArr = subRes[targetParam] || subRes.R; 
            const targetComponents = (this.config.targetComponentsMap && this.config.targetComponentsMap[metric.id]) ? this.config.targetComponentsMap[metric.id] : [];

            for (let i = 0; i < xArr.length; i++) {
                const currentX = xArr[i];
                const targetY = evaluateTargetModel(currentX, targetComponents);
                error += Math.pow(targetArr[i] - targetY, 2);
            }
            return error / xArr.length;
        }
        
        if (type === 'FWHM') {
            const yArr = subRes.R;
            const minVal = Math.min(...yArr);
            const minIdx = yArr.indexOf(minVal);
            const baseline = Math.max(...yArr);
            const halfMax = minVal + (baseline - minVal) / 2;
            
            let leftX = xArr[0], rightX = xArr[xArr.length-1];
            for (let i = minIdx; i >= 0; i--) if (yArr[i] > halfMax) { leftX = xArr[i]; break; }
            for (let i = minIdx; i < yArr.length; i++) if (yArr[i] > halfMax) { rightX = xArr[i]; break; }
            return rightX - leftX;
        }

        if (type === 'BandCenter') {
            const yArr = subRes.R;
            const maxVal = Math.max(...yArr);
            const maxIdx = yArr.indexOf(maxVal);
            return xArr[maxIdx];
        }

        if (type === 'BandgapWidth') {
            const yArr = subRes.R;
            const maxVal = Math.max(...yArr);
            const maxIdx = yArr.indexOf(maxVal);
            const baseline = Math.min(...yArr);
            const halfMax = baseline + (maxVal - baseline) / 2;
            
            let leftX = xArr[0], rightX = xArr[xArr.length-1];
            for (let i = maxIdx; i >= 0; i--) if (yArr[i] < halfMax) { leftX = xArr[i]; break; }
            for (let i = maxIdx; i < yArr.length; i++) if (yArr[i] < halfMax) { rightX = xArr[i]; break; }
            return rightX - leftX;
        }

        const findTrueMin = (xA, yA) => {
            let minIdx = 0, minVal = Infinity;
            for (let i = 0; i < yA.length; i++) {
                if (Number.isFinite(yA[i]) && yA[i] < minVal) { minVal = yA[i]; minIdx = i; }
            }
            if (minIdx === 0 || minIdx === yA.length - 1) return xA[minIdx];
            const x0 = xA[minIdx], dx = xA[minIdx] - xA[minIdx - 1];
            const y_1 = yA[minIdx - 1], y0 = yA[minIdx], y1 = yA[minIdx + 1];
            const denom = y1 - 2 * y0 + y_1;
            return denom === 0 ? x0 : x0 - (dx / 2) * ((y1 - y_1) / denom);
        };

        if (type === 'Sensitivity') {
            const x1 = findTrueMin(subRes.x, subRes.R);
            const targetLayerIdx = typeof metric.layerIdx !== 'undefined' ? metric.layerIdx : layers.length - 1; 
            const sensResponse = this.runSimulationSequence(layers, this.config.sim, { layerIdx: targetLayerIdx, deltaN: deltaN });
            
            // Find the shifted peak. It might shift outside the original interval,
            // so we search within a window around x1 to track the correct peak.
            let x2 = x1;
            let sSubX = sensResponse.x;
            let sSubR = sensResponse.R;
            
            let sIdx = sSubX.findIndex(v => v >= x1 - 2);
            let eIdx = sSubX.findIndex(v => v >= x1 + 10);
            if (sIdx === -1) sIdx = 0;
            if (eIdx === -1) eIdx = sSubX.length - 1;
            
            x2 = findTrueMin(sSubX.subarray(sIdx, eIdx + 1), sSubR.subarray(sIdx, eIdx + 1));
            
            return Math.abs((x2 - x1) / deltaN);
        }

        if (type === 'FOM') {
            const yArr = subRes.R;
            const minVal = Math.min(...yArr);
            const minIdx = yArr.indexOf(minVal);
            const baseline = Math.max(...yArr);
            const halfMax = minVal + (baseline - minVal) / 2;
            
            let leftX = xArr[0], rightX = xArr[xArr.length-1];
            for (let i = minIdx; i >= 0; i--) if (yArr[i] > halfMax) { leftX = xArr[i]; break; }
            for (let i = minIdx; i < yArr.length; i++) if (yArr[i] > halfMax) { rightX = xArr[i]; break; }
            const fwhm = rightX - leftX;

            const x1 = xArr[minIdx];
            const sensLayers = JSON.parse(JSON.stringify(layers));
            const targetLayerIdx = typeof metric.layerIdx !== 'undefined' ? metric.layerIdx : sensLayers.length - 1; 
            const baseNk = evaluateLayersDispersion([layers[targetLayerIdx]], this.config.sim.fixed, this.config.materialsDB)[0];
            
            sensLayers[targetLayerIdx].type = 'standard';
            sensLayers[targetLayerIdx].material = '_TEMP_SENS_';
            this.config.materialsDB['_TEMP_SENS_'] = { type: 'constant', n: baseNk.n + deltaN, k: baseNk.k };

            const sensResponse = this.runSimulationSequence(sensLayers, this.config.sim);
            let sSubX = sensResponse.x;
            let sSubR = sensResponse.R;
            let sIdx = sSubX.findIndex(v => v >= x1 - 2);
            let eIdx = sSubX.findIndex(v => v >= x1 + 10);
            if (sIdx === -1) sIdx = 0;
            if (eIdx === -1) eIdx = sSubX.length - 1;
            
            let subXR = sSubR.subarray(sIdx, eIdx + 1);
            let minIdx2 = subXR.indexOf(Math.min(...subXR));
            const x2 = sSubX.subarray(sIdx, eIdx + 1)[minIdx2];
            
            const sensitivity = Math.abs((x2 - x1) / deltaN);
            return fwhm > 0 ? sensitivity / fwhm : 0;
        }

        if (type === 'ResonancePosition') {
            const minIdx = subRes.R.indexOf(Math.min(...subRes.R));
            return xArr[minIdx];
        }

        if (type.startsWith('MaxPhaseDerivative')) {
            const param = type.replace('MaxPhaseDerivative', '');
            const phaseArr = subRes['phase' + param];
            if (!phaseArr) return 0;
            
            let maxDerivative = 0;
            for (let i = 1; i < xArr.length - 1; i++) {
                const dx = xArr[i+1] - xArr[i-1];
                if (dx === 0) continue;
                let dPhase = phaseArr[i+1] - phaseArr[i-1];
                if (dPhase > 180) dPhase -= 360;
                else if (dPhase < -180) dPhase += 360;
                
                const derivative = Math.abs(dPhase / dx);
                if (derivative > maxDerivative) maxDerivative = derivative;
            }
            return maxDerivative;
        }

        if (type.startsWith('Average')) {
            const param = type.replace('Average', '');
            const yArr = subRes[param];
            let sum = 0;
            for (let i = 0; i < yArr.length; i++) sum += yArr[i];
            return sum / yArr.length;
        }

        const yArr = subRes[type];
        if (!yArr) return 999;
        return Math.min(...yArr);
    }

    evaluateGenome(genome) {
        let layers = JSON.parse(JSON.stringify(this.config.baseLayers));
        let dbrParams = this.config.dbrParams ? JSON.parse(JSON.stringify(this.config.dbrParams)) : null;
        let rebuildDBR = this.config.isDBROpt || false;
        
        this.config.variables.forEach((v, idx) => {
            const val = genome[idx];
            if (v.param.startsWith('dbr_')) {
                rebuildDBR = true;
                if (!dbrParams) return;
                
                if (v.param === 'dbr_periods') dbrParams.periods = Math.max(1, Math.round(val));
                else if (v.param.startsWith('dbr_mat_')) {
                    const parts = v.param.split('_');
                    const mIdx = parseInt(parts[2]);
                    if (parts[3] === 'd' && dbrParams.materials[mIdx]) dbrParams.materials[mIdx].d = val;
                } else if (v.param === 'dbr_def_pos') dbrParams.defect.afterPeriod = Math.max(1, Math.round(val));
                else if (v.param === 'dbr_def_d') dbrParams.defect.d = val;
            } else if (v.param.startsWith('d_mat_')) {
                const matName = v.param.replace('d_mat_', '');
                layers.forEach(l => { if (l.material === matName && l.type !== '2d') l.d = val; });
                if (dbrParams) {
                    dbrParams.materials.forEach(m => { if (m.material === matName) m.d = val; });
                    if (dbrParams.hasDefect && dbrParams.defect.material === matName) dbrParams.defect.d = val;
                }
            } else {
                if (layers[v.layerIndex]) {
                    if (v.param === 'count') layers[v.layerIndex][v.param] = Math.max(1, Math.round(val));
                    else if (v.param === 'material' && v.allowedMaterials) {
                        const matIdx = Math.max(0, Math.min(v.allowedMaterials.length - 1, Math.round(val)));
                        const newMat = v.allowedMaterials[matIdx];
                        layers[v.layerIndex].material = newMat;
                        if (this.config.materialsDB && this.config.materialsDB[newMat]) {
                            layers[v.layerIndex].type = this.config.materialsDB[newMat].category || 'standard';
                        }
                    }
                    else layers[v.layerIndex][v.param] = val;
                }
            }
        });
        
        if (rebuildDBR && dbrParams) {
            const newLayers = [];
            for (let p = 1; p <= dbrParams.periods; p++) {
                dbrParams.materials.forEach(m => newLayers.push({ material: m.material, d: m.d, type: 'standard' }));
                if (dbrParams.hasDefect && p === dbrParams.defect.afterPeriod) {
                    newLayers.push({ material: dbrParams.defect.material, d: dbrParams.defect.d, type: 'standard' });
                }
            }
            layers.splice(layers.length - 1, 0, ...newLayers);
        }

        const response = this.runSimulationSequence(layers, this.config.sim);
        const metricValues = this.config.metrics.map(m => this.computeSingleMetric(m, response, layers));
        
        let penalty = 0;
        for (let c of this.constraints) {
            try {
                if (c.penaltyFunc) {
                    penalty += c.penaltyFunc(...metricValues);
                } else {
                    if (!c.func(...metricValues)) penalty += 1e6;
                }
            } catch(e) { penalty += 1e6; }
        }

        const objectives = this.globalObjectives.map(go => {
            try {
                let val = go.func(...metricValues);
                let objToMin = (go.goal === 'max') ? -val : val;
                if (isNaN(objToMin) || !isFinite(objToMin)) objToMin = 1e6;
                return objToMin + penalty;
            } catch (e) { return 1e6 + penalty; }
        });

        return { genome, objectives, metricValues, response, fitness: objectives[0] };
    }
}

// --- Algoritmi Genetici (SGA și NSGA-II) ---
export class GeneticOptimizer {
    constructor(config, onProgressCallback, onDoneCallback) {
        if(config.seed) setPRNGSeed(config.seed);
        else setPRNGSeed(null);
        this.config = config;
        this.onProgress = onProgressCallback;
        this.onDone = onDoneCallback;

        this.evaluator = new Evaluator(config);
        this.popSize = config.popSize || 50;
        this.generations = config.generations || 100;
        
        this.crossoverRate = config.crossoverRate !== undefined ? config.crossoverRate : 0.9;
        this.crossoverEta = config.crossoverEta !== undefined ? config.crossoverEta : 20;
        this.mutationRate = config.mutationRate !== undefined ? config.mutationRate : 0.1;
        this.mutationEta = config.mutationEta !== undefined ? config.mutationEta : 20;
        
        this.selectionType = config.selectionType || 'tournament';
        this.bounds = config.variables.map(v => ({ min: v.min, max: v.max }));
    }

    createRandomGenome() {
        return this.bounds.map(b => b.min + randomFunc() * (b.max - b.min));
    }

    crossover(p1, p2) {
        const child1 = [], child2 = [];
        if (randomFunc() <= this.crossoverRate) {
            for (let i = 0; i < p1.length; i++) {
                const varDef = this.config.variables[i];
                const isDiscrete = varDef.allowedMaterials || varDef.param === 'count' || varDef.param.includes('periods') || varDef.param.includes('pos');

                if (isDiscrete) {
                    if (randomFunc() <= 0.5) { child1.push(p1[i]); child2.push(p2[i]); }
                    else { child1.push(p2[i]); child2.push(p1[i]); }
                    continue;
                }

                if (randomFunc() <= 0.5) { 
                    const y1 = Math.min(p1[i], p2[i]);
                    const y2 = Math.max(p1[i], p2[i]);
                    const yl = this.bounds[i].min;
                    const yu = this.bounds[i].max;
                    
                    if (Math.abs(y1 - y2) > 1e-14) {
                        const r = randomFunc();
                        let betaq = r <= 0.5 ? Math.pow(2.0 * r, 1.0 / (this.crossoverEta + 1.0)) : Math.pow(1.0 / (2.0 * (1.0 - r)), 1.0 / (this.crossoverEta + 1.0));
                        
                        let c1 = 0.5 * ((y1 + y2) - betaq * (y2 - y1));
                        let c2 = 0.5 * ((y1 + y2) + betaq * (y2 - y1));
                        
                        c1 = Math.max(yl, Math.min(yu, c1));
                        c2 = Math.max(yl, Math.min(yu, c2));
                        
                        if (randomFunc() <= 0.5) { child1.push(c1); child2.push(c2); } 
                        else { child1.push(c2); child2.push(c1); }
                    } else { child1.push(p1[i]); child2.push(p2[i]); }
                } else { child1.push(p1[i]); child2.push(p2[i]); }
            }
        } else {
            for(let i=0; i<p1.length; i++){ child1.push(p1[i]); child2.push(p2[i]); }
        }
        return [child1, child2];
    }

    mutate(genome) {
        return genome.map((val, i) => {
            if (randomFunc() <= this.mutationRate) {
                const y = val;
                const yl = this.bounds[i].min;
                const yu = this.bounds[i].max;
                
                if (yl === yu) return y;
                
                const varDef = this.config.variables[i];
                const isDiscrete = varDef.allowedMaterials || varDef.param === 'count' || varDef.param.includes('periods') || varDef.param.includes('pos');
                
                if (isDiscrete) {
                    return yl + Math.floor(randomFunc() * (yu - yl + 1));
                }

                const r = randomFunc();
                let deltaq = r <= 0.5 ? Math.pow(2.0 * r, 1.0 / (this.mutationEta + 1.0)) - 1.0 : 1.0 - Math.pow(2.0 * (1.0 - r), 1.0 / (this.mutationEta + 1.0));
                
                let y_mutated = y + deltaq * (yu - yl);
                return Math.max(yl, Math.min(yu, y_mutated));
            }
            return val;
        });
    }

    tournamentSelect(pop) {
        const ind1 = pop[Math.floor(randomFunc() * pop.length)];
        const ind2 = pop[Math.floor(randomFunc() * pop.length)];
        
        if (this.config.algoType === 'nsga2') {
            if (ind1.rank < ind2.rank) return ind1;
            if (ind1.rank > ind2.rank) return ind2;
            return ind1.distance > ind2.distance ? ind1 : ind2;
        } else {
            return ind1.fitness < ind2.fitness ? ind1 : ind2;
        }
    }

    rouletteSelect(pop) {
        let maxFit = -Infinity;
        let minFit = Infinity;
        pop.forEach(p => {
            if(p.fitness > maxFit) maxFit = p.fitness;
            if(p.fitness < minFit) minFit = p.fitness;
        });
        
        const margin = (maxFit - minFit) * 0.1 || 1e-6; 
        let totalWeight = 0;
        const weights = pop.map(p => { const w = maxFit - p.fitness + margin; totalWeight += w; return w; });
        
        let r = randomFunc() * totalWeight;
        let sum = 0;
        for (let i = 0; i < pop.length; i++) {
            sum += weights[i];
            if (r <= sum) return pop[i];
        }
        return pop[pop.length - 1]; 
    }

    selectParent(pop) {
        if (this.config.algoType === 'nsga2') return this.tournamentSelect(pop); 
        return this.selectionType === 'roulette' ? this.rouletteSelect(pop) : this.tournamentSelect(pop);
    }

    dominates(p, q) {
        let strictlyBetter = false;
        for (let i = 0; i < p.objectives.length; i++) {
            if (p.objectives[i] > q.objectives[i]) return false;
            if (p.objectives[i] < q.objectives[i]) strictlyBetter = true;
        }
        return strictlyBetter;
    }

    fastNonDominatedSort(pop) {
        const fronts = [[]];
        pop.forEach(p => {
            p.S = [];
            p.n = 0;
            pop.forEach(q => {
                if (this.dominates(p, q)) p.S.push(q);
                else if (this.dominates(q, p)) p.n++;
            });
            if (p.n === 0) {
                p.rank = 0;
                fronts[0].push(p);
            }
        });

        let i = 0;
        while (fronts[i] && fronts[i].length > 0) {
            const nextFront = [];
            fronts[i].forEach(p => {
                p.S.forEach(q => {
                    q.n--;
                    if (q.n === 0) {
                        q.rank = i + 1;
                        nextFront.push(q);
                    }
                });
            });
            i++;
            if (nextFront.length > 0) fronts.push(nextFront);
        }
        return fronts;
    }

    assignCrowdingDistance(front) {
        const l = front.length;
        if (l === 0) return;
        front.forEach(p => p.distance = 0);
        if (l <= 2) {
            front.forEach(p => p.distance = Infinity);
            return;
        }
        const numObjs = front[0].objectives.length;
        for (let m = 0; m < numObjs; m++) {
            front.sort((a, b) => a.objectives[m] - b.objectives[m]);
            front[0].distance = Infinity;
            front[l - 1].distance = Infinity;
            const minObj = front[0].objectives[m];
            const maxObj = front[l - 1].objectives[m];
            if (maxObj === minObj) continue;
            for (let i = 1; i < l - 1; i++) {
                front[i].distance += (front[i + 1].objectives[m] - front[i - 1].objectives[m]) / (maxObj - minObj);
            }
        }
    }


    extractParetoFront(front0) {
        const paretoFrontData = [];
        if (!front0 || front0.length === 0) return paretoFrontData;

        // Calculate ranges for normalization
        const numObjs = front0[0].objectives.length;
        const ranges = new Array(numObjs).fill(0);
        for (let m = 0; m < numObjs; m++) {
            let minObj = Infinity, maxObj = -Infinity;
            for (let sol of front0) {
                if (sol.objectives[m] < minObj) minObj = sol.objectives[m];
                if (sol.objectives[m] > maxObj) maxObj = sol.objectives[m];
            }
            ranges[m] = Math.max(1e-9, maxObj - minObj);
        }

        const epsilon = this.config.paretoEpsilon !== undefined ? this.config.paretoEpsilon : 0.015;

        for (let sol of front0) {
            let isSimilar = false;
            let currentObjs = sol.objectives.map((val, i) => this.config.globalObjectives[i].goal === 'max' ? -val : val);
            
            for (let accepted of paretoFrontData) {
                let distSq = 0;
                for (let m = 0; m < numObjs; m++) {
                    const diff = (currentObjs[m] - accepted.objectives[m]) / ranges[m];
                    distSq += diff * diff;
                }
                if (Math.sqrt(distSq) < epsilon) {
                    isSimilar = true;
                    break;
                }
            }
            
            if (!isSimilar) {
                paretoFrontData.push({
                    genome: sol.genome,
                    objectives: currentObjs,
                    fitness: sol.fitness,
                    response: sol.response
                });
            }
        }
        return paretoFrontData;
    }

    run() {
        let population = Array.from({ length: this.popSize }, () => this.evaluator.evaluateGenome(this.createRandomGenome()));
        
        // --- Variabile pentru Early Stopping (Stagnare) ---
        let stagnationCount = 0;
        let bestPastFitness = Infinity;

        if (this.config.algoType === 'nsga2') {
            const fronts = this.fastNonDominatedSort(population);
            population = [];
            fronts.forEach(f => { this.assignCrowdingDistance(f); population.push(...f); });
            
            const paretoFrontData = this.extractParetoFront(fronts[0]);

            this.onProgress({
                type: 'progress', generation: 0, paretoFront: paretoFrontData,
                bestFitness: population[0].fitness, bestResponse: population[0].response, bestGenome: population[0].genome,
                population: population.map(p => ({genome: p.genome, fitness: p.fitness}))
            });
        } else {
            population.sort((a, b) => a.fitness - b.fitness);
            this.onProgress({
                type: 'progress', generation: 0,
                bestFitness: population[0].fitness, bestResponse: population[0].response, bestGenome: population[0].genome,
                population: population.map(p => ({genome: p.genome, fitness: p.fitness}))
            });
        }

        for (let gen = 1; gen <= this.generations; gen++) {
            const offspring = [];
            while (offspring.length < this.popSize) {
                const p1 = this.selectParent(population);
                const p2 = this.selectParent(population);
                const [c1, c2] = this.crossover(p1.genome, p2.genome);
                
                offspring.push(this.evaluator.evaluateGenome(this.mutate(c1)));
                if (offspring.length < this.popSize) {
                    offspring.push(this.evaluator.evaluateGenome(this.mutate(c2)));
                }
            }

            let combinedPop = [...population, ...offspring];

            if (this.config.algoType === 'nsga2') {
                const fronts = this.fastNonDominatedSort(combinedPop);
                population = [];
                let fIdx = 0;
                
                while (fIdx < fronts.length && population.length + fronts[fIdx].length <= this.popSize) {
                    this.assignCrowdingDistance(fronts[fIdx]);
                    population.push(...fronts[fIdx]);
                    fIdx++;
                }
                
                if (population.length < this.popSize && fIdx < fronts.length) {
                    this.assignCrowdingDistance(fronts[fIdx]);
                    fronts[fIdx].sort((a, b) => b.distance - a.distance); 
                    const needed = this.popSize - population.length;
                    population.push(...fronts[fIdx].slice(0, needed));
                }

                const paretoFrontData = this.extractParetoFront(fronts[0]);

                this.onProgress({
                    type: 'progress', generation: gen, paretoFront: paretoFrontData,
                    bestFitness: population[0].fitness, bestResponse: population[0].response, bestGenome: population[0].genome,
                    population: population.map(p => ({genome: p.genome, fitness: p.fitness}))
                });

            } else {
                combinedPop.sort((a, b) => a.fitness - b.fitness);
                population = combinedPop.slice(0, this.popSize);

                this.onProgress({
                    type: 'progress', generation: gen,
                    bestFitness: population[0].fitness, bestResponse: population[0].response, bestGenome: population[0].genome,
                    population: population.map(p => ({genome: p.genome, fitness: p.fitness}))
                });
            }

            // --- Verificare Early Stopping (Convergență) ---
            if (this.config.algoType !== 'nsga2') {
                let currentBestFitness = population[0].fitness;
                if (Math.abs(bestPastFitness - currentBestFitness) < 1e-8) {
                    stagnationCount++;
                } else {
                    stagnationCount = 0;
                    bestPastFitness = currentBestFitness;
                }

                if (stagnationCount >= 30) {
                    this.onDone({ type: 'done', reason: 'convergence', generation: gen });
                    return; // Oprim algoritmul prematur
                }
            }
        }

        this.onDone({ type: 'done', reason: 'max_gen' });
    }
}

export class ParticleSwarmOptimizer {
    constructor(config, onProgressCallback, onDoneCallback) {
        if(config.seed) setPRNGSeed(config.seed);
        else setPRNGSeed(null);
        this.config = config;
        this.onProgress = onProgressCallback;
        this.onDone = onDoneCallback;
        
        this.evaluator = new Evaluator(config);
        
        this.numParticles = config.popSize || 50;
        this.maxIterations = config.generations || 100;
        
        this.w = config.psoW !== undefined ? config.psoW : 0.729;
        this.c1 = config.psoC1 !== undefined ? config.psoC1 : 1.49445;
        this.c2 = config.psoC2 !== undefined ? config.psoC2 : 1.49445;
        
        this.bounds = config.variables.map(v => ({ min: v.min, max: v.max }));
        this.globalBestPosition = null;
        this.globalBestFitness = Infinity;
        this.globalBestResponse = null;
        
        this.particles = [];
    }
    

    extractParetoFront(front0) {
        const paretoFrontData = [];
        if (!front0 || front0.length === 0) return paretoFrontData;

        // Calculate ranges for normalization
        const numObjs = front0[0].objectives.length;
        const ranges = new Array(numObjs).fill(0);
        for (let m = 0; m < numObjs; m++) {
            let minObj = Infinity, maxObj = -Infinity;
            for (let sol of front0) {
                if (sol.objectives[m] < minObj) minObj = sol.objectives[m];
                if (sol.objectives[m] > maxObj) maxObj = sol.objectives[m];
            }
            ranges[m] = Math.max(1e-9, maxObj - minObj);
        }

        const epsilon = this.config.paretoEpsilon !== undefined ? this.config.paretoEpsilon : 0.015;

        for (let sol of front0) {
            let isSimilar = false;
            let currentObjs = sol.objectives.map((val, i) => this.config.globalObjectives[i].goal === 'max' ? -val : val);
            
            for (let accepted of paretoFrontData) {
                let distSq = 0;
                for (let m = 0; m < numObjs; m++) {
                    const diff = (currentObjs[m] - accepted.objectives[m]) / ranges[m];
                    distSq += diff * diff;
                }
                if (Math.sqrt(distSq) < epsilon) {
                    isSimilar = true;
                    break;
                }
            }
            
            if (!isSimilar) {
                paretoFrontData.push({
                    genome: sol.genome,
                    objectives: currentObjs,
                    fitness: sol.fitness,
                    response: sol.response
                });
            }
        }
        return paretoFrontData;
    }

    run() {
        for (let i = 0; i < this.numParticles; i++) {
            const position = this.bounds.map(b => b.min + randomFunc() * (b.max - b.min));
            const velocity = this.bounds.map(b => (randomFunc() - 0.5) * (b.max - b.min) * 0.1);
            
            const evaluation = this.evaluator.evaluateGenome(position);
            
            this.particles.push({
                position: position,
                velocity: velocity,
                bestPosition: [...position],
                bestFitness: evaluation.fitness,
                fitness: evaluation.fitness,
                response: evaluation.response
            });
            
            if (evaluation.fitness < this.globalBestFitness) {
                this.globalBestFitness = evaluation.fitness;
                this.globalBestPosition = [...position];
                this.globalBestResponse = evaluation.response;
            }
        }
        
        this.onProgress({
            type: 'progress', generation: 0,
            bestFitness: this.globalBestFitness, bestResponse: this.globalBestResponse, bestGenome: this.globalBestPosition,
            population: this.particles.map(p => ({genome: [...p.position], fitness: p.fitness}))
        });
        
        for (let iter = 1; iter <= this.maxIterations; iter++) {
            // Dynamic inertia weight (linear decay from 0.9 to 0.4)
            const currentW = 0.9 - ((0.9 - 0.4) * (iter / this.maxIterations));
            
            for (let i = 0; i < this.numParticles; i++) {
                const p = this.particles[i];
                
                for (let d = 0; d < this.bounds.length; d++) {
                    const r1 = randomFunc();
                    const r2 = randomFunc();
                    
                    p.velocity[d] = currentW * p.velocity[d] + 
                                    this.c1 * r1 * (p.bestPosition[d] - p.position[d]) + 
                                    this.c2 * r2 * (this.globalBestPosition[d] - p.position[d]);
                                    
                    p.position[d] += p.velocity[d];
                    
                    if (p.position[d] < this.bounds[d].min) {
                        p.position[d] = this.bounds[d].min;
                        p.velocity[d] *= -0.5;
                    } else if (p.position[d] > this.bounds[d].max) {
                        p.position[d] = this.bounds[d].max;
                        p.velocity[d] *= -0.5;
                    }
                }
                
                const evaluation = this.evaluator.evaluateGenome(p.position);
                p.fitness = evaluation.fitness;
                p.response = evaluation.response;
                
                if (p.fitness < p.bestFitness) {
                    p.bestFitness = p.fitness;
                    p.bestPosition = [...p.position];
                }
                
                if (p.fitness < this.globalBestFitness) {
                    this.globalBestFitness = p.fitness;
                    this.globalBestPosition = [...p.position];
                    this.globalBestResponse = p.response;
                }
            }
            
            this.onProgress({
                type: 'progress', generation: iter,
                bestFitness: this.globalBestFitness, bestResponse: this.globalBestResponse, bestGenome: this.globalBestPosition,
                population: this.particles.map(p => ({genome: [...p.position], fitness: p.fitness}))
            });
        }
        
        this.onDone({ type: 'done', reason: 'max_gen' });
    }
}

export class GradientDescentOptimizer {
    constructor(config, onProgressCallback, onDoneCallback) {
        if(config.seed) setPRNGSeed(config.seed);
        else setPRNGSeed(null);
        this.config = config;
        this.onProgress = onProgressCallback;
        this.onDone = onDoneCallback;
        
        this.evaluator = new Evaluator(config);
        this.maxEpochs = config.generations || 100;
        
        // Adam specific params
        this.lr = config.gdLr !== undefined ? config.gdLr : 0.01;
        this.beta1 = config.gdMomentum !== undefined ? config.gdMomentum : 0.9;
        this.beta2 = 0.999;
        this.epsilon = 1e-8;
        
        this.bounds = config.variables.map(v => ({ min: v.min, max: v.max }));
        this.bestFitness = Infinity;
        this.bestPosition = null;
        this.bestResponse = null;
    }
    

    extractParetoFront(front0) {
        const paretoFrontData = [];
        if (!front0 || front0.length === 0) return paretoFrontData;

        // Calculate ranges for normalization
        const numObjs = front0[0].objectives.length;
        const ranges = new Array(numObjs).fill(0);
        for (let m = 0; m < numObjs; m++) {
            let minObj = Infinity, maxObj = -Infinity;
            for (let sol of front0) {
                if (sol.objectives[m] < minObj) minObj = sol.objectives[m];
                if (sol.objectives[m] > maxObj) maxObj = sol.objectives[m];
            }
            ranges[m] = Math.max(1e-9, maxObj - minObj);
        }

        const epsilon = this.config.paretoEpsilon !== undefined ? this.config.paretoEpsilon : 0.015;

        for (let sol of front0) {
            let isSimilar = false;
            let currentObjs = sol.objectives.map((val, i) => this.config.globalObjectives[i].goal === 'max' ? -val : val);
            
            for (let accepted of paretoFrontData) {
                let distSq = 0;
                for (let m = 0; m < numObjs; m++) {
                    const diff = (currentObjs[m] - accepted.objectives[m]) / ranges[m];
                    distSq += diff * diff;
                }
                if (Math.sqrt(distSq) < epsilon) {
                    isSimilar = true;
                    break;
                }
            }
            
            if (!isSimilar) {
                paretoFrontData.push({
                    genome: sol.genome,
                    objectives: currentObjs,
                    fitness: sol.fitness,
                    response: sol.response
                });
            }
        }
        return paretoFrontData;
    }

    run() {
        let position = this.bounds.map(b => b.min + randomFunc() * (b.max - b.min));
        let m = this.bounds.map(() => 0); 
        let v = this.bounds.map(() => 0); 
        
        let evaluation = this.evaluator.evaluateGenome(position);
        this.bestFitness = evaluation.fitness;
        this.bestPosition = [...position];
        this.bestResponse = evaluation.response;
        
        this.onProgress({
            type: 'progress', generation: 0,
            bestFitness: this.bestFitness, bestResponse: this.bestResponse, bestGenome: this.bestPosition,
            population: [{genome: [...position], fitness: evaluation.fitness}]
        });
        
        const h = 1e-5; // Step for numerical derivative
        let stagnationCount = 0;
        let lastFitness = this.bestFitness;

        for (let epoch = 1; epoch <= this.maxEpochs; epoch++) {
            let currentFitness = evaluation.fitness;
            let gradient = new Array(this.bounds.length).fill(0);
            
            // Compute numerical gradient (Central Difference for better stability)
            for (let i = 0; i < this.bounds.length; i++) {
                const varDef = this.config.variables[i];
                const isDiscrete = varDef.allowedMaterials || varDef.param === 'count' || varDef.param.includes('periods') || varDef.param.includes('pos');
                
                if (isDiscrete) {
                    gradient[i] = 0;
                    continue;
                }
                
                let originalVal = position[i];
                let range = this.bounds[i].max - this.bounds[i].min;
                let step = h * (range || 1); // Scale h by parameter range
                
                // Forward
                let fPos = [...position];
                fPos[i] = Math.min(this.bounds[i].max, originalVal + step);
                let fEval = this.evaluator.evaluateGenome(fPos);
                
                // Backward
                let bPos = [...position];
                bPos[i] = Math.max(this.bounds[i].min, originalVal - step);
                let bEval = this.evaluator.evaluateGenome(bPos);
                
                let actualStep = fPos[i] - bPos[i];
                if (actualStep > 1e-12) {
                    gradient[i] = (fEval.fitness - bEval.fitness) / actualStep;
                } else {
                    gradient[i] = 0;
                }
            }
            
            // Adam Update Rule
            for (let i = 0; i < this.bounds.length; i++) {
                const varDef = this.config.variables[i];
                const isDiscrete = varDef.allowedMaterials || varDef.param === 'count' || varDef.param.includes('periods') || varDef.param.includes('pos');
                if (isDiscrete) continue; 
                
                m[i] = this.beta1 * m[i] + (1 - this.beta1) * gradient[i];
                v[i] = this.beta2 * v[i] + (1 - this.beta2) * (gradient[i] * gradient[i]);
                
                let mHat = m[i] / (1 - Math.pow(this.beta1, epoch));
                let vHat = v[i] / (1 - Math.pow(this.beta2, epoch));
                
                const range = this.bounds[i].max - this.bounds[i].min;
                const effectiveLr = this.lr * (range || 1);
                
                position[i] -= effectiveLr * mHat / (Math.sqrt(vHat) + this.epsilon);
                
                // Clip to bounds
                if (position[i] < this.bounds[i].min) {
                    position[i] = this.bounds[i].min;
                    m[i] = 0; v[i] = 0; // reset momentum on wall hit
                } else if (position[i] > this.bounds[i].max) {
                    position[i] = this.bounds[i].max;
                    m[i] = 0; v[i] = 0;
                }
            }
            
            evaluation = this.evaluator.evaluateGenome(position);
            
            if (evaluation.fitness < this.bestFitness) {
                this.bestFitness = evaluation.fitness;
                this.bestPosition = [...position];
                this.bestResponse = evaluation.response;
            }
            
            this.onProgress({
                type: 'progress', generation: epoch,
                bestFitness: this.bestFitness, bestResponse: this.bestResponse, bestGenome: this.bestPosition,
                population: [{genome: [...position], fitness: evaluation.fitness}]
            });
            
            if (Math.abs(lastFitness - evaluation.fitness) < 1e-8) {
                stagnationCount++;
            } else {
                stagnationCount = 0;
            }
            lastFitness = evaluation.fitness;
            
            // Random Restart if stagnated
            if (stagnationCount >= 20 && epoch < this.maxEpochs - 10) {
                position = this.bounds.map(b => b.min + randomFunc() * (b.max - b.min));
                m = this.bounds.map(() => 0); 
                v = this.bounds.map(() => 0); 
                evaluation = this.evaluator.evaluateGenome(position);
                lastFitness = evaluation.fitness;
                stagnationCount = 0;
            }
        }
        
        this.onDone({ type: 'done', reason: 'max_gen' });
    }
}
