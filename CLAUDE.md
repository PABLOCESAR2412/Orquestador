# Orquestador: instrucciones para agentes de desarrollo

Lee este archivo antes de tocar código. Complementos: `SEGUIMIENTO.md` (hoja de ruta, pendientes e historial), `DESIGN.md` (sistema visual) y `AGENTS.md` (roles de los agentes que el producto lanza para cada tarea).

## Qué es

Orquestador es una app personal para lanzar tareas a agentes de IA (OpenCode hoy; Codex y Google/agy después) y dejarlas corriendo en un VM de Azure, para que sigan aunque la PC o el teléfono estén apagados. Tiene chat, cola de tareas en segundo plano, analíticas de costo y uso, y ajustes. Se instala como PWA.

Es de uso personal, con un solo usuario y sin cuentas. Tiene login con `TELO_CLAVE`. El acceso remoto es por Tailscale, sin puertos públicos (fase 9 de `SEGUIMIENTO.md`).

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
- `server/src/runners/aislamiento.ts`: envuelve al agente en bubblewrap (`bwrap`). Ve su carpeta de trabajo, herramientas y skills globales de solo lectura. OpenCode y Codex guardan estado en perfiles persistentes separados por conversación o tarea. Codex necesita que su `CODEX_HOME` sea escribible para iniciar y reanudar sesiones; su autenticación y configuración global se montan en solo lectura y la política administrada `/etc/codex/requirements.toml` impide que los comandos del agente lean las cuatro rutas visibles de `auth.json` y `config.toml`. Codex usa `workspace-write` dentro del límite externo de Bubblewrap; no se debe restaurar `--dangerously-bypass-approvals-and-sandbox`. No ve el repo de Telo, el resto de `DATA_DIR`, otros proyectos, el resto del HOME, los procesos del servidor, `/etc/orquestador` ni la clave privada de la GitHub App (`TELO_OCULTAR_EXTRA` añade más rutas ocultas). La red usa `--unshare-net`: cada ejecución tiene loopback propio y un proxy por socket Unix. `runners/red-agente.ts` bloquea destinos privados/metadata, fija la IP después de resolver DNS y permite web pública en 80/443. OpenCode usa rutas de inferencia limitadas a los modelos del turno: las claves reales permanecen en Telo, nunca en su entorno ni montajes. OAuth y endpoints personalizados sin broker específico fallan de forma cerrada. `/run` queda oculto, incluido Docker; el render usa Chrome local.
- `server/src/routes/`: `chat`, `tasks`, `preferences`, `analytics`, `models`, `settings` (también el `PATCH` de conversaciones: modelo, esfuerzo, título y anclar), `projects`, `github`, `conexiones` (servidores MCP remotos con tokens cifrados), `cuotas`, `runner` (estado del agente: CLI y bubblewrap).
- `server/scripts/respaldo.ts`: copia de la base (`VACUUM INTO`) y del espacio de trabajo. Ver la sección "Respaldos".
- `server/src/workspace.ts`: cada tarea de un proyecto Git trabaja en un clon propio (`DATA_DIR/tasks/<id>/repo`, rama `telo/<id8>`). Calcula el diff contra `base_commit` y aplica las aprobaciones de commit y push ligadas al hash del diff. La limpieza de clones antiguos conserva cambios, archivos ignorados y commits sin subida aprobada; los clones ligados a chats se conservan. Las aprobaciones están en `task_approvals`. Un proyecto sin Git debe inicializarse desde su configuración antes de ejecutar tareas.
- `server/src/routes/proyecto-config.ts`: configuración de remoto, autor y rama destino; comprobación de acceso a GitHub; contexto compartido y skills del proyecto. `skills-proyecto.ts` importa `SKILL.md` o instrucciones pegadas. UI/UX Pro Max también importa datos, referencias y cuatro scripts permitidos; no ejecuta contenido al instalar. La búsqueda usa los catálogos oficiales de Anthropic y OpenAI.
- `server/src/routes/repository-actions.ts`: solicitudes persistentes de init, commit, push y PR. Se muestran en el chat y solo se ejecutan al autorizar. La GitHub App vinculada en Ajustes emite tokens breves limitados a un repositorio y al permiso de la operación; las credenciales anteriores se conservan como compatibilidad. Inicializar crea un primer commit vacío sin añadir archivos. Crear PR necesita permiso de Pull requests y una subida aprobada del mismo commit. Al autorizar una subida, la tarjeta siempre pregunta el destino: la rama base del proyecto directo (sin PR) o la rama de la tarea y después el PR; si el usuario eligió rama, el PR se prepara aunque el plan no lo pidiera, y si eligió base no se prepara PR ni merge.
- `server/src/ejecutar.ts`: punto único para correr un agente (chats y tareas). Aplica respaldos, prepara perfiles por conversación y perfiles temporales por revisor, selecciona skills desde la solicitud actual y redacta la salida. Los runners filtran claves por integración; los análisis no reciben secretos operativos del proyecto ni MCP ajenos al endpoint oficial de Context7. `orquestacion-chat.ts` comparte la auditoría gestionada entre chats libres y el analizador del worker; solo delega ante petición explícita. Los auxiliares heredan el modelo del turno; las selecciones guardadas solo se utilizan al activar explícitamente modelos personalizados en Supervisor.
- `server/src/bus.ts`: canal interno de cambios (tareas, eventos y líneas de salida), disponible por SSE y por sondeo corto. La interfaz usa `GET /api/eventos-vivos/poll` para evitar cortes de proxies HTTP/2.
- `server/src/respaldos-cuota.ts`: conserva cuotas agotadas por modelo y proyecto durante 15 minutos. La política fallbackMode de preferencias es selected por defecto: no sustituye el modelo elegido. configured permite respaldos guardados y automatic añade hasta tres gratuitos conectados; ambos requieren selección explícita. No consulta modelos para sondear saldo. Las revisiones guardan modelo solicitado y real para reanudarse sin repetir trabajo tras una sustitución. El uso de OpenCode con ID estable de sesión/paso se persiste una sola vez, incluso al reanudar.
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
- `web/src/pages/`: `chat`, `tasks`, `analytics`, `settings`, `proyectos`, `proyecto`, `servidor` y `login`. `/estado` redirige a `/servidor`; las rutas están en `web/src/router.tsx`.
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

