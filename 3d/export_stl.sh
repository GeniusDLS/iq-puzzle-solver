#!/usr/bin/env bash
# Batch-export STL files with the OpenSCAD CLI (OpenSCAD must be installed).
set -e
SCAD="iq_puzzle.scad"
OUT="stl"
mkdir -p "$OUT"
echo "template ..."; openscad -o "$OUT/template.stl" -D 'part="template"' "$SCAD"
for p in A B C D E F G H I J; do
  echo "piece $p ..."; openscad -o "$OUT/piece_$p.stl" -D "part=\"$p\"" "$SCAD"
done
echo "Done -> $OUT/"
