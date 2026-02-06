#!/bin/sh
# Copies optimized images into dist/public/assets/ for serving.
# On macOS with ImageMagick, regenerates full-res progressive JPEGs from originals.
# In Docker/CI, copies pre-optimized versions.

set -eu

SRC_ORIG="assets/originals"
SRC_OPT="assets/optimized"
DEST="dist/public/assets"

mkdir -p "$DEST"

echo "Building assets..."

if command -v magick >/dev/null 2>&1; then
  # ImageMagick: full-res progressive JPEG at quality 85
  magick "$SRC_ORIG/hero-desktop.jpeg" -interlace Plane -quality 85 "$DEST/hero.jpg"
  magick "$SRC_ORIG/hero-mobile.jpeg" -interlace Plane -quality 85 "$DEST/hero-mobile.jpg"
  echo "  Regenerated from originals with ImageMagick"
elif command -v sips >/dev/null 2>&1; then
  # macOS sips fallback
  sips -s format jpeg "$SRC_ORIG/hero-desktop.jpeg" --out "$DEST/hero.jpg" >/dev/null
  sips -s format jpeg "$SRC_ORIG/hero-mobile.jpeg" --out "$DEST/hero-mobile.jpg" >/dev/null
  echo "  Regenerated from originals with sips"
else
  # CI/Docker: copy pre-optimized
  cp "$SRC_OPT/hero.jpg" "$DEST/hero.jpg"
  cp "$SRC_OPT/hero-mobile.jpg" "$DEST/hero-mobile.jpg"
  echo "  Copied pre-optimized images"
fi

echo "Done."
