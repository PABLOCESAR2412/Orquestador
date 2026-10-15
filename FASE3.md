# Fase 3: correcciones tras probar en el VM

Documento de traspaso. Quien lo continúe debe leer también `CLAUDE.md`, `DESIGN.md` y `FASE2.md`.

Rama de trabajo: `fix/notas-acciones-git`, desde `main` (`90f324e`). Contiene las correcciones de la Tarea 11 y de las pruebas de Codex. Sin commit ni push todavía. La rama `feat/seguir-tras-cuota` ya está en `main` por el PR 35.

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
cd server && bun test                      # suite del servidor (hoy 246 pasan)
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
- [x] **Tarea 5.** Cierre de la fase 3. Hecho: documentación, `cambios.json`, pruebas (servidor 246 en verde, `tsc` limpio, `bun run build`, navegador 29 de 29 en las tareas 7, 9 y Codex). Subido con aprobación del usuario: `502b781` y merge `79b126e`.
- [~] **Tarea 6.** Estado, logs y gasto de Azure en Ajustes. **Hecho:** estado de la unidad y registros (`GET /api/servidor/servicio` y `/logs`, con redacción y sin shell; botón Ver logs activo). Verificado en el navegador y en `servidor-logs.test.ts`. **Pendiente:** gasto de Azure, que espera la decisión del usuario sobre la identidad del VM (ver tarea 6, punto 3).
- [x] **Tarea 7.** Skills globales y por proyecto, editables desde la app. Verificada en navegador a 390 y 1440 px, y en `skills.test.ts`. **Pendiente en el VM:** confirmar que OpenCode las lista.
- [x] **Tarea 8.** Memoria del proyecto editable desde la app (`PUT /api/projects/:id/memoria`, con redacción y límite de 4 000 caracteres; botones Editar, Escribir, Guardar, Cancelar y Borrar). Verificada en el navegador a 390 y 1440 px, y en `proyectos.test.ts`. Supuesto confirmado en el código: "memoria" = memoria aprendida por proyecto.
- [x] **Tarea 9.** Botón "Instalar" de OpenCode con confirmación en dos pasos y comando fijo, verificado con npm falso (`instalacion.test.ts`) y en navegador. **Pendiente en el VM:** que `npm` exista para el servicio, y que `opencode models` liste los modelos de la clave guardada.
- [~] **Tarea 10.** Codex: login por código de dispositivo, verificado con CLI falso (`login-codex.test.ts`) y en navegador; **pendiente en el VM:** el comando exacto y el archivo de sesión. Instalar Codex desde Ajustes: hecho (misma tarjeta que el login, verificado en navegador a 390 y 1440 px). Gemini: clave de AI Studio (tarea 3). Claude: **investigado, no implementado** (ver tarea 10, punto b).
- [~] **Tarea 11.** Acciones git desde los chats (commit, subir rama y abrir PR, siempre con aprobación). En `main` desde los PR 36 a 42. En esta rama se quitan la fusión local y el push directo a `main`, el PR usa solo `GITHUB_PR_TOKEN` y las notas del plan dejan de romper la aprobación (ver Tarea 11). La protección de `main` en GitHub ya está hecha.
- [ ] **Tarea 12.** Cola de mensajes del chat: si envías más mientras el agente responde, se ejecutan en orden. Hoy se rechazan con 409. Pendiente (ver Tarea 12).
- [ ] **Tarea 13.** Wrangler (Cloudflare) instalable desde Ajustes, con inicio de sesión por código. Pendiente de dos decisiones (ver Tarea 13).
- [x] **Corrección.** El error «opencode salió con código 143» ya no aparece: el chat explica el límite de 3 minutos. Causa en «Diagnóstico del 143».
- [x] **Corrección.** `/tmp` propio dentro del sandbox: OpenCode ya no falla con «Read-only file system». Verificado con bwrap real.
- [x] **Corrección.** Notas del plan: al aprobar con notas, el obrero ya no rechaza el plan con «El plan cambió después de su aprobación». El hash cubre el plan sin las notas (`sinNotas`). La prueba extremo a extremo del analizador pasa.
- [x] **Corrección.** Pruebas de Codex: `HOME` se fija y se restaura en `beforeAll`/`afterAll`, y las rutas de sesión se calculan en cada uso (`login-cli.ts`). Suite del servidor: 290 pasan, 7 se omiten, 0 fallan.
- [x] **Barra lateral.** Se quitó el nombre del proyecto debajo de cada chat. Verificada a 390 y 1440 px.

