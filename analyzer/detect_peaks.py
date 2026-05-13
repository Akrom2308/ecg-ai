from scipy.signal import find_peaks
import numpy as np


def detect_r_peaks(signal):

    if signal is None:
        return []

    normalized = (
        signal - np.min(signal)
    ) / (
        np.max(signal) - np.min(signal) + 1e-6
    )

    peaks, _ = find_peaks(
        normalized,
        distance=25,
        prominence=0.3
    )

    return peaks.tolist()
