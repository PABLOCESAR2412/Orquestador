# Fase 3: correcciones tras probar en el VM

Documento de traspaso. Quien lo continúe debe leer también `CLAUDE.md`, `DESIGN.md` y `FASE2.md`.

Rama: `feat/seguir-tras-cuota`. Último commit subido: `6dddd05` (turnos del chat en segundo plano). Al empezar la etapa de las tareas 6 a 10, el árbol de trabajo estaba limpio. No hay PR.

Leyenda: [x] hecho y verificado · [~] escrito, sin probar · [ ] pendiente

---

## Reglas de trabajo (obligatorias)

- Idioma: interfaz, errores y comentarios de negocio en español. Identificadores según el archivo.
- Colores y medidas solo de tokens en `web/src/styles.css`. Ámbar solo para estado activo, alerta o acción principal.
- Móvil primero: 390 px sin scroll horizontal; 1440 px también. Objetivos táctiles de 40 px.
- Errores de API siempre por `errorText()` (`web/src/lib/model.ts`).
- Migraciones: nunca editar una ya aplicada. Esta fase no necesita migraciones nuevas.
- Cada tarea termina con una entrada en `web/src/cambios.json` (`minimo` para correcciones, `mediano` para pantallas o funciones).
- Git: **el agente ejecuta los comandos de git él mismo**, pero antes pide aprobación explícita de cada commit y de cada push. No dar comandos al usuario para que los corra. No abrir PR.
- No hacer commit de nada que no haya pasado `bun test`, `tsc` del servidor y `bun run build` de la web.
- Reutilizar componentes existentes (`ConvItem`, `AvisoCuota`, `AppNav`, `errorText`, `api.*`). No duplicar.

## Comandos de verificación

```
cd server && bun test                      # suite del servidor (hoy 203 pasan, sin contar chat-turnos)
cd server && bunx tsc --noEmit -p .       # typecheck servidor
cd web && bun run build                    # typecheck + build web (obligatorio antes de revisar UI)
```

Revisión visual: `scratchpad/claves-ui/visual.mjs` levanta un servidor propio en el puerto 4770, con `opencode` falso (`scratchpad/cuota-e2e/bin`), y usa Playwright (`/opt/npm-tools/node_modules/playwright-core`, `executablePath: /opt/pw-browsers/chromium`). Hay que reconstruir `web/dist` antes de cada revisión. Para `waitUntil` usar `domcontentloaded`: la página mantiene abierto el SSE y `networkidle` nunca llega.

---

## Estado actual

Lista de control. Se marca lo hecho en cada tarea y aquí a la vez.

