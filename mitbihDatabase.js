/**
 * MIT-BIH Arrhythmia Database Integration Module
 * Uses PhysioNet's WFDB REST API
 */
const PHYSIONET_API = 'https://physionet.org/rest/1';
const DB = 'mitdb';

export const MIT_BIH_RECORDS = [
  '100','101','102','103','104','105','106','107',
  '108','109','111','112','113','114','115','116',
  '117','118','119','121','122','123','124','200',
  '201','202','203','205','207','208','209','210',
  '212','213','214','215','217','219','220','221',
  '222','223','228','230','231','232','233','234',
];

export const BEAT_LABELS = {
  N:'Normal beat', L:'Left bundle branch block', R:'Right bundle branch block',
  A:'Atrial premature beat', a:'Aberrated atrial premature beat',
  J:'Nodal (junctional) premature beat', S:'Supraventricular premature beat',
  V:'Premature ventricular contraction', F:'Fusion of ventricular and normal beat',
  '[':'Start of ventricular flutter/fibrillation', '!':'Ventricular flutter wave',
  ']':'End of ventricular flutter/fibrillation', e:'Atrial escape beat',
  j:'Nodal (junctional) escape beat', E:'Ventricular escape beat',
  '/':'Paced beat', f:'Fusion of paced and normal beat',
  x:'Non-conducted P-wave (blocked APC)', Q:'Unclassifiable beat', '|':'Isolated QRS-like artifact',
};

export class MITBIHDatabase {
  static async fetchSignal(record, opts = {}) {
    const { start = 0, duration = 10, channel = 0 } = opts;
    validateRecord(record);
    const sampFrom = Math.round(start * 360);
    const sampTo = Math.round((start + duration) * 360);
    const url = `${PHYSIONET_API}/signal?db=${DB}&record=${record}&signal=${channel}&sampfrom=${sampFrom}&sampto=${sampTo}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`PhysioNet API error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return {
      signal: json.signal || json.data || [],
      sampleRate: json.fs || 360,
      record,
      channel: json.sig_name || (channel === 0 ? 'MLII' : 'V5'),
      units: json.units || 'mV',
    };
  }

  static async fetchAnnotations(record, opts = {}) {
    const { start = 0, duration = 10 } = opts;
    validateRecord(record);
    const sampFrom = Math.round(start * 360);
    const sampTo = Math.round((start + duration) * 360);
    const url = `${PHYSIONET_API}/annotations?db=${DB}&record=${record}&annotator=atr&sampfrom=${sampFrom}&sampto=${sampTo}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`PhysioNet API error ${res.status}`);
    const json = await res.json();
    return (json.annotation || json.annotations || []).map(a => ({
      sample: a.sample || a.t,
      time: (a.sample || a.t) / 360,
      label: a.symbol || a.type || 'N',
      description: BEAT_LABELS[a.symbol || a.type] || 'Unknown',
    }));
  }

  static async fetchRecordInfo(record) {
    validateRecord(record);
    const url = `${PHYSIONET_API}/info?db=${DB}&record=${record}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`PhysioNet API error ${res.status}`);
    const json = await res.json();
    return {
      record,
      sampleRate: json.fs || 360,
      numChannels: json.n_sig || 2,
      channels: json.sig_name || ['MLII', 'V5'],
      durationSeconds: json.sig_len ? json.sig_len / (json.fs || 360) : 1800,
      age: json.age, sex: json.sex, diagnosis: json.comments || '',
    };
  }

  static async loadWindow(record, startSec = 0) {
    const [{ signal, sampleRate, channel }, annotations] = await Promise.all([
      MITBIHDatabase.fetchSignal(record, { start: startSec, duration: 10 }),
      MITBIHDatabase.fetchAnnotations(record, { start: startSec, duration: 10 }),
    ]);
    return { record, startSec, signal, sampleRate, channel, annotations, duration: 10 };
  }

  static getRecordList() {
    return MIT_BIH_RECORDS.map(id => ({ id, label: `Record ${id}`, description: RECORD_DESCRIPTIONS[id] || '' }));
  }

  static generateSyntheticECG(duration = 10, fs = 360) {
    const n = duration * fs;
    const signal = [];
    const bpm = 75;
    const rr = (60 / bpm) * fs;
    for (let i = 0; i < n; i++) {
      const phase = (i % rr) / rr;
      let v = 0;
      if (phase < 0.12) v += 0.15 * Math.exp(-Math.pow((phase - 0.06) / 0.02, 2));
      else if (phase < 0.22) {
        const p = (phase - 0.16) / 0.02;
        v += -0.1 * Math.exp(-p * p)
          + 1.2 * Math.exp(-Math.pow((phase - 0.18) / 0.01, 2))
          - 0.35 * Math.exp(-Math.pow((phase - 0.20) / 0.01, 2));
      } else if (phase < 0.45) v += 0.35 * Math.exp(-Math.pow((phase - 0.33) / 0.04, 2));
      v += (Math.random() - 0.5) * 0.02;
      signal.push(+v.toFixed(4));
    }
    return { signal, sampleRate: fs, record: 'synthetic' };
  }
}

function validateRecord(record) {
  if (!MIT_BIH_RECORDS.includes(String(record)))
    throw new Error(`Unknown MIT-BIH record: "${record}". Valid: ${MIT_BIH_RECORDS.join(', ')}`);
}

const RECORD_DESCRIPTIONS = {
  '100':'Normal sinus rhythm','101':'Normal + isolated PVCs','102':'Paced rhythm',
  '104':'Paced rhythm + RBBB','105':'PVC bigeminy','107':'Paced rhythm','108':'ST changes',
  '109':'LBBB','111':'RBBB','114':'PVC couplets','116':'Atrial flutter','119':'PVC bigeminy',
  '200':'Multifocal PVCs','201':'Atrial fibrillation','202':'Atrial flutter','203':'VF episode',
  '205':'PVC run (VT)','207':'Ventricular flutter/fibrillation','208':'Multifocal PVCs',
  '209':'APCs','210':'PVCs + ST changes','212':'Normal','213':'PVC bigeminy','214':'LBBB',
  '215':'Normal + PVCs','217':'Paced + PVCs','219':'PVCs + fusion','220':'Normal',
  '221':'Sustained VT','222':'APCs + AV block','223':'PVC runs','228':'WPW syndrome',
  '230':'Normal','231':'RBBB','232':'Junctional rhythm','233':'Bigeminal PVCs','234':'Normal',
};
