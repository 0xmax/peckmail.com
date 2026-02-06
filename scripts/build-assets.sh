#!/bin/sh
# Copies optimized images into dist/public/assets/ for serving.
# On macOS with sips available, can regenerate from originals.
# In Docker/CI, just copies the pre-optimized versions.

set -eu

SRC_ORIG="assets/originals"
SRC_OPT="assets/optimized"
DEST="dist/public/assets"

mkdir -p "$DEST"

echo "Building assets..."

if command -v sips >/dev/null 2>&1; then
  # macOS: regenerate from originals
  sips -s format jpeg --resampleWidth 1200 "$SRC_ORIG/hero-desktop.jpeg" --out "$DEST/hero.jpg" >/dev/null
  sips -s format jpeg --resampleWidth 640 "$SRC_ORIG/hero-mobile.jpeg" --out "$DEST/hero-mobile.jpg" >/dev/null
  echo "  Regenerated from originals with sips"
else
  # CI/Docker: copy pre-optimized
  cp "$SRC_OPT/hero.jpg" "$DEST/hero.jpg"
  cp "$SRC_OPT/hero-mobile.jpg" "$DEST/hero-mobile.jpg"
  echo "  Copied pre-optimized images"
fi

echo "Done."