- [x] **Servidor del chat en segundo plano** (commit `6dddd05`). `POST /api/conversations/:id/messages` y `/seguir` guardan el mensaje, lanzan el turno en segundo plano y responden **202** `{ messages: [turno] }`. Los fallos quedan como mensaje `role: "system"` en el chat. Verificado: `bun test tests/chat-turnos.test.ts` pasa (4 de 4) y `tsc --noEmit` del servidor está limpio.
- [x] Evento SSE `chat` (`bus.ts`, `routes/stream.ts`, `api.ts`, `lib/eventos-vivos.ts`).
- [x] `avisarTurnosInterrumpidos()` en el arranque (`index.ts`).
- [x] **Tarea 1.** Web del chat (`chat.tsx`). Hecha: envío sin respuesta del servidor comprobado contra la lista (sin duplicar ni perder el texto), `GUARDADO_EN_ERROR` quitado, evento `chat` escuchado, aviso `system` como alerta de estado. Verificada con Playwright (corte de respuesta, 409 simulado, fallo del agente, mensaje de otro dispositivo). Captura a 390 y 1440 px. Entrada en `cambios.json`.
- [x] **Tarea 2.** Barra lateral: sin enlace Chat; chats de proyecto visibles con su nombre debajo. Verificada a 390 y 1440 px, sin desborde. `DESIGN.md` y `cambios.json` actualizados.
- [x] **Tarea 3.** Modelos de Groq, NVIDIA y Gemini visibles cuando su clave llega al CLI; Gemini con dos variables; diagnóstico en Ajustes ("N modelos en el selector" o aviso si OpenCode no tiene modelos del proveedor). Verificado: `bun test` completo en verde (209), `tsc` limpio, y Playwright en Ajustes a 390 y 1440 px. **Pendiente en el VM:** confirmar el id `google` y el nombre de variable de NVIDIA con `opencode models`.
- [x] **Tarea 4.** Vista de proyectos con métricas (chats, tareas, última actividad desde `GET /api/projects`) y acciones en iconos de 40 px. Verificada a 390 y 1440 px, claro y oscuro: métricas, 40 px, anclar desde el icono, confirmación al eliminar, sin desborde. Pruebas de servidor en `proyectos.test.ts`.
- [ ] **Tarea 5.** Cierre de la fase 3 (documentación, `cambios.json`, verificación visual, aprobación de commit).
- [~] **Tarea 6.** Estado, logs y gasto de Azure en Ajustes. **Hecho:** estado de la unidad y registros (`GET /api/servidor/servicio` y `/logs`, con redacción y sin shell; botón Ver logs activo). Verificado en el navegador y en `servidor-logs.test.ts`. **Pendiente:** gasto de Azure, que espera la decisión del usuario sobre la identidad del VM (ver tarea 6, punto 3).
- [ ] **Tarea 7.** Skills configurables desde la app.
- [x] **Tarea 8.** Memoria del proyecto editable desde la app (`PUT /api/projects/:id/memoria`, con redacción y límite de 4 000 caracteres; botones Editar, Escribir, Guardar, Cancelar y Borrar). Verificada en el navegador a 390 y 1440 px, y en `proyectos.test.ts`. Supuesto confirmado en el código: "memoria" = memoria aprendida por proyecto.
- [ ] **Tarea 9.** Claves de proveedores que funcionan desde la app, con botón "Instalar" para OpenCode.
- [ ] **Tarea 10.** Conectar Codex, Gemini y Claude gratis (requiere decisión del usuario antes de programar).

Orden: tareas 1 a 5 primero (ya acordadas), luego 6 a 10 en el orden en que el usuario las pidió. Las tareas 6 a 10 no se programan hasta que sus decisiones pendientes estén resueltas, salvo las partes que no dependen de ellas.

Antes de seguir: correr `bun test tests/chat-turnos.test.ts`. Si falla, corregir el servidor antes de tocar la web. Si una prueba depende de tiempos, subir la espera de `esperar()`, no quitar la comprobación.

---

## Tarea 1. El chat no se detiene si el móvil o la PC se duermen, cambian de app o pierden red

**Causa.** Antes, el turno corría dentro de la petición HTTP. Si la red se cortaba, `send` fallaba, la web tomaba el error como "no guardado" y devolvía el texto al compositor. Pero el servidor sí había guardado el mensaje y seguía el agente: el resultado era un mensaje duplicado y una respuesta que no aparecía hasta recargar.

**Qué hacer (web, `web/src/pages/chat.tsx`).**
1. En la mutación `send`, en `mutationFn`: si `api.sendMessage` falla con algo que no es `ApiError` (sin respuesta del servidor), pedir `api.listMessages(id)`. Si el último mensaje `role === "user"` tiene el mismo texto (`content.trim()`), dar el envío por bueno (`return { messages: [] }`). Si no, relanzar el error. Un `ApiError` siempre significa que no se guardó: restaurar borrador como hoy.
2. Quitar `GUARDADO_EN_ERROR` y su uso en `onError`: ya no hay errores tras guardar.
3. `pensando` ya usa `current.ocupada`; dejarlo. Tras el 202 la lista de conversaciones se invalida (ya ocurre en `onSettled`).
4. En `useEventosVivos` (chat.tsx ya lo usa para `actividad`), manejar `evento.tipo === "chat"`: invalidar `["messages", evento.conversacion_id]` y `["conversations"]`.
5. En `lista.map`, antes del ternario `m.role === "user"`, renderizar `m.role === "system"` como aviso: `<p className="tl-alerta" role="status">{m.content}</p>`. Hoy caería en la burbuja del agente.