Las suites `bun test` y `bun run test:worker` son la verificación versionada. Los harnesses visuales y de gestión citados en los documentos de fase fueron artefactos locales de aquellas revisiones y ya no están incluidos en este checkout.

Variables del VM que se agregan con esta fase (en `/etc/orquestador/orquestador.env`, nunca en el repo):
- `TELO_CLAVE_CIFRADO`: 32 bytes en base64 (`openssl rand -base64 32`). Sin ella, los secretos de proyecto no se guardan. No la pierdas: sin ella no se descifra nada.
- `TELO_PROYECTOS_DIR`: carpeta raíz de los proyectos (ya existía).
- `TELO_ESCUCHAR`: opcional. Por defecto `127.0.0.1`.
- `TELO_AGENTE_VARIABLES`: solo las claves que un proveedor necesita como variable de entorno (sin cambios).
- `TELO_GITHUB_APP_ID` y `TELO_GITHUB_APP_PRIVATE_KEY_PATH`: para GitHub App. La clave privada debe vivir fuera del repo, ser legible solo por `orquestador` y tener permisos `Contents` y `Pull requests` de escritura. Instala la App solo en los repositorios que Telo debe usar. Cada acción recibe un token de instalación limitado a un repo y al permiso requerido; no se guarda.

El servicio diario de respaldos puede leer credenciales separadas desde `/etc/orquestador/r2-backups.env`. Usa un bucket privado y limita el token S3 de R2 a lectura y escritura en ese bucket. No guardes estas claves en el repo ni en el archivo de entorno del servidor web.

## Reglas de trabajo

