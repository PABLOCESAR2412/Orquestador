# Fase 2: seguimiento de cambios

> Registro histórico. Los estados, cantidades y harnesses de esta fase describen la revisión original; las rutas `scratchpad/` eran locales y no están en el repo actual.

Rama: `feat/seguir-tras-cuota` (creada desde `feat/proyectos-tarjetas`, commit 507f01c).
La fase A está en commit `7a93c2b` y subida a `origin`. La fase B está en el árbol de trabajo, sin commit. No hay PR.

Leyenda: [x] hecho y verificado · [~] hecho, pendiente de confirmar en el VM · [ ] pendiente

---

## A. Detener al agotarse la cuota y botón "Seguir"  ✅ terminada

### A1. Servidor

- [x] `server/src/runners/opencode.ts`: clase `ErrorAgente` con `detalleProveedor`, y función `detalleDelProveedor()` exportada. Usa el evento de error del proveedor o, si no hay, la cola de `stderr` sin rutas. Así una carpeta llamada "cuota" o "saldo" no marca cuota por error.
- [x] `server/src/ejecutar.ts`:
  - `PATRON_CUOTA`, `ErrorCuota(modelo, sessionId)`, `esErrorDeCuota()`. Solo mira `detalleProveedor`.
  - `promptContinuacion(prompt)`: prefijo "Continúa donde te quedaste…".
  - `ejecutarAgente`: el `catch` convierte en `ErrorCuota` los errores de cuota, también cuando falla el modelo de respaldo.
- [x] `server/src/db/index.ts`: migración `020_cuota_seguir`. Reconstruye `tasks` (estado `sin_cuota`, columnas `modelo_agotado` y `continuar`) y añade `conversations.cuota_modelo`.
- [x] `server/src/worker.ts`: `pausarPorCuota()`, `promptDeFase()` y `cancelTask()` acepta `sin_cuota`.
- [x] `server/src/routes/tasks.ts`: `POST /api/tasks/:id/seguir` (body `{model?, effort?}`). Rechaza el mismo modelo con `modelo_sin_cambio`.
- [x] `server/src/routes/chat.ts`: `ejecutarTurno()` compartido entre enviar y seguir; `POST /api/conversations/:id/seguir`; `GET /api/conversations` devuelve `cuota_modelo`; un envío exitoso lo limpia.
- [x] `server/src/eventos.ts` (tipos `sin_cuota`, `seguida`) y `server/src/routes/analytics.ts` (`sin_cuota` en `TASK_STATUSES`).

### A2. Web

