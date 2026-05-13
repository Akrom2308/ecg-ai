import numpy as np
from scipy.signal import find_peaks

def detect_r_peaks(signal):

    peaks, _ = find_peaks(signal, distance=20)

    return peaks
