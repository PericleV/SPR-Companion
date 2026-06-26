// --- Helpers pentru Numere Complexe (necesare pentru calculul EMA Bruggeman/MG) ---
export const Complex = {
    add: (a, b) => ({r: a.r + b.r, i: a.i + b.i}),
    sub: (a, b) => ({r: a.r - b.r, i: a.i - b.i}),
    mul: (a, b) => ({r: a.r*b.r - a.i*b.i, i: a.r*b.i + a.i*b.r}),
    div: (a, b) => { const den = b.r*b.r + b.i*b.i; return {r: (a.r*b.r + a.i*b.i)/den, i: (a.i*b.r - a.r*b.i)/den}; },
    mulNum: (a, n) => ({r: a.r*n, i: a.i*n}),
    sqrt: (a) => {
        const mag = Math.sqrt(a.r*a.r + a.i*a.i);
        const r = Math.sqrt(Math.max(0, (mag + a.r)/2));
        const sign = a.i < 0 ? -1 : 1;
        const i = sign * Math.sqrt(Math.max(0, (mag - a.r)/2));
        return {r, i};
    }
};

export const getEps = (n, k) => ({ r: n*n - k*k, i: 2*n*k });

export const getNK = (eps) => {
    const mag = Math.sqrt(eps.r*eps.r + eps.i*eps.i);
    let n = Math.sqrt((mag + eps.r) / 2);
    let k = Math.sqrt((mag - eps.r) / 2);
    if (eps.i < 0) k = -k;
    return {n: n, k: Math.max(0, k)}; 
};

// Extrage n,k pentru o lungime de undă dintr-un material stocat (folosit pentru interpolare și EMA)
export function getNKAtWave(mat, w) {
    if (mat.type === 'constant') return {n: mat.n, k: mat.k};
    const d = mat.data;
    if (!d || d.length === 0) return {n: 1, k: 0};
    if (w <= d[0].w) {
        if (mat.extrap === 'linear' && d.length > 1) {
            const diff = d[1].w - d[0].w;
            const t = diff === 0 ? 0 : (w - d[0].w)/diff;
            return { n: Math.max(0, d[0].n + t*(d[1].n - d[0].n)), k: Math.max(0, d[0].k + t*(d[1].k - d[0].k)) };
        }
        return {n: d[0].n, k: d[0].k};
    }
    if (w >= d[d.length-1].w) {
        if (mat.extrap === 'linear' && d.length > 1) {
            const l = d.length;
            const diff = d[l-1].w - d[l-2].w;
            const t = diff === 0 ? 0 : (w - d[l-2].w)/diff;
            return { n: Math.max(0, d[l-2].n + t*(d[l-1].n - d[l-2].n)), k: Math.max(0, d[l-2].k + t*(d[l-1].k - d[l-2].k)) };
        }
        return {n: d[d.length-1].n, k: d[d.length-1].k};
    }
    for(let j=0; j<d.length-1; j++) {
        if(w >= d[j].w && w <= d[j+1].w) {
            const diff = d[j+1].w - d[j].w;
            const t = diff === 0 ? 0 : (w - d[j].w)/diff;
            return { n: d[j].n + t*(d[j+1].n - d[j].n), k: d[j].k + t*(d[j+1].k - d[j].k) };
        }
    }
    return {n: 1, k: 0};
}

import { DefaultMaterials } from '../data/default_materials.js?v=53';

// Obiectul central de date. Orice fișier importă acesta referință va accesa exact aceeași memorie.
export const MaterialsDB = {};

export async function initMaterialsDB() {
    try {
        // 1. Încărcăm baza de date default
        for (let key in MaterialsDB) delete MaterialsDB[key];
        Object.assign(MaterialsDB, DefaultMaterials);
        
        // 2. Încărcăm și suprascriem cu materialele custom din LocalStorage
        if (typeof window !== 'undefined' && window.localStorage) {
            const savedDB = localStorage.getItem('plasmonic_materials');
            if (savedDB) {
                const parsed = JSON.parse(savedDB);
                const cleanedMaterials = {};
                for (let key in parsed) {
                    if (!key || key === 'NaN' || key === 'undefined' || key === 'null' || key.trim() === '') continue;
                    const mat = parsed[key];
                    if (!mat || typeof mat !== 'object' || !mat.type) continue;
                    if (mat.type === 'dispersive' && Array.isArray(mat.data)) {
                        mat.data = mat.data.filter(p => !isNaN(p.w) && !isNaN(p.n) && !isNaN(p.k) && p.w !== null && p.n !== null && p.k !== null);
                        if (mat.data.length === 0) continue;
                    }
                    cleanedMaterials[key] = mat;
                }
                localStorage.setItem('plasmonic_materials', JSON.stringify(cleanedMaterials));
                Object.assign(MaterialsDB, cleanedMaterials);
            }
        }
    } catch (e) {
        console.error("Eroare la inițializarea bazei de date de materiale:", e);
    }
}


