from PIL import Image
from pathlib import Path

Image.MAX_IMAGE_PIXELS = None

root = Path(r"C:\Users\dimpl\Downloads\Yuva Subharam\Coading Projects\powerflex---elite-fitness-coach (1)\Challenge Gym")
# Kept outside public/ so the 20 MB original is never shipped with the app builds.
source = root / "brand" / "gym-logo-source.jpeg"

if not source.exists():
    raise FileNotFoundError(f"Source logo not found: {source}")

# Work with a scaled-down source to keep processing fast while preserving crisp output.
img = Image.open(source).convert("RGBA")
img.thumbnail((3000, 3000), Image.Resampling.LANCZOS)

# Sample border colors to estimate the background tone.
points = [
    img.getpixel((0, 0)),
    img.getpixel((img.width - 1, 0)),
    img.getpixel((0, img.height - 1)),
    img.getpixel((img.width - 1, img.height - 1)),
    img.getpixel((img.width // 2, 0)),
    img.getpixel((0, img.height // 2)),
]
bg = tuple(int(sum(p[i] for p in points) / len(points)) for i in range(4))

# Remove the light/gray background while keeping the real logo artwork.
transparent = Image.new("RGBA", img.size, (0, 0, 0, 0))
px = []
for p in img.getdata():
    r, g, b, a = p
    diff = (abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) / 3.0
    if diff < 28 and a > 0:
        px.append((255, 255, 255, 0))
    else:
        px.append((r, g, b, a))
transparent.putdata(px)

bbox = transparent.getbbox()
if bbox is None:
    raise RuntimeError("No visible content found in the source logo.")
transparent = transparent.crop(bbox)

# Center the icon on a square transparent canvas.
size = max(transparent.width, transparent.height)
canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
canvas.paste(transparent, ((size - transparent.width) // 2, (size - transparent.height) // 2))

# Export all app-ready variants.
for public_dir in [root / "admin-app" / "public", root / "member-app" / "public"]:
    # 1024 px covers the largest use (520 px watermark on 2x screens) without multi-MB files.
    logo = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
    logo.save(public_dir / "logo-transparent.png", optimize=True)
    logo.save(public_dir / "logo-transparent.webp", format="WEBP", quality=88, method=6)

    for size_px in [32, 64, 128, 192, 256, 512]:
        icon = canvas.resize((size_px, size_px), Image.Resampling.LANCZOS)
        icon.save(public_dir / f"favicon-{size_px}.png", optimize=True)

    splash = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
    splash.save(public_dir / "splash-logo.png", optimize=True)

    # Maskable icon: logo sits inside the 80% safe zone on the app background, so Android
    # launchers/splash never crop the artwork or wrap it in a white frame.
    maskable = Image.new("RGBA", (512, 512), (14, 15, 17, 255))
    inner = canvas.resize((410, 410), Image.Resampling.LANCZOS)
    maskable.alpha_composite(inner, ((512 - 410) // 2, (512 - 410) // 2))
    maskable.save(public_dir / "maskable-512.png", optimize=True)

print(f"Generated logo assets in: {root / 'admin-app' / 'public'} and {root / 'member-app' / 'public'}")
