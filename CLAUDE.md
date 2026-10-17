# Orquestador: instrucciones para agentes de desarrollo

Lee este archivo antes de tocar código. Complementos: `PLAN.md` (hoja de ruta), `TODO.md` (pendientes), `DESIGN.md` (sistema visual) y `AGENTS.md` (roles de los agentes que el producto lanza para cada tarea).

## Qué es

Orquestador es una app personal para lanzar tareas a agentes de IA (OpenCode hoy; Codex y Google/agy después) y dejarlas corriendo en un VM de Azure, para que sigan aunque la PC o el teléfono estén apagados. Tiene chat, cola de tareas en segundo plano, analíticas de costo y uso, y ajustes. Se instala como PWA.

Es de uso personal, con un solo usuario y sin cuentas. Tiene login con `TELO_CLAVE`. El acceso remoto es por Tailscale, sin puertos públicos (fase 9 de `PLAN.md`).

## Stack

- **Runtime:** Bun.
- **Servidor:** Hono y `bun:sqlite` (WAL, claves foráneas). Migraciones numeradas en `server/src/db/index.ts`, registradas en `schema_migrations`.
- **Web:** Vite, React 19, TanStack Router y TanStack Query. CSS plano con tokens en `:root`. Sin Tailwind.
- **PWA:** vite-plugin-pwa con actualización bajo confirmación (`prompt`).
- **Gráficas:** SVG a mano en `web/src/components/charts.tsx`. Sin librerías de gráficas.
- **Producción:** servicio systemd `orquestador.service` en el VM, usuario `orquestador`, repo en `/home/orquestador/orquestador`.

## Estructura

- `server/src/index.ts`: entrada. Monta las rutas bajo `/api`, sirve `web/dist` y arranca el worker.
- `server/src/worker.ts`: procesa hasta diez tareas en paralelo y serializa las del mismo proyecto. Analiza con workspace de solo lectura, guarda versiones del plan y espera su aprobación por hash antes de ejecutar. Cancela con AbortController y al arrancar marca como interrumpidas las ejecuciones anteriores. Registra transiciones y sesiones para reanudar. `planificacion.ts` valida el JSON; `alcance-plan.ts` compara los cambios Git con los archivos del plan y detiene los desvíos para revisión, sin borrarlos.
- `server/src/runners/opencode.ts`: ejecuta `opencode run --format json` en su propio grupo de procesos (`setsid`), dentro del aislamiento de `runners/aislamiento.ts`, y solo con las variables de una lista permitida (no hereda `TELO_*` ni otras claves del servidor). Al cancelar o agotar el tiempo, termina el grupo completo (agente, herramientas y nietos).
- `server/src/runners/aislamiento.ts`: envuelve al agente en bubblewrap (`bwrap`). Solo ve su carpeta de trabajo (proyecto, o carpeta temporal de chat o tarea) y el estado de OpenCode. No ve el repo, `DATA_DIR`, otros proyectos, el resto del HOME ni los procesos del servidor.
- `server/src/routes/`: `chat`, `tasks`, `preferences`, `analytics`, `models`, `settings` (también el `PATCH` de conversaciones: modelo, esfuerzo, título y anclar), `projects`, `github`, `cuotas`, `runner` (estado del agente: CLI y bubblewrap).
- `server/scripts/respaldo.ts`: copia de la base (`VACUUM INTO`) y del espacio de trabajo. Ver la sección "Respaldos".
- `server/src/workspace.ts`: cada tarea de un proyecto Git trabaja en un clon propio (`DATA_DIR/tasks/<id>/repo`, rama `telo/<id8>`). Calcula el diff contra `base_commit` y aplica las aprobaciones de commit y push ligadas al hash del diff. La limpieza de clones antiguos conserva cambios, archivos ignorados y commits sin subida aprobada; los clones ligados a chats se conservan. Las aprobaciones están en `task_approvals`. Un proyecto sin Git debe inicializarse desde su configuración antes de ejecutar tareas.
- `server/src/routes/proyecto-config.ts`: configuración de remoto, autor y rama destino; comprobación de acceso a GitHub; contexto compartido y skills del proyecto. `skills-proyecto.ts` importa solo el documento `SKILL.md` de GitHub o guarda instrucciones pegadas; no descarga ni ejecuta scripts. La búsqueda usa los catálogos oficiales de Anthropic y OpenAI.
- `server/src/routes/repository-actions.ts`: solicitudes persistentes de init, commit, push y PR. Se muestran en el chat y solo se ejecutan al autorizar. La GitHub App vinculada en Ajustes emite tokens breves limitados a un repositorio y al permiso de la operación; las credenciales anteriores se conservan como compatibilidad. Inicializar crea un primer commit vacío sin añadir archivos. Crear PR necesita permiso de Pull requests y una subida aprobada del mismo commit.
- `server/src/ejecutar.ts`: punto único para correr un agente (chats y tareas). Aplica el modelo de respaldo ante 429 o 5xx, inyecta los secretos del proyecto, añade las instrucciones del proyecto y redacta la salida.
- `server/src/bus.ts`: canal interno de cambios (tareas, eventos y líneas de salida) que alimenta `GET /api/eventos-vivos` (SSE).
- `server/src/redaccion.ts`: quita de cualquier texto que sale del servidor (salida, errores, diffs, chats) los valores de los secretos, `TELO_CLAVE`, `TELO_CLAVE_CIFRADO` y patrones de credenciales.
- `server/src/git.ts`: única puerta a Git. Usa `gitSeguro` en cualquier repo que el agente pudo escribir (quita de `.git/config` filtros, `url.*`, `fsmonitor` y credenciales antes de operar).
- `server/src/github-app.ts`: firma el JWT de la App con una clave privada del servidor, valida instalaciones y emite tokens de instalación limitados al repo y al permiso necesario.
- `server/src/secretos.ts`: secretos por proyecto cifrados con AES-256-GCM (IV aleatorio, AAD = proyecto + nombre). Los valores nunca salen por la API. Los tokens de GitHub no llegan al agente; la ruta preferida es la credencial temporal de GitHub App.
- `server/src/programadas.ts`: planificador en el mismo proceso (cada 30 s). Crea tareas vencidas con `crearTarea`, no solapa ejecuciones de una misma programada y no lanza ráfagas al arrancar.
- `server/src/archivos-proyecto.ts`: lectura de archivos del proyecto. Resuelve enlaces, rechaza cualquier ruta que caiga en `.git`, abre con `O_NOFOLLOW` y limita el tamaño.
- `server/src/ocupacion.ts`: marca los proyectos ocupados por un chat o una tarea, para no leer su Git mientras el agente escribe.

