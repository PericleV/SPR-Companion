/**
 * Clasă optimizată pentru operații cu numere complexe,
 * folosită de motorul TMM 2x2 (Transfer Matrix Method).
 */
export class Complex {
    /**
     * @param {number} re - Partea reală
     * @param {number} im - Partea imaginară (implicit 0)
     */
    constructor(re, im = 0) {
        this.re = re;
        this.im = im;
    }

    // --- Operații de bază ---

    add(c) {
        if (typeof c === 'number') return new Complex(this.re + c, this.im);
        return new Complex(this.re + c.re, this.im + c.im);
    }

    sub(c) {
        if (typeof c === 'number') return new Complex(this.re - c, this.im);
        return new Complex(this.re - c.re, this.im - c.im);
    }

    mul(c) {
        if (typeof c === 'number') return new Complex(this.re * c, this.im * c);
        // (a + bi)(c + di) = (ac - bd) + (ad + bc)i
        return new Complex(
            this.re * c.re - this.im * c.im,
            this.re * c.im + this.im * c.re
        );
    }

    div(c) {
        if (typeof c === 'number') return new Complex(this.re / c, this.im / c);
        // (a + bi)/(c + di)
        const den = c.re * c.re + c.im * c.im;
        return new Complex(
            (this.re * c.re + this.im * c.im) / den,
            (this.im * c.re - this.re * c.im) / den
        );
    }

    // --- Mărimi ---

    /** Returnează modulul (magnitudinea) numărului complex */
    mag() {
        return Math.sqrt(this.re * this.re + this.im * this.im);
    }

    /** Returnează modulul la pătrat (mai rapid, util pentru Reflectanță/Transmisie) */
    magSq() {
        return this.re * this.re + this.im * this.im;
    }

    /** Returnează faza (unghiul) în radiani */
    phase() {
        return Math.atan2(this.im, this.re);
    }

    // --- Operații avansate (Metode Statice) ---

    /**
     * Rădăcina pătrată complexă: sqrt(z)
     * Esențială pentru calculul vectorului de undă (kz) în medii absorbante.
     */
    static sqrt(c) {
        const r = c.mag();
        const re = Math.sqrt((r + c.re) / 2);
        // Ne asigurăm că semnul părții imaginare este păstrat corect
        const signIm = c.im === 0 ? 1 : Math.sign(c.im);
        const im = signIm * Math.sqrt((r - c.re) / 2);
        return new Complex(re, im);
    }

    /**
     * Exponențiala complexă: exp(z) = e^(x + iy) = e^x * (cos(y) + i*sin(y))
     * Folosită pentru calculul fazei de propagare.
     */
    static exp(c) {
        const expRe = Math.exp(c.re);
        return new Complex(
            expRe * Math.cos(c.im),
            expRe * Math.sin(c.im)
        );
    }

    /**
     * Cosinus complex: cos(x + iy) = cos(x)cosh(y) - i*sin(x)sinh(y)
     */
    static cos(c) {
        return new Complex(
            Math.cos(c.re) * Math.cosh(c.im),
            -Math.sin(c.re) * Math.sinh(c.im)
        );
    }

    /**
     * Sinus complex: sin(x + iy) = sin(x)cosh(y) + i*cos(x)sinh(y)
     */
    static sin(c) {
        return new Complex(
            Math.sin(c.re) * Math.cosh(c.im),
            Math.cos(c.re) * Math.sinh(c.im)
        );
    }
}
