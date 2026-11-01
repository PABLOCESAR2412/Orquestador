#!/usr/bin/env bash
# Pruebas locales con claves sintéticas; no lanza modelos de pago ni reinicia producción.
set -euo pipefail
cd -- "$(dirname -- "$0")/../server"
[ "$(uname -s)" = Linux ] || { echo "Esta comprobación requiere Linux." >&2; exit 1; }
for herramienta in bun bwrap python3 git; do
  command -v "$herramienta" >/dev/null || { echo "Falta $herramienta." >&2; exit 1; }
done
bun run typecheck
if [ -x "$HOME/.local/bin/rtk" ]; then export TELO_TEST_RTK_BINARY="$HOME/.local/bin/rtk"; fi
bun test tests/red-agente.test.ts tests/aislamiento.test.ts tests/skills-seguras.test.ts tests/subagentes.test.ts tests/subagentes-chat.test.ts tests/worker-turnos.test.ts tests/ejecucion-contexto.test.ts tests/espera-proveedor.test.ts tests/rtk.test.ts tests/chat-turnos.test.ts tests/resolucion-skills.test.ts
TELO_TEST_WORKER=1 bun test tests/worker-flujo.test.ts
echo 'Aislamiento, broker, skills y worker comprobados con proveedores sintéticos.'
echo 'La respuesta de tus proveedores y sus cuotas se comprueban después desde el chat.'
systemctl show orquestador-deploy.service -p EnvironmentFiles --no-pager