Orden: tareas 1 a 5 primero (ya acordadas), luego 6 a 10 en el orden en que el usuario las pidió. Decisiones tomadas: skills globales y por proyecto (7), instalar OpenCode con confirmación (9), login de Codex en el VM (10a). Pendiente: Claude gratis (10b), el gasto de Azure (6, necesita la identidad del VM) y lo que queda de las acciones git desde los chats (11).

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

## Tarea 7. Skills configurables desde la app (hecha)

**Decisión del usuario.** Globales y por proyecto.

**Cómo quedó.**
- **Global:** `~/.config/opencode/skills/<nombre>/SKILL.md`. Se edita en Ajustes > Proveedores IA > Skills.
- **Por proyecto:** `<carpeta del proyecto>/.opencode/skills/<nombre>/SKILL.md`. Se edita en la pestaña del proyecto.
- **Nombre:** `^[a-z0-9]+(-[a-z0-9]+)*$`, hasta 64 caracteres. Es la misma regla que documenta OpenCode. La carpeta se llama igual que la skill.
- **Contenido:** cabecera con `name` igual a la carpeta y `description` de 1 a 1 024 caracteres. Máximo 64 KB.
- **Secretos:** un texto con un secreto conocido (`TELO_CLAVE`, clave de proveedor o token con formato de credencial) se rechaza. No se guarda redactado, porque al editar pisaría el original.
- **Escritura:** archivo temporal con `O_EXCL` y `O_NOFOLLOW`, `fsync` y renombrado. Ningún tramo de la ruta puede ser un enlace. La lectura también usa `O_NOFOLLOW`.
- **Borrar:** solo si la carpeta contiene únicamente `SKILL.md`. Si hay más archivos, responde 409 y no toca nada.
- **Aislamiento:** en bubblewrap, `~/.config/opencode/skills` se monta en **solo lectura**. El agente la lee y no la escribe: si pudiera escribirla, dejaría instrucciones para todos los agentes. La carpeta se crea al arrancar el servidor para que el montaje siempre exista.
- **Código:** `server/src/skills.ts`, `server/src/routes/skills.ts`, `web/src/components/skills-editor.tsx`, `web/src/components/proyecto-skills.tsx`.

**Diferencia con el plan.** El plan preveía `TELO_SKILLS_DIR`. No se añadió: una variable así podría apuntar fuera de lo que el agente ve. La ruta global es fija.

**Límite conocido.** Las skills de proyecto son archivos sin confirmar en el repositorio (aparecen en `git status`). Un chat que trabaja en la carpeta del proyecto las usa. Una tarea de un repositorio Git trabaja en un clon del último commit y no las ve hasta que se confirmen. Llevarlas a esas tareas es una decisión aparte.

**Verificado.** `server/tests/skills.test.ts` (14 pruebas): rutas, nombres, cabeceras, tamaño, secretos, enlaces en el archivo y en la carpeta, escritura que falla sin dejar temporales, borrado con archivos extra y proyecto inexistente. En navegador: crear, guardar, aparecer en la lista y escribir en `.opencode/skills` del proyecto, a 390 y 1440 px.

**No verificado en el VM.**
- Que OpenCode liste `~/.config/opencode/skills` y `.opencode/skills` (la documentación de OpenCode lo describe así; no hay OpenCode en este entorno).
- El montaje de solo lectura dentro de bubblewrap. Aquí no hay `bwrap`.

**Cambios.** `cambios.json`: mediano (entrada añadida).

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

## Tarea 9. Claves de proveedores y botón «Instalar» para OpenCode (hecha)

**Decisión del usuario.** Sí, instalar desde la app, con confirmación.

