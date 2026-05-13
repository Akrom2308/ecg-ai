from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import cv2
import numpy as np

from analyzer.preprocess import (
    load_ecg_image
)

from analyzer.detect_peaks import (
    detect_r_peaks
)

from analyzer.rhythm import (
    calculate_heart_rate,
    classify_rhythm
)

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = "uploads"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# =========================
# ECG VALIDATION
# =========================

def validate_ecg_image(path):

    image = cv2.imread(path)

    if image is None:

        return False, "Image could not be loaded"

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    height, width = gray.shape

    # resolution check
    if width < 300 or height < 300:

        return False, "Image resolution too low"

    # contrast check
    contrast = gray.std()

    # edge detection
    edges = cv2.Canny(
        gray,
        50,
        150
    )

    edge_pixels = np.sum(edges > 0)

    # ECG structure validation
    if contrast < 20:

        return False, "Low contrast image"

    if edge_pixels < 5000:

        return False, "No ECG waveform detected"

    return True, "Valid ECG image"


# =========================
# HOME ROUTE
# =========================

@app.route("/")
def home():

    return jsonify({
        "status": "running",
        "message": "ECG AI Backend Running"
    })


# =========================
# ANALYZE ROUTE
# =========================

@app.route("/analyze", methods=["POST"])
def analyze_ecg():

    # file exists?
    if "file" not in request.files:

        return jsonify({
            "success": False,
            "error": "No file uploaded"
        }), 400

    file = request.files["file"]

    # filename empty?
    if file.filename == "":

        return jsonify({
            "success": False,
            "error": "Empty filename"
        }), 400

    # save uploaded file
    filepath = os.path.join(
        UPLOAD_FOLDER,
        "ecg.png"
    )

    file.save(filepath)

    # =========================
    # ECG VALIDATION
    # =========================

    valid, validation_message = validate_ecg_image(filepath)

    if not valid:

        return jsonify({
            "success": False,
            "error": validation_message
        }), 400

    # =========================
    # SIGNAL PROCESSING
    # =========================

    signal = load_ecg_image(filepath)

    r_peaks = detect_r_peaks(signal)

    heart_rate = calculate_heart_rate(r_peaks)

    rhythm = classify_rhythm(heart_rate)

    # =========================
    # SIGNAL QUALITY
    # =========================

    signal_quality = "Good"

    if len(r_peaks) < 5:

        signal_quality = "Poor"

    elif len(r_peaks) < 9:

        signal_quality = "Moderate"

    # =========================
    # AI CONFIDENCE
    # =========================

    confidence = min(
        99,
        max(
            70,
            85 + len(r_peaks) // 2
        )
    )

    # =========================
    # INTERPRETATION
    # =========================

    interpretation = (
        "AI preliminary ECG screening completed. "
        "This result is not a final medical diagnosis."
    )

    # =========================
    # RESPONSE
    # =========================

    result = {

        "success": True,

        "interpretation": interpretation,

        "rhythm": rhythm,

        "heart_rate": heart_rate,

        "detected_r_peaks": len(r_peaks),

        "signal_quality": signal_quality,

        "confidence": confidence
    }

    return jsonify(result)


# =========================
# START SERVER
# =========================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    app.run(
        host="0.0.0.0",
        port=port
    )
