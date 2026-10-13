#!/usr/bin/env bash
# Actualiza Telo cuando main cambia en GitHub. Lo ejecuta orquestador-deploy.timer cada 5 minutos.
# Instalación y revisión: deploy/README.md.
#
# Reglas:
# - Nunca reinicia con tareas o chats en curso: un reinicio marca como fallidas las tareas activas.
# - Solo reinicia si cambió server/. web/ se sirve desde web/dist sin reiniciar.
# - Si el build falla o el servidor no responde, vuelve a la versión anterior y no reintenta esa misma versión.
set -euo pipefail

REPO="${TELO_REPO:-/home/orquestador/orquestador}"
API="${TELO_API:-http://127.0.0.1:3000}"
SERVICIO="${TELO_SERVICIO:-orquestador}"
GIT_DIR_REPO="$REPO/.git"
MARCA="$GIT_DIR_REPO/telo-arranque"   # commit con el que arrancó el servidor
FALLIDA="$GIT_DIR_REPO/telo-fallida"  # última versión que no arrancó; no se reintenta

log() { echo "[actualizar $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Hay agentes corriendo (tareas o chats). El runner lanza "opencode run".
# Cuando se agreguen Codex o agy, añadir aquí su patrón.
hay_ejecuciones() { pgrep -f '(^|/)opencode run( |$)' >/dev/null 2>&1; }

compilar() { (cd web && bun install --frozen-lockfile && bun run build); }

servidor_arriba() {
  local _
  for _ in $(seq 1 10); do
    curl -fsS --max-time 3 "$API/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

reiniciar() { sudo systemctl restart "$SERVICIO"; }

cd "$REPO"
git switch --quiet main
git fetch --quiet origin main

[ -f "$MARCA" ] || git rev-parse HEAD > "$MARCA"   # primera vez: asume que el servidor corre esta versión
ARRANQUE=$(cat "$MARCA")
ANTES=$(git rev-parse HEAD)
NUEVA=$(git rev-parse origin/main)

if [ -f "$FALLIDA" ] && [ "$(cat "$FALLIDA")" = "$NUEVA" ]; then
  exit 0   # esta versión ya falló; se espera un commit nuevo
fi

# 1) Traer el código y compilar la interfaz. No reinicia nada.
if [ "$ANTES" != "$NUEVA" ]; then
  log "Nueva versión ${NUEVA:0:7} (antes ${ANTES:0:7})."
  git merge --ff-only --quiet origin/main || { log "No avanza: hay cambios locales en el VM."; exit 1; }
  if ! compilar; then
    log "Falló el build. Vuelvo a ${ANTES:0:7}."
    echo "$NUEVA" > "$FALLIDA"
    git reset --quiet --hard "$ANTES"
    exit 1
  fi
  log "Interfaz compilada."
fi

# 2) ¿El servidor que corre tiene el código actual de server/?
if git diff --quiet "$ARRANQUE" HEAD -- server; then
  git rev-parse HEAD > "$MARCA"
  exit 0
fi

# 3) Cambió server/: reiniciar solo si no hay ejecuciones en curso.
if hay_ejecuciones; then
  log "Hay ejecuciones en curso. El servidor se reinicia en el siguiente ciclo."
  exit 0
fi
(cd server && bun install --frozen-lockfile)
reiniciar

if servidor_arriba; then
  git rev-parse HEAD > "$MARCA"
  log "Servidor reiniciado en $(git rev-parse --short HEAD)."
  exit 0
fi

log "El servidor no respondió. Vuelvo a ${ARRANQUE:0:7}."
echo "$NUEVA" > "$FALLIDA"
git reset --quiet --hard "$ARRANQUE"
compilar
(cd server && bun install --frozen-lockfile)
reiniciar
exit 1
