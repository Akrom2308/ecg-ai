/**
 * R-Peak Detection Module
 * Implements the Pan-Tompkins algorithm (1985)
 */
export class RPeakDetector {
  constructor(sampleRate = 360) {
    this.fs = sampleRate;
  }

  detect(signal) {
    const deriv = this._derivative(signal);
    const squared = deriv.map(v => v * v);
    const windowSamples = Math.round(0.150 * this.fs);
    const integrated = this._movingWindowIntegration(squared, windowSamples);
    const peaks = this._adaptiveThreshold(signal, integrated);
    const rri = [];
    for (let i = 1; i < peaks.length; i++) rri.push((peaks[i] - peaks[i - 1]) / this.fs);
    const heartRates = rri.map(rr => 60 / rr);
    const meanHR = heartRates.length ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : 0;
    return { peaks, heartRates, meanHR: Math.round(meanHR), rri };
  }

  delineateQRS(signal, peaks) {
    const qrs = peaks.map(r => {
      const qSearch = Math.max(0, r - Math.round(0.040 * this.fs));
      let Q = qSearch;
      for (let i = qSearch; i < r; i++) if (signal[i] < signal[Q]) Q = i;
      const sSearchEnd = Math.min(signal.length - 1, r + Math.round(0.040 * this.fs));
      let S = r;
      for (let i = r; i <= sSearchEnd; i++) if (signal[i] < signal[S]) S = i;
      return { Q, R: r, S };
    });
    return { qrs };
  }

  computeHRV(rri) {
    if (rri.length < 2) return { sdnn: 0, rmssd: 0, pnn50: 0, meanRR: 0 };
    const mean = rri.reduce((a, b) => a + b, 0) / rri.length;
    const diffs = rri.slice(1).map((rr, i) => rr - rri[i]);
    const sdnn = Math.sqrt(rri.reduce((s, rr) => s + (rr - mean) ** 2, 0) / rri.length);
    const rmssd = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
    const pnn50 = diffs.filter(d => Math.abs(d) > 0.05).length / diffs.length * 100;
    return { sdnn: +sdnn.toFixed(4), rmssd: +rmssd.toFixed(4), pnn50: +pnn50.toFixed(1), meanRR: +(mean * 1000).toFixed(1) };
  }

  // ─── Pan-Tompkins internals ──────────────────────────────────────────────
  _derivative(signal) {
    const out = new Array(signal.length).fill(0);
    const T = 1 / this.fs;
    for (let i = 2; i < signal.length - 2; i++) {
      out[i] = (-signal[i - 2] - 2 * signal[i - 1] + 2 * signal[i + 1] + signal[i + 2]) / (8 * T);
    }
    return out;
  }

  _movingWindowIntegration(signal, windowSize) {
    const out = new Array(signal.length).fill(0);
    let sum = 0;
    for (let i = 0; i < signal.length; i++) {
      sum += signal[i];
      if (i >= windowSize) sum -= signal[i - windowSize];
      out[i] = sum / windowSize;
    }
    return out;
  }

  _adaptiveThreshold(signal, integrated) {
    const refractory = Math.round(0.200 * this.fs);
    const initWindow = Math.min(2 * this.fs, integrated.length);
    let SPKI = Math.max(...integrated.slice(0, initWindow)) * 0.25;
    let NPKI = SPKI * 0.1;
    let THRESHOLD1 = NPKI + 0.25 * (SPKI - NPKI);
    let SPKF = Math.max(...signal.slice(0, initWindow)) * 0.25;
    let NPKF = SPKF * 0.1;
    let THRESHOLD2 = NPKF + 0.25 * (SPKF - NPKF);
    const candidates = this._findLocalMaxima(integrated, Math.round(0.040 * this.fs));
    const peaks = [];
    let lastPeak = -refractory;
    for (const idx of candidates) {
      if (idx - lastPeak < refractory) continue;
      const iHeight = integrated[idx];
      const sHeight = signal[idx];
      if (iHeight > THRESHOLD1 && sHeight > THRESHOLD2) {
        const halfWin = Math.round(0.015 * this.fs);
        const lo = Math.max(0, idx - halfWin);
        const hi = Math.min(signal.length - 1, idx + halfWin);
        let rIdx = lo;
        for (let k = lo; k <= hi; k++) if (signal[k] > signal[rIdx]) rIdx = k;
        peaks.push(rIdx);
        lastPeak = rIdx;
        SPKI = 0.125 * iHeight + 0.875 * SPKI;
        SPKF = 0.125 * sHeight + 0.875 * SPKF;
      } else {
        NPKI = 0.125 * iHeight + 0.875 * NPKI;
        NPKF = 0.125 * sHeight + 0.875 * NPKF;
      }
      THRESHOLD1 = NPKI + 0.25 * (SPKI - NPKI);
      THRESHOLD2 = NPKF + 0.25 * (SPKF - NPKF);
    }
    return peaks;
  }

  _findLocalMaxima(signal, minDist) {
    const maxima = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
        if (maxima.length === 0 || i - maxima[maxima.length - 1] >= minDist) maxima.push(i);
        else if (signal[i] > signal[maxima[maxima.length - 1]]) maxima[maxima.length - 1] = i;
      }
    }
    return maxima;
  }
}
