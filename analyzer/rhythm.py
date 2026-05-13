def calculate_heart_rate(r_peaks):

    if len(r_peaks) < 2:
        return 0

    rr_intervals = []

    for i in range(1, len(r_peaks)):

        rr = r_peaks[i] - r_peaks[i - 1]

        rr_intervals.append(rr)

    avg_rr = sum(rr_intervals) / len(rr_intervals)

    heart_rate = 6000 / avg_rr

    return int(heart_rate)


def classify_rhythm(hr):

    if hr < 60:
        return "Sinus Bradycardia"

    elif hr > 100:
        return "Sinus Tachycardia"

    else:
        return "Normal Sinus Rhythm"
