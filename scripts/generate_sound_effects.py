"""Generate original, deterministic editor sound effects using synthesis."""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 44100
DEST = Path(__file__).resolve().parents[1] / 'static' / 'sounds'
DEST.mkdir(parents=True, exist_ok=True)
rng = random.Random(1879)

def tone(t, freq, decay):
    return math.sin(2 * math.pi * freq * t) * math.exp(-decay * t)

def chime(t, notes):
    result = 0
    for start, freq in notes:
        x = t - start
        if x >= 0:
            result += (tone(x, freq, 5) + .18 * tone(x, freq * 2, 8)) * min(1, x / .006)
    return result * .4

durations = {'whoosh': .65, 'pop': .22, 'notification': .9, 'success': 1.1,
             'impact': .65, 'click': .09, 'sparkle': 1.3, 'error': .55}
for name, duration in durations.items():
    samples = []
    filtered = 0
    for i in range(int(duration * RATE)):
        t = i / RATE
        noise = rng.uniform(-1, 1)
        filtered = .85 * filtered + .15 * noise
        if name == 'whoosh':
            v = (noise - filtered) * math.sin(math.pi * t / duration) ** 2 * .5
        elif name == 'pop':
            v = math.sin(2 * math.pi * (650 * t - 1000 * t * t)) * math.exp(-28 * t) * .65
        elif name == 'notification':
            v = chime(t, [(0, 880), (.12, 1174.66)])
        elif name == 'success':
            v = chime(t, [(0, 523.25), (.13, 659.25), (.26, 783.99), (.39, 1046.5)])
        elif name == 'impact':
            v = .65 * tone(t, 65, 9) + .35 * noise * math.exp(-30 * t)
        elif name == 'click':
            v = .5 * noise * math.exp(-100 * t) + .2 * tone(t, 1800, 130)
        elif name == 'sparkle':
            v = chime(t, [(j * .09, f) for j, f in enumerate([1046.5, 1318.5, 1568, 2093, 2637])])
        else:
            v = chime(t, [(0, 330), (.18, 246.94)])
        # Short edge fades prevent clicks and keep ample mixing headroom.
        v *= min(1, t / .003, (duration - t) / .015)
        samples.append(max(-.9, min(.9, v)))
    with wave.open(str(DEST / (name + '.wav')), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b''.join(struct.pack('<h', int(v * 32767)) for v in samples))
