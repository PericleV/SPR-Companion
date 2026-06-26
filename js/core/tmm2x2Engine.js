import { Complex } from './Complex.js?v=50';

/**
 * Înmulțește două matrici 2x2 de numere complexe.
 * @param {Complex[][]} A 
 * @param {Complex[][]} B 
 * @returns {Complex[][]} Matricea rezultată
 */
function multiplyMatrix2x2(A, B) {
    return [
        [
            A[0][0].mul(B[0][0]).add(A[0][1].mul(B[1][0])),
            A[0][0].mul(B[0][1]).add(A[0][1].mul(B[1][1]))
        ],
        [
            A[1][0].mul(B[0][0]).add(A[1][1].mul(B[1][0])),
            A[1][0].mul(B[0][1]).add(A[1][1].mul(B[1][1]))
        ]
    ];
}

/**
 * Calculează R, T, A pentru o singură polarizare (TE sau TM).
 * @param {number} lambda - Lungimea de undă (nm)
 * @param {number} thetaDeg - Unghiul de incidență (grade)
 * @param {string} polarization - 'TE' (s) sau 'TM' (p)
 * @param {Array} layers - Array de obiecte { n, k, d }, d în nm. 
 * Primul și ultimul strat sunt considerate semi-infinite.
 */
function calculateSinglePolarization(lambda, thetaDeg, polarization, layers) {
    const thetaRad = thetaDeg * (Math.PI / 180);
    const k0 = (2 * Math.PI) / lambda;
    const i_comp = new Complex(0, 1); // Numărul complex 'i'

    // Indicele mediului incident (strat 0)
    const n0 = new Complex(layers[0].n, layers[0].k);
    
    // Invariantul lui Snell: n0 * sin(theta0)
    const n0_sin_theta = n0.mul(Math.sin(thetaRad));
    const n0_sin_theta_sq = n0_sin_theta.mul(n0_sin_theta);

    let p0, ps;
    
    // Inițializăm matricea globală ca Matrice Unitate I
    let M = [
        [new Complex(1, 0), new Complex(0, 0)],
        [new Complex(0, 0), new Complex(1, 0)]
    ];

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const ni = new Complex(layer.n, layer.k);
        const ni_sq = ni.mul(ni);

        // Componenta z a vectorului de undă: kz = k0 * sqrt(n_i^2 - n0^2 * sin^2(theta0))
        const kz_core = Complex.sqrt(ni_sq.sub(n0_sin_theta_sq));
        const kz = kz_core.mul(k0);

        // Admitanța optică (p_i) depinde de polarizare
        let pi;
        if (polarization === 'TE') {
            pi = kz_core; // TE (s-pol): p = kz / k0 = sqrt(n^2 - n0^2 sin^2(theta))
        } else {
            pi = kz_core.div(ni_sq); // TM (p-pol): p = kz / (k0 * n^2)
        }

        // Salvăm admitanța mediului incident și a substratului
        if (i === 0) {
            p0 = pi;
            continue; // Primul mediu e semi-infinit, nu are matrice de propagare
        }
        if (i === layers.length - 1) {
            ps = pi;
            continue; // Ultimul mediu e semi-infinit, dictează doar condiția la limită (ieșire)
        }

        // --- Pentru straturile intermediare construim Matricea de Transfer (Mj) ---
        const d = layer.d; // grosimea în nm
        const phase = kz.mul(d); // defazajul delta = kz * d

        // Prevent exponential overflow for thick, absorbing layers or TIR
        if (phase.im > 150) phase.im = 150;
        if (phase.im < -150) phase.im = -150;

        const cos_delta = Complex.cos(phase);
        const sin_delta = Complex.sin(phase);

        // m11 = cos(delta)
        // m12 = -i / p * sin(delta)
        // m21 = -i * p * sin(delta)
        // m22 = cos(delta)
        const m11 = cos_delta;
        const m12 = i_comp.mul(-1).div(pi).mul(sin_delta);
        const m21 = i_comp.mul(-1).mul(pi).mul(sin_delta);
        const m22 = cos_delta;

        const Mj = [
            [m11, m12],
            [m21, m22]
        ];

        // M_total = M_total * Mj
        M = multiplyMatrix2x2(M, Mj);
    }

    // --- Calculul coeficienților de Reflexie (r) și Transmisie (t) ---
    // r = (p0*m11 + p0*ps*m12 - m21 - ps*m22) / (p0*m11 + p0*ps*m12 + m21 + ps*m22)
    const p0_m11 = p0.mul(M[0][0]);
    const p0_ps_m12 = p0.mul(ps).mul(M[0][1]);
    const m21 = M[1][0];
    const ps_m22 = ps.mul(M[1][1]);

    const num_r = p0_m11.add(p0_ps_m12).sub(m21).sub(ps_m22);
    const den = p0_m11.add(p0_ps_m12).add(m21).add(ps_m22);
    
    const r = num_r.div(den);
    
    // t = 2*p0 / den
    const num_t = p0.mul(2);
    const t = num_t.div(den);

    // --- Mărimi energetice (Puterile) ---
    const R = r.magSq();
    // T = |t|^2 * Re(ps) / Re(p0)
    const T = t.magSq() * (ps.re / p0.re); 
    const A = 1 - R - T; // Absorbția

    return {
        R: R,
        T: T,
        A: A,
        phaseR: r.phase(),
        phaseT: t.phase(),
        r: r,
        t: t
    };
}

/**
 * Funcția principală exportată pentru simularea TMM.
 * @param {Object} params - Parametrii simulării
 * @param {number} params.lambda - Lungimea de undă (nm)
 * @param {number} params.theta - Unghiul de incidență (grade)
 * @param {string} params.polarization - 'TE', 'TM', sau 'unpolarized'
 * @param {Array} params.layers - Array de obiecte { n: num, k: num, d: num }
 * @returns {Object} Rezultatele { R, T, A, phaseR }
 */
export function simulateTMM({ lambda, theta, polarization, layers }) {
    if (polarization === 'unpolarized') {
        const resTE = calculateSinglePolarization(lambda, theta, 'TE', layers);
        const resTM = calculateSinglePolarization(lambda, theta, 'TM', layers);
        
        return {
            R: (resTE.R + resTM.R) / 2,
            T: (resTE.T + resTM.T) / 2,
            A: (resTE.A + resTM.A) / 2,
            phaseR: (resTE.phaseR + resTM.phaseR) / 2
        };
    } else {
        return calculateSinglePolarization(lambda, theta, polarization, layers);
    }
}

