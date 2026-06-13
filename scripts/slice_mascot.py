"""Slice the combined mascot sheet into 6 tightly-cropped transparent PNGs.

Expects a 2-column x 3-row grid in assets/mascot/sheet.png:

    neutral   |  peek
    wave      |  shield
    headset   |  celebrate

Each cell is cropped to its alpha bounding box (trims transparent padding),
then padded back to a square so all poses share a consistent footprint.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "assets", "mascot", "sheet.png")

LAYOUT = [
    ["neutral", "peek"],
    ["wave", "shield"],
    ["headset", "celebrate"],
]

PAD = 24  # transparent margin around each trimmed pose


def main():
    img = Image.open(SRC).convert("RGBA")
    W, H = img.size
    cols, rows = 2, 3
    cw, ch = W // cols, H // rows
    out_dir = os.path.dirname(SRC)

    for r, row in enumerate(LAYOUT):
        for c, name in enumerate(row):
            cell = img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            bbox = cell.getbbox()  # tight box of non-transparent pixels
            if bbox is None:
                print(f"  ! {name}: empty cell, skipped")
                continue
            pose = cell.crop(bbox)
            pw, ph = pose.size
            side = max(pw, ph) + PAD * 2
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(pose, ((side - pw) // 2, (side - ph) // 2), pose)
            dest = os.path.join(out_dir, f"{name}.png")
            canvas.save(dest)
            print(f"  ok {name}.png  ({side}x{side})")


if __name__ == "__main__":
    main()