Integraciones nuevas: `antigravity/*` ejecuta `agy` con su sesión SSH de archivos y sandbox nativo obligatorio dentro del aislamiento de Telo. No reutiliza Gemini API ni exporta keyrings; una credencial que necesita renovación se renueva por SSH. `cloudflare-workers-ai/*` usa Workers AI con Account ID y token cifrado, separados del login Wrangler. `seguimiento-pr.ts` revisa publicaciones aprobadas y prepara correcciones locales; toda nueva publicación conserva su autorización de diff/SHA.

1. **Extender, no duplicar.** Antes de crear un componente, función o endpoint, busca uno existente: `AppNav`, `DailyBars`, `ModelBars`, `errorText`, `api.*`, `getPreferences`. Los cambios son aditivos. No reescribas lo que ya funciona si no te lo pidieron.
2. **Idioma.** Textos de interfaz, mensajes de error y comentarios de negocio en español. Los identificadores siguen el estilo del archivo que editas.
3. **Tokens, no colores sueltos.** Colores y medidas salen de las variables de `web/src/styles.css`. El ámbar (`--signal`) solo marca estado activo o alerta.
4. **Móvil primero.** Margen lateral de 16 px y sin scroll horizontal a 390 px de ancho. Revisa siempre ese ancho.
5. **Errores legibles.** Los errores de API pasan por `errorText()`. El usuario ve español, no códigos.
6. **Migraciones.** Cada cambio de esquema es una migración nueva y numerada. No edites una migración que ya se aplicó.
7. **Secretos.** Nada de claves, tokens ni IPs en el repo. Las claves viven en el VM, en un archivo de entorno de systemd fuera del repo.
8. **Git.** Trabaja en ramas `feat/`, `fix/` o `docs/`. No hagas commit, push ni PR sin que el usuario lo pida. El usuario hace el merge.
9. **Versión.** Cada cambio terminado agrega una entrada a `cambios` en `web/src/cambios.json` (fecha, tipo, título y PR). Tipos: `grande` para capacidades nuevas del sistema o de infraestructura; `mediano` para funciones o pantallas; `minimo` para ajustes, correcciones y documentación. No escribas la versión a mano: `web/src/lib/version-sistema.ts` la calcula (cada 5 medianos sube el segundo número y cada 10 mínimos el tercero) y la barra lateral la muestra. No confundirla con `version.json` del build, que usa `lib/version.ts`.

10. **Seguimiento.** Registra hallazgos, cambios de fase y su resolución en `SEGUIMIENTO.md`. Marca cada punto como hecho solo después de ejecutar la prueba citada; conserva los pendientes operativos sin evidencia. No abras más documentos de fase o auditoría separados.

## Skills recomendadas

- **Diseño de interfaz:** `impeccable` (`/impeccable`). Antes de cambiar UI, lee `DESIGN.md`.
- **Verificación de UI:** Playwright MCP. Toma capturas a 390 px y 1440 px antes de dar algo por terminado.
- **Gráficas:** `dataviz`. Cualquier gráfica nueva sigue sus reglas de color y accesibilidad.
- **Revisión antes de PR:** `engineering:code-review`.
- **Bugs:** `engineering:debug`.
- **Opcional:** `caveman` reduce los tokens de salida en 12 a 23 %. No lo uses en documentación ni en textos de diseño.

## Acceso (referencia)

- Desde la PC: `ssh -L 3000:localhost:3000 -L 9090:localhost:9090 -i <tu_clave> orquestador@<IP>`. Luego abre `http://127.0.0.1:3000`. El puerto 9090 es Cockpit.
- Actualizar el VM: seguir el drenado y la parada descritos en `deploy/README.md`; no cambiar fuentes ni dependencias con el servicio atendiendo peticiones. El timer usa el mismo protocolo.
- No abras puertos en Azure. El acceso remoto es por Tailscale (fase 9 de `SEGUIMIENTO.md`).

## Seguridad

