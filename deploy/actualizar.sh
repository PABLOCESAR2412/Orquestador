#!/usr/bin/env bash
# Los cambios de CSS se publican en vivo; los cambios de runtime drenan tareas y reinician el servicio.
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
STAGING=""
INTERFAZ_CAMBIADA=0
log() { echo "[actualizar $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
compilar() { (cd web && bun install --frozen-lockfile && bun run build); }
instalar_servidor() { (cd server && bun install --frozen-lockfile); }
solo_visual_o_documentacion() {
  local archivos archivo
  archivos=$(git diff --no-renames --name-only "$ARRANQUE" "$NUEVA")
  [ -n "$archivos" ] || return 1
  while IFS= read -r archivo; do
    case "$archivo" in
      web/src/*.css|web/src/cambios.json) INTERFAZ_CAMBIADA=1 ;;
      README.md|SEGUIMIENTO.md|deploy/README.md) ;;
      *) return 1 ;;
    esac
  done <<< "$archivos"
  return 0
}
compilar_interfaz_temporal() {
  local destino="$1"
  (cd web && bun install --frozen-lockfile && bun run tsc --noEmit && bun run vite build --outDir "$destino" --emptyOutDir)
}
copiar_atomico() {
  local origen="$1" destino="$2" temporal="${2}.nuevo.$$"
  cp -- "$origen" "$temporal"
  mv -f -- "$temporal" "$destino"
}
publicar_interfaz_sin_pausa() {
  local destino="$REPO/web/dist" origen nombre
  [ -f "$STAGING/index.html" ] || return 1
  mkdir -p "$destino/assets"
  if [ -d "$STAGING/assets" ]; then cp -a -- "$STAGING/assets/." "$destino/assets/"; fi
  # Los nombres con hash se copian primero; las pestañas abiertas pueden seguir usando el build anterior.
  for origen in "$STAGING"/*; do
    [ -f "$origen" ] || continue
    nombre="${origen##*/}"
    case "$nombre" in index.html|version.json|sw.js) continue ;; esac
    copiar_atomico "$origen" "$destino/$nombre"
  done
  copiar_atomico "$STAGING/index.html" "$destino/index.html"
  [ ! -f "$STAGING/version.json" ] || copiar_atomico "$STAGING/version.json" "$destino/version.json"
  [ ! -f "$STAGING/sw.js" ] || copiar_atomico "$STAGING/sw.js" "$destino/sw.js"
}
servidor_arriba() {
  local intento
  for intento in $(seq 1 15); do
    if curl -fsS --max-time 3 "$API/api/health" | bun -e 'const e=JSON.parse(await Bun.stdin.text());process.exit(e.ok===true?0:1)' >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
liberar() {
  if [ -n "$STAGING" ]; then
    case "$STAGING" in "$REPO"/.git/telo-web-stage.*) rm -rf -- "$STAGING" ;; esac
  fi
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
trap liberar EXIT

# No se actualiza desde main hasta que GitHub Actions compruebe el mismo SHA.
# La EnvironmentFile solo está en la unidad de despliegue; el token no entra en argumentos ni logs.
if [ -z "${TELO_GITHUB_CI_TOKEN:-}" ] || [[ ! "$TELO_GITHUB_CI_TOKEN" =~ ^[A-Za-z0-9_]{20,}$ ]]; then
  log "Falta un token de GitHub de solo lectura en TELO_GITHUB_CI_TOKEN; se cancela el despliegue."
  exit 1
fi
if ! bun run "$REPO/deploy/verificar-ci.ts" "$NUEVA"; then
  log "Los checks de servidor e interfaz no están aprobados para ${NUEVA:0:7}; se pospone el despliegue."
  exit 0
fi
unset TELO_GITHUB_CI_TOKEN

# Los cambios visuales y documentación no tocan la API ni el proceso de agentes.
# Si cambia CSS, se construye aparte; los assets se publican antes que index.html.
if solo_visual_o_documentacion; then
  if [ "$INTERFAZ_CAMBIADA" = 1 ]; then
    log "Los cambios son visuales/documentales; actualizo la interfaz sin pausar tareas."
  else
    log "Solo cambió documentación; actualizo el checkout sin pausar tareas ni reiniciar el servicio."
  fi
  if ! git merge --ff-only --quiet origin/main; then
    printf '%s\n' "$NUEVA" > "$FALLIDA"
    log "No se pudo avanzar main; no se reinició el servicio."
    exit 1
  fi
  if [ "$INTERFAZ_CAMBIADA" = 1 ]; then
    STAGING=$(mktemp -d "$REPO/.git/telo-web-stage.XXXXXX")
    if ! compilar_interfaz_temporal "$STAGING"; then
      printf '%s\n' "$NUEVA" > "$FALLIDA"
      git reset --quiet --hard "$ARRANQUE"
      log "Falló la compilación visual; se conserva la interfaz publicada y las tareas siguen activas."
      exit 1
    fi
    if ! publicar_interfaz_sin_pausa; then
      printf '%s\n' "$NUEVA" > "$FALLIDA"
      git reset --quiet --hard "$ARRANQUE"
      log "Falló la publicación de la interfaz; el servicio y las tareas siguen activos."
      exit 1
    fi
  fi
  git rev-parse HEAD > "$MARCA"
  log "Actualización aplicada a $(git rev-parse --short HEAD); servicio y tareas siguen activos."
  exit 0
fi

if ! mkdir -- "$MANTENIMIENTO" 2>/dev/null; then
  log "Existe una marca de mantenimiento: se conserva y se pospone la operación."
  exit 0
fi
IDENTIDAD=$(stat -c '%d:%i' "$MANTENIMIENTO")

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
