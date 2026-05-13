import numpy as np
from scipy.signal import find_peaks
from scipy.ndimage import gaussian_filter1d

def detect_r_peaks(signal):

    # smooth signal
    signal = gaussian_filter1d(signal, sigma=2)

    # normalize
    signal = signal - np.mean(signal)

    # dynamic threshold
    threshold = np.max(signal) * 0.45

    # detect peaks
    peaks, properties = find_peaks(
        signal,
        distance=40,
        height=threshold,
        prominence=np.max(signal) * 0.2
    )

    # remove false peaks
    filtered_peaks = []

    for peak in peaks:

        if signal[peak] > threshold:
            filtered_peaks.append(peak)

    return np.array(filtered_peaks)
