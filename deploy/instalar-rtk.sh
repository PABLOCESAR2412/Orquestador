#!/usr/bin/env bash
set -euo pipefail
# CLI OSS de filtros locales. No instala un proxy de modelos ni ejecuta scripts remotos.
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Este instalador requiere Linux x86_64.' >&2; exit 1; }
[[ $EUID -ne 0 ]] || { echo 'Ejecuta como orquestador, sin sudo.' >&2; exit 1; }
version=1.1.0
sha=4dec94a64035e08189ae82fd5408fe4ae9ae27a665fc07e3e3ec3c4c2d8e8a3e
destino="$HOME/.local/bin/rtk"
if [[ -e $destino ]]; then
  [[ $("$destino" --version) == "rtk $version" ]] && { echo "RTK $version ya está instalado."; exit 0; }
  echo 'Ya existe otro RTK. Conserva o retira ese binario antes de instalar.' >&2; exit 1
fi
temporal=$(mktemp -d)
trap 'rm -rf -- "$temporal"' EXIT
curl --silent --show-error --fail --location --proto '=https' --tlsv1.2 --max-time 120 --max-filesize 50000000 \
  "https://github.com/rtk-ai/rtk/releases/download/v${version}/rtk-oss-x86_64-unknown-linux-musl.tar.gz" -o "$temporal/rtk.tar.gz"
printf '%s  %s\n' "$sha" "$temporal/rtk.tar.gz" | sha256sum --check --status
tar -xzf "$temporal/rtk.tar.gz" -C "$temporal" --no-same-owner rtk
[[ -f $temporal/rtk && ! -L $temporal/rtk ]]
chmod 700 "$temporal/rtk"
[[ $("$temporal/rtk" --version) == "rtk $version" ]]
install -d -m 755 "$HOME/.local/bin"
install -m 755 "$temporal/rtk" "$destino"
echo "RTK $version instalado en $destino. Telo lo detectará en nuevas ejecuciones en un máximo de 60 segundos."