## Aislamiento de los agentes

- Sin `bwrap` en el servidor, el agente no corre: la tarea o el chat fallan con un mensaje claro. Instalar en el VM con `sudo apt install bubblewrap`.
- `TELO_AISLAMIENTO=desactivado` lo apaga. Solo para desarrollo local, nunca en el VM.
- Si un proveedor necesita una clave como variable de entorno, se permite por nombre en `TELO_AGENTE_VARIABLES` (separadas por coma) en el archivo de entorno del VM. Nunca aplica a variables `TELO_*`.
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

```
cd server && bun test           # pruebas del servidor (server/tests), con DATA_DIR temporal
cd server && bun run test:worker # integración aislada; requiere Linux, bubblewrap y python3
```

Pruebas fuera del repo (en `scratchpad/`): la suite de gestión (`pruebas/gestion/prueba.ts`, 63 comprobaciones con un `opencode` falso y aislamiento real) y la revisión visual (`ui-final/revision.mjs`, 8 pantallas a 390 y 1440 px en oscuro y claro, sin errores de consola ni desborde de página).

Variables del VM que se agregan con esta fase (en `/etc/orquestador/orquestador.env`, nunca en el repo):
- `TELO_CLAVE_CIFRADO`: 32 bytes en base64 (`openssl rand -base64 32`). Sin ella, los secretos de proyecto no se guardan. No la pierdas: sin ella no se descifra nada.
- `TELO_PROYECTOS_DIR`: carpeta raíz de los proyectos (ya existía).
- `TELO_ESCUCHAR`: opcional. Por defecto `127.0.0.1`.
- `TELO_AGENTE_VARIABLES`: solo las claves que un proveedor necesita como variable de entorno (sin cambios).
- `TELO_GITHUB_APP_ID` y `TELO_GITHUB_APP_PRIVATE_KEY_PATH`: para GitHub App. La clave privada debe vivir fuera del repo, ser legible solo por `orquestador` y tener permisos `Contents` y `Pull requests` de escritura. Instala la App solo en los repositorios que Telo debe usar. Cada acción recibe un token de instalación limitado a un repo y al permiso requerido; no se guarda.

## Reglas de trabajo

1. **Extender, no duplicar.** Antes de crear un componente, función o endpoint, busca uno existente: `AppNav`, `DailyBars`, `ModelBars`, `errorText`, `api.*`, `getPreferences`. Los cambios son aditivos. No reescribas lo que ya funciona si no te lo pidieron.
2. **Idioma.** Textos de interfaz, mensajes de error y comentarios de negocio en español. Los identificadores siguen el estilo del archivo que editas.
3. **Tokens, no colores sueltos.** Colores y medidas salen de las variables de `web/src/styles.css`. El ámbar (`--signal`) solo marca estado activo o alerta.
4. **Móvil primero.** Margen lateral de 16 px y sin scroll horizontal a 390 px de ancho. Revisa siempre ese ancho.
5. **Errores legibles.** Los errores de API pasan por `errorText()`. El usuario ve español, no códigos.
6. **Migraciones.** Cada cambio de esquema es una migración nueva y numerada. No edites una migración que ya se aplicó.
7. **Secretos.** Nada de claves, tokens ni IPs en el repo. Las claves viven en el VM, en un archivo de entorno de systemd fuera del repo.
8. **Git.** Trabaja en ramas `feat/`, `fix/` o `docs/`. No hagas commit, push ni PR sin que el usuario lo pida. El usuario hace el merge.
9. **Versión.** Cada cambio terminado agrega una entrada a `cambios` en `web/src/cambios.json` (fecha, tipo, título y PR). Tipos: `grande` para capacidades nuevas del sistema o de infraestructura; `mediano` para funciones o pantallas; `minimo` para ajustes, correcciones y documentación. No escribas la versión a mano: `web/src/lib/version-sistema.ts` la calcula (cada 5 medianos sube el segundo número y cada 10 mínimos el tercero) y la barra lateral la muestra. No confundirla con `version.json` del build, que usa `lib/version.ts`.