**Verificación.**
- `bun test tests/chat-turnos.test.ts` en verde.
- Playwright: interceptar el POST con `route.fetch()` seguido de `route.abort()`. El servidor recibe el mensaje; el navegador ve un fallo de red. Esperado: el borrador no vuelve, aparece la respuesta del agente sin recargar.
- Playwright con `context.setOffline(true)` durante un turno largo y luego `setOffline(false)`. Esperado: la respuesta aparece al volver.
- Revisar 390 y 1440 px, claro y oscuro. Sin errores de consola.

**Cambios.** `cambios.json` tipo `minimo`.

---

## Tarea 2. Quitar "Chat" de la barra lateral y mostrar todos los chats

**Causa del chat que falta.** `web/src/components/shell.tsx` tiene `if (c.project_id) continue;` en `groupedConversations`. Los chats de proyecto (por ejemplo, los que crea el clonado desde GitHub) no aparecen en la lista. Hipótesis probable, a confirmar con `GET /api/conversations` en el VM: el segundo chat es de un proyecto.

**Qué hacer.**
1. `web/src/components/nav.tsx`: quitar el elemento `to: "/chat"` de `ITEMS`. Afecta a todas las variantes (sidebar, row, rail). La ruta `/chat` se queda, y `/` sigue redirigiendo ahí.
2. `web/src/components/shell.tsx`: quitar el `continue` y su comentario. Los chats de proyecto entran en su grupo de fecha.
3. `web/src/components/conv-item.tsx`: si `conv.project_name` existe, mostrarlo como línea secundaria pequeña (`--ink-2`, 12 px) debajo del título. Sin duplicar clases: revisar `styles-shell.css` (`.sidebar-conv`, `.sidebar-conv-title`).
4. `DESIGN.md`, sección "AppNav": quitar "Chat" de la lista de enlaces.

**Verificación.** Con dos chats (uno sin proyecto y uno de proyecto), ambos aparecen en la barra. Revisar 390 px (cajón) y 1440 px.

**Cambios.** `cambios.json` tipo `minimo`.

---

## Tarea 3. Groq, NVIDIA y Gemini: que sus modelos aparezcan y funcionen

**Lo que se sabe (verificado en código).** `server/src/models.ts` marca `recommended = free || grupo curado`. Groq y NVIDIA de pago no caen en ningún grupo (`GROUPS`), así que quedan fuera del selector de chat (`GET /api/models` sin `all=1`). Aunque la clave llegue a OpenCode, el usuario no ve los modelos. Esa es la causa más probable de "está implementado y no está".

**Lo que NO se puede verificar desde aquí.** OpenCode no está instalado en el entorno de trabajo. Las fuentes consultadas no coinciden:
- Un mirror de la documentación (`mintlify`) da `GEMINI_API_KEY`, pero corresponde a la versión antigua en Go de opencode. La versión actual usa el catálogo models.dev.
- Otra fuente lista NVIDIA con id de proveedor `nvidia` y clave por `/connect` (que guarda en `~/.local/share/opencode/auth.json`); no nombra variable.
- Un artículo de terceros da `NVIDIA_API_KEY`. No es documentación oficial.

**Qué hacer.**
1. **Modelos visibles** (`server/src/models.ts`): en `parseModels`, si el proveedor del modelo (`id.split("/")[0]`) tiene clave activa, `recommended = true` y `group` = etiqueta del proveedor (`Groq`, `NVIDIA`, `Google (Gemini)`), salvo que coincida con un grupo curado. Obtener los proveedores activos con una función exportada de `claves-proveedor.ts` (usar `entornoProveedores()` o `tieneClaveProveedor`). `invalidarModelos()` ya se llama al cambiar claves.
2. **Variables de Gemini** (`server/src/claves-proveedor.ts`): cambiar `variable: string` por `variables: string[]`, con `GOOGLE_GENERATIVE_AI_API_KEY` primero y `GEMINI_API_KEY` después, y pasar **las dos** al entorno. Así funciona con la versión actual o con la antigua. Actualizar:
   - `entornoProveedores()`: asignar cada variable.
   - `server/src/routes/providers.ts`: `variable` = primera; `configured` y `enAgente` miran todas.
   - `server/tests/claves-proveedor.test.ts`: espera `GEMINI_API_KEY` en `PROVEEDORES_CON_CLAVE` (revisar los asserts que cambien).
   - `FASE2.md`: corregir la nota de Gemini.