- [x] `web/src/api.ts`: tipos nuevos y `api.continueTask()`, `api.continueChat()`.
- [x] `web/src/lib/model.ts`: etiquetas y mensajes en español.
- [x] `web/src/components/cuota-aviso.tsx` (nuevo): `AvisoCuota`, compartido por tareas y chats.
- [x] `web/src/styles.css`: bloque `.cuota-aviso` y `.cuota-selector` al final del archivo. Ámbar solo en el borde.
- [x] `web/src/pages/tasks.tsx`: estado "Sin cuota · elige modelo", cancelar desde la tarjeta, aviso y selector de modelo en el detalle, y el error genérico oculto en `sin_cuota`.
- [x] `web/src/pages/chat.tsx`: `cuota_agotada` en `GUARDADO_EN_ERROR` (el mensaje no vuelve al borrador), `sendError` no repite el aviso, mutación `seguirChat`, aviso debajo de la conversación.
- [x] `web/src/lib/notificaciones.ts` (aviso de sistema) y `web/src/components/tarea-pasos.tsx` (paso final "Sin cuota").
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`).

### A3. Pruebas

- [x] `server/tests/cuota.test.ts`: 13 pruebas (clasificación, migración, rechazos de seguir).
- [x] Punta a punta con servidor real y `opencode` falso (harness local no versionado): 25 de 25 en esa revisión.
- [x] Revisión visual con un harness local no versionado a 390 y 1440 px, claro y oscuro.

### A4. Problemas encontrados y resueltos

- La clasificación de cuota leía el mensaje completo, que incluye rutas del servidor. Una carpeta "cuota-…" hacía que cualquier fallo se viera como cuota. Ahora solo cuenta lo que dijo el proveedor (ver A1).
- El selector de modelo del detalle de tarea abría fuera de la pantalla: el contenedor no era posicionado. Se corrigió con `.cuota-selector`.
- Las capturas al principio mostraban la versión anterior porque `web/dist` no se había reconstruido. Regla: reconstruir antes de revisar.

### A5. Pendiente de confirmar en el VM

- [~] La detección de cuota usa patrones (429, "rate limit", "quota", "usage limit", "insufficient", "saldo", etc.). El texto exacto que devuelve OpenCode con un modelo sin cuota no está verificado. Hay que comprobarlo con un modelo real agotado. Si el texto no coincide, la tarea queda en `failed` como antes: no hay regresión, pero no se detiene con aviso.
  - Cómo: en el VM, provocar una cuota agotada con un modelo de prueba y revisar `task_events` y la salida de la tarea (`journalctl -u orquestador`).
- [x] El respaldo ante saturación se decide por un estado HTTP transitorio explícito en `esErrorTransitorioDelProveedor`; la regla amplia antigua se retiró.

---

## B. Claves de Groq, NVIDIA y Gemini  🟡 hecha en servidor y web; falta confirmar en el VM

### Nombres de variable

- Groq: `GROQ_API_KEY`. Confirmado en la documentación de OpenCode.
- Gemini: se envían **dos** variables, `GOOGLE_GENERATIVE_AI_API_KEY` y `GEMINI_API_KEY`. La nota anterior que daba solo `GEMINI_API_KEY` venía de un mirror de la versión antigua en Go de OpenCode; la versión actual probablemente usa `GOOGLE_GENERATIVE_AI_API_KEY` (no verificado). Enviar las dos evita depender de la versión. Confirmar en el VM con `opencode models` (id de proveedor `google`).
- NVIDIA: `NVIDIA_API_KEY`. Solo aparece en un artículo de terceros: **no confirmado**. Ver B-VM.

### Servidor

- [x] `server/src/claves-proveedor.ts` (nuevo): almacenamiento cifrado con AES-256-GCM, AAD `proveedor:<id>`, misma clave maestra `TELO_CLAVE_CIFRADO` que los secretos. Nunca devuelve valores. `entornoProveedores()` entrega las variables al agente y a `opencode models`.
- [x] `server/src/db/index.ts`: migración `021_claves_proveedor` (tabla `provider_keys`).
- [x] `server/src/routes/claves-proveedor.ts` (nuevo): `GET /api/claves-proveedor`, `PUT /api/claves-proveedor/:id` (body `{valor}`), `DELETE /api/claves-proveedor/:id`. Códigos de error: `proveedor_desconocido`, `clave_proveedor_invalida`, `proveedor_sin_clave`, `secretos_no_configurados`. Cada cambio invalida la lista de modelos. Montado en `server/src/index.ts`.
- [x] `server/src/ejecutar.ts`: las claves entran como `extraEnv` de cada ejecución y se ocultan en la salida (`valoresAOcultar`). Si un secreto de proyecto tiene el mismo nombre, gana el del proyecto.
- [x] `server/src/models.ts`: `opencode models` recibe las claves (`entornoDelCli()`); `invalidarModelos()`. Nunca recibe variables `TELO_*`.
- [x] `server/src/routes/providers.ts`: cada proveedor dice `configured`, `enAgente`, `guardable`, `guardada`, `variable`. Nunca el valor. Groq, NVIDIA y Gemini quedan `implemented: true`.

### Web

- [x] `web/src/api.ts`: tipo `ProviderStatus` con `guardable` y `guardada`; `api.setProviderKey()` y `api.deleteProviderKey()`.
- [x] `web/src/pages/settings.tsx`: en Ajustes > Proveedores IA, cada proveedor guardable tiene un campo de clave (`CampoClave`) con Mostrar/Ocultar, Guardar y Quitar. Enter guarda sin enviar el formulario de preferencias.
- [x] `web/src/lib/model.ts`: mensajes en español para `proveedor_desconocido`, `clave_proveedor_invalida` y `proveedor_sin_clave`.
- [x] `web/src/styles-ajustes.css`: `.aj-clave-fila`.
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`).

### Pruebas

- [x] `server/tests/claves-proveedor.test.ts` (nuevo): 21 pruebas. Guardar y leer, valor cifrado en la base, sin clave maestra, clave que no descifra, validación, estado sin valores, redacción, rutas y `GET /providers`.
- [x] `server/tests/entorno-proveedores.test.ts` (nuevo): 3 pruebas de punto a punto con un `opencode` falso. El agente y `opencode models` reciben `GROQ_API_KEY`; ninguno recibe `TELO_*`; la clave que el agente imprime sale oculta en su respuesta.
- [x] `bun test` del servidor: 203 pasan, 0 fallan.
- [x] `tsc --noEmit` del servidor y `bun run build` de la web: pasan.
- [x] Revisión visual con un harness local no versionado a 390 y 1440 px, claro y oscuro: sin desborde horizontal ni errores de consola.

### Pendiente de confirmar en el VM (B-VM)

- [ ] NVIDIA: con `NVIDIA_API_KEY` guardada, ejecutar `opencode models --verbose` (con el mismo entorno del servicio) y comprobar que aparecen modelos `nvidia/...`. Si el nombre de variable o el proveedor son otros, corregir `PROVEEDORES_CON_CLAVE` en `server/src/claves-proveedor.ts` y la lista de `server/src/routes/providers.ts`.
- [ ] Gemini: confirmar el id de proveedor que usa OpenCode (`google` u otro) y que `GEMINI_API_KEY` basta para que aparezcan sus modelos.
- [ ] Groq: comprobar que aparecen modelos `groq/...` tras guardar la clave.