- `TELO_SIN_CLAVE=1` es solo para desarrollo local: exige escucha loopback y rechaza hosts no locales y cabeceras habituales de proxy. No publicar ese puerto mediante Tailscale Serve, túneles o proxies, incluso si eliminan sus cabeceras; en la VM usa `TELO_CLAVE`.
- El agente corre en bubblewrap y escribe en su carpeta de trabajo; `.git` se monta de solo lectura y las operaciones Git del servidor pasan por `gitSeguro`. Un repo con `.git` que no sea carpeta real se rechaza.
- Nada sensible sale del servidor: los valores de secretos, claves, tokens y URLs con credenciales se redactan antes de guardar o de enviar (salida, eventos, errores, diffs, chats). Los errores 500 no muestran rutas ni trazas.
- Antes de un commit se escanea el diff: si tiene un secreto conocido o un archivo sensible (`.env`, llaves), la aprobación se rechaza con `secreto_detectado` o `archivo_sensible`, sin mostrar el valor.
- El push solo va a `github.com` por HTTPS. El token sale solo por variable de entorno al helper de credenciales, nunca por argumentos ni por la URL.
- Variables que el agente no puede sobrescribir: `PATH`, `HOME`, `LD_*`, `GIT_*`, `TELO_*`, `NODE_*`, `PYTHON*`, `BASH_ENV`, `ENV`, `IFS`, `TERM`, `LANG`, `SSL_CERT_FILE`, proxies y `OPENCODE_*`.
- El obrero recibe secretos operativos solo cuando se confirman por nombre en su plan aprobado. El agente puede leer los valores autorizados. Cloudflare Pages escanea el contenido estático antes de invocar Wrangler.
- El servidor escucha en `127.0.0.1` (`TELO_ESCUCHAR` lo cambia). La IP de conexión viene del socket; `CF-Connecting-IP`, `X-Forwarded-For` y `X-Real-IP` solo se aceptan si el peer figura en `TELO_PROXIES_CONFIABLES` (IPs exactas, separadas por coma) y el proxy sobrescribe esas cabeceras. Cabeceras: CSP estricta sin scripts en línea, `X-Frame-Options: DENY`, `nosniff`. Cuerpos de petición de máximo 64 KB. El SSE tiene límite de conexiones y memoria por cliente; la interfaz usa el endpoint de sondeo corto.
- Pruebas de seguridad: `server/tests/seguridad.test.ts`. Ver también la sección de comandos.

## Respaldos

### Espacio de dependencias

`server/scripts/optimizar-disco.ts` enumera dependencias ignoradas de tareas terminadas con lockfile; `--aplicar` las retira solo si `orquestador.service` está inactivo. Ejecutar como el usuario del servicio, nunca con sudo Bun. Conserva tareas no terminadas, Git, código, entregables y perfiles de sesiones. `.opencode` requiere su propio lockfile. El modo simulación no borra dependencias, aunque la puerta Git sanea la configuración local como en las otras operaciones del servidor.

Tras desplegar y sin agentes externos trabajando en esos clones:

```bash
cd /home/orquestador/orquestador/server
bun scripts/optimizar-disco.ts
sudo systemctl stop orquestador.service
bun scripts/optimizar-disco.ts --aplicar
sudo systemctl start orquestador.service
df -h /
```

El CLI no es automático ni elimina clones completos. Ajustes → Almacenamiento añade análisis, limpieza manual en vivo y política automática opcional: umbral 75–95 %, intervalo 6–168 horas y antigüedad 1–90 días. Está desactivada por defecto; valores iniciales 85 %, 24 horas y 7 días. Comprueba cada minuto y limita reintentos con disco alto a una hora. Serializa con las operaciones de la tarea y comprueba ocupación otra vez antes de retirar cada carpeta. Mueve las dependencias fuera del repo de forma atómica antes de eliminarlas asíncronamente; recupera retiros interrumpidos en posteriores limpiezas de esa tarea. No detiene servicios ni agentes. La configuración y el último resultado se guardan en app_settings. Las dependencias deben reconstruirse con el lockfile antes de volver a probar/compilar; el contrato del agente lo indica, sin ejecutar instalaciones fuera del aislamiento. Si se modificaron paquetes manualmente dentro de `node_modules`, conservar esos cambios antes de aplicar: Git no detecta modificaciones ignoradas. Los respaldos nuevos omiten solo los mismos directorios verificables; conservan manifiestos y lockfiles, pero una restauración requiere acceso a sus paquetes. Los respaldos antiguos no se modifican.

