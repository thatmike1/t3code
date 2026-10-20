#!/usr/bin/env python3
"""Cut regenerated sheets: python3 scripts/prepare-fork-artwork.py --source-dir PATH.

Requires Pillow. Input names are {paint,bonsai}-{dark,light}-sheet.png. Bounds
are detected from the matte, blank separator and green key, rather than a fixed
sheet grid. Outputs go to apps/web/public/fork-artwork by default.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


def bounds(mask):
    box = mask.getbbox()
    if box is None:
        raise ValueError("no artwork found")
    return box


def pixels(image):
    # pillow 14 renames getdata; keep the script usable with older installations.
    return image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()


def prepare(source, output, direction, theme):
    name = f"{direction}-{theme}"
    image = Image.open(source / f"{name}-sheet.png").convert("RGB")
    width, height = image.size
    matte = 255 if theme == "light" else 0
    difference = ImageChops.difference(image, Image.new("RGB", image.size, (matte,) * 3))
    foreground = difference.convert("L").point(lambda v: 255 if v > 8 else 0)
    # the blank horizontal gap separates the strip from the lower-left disc.
    left = foreground.crop((0, 0, width // 2, height))
    active = [left.crop((0, y, left.width, y + 1)).getbbox() is not None for y in range(height)]
    top = next(y for y, value in enumerate(active) if value)
    split = next(y for y in range(top + 1, height - 32) if not any(active[y : y + 32]))
    strip_box = (0, top, width, split)
    strip = image.crop(strip_box)
    strip = strip.resize((512, round(strip.height * 512 / strip.width)), Image.Resampling.LANCZOS)
    if strip.height > 160:
        raise ValueError(f"{name}: strip exceeds the 2x slot; inspect regenerated layout")
    tile = Image.new("RGB", (512, 160), (matte,) * 3)
    tile.paste(strip)
    # a reflected pair has identical pixels at every join, at a fixed 256px scale.
    repeat = Image.new("RGB", (1024, 160))
    repeat.paste(tile)
    repeat.paste(ImageOps.mirror(tile), (512, 0))
    repeat.save(output / f"{name}-strip.webp", quality=90, method=6)

    green = Image.new("L", image.size)
    green.putdata([255 if g > 160 and g > r + 70 and g > b + 70 else 0 for r, g, b in pixels(image)])
    # only the lower half can contain the arrow's green square (Paint has green trees).
    green.paste(0, (0, 0, width, split))
    green.paste(0, (0, 0, width // 2, height))
    green_box = bounds(green)
    circle_mask = foreground.crop(
        (0, split + 32, min(round(width * 0.55), green_box[0] - 16), height)
    )
    x0, y0, x1, y1 = bounds(circle_mask)
    y0 += split + 32
    y1 += split + 32
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    circle_box = (
        round(cx - side / 2), round(cy - side / 2),
        round(cx + side / 2), round(cy + side / 2),
    )
    circle = image.crop(circle_box).resize((288, 288), Image.Resampling.LANCZOS).convert("RGBA")
    alpha = Image.new("L", circle.size)
    ImageDraw.Draw(alpha).ellipse((0, 0, 287, 287), fill=255)
    circle.putalpha(alpha)
    circle.resize((72, 72), Image.Resampling.LANCZOS).save(
        output / f"{name}-circle.webp", quality=95, method=6
    )

    keyed = image.crop(tuple(v + (4 if i < 2 else -4) for i, v in enumerate(green_box))).convert("RGBA")
    output_pixels = []
    for r, g, b, _ in pixels(keyed):
        # solve C = alpha * foreground + (1-alpha) * green. Removing spill
        # before unpremultiplying retains soft brush edges without green halos.
        spill = max(0, g - max(r, b))
        alpha = max(0, 1 - spill / 245)
        output_pixels.append((
            round(r / alpha) if alpha else 0,
            round((g - spill) / alpha) if alpha else 0,
            round(b / alpha) if alpha else 0,
            round(alpha * 255),
        ))
    keyed.putdata(output_pixels)
    arrow_box = bounds(keyed.getchannel("A").point(lambda v: 255 if v > 32 else 0))
    arrow = keyed.crop(arrow_box)
    arrow.thumbnail((36, 36), Image.Resampling.LANCZOS)
    glyph = Image.new("RGBA", (40, 40))
    glyph.paste(arrow, ((40 - arrow.width) // 2, (40 - arrow.height) // 2))
    # lanczos can reintroduce a little chroma around translucent pixels.
    glyph.putdata([(r, min(g, max(r, b)), b, a) for r, g, b, a in pixels(glyph)])
    glyph.save(output / f"{name}-arrow.png", optimize=True)
    print(f"{name}: strip={strip_box}, circle={circle_box}, green={green_box}, arrow={arrow_box}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument(
        "--output-dir", type=Path,
        default=Path(__file__).resolve().parents[1] / "apps/web/public/fork-artwork",
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for direction in ("paint", "bonsai"):
        for theme in ("dark", "light"):
            prepare(args.source_dir, args.output_dir, direction, theme)


if __name__ == "__main__":
    main()
