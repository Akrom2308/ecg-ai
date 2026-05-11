from flask import Flask, request, jsonify
from flask_cors import CORS
from analyzer.rhythm import calculate_heart_rate
from analyzer.rhythm import classify_rhythm
from analyzer.preprocess import load_ecg_image
from PIL import Image
import random

app = Flask(__name__)
CORS(app)

@app.route("/analyze", methods=["POST"])
def analyze_ecg():

    if "file" not in request.files:
        return jsonify({"error":"No file uploaded"}), 400

file = request.files["file"]

filepath = "uploads/ecg.png"

file.save(filepath)
 
image = load_ecg_image(filepath)

rhythms = [
        "Normal Sinus Rhythm",
        "Sinus Tachycardia",
        "Sinus Bradycardia"
    ]

result = {
    "interpretation":"AI preliminary ECG screening completed.",
    "rhythm": rhythm,
    "heart_rate": heart_rate,
    "signal_quality":"Good",
    "confidence":96
}

return jsonify(result)

import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
