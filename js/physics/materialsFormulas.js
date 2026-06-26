export const MaterialFormulas = {
    // Constants
    hbar: 6.582119569e-16, // eV*s
    e: 1.602176634e-19, // C
    c: 299792458, // m/s
    eps0: 8.8541878128e-12, // F/m
    kB: 8.617333262145e-5, // eV/K

    // Helper: Convert Wavelength (nm) to Energy (eV)
    waveToEv(w_nm) {
        return 1239.84193 / w_nm;
    },

    // Helper: Convert Wavelength (nm) to Omega (rad/s)
    waveToOmega(w_nm) {
        return (2 * Math.PI * this.c) / (w_nm * 1e-9);
    },

    // Convert parameter from UI units to expected math units
    // For Drude/Lorentz, we do math in eV mostly for convenience, or we can convert everything to eV.
    convertToEv(value, unit) {
        if (unit === 'eV') return value;
        if (unit === 'rad/s') return value * this.hbar; // E = hbar * w
        if (unit === 'Hz') return value * 2 * Math.PI * this.hbar;
        if (unit === '1/cm') return value * 1.23984e-4; // 1 cm^-1 = 0.00012398 eV
        if (unit === 'nm') return 1239.84193 / value;
        return value;
    },

    getNK(epsR, epsI) {
        const mag = Math.sqrt(epsR*epsR + epsI*epsI);
        let n = Math.sqrt((mag + epsR) / 2);
        let k = Math.sqrt((mag - epsR) / 2);
        if (epsI < 0) k = -k;
        return { n: n, k: Math.max(0, k) }; 
    },

    evaluateSellmeier(w_nm, params) {
        // params: { B1, C1, B2, C2, B3, C3, unit: 'um' | 'nm' }
        // Default Sellmeier equation: n^2 = 1 + B1*L^2/(L^2-C1) + ... where L is usually in um.
        let w = params.unit === 'nm' ? w_nm : w_nm / 1000.0; // convert to um if needed
        let w2 = w * w;
        
        let n2 = 1.0;
        if (params.B1) n2 += (params.B1 * w2) / (w2 - params.C1);
        if (params.B2) n2 += (params.B2 * w2) / (w2 - params.C2);
        if (params.B3) n2 += (params.B3 * w2) / (w2 - params.C3);
        
        // Sellmeier is only for transparent region (k approx 0)
        let n = n2 > 0 ? Math.sqrt(n2) : 0;
        return { n: n, k: 0 };
    },

    evaluateDrude(w_nm, params) {
        // params: { eps_inf, wp, gamma, wp_unit, gamma_unit }
        let E = this.waveToEv(w_nm); // Photon energy in eV
        let wp = this.convertToEv(params.wp, params.wp_unit);
        let gamma = this.convertToEv(params.gamma, params.gamma_unit);
        let eps_inf = params.eps_inf || 1.0;

        // eps(E) = eps_inf - wp^2 / (E^2 + i * gamma * E)
        // Denominator: E^2 + i*gamma*E
        let denR = E * E;
        let denI = gamma * E;
        let denMag2 = denR * denR + denI * denI;

        let epsR = eps_inf - (wp * wp * denR) / denMag2;
        let epsI = (wp * wp * denI) / denMag2;

        return this.getNK(epsR, epsI);
    },

    evaluateDrudeLorentz(w_nm, params) {
        // params: { eps_inf, drude: { wp, gamma, wp_unit, gamma_unit }, oscillators: [{ f, w0, gamma, unit }] }
        let E = this.waveToEv(w_nm);
        let eps_inf = params.eps_inf || 1.0;
        let epsR = eps_inf;
        let epsI = 0;

        // Drude term: - wp^2 / (E^2 + i * gamma * E)
        if (params.drude && params.drude.wp > 0) {
            let wp = this.convertToEv(params.drude.wp, params.drude.wp_unit);
            let gamma = this.convertToEv(params.drude.gamma, params.drude.gamma_unit);
            let denR = E * E;
            let denI = gamma * E;
            let denMag2 = denR * denR + denI * denI;
            epsR -= (wp * wp * denR) / denMag2;
            epsI += (wp * wp * denI) / denMag2;
        }

        // Lorentz terms: + f * wp^2 / (w0^2 - E^2 - i * gamma * E)
        // Wait, standard form is usually f * w_p^2 / (w_0^2 - w^2 - i * gamma * w). We'll assume 'f' is just an oscillator strength that multiplies wp^2, 
        // OR if the user provides the oscillator plasma frequency directly, let's use wp_osc.
        // Let's assume the user provides amplitude A (which equals f * wp^2 or just wp_osc^2).
        if (params.oscillators) {
            for (let osc of params.oscillators) {
                let w0 = this.convertToEv(osc.w0, osc.unit);
                let gamma = this.convertToEv(osc.gamma, osc.unit);
                let A = this.convertToEv(osc.A, osc.unit); // A is treated as wp_osc^2 here if A has eV units it's actually eV^2 in the formula, wait.
                // Let's standardise: A is given in eV^2 or we input it as wp_osc (eV) and square it.
                // It's safer to ask for wp_osc (in eV/rad/s) and square it. Let's call it w_p.
                let wp_osc = this.convertToEv(osc.wp, osc.unit);
                
                let num = wp_osc * wp_osc;
                let denR = w0 * w0 - E * E;
                let denI = -gamma * E; // usually (w0^2 - w^2 - i gamma w)
                let denMag2 = denR * denR + denI * denI;
                
                epsR += (num * denR) / denMag2;
                epsI -= (num * denI) / denMag2; // minus because denI is negative
            }
        }

        return this.getNK(epsR, epsI);
    },

    evaluateKubo(w_nm, params) {
        // params: { muc (eV), T (K), gamma (eV), d (nm) }
        // Simplified Kubo formula at optical frequencies
        let E = this.waveToEv(w_nm); // eV
        let omega = this.waveToOmega(w_nm); // rad/s
        let muc = params.muc || 0.4;
        let T = params.T || 300;
        let gamma = params.gamma || 0.01; // eV
        let gamma_rad = (gamma / this.hbar); // rad/s
        let d = (params.d || 0.34) * 1e-9; // m

        // Conductivity (Intraband) approx for E << muc, but we need general. 
        // For simplicity, we use the standard local conductivity (valid for w > vF * q)
        // Sigma_intra = i * e^2 * kB * T / (pi * hbar^2 * (w + i*gamma)) * (muc/(kB*T) + 2*ln(exp(-muc/(kB*T)) + 1))
        
        let term1 = (this.e * this.e * this.kB * T) / (Math.PI * this.hbar * this.hbar);
        let muc_kBT = muc / (this.kB * T);
        let term2 = muc_kBT + 2 * Math.log(Math.exp(-muc_kBT) + 1);
        
        // sigma_intra = i * term1 * term2 / (omega + i * gamma_rad)
        let sig_intra_num = term1 * term2;
        let den_intra = omega * omega + gamma_rad * gamma_rad;
        let sig_intra_R = (sig_intra_num * gamma_rad) / den_intra;
        let sig_intra_I = (sig_intra_num * omega) / den_intra;
        
        // Sigma_inter approx: e^2/(4 hbar) * (G(E/2) + i * 4*E/pi * int_0^inf (G(eps) - G(E/2))/(E^2 - 4*eps^2) deps)
        // This integral is complex to compute on the fly. 
        // A common approximation for interband conductivity (Step function approximation):
        // sigma_inter = e^2/(4*hbar) * (0.5 + 1/pi * arctan((E - 2*muc)/(2*kB*T)))
        // - i * e^2/(4*hbar * pi) * ln((2*muc + E)^2 / ((2*muc - E)^2 + (2*kB*T)^2))
        
        let sig0 = (this.e * this.e) / (4 * this.hbar);
        let kBT = this.kB * T;
        let sig_inter_R = sig0 * (0.5 + (1 / Math.PI) * Math.atan((E - 2 * muc) / (2 * kBT)));
        let sig_inter_I = -(sig0 / Math.PI) * 0.5 * Math.log((2*muc + E)**2 / ((2*muc - E)**2 + (2*kBT)**2));

        let sigR = sig_intra_R + sig_inter_R;
        let sigI = sig_intra_I + sig_inter_I;

        // epsilon = 1 + i * sigma / (eps0 * omega * d)
        // eps = 1 + i * (sigR + i*sigI) / (eps0 * omega * d)
        // eps = 1 - sigI / (eps0 * omega * d) + i * sigR / (eps0 * omega * d)
        
        let factor = 1.0 / (this.eps0 * omega * d);
        let epsR = 1.0 - sigI * factor;
        let epsI = sigR * factor;

        return this.getNK(epsR, epsI);
    }
};
