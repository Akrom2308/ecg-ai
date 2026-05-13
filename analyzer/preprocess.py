import cv2
import numpy as np


def load_ecg_image(path):

    image = cv2.imread(path)

    if image is None:
        return None

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    blur = cv2.GaussianBlur(
        gray,
        (5, 5),
        0
    )

    edges = cv2.Canny(
        blur,
        50,
        150
    )

    _, thresh = cv2.threshold(
        edges,
        50,
        255,
        cv2.THRESH_BINARY
    )

    signal = np.mean(
        thresh,
        axis=0
    )

    signal = signal.astype(np.float32)

    return signal


def validate_ecg(signal):

    if signal is None:
        return False

    variance = np.var(signal)

    peak_value = np.max(signal)

    if variance < 5:
        return False

    if peak_value < 20:
        return False

    return True