3. **Diagnóstico en Ajustes** (`web/src/pages/settings.tsx`): pasar a `TarjetaProveedor` el número de modelos del proveedor (`models.data.models.filter(m => m.provider === p.id).length`; la lista ya se pide con `all=1`). Mostrar "N modelos disponibles". Si la clave está guardada, `enAgente` es true y el conteo es 0 con los modelos ya cargados, mostrar: "La clave está guardada, pero OpenCode no muestra modelos de este proveedor. Revisa el nombre de la variable en el servidor con `opencode models`." Esto deja claro al usuario, sin adivinar, si OpenCode reconoce la clave.
4. **Pruebas** (`server/tests/entorno-proveedores.test.ts`): el fake de `models` debe imprimir también `groq/llama-prueba` y `nvidia/nemo-prueba` con coste mayor que cero. Afirmar: con clave guardada de Groq, `groq/...` tiene `recommended: true` y grupo `Groq`; sin clave, `recommended: false`. Actualizar la aserción que hoy espera solo `opencode/big-pickle`.

**Verificación en el VM (lo hace el usuario o el agente con acceso).** Con `GROQ_API_KEY` guardada, `opencode models --verbose` debe listar `groq/...`. Para NVIDIA y Gemini, comprobar el nombre exacto de la variable y el id del proveedor. Si el conteo sigue en 0, el diagnóstico de Ajustes lo indica.

**Honestidad con el usuario.** Decir que la lógica del selector queda arreglada, y que la confirmación de nombres de variable se hace en el VM.

**Cambios.** `cambios.json` tipo `minimo`.

---

## Tarea 4. Mejorar la vista de proyectos

**Estado actual.** `web/src/pages/proyectos.tsx`: tarjeta con nombre, ruta, estado de origen y tres botones de texto al pie (Renombrar, Quitar ancla, Eliminar) que se parten en dos líneas en 390 px. No muestra actividad.

**Qué hacer.**
1. **Servidor** (`server/src/routes/projects.ts`, `GET /projects`): añadir por subconsulta `chats` (conversaciones del proyecto), `tareas` (tareas del proyecto) y `ultima_actividad` (máximo de `messages.created_at` de sus chats o `tasks.created_at`, con `COALESCE` para no obtener NULL). Convertir `''` a `null` en JS. Tipo `Project` en `web/src/api.ts`: campos opcionales nuevos.
2. **Tarjeta** (`proyectos.tsx`):
   - Cabecera: nombre (18 px, peso 600) y chip "Anclado" si aplica.
   - Ruta de carpeta en mono, truncada con elipsis (no partir en varias líneas).
   - Línea de metadatos en `--ink-2`: "N chats · N tareas · última actividad hace X" (usar `web/src/lib/tiempo.ts` si ya formatea fechas; revisar antes de crear otro).
   - Estado de origen (clonado desde GitHub) como hoy.
   - Pie: el nombre (o un enlace "Abrir") lleva a `/proyectos/$id`. Renombrar, anclar y eliminar pasan a **botones de icono de 40 px** con `aria-label` y `title`, como en `conv-item.tsx`. Eliminar mantiene su confirmación.
   - Confirmación y renombrado: mantener la lógica actual.
3. **Cabecera de página**: título, subtítulo con número de proyectos y botón "Nuevo proyecto" (ya existe).
4. **Estilos**: reemplazar las clases `.proyecto-tarjeta*` de la página por las nuevas. Tokens únicamente. Sin degradados ni sombras pesadas.

