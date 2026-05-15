/**
 * ECG File Upload & Parser Module
 * Supports: CSV, TXT, EDF (simplified), MIT-BIH binary (.dat + .hea), JSON
 */
export class ECGUploader {
  static async parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv' || ext === 'txt') return ECGUploader._parseCSV(file);
    if (ext === 'dat') throw new Error('For MIT-BIH .dat files, also upload the .hea header file and use parseMITBIH()');
    if (ext === 'edf') return ECGUploader._parseEDF(file);
    if (ext === 'json') return ECGUploader._parseJSON(file);
    return ECGUploader._parseCSV(file); // fallback
  }

  static async parseMITBIH(datFile, heaFile) {
    const header = await ECGUploader._readText(heaFile);
    const meta = ECGUploader._parseMITHeader(header);
    const buffer = await datFile.arrayBuffer();
    const signal = ECGUploader._decodeMITBinary(buffer, meta);
    return {
      signal,
      sampleRate: meta.sampleRate,
      channelCount: meta.numChannels,
      durationSeconds: signal.length / meta.sampleRate,
      source: datFile.name,
      meta,
    };
  }

  // ─── Parsers ─────────────────────────────────────────────────────────────
  static async _parseCSV(file) {
    const text = await ECGUploader._readText(file);
    const lines = text.trim().split('\n');
    const delimiters = [',', '\t', ';', ' '];
    const header = lines[0];
    const delim = delimiters.find(d => header.includes(d)) || ',';
    const firstCells = lines[0].split(delim);
    const hasHeader = isNaN(parseFloat(firstCells[0].trim()));
    const dataLines = hasHeader ? lines.slice(1) : lines;

    let ecgCol = 0;
    if (hasHeader) {
      const headers = firstCells.map(h => h.trim().toLowerCase());
      const ecgIdx = headers.findIndex(h =>
        ['ecg', 'signal', 'mlii', 'lead', 'val', 'value', 'amplitude'].some(k => h.includes(k))
      );
      if (ecgIdx !== -1) ecgCol = ecgIdx;
    }

    const signal = dataLines
      .map(l => parseFloat(l.split(delim)[ecgCol]))
      .filter(v => !isNaN(v));
    const sampleRate = ECGUploader._detectSampleRate(text) || 360;
    return { signal, sampleRate, channelCount: 1, durationSeconds: signal.length / sampleRate, source: file.name };
  }

  static async _parseEDF(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder('ascii');
    const globalHeader = decoder.decode(bytes.slice(0, 256));
    const numSignals = parseInt(globalHeader.slice(236, 244).trim());
    const headerBytes = parseInt(globalHeader.slice(184, 192).trim());
    const numRecords = parseInt(globalHeader.slice(236 - 52, 236 - 44).trim()) || 1;
    const fs = parseInt(globalHeader.slice(252 - 8, 252).trim()) || 256;
    const sigHeader = decoder.decode(bytes.slice(256, headerBytes));
    const samplesPerRecord = [];
    for (let i = 0; i < numSignals; i++) {
      const val = parseInt(sigHeader.slice(i * 8, i * 8 + 8).trim());
      samplesPerRecord.push(isNaN(val) ? fs : val);
    }
    const data = new Int16Array(buffer, headerBytes);
    const signal = Array.from(data.slice(0, samplesPerRecord[0] * numRecords)).map(v => v * 0.001);
    return { signal, sampleRate: fs, channelCount: numSignals, durationSeconds: signal.length / fs, source: file.name };
  }

  static async _parseJSON(file) {
    const text = await ECGUploader._readText(file);
    const obj = JSON.parse(text);
    const signal = obj.signal || obj.ecg || obj.data || obj.samples || (Array.isArray(obj) ? obj : null);
    if (!signal) throw new Error('Unsupported JSON schema: expected { signal: [...] } or raw array');
    const sampleRate = obj.sampleRate || obj.fs || obj.sample_rate || 360;
    return { signal: signal.map(Number), sampleRate, channelCount: 1, durationSeconds: signal.length / sampleRate, source: file.name };
  }

  // ─── MIT-BIH binary decoder ──────────────────────────────────────────────
  static _parseMITHeader(text) {
    const lines = text.trim().split('\n').filter(l => !l.startsWith('#'));
    const [recordName, numChannels, sampleRate, numSamples] = lines[0].trim().split(/\s+/);
    const signalInfos = lines.slice(1, 1 + parseInt(numChannels)).map(l => {
      const parts = l.trim().split(/\s+/);
      return { filename: parts[0], format: parseInt(parts[1]) || 212, gain: parseFloat(parts[2]) || 200, bitRes: parseInt(parts[3]) || 11, zeroValue: parseInt(parts[4]) || 1024 };
    });
    return { recordName, numChannels: parseInt(numChannels), sampleRate: parseInt(sampleRate), numSamples: parseInt(numSamples), signalInfos };
  }

  static _decodeMITBinary(buffer, meta) {
    const bytes = new Uint8Array(buffer);
    const format = meta.signalInfos[0]?.format || 212;
    const gain = meta.signalInfos[0]?.gain || 200;
    const zero = meta.signalInfos[0]?.zeroValue || 1024;
    const signal = [];
    if (format === 212) {
      for (let i = 0; i + 2 < bytes.length; i += 3) {
        let s1 = bytes[i] | ((bytes[i + 1] & 0x0F) << 8);
        let s2 = bytes[i + 2] | ((bytes[i + 1] & 0xF0) << 4);
        if (s1 >= 2048) s1 -= 4096;
        if (s2 >= 2048) s2 -= 4096;
        signal.push((s1 - zero) / gain);
        signal.push((s2 - zero) / gain);
      }
    } else if (format === 16) {
      const view = new DataView(buffer);
      for (let i = 0; i < buffer.byteLength - 1; i += 2) {
        const raw = view.getInt16(i, true);
        signal.push((raw - zero) / gain);
      }
    } else {
      throw new Error(`Unsupported MIT-BIH format: ${format}`);
    }
    return signal;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  static _readText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = () => reject(new Error('Failed to read file'));
      r.readAsText(file);
    });
  }

  static _detectSampleRate(text) {
    const patterns = [/(?:fs|sample.?rate|sr)\s*[=:]\s*(\d+)/i, /#\s*(?:fs|sample.?rate)\s+(\d+)/i, /(\d+)\s*Hz/i];
    for (const re of patterns) { const m = text.match(re); if (m) return parseInt(m[1]); }
    return null;
  }
}
