#!/bin/bash
# Processes source images in assets/originals/ into web-optimized versions in dist/public/assets/
# Uses macOS sips (no extra dependencies). Run via: npm run build:assets

set -euo pipefail

SRC="assets/originals"
DEST="dist/public/assets"

mkdir -p "$DEST"

echo "Building assets..."

# Hero desktop: 1200px wide JPEG
if [ "$SRC/hero-desktop.jpeg" -nt "$DEST/hero.jpg" ] 2>/dev/null || [ ! -f "$DEST/hero.jpg" ]; then
  sips -s format jpeg --resampleWidth 1200 "$SRC/hero-desktop.jpeg" --out "$DEST/hero.jpg" >/dev/null
  echo "  hero.jpg ($(du -h "$DEST/hero.jpg" | cut -f1 | xargs))"
fi

# Hero mobile: 640px wide JPEG
if [ "$SRC/hero-mobile.jpeg" -nt "$DEST/hero-mobile.jpg" ] 2>/dev/null || [ ! -f "$DEST/hero-mobile.jpg" ]; then
  sips -s format jpeg --resampleWidth 640 "$SRC/hero-mobile.jpeg" --out "$DEST/hero-mobile.jpg" >/dev/null
  echo "  hero-mobile.jpg ($(du -h "$DEST/hero-mobile.jpg" | cut -f1 | xargs))"
fi

echo "Done."
