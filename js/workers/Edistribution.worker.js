// --- Funcții Helper pentru Numere Complexe ---
const c_add = (a, b) => ({r: a.r + b.r, i: a.i + b.i});
const c_sub = (a, b) => ({r: a.r - b.r, i: a.i - b.i});
const c_mul = (a, b) => ({r: a.r*b.r - a.i*b.i, i: a.r*b.i + a.i*b.r});
const c_div = (a, b) => { const den = b.r*b.r + b.i*b.i; return {r: (a.r*b.r + a.i*b.i)/den, i: (a.i*b.r - a.r*b.i)/den}; };
const c_exp = (a) => { const e = Math.exp(a.r); return {r: e*Math.cos(a.i), i: e*Math.sin(a.i)}; };
const c_sqrt = (a) => { 
    const mag = Math.sqrt(a.r*a.r + a.i*a.i); 
    const r = Math.sqrt((mag + a.r)/2); 
    const sign = a.i < 0 ? -1 : 1; 
    const i = sign * Math.sqrt((mag - a.r)/2); 
    return {r, i}; 
};
const c_magSq = (a) => a.r*a.r + a.i*a.i;

self.onmessage = function(e) {
    const { layersDef, lambda, theta, pol, zMin, zMax } = e.data;

    const k0 = 2 * Math.PI / lambda;
    const th_rad = theta * Math.PI / 180;
    
    let n = layersDef.map(l => ({r: l.n, i: l.k}));
    let eps = n.map(ni => c_mul(ni, ni));
    let n0_sin = {r: n[0].r * Math.sin(th_rad), i: n[0].i * Math.sin(th_rad)};
    let kx = {r: k0 * n0_sin.r, i: k0 * n0_sin.i};
    let kx2 = c_mul(kx, kx);
    
    let kz = [];
    let p = [];
    for(let j = 0; j < layersDef.length; j++) {
        let k02_eps = {r: k0*k0*eps[j].r, i: k0*k0*eps[j].i};
        let kz_sq = c_sub(k02_eps, kx2);
        let kz_val = c_sqrt(kz_sq);
        kz.push(kz_val);
        if(pol === 'TE') {
            p.push(kz_val); 
        } else {
            p.push(c_div(kz_val, eps[j]));
        }
    }
    
    // Calcul propagare (Backwards matching)
    let amplitudes = []; 
    amplitudes[layersDef.length - 1] = [{r:1, i:0}, {r:0, i:0}];
    
    for(let j = layersDef.length - 2; j >= 0; j--) {
        let ratio = c_div(p[j+1], p[j]); // p_{j+1}/p_j
        
        let A_next = amplitudes[j+1][0];
        let B_next = amplitudes[j+1][1];
        
        let EM = c_add(A_next, B_next);
        let HM = c_mul(ratio, c_sub(A_next, B_next));
        
        let Aj_right = c_mul({r:0.5, i:0}, c_add(EM, HM));
        let Bj_right = c_mul({r:0.5, i:0}, c_sub(EM, HM));
        
        let d = j === 0 ? 0 : layersDef[j].d; 
        let phase = {r: -kz[j].i * d, i: kz[j].r * d}; 
        
        let Aj = c_mul(Aj_right, c_exp({r: -phase.r, i: -phase.i}));
        let Bj = c_mul(Bj_right, c_exp(phase));
        
        amplitudes[j] = [Aj, Bj];
    }
    
    let A0 = amplitudes[0][0];
    let norm = c_div({r:1, i:0}, A0);
    
    for(let j = 0; j < layersDef.length; j++) {
        amplitudes[j][0] = c_mul(amplitudes[j][0], norm);
        amplitudes[j][1] = c_mul(amplitudes[j][1], norm);
    }
    
    let z_points = [];
    let E_intensity = [], E_x_arr = [], E_y_arr = [], E_z_arr = [];
    let H_intensity = [], H_x_arr = [], H_y_arr = [], H_z_arr = [];
    let Sz_arr = [];
    let layer_boundaries = [];
    let current_z = 0;

    const pushPoint = (E_plus, E_minus, kz_val, eps_val) => {
        let e_tot=0, ex=0, ey=0, ez=0, h_tot=0, hx=0, hy=0, hz=0, sz=0;
        
        if (pol === 'TE') {
            let Ey = c_add(E_plus, E_minus);
            ey = c_magSq(Ey);
            e_tot = ey;
            
            let Hx_c = c_mul(kz_val, c_sub(E_plus, E_minus));
            hx = c_magSq(Hx_c);
            
            let Hz_c = c_mul(kx, c_add(E_plus, E_minus));
            hz = c_magSq(Hz_c);
            
            h_tot = hx + hz;
            
            let Ey_re = Ey.r, Ey_im = Ey.i;
            let Hx_re = Hx_c.r, Hx_im = Hx_c.i;
            sz = 0.5 * (Ey_re * Hx_re + Ey_im * Hx_im);
        } else {
            let Hy = c_add(E_plus, E_minus);
            hy = c_magSq(Hy);
            h_tot = hy;
            
            let pre_x = c_div(kz_val, eps_val);
            let Ex_c = c_mul(pre_x, c_sub(E_plus, E_minus));
            ex = c_magSq(Ex_c);
            
            let pre_z = c_div(kx, eps_val);
            let Ez_c = c_mul(pre_z, c_add(E_plus, E_minus));
            ez = c_magSq(Ez_c);
            
            e_tot = ex + ez;
            
            let Ex_re = Ex_c.r, Ex_im = Ex_c.i;
            let Hy_re = Hy.r, Hy_im = Hy.i;
            sz = 0.5 * (Ex_re * Hy_re + Ex_im * Hy_im);
        }

        E_intensity.push(e_tot);
        E_x_arr.push(ex); E_y_arr.push(ey); E_z_arr.push(ez);
        H_intensity.push(h_tot);
        H_x_arr.push(hx); H_y_arr.push(hy); H_z_arr.push(hz);
        Sz_arr.push(sz);
    };
    
    // Incident (Strat 0) 
    let zStartInc = Math.min(0, zMin);
    layer_boundaries.push({ start: zStartInc, end: 0, color: layersDef[0].color, name: layersDef[0].label });
    
    for(let z = zStartInc; z <= 0; z += 1) {
        if (z < zMin || z > zMax) continue;
        z_points.push(z);
        let phase = {r: -kz[0].i * z, i: kz[0].r * z};
        let E_plus = c_mul(amplitudes[0][0], c_exp(phase));
        let E_minus = c_mul(amplitudes[0][1], c_exp({r: -phase.r, i: -phase.i}));
        pushPoint(E_plus, E_minus, kz[0], eps[0]);
    }
    
    // Straturi intermediare
    for(let j = 1; j < layersDef.length - 1; j++) {
        let d = layersDef[j].d;
        layer_boundaries.push({ start: current_z, end: current_z + d, color: layersDef[j].color, name: layersDef[j].label });
        let steps = Math.max(2, Math.floor(d)); 
        let step_size = d / steps;
        
        for(let i = 1; i <= steps; i++) {
            let z_local = i * step_size;
            let z_global = current_z + z_local;
            if (z_global < zMin || z_global > zMax) continue;

            z_points.push(z_global);
            let phase = {r: -kz[j].i * z_local, i: kz[j].r * z_local};
            let E_plus = c_mul(amplitudes[j][0], c_exp(phase));
            let E_minus = c_mul(amplitudes[j][1], c_exp({r: -phase.r, i: -phase.i}));
            pushPoint(E_plus, E_minus, kz[j], eps[j]);
        }
        current_z += d;
    }
    
    // Substrat (Ultimul strat)
    let zEndSub = Math.max(current_z, zMax);
    layer_boundaries.push({ start: current_z, end: zEndSub, color: layersDef[layersDef.length-1].color, name: layersDef[layersDef.length-1].label });
    
    for(let z = 1; z <= zEndSub - current_z; z += 1) {
        let z_global = current_z + z;
        if (z_global < zMin || z_global > zMax) continue;

        z_points.push(z_global);
        let phase = {r: -kz[layersDef.length-1].i * z, i: kz[layersDef.length-1].r * z};
        let E_plus = c_mul(amplitudes[layersDef.length-1][0], c_exp(phase));
        let E_minus = {r: 0, i: 0};
        pushPoint(E_plus, E_minus, kz[layersDef.length-1], eps[layersDef.length-1]);
    }
    
    // Normalizare absolută la Câmpul Incident = 1
    let e_norm_factor = 1;
    let h_norm_factor = 1;
    let sz_norm_factor = 1;

    if(pol === 'TM') {
        let prefactor_x = c_div(kz[0], eps[0]);
        let prefactor_z = c_div(kx, eps[0]);
        let E_inc_magSq = c_magSq(prefactor_x) + c_magSq(prefactor_z);
        e_norm_factor = 1 / E_inc_magSq;
        // In TM, Incident H_y = 1, so h_norm = 1.
        
        let Ex_inc_re = prefactor_x.r, Ex_inc_im = prefactor_x.i;
        let Hy_inc_re = 1, Hy_inc_im = 0;
        let Sz_inc = 0.5 * (Ex_inc_re * Hy_inc_re + Ex_inc_im * Hy_inc_im);
        sz_norm_factor = 1 / Sz_inc;
    } else {
        // In TE, Incident E_y = 1, so e_norm = 1.
        let Hx_c = c_mul(kz[0], {r:1, i:0});
        let Hz_c = c_mul(kx, {r:1, i:0});
        let H_inc_magSq = c_magSq(Hx_c) + c_magSq(Hz_c);
        h_norm_factor = 1 / H_inc_magSq;

        let Ey_inc_re = 1, Ey_inc_im = 0;
        let Hx_inc_re = Hx_c.r, Hx_inc_im = Hx_c.i;
        let Sz_inc = 0.5 * (Ey_inc_re * Hx_inc_re + Ey_inc_im * Hx_inc_im);
        sz_norm_factor = 1 / Sz_inc;
    }
    
    E_intensity = E_intensity.map(v => v * e_norm_factor);
    E_x_arr = E_x_arr.map(v => v * e_norm_factor);
    E_y_arr = E_y_arr.map(v => v * e_norm_factor);
    E_z_arr = E_z_arr.map(v => v * e_norm_factor);

    H_intensity = H_intensity.map(v => v * h_norm_factor);
    H_x_arr = H_x_arr.map(v => v * h_norm_factor);
    H_y_arr = H_y_arr.map(v => v * h_norm_factor);
    H_z_arr = H_z_arr.map(v => v * h_norm_factor);

    Sz_arr = Sz_arr.map(v => v * sz_norm_factor);

    // Penetration Depth (Lp) using E_intensity (which is |E|²)
    let Lp = 0;
    let z_interface = current_z;
    let I_0 = -1;
    let targetI = -1;
    let foundInterface = false;

    for(let i = 0; i < z_points.length; i++) {
        if (!foundInterface && z_points[i] >= z_interface - 1e-6) {
            I_0 = E_intensity[i];
            targetI = I_0 / Math.E;
            foundInterface = true;
            continue;
        }
        
        if (foundInterface && E_intensity[i] <= targetI) {
            let z1 = z_points[i-1];
            let I1 = E_intensity[i-1];
            let z2 = z_points[i];
            let I2 = E_intensity[i];
            
            let fraction = 0;
            if (I1 !== I2) fraction = (targetI - I1) / (I2 - I1);
            let exact_z = z1 + fraction * (z2 - z1);
            Lp = exact_z - z_interface;
            break;
        }
    }

    self.postMessage({ 
        z_points, layer_boundaries, penetrationDepth: Lp,
        components: {
            'e_tot': E_intensity,
            'ex': E_x_arr,
            'ey': E_y_arr,
            'ez': E_z_arr,
            'h_tot': H_intensity,
            'hx': H_x_arr,
            'hy': H_y_arr,
            'hz': H_z_arr,
            'sz': Sz_arr
        }
    });
};
