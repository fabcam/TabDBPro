#!/usr/bin/env bash
#
# install.sh — instala TabDB Pro (bridge) como servicio de macOS.
#
# Este instalador es autocontenido: se corre desde la carpeta descomprimida del
# paquete, sin necesitar el proyecto, Node ni npm. Deja el bridge corriendo en
# segundo plano, arrancando solo en cada login y reviviéndose si crashea.
#
# Uso:  ./install.sh

set -euo pipefail

LABEL="com.tabdbpro.bridge"
PORT="47321"   # fijo: la extensión de Chrome apunta a 127.0.0.1:47321

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$PKG_DIR/bin"

INSTALL_DIR="$HOME/Library/Application Support/TabDBPro"
DATA_DIR="$INSTALL_DIR/data"
BIN_DEST="$INSTALL_DIR/tabdb-bridge"

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_OUT="$HOME/Library/Logs/tabdb-bridge.out.log"
LOG_ERR="$HOME/Library/Logs/tabdb-bridge.err.log"

echo "── Instalando TabDB Pro ─────────────────────────────────"

# ── 1. Elegir el binario según arquitectura ─────────────────────────────────────
# sysctl no se deja engañar por Rosetta (uname -m sí).
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null)" == "1" ]]; then
  TRIPLE="aarch64-apple-darwin"
  echo "→ Mac Apple Silicon detectada"
else
  TRIPLE="x86_64-apple-darwin"
  echo "→ Mac Intel detectada"
fi

BIN_SRC="$BIN_DIR/tabdb-bridge-$TRIPLE"
if [[ ! -s "$BIN_SRC" ]]; then
  echo "✗ No encuentro el binario para tu Mac: $BIN_SRC" >&2
  exit 1
fi

# ── 2. Instalar binario + carpeta data/, quitar cuarentena de Gatekeeper ─────────
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$HOME/Library/LaunchAgents"
cp "$BIN_SRC" "$BIN_DEST"
chmod +x "$BIN_DEST"
# El binario viaja sin firmar: sin esto, macOS lo bloquea por venir de otra Mac.
xattr -dr com.apple.quarantine "$BIN_DEST" 2>/dev/null || true
echo "→ Binario instalado en: $INSTALL_DIR"

# ── 3. Descargar versión previa (si estaba cargada) ─────────────────────────────
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  # bootout es asíncrono: esperar a que el servicio realmente se descargue antes de bootstrap
  for _ in $(seq 1 25); do
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
    sleep 0.2
  done
fi

# ── 4. Generar el plist (rutas absolutas — launchd no expande ~) ─────────────────
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BIN_DEST</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BRIDGE_PORT</key>
        <string>$PORT</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>
    <key>StandardErrorPath</key>
    <string>$LOG_ERR</string>
</dict>
</plist>
PLIST_EOF

# ── 5. Cargar el servicio ───────────────────────────────────────────────────────
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true

# ── 6. Verificar ────────────────────────────────────────────────────────────────
for i in $(seq 1 15); do
  if curl -fs -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo ""
    echo "✅ Bridge corriendo como servicio en http://127.0.0.1:$PORT"
    echo "   Arranca solo en cada login y se reinicia si crashea."
    echo ""
    echo "   SIGUIENTE PASO — cargar la extensión en Chrome:"
    echo "   1. Abrí  chrome://extensions"
    echo "   2. Activá 'Developer mode' (arriba a la derecha)"
    echo "   3. 'Load unpacked' → elegí la carpeta:"
    echo "        $PKG_DIR/extension"
    echo "   4. Abrí DevTools (Cmd+Opt+I) → pestaña 'TabDB Pro' → ⚙ → agregá tu conexión"
    echo ""
    echo "   Ver INSTALL.md para el detalle."
    exit 0
  fi
  sleep 1
done

echo "⚠️  El servicio se cargó pero /health no respondió a tiempo." >&2
echo "    Revisá el log: $LOG_ERR" >&2
exit 1