**Cómo quedó.**
- En la tarjeta de OpenCode aparece "Instalar OpenCode" solo si el CLI no se encuentra. El primer paso muestra el comando; el segundo es "Sí, instalar".
- **Comando fijo:** `npm install -g --prefix ~/.opencode opencode-ai`. La API recibe solo el identificador `opencode`; el servidor exige `confirmar: true` en el cuerpo.
- Sin shell. Entorno mínimo (PATH, HOME, LC_ALL): ninguna variable `TELO_*` ni clave llega a npm. Tiempo máximo de 10 minutos, con terminación del grupo.
- La salida pasa por `redaccion.ts`. Los motivos son legibles: npm no disponible, fallo de npm, tiempo agotado, CLI no visible tras instalar.
- **Por qué npm y no `curl … | bash`.** La documentación de OpenCode recomienda el script, pero ejecutar un script remoto no es un comando fijo. npm instala un paquete versionado. Con `--prefix ~/.opencode` el ejecutable queda en una carpeta que el agente ya ve en solo lectura, así que no hace falta tocar `TELO_LECTURA_EXTRA`.
- Tras instalar, el servidor añade `~/.opencode/bin` a su PATH sin reiniciar. Al arrancar hace lo mismo (`asegurarRutaInstalada`).
- **Código:** `server/src/instalacion.ts`, `server/src/routes/herramientas.ts`, `web/src/components/instalar-opencode.tsx`.

**Corrección hecha durante la verificación.** `Bun.which` usa el PATH con el que arrancó el proceso, no el actual. Tras instalar, el CLI no se veía. Ahora `server/src/ejecutable.ts` (`hallarEjecutable`, `lanzarEnGrupo`, `matarGrupo`) pasa el PATH vivo, y lo usan todos los sitios que buscan programas.

**Verificado.** `server/tests/instalacion.test.ts` (7 pruebas): lista fija, confirmación obligatoria, npm ausente, salida redactada, PATH actualizado, sin reinstalar. En navegador: comando visible antes de confirmar, instalación, botón que desaparece y "Activo", a 390 y 1440 px.

**Pendiente en el VM.**
- Que `npm` esté en el PATH del servicio. Si no está, el botón lo dice. El PATH del servicio viene de su unidad systemd.
- `opencode models` debe listar los modelos de la clave de Groq guardada (tarea 3).
- Confirmar el id `google` y el nombre de la variable de NVIDIA.

**Cambios.** `cambios.json`: mediano (entrada añadida).

---

## Tarea 10. Conectar Codex, Gemini y Claude gratis (parcial)

**Decisiones.**
- **(a) Codex:** aprobado el login de dispositivo, ejecutado en el VM.
- **(b) Claude gratis:** investigado en octubre de 2026. **Decisión del usuario: no añadir Claude por ahora.** Solo tiene el plan gratis; la única vía compatible (clave de API) es de pago. No se implementa ningún acceso con cuenta de Claude.
- **Gemini:** se usa la clave de AI Studio (tarea 3). El inicio de sesión con Google de Telo (`oauth-google.ts`) no sirve para OpenCode.

**Qué dice la documentación oficial (Claude Code, «Legal and compliance»).**
- El OAuth de cuenta de consumo está pensado «exclusivamente» para quien compra Free, Pro, Max, Team o Enterprise y para las aplicaciones nativas de Anthropic.
- Los desarrolladores que construyen productos deben usar **clave de API** (Claude Console) o un proveedor de nube. Anthropic **no permite** a terceros «enrutar solicitudes con credenciales de los planes Free, Pro o Max en nombre de sus usuarios», ni «recoger, almacenar o intermediar credenciales o tokens de sesión de Claude.ai».
- Sí está permitido que una persona inicie sesión con su propia suscripción en el **binario oficial de Claude Code, sin modificar**.

**Qué significa para Telo.**
- Telo no usa Claude Code para los agentes: usa OpenCode. Usar el OAuth de una cuenta de consumo desde OpenCode, o guardar o reenviar un token de Claude, cae en lo que la documentación prohíbe. **Descartado.**
- Copiar tokens de claude.ai o de la app de escritorio: **descartado** (mismo motivo).
- Un runner nuevo que ejecute el binario oficial de Claude Code con la sesión de la persona sería la única vía con cuenta de consumo. Tendría que confirmarse que el plan gratis incluye Claude Code, y eso no se ha podido comprobar: la página de soporte de Anthropic no se pudo leer y las fuentes secundarias no coinciden. **No se recomienda con plan gratis.**
- **Ruta compatible:** clave de API de Claude Console, con el mismo flujo de tarjeta que Groq y NVIDIA. Es de pago por uso. Hay que confirmar el nombre de la variable que lee OpenCode (`ANTHROPIC_API_KEY`) con `opencode models`.

**Qué hacer (solo si el usuario tiene plan de pago y lo pide).**
1. `server/src/claves-proveedor.ts`: añadir Anthropic con `ANTHROPIC_API_KEY`, igual que Groq.
2. `server/src/routes/providers.ts`: tarjeta guardable.
3. Pruebas: `claves-proveedor.test.ts` y `entorno-proveedores.test.ts`, con el modelo `anthropic/...` en el CLI falso.

