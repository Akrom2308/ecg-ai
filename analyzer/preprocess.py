import cv2
import numpy as np

def validate_ecg_image(path):

    image = cv2.imread(path)

    if image is None:
        return False, "Image could not be loaded"

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    height, width = gray.shape

    # too small image
    if width < 300 or height < 300:
        return False, "Image resolution too low"

    # contrast check
    contrast = gray.std()

    # edge density
    edges = cv2.Canny(gray, 50, 150)
    edge_pixels = np.sum(edges > 0)

    # ECG-like structure detection
    if contrast < 20:
        return False, "Low contrast image"

    if edge_pixels < 5000:
        return False, "No ECG waveform detected"

    return True, "Valid ECG image"


def load_ecg_image(path):

    image = cv2.imread(path)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    blur = cv2.GaussianBlur(gray, (5,5), 0)

    _, thresh = cv2.threshold(
        blur,
        120,
        255,
        cv2.THRESH_BINARY_INV
    )

    signal = np.mean(thresh, axis=0)

    return signal