- En el VM, `deploy/orquestador-respaldo.timer` corre cada día a las 03:30 UTC `server/scripts/respaldo.ts`. Comparte `flock` con el actualizador, cierra la admisión y espera a que terminen agentes, clonados, instalaciones y limpiezas; si siguen activos, pospone la copia. La lectura del chat y la cancelación siguen disponibles. Guarda en `/home/orquestador/respaldos`: `orquestador-<sello>.db` (foto `VACUUM INTO`, revisada con `integrity_check`) y `espacio-<sello>.tar.gz` (chat-workspace, tasks, entregables, chat-attachments, perfiles-opencode, perfiles-codex, perfiles-subagente, proyectos registrados e inventario.json). Las bases de sesiones se fotografían también con SQLite, sin copiar un WAL desconectado. Solo se omite caché reconstruible en perfiles. La pausa termina antes de subir a R2. Sin R2 conserva las últimas `TELO_RESPALDOS_CONSERVAR` (14) de cada tipo. Con R2 sube y verifica los últimos `TELO_R2_RESPALDOS_CONSERVAR` conjuntos (1 por defecto), elimina conjuntos remotos antiguos y reduce las copias del VPS a `TELO_R2_RESPALDOS_LOCALES` (1 por defecto); un error de subida o validación conserva los archivos locales. Un conjunto incompleto no se publica en R2.
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
- Para usar R2, crea un bucket privado y un token S3 con lectura y escritura limitado a ese bucket. Guarda `TELO_R2_ACCOUNT_ID`, `TELO_R2_BUCKET`, `TELO_R2_ACCESS_KEY_ID`, `TELO_R2_SECRET_ACCESS_KEY`, `TELO_R2_PREFIX=respaldos`, `TELO_R2_RESPALDOS_CONSERVAR=1` y `TELO_R2_RESPALDOS_LOCALES=1` en `/etc/orquestador/r2-backups.env`, con dueño `root:root` y permisos `0600`. La primera ejecución verifica el conjunto actual en R2 antes de depurar las copias locales antiguas; la PC seguirá pudiendo copiar la última por Tailscale. Si necesitas guardar todo solo en R2, usa `TELO_R2_RESPALDOS_LOCALES=0` y desactiva la copia programada por Tailscale. Después de crear o cambiar el archivo, ejecuta `sudo systemctl daemon-reload` y prueba el servicio; consulta el diario para confirmar la cantidad de conjuntos conservados.
- Programar la copia en la PC (una vez, en PowerShell). La hora debe ser local y posterior a las 03:30 UTC:
  ```
  $accion = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\ruta\copiar-respaldo-pc.ps1" -Servidor orquestador@NOMBRE-DEL-VM -Clave "C:\ruta\TU_CLAVE"'
  Register-ScheduledTask -TaskName "Telo respaldo" -Action $accion -Trigger (New-ScheduledTaskTrigger -Daily -At 06:00) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
  ```
- Restaurar con el servicio parado y conservar primero una copia del estado actual. Extraer el tar en una carpeta vacía de revisión; comprobar `inventario.json`. Copiar sus carpetas de datos/perfiles a `server/data` y la `.db` elegida a `server/data/orquestador.db`, retirando los WAL/SHM anteriores de esa base. Cada `proyectos/<id>` debe recuperarse en la ruta `origen` del inventario: `projects.repo_path` conserva esa ubicación. Si se elige otra raíz, actualizar esos registros de forma transaccional antes de arrancar y ajustar `TELO_PROYECTOS_DIR`. No dejar los repos restaurados solo dentro de `server/data/proyectos`, porque la aplicación seguiría buscando su ruta registrada. Los respaldos antiguos sin inventario mantienen su alcance original. Ver la recuperación operativa pendiente en `SEGUIMIENTO.md`.

## Definición de terminado

- `bun run build` pasa.
- Si hay interfaz: revisada a 390 px y 1440 px, sin errores de consola.
- Los cambios están en una rama, con una descripción de lo que se probó.
- Hay una entrada nueva en `web/src/cambios.json` (regla 9).
