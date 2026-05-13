import cv2
import numpy as np


# ==========================================
# ECG IMAGE PREPROCESSING
# ==========================================

def load_ecg_image(path):

    # =========================
    # LOAD IMAGE
    # =========================

    image = cv2.imread(path)

    if image is None:
        raise ValueError("Image could not be loaded")

    # =========================
    # RESIZE
    # =========================

    image = cv2.resize(
        image,
        (1400, 700)
    )

    # =========================
    # GRAYSCALE
    # =========================

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # =========================
    # CONTRAST ENHANCEMENT
    # =========================

    clahe = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(8, 8)
    )

    enhanced = clahe.apply(gray)

    # =========================
    # NOISE REDUCTION
    # =========================

    blur = cv2.GaussianBlur(
        enhanced,
        (5, 5),
        0
    )

    # =========================
    # EDGE PRESERVING FILTER
    # =========================

    filtered = cv2.bilateralFilter(
        blur,
        9,
        75,
        75
    )

    # =========================
    # ECG WAVE EXTRACTION
    # =========================

    thresh = cv2.adaptiveThreshold(
        filtered,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        15,
        3
    )

    # =========================
    # REMOVE SMALL NOISE
    # =========================

    kernel = np.ones((2, 2), np.uint8)

    cleaned = cv2.morphologyEx(
        thresh,
        cv2.MORPH_OPEN,
        kernel
    )

    # =========================
    # DILATE ECG LINES
    # =========================

    cleaned = cv2.dilate(
        cleaned,
        kernel,
        iterations=1
    )

    # =========================
    # EXTRACT 1D ECG SIGNAL
    # =========================

    signal = np.mean(
        cleaned,
        axis=0
    )

    # =========================
    # NORMALIZE SIGNAL
    # =========================

    signal = signal.astype(np.float32)

    signal = signal - np.mean(signal)

    max_value = np.max(np.abs(signal))

    if max_value != 0:
        signal = signal / max_value

    # =========================
    # SMOOTH SIGNAL
    # =========================

    signal = cv2.GaussianBlur(
        signal.reshape(1, -1),
        (1, 9),
        0
    ).flatten()

    return signal


# ==========================================
# ECG VALIDATION
# ==========================================

def validate_ecg_image(path):

    image = cv2.imread(path)

    if image is None:
        return False, "Image could not be loaded"

    # resize
    image = cv2.resize(image, (1200, 600))

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # blur
    blur = cv2.GaussianBlur(
        gray,
        (5, 5),
        0
    )

    # threshold
    thresh = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        11,
        2
    )

    # find contours
    contours, _ = cv2.findContours(
        thresh,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    waveform_count = 0

    for contour in contours:

        area = cv2.contourArea(contour)

        if area < 80:
            continue

        x, y, w, h = cv2.boundingRect(contour)

        ratio = w / float(h)

        # ECG waveform properties
        if (
            w > 40 and
            h > 8 and
            ratio > 2
        ):

            waveform_count += 1

    # ECG usually contains many waveform segments
    if waveform_count < 15:

        return False, "No valid ECG waveform detected"

    # edge density
    edges = cv2.Canny(
        gray,
        50,
        150
    )

    edge_pixels = np.sum(edges > 0)

    if edge_pixels < 12000:

        return False, "Invalid ECG structure"

    return True, "Valid ECG image"


    # =========================
    # RESOLUTION CHECK
    # =========================

    if width < 400 or height < 250:

        return False, "Image resolution too low"

    # =========================
    # CONTRAST CHECK
    # =========================

    contrast = gray.std()

    if contrast < 18:

        return False, "Low contrast image"

    # =========================
    # EDGE DETECTION
    # =========================

    edges = cv2.Canny(
        gray,
        50,
        150
    )

    edge_pixels = np.sum(edges > 0)

    if edge_pixels < 7000:

        return False, "No ECG waveform detected"

    # =========================
    # HORIZONTAL ECG STRUCTURE
    # =========================

    horizontal_projection = np.sum(
        edges,
        axis=1
    )

    waveform_lines = np.sum(
        horizontal_projection >
        np.mean(horizontal_projection) * 1.5
    )

    if waveform_lines < 8:

        return False, "ECG waveform structure not detected"

    # =========================
    # VERTICAL GRID STRUCTURE
    # =========================

    vertical_projection = np.sum(
        edges,
        axis=0
    )

    vertical_patterns = np.sum(
        vertical_projection >
        np.mean(vertical_projection) * 1.3
    )

    if vertical_patterns < 15:

        return False, "ECG grid pattern missing"

    # =========================
    # BACKGROUND CHECK
    # =========================

    white_pixels = np.sum(gray > 180)

    total_pixels = gray.size

    white_ratio = white_pixels / total_pixels

    if white_ratio < 0.35:

        return False, "Invalid ECG background"

    return True, "Valid ECG image"
