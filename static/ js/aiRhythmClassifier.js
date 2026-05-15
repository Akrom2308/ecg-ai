/**
 * AI Rhythm Classification Module
 * Calls Flask /api/analyze proxy — API key stays server-side, never in browser.
 */
export const RHYTHM_CLASSES = {
  NSR:  { label: 'Normal Sinus Rhythm',               color: '#22c55e', severity: 0 },
  AFIB: { label: 'Atrial Fibrillation',               color: '#f97316', severity: 2 },
  AFL:  { label: 'Atrial Flutter',                    color: '#fb923c', severity: 2 },
  VT:   { label: 'Ventricular Tachycardia',           color: '#ef4444', severity: 3 },
  VF:   { label: 'Ventricular Fibrillation',          color: '#dc2626', severity: 4 },
  LBBB: { label: 'Left Bundle Branch Block',          color: '#a78bfa', severity: 1 },
  RBBB: { label: 'Right Bundle Branch Block',         color: '#818cf8', severity: 1 },
  PVC:  { label: 'Premature Ventricular Contractions',color: '#f59e0b', severity: 1 },
  APC:  { label: 'Atrial Premature Contractions',     color: '#fbbf24', severity: 1 },
  BRAD: { label: 'Sinus Bradycardia',                 color: '#60a5fa', severity: 1 },
  TACH: { label: 'Sinus Tachycardia',                 color: '#38bdf8', severity: 1 },
  PACE: { label: 'Paced Rhythm',                      color: '#94a3b8', severity: 0 },
  UNKN: { label: 'Unclassifiable / Artifact',         color: '#6b7280', severity: -1 },
};

export class AIRhythmClassifier {
  constructor() {
    // No API key needed — all calls go through Flask proxy at /api/analyze
    this._endpoint = '/api/analyze';
  }

  async classify(features) {
    const response = await fetch(this._endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Server error ${response.status}: ${err}`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    // Attach features to result
    return { ...data, features };
  }

  /**
   * Rule-based pre-screen — fast, no API call needed for obvious cases.
   * Returns null if uncertain → proceed to AI classification.
   */
  ruleBasedScreen(features) {
    const { meanHR, rri, sdnn, rmssd, pnn50, peakCount, duration } = features;

    if (peakCount === 0 || !rri.length)
      return makeResult('UNKN', 0.9, 'No R-peaks detected — possible artifact or flat signal', features);

    if (features.signalAmplitude < 0.1 && features.signalEntropy > 0.8)
      return makeResult('VF', 0.85, 'Very low amplitude with high entropy suggests VF', features);

    if (meanHR > 150 && sdnn < 20 && features.qrsDuration > 120)
      return makeResult('VT', 0.82, `HR ${meanHR} bpm, regular rhythm, wide QRS (${features.qrsDuration} ms)`, features);

    if (pnn50 > 40 && sdnn > 80 && meanHR > 60 && meanHR < 180)
      return makeResult('AFIB', 0.80, `Highly irregular RR intervals (pNN50=${pnn50}%, SDNN=${sdnn} ms)`, features);

    if (meanHR < 50)
      return makeResult('BRAD', 0.88, `Heart rate ${meanHR} bpm — sinus bradycardia`, features);

    if (meanHR > 100 && sdnn < 30)
      return makeResult('TACH', 0.80, `Heart rate ${meanHR} bpm — sinus tachycardia`, features);

    return null; // uncertain → use AI
  }
}

// ─── Feature Extractor ────────────────────────────────────────────────────────
export function extractFeatures(signal, peaks, fs, hrv) {
  const duration = signal.length / fs;
  const signalAmplitude = Math.max(...signal) - Math.min(...signal);

  const qrsDurations = peaks.slice(0, 10).map(r => {
    const height = signal[r];
    const threshold = height * 0.5;
    let lo = r, hi = r;
    while (lo > 0 && signal[lo] > threshold) lo--;
    while (hi < signal.length - 1 && signal[hi] > threshold) hi++;
    return ((hi - lo) / fs) * 1000;
  });
  const qrsDuration = qrsDurations.length
    ? qrsDurations.reduce((a, b) => a + b, 0) / qrsDurations.length : 100;

  const pWavePresent = peaks.slice(0, 10).filter(r => {
    const start = Math.max(0, r - Math.round(0.20 * fs));
    const end = Math.max(0, r - Math.round(0.10 * fs));
    const seg = signal.slice(start, end);
    if (!seg.length) return false;
    const baseline = signal.slice(Math.max(0, r - Math.round(0.25 * fs)), start);
    const bl = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0;
    return Math.max(...seg) - bl > 0.05;
  }).length > peaks.length * 0.3;

  const rri = hrv.rri;
  const rrMean = rri.length ? rri.reduce((a, b) => a + b, 0) / rri.length : 1;
  const rrStd = Math.sqrt(rri.reduce((s, v) => s + (v - rrMean) ** 2, 0) / Math.max(rri.length, 1));
  const regularityScore = Math.max(0, 1 - (rrStd / rrMean) * 5);

  const medRR = [...rri].sort()[Math.floor(rri.length / 2)] || 1;
  const ectopicRatio = rri.filter(r => r < 0.8 * medRR || r > 1.2 * medRR).length / Math.max(rri.length, 1);

  const bins = 32;
  const min = Math.min(...signal), max = Math.max(...signal);
  const hist = new Array(bins).fill(0);
  for (const v of signal) {
    const b = Math.min(bins - 1, Math.floor(((v - min) / (max - min + 1e-9)) * bins));
    hist[b]++;
  }
  const entropy = hist.reduce((s, c) => {
    const p = c / signal.length;
    return s - (p > 0 ? p * Math.log2(p) : 0);
  }, 0) / Math.log2(bins);

  return {
    meanHR: hrv.meanHR,
    rri: hrv.rri,
    sdnn: Math.round((hrv.sdnn || 0) * 1000),
    rmssd: Math.round((hrv.rmssd || 0) * 1000),
    pnn50: hrv.pnn50 || 0,
    meanRR: hrv.meanRR || 0,
    peakCount: peaks.length,
    duration,
    signalAmplitude,
    qrsDuration: Math.round(qrsDuration),
    pWavePresent,
    regularityScore,
    ectopicRatio,
    signalEntropy: entropy,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeResult(code, confidence, reasoning, features = null) {
  const info = RHYTHM_CLASSES[code] || RHYTHM_CLASSES.UNKN;
  return {
    rhythm: code, label: info.label, confidence, reasoning,
    findings: [],
    recommendation: info.severity >= 3 ? 'Urgent clinical evaluation required' : 'Consult cardiologist',
    urgent: info.severity >= 3,
    severity: info.severity, color: info.color, features,
  };
}
