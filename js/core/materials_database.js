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

// Obiectul central de date. Orice fișier importă acesta referință va accesa exact aceeași memorie.
export const MaterialsDB = {
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
};

// Sincronizare automată: la inițializarea aplicației, încărcăm orice material 
// custom (poros, 2D, aliaj) salvat anterior în LocalStorage.
try {
    if (typeof window !== 'undefined' && window.localStorage) {
        const savedDB = localStorage.getItem('plasmonic_materials');
        if (savedDB) {
            const parsed = JSON.parse(savedDB);
            // Sanitize loaded materials to remove any NaN values that might have been saved due to past bugs
            const cleanedMaterials = {};
            for (let key in parsed) {
                // Ignore weird names
                if (!key || key === 'NaN' || key === 'undefined' || key === 'null' || key.trim() === '') continue;
                
                const mat = parsed[key];
                
                // If it's completely broken, skip
                if (!mat || typeof mat !== 'object' || !mat.type) continue;
                
                if (mat.type === 'dispersive' && Array.isArray(mat.data)) {
                    mat.data = mat.data.filter(p => !isNaN(p.w) && !isNaN(p.n) && !isNaN(p.k) && p.w !== null && p.n !== null && p.k !== null);
                    // Skip empty dispersive materials
                    if (mat.data.length === 0) continue;
                }
                
                cleanedMaterials[key] = mat;
            }
            
            // Rewrite the clean storage
            localStorage.setItem('plasmonic_materials', JSON.stringify(cleanedMaterials));
            
            Object.assign(MaterialsDB, cleanedMaterials); // Îmbinăm baza de date
        }
    }
} catch (e) {
    console.error("Eroare la sincronizarea bazei de date cu LocalStorage:", e);
}