Cómo hacerlo en el VM:
1. Confirmar que `TELO_CLAVE_CIFRADO` está en `/etc/orquestador/orquestador.env`. Sin ella, Ajustes responde "secretos no configurados".
2. Entrar a Ajustes > Proveedores IA, pegar la clave en cada proveedor y pulsar Guardar.
3. Revisar la lista de modelos en Ajustes o en el selector del chat.

### Riesgos conocidos

- Las claves guardadas llegan a **todos** los agentes, no solo al proveedor que las usa. Un modelo de Groq podría leer la clave de NVIDIA si el agente la busca en su entorno. Mejora posible: pasar a cada agente solo las claves del proveedor de su modelo.
- La app recorta los espacios de los extremos antes de enviar. Un valor con espacios o saltos por dentro se rechaza con `clave_proveedor_invalida`.

---

## C. "Generar análisis": memoria y skills del proyecto  ⏳ no empezada

- [ ] Ejecución del agente que lea el proyecto y devuelva JSON con memoria y skills propuestas. Reusar `ejecutarAgente` con `aprender` (ver `server/src/memoria.ts`: `guardarMemoria`, `extraerMemoria`).
- [ ] Migración nueva: tabla `project_skills` (nombre, descripción, contenido, estado propuesto/aceptado, fecha). Rutas en `server/src/routes/projects.ts`.
- [ ] Revisión antes de guardar: el usuario acepta o descarta cada propuesta.
- [ ] Sin skills: aviso "Instalar skills" con enlace a la fuente. Antes de escribir el enlace, verificar que `skills.sh` existe y cuál es el comando de instalación.
- [ ] UI: `web/src/components/proyecto-skills.tsx` (hoy es placeholder) y la sección Memoria en `web/src/pages/proyecto.tsx`.

---

## D. Claude y Codex (y login de cuenta de Gemini)  🛑 espera decisión tuya

Pregunta abierta: ¿inicio de sesión de cuenta en el VM (como en las capturas: abrir enlace y pegar código) o clave de API?

- Login de cuenta: guarda tokens de terceros en el VM y requiere revisión de seguridad. Plan distinto.
- Clave de API: más simple, pero Claude y Codex sin costo solo se logran con cuenta, según lo que pediste.

No se codifica hasta decidirlo.

---

## Orden recomendado

1. En el VM, confirmar el texto real de cuota de OpenCode (A5) y los nombres de variable de NVIDIA y Gemini (B-VM).
2. C: "Generar análisis".
3. D: esperar tu decisión.
4. Commit y PR solo cuando lo pidas.

## E. Correcciones tras probar en el VM  🟡 en curso (rama `feat/seguir-tras-cuota`)

Estado detallado en `FASE3.md`. Resumen:

- [x] **Chat en segundo plano** (`6dddd05`). El turno ya no depende de la petición HTTP. La web comprueba si un envío llegó antes de devolver el texto al compositor. Verificado en navegador.
- [x] **Barra lateral.** Sin enlace Chat; los chats de proyecto aparecen con su nombre.
- [x] **Modelos de Groq, NVIDIA y Gemini** visibles cuando su clave llega al CLI. Gemini envía dos variables. Ajustes muestra cuántos modelos ve OpenCode y avisa si no ve ninguno. Pendiente en el VM: confirmar `google` y `NVIDIA_API_KEY` con `opencode models`.
- [x] **Vista de proyectos.** Métricas desde `GET /api/projects` y acciones en iconos de 40 px.
- [x] **Memoria del proyecto editable** a mano, con redacción y límite.
- [~] **Estado y registros del servidor** en Ajustes. Hecho: estado de la unidad y registros con redacción. Requiere en el VM: `usermod -aG systemd-journal orquestador` (ver `deploy/README.md`). Pendiente: gasto de Azure (decisión del usuario).
- [ ] **Skills configurables** (tarea 7). Bloqueada: hay que confirmar en el VM dónde lee OpenCode las skills, y decidir si son globales o por proyecto.
- [ ] **Claves y botón "Instalar"** (tarea 9). Bloqueada: instalar software en el VM necesita aprobación explícita.
- [ ] **Codex, Gemini y Claude gratis** (tarea 10). Bloqueada: decidir si se acepta el login de dispositivo de Codex en el VM y si Claude se conecta solo con clave de API.

Corrección de la nota de Gemini: ver sección B.

### Estado tras la fase 3 (tareas 7, 9 y 10)

- Skills globales y por proyecto, editables desde Ajustes y desde el proyecto. Pendiente en el VM: confirmar que OpenCode las lista.
- OpenCode se puede instalar desde Ajustes con confirmación (comando fijo, `npm install -g --prefix ~/.opencode opencode-ai`). Pendiente: `npm` en el PATH del servicio.
- Codex: inicio de sesión por código de dispositivo desde Ajustes. Pendiente: confirmar el comando `codex login --device-auth` y el archivo de sesión en el VM. Los agentes todavía no usan Codex.
- Claude gratis: sin decisión; no se implementa.
