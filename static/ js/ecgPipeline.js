/**
 * ECG Analysis Pipeline — Main Orchestrator
 * Upload → Filter → R-peak Detection → MIT-BIH → AI Classification
 */
import { ECGUploader } from './ecgUploader.js';
import { ECGSignalFilter } from './signalFilter.js';
import { RPeakDetector } from './rPeakDetector.js';
import { MITBIHDatabase } from './mitbihDatabase.js';
import { AIRhythmClassifier, extractFeatures } from './aiRhythmClassifier.js';

export class ECGPipeline {
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 360;
    this.filter = new ECGSignalFilter(this.sampleRate);
    this.detector = new RPeakDetector(this.sampleRate);
    this.classifier = new AIRhythmClassifier();
    this.notchFreq = opts.notchFreq || 50;
  }

  async analyzeFile(file, heaFile = null) {
    let ecgData;
    if (file.name.endsWith('.dat') && heaFile) {
      ecgData = await ECGUploader.parseMITBIH(file, heaFile);
    } else {
      ecgData = await ECGUploader.parseFile(file);
    }
    this.sampleRate = ecgData.sampleRate;
    this.filter = new ECGSignalFilter(this.sampleRate);
    this.detector = new RPeakDetector(this.sampleRate);
    return this._runPipeline(ecgData.signal, ecgData);
  }

  async analyzeMITBIHRecord(recordId, startSec = 0) {
    const window = await MITBIHDatabase.loadWindow(recordId, startSec);
    const meta = {
      source: `MIT-BIH Record ${recordId}`,
      sampleRate: window.sampleRate,
      mitbihAnnotations: window.annotations,
    };
    return this._runPipeline(window.signal, meta);
  }

  async analyzeSignal(rawSignal, fs) {
    if (fs) {
      this.sampleRate = fs;
      this.filter = new ECGSignalFilter(fs);
      this.detector = new RPeakDetector(fs);
    }
    return this._runPipeline(rawSignal, { source: 'raw', sampleRate: this.sampleRate });
  }

  async _runPipeline(rawSignal, meta = {}) {
    const t0 = performance.now();

    const filtered = this.filter.fullPipeline(rawSignal, { notchFreq: this.notchFreq });
    const { peaks, heartRates, meanHR, rri } = this.detector.detect(filtered);
    const { qrs } = this.detector.delineateQRS(filtered, peaks);
    const hrv = this.detector.computeHRV(rri);

    const features = extractFeatures(filtered, peaks, this.sampleRate, {
      ...hrv, meanHR, rri,
    });

    let classification = this.classifier.ruleBasedScreen(features);
    if (!classification) {
      classification = await this.classifier.classify(features);
    }

    return {
      rawSignal, meta,
      filteredSignal: filtered,
      sampleRate: this.sampleRate,
      peaks, qrs, rri, heartRates, meanHR,
      hrv, classification,
      signalQuality: this._assessSignalQuality(rawSignal, filtered, peaks),
      processingMs: Math.round(performance.now() - t0),
    };
  }

  _assessSignalQuality(raw, filtered, peaks) {
    const fs = this.sampleRate;
    const duration = raw.length / fs;
    const peakDensity = peaks.length / duration;

    const qrsEnergy = peaks.reduce((s, r) => {
      const w = Math.round(0.05 * fs);
      const seg = filtered.slice(Math.max(0, r - w), r + w);
      return s + seg.reduce((a, v) => a + v * v, 0);
    }, 0);
    const totalEnergy = filtered.reduce((s, v) => s + v * v, 0);
    const snr = totalEnergy > 0 ? qrsEnergy / totalEnergy : 0;

    let score = 100;
    if (peakDensity < 0.5) score -= 30;
    if (snr < 0.1) score -= 20;
    if (peaks.length < 3) score -= 30;

    return {
      score: Math.max(0, score),
      label: score >= 80 ? 'Good' : score >= 50 ? 'Acceptable' : 'Poor',
      peakDensity: +peakDensity.toFixed(2),
      snrEstimate: +snr.toFixed(3),
    };
  }
}

export { ECGUploader } from './ecgUploader.js';
export { ECGSignalFilter } from './signalFilter.js';
export { RPeakDetector } from './rPeakDetector.js';
export { MITBIHDatabase, MIT_BIH_RECORDS } from './mitbihDatabase.js';
export { AIRhythmClassifier, extractFeatures, RHYTHM_CLASSES } from './aiRhythmClassifier.js';