**Verificación.** Captura a 390 y 1440 px, claro y oscuro. Sin scroll horizontal a 390. Con 0 proyectos sigue el estado vacío. Con un proyecto anclado y uno clonado, revisar el orden (anclados primero, como hoy).

**Cambios.** `cambios.json` tipo `mediano`.

---

## Tarea 5. Cierre

1. `FASE2.md`: añadir sección "E. Correcciones tras probar en el VM" con el estado de las tareas 1 a 4. Corregir la nota de Gemini.
2. `cambios.json`: una entrada por tarea (ya indicadas arriba).
3. Ejecutar todos los comandos de verificación. Revisión visual 390 y 1440, claro y oscuro, sin errores de consola.
4. Preguntar al usuario si aprueba el commit y el push. Solo tras su aprobación, ejecutar git tú mismo (`git add` de archivos concretos, `git commit`, `git push`). El commit lleva los trailers `Co-Authored-By` y `Claude-Session` indicados en el sistema.

---

## Tarea 6. Estado, logs y gasto de Azure en Ajustes

**Qué ya existe.** `server/src/routes/servidor.ts` (`GET /api/servidor`, caché de 30 s) da disco, herramientas y carpetas, sin rutas ni IPs. Ajustes lo muestra en "Estado del servidor" y "Almacenamiento" (`web/src/pages/servidor.tsx`). Faltan los logs, el estado del servicio y el gasto.

**Por qué así.** Ver los errores sin entrar al VM por SSH, y ver el gasto real que da Azure, no una estimación de la app.

**Qué hacer.**
1. **Estado del servicio.** Añadir a `GET /api/servidor` el resultado de `systemctl show orquestador -p ActiveState,SubState,ActiveEnterTimestamp` con lista fija de argumentos, entorno mínimo (`entornoMinimo()`) y tiempo límite, como ya hace `df`.
2. **Logs.** Nueva ruta `GET /api/servidor/logs?lineas=100` (máximo 300). Ejecuta `journalctl -u orquestador -n <N> --no-pager -o short-iso` con `Bun.spawn`, sin shell. La salida pasa por `redaccion.ts` antes de responder. Si el usuario del servidor no puede leer el diario, responde un error legible, no un 500. Requisito en el VM (lo hace el usuario): añadir `orquestador` al grupo `systemd-journal`. Documentarlo en `deploy/README.md`. No dar sudo.
3. **Gasto de Azure.** Nueva ruta `GET /api/servidor/coste`, con caché de 1 h. Consulta la API de Cost Management de Azure con la **identidad administrada** del VM, así no hay claves en el repo ni en el archivo de entorno. Devuelve gasto del mes en curso, moneda y gasto diario de los últimos 30 días. Si falta la identidad o el rol, responde `coste_no_disponible` con un texto que dice qué permiso falta.
   - **Decisión pendiente del usuario:** asignar al VM una identidad administrada con el rol de lector de costes sobre la suscripción. Sin eso, la tarjeta muestra el aviso y no inventa cifras.
   - Comprobar en el VM el comando exacto de consulta (`az rest` contra Cost Management o `az consumption`). No verificado desde aquí.
4. **Presentación** en Ajustes, sin tablas: tarjeta "Estado" (icono y texto; ámbar solo si el servicio no está activo), tarjeta "Gasto del mes" (cifra grande, moneda y fecha de corte), y bloque "Registros" (texto monoespaciado, últimas 100 líneas, botón "Actualizar" con icono). Tokens de `styles.css`.
5. **Pruebas** (`server/tests/servidor-logs.test.ts`): `journalctl` ausente da error legible; un token de prueba en la salida queda oculto; el límite de líneas se respeta. Para el gasto, un `az` falso en el PATH (igual que el `opencode` falso).

**Verificación.** Captura de la pestaña a 390 y 1440 px, claro y oscuro, con datos y sin datos. Sin errores de consola.

**Cambios.** `mediano`.

---

## Tarea 7. Skills configurables desde la app

**Qué ya existe.** `web/src/components/proyecto-skills.tsx` es un marcador sin backend.

