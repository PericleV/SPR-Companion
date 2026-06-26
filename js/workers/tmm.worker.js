import { simulateTMM } from '../core/tmm2x2Engine.js?v=50';
import { Complex, getEps, getNK, getNKAtWave } from '../core/materials_database.js?v=50';

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
        
        if (epsEff1.i >= -1e-6 && epsEff2.i < -1e-6) epsEff = epsEff1;
        else if (epsEff2.i >= -1e-6 && epsEff1.i < -1e-6) epsEff = epsEff2;
        else epsEff = (epsEff1.i > epsEff2.i) ? epsEff1 : epsEff2;
    }
    return getNK(epsEff);
}

function evalLayersAtWavelength(layersDef, lambda, materialsDB) {
    return layersDef.map(layer => {
        if (layer.type === 'porous') {
            const porousDef = materialsDB[layer.material] || {};
            const hostMat = materialsDB[porousDef.host] || { type: 'constant', n: 1.5, k: 0 };
            const incMat = materialsDB[porousDef.inclusion] || { type: 'constant', n: 1.0, k: 0 };
            
            const baseFF = porousDef.fraction !== undefined ? Number(porousDef.fraction) : 0.5;
            const safeFF = layer.ff !== undefined ? Number(layer.ff) : baseFF;
            const algo = porousDef.algo || 'MG';
            
            const nk = calcEMA(hostMat, incMat, safeFF, algo, Number(lambda));
            return { d: Number(layer.d), n: nk.n, k: nk.k };
        }
        
        const mat = materialsDB[layer.material] || { type: 'constant', n: 1.5, k: 0 };
        const nk = getNKAtWave(mat, Number(lambda));
        
        let d = Number(layer.d);
        if (layer.type === '2d') {
            d = (Number(layer.count) || 1) * (Number(layer.d_mono) || 0.34);
        }
        
        return { d: d, n: nk.n, k: nk.k };
    });
}

self.onmessage = function(e) {
    const data = e.data;

    if (data.type === 'simulate1D') {
        try {
            const { start, end, steps, variable, fixedParam, polarization, layers, materialsDB } = data.payload;
            
            // Pregătim structurile de date
        let results = { 
            x: new Float64Array(steps),
            R: new Float64Array(steps),
            T: new Float64Array(steps),
            A: new Float64Array(steps),
            phaseR: new Float64Array(steps),
            phaseT: new Float64Array(steps)
        };
        
        const stepSize = (end - start) / (steps - 1 || 1);
        
        for (let i = 0; i < steps; i++) {
            const currentVal = start + i * stepSize;
            
            const lambda = variable === 'lambda' ? currentVal : fixedParam;
            const theta = variable === 'theta' ? currentVal : fixedParam;
            
            // Evaluăm proprietățile straturilor pe baza lungimii de undă curente
            const activeLayers = evalLayersAtWavelength(layers, lambda, materialsDB);
            
            // Apelăm motorul
            const res = simulateTMM({ lambda, theta, polarization, layers: activeLayers });
            
            results.x[i] = currentVal;
            results.R[i] = res.R;
            results.T[i] = res.T;
            results.A[i] = res.A;
            results.phaseR[i] = res.phaseR || res.phase_r || 0;
            results.phaseT[i] = res.phaseT || res.phase_t || 0;
        }
        
            self.postMessage({ 
                type: 'result1D', 
                data: results,
                variable: variable
            });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message, stack: err.stack });
        }
    }
};