**Cómo quedó (Codex).**
- `server/src/login-cli.ts` lanza `codex login --device-auth` en su propio grupo de procesos, con entorno mínimo. Lee la salida mientras el CLI espera y extrae la URL y el código.
- Rutas: `GET`, `POST` y `DELETE /api/providers/codex/login`. Una sesión a la vez (409 si ya hay una). Tiempo máximo de 15 minutos. Cancelar termina el grupo.
- **El token no se lee ni se muestra.** La salida se redacta. El éxito se decide por salida 0 y porque exista el archivo de sesión; ese archivo solo se comprueba, nunca se abre.
- `~/.codex` no está en la lista de bubblewrap: los agentes no lo ven.
- En la tarjeta de Codex: «Iniciar sesión» → enlace y código → «Sesión iniciada en el servidor». «Ya lo hice» comprueba el estado y mantiene el enlace mientras el CLI espera.
- Codex **no** es todavía proveedor de los agentes. La tarjeta lo dice.

**Verificado.** `server/tests/login-codex.test.ts` (4 pruebas) con un CLI falso que imprime un token de prueba: el token no aparece en ninguna respuesta, cancelar no deja procesos y sin CLI responde `codex_no_instalado`. En navegador: enlace, código, «Ya lo hice» y sesión iniciada, a 390 y 1440 px.

**No verificado (importante).**
- La documentación oficial de Codex (`developers.openai.com/codex/auth`) no se pudo leer en esta sesión. El comando `codex login --device-auth` y la ruta `~/.codex/auth.json` vienen de fuentes de terceros. Antes de darlo por bueno en el VM: `codex login --help` y comprobar qué archivo crea.
- **Términos de OpenAI:** no revisados. Antes de usar la sesión de ChatGPT para agentes (con un runner de Codex), hay que comprobar que el caso está permitido.
- No se sabe si el CLI de Codex está instalado en el VM. Si no lo está, la app lo dice.

**Cambios.** `cambios.json`: grande (entrada añadida, según el plan).

---

## Tarea 11. Acciones git desde los chats (parcial)

**Objetivo.** Que un chat con proyecto pueda crear commits, subir una rama y abrir PR sin que el usuario copie comandos. Ninguna acción se ejecuta sin aprobación explícita en Telo. El agente nunca recibe la clave SSH ni los tokens de GitHub.

**Estado.** En el código, las acciones llegan por la API `/projects/:id/acciones` (`routes/repository-actions.ts`), que el chat llama directamente cuando el usuario pide git (`routes/chat.ts`). Cada acción queda aprobada en `repository_actions`. No existe todavía la carpeta `.telo/solicitudes` ni la skill `telo-git` de abajo: esas secciones describen el diseño original. **Pendiente:** que el usuario cree `GITHUB_PR_TOKEN` en los secretos del proyecto, y comprobar con un push directo a `main` que GitHub lo rechaza.

**Decisiones (confirmadas por el usuario).**
- Permiso por defecto de un chat: **sin git**. Quien quiera git lo activa en la configuración del chat. Los niveles intermedios quedan por definir.
- Ramas: solo `telo/<id>`. Nunca `main`, nunca force push, nunca borrar ramas y nunca merge. El merge lo hace el usuario.
- **Subir** (push) sigue con la deploy key y con aprobación previa. Un PR necesita que la rama exista en GitHub, así que "solo PR" no quita el push: es el paso anterior.
- **PR**: el token de la API tiene solo el permiso *Pull requests: Read and write* (*Metadata: Read* se añade solo), un solo repo y vencimiento de 90 días. Se guarda como secreto `GITHUB_PR_TOKEN`, separado de `GITHUB_TOKEN`, que hoy es el respaldo del push por HTTPS. Si la API responde 403 al crear el PR, se añade *Contents: Read* y se documenta. En el código, el PR usa solo `GITHUB_PR_TOKEN`: sin respaldo a `GITHUB_TOKEN` ni a la cuenta general de GitHub. Ese nombre no entra al entorno del agente.
- **Fusión local y push a `main` quitados** (decidido el 15 de octubre, para respetar la protección de `main`): `merge` y `push_main` ya no se crean ni se ejecutan. Una acción antigua pendiente de esos tipos falla con un aviso y nunca cae en el camino del PR.
- **Protección de `main`** en GitHub: hecha por el usuario (*Require a pull request* con 0 aprobaciones, *Do not allow bypassing*, sin force push ni borrado). **Pendiente:** comprobar con un `git push` directo a `main` que GitHub lo rechaza.

