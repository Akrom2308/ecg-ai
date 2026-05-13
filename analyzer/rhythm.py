def classify_rhythm(hr):

    if hr < 60:
        return "Sinus Bradycardia"

    elif hr > 100:
        return "Sinus Tachycardia"

    else:
        return "Normal Sinus Rhythm"