**Por qué es delicado.** OpenCode lee las skills como archivos en disco. El agente corre en bubblewrap y solo ve su carpeta de trabajo, así que las skills globales no están a su alcance. Editarlas desde la app obliga al servidor a escribir fuera del aislamiento, por eso la carpeta y los nombres aceptados deben estar acotados.

**Qué hacer.**
1. **Antes de programar:** confirmar en el VM dónde busca OpenCode las skills (ruta global y, si existe, por proyecto) y su formato (carpeta con `SKILL.md`). Anotar aquí la ruta confirmada. No verificado desde aquí.
2. **Servidor** (`server/src/skills.ts`): listar, leer y guardar skills dentro de una sola carpeta raíz, configurable con `TELO_SKILLS_DIR`. Reglas: nombre de carpeta `^[a-z0-9-]{1,64}$`; tamaño máximo 64 KB por archivo; escritura atómica (archivo temporal y renombrado); no seguir enlaces (`O_NOFOLLOW`, como en `archivos-proyecto.ts`); rechazar `..` y rutas absolutas.
3. **Rutas:** `GET /api/skills`, `GET|PUT|DELETE /api/skills/:nombre`. Para proyecto, lo mismo bajo `/api/projects/:id/skills` si el paso 1 confirma que OpenCode las lee desde el proyecto.
4. **Web:** `proyecto-skills.tsx` lista las skills (nombre y la línea `description:` del frontmatter), abre un editor de texto simple para `SKILL.md`, permite guardar y quitar (con confirmación). Ajustes muestra las globales.
5. **Pruebas** (`server/tests/skills.test.ts`): nombre inválido rechazado; `..` y enlace simbólico rechazados; tamaño excedido; escritura atómica (sin archivo a medias si falla).

**Decisión pendiente del usuario:** ¿las skills son globales (todos los proyectos) o por proyecto? Por defecto: globales en Ajustes y por proyecto en la pestaña del proyecto.

**Verificación.** Captura a 390 y 1440 px. Sin errores de consola.

**Cambios.** `mediano`.

---

## Tarea 8. Memoria del proyecto editable desde la app

**Qué ya existe.** La memoria del proyecto está en `projects.memoria` (migración 014). El agente la escribe al terminar tareas (`server/src/memoria.ts`, `guardarMemoria`, límite `MAX_MEMORIA` de 4 000 caracteres). `DELETE /api/projects/:id/memoria` la borra. `web/src/components/proyecto-memoria.tsx` solo muestra el texto y el botón "Borrar memoria". **No se puede editar.**

**Supuesto.** "Memoria" = la memoria aprendida de cada proyecto. Si el usuario se refería a su memoria personal, es otra tarea. Confirmar antes de cerrarla.

**Qué hacer.**
1. **Servidor:** `PUT /api/projects/:id/memoria` con `{ texto }`. Límite `MAX_MEMORIA`. El texto pasa por `redaccion.ts` antes de guardar. Reutilizar `guardarMemoria`; no duplicar.
2. **Web:** en `proyecto-memoria.tsx`, un área de texto con el contenido actual, la fecha de actualización, "Guardar" (solo activo si cambió) y "Borrar memoria" como hoy.
3. **Pruebas:** un token de prueba no queda guardado en claro; más de `MAX_MEMORIA` caracteres se rechaza con mensaje claro; proyecto inexistente da 404.

**Verificación.** Captura a 390 y 1440 px, claro y oscuro, con memoria vacía y con texto.

**Cambios.** `mediano`.

---

## Tarea 9. Claves de proveedores que funcionan desde la app, con botón "Instalar"

**Qué ya existe.** Claves cifradas de Groq, NVIDIA y Gemini (commit `c66be88`). OpenCode aparece en Ajustes como "Se activa al instalar el CLI", sin acción.

