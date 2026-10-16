"""Generate Closeby's original two-tone emergency ring (no external recordings)."""
import math
from pathlib import Path
import struct
import wave

RATE = 22050
target = Path(__file__).resolve().parent.parent / "assets/sounds/emergency-ring.wav"
target.parent.mkdir(parents=True, exist_ok=True)
samples = []
for index in range(RATE * 2):
    time = index / RATE
    position = time % 1
    tone = position < 0.22 or 0.34 <= position < 0.56
    start = 0 if position < 0.22 else 0.34
    age = position - start
    envelope = min(1, max(0, age / 0.012), max(0, (0.22 - age) / 0.025)) if tone else 0
    value = 0.32 * envelope * (math.sin(2 * math.pi * 880 * time) + 0.5 * math.sin(2 * math.pi * 1174 * time))
    samples.append(struct.pack("<h", round(32767 * value)))
with wave.open(str(target), "wb") as sound:
    sound.setnchannels(1)
    sound.setsampwidth(2)
    sound.setframerate(RATE)
    sound.writeframes(b"".join(samples))
print(f"Generated {target.name}: 2 seconds, mono PCM")
for name, repeats in [("closeby_alert.wav", 5), ("closeby_call.wav", 4)]:
    with wave.open(str(target.with_name(name)), "wb") as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(RATE)
        sound.writeframes(b"".join(samples) * repeats)
    print(f"Generated {name}: {repeats * 2} seconds, notification PCM")
