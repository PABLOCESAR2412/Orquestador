# Fase 2: seguimiento de cambios

Rama: `feat/seguir-tras-cuota` (creada desde `feat/proyectos-tarjetas`, commit 507f01c). Nada está en commit todavía: los cambios son del árbol de trabajo. No hay PR.

Leyenda: [x] hecho y verificado · [ ] pendiente

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
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`, `pr: null`). Validado con `json.load`.

### A3. Pruebas

- [x] `server/tests/cuota.test.ts`: 12 pruebas (clasificación, migración, rechazos de seguir).
- [x] `bun test` del servidor: 178 pasan, 0 fallan.
- [x] `tsc --noEmit` del servidor y de la web: limpios.
- [x] `bun run build` de la web: pasa. La advertencia de tamaño de chunk ya existía.
- [x] Punta a punta con servidor real y `opencode` falso (`scratchpad/cuota-e2e/prueba.ts`): 25 de 25. Cubre tarea y chat, reanudación de sesión y prompt de continuación.
- [x] Revisión visual (`scratchpad/cuota-e2e/visual.mjs`) a 390 y 1440 px, claro y oscuro: sin desborde horizontal, aviso visible, sin errores de consola.
- [x] Flujo en el navegador: en la tarea, "Seguir" queda desactivado hasta elegir otro modelo; al elegirlo y pulsar, la tarea termina con el modelo B. En el chat, "Seguir" muestra la respuesta del modelo B y el aviso desaparece.

### A4. Problemas encontrados y resueltos

- La clasificación de cuota leía el mensaje completo, que incluye rutas del servidor. Una carpeta "cuota-…" hacía que cualquier fallo se viera como cuota. Ahora solo cuenta lo que dijo el proveedor (ver A1).
- El selector de modelo del detalle de tarea abría fuera de la pantalla: el contenedor no era posicionado. Se corrigió con `.cuota-selector`.
- Las capturas al principio mostraban la versión anterior porque `web/dist` no se había reconstruido. Regla: reconstruir antes de revisar.

### A5. Pendiente de confirmar en el VM

- [ ] La detección de cuota usa patrones (429, "rate limit", "quota", "usage limit", "insufficient", "saldo", etc.). El texto exacto que devuelve OpenCode con un modelo sin cuota no está verificado. Hay que comprobarlo con un modelo real agotado. Si el texto no coincide, la tarea queda en `failed` como antes: no hay regresión, pero no se detiene con aviso.
- [ ] `esErrorDeProveedor` (el reintento con modelo de respaldo) sigue mirando el mensaje completo. Puede caer en el mismo problema de rutas. Es código anterior; pendiente de corregir con el mismo criterio.

---

## B. API keys de Groq, NVIDIA y Gemini  ⏳ no empezada

Antes de codificar hay que verificar en la documentación de OpenCode los nombres exactos de las variables de entorno. No se deben adivinar.

- [ ] Verificar con WebSearch/WebFetch las variables por proveedor (candidatas: `GROQ_API_KEY`, `NVIDIA_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) y el nombre del proveedor en `opencode models`.
- [ ] Migración nueva (`021_...`): claves cifradas por proveedor, con el mismo esquema que `project_secrets` (AES-256-GCM, AAD = nombre del proveedor). Nunca en claro.
- [ ] Inyección en el agente: `server/src/runners/opencode.ts` solo pasa variables de `VARIABLES_PERMITIDAS` y `TELO_AGENTE_VARIABLES`. Las claves entran como `extraEnv` de `ejecutarAgente`, nunca como `TELO_*`.
- [ ] Redacción: añadir los valores a `valoresAOcultar()` en `server/src/ejecutar.ts`.
- [ ] Estado y modelos: `server/src/routes/providers.ts` (`estadoProveedores`) y `server/src/models.ts`. No ofrecer modelos de un proveedor sin clave.
- [ ] UI en Ajustes: `web/src/pages/settings.tsx`. Campo de clave con guardar y borrar. La API nunca devuelve el valor.
- [ ] Pruebas de cifrado y redacción en `server/tests/secretos.test.ts` (o archivo nuevo).

Riesgo: que la clave llegue a `TELO_*` o a la salida del agente. Revisar que no aparezca en `task_events` ni en el chat.

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

1. Confirmar en el VM el texto real de cuota de OpenCode (A5) y corregir `esErrorDeProveedor` si hace falta.
2. B: verificar nombres de variables antes de codificar.
3. C: después de B.
4. D: esperar tu decisión.
5. Commit y PR solo cuando lo pidas.
