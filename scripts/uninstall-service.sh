#!/usr/bin/env bash
#
# uninstall-service.sh — detiene y elimina el LaunchAgent del bridge de TabDB Pro.
#
# Por defecto conserva el binario instalado y la carpeta data/ (known_hosts).
# Pasá --purge para borrar también ~/Library/Application Support/TabDBPro.

set -euo pipefail

LABEL="com.tabdbpro.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="$HOME/Library/Application Support/TabDBPro"

PURGE=false
[[ "${1:-}" == "--purge" ]] && PURGE=true

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "→ Descargando servicio…"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
else
  echo "→ El servicio no estaba cargado."
fi

if [[ -f "$PLIST" ]]; then
  rm -f "$PLIST"
  echo "→ Plist eliminado: $PLIST"
fi

if $PURGE; then
  rm -rf "$INSTALL_DIR"
  echo "→ Binario y data/ eliminados: $INSTALL_DIR"
else
  echo "→ Binario conservado en: $INSTALL_DIR  (usá --purge para borrarlo)"
fi

echo "✅ Servicio desinstalado."
