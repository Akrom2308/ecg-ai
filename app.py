"""
ECG Analysis Web Application — Flask Backend
Render.com deployment ready
"""

import os
import json
import math
import numpy as np
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# ─── Config ───────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
PORT = int(os.environ.get("PORT", 5000))
DEBUG = os.environ.get("FLASK_ENV", "production") != "production"

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main ECG analyzer page."""
    return render_template("index.html")


@app.route("/api/config")
def get_config():
    """Send safe config to frontend (no secrets)."""
    return jsonify({
        "hasApiKey": bool(ANTHROPIC_API_KEY),
        "sampleRate": 360,
        "version": "1.0.0",
    })


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Proxy endpoint: receives ECG features JSON from frontend,
    forwards to Anthropic Claude API, returns classification.

    This keeps the API key server-side and never exposed to the browser.
    """
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured on server"}), 500

    data = request.get_json(force=True)
    if not data or "features" not in data:
        return jsonify({"error": "Missing 'features' in request body"}), 400

    features = data["features"]

    import urllib.request
    import urllib.error

    prompt = _build_prompt(features)
    payload = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        text = "".join(b.get("text", "") for b in result.get("content", []))
        classification = _parse_classification(text, features)
        return jsonify(classification)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return jsonify({"error": f"Claude API error {e.code}: {body}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/synthetic")
def synthetic_ecg():
    """
    Generate a synthetic ECG signal for demo / testing purposes.
    Query params: duration (seconds, default 10), fs (sample rate, default 360), bpm (default 75)
    """
    duration = float(request.args.get("duration", 10))
    fs = int(request.args.get("fs", 360))
    bpm = float(request.args.get("bpm", 75))

    signal = _generate_synthetic_ecg(duration, fs, bpm)
    return jsonify({
        "signal": signal,
        "sampleRate": fs,
        "durationSeconds": duration,
        "source": "synthetic",
    })


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


# ─── Signal generation ────────────────────────────────────────────────────────

def _generate_synthetic_ecg(duration=10, fs=360, bpm=75):
    n = int(duration * fs)
    rr = (60 / bpm) * fs
    signal = []
    for i in range(n):
        phase = (i % rr) / rr
        v = 0.0
        # P wave
        if phase < 0.12:
            v += 0.15 * math.exp(-((phase - 0.06) / 0.02) ** 2)
        # QRS complex
        elif phase < 0.22:
            p = (phase - 0.16) / 0.02
            v += (-0.1 * math.exp(-p * p)
                  + 1.2 * math.exp(-((phase - 0.18) / 0.01) ** 2)
                  - 0.35 * math.exp(-((phase - 0.20) / 0.01) ** 2))
        # T wave
        elif phase < 0.45:
            v += 0.35 * math.exp(-((phase - 0.33) / 0.04) ** 2)
        # Noise
        import random
        v += (random.random() - 0.5) * 0.02
        signal.append(round(v, 4))
    return signal


# ─── Prompt builder ───────────────────────────────────────────────────────────

def _build_prompt(f):
    rri_preview = f.get("rri", [])[:20]
    rri_str = ", ".join(f"{v:.3f}" for v in rri_preview)
    if len(f.get("rri", [])) > 20:
        rri_str += ", ..."
    return f"""Analyze this ECG record and classify the cardiac rhythm.

## ECG Metrics
- Heart rate: {f.get('meanHR', 0)} bpm
- RR intervals (seconds): [{rri_str}]
- R-peak count: {f.get('peakCount', 0)} over {f.get('duration', 0):.1f} seconds
- HRV SDNN: {f.get('sdnn', 0)} ms
- HRV RMSSD: {f.get('rmssd', 0)} ms
- pNN50: {f.get('pnn50', 0)}%
- Mean RR interval: {f.get('meanRR', 0)} ms
- QRS duration estimate: {f.get('qrsDuration', 0)} ms
- Signal amplitude (peak-to-peak): {f.get('signalAmplitude', 0):.3f} mV
- P-wave detected: {'Yes' if f.get('pWavePresent') else 'No / uncertain'}
- Morphology regularity score: {f.get('regularityScore', 0):.2f} (0=irregular, 1=perfectly regular)
- Ectopic beat ratio: {f.get('ectopicRatio', 0) * 100:.1f}%

## Task
Return JSON in this exact format (no markdown, no extra text):
{{
  "rhythm": "<CODE>",
  "confidence": <0.0-1.0>,
  "reasoning": "<1-2 sentence clinical reasoning>",
  "findings": ["<finding1>", "<finding2>"],
  "recommendation": "<clinical recommendation>",
  "urgent": <true|false>
}}

Valid rhythm codes: NSR, AFIB, AFL, VT, VF, LBBB, RBBB, PVC, APC, BRAD, TACH, PACE, UNKN"""


RHYTHM_CLASSES = {
    "NSR":  {"label": "Normal Sinus Rhythm",               "color": "#22c55e", "severity": 0},
    "AFIB": {"label": "Atrial Fibrillation",               "color": "#f97316", "severity": 2},
    "AFL":  {"label": "Atrial Flutter",                    "color": "#fb923c", "severity": 2},
    "VT":   {"label": "Ventricular Tachycardia",           "color": "#ef4444", "severity": 3},
    "VF":   {"label": "Ventricular Fibrillation",          "color": "#dc2626", "severity": 4},
    "LBBB": {"label": "Left Bundle Branch Block",          "color": "#a78bfa", "severity": 1},
    "RBBB": {"label": "Right Bundle Branch Block",         "color": "#818cf8", "severity": 1},
    "PVC":  {"label": "Premature Ventricular Contractions","color": "#f59e0b", "severity": 1},
    "APC":  {"label": "Atrial Premature Contractions",     "color": "#fbbf24", "severity": 1},
    "BRAD": {"label": "Sinus Bradycardia",                 "color": "#60a5fa", "severity": 1},
    "TACH": {"label": "Sinus Tachycardia",                 "color": "#38bdf8", "severity": 1},
    "PACE": {"label": "Paced Rhythm",                      "color": "#94a3b8", "severity": 0},
    "UNKN": {"label": "Unclassifiable / Artifact",         "color": "#6b7280", "severity": -1},
}


def _parse_classification(text, features):
    import re
    try:
        clean = re.sub(r"```json|```", "", text).strip()
        obj = json.loads(clean)
        code = obj.get("rhythm", "UNKN")
        if code not in RHYTHM_CLASSES:
            code = "UNKN"
        info = RHYTHM_CLASSES[code]
        return {
            "rhythm": code,
            "label": info["label"],
            "confidence": max(0.0, min(1.0, float(obj.get("confidence", 0.5)))),
            "reasoning": obj.get("reasoning", ""),
            "findings": obj.get("findings", []),
            "recommendation": obj.get("recommendation", ""),
            "urgent": obj.get("urgent", info["severity"] >= 3),
            "severity": info["severity"],
            "color": info["color"],
        }
    except Exception:
        match = re.search(r'"rhythm"\s*:\s*"([A-Z]+)"', text)
        code = match.group(1) if match and match.group(1) in RHYTHM_CLASSES else "UNKN"
        info = RHYTHM_CLASSES[code]
        return {
            "rhythm": code,
            "label": info["label"],
            "confidence": 0.5,
            "reasoning": text[:200],
            "findings": [],
            "recommendation": "Consult cardiologist",
            "urgent": info["severity"] >= 3,
            "severity": info["severity"],
            "color": info["color"],
        }


SYSTEM_PROMPT = (
    "You are an expert cardiologist and ECG interpretation AI. "
    "Analyze ECG metrics and classify the cardiac rhythm precisely. "
    "Base your classification on clinical criteria (e.g., AHA/ACC guidelines). "
    "Always return valid JSON only — no markdown, no preamble. "
    "When uncertain, prefer broader safe categories (e.g., NSR over UNKN) "
    "and reflect uncertainty in the confidence score. "
    "Remember: your output may support clinical decision-making — be accurate and conservative."
)

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)
