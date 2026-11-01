#!/usr/bin/env bash
# Instala la unidad que carga el PAT; actualizar solo el checkout no modifica systemd.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecuta: sudo bash deploy/configurar-actualizador.sh" >&2; exit 1; }
repo=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
[ "$repo" = /home/orquestador/orquestador ] || { echo "Este instalador requiere /home/orquestador/orquestador." >&2; exit 1; }
archivo=/etc/orquestador/deploy.env
[ ! -L /etc/orquestador ] && [ ! -L "$archivo" ] || { echo "La configuración no admite enlaces simbólicos." >&2; exit 1; }
install -d -o root -g root -m 755 /etc/orquestador
if [ ! -e "$archivo" ]; then install -o root -g root -m 600 /dev/null "$archivo"; fi
[ -f "$archivo" ] && [ ! -L "$archivo" ] || { echo "deploy.env no es un archivo regular seguro." >&2; exit 1; }
[ "$(stat -c %h "$archivo")" = 1 ] || { echo "deploy.env tiene enlaces duros; se conserva sin modificar." >&2; exit 1; }
chown root:root "$archivo"
chmod 600 "$archivo"
if ! grep -Eq '^TELO_GITHUB_CI_TOKEN=[A-Za-z0-9_]{20,512}$' "$archivo"; then
  if [ -t 0 ]; then
    printf 'PAT fine-grained, Actions: Read-only (entrada oculta): ' >&2
    IFS= read -r -s token
    printf '\n' >&2
    [[ "$token" =~ ^[A-Za-z0-9_]{20,512}$ ]] || { echo "Formato de token inválido." >&2; exit 1; }
    temporal=$(mktemp /etc/orquestador/.deploy.env.XXXXXX)
    trap 'rm -f -- "${temporal:-}"; unset token' EXIT
    sed '/^TELO_GITHUB_CI_TOKEN=/d' "$archivo" > "$temporal"
    printf 'TELO_GITHUB_CI_TOKEN=%s\n' "$token" >> "$temporal"
    chmod 600 "$temporal"
    mv -- "$temporal" "$archivo"
    unset token
  else
    echo "Guarda el PAT con sudoedit /etc/orquestador/deploy.env y repite el instalador." >&2
    exit 1
  fi
fi
install -o root -g root -m 644 "$repo/deploy/orquestador-deploy.service" /etc/systemd/system/orquestador-deploy.service
install -o root -g root -m 644 "$repo/deploy/orquestador-deploy.timer" /etc/systemd/system/orquestador-deploy.timer
systemctl daemon-reload
systemctl reset-failed orquestador-deploy.service || true
systemctl enable --now orquestador-deploy.timer
echo "Actualizador configurado. El PAT queda en deploy.env; no se ha reiniciado Telo."
