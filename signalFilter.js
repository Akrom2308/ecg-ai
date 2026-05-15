/**
 * ECG Signal Filtering Module
 * Supports: Bandpass, Notch (50/60Hz), Baseline Wander Removal, Savitzky-Golay
 */
export class ECGSignalFilter {
  constructor(sampleRate = 360) {
    this.fs = sampleRate;
  }

  bandpassFilter(signal) {
    const sections = this._butterworthBandpass(0.5, 40, this.fs);
    return this._applyBiquadSections(signal, sections);
  }

  notchFilter(signal, notchFreq = 50) {
    const w0 = (2 * Math.PI * notchFreq) / this.fs;
    const Q = 30;
    const r = 1 - Math.PI * notchFreq / (Q * this.fs);
    const cosW0 = Math.cos(w0);
    const b = [1, -2 * cosW0, 1];
    const a = [1, -2 * r * cosW0, r * r];
    return this._applyIIR(signal, b, a);
  }

  removeBaselineWander(signal) {
    try { return this._splineBaselineRemoval(signal); }
    catch { return this._highPassFilter(signal, 0.5); }
  }

  savitzkyGolay(signal, windowSize = 11, polyOrder = 3) {
    if (windowSize % 2 === 0) windowSize += 1;
    const half = Math.floor(windowSize / 2);
    const coeffs = this._sgCoefficients(windowSize, polyOrder);
    const result = new Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      for (let j = -half; j <= half; j++) {
        const idx = Math.min(Math.max(i + j, 0), signal.length - 1);
        sum += coeffs[j + half] * signal[idx];
      }
      result[i] = sum;
    }
    return result;
  }

  fullPipeline(signal, opts = {}) {
    let s = this.removeBaselineWander(signal);
    s = this.notchFilter(s, opts.notchFreq || 50);
    s = this.bandpassFilter(s);
    if (opts.smooth !== false) s = this.savitzkyGolay(s);
    return s;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────
  _applyIIR(signal, b, a) {
    const out = new Array(signal.length).fill(0);
    for (let n = 0; n < signal.length; n++) {
      out[n] = b[0] * signal[n]
        + (b[1] || 0) * (signal[n - 1] || 0)
        + (b[2] || 0) * (signal[n - 2] || 0)
        - (a[1] || 0) * (out[n - 1] || 0)
        - (a[2] || 0) * (out[n - 2] || 0);
    }
    return out;
  }

  _applyBiquadSections(signal, sections) {
    let s = [...signal];
    for (const { b, a } of sections) s = this._applyIIR(s, b, a);
    return s;
  }

  _butterworthBandpass(fLow, fHigh, fs) {
    const wl = 2 * Math.tan((Math.PI * fLow) / fs);
    const wh = 2 * Math.tan((Math.PI * fHigh) / fs);
    const bw = wh - wl;
    const w0 = Math.sqrt(wl * wh);
    const Q = w0 / bw;
    const cosW = Math.cos(2 * Math.PI * Math.sqrt(fLow * fHigh) / fs);
    const sinW = Math.sin(2 * Math.PI * Math.sqrt(fLow * fHigh) / fs);
    const alpha = sinW / (2 * Q);
    const b0 = alpha, b1 = 0, b2 = -alpha;
    const a0 = 1 + alpha, a1 = -2 * cosW, a2 = 1 - alpha;
    return [
      { b: [b0 / a0, b1 / a0, b2 / a0], a: [1, a1 / a0, a2 / a0] },
      { b: [b0 / a0, b1 / a0, b2 / a0], a: [1, a1 / a0, a2 / a0] },
    ];
  }

  _highPassFilter(signal, cutoff) {
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / this.fs;
    const alpha = rc / (rc + dt);
    const out = new Array(signal.length);
    out[0] = signal[0];
    for (let i = 1; i < signal.length; i++) out[i] = alpha * (out[i - 1] + signal[i] - signal[i - 1]);
    return out;
  }

  _splineBaselineRemoval(signal) {
    const step = Math.round(this.fs * 0.2);
    const knots = [];
    for (let i = 0; i < signal.length; i += step) {
      const seg = signal.slice(i, i + step);
      const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
      knots.push({ x: i + Math.floor(step / 2), y: mean });
    }
    const baseline = new Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      const lo = knots.reduce((prev, k) => k.x <= i ? k : prev, knots[0]);
      const hi = knots.find(k => k.x > i) || knots[knots.length - 1];
      if (lo === hi) baseline[i] = lo.y;
      else { const t = (i - lo.x) / (hi.x - lo.x); baseline[i] = lo.y + t * (hi.y - lo.y); }
    }
    return signal.map((v, i) => v - baseline[i]);
  }

  _sgCoefficients(m, k) {
    const half = Math.floor(m / 2);
    const A = [];
    for (let i = -half; i <= half; i++) {
      const row = [];
      for (let j = 0; j <= k; j++) row.push(Math.pow(i, j));
      A.push(row);
    }
    const AT = A[0].map((_, ci) => A.map(row => row[ci]));
    const ATA = AT.map(row => AT[0].map((_, j) => row.reduce((s, v, k2) => s + row[k2] * AT[j][k2], 0)));
    const ATAinv = this._matInv(ATA);
    const H = ATAinv.map(row => AT[0].map((_, i2) => row.reduce((acc, v, j) => acc + v * AT[j][i2], 0)));
    return H[0];
  }

  _matInv(M) {
    const n = M.length;
    const aug = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let col = 0; col < n; col++) {
      let max = col;
      for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[max][col])) max = row;
      [aug[col], aug[max]] = [aug[max], aug[col]];
      const pivot = aug[col][col];
      if (Math.abs(pivot) < 1e-12) throw new Error('Singular matrix');
      aug[col] = aug[col].map(v => v / pivot);
      for (let row = 0; row < n; row++) {
        if (row !== col) { const f = aug[row][col]; aug[row] = aug[row].map((v, j) => v - f * aug[col][j]); }
      }
    }
    return aug.map(row => row.slice(n));
  }
}