## Skills recomendadas

- **Diseño de interfaz:** `impeccable` (`/impeccable`). Antes de cambiar UI, lee `DESIGN.md`.
- **Verificación de UI:** Playwright MCP. Toma capturas a 390 px y 1440 px antes de dar algo por terminado.
- **Gráficas:** `dataviz`. Cualquier gráfica nueva sigue sus reglas de color y accesibilidad.
- **Revisión antes de PR:** `engineering:code-review`.
- **Bugs:** `engineering:debug`.
- **Opcional:** `caveman` reduce los tokens de salida en 12 a 23 %. No lo uses en documentación ni en textos de diseño.

## Acceso (referencia)

- Desde la PC: `ssh -L 3000:localhost:3000 -L 9090:localhost:9090 -i <tu_clave> orquestador@<IP>`. Luego abre `http://127.0.0.1:3000`. El puerto 9090 es Cockpit.
- Actualizar el VM a mano: `cd ~/orquestador && git switch main && git pull --ff-only && (cd server && bun install --frozen-lockfile) && (cd web && bun install --frozen-lockfile && bun run build) && sudo systemctl restart orquestador`. Con el timer de `deploy/` esto ocurre solo; ver `deploy/README.md`.
- No abras puertos en Azure. El acceso remoto es por Tailscale (fase 9 de `PLAN.md`).

## Seguridad

- El agente corre en bubblewrap y puede escribir en su carpeta de trabajo, incluido `.git`. Todo lo que el servidor haga con Git sobre esos repos pasa por `gitSeguro`. Un repo con `.git` que no sea carpeta real se rechaza.
- Nada sensible sale del servidor: los valores de secretos, claves, tokens y URLs con credenciales se redactan antes de guardar o de enviar (salida, eventos, errores, diffs, chats). Los errores 500 no muestran rutas ni trazas.
- Antes de un commit se escanea el diff: si tiene un secreto conocido o un archivo sensible (`.env`, llaves), la aprobación se rechaza con `secreto_detectado` o `archivo_sensible`, sin mostrar el valor.
- El push solo va a `github.com` por HTTPS. El token sale solo por variable de entorno al helper de credenciales, nunca por argumentos ni por la URL.
- Variables que el agente no puede sobrescribir: `PATH`, `HOME`, `LD_*`, `GIT_*`, `TELO_*`, `NODE_*`, `PYTHON*`, `BASH_ENV`, `ENV`, `IFS`, `TERM`, `LANG`, `SSL_CERT_FILE`, proxies y `OPENCODE_*`.
- Un secreto inyectado sí lo ve el agente de ese proyecto (lo necesita para trabajar). Guarda solo lo que el agente necesita.
- El servidor escucha en `127.0.0.1` (`TELO_ESCUCHAR` lo cambia). La IP de conexión viene del socket; `CF-Connecting-IP`, `X-Forwarded-For` y `X-Real-IP` solo se aceptan si el peer figura en `TELO_PROXIES_CONFIABLES` (IPs exactas, separadas por coma) y el proxy sobrescribe esas cabeceras. Cabeceras: CSP estricta sin scripts en línea, `X-Frame-Options: DENY`, `nosniff`. Cuerpos de petición de máximo 64 KB. El SSE tiene límite de conexiones y memoria por cliente.
- Pruebas de seguridad: `server/tests/seguridad.test.ts`. Ver también la sección de comandos.

## Respaldos

- En el VM, `deploy/orquestador-respaldo.timer` corre cada día a las 03:30 UTC `server/scripts/respaldo.ts`, con el servicio encendido. Guarda en `/home/orquestador/respaldos`: `orquestador-<sello>.db` (copia con `VACUUM INTO`, revisada con `integrity_check`) y `espacio-<sello>.tar.gz` (`chat-workspace` y `tasks`). Conserva las últimas `TELO_RESPALDOS_CONSERVAR` (14) de cada tipo.
- Antes de aplicar migraciones a una base con datos, el servidor guarda una copia en `DATA_DIR/respaldos-migracion` (`antes-<migración>-<sello>.db`). Esa carpeta no la copia el timer: revísala antes de borrarla.
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
- Hay una entrada nueva en `web/src/cambios.json` (regla 9).
