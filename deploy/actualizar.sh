#!/usr/bin/env bash
# Cierra admisión, pausa ejecuciones reanudables y publica API e interfaz con el servicio parado.
set -euo pipefail
REPO="${TELO_REPO:-/home/orquestador/orquestador}"
API="${TELO_API:-http://127.0.0.1:3000}"
SERVICIO="${TELO_SERVICIO:-orquestador}"
cd "$REPO"
REPO=$(pwd -P)
MARCA="$REPO/.git/telo-arranque"
FALLIDA="$REPO/.git/telo-fallida"
MANTENIMIENTO="$REPO/.git/telo-mantenimiento"
PAUSA_TAREAS="$REPO/.git/telo-pausar-tareas"
PARADO=0
IDENTIDAD=""
IDENTIDAD_PAUSA=""
log() { echo "[actualizar $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
compilar() { (cd web && bun install --frozen-lockfile && bun run build); }
instalar_servidor() { (cd server && bun install --frozen-lockfile); }
servidor_arriba() {
  local intento
  for intento in $(seq 1 15); do
    if curl -fsS --max-time 3 "$API/api/health" | bun -e 'const e=JSON.parse(await Bun.stdin.text());process.exit(e.ok===true?0:1)' >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
liberar() {
  if [ "$PARADO" = 1 ]; then sudo -n systemctl start "$SERVICIO" || true; fi
  if [ "$(stat -c '%d:%i' "$PAUSA_TAREAS" 2>/dev/null || true)" = "$IDENTIDAD_PAUSA" ]; then rmdir -- "$PAUSA_TAREAS" 2>/dev/null || true; fi
  if [ "$(stat -c '%d:%i' "$MANTENIMIENTO" 2>/dev/null || true)" = "$IDENTIDAD" ]; then rmdir -- "$MANTENIMIENTO" 2>/dev/null || true; fi
}
revertir() {
  log "Restauro código y dependencias de ${ARRANQUE:0:7}; la base se conserva."
  git reset --quiet --hard "$ARRANQUE" && instalar_servidor && compilar
  sudo -n systemctl start "$SERVICIO"
  PARADO=0
  servidor_arriba
}

# Se rechaza cualquier árbol editado antes de permitir un rollback con reset.
git diff --quiet && git diff --cached --quiet || { log "Hay cambios locales: no se actualiza."; exit 1; }
[ "$(git branch --show-current)" = main ] || { log "El despliegue requiere la rama main."; exit 1; }
git fetch --quiet origin main
ANTES=$(git rev-parse HEAD)
NUEVA=$(git rev-parse origin/main)
[ -f "$MARCA" ] || printf '%s\n' "$ANTES" > "$MARCA"
ARRANQUE=$(cat "$MARCA")
if [ "$ANTES" = "$NUEVA" ] && [ "$ARRANQUE" = "$NUEVA" ]; then exit 0; fi
if [ -f "$FALLIDA" ] && [ "$(cat "$FALLIDA")" = "$NUEVA" ]; then exit 0; fi

# El candado del kernel también lo usa el respaldo y se libera si muere el proceso.
command -v flock >/dev/null || { log "Falta flock: no se puede actualizar de forma segura."; exit 1; }
exec 9> "$REPO/.git/telo-operacion.lock"
flock -n 9 || exit 0
if ! mkdir -- "$MANTENIMIENTO" 2>/dev/null; then
  log "Existe una marca de mantenimiento: se conserva y se pospone la operación."
  exit 0
fi
IDENTIDAD=$(stat -c '%d:%i' "$MANTENIMIENTO")
trap liberar EXIT

# A diferencia del respaldo, una actualización pausa las tareas activas para
# dejarlas reanudables con la versión nueva. La API ya bloquea nuevas admisiones.
if ! mkdir -- "$PAUSA_TAREAS" 2>/dev/null; then
  log "Existe una señal de pausa de tareas; se pospone la operación."
  exit 0
fi
IDENTIDAD_PAUSA=$(stat -c '%d:%i' "$PAUSA_TAREAS")

# Mientras existe la marca no arrancan slots nuevos ni se aceptan mutaciones.
# Un servidor anterior sin este protocolo requiere actualización manual inicial.
DRENADO=0
for intento in $(seq 1 15); do
  if curl -fsS --max-time 3 "$API/api/health" | bun -e 'const e=JSON.parse(await Bun.stdin.text());process.exit(e.ok===true&&e.despliegue?.mantenimiento===true&&e.despliegue.activas===0?0:1)' >/dev/null 2>&1; then DRENADO=1; break; fi
  sleep 2
done
if [ "$DRENADO" != 1 ]; then log "Quedan trabajos activos o falta el protocolo de pausa; se pospone sin detener el servicio."; exit 0; fi
if pgrep -f '(^|/)opencode run( |$)|(^|/)codex( .*)? exec( |$)' >/dev/null 2>&1; then
  log "Hay agentes externos activos; se pospone."; exit 0
else
  [ "$?" = 1 ] || { log "No se pudo comprobar el cierre de agentes; se pospone."; exit 1; }
fi

# Ninguna petición ni tarea puede entrar entre el drenado y la parada.
sudo -n systemctl stop "$SERVICIO"
PARADO=1
if ! { git merge --ff-only --quiet origin/main && instalar_servidor && compilar; }; then
  printf '%s\n' "$NUEVA" > "$FALLIDA"
  revertir
  exit 1
fi
touch "$MANTENIMIENTO"
if sudo -n systemctl start "$SERVICIO" && servidor_arriba; then
  PARADO=0
  git rev-parse HEAD > "$MARCA"
  log "Servidor e interfaz actualizados a $(git rev-parse --short HEAD)."
else
  sudo -n systemctl stop "$SERVICIO"
  PARADO=1
  printf '%s\n' "$NUEVA" > "$FALLIDA"
  revertir
  exit 1
fi
