#!/usr/bin/env bash
#
# package-release.sh — arma un zip compartible de TabDB Pro para instalar en
# otra Mac (binario del bridge + extensión + instalador + instructivo).
#
# No incluye el código fuente, node_modules ni nada del proyecto: solo lo que el
# colega necesita para usarlo.
#
# Uso:  ./scripts/package-release.sh
#   Requiere que el binario ya esté compilado (cd bridge && npm run build).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_DIR/bridge/dist"
REL_SRC="$REPO_DIR/scripts/release"
OUT_DIR="$REPO_DIR/release"

# Versión: la del manifest de la extensión.
VERSION="$(grep -m1 '"version"' "$REPO_DIR/extension/manifest.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
VERSION="${VERSION:-0.0.0}"

PKG_NAME="TabDBPro-$VERSION"
STAGE="$OUT_DIR/$PKG_NAME"

echo "── Empaquetando $PKG_NAME ───────────────────────────────"

# ── 1. Verificar que los binarios existan ───────────────────────────────────────
for triple in aarch64-apple-darwin x86_64-apple-darwin; do
  bin="$DIST_DIR/tabdb-bridge-$triple"
  if [[ ! -s "$bin" ]]; then
    echo "✗ Falta el binario: $bin" >&2
    echo "  Compilá primero:  cd bridge && npm run build" >&2
    exit 1
  fi
done

# ── 2. Armar el staging limpio ──────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/extension"

# Binarios (ambas arquitecturas)
cp "$DIST_DIR/tabdb-bridge-aarch64-apple-darwin" "$STAGE/bin/"
cp "$DIST_DIR/tabdb-bridge-x86_64-apple-darwin"  "$STAGE/bin/"
chmod +x "$STAGE/bin/"*

# Extensión completa (estática, para "Load unpacked")
cp -R "$REPO_DIR/extension/." "$STAGE/extension/"

# Instalador + instructivo
cp "$REL_SRC/install.sh"   "$STAGE/"
cp "$REL_SRC/uninstall.sh" "$STAGE/"
cp "$REL_SRC/INSTALL.md"   "$STAGE/"
chmod +x "$STAGE/install.sh" "$STAGE/uninstall.sh"

# ── 3. Comprimir ────────────────────────────────────────────────────────────────
ZIP_PATH="$OUT_DIR/$PKG_NAME.zip"
rm -f "$ZIP_PATH"
( cd "$OUT_DIR" && zip -qr "$PKG_NAME.zip" "$PKG_NAME" )

# ── 4. Resumen ──────────────────────────────────────────────────────────────────
SIZE="$(du -h "$ZIP_PATH" | cut -f1 | tr -d ' ')"
echo ""
echo "✅ Paquete listo:"
echo "   $ZIP_PATH  ($SIZE)"
echo ""
echo "   Contenido:"
( cd "$STAGE/.." && find "$PKG_NAME" -maxdepth 2 -not -path '*/.*' | sed 's/^/     /' )
echo ""
echo "   Pasale ese .zip a tu colega. Que lo descomprima y corra ./install.sh"