**Cómo.**
1. **Que los modelos aparezcan** depende de la tarea 3. Esta tarea no está completa sin ella.
2. **Gemini con dos variables** (tarea 3, punto 2).
3. **Botón "Instalar" en OpenCode**, visible solo si `configured` es falso. Ejecuta **un comando fijo** en lista blanca (por ejemplo `npm install -g opencode-ai`; confirmar en el VM cuál es el instalador oficial). Pide confirmación en dos pasos: "¿Instalar OpenCode en el servidor?". Muestra estado (instalando, listo, error) y la salida redactada. Por qué: el usuario no tiene terminal desde el móvil, y un comando fijo evita ejecutar nada arbitrario.
   - **Decisión pendiente del usuario:** aprobar que la app instale software en el VM. Sin eso, no se implementa.
   - Tras instalar, el CLI global debe ser legible por el agente. Si está fuera de `~/.opencode`, `~/.local/bin` o `~/.bun`, añadir su carpeta raíz a `TELO_LECTURA_EXTRA` (ver `CLAUDE.md`).
4. **Proveedores con clave** (Groq, NVIDIA, Gemini): no tienen "Instalar". La clave ya se guarda desde la app.
5. **Diagnóstico:** "Probar" por proveedor ejecuta `opencode models` con su entorno y cuenta modelos. Es la misma cuenta de la tarea 3.

**Pruebas:** `entorno-proveedores.test.ts` (ya existe) cubre la clave llegando al agente y al CLI. Añadir: el botón "Instalar" rechaza cualquier comando que no esté en la lista blanca.

**Verificación.** Captura a 390 y 1440 px. En el VM, el usuario confirma que `opencode models` lista los modelos de la clave guardada.

**Cambios.** `mediano`.

---

## Tarea 10. Conectar Codex, Gemini y Claude gratis

**Investigación (lo que se sabe, sin verificar en el VM).**
- **Gemini.** La vía limpia es una clave de Google AI Studio, ya cubierta por la clave de Gemini (tarea 3). El inicio de sesión con Google de Telo (`oauth-google.ts`) **no sirve** para OpenCode: sus tokens son de Telo, no del agente.
- **Codex.** El CLI de Codex puede iniciar sesión con la cuenta de ChatGPT mediante un flujo de dispositivo (código y URL). Lo correcto es ejecutar ese login **en el VM**: la app muestra la URL y el código, y el token queda en el VM (en `~/.codex/`), no en la base de datos ni en el repo. Comprobar el comando exacto en el VM.
- **Claude gratis.** La API de Anthropic se paga por uso; el plan gratis no incluye acceso por API. Copiar tokens de una sesión de claude.ai o de la app de escritorio a otra herramienta no es recomendable: las condiciones de uso de Anthropic deben confirmarse antes de hacerlo, y los tokens dan acceso a la cuenta. **Recomendación:** no copiar tokens. La alternativa es una clave de API de pago por uso, con el mismo flujo de la tarea 9.

**Decisión pendiente del usuario (antes de programar).**
- (a) ¿Se acepta el login de dispositivo de Codex, ejecutado en el VM?
- (b) ¿Claude se conecta solo con clave de API, o se deja fuera?

**Qué hacer (si se aprueba).**
1. **Servidor** (`server/src/login-cli.ts`): iniciar el login del CLI con lista fija de argumentos, capturar URL y código de la salida, y exponerlos en `GET /api/proveedores/:id/login`. El estado de sesión se comprueba solo por la existencia del archivo de credenciales, nunca leyendo su contenido.
2. **Nunca** guardar ni mostrar un token. La salida pasa por `redaccion.ts`.
3. **Web:** en la tarjeta del proveedor, "Iniciar sesión" muestra URL y código, "Ya lo hice" vuelve a comprobar, y el estado se actualiza.
4. **Pruebas:** un CLI falso que imprime un token de prueba; el token no aparece en ninguna respuesta ni en los logs.

**Cambios.** `grande` (capacidad nueva de infraestructura).

---

## Riesgos conocidos

- Las claves guardadas llegan a **todos** los agentes, no solo al de su proveedor (`ejecutar.ts` inyecta todas). Mejora posible: pasar solo las claves del proveedor del modelo elegido.
- El chat ya no guarda el mensaje de usuario y la respuesta en la misma transacción que la petición. Si el servidor se cae a mitad de un turno, el aviso de reinicio lo cubre, pero el agente no se reanuda.
