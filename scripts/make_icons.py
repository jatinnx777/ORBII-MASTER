"""Generate ORBII app icons from the mascot art.

Outputs (warm greige brand, soft shadow):
  assets/icon.png          1024 full-bleed (iOS / store)
  assets/adaptive-icon.png 1024 transparent foreground (Android adaptive)
  assets/splash.png        1024 transparent (mascot waving) for the splash
  assets/favicon.png       48 web favicon
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(HERE, "assets")
GREIGE = (240, 230, 214, 255)  # #F0E6D6 warm canvas


def load(name):
    return Image.open(os.path.join(ASSETS, "mascot", name)).convert("RGBA")


def compose(size, mascot, frac, transparent, ground=True):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent else GREIGE)

    # soft warm radial lift on solid backgrounds
    if not transparent:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        r = int(size * 0.42)
        cx, cy = size // 2, int(size * 0.44)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 248, 235, 110))
        glow = glow.filter(ImageFilter.GaussianBlur(size * 0.08))
        canvas = Image.alpha_composite(canvas, glow)

    mh = int(size * frac)
    ratio = mh / mascot.height
    mw = int(mascot.width * ratio)
    m = mascot.resize((mw, mh), Image.LANCZOS)
    x = (size - mw) // 2
    y = (size - mh) // 2

    if ground:
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        ew, eh = int(mw * 0.66), int(mh * 0.12)
        ex = (size - ew) // 2
        ey = y + mh - int(eh * 0.7)
        sd.ellipse([ex, ey, ex + ew, ey + eh], fill=(120, 92, 54, 95))
        shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.022))
        canvas = Image.alpha_composite(canvas, shadow)

    canvas.alpha_composite(m, (x, y))
    return canvas


def main():
    neutral = load("neutral.png")
    wave = load("wave.png")

    compose(1024, neutral, 0.64, transparent=False).save(os.path.join(ASSETS, "icon.png"))
    compose(1024, neutral, 0.60, transparent=True).save(os.path.join(ASSETS, "adaptive-icon.png"))
    compose(1024, wave, 0.66, transparent=True, ground=False).save(os.path.join(ASSETS, "splash.png"))
    compose(96, neutral, 0.7, transparent=False).resize((48, 48), Image.LANCZOS).save(
        os.path.join(ASSETS, "favicon.png")
    )
    print("icons written: icon.png, adaptive-icon.png, splash.png, favicon.png")


if __name__ == "__main__":
    main()
