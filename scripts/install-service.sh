#!/usr/bin/env bash
#
# install-service.sh — instala el bridge de TabDB Pro como LaunchAgent de macOS.
#
# Deja el bridge corriendo en segundo plano, arrancando solo en cada inicio de
# sesión (RunAtLoad) y reviviéndose si crashea (KeepAlive). Escucha en
# 127.0.0.1:47321 y arranca SIN conexiones: la extensión de Chrome las inyecta
# desde chrome.storage al conectarse.
#
# Idempotente: se puede volver a correr tras cada `npm run build` para actualizar
# el binario instalado y recargar el servicio.

set -euo pipefail

LABEL="com.tabdbpro.bridge"
PORT="${BRIDGE_PORT:-47321}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_DIR/bridge/dist"

INSTALL_DIR="$HOME/Library/Application Support/TabDBPro"
DATA_DIR="$INSTALL_DIR/data"
BIN_DEST="$INSTALL_DIR/tabdb-bridge"

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_OUT="$HOME/Library/Logs/tabdb-bridge.out.log"
LOG_ERR="$HOME/Library/Logs/tabdb-bridge.err.log"

# ── 1. Elegir el binario según arquitectura ─────────────────────────────────────
# Usamos sysctl en vez de `uname -m`: si este script corre bajo un bash traducido
# por Rosetta, `uname -m` miente y dice x86_64 en una Mac Apple Silicon.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null)" == "1" ]]; then
  TRIPLE="aarch64-apple-darwin"
else
  TRIPLE="x86_64-apple-darwin"
fi

BIN_SRC="$DIST_DIR/tabdb-bridge-$TRIPLE"
if [[ ! -s "$BIN_SRC" ]]; then
  echo "No encuentro el binario: $BIN_SRC" >&2
  echo "Corré primero:  cd bridge && npm run build" >&2
  exit 1
fi

echo "→ Binario:      $BIN_SRC"
echo "→ Instalando en: $INSTALL_DIR"

# ── 2. Instalar el binario + carpeta data/ ──────────────────────────────────────
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$HOME/Library/LaunchAgents"
cp "$BIN_SRC" "$BIN_DEST"
chmod +x "$BIN_DEST"

# ── 3. Descargar la versión previa del servicio (si estaba cargada) ─────────────
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "→ Descargando servicio previo…"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
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

echo "→ Plist:        $PLIST"

# ── 5. Cargar el servicio ───────────────────────────────────────────────────────
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true

# ── 6. Verificar ────────────────────────────────────────────────────────────────
echo "→ Esperando a que el bridge responda…"
for i in $(seq 1 15); do
  if curl -fs -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo ""
    echo "✅ Bridge corriendo como servicio en http://127.0.0.1:$PORT"
    echo "   /health → $(curl -s -m 2 "http://127.0.0.1:$PORT/health")"
    echo ""
    echo "   Arranca solo en cada login y se reinicia si crashea."
    echo "   Logs:   $LOG_OUT"
    echo "           $LOG_ERR"
    echo "   Parar:  scripts/uninstall-service.sh"
    exit 0
  fi
  sleep 1
done

echo "⚠️  El servicio se cargó pero /health no respondió a tiempo." >&2
echo "    Revisá los logs: $LOG_ERR" >&2
exit 1
