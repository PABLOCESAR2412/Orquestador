# Orquestador: instrucciones para agentes de desarrollo

Lee este archivo antes de tocar código. Complementos: `PLAN.md` (hoja de ruta), `TODO.md` (pendientes), `DESIGN.md` (sistema visual) y `AGENTS.md` (roles de los agentes que el producto lanza para cada tarea).

## Qué es

Orquestador es una app personal para lanzar tareas a agentes de IA (OpenCode hoy; Codex y Google/agy después) y dejarlas corriendo en un VM de Azure, para que sigan aunque la PC o el teléfono estén apagados. Tiene chat, cola de tareas en segundo plano, analíticas de costo y uso, y ajustes. Se instala como PWA.

Es de uso personal, con un solo usuario y sin cuentas. Todavía no tiene login: el acceso es por túnel SSH hasta que se configure Cloudflare Access (fase 9 de `PLAN.md`).

## Stack

- **Runtime:** Bun.
- **Servidor:** Hono y `bun:sqlite` (WAL, claves foráneas). Migraciones numeradas en `server/src/db/index.ts`, registradas en `schema_migrations`.
- **Web:** Vite, React 19, TanStack Router y TanStack Query. CSS plano con tokens en `:root`. Sin Tailwind.
- **PWA:** vite-plugin-pwa con `autoUpdate`.
- **Gráficas:** SVG a mano en `web/src/components/charts.tsx`. Sin librerías de gráficas.
- **Producción:** servicio systemd `orquestador.service` en el VM, usuario `orquestador`, repo en `/home/orquestador/orquestador`.

## Estructura

- `server/src/index.ts`: entrada. Monta las rutas bajo `/api`, sirve `web/dist` y arranca el worker.
- `server/src/worker.ts`: cola de tareas. Corre una a la vez, cancela con AbortController y, al arrancar, marca como interrumpidas (`interrupted`) las tareas que quedaron en ejecución. Registra cada transición en `task_events` (`server/src/eventos.ts`) y guarda el id de sesión del agente para poder reanudar.
- `server/src/runners/opencode.ts`: ejecuta `opencode run --format json` en su propio grupo de procesos (`setsid`), dentro del aislamiento de `runners/aislamiento.ts`, y sin variables `TELO_*`. Al cancelar o agotar el tiempo, termina el grupo completo (agente, herramientas y nietos).
- `server/src/runners/aislamiento.ts`: envuelve al agente en bubblewrap (`bwrap`). Solo ve su carpeta de trabajo (proyecto, o carpeta temporal de chat o tarea) y el estado de OpenCode. No ve el repo, `DATA_DIR`, otros proyectos, el resto del HOME ni los procesos del servidor.
- `server/src/routes/`: `chat`, `tasks`, `preferences`, `analytics`, `models`, `settings` (también el `PATCH` de conversaciones: modelo, esfuerzo, título y anclar), `projects`, `cuotas`.
- `server/scripts/respaldo.ts`: copia de la base (`VACUUM INTO`) y del espacio de trabajo. Ver la sección "Respaldos".

## Aislamiento de los agentes

- Sin `bwrap` en el servidor, el agente no corre: la tarea o el chat fallan con un mensaje claro. Instalar en el VM con `sudo apt install bubblewrap`.
- `TELO_AISLAMIENTO=desactivado` lo apaga. Solo para desarrollo local, nunca en el VM.
- Si `opencode` vive fuera de `~/.opencode`, `~/.local/bin` o `~/.bun` (por ejemplo, bajo `~/.nvm`), añade la carpeta raíz de esa instalación en `TELO_LECTURA_EXTRA` del archivo de entorno del VM, separada por `:`. Solo lectura. Nunca apuntes a la carpeta del repo, a `DATA_DIR` ni a la de proyectos.
- Una carpeta de trabajo que no sea un proyecto registrado ni la carpeta temporal de un chat o tarea se rechaza antes de correr el agente.
- `server/src/preferences.ts`: preferencias guardadas en `app_settings` (clave `preferences`).
- `web/src/api.ts`: cliente HTTP y tipos. Todo fetch pasa por ahí.
- `web/src/pages/`: `chat`, `tasks`, `analytics`, `settings`. Rutas en `web/src/router.tsx`.
- `web/src/components/`: `nav.tsx` (AppNav), `charts.tsx`, `controls.tsx`, `model-picker.tsx`.
- `web/src/lib/model.ts`: `errorText()`, etiquetas de estado y formato de fechas.
- `web/src/styles.css`: tokens y estilos. Los colores salen de aquí.

## Comandos

```
cd server && bun run dev        # API en :3000 con recarga
cd web && bun run dev           # Vite; proxy de /api a :3000
cd web && bun run build         # tsc --noEmit + vite build. Debe pasar antes de cualquier PR.
```