**Cómo debe funcionar.**
1. El chat trabaja en un clon propio, como las tareas (`workspace.ts`). Hoy un chat con proyecto trabaja en la carpeta del proyecto, así que esto hay que cambiarlo antes.
2. El agente pide una acción escribiendo `.telo/solicitudes/*.json` en su clon. El servidor lee la solicitud al terminar cada turno y valida todo contra su propio estado. La carpeta `.telo` no entra en los commits.
3. Tarjetas en el chat, una por acción: **Commit** (diff resumido, mensaje y rama), **Subir** (rama `telo/<id>`) y **Abrir PR** (título y cuerpo redactados por el agente y editables por el usuario). Cada una con Aprobar y Rechazar.
4. Cada aprobación queda ligada a lo que se aprobó: hash del diff en el commit, SHA del commit en el push y hash de título y cuerpo en el PR. Si algo cambia, la aprobación caduca. Se reutilizan `task_approvals` y la interfaz de `tarea-plan.tsx`.
5. El resultado (SHA, rama o URL del PR) se escribe en el chat y se pasa al agente en el siguiente turno.

**Qué debe saber cada chat.** Una skill global `telo-git` (sistema de skills de la tarea 7): cómo pedir una acción, que solo puede pedir, las reglas de rama y de mensaje, y que nunca use `git push` ni `gh`. Las instrucciones del proyecto añaden la convención de commits y la plantilla de PR. El chat no recibe claves, tokens ni URLs con credenciales.

**Lo que ya existe y se reutiliza.**
- `git.ts` desactiva los hooks del repo (`core.hooksPath=/dev/null`) y quita filtros, credenciales y `url.*` en los comandos del servidor.
- `subirAprobado` (`workspace.ts`) empuja solo `HEAD:refs/heads/telo/<id>`, sin force, y exige un commit aprobado con el hash coincidente.
- El escaneo de secretos y de archivos sensibles se aplica antes de cada commit.

**Implementación pendiente, en orden (diseño original; ver Estado).**
1. Clon propio para chats con proyecto (extender `workspace.ts`) y una migración nueva para el permiso por chat (la siguiente numerada).
2. Permiso por chat en la configuración del chat, por `PATCH /api/conversations/:id`. Sin git por defecto.
3. Lectura de `.telo/solicitudes/*.json` al terminar cada turno, con validación en el servidor.
4. Tarjetas Commit y Subir, con la aprobación generalizada a chats.
5. Acción Abrir PR con `GITHUB_PR_TOKEN`. Esto también resuelve la aprobación `pr`: hoy `plan.ts` y `tarea-plan.tsx` la muestran, pero `routes/tasks.ts` la rechaza con `invalid_accion`. Si se retrasa, hay que decidir si se quita.
6. Skill `telo-git` y texto en las instrucciones del proyecto.
7. Pruebas: sin git se rechaza la solicitud; las ramas fuera de `telo/*` se rechazan; `main` nunca; una aprobación caduca si cambia el diff, el SHA o el título; PR con API falsa; el token no aparece en ninguna respuesta ni en la salida del agente.
8. Verificación: navegador a 390 y 1440 px, y una prueba real en un repo de prueba (commit, push a `telo/` y PR), con el push directo a `main` rechazado.

**Riesgos.**
- Instrucciones maliciosas en el código o en un issue: la aprobación es sobre el diff real, no sobre lo que diga el agente.
- El agente no debe recibir `gh`, `git push` directo ni credenciales, porque necesitaría secretos dentro del aislamiento.
- Un token mal acotado: por eso el de PR tiene permiso mínimo y su propio nombre de secreto.

**Cambios.** `cambios.json`: grande, al implementarse.

---

## Diagnóstico del 143 («opencode salió con código 143»)

**Causa.** `routes/chat.ts` limita cada turno del chat a 3 minutos (`TIEMPO_TURNO_MS`). Al llegar, `runners/opencode.ts` manda SIGTERM al grupo del agente, que sale con código 143 (128 + 15). `ejecutar.ts` lo trata como tiempo agotado, pero el chat mostraba el código tal cual.

