"""Regenerate native Android launcher icons (all densities) from the mascot.

Writes per-density:
  mipmap-*/ic_launcher.png            legacy square (greige + mascot)
  mipmap-*/ic_launcher_round.png      legacy round (circle crop)
  mipmap-*/ic_launcher_foreground.png adaptive foreground (transparent)
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(HERE, "android", "app", "src", "main", "res")
MASCOT = Image.open(os.path.join(HERE, "assets", "mascot", "neutral.png")).convert("RGBA")
GREIGE = (240, 230, 214, 255)

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def compose(size, frac, transparent, ground):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent else GREIGE)
    if not transparent:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        r = int(size * 0.42)
        cx, cy = size // 2, int(size * 0.44)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 248, 235, 110))
        canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(size * 0.08)))
    mh = int(size * frac)
    ratio = mh / MASCOT.height
    mw = int(MASCOT.width * ratio)
    m = MASCOT.resize((mw, mh), Image.LANCZOS)
    x, y = (size - mw) // 2, (size - mh) // 2
    if ground:
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        ew, eh = int(mw * 0.66), int(mh * 0.12)
        ex = (size - ew) // 2
        ey = y + mh - int(eh * 0.7)
        sd.ellipse([ex, ey, ex + ew, ey + eh], fill=(120, 92, 54, 95))
        canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(size * 0.022)))
    canvas.alpha_composite(m, (x, y))
    return canvas


def circle_crop(img):
    size = img.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size, size], fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    for d, scale in DENSITIES.items():
        legacy = int(48 * scale)
        fg = int(108 * scale)
        folder = os.path.join(RES, f"mipmap-{d}")
        sq = compose(legacy, 0.64, transparent=False, ground=True)
        sq.save(os.path.join(folder, "ic_launcher.png"))
        circle_crop(sq).save(os.path.join(folder, "ic_launcher_round.png"))
        compose(fg, 0.5, transparent=True, ground=False).save(
            os.path.join(folder, "ic_launcher_foreground.png")
        )
        print(f"  {d}: launcher {legacy}px, foreground {fg}px")


if __name__ == "__main__":
    main()
