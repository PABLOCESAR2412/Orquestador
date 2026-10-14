# Fase 3: correcciones tras probar en el VM

Documento de traspaso. Quien lo continúe debe leer también `CLAUDE.md`, `DESIGN.md` y `FASE2.md`.

Rama: `feat/seguir-tras-cuota`. Último commit subido: `c66be88`. Hay cambios **sin commit** en el árbol de trabajo (ver "Estado actual"). No hay PR.

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

- [~] **Servidor del chat en segundo plano** (`server/src/routes/chat.ts`, reescrito). Cambio de contrato: `POST /api/conversations/:id/messages` y `POST /api/conversations/:id/seguir` guardan el mensaje, lanzan el turno en segundo plano y responden **202** `{ messages: [turno] }`. Los fallos ya no son respuestas HTTP: quedan como mensaje `role: "system"` guardado en el chat. Nuevas funciones: `iniciarTurno`, `correrTurno`, `guardarAviso`, `publicarChat`, `avisarTurnosInterrumpidos` (exportada).
- [~] `server/src/bus.ts` y `server/src/routes/stream.ts`: evento `chat` con `{ conversacion_id, estado: "en_curso" | "terminado" }`, emitido como evento SSE `chat`.
- [~] `web/src/api.ts` (tipo `EventoVivo` con `chat`) y `web/src/lib/eventos-vivos.ts` (escucha `chat`; no se filtra por tarea).
- [~] `server/src/index.ts`: llama a `avisarTurnosInterrumpidos()` antes de `startWorker()`.
- [~] `server/tests/chat-turnos.test.ts`: escrito, **no ejecutado todavía**. Pruebas: 202 rápido con agente lento; `ocupada` durante el turno; 409 con segundo mensaje; fallo como aviso `system`; aviso de reinicio solo a chats cuyo último mensaje es del usuario.
- [ ] Web del chat (tarea 1). Nada hecho aún en `chat.tsx`: sigue esperando la respuesta HTTP y todavía usa `GUARDADO_EN_ERROR` con códigos que ya no llegan.
- [ ] Tareas 2 a 5.

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

## Riesgos conocidos

- Las claves guardadas llegan a **todos** los agentes, no solo al de su proveedor (`ejecutar.ts` inyecta todas). Mejora posible: pasar solo las claves del proveedor del modelo elegido.
- El chat ya no guarda el mensaje de usuario y la respuesta en la misma transacción que la petición. Si el servidor se cae a mitad de un turno, el aviso de reinicio lo cubre, pero el agente no se reanuda.