No hay suite de pruebas en el repo todavía. Las pruebas actuales viven fuera del repo; moverlas a `tests/` está en `TODO.md`.

## Reglas de trabajo

1. **Extender, no duplicar.** Antes de crear un componente, función o endpoint, busca uno existente: `AppNav`, `DailyBars`, `ModelBars`, `errorText`, `api.*`, `getPreferences`. Los cambios son aditivos. No reescribas lo que ya funciona si no te lo pidieron.
2. **Idioma.** Textos de interfaz, mensajes de error y comentarios de negocio en español. Los identificadores siguen el estilo del archivo que editas.
3. **Tokens, no colores sueltos.** Colores y medidas salen de las variables de `web/src/styles.css`. El ámbar (`--signal`) solo marca estado activo o alerta.
4. **Móvil primero.** Margen lateral de 16 px y sin scroll horizontal a 390 px de ancho. Revisa siempre ese ancho.
5. **Errores legibles.** Los errores de API pasan por `errorText()`. El usuario ve español, no códigos.
6. **Migraciones.** Cada cambio de esquema es una migración nueva y numerada. No edites una migración que ya se aplicó.
7. **Secretos.** Nada de claves, tokens ni IPs en el repo. Las claves viven en el VM, en un archivo de entorno de systemd fuera del repo.
8. **Git.** Trabaja en ramas `feat/`, `fix/` o `docs/`. No hagas commit, push ni PR sin que el usuario lo pida. El usuario hace el merge.

## Skills recomendadas

- **Diseño de interfaz:** `impeccable` (`/impeccable`). Antes de cambiar UI, lee `DESIGN.md`.
- **Verificación de UI:** Playwright MCP. Toma capturas a 390 px y 1440 px antes de dar algo por terminado.
- **Gráficas:** `dataviz`. Cualquier gráfica nueva sigue sus reglas de color y accesibilidad.
- **Revisión antes de PR:** `engineering:code-review`.
- **Bugs:** `engineering:debug`.
- **Opcional:** `caveman` reduce los tokens de salida en 12 a 23 %. No lo uses en documentación ni en textos de diseño.

## Acceso (referencia)

- Desde la PC: `ssh -L 3000:localhost:3000 -L 9090:localhost:9090 -i <tu_clave> orquestador@<IP>`. Luego abre `http://127.0.0.1:3000`. El puerto 9090 es Cockpit.
- Actualizar el VM: `cd ~/orquestador && git switch main && git pull --ff-only && cd web && bun run build && cd .. && sudo systemctl restart orquestador`.
- No abras puertos en Azure sin login. El siguiente paso es Cloudflare Tunnel con Access.

## Respaldos

- En el VM, `deploy/orquestador-respaldo.timer` corre cada día a las 03:30 UTC `server/scripts/respaldo.ts`, con el servicio encendido. Guarda en `/home/orquestador/respaldos`: `orquestador-<sello>.db` (copia con `VACUUM INTO`, revisada con `integrity_check`) y `espacio-<sello>.tar.gz` (`chat-workspace` y `tasks`). Conserva las últimas `TELO_RESPALDOS_CONSERVAR` (14) de cada tipo.
- La PC copia esa carpeta por Tailscale con `deploy/copiar-respaldo-pc.ps1`. Los respaldos nunca van al repo. La PC no poda sus copias.
- Instalar en el VM (una vez):
  ```
  sudo install -d -o orquestador -g orquestador /home/orquestador/respaldos
  sudo cp ~/orquestador/deploy/orquestador-respaldo.service ~/orquestador/deploy/orquestador-respaldo.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now orquestador-respaldo.timer
  ```
  Probar: `sudo systemctl start orquestador-respaldo.service` y `journalctl -u orquestador-respaldo.service -n 20`.
- Programar la copia en la PC (una vez, en PowerShell). La hora debe ser local y posterior a las 03:30 UTC:
  ```
  $accion = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\ruta\copiar-respaldo-pc.ps1" -Servidor orquestador@NOMBRE-DEL-VM -Clave "C:\ruta\TU_CLAVE"'
  Register-ScheduledTask -TaskName "Telo respaldo" -Action $accion -Trigger (New-ScheduledTaskTrigger -Daily -At 06:00) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
  ```
- Restaurar, con el servicio parado: copiar la `.db` elegida a `server/data/orquestador.db`, borrar `orquestador.db-wal` y `orquestador.db-shm` si existen, y extraer el `espacio-*.tar.gz` con `tar -xzf ... -C server/data`. Luego arrancar.

## Definición de terminado

- `bun run build` pasa.
- Si hay interfaz: revisada a 390 px y 1440 px, sin errores de consola.
- Los cambios están en una rama, con una descripción de lo que se probó.