**Lo que se corrigió.** El chat dice: «El agente tardó más de 3 minutos y se detuvo. Divide la tarea en partes más pequeñas.» No se probó con un agente real de 3 minutos; el cambio comprueba el tiempo transcurrido, y la lógica es corta.

**Causa secundaria (también corregida).** `/tmp` era de solo lectura dentro del sandbox de bubblewrap, así que OpenCode fallaba al escribir su `TMPDIR` (`/tmp/opencode`). El agente lo reportó como «Read-only file system». Se añadió `--tmpfs /tmp` en `runners/aislamiento.ts`. Verificado en esta máquina con bwrap real: sin el montaje falla con «Read-only file system»; con el montaje escribe, y el host no ve el archivo.

**Pendiente.** Decidir si el límite de 3 minutos se queda o se sube. Ver Tarea 12, donde la cola de mensajes depende de esa decisión.

---

## Tarea 12. Cola de mensajes del chat (pendiente)

**Hoy.** Si el chat está respondiendo, `POST /api/conversations/:id/messages` responde 409 `conversation_busy` (`motivoDeBloqueo` en `routes/chat.ts`). No hay cola.

**Lo que pidió el usuario.** Si envía más mensajes mientras el agente trabaja, se ejecutan en el orden en que se enviaron.

**Diseño propuesto.**
1. Guardar el mensaje como pendiente en la conversación. Sigue habiendo un turno a la vez por chat (`ocuparConversacion`).
2. Al terminar un turno, arrancar el siguiente pendiente, en orden de llegada.
3. En el chat: «En cola (N)» y la opción de quitar un mensaje pendiente antes de que arranque.
4. Si el servidor se reinicia con mensajes en cola, avisar como hoy (`avisarTurnosInterrumpidos`) y no ejecutarlos solos.
5. Decisión del usuario: el límite de 3 minutos por turno se queda o sube.

**Pruebas.** Dos mensajes seguidos: el segundo espera y se ejecuta después. Quitar un pendiente antes de que arranque. Reinicio con cola: no se ejecuta solo.

**Cambio de tipo:** mediano.

---

## Tarea 13. Wrangler (Cloudflare) desde Ajustes (pendiente)

**Qué se verificó.**
- El paquete `wrangler` existe en npm (versión 4.151.0 en la revisión).
- `wrangler login --device` existe en esa versión. No usa servidor de callback: muestra un enlace y un código, igual que el login de Codex. Lo dice la ayuda del CLI («útil en contenedores o sesiones SSH remotas») y la documentación de Cloudflare.
- El login normal (`wrangler login`) redirige el navegador a `localhost:8976` de la PC del usuario. Si Wrangler corre en el servidor, ese callback nunca llega y el login se queda colgado. Por eso no se usa.

**Diseño propuesto.**
1. Instalar con el mismo mecanismo que Codex: una entrada nueva en `ACCIONES` (`instalacion.ts`), con el paquete `wrangler` y el binario `wrangler`.
2. Iniciar sesión con `wrangler login --device` lanzado en el servidor, igual que `login-cli.ts`. Ajustes muestra el enlace y el código.
3. Alternativa sin login: un token de API en `CLOUDFLARE_API_TOKEN`, guardado como secreto. Wrangler lo lee antes que cualquier login guardado.
4. Las credenciales de Wrangler quedan en el HOME del servidor, que el agente no ve (aislamiento).

**Decisiones pendientes del usuario.**
- ¿Dónde vive la tarjeta? ¿Una tarjeta de Cloudflare entre los proveedores, o una sección de herramientas en Ajustes?
- ¿Inicio de sesión con código (recomendado, no guarda nada tuyo fuera de Cloudflare) o token de API?

**Cambio de tipo:** grande (integración nueva con credenciales).

---

## Riesgos conocidos

- Las skills globales las edita la app. Hasta confirmar en el VM que OpenCode las lee, no se sabe si el efecto llega a los agentes.
- El montaje de solo lectura de `~/.config/opencode/skills` dentro de bubblewrap no se probó con `bwrap` (no está en este entorno).
- Las skills de proyecto aparecen como archivos sin confirmar en el repositorio.

- Las claves guardadas llegan a **todos** los agentes, no solo al de su proveedor (`ejecutar.ts` inyecta todas). Mejora posible: pasar solo las claves del proveedor del modelo elegido.
- El chat ya no guarda el mensaje de usuario y la respuesta en la misma transacción que la petición. Si el servidor se cae a mitad de un turno, el aviso de reinicio lo cubre, pero el agente no se reanuda.
