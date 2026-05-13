import numpy as np


def calculate_heart_rate(r_peaks):

    if len(r_peaks) < 2:
        return 0

    rr_intervals = np.diff(r_peaks)

    avg_rr = np.mean(rr_intervals)

    if avg_rr == 0:
        return 0

    heart_rate = 6000 / avg_rr

    return int(heart_rate)


def classify_rhythm(hr):

    if hr == 0:
        return "Unable to detect rhythm"

    if hr < 60:
        return "Sinus Bradycardia"

    elif hr > 100:
        return "Sinus Tachycardia"

    else:
        return "Normal Sinus Rhythm"
