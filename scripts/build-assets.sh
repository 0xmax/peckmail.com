#!/bin/sh
# Copies optimized images into dist/public/ for serving.
# On macOS with ImageMagick, regenerates from originals.
# In Docker/CI, copies pre-optimized versions.

set -eu

SRC_ORIG="assets/originals"
SRC_OPT="assets/optimized"
DEST="dist/public/assets"
DEST_ROOT="dist/public"

mkdir -p "$DEST"

echo "Building assets..."

if command -v magick >/dev/null 2>&1; then
  # ImageMagick: full-res progressive JPEG at quality 85
  magick "$SRC_ORIG/hero-desktop.jpeg" -interlace Plane -quality 85 "$DEST/hero.jpg"
  magick "$SRC_ORIG/hero-mobile.jpeg" -interlace Plane -quality 85 "$DEST/hero-mobile.jpg"
  magick "$SRC_ORIG/hero-desktop.jpeg" -gravity center -crop '1.91:1+0+0' +repage -resize 1200x628! -interlace Plane -quality 85 "$DEST/og.jpg"
  # Favicon set (use rounded-corner variant)
  magick "$SRC_ORIG/favicon-rounded.png" -define icon:auto-resize=32,16 "$DEST_ROOT/favicon.ico"
  magick "$SRC_ORIG/favicon-rounded.png" -resize 180x180 "$DEST_ROOT/apple-touch-icon.png"
  magick "$SRC_ORIG/favicon-rounded.png" -resize 192x192 "$DEST_ROOT/icon-192.png"
  magick "$SRC_ORIG/favicon-rounded.png" -resize 512x512 "$DEST_ROOT/icon-512.png"
  echo "  Regenerated from originals with ImageMagick"
elif command -v sips >/dev/null 2>&1; then
  # macOS sips fallback
  sips -s format jpeg "$SRC_ORIG/hero-desktop.jpeg" --out "$DEST/hero.jpg" >/dev/null
  sips -s format jpeg "$SRC_ORIG/hero-mobile.jpeg" --out "$DEST/hero-mobile.jpg" >/dev/null
  cp "$SRC_OPT/og.jpg" "$DEST/og.jpg"
  cp "$SRC_OPT/favicon.ico" "$DEST_ROOT/favicon.ico"
  cp "$SRC_OPT/apple-touch-icon.png" "$DEST_ROOT/apple-touch-icon.png"
  cp "$SRC_OPT/icon-192.png" "$DEST_ROOT/icon-192.png"
  cp "$SRC_OPT/icon-512.png" "$DEST_ROOT/icon-512.png"
  echo "  Regenerated from originals with sips"
else
  # CI/Docker: copy pre-optimized
  cp "$SRC_OPT/hero.jpg" "$DEST/hero.jpg"
  cp "$SRC_OPT/hero-mobile.jpg" "$DEST/hero-mobile.jpg"
  cp "$SRC_OPT/og.jpg" "$DEST/og.jpg"
  cp "$SRC_OPT/favicon.ico" "$DEST_ROOT/favicon.ico"
  cp "$SRC_OPT/apple-touch-icon.png" "$DEST_ROOT/apple-touch-icon.png"
  cp "$SRC_OPT/icon-192.png" "$DEST_ROOT/icon-192.png"
  cp "$SRC_OPT/icon-512.png" "$DEST_ROOT/icon-512.png"
  echo "  Copied pre-optimized images"
fi

# Web manifest (static, just ensure it exists)
cat > "$DEST_ROOT/site.webmanifest" <<'MANIFEST'
{
  "name": "Perchpad",
  "short_name": "Perchpad",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#faf6f1",
  "background_color": "#faf6f1",
  "display": "standalone"
}
MANIFEST

echo "Done."
