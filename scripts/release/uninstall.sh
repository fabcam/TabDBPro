#!/usr/bin/env bash
#
# uninstall.sh — detiene y elimina el servicio del bridge de TabDB Pro.
#
# Conserva el binario y la carpeta data/ (known_hosts) por defecto.
# Pasá --purge para borrar también ~/Library/Application Support/TabDBPro.
#
# (La extensión se quita aparte desde chrome://extensions.)

set -euo pipefail

LABEL="com.tabdbpro.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="$HOME/Library/Application Support/TabDBPro"

PURGE=false
[[ "${1:-}" == "--purge" ]] && PURGE=true

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "→ Deteniendo servicio…"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
else
  echo "→ El servicio no estaba cargado."
fi

[[ -f "$PLIST" ]] && rm -f "$PLIST" && echo "→ Plist eliminado."

if $PURGE; then
  rm -rf "$INSTALL_DIR"
  echo "→ Binario y data/ eliminados."
else
  echo "→ Binario conservado en: $INSTALL_DIR  (usá --purge para borrarlo)"
fi

echo "✅ Servicio desinstalado. Acordate de quitar la extensión en chrome://extensions."
