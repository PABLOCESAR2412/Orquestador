#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Ejecuta este script con sudo para instalar una política administrada por el sistema." >&2
  exit 1
fi

usuario="${1:-orquestador}"
entrada="$(getent passwd "$usuario" || true)"
IFS=: read -r _ _ _ _ _ home _ <<<"$entrada"
if [[ -z "$entrada" || "$home" != /* || "$home" == "/" ]]; then
  echo "No pude resolver un HOME absoluto para el usuario '$usuario'." >&2
  exit 1
fi

auth_path="$home/.codex/auth.json"
config_path="$home/.codex/config.toml"
policy_dir="/etc/codex"
policy="$policy_dir/requirements.toml"
auth_staging_path="/tmp/telo-codex-global/auth.json"
config_staging_path="/tmp/telo-codex-global/config.toml"

if [[ -L "$policy_dir" ]]; then
  echo "La carpeta $policy_dir no puede ser un enlace simbólico." >&2
  exit 1
elif [[ -e "$policy_dir" ]]; then
  if [[ ! -d "$policy_dir" ]]; then
    echo "$policy_dir existe y no es una carpeta." >&2
    exit 1
  fi
  dir_owner="$(stat -c '%u' -- "$policy_dir")"
  dir_mode="$(stat -c '%a' -- "$policy_dir")"
  if [[ "$dir_owner" != "0" || ! "$dir_mode" =~ ^[0-7]{3,4}$ ]] || (( (8#$dir_mode & 022) != 0 )); then
    echo "$policy_dir debe pertenecer a root y no permitir escritura a grupo u otros." >&2
    exit 1
  fi
else
  install -d -o root -g root -m 0755 "$policy_dir"
fi

verificar_existente() {
  python3 - "$policy" "$auth_path" "$auth_staging_path" "$config_path" "$config_staging_path" <<'PY'
import sys
import tomllib

policy_path, auth_path, auth_staging_path, config_path, config_staging_path = sys.argv[1:]
try:
    with open(policy_path, "rb") as stream:
        requirements = tomllib.load(stream)
except Exception as error:
    print(f"No pude leer la política existente: {error}", file=sys.stderr)
    raise SystemExit(2)

deny_read = requirements.get("permissions", {}).get("filesystem", {}).get("deny_read", [])
required = {auth_path, auth_staging_path, config_path, config_staging_path}
if required.issubset(set(deny_read)):
    print("La política ya bloquea las rutas visibles de credenciales y configuración global de Codex.")
    raise SystemExit(0)

print(f"La política {policy_path} ya existe y no contiene la denegación requerida.", file=sys.stderr)
print("No la reemplacé. Añade estas rutas a permissions.filesystem.deny_read y vuelve a ejecutar:", file=sys.stderr)
for path in (auth_path, auth_staging_path, config_path, config_staging_path):
    print(f"  {path}", file=sys.stderr)
raise SystemExit(1)
PY
}

if [[ -e "$policy" ]]; then
  if verificar_existente; then
    exit 0
  else
    exit $?
  fi
fi

temporal="$(mktemp "$policy_dir/.requirements-telo.XXXXXX")"
trap 'rm -f -- "$temporal"' EXIT
python3 - "$auth_path" >"$temporal" <<'PY'
import json
import sys

print("[permissions.filesystem]")
paths = [
    sys.argv[1],
    "/tmp/telo-codex-global/auth.json",
    sys.argv[1].removesuffix("auth.json") + "config.toml",
    "/tmp/telo-codex-global/config.toml",
]
print("deny_read = [" + ", ".join(json.dumps(path) for path in paths) + "]")
PY
chown root:root "$temporal"
chmod 0644 "$temporal"

# Enlace duro atómico con no reemplazo: no pisa una política que otro administrador
# haya creado mientras se preparaba el archivo.
if ! ln -- "$temporal" "$policy" 2>/dev/null; then
  if verificar_existente; then
    exit 0
  else
    exit $?
  fi
fi
rm -f -- "$temporal"
trap - EXIT
echo "Política instalada en $policy; las herramientas de Codex no podrán leer auth.json ni config.toml."
