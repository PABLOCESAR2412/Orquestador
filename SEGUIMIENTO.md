# Seguimiento de Telo

Registro central Ãºnico: hallazgos en curso, fases del producto y verificaciÃ³n operativa. Cuando aparezca un hallazgo, se registra aquÃ­; cuando se corrige, se marca con su prueba (PR, comando o verificaciÃ³n). Un estado `[x]` significa resuelto en la rama citada, no despliegue confirmado en el VM.

Formato: `[x]` resuelto con evidencia Â· `[ ]` pendiente Â· `[~]` implementado sin validar.

## Hallazgos â€” auditorÃ­a del 21 de octubre de 2026

- [x] **H1 Â· Escaneo de secretos solo por el diff textual (ALTA).** Con `.gitattributes` el agente podÃ­a ocultar contenido; ahora se escanea el blob del Ã­ndice de cada archivo aÃ±adido o modificado (`archivosConSecretosEnBlobs`, topes por blob y total), con la prueba del binario escondido rechazado, y el escÃ¡ner no bloquea tokens de prueba con marca evidente (ficticia, exampleâ€¦) porque los del dueÃ±o cuentan siempre. Evidencia: PR #102, `test: el escaneo de secretos ve el blobâ€¦` y `secretos.test.ts`.
- [x] **H2 Â· Tarea colgada retenÃ­a el slot (MEDIA).** Vigilante de inactividad en el runner de OpenCode: si el agente no emite ninguna lÃ­nea en `TELO_TIEMPO_INACTIVIDAD_MS` (15 minutos por defecto; 0 lo apaga), se cierra el grupo y la tarea falla con un mensaje claro. El drenado al abortar ya contaba el uso (los eventos pendientes se parsean igual), no hizo falta cÃ³digo nuevo. Evidencia: PR #102.
- [x] **H3 Â· Base sin techo y `repository_actions` sin Ã­ndices (MEDIA).** MigraciÃ³n `039_indices_repository_actions` (tarea+acciÃ³n+estado, conversaciÃ³n+fecha, proyecto+estado+fecha) y `purgarHistorial()` en el ciclo de limpieza: borra eventos, planes, aprobaciones y solicitudes de tareas terminadas hace mÃ¡s de `TELO_RETENCION_DIAS` (120 dÃ­as por defecto; 0 la apaga). Las tareas se conservan: son la historia del usuario. Evidencia: PR #102, `retencion.test.ts` (7/7).
- [x] **H4 Â· GuÃ­as no llegaban en tareas sin proyecto (MEDIA).** `conInstrucciones` lee los documentos guÃ­a del workspace (`AGENTS.md`, `CLAUDE.md`, `README.md`) y antepone hasta 8 KB al prompt. Evidencia: PR #102, `mejoras-arquitectura.test.ts` (8/8).
- [x] **H5 Â· Suite inservible en Windows (MEDIA).** Causa raÃ­z: `db` singleton abierto una vez por proceso (el primer `DATA_DIR` de prueba ganaba y un `db.close()` rompÃ­a el resto: dominÃ³ de 103 fallos). Ahora `db` es un Proxy ligado al `DATA_DIR` vigente: reabre al cerrarse y aplica migraciones por apertura; `clave-ssh` anotada `skipIf` en Windows (ejercita OpenSSH POSIX, se verifica en el VM) y `media-routes` cierra la base antes de borrar su carpeta. Evidencia: PR #102, suite completa 485 tests, 0 fail.
- [x] **H6 Â· Evento `conflictos_pr_preparados` y errores crudos en la tarjeta (BAJA).** Etiqueta Â«PR preparado: conflictos por resolverÂ» y `textoErrorTarea` que traduce los cÃ³digos guardados a frases. Nota: la etiqueta del evento entrÃ³ tambiÃ©n por el PR #103 y quedÃ³ deduplicada en el rebase. Evidencia: PR #102 (+#103).
- [ ] **H7 Â· Web Push â€” fase 8 (MEDIA).** Notificaciones que valen sin la app abierta: claves VAPID autogeneradas y cifradas, sucursal por dispositivo (`push_subscripciones`), envÃ­o al fallar, al pedir aprobaciÃ³n y al terminar, dedupe por evento (`push_enviados`) y receptor en el service worker. ImplementaciÃ³n en marcha en este mismo PR.
- [x] **H8 Â· Registro y gobernanza de disco (BAJA).** Este archivo unifica hallazgos, fases y operativa (los archivos de fase quedan como redirigentes); la purga del historial + `limpiarCopias` + la mÃ©trica de tamaÃ±os de Ajustes â†’ Servidor cubren el disco de tareas antiguas. Evidencia: PR #102 y esta consolidaciÃ³n.

### AnÃ¡lisis menores de la auditorÃ­a (mejoras sin bloqueo)

- [x] **A-m1 Â· Drenado al abortar (tokens).** Verificado que los eventos pendientes se siguen consumiendo y registrando tras el rechazo: no perdiÃ³ uso; no hace falta cambio.
- [ ] **A-m2 Â· Tokens incrementales de Codex.** Los chats de Codex registran el uso al completar el turno; una mejora opcional es tomar los `token_count` intermedios para precisiÃ³n en ejecuciones largas.
- [x] **A-m3 Â· DesalineaciÃ³n de documentaciÃ³n.** AGENTS.md citaba Â«migraciÃ³n 019Â» como vigente y decÃ­a que faltaba probar OpenCode real en el VM (ya corre real); corregido y desalineaciÃ³n de migraciones resuelta aquÃ­. Evidencia: PR #102.
- [x] **A-m4 Â· Higiene del repo local.** `main` local quedÃ³ rezagada frente a `origin/main` y ~47 ramas locales viejas; se adelanta `main` con avance rÃ¡pido y se archivan las ramas sin fusiÃ³n como `archivo/<rama>` (equipo local, no va por PR).


## Fases del producto


Estado al 14 de octubre de 2026. Una fase no se marca como hecha hasta cumplir sus criterios de aceptaciÃ³n.

## VisiÃ³n

Lanzar tareas de IA desde el telÃ©fono o la PC y dejarlas corriendo en un VM de forma continua. El sistema pide aprobaciÃ³n antes de tocar repositorios y avisa cuando una tarea falla, necesita aprobaciÃ³n o termina. Todos los proveedores (OpenCode, Google/agy, Codex) se gestionan desde una sola interfaz, con su cuota, costo y rendimiento.

## Fases

### 0. Base: hecho
- Servidor Hono, SQLite con migraciones e interfaz Vite/React en el VM, como servicio systemd.
- Chat con OpenCode: sesiones con contexto, y tokens y costo por mensaje.
- **Criterio:** el servicio sigue corriendo al cerrar la sesiÃ³n SSH o apagar la PC.

### 1. Chat moderno: hecho
- Selector de modelo con medidor de costo, esfuerzo por modelo y barra lateral.
- **Criterio:** funciona a 390 px y 1440 px, sin scroll horizontal.

### 2. Tareas en segundo plano: hecho (PR #4)
- Cola de hasta diez tareas independientes en paralelo; las tareas del mismo proyecto se serializan. Cancelar mata el Ã¡rbol de procesos. Al arrancar, las que seguÃ­an en ejecuciÃ³n pasan a `interrupted`.
- **Criterio:** cancelar una tarea con un proceso hijo (`sleep`) termina en pocos segundos, sin quedar colgada.

### 3. App instalable, analÃ­ticas y ajustes: mergeada (PR #5)
- PWA instalable. AnalÃ­ticas: KPI, costo por dÃ­a y por modelo, presupuesto del mes. Ajustes: modelo, esfuerzo, presupuesto y aviso.
- **Pendiente de validar en el VM:** que la migraciÃ³n `004_settings` estÃ© aplicada y que `GET /api/preferences` responda 200.
- **Criterio:** la app se instala desde HTTPS en el telÃ©fono.

### 4. RediseÃ±o visual: en curso
- Sistema de diseÃ±o en `DESIGN.md`. Pantallas generadas en Stitch con `docs/design/STITCH_PROMPT.md`. `impeccable` como guÃ­a de revisiÃ³n.
- RevisiÃ³n automÃ¡tica del 14 de octubre: 32 capturas (8 vistas, 390 y 1440 px, claro y oscuro) sin desbordes horizontales ni errores de consola. Falta revisar el resto a ojo y el contraste AA.
- **Criterio:** las cinco pantallas revisadas a 390 px y 1440 px. Contraste AA. Solo tokens de color. Sin cambios de comportamiento.

### 5. Analizador y obrero por tarea: mergeada (PR #28). OpenCode real corre en el VM
- MigraciÃ³n `019_analizador_obrero`: la tabla `tasks` se reconstruye con los estados `analyzing` y `waiting_approval`, y las columnas `plan`, `reporte` y `plan_aprobado_en`. Es la Ãºnica migraciÃ³n que se aplica con claves forÃ¡neas apagadas (`sinClaves`); el runner comprueba la integridad antes de confirmar. El historial (`task_events`) y las aprobaciones (`task_approvals`) se conservan.
- El analizador produce un plan en JSON (`server/src/plan.ts`). Si el plan pide commit, push o PR, o trae preguntas, la tarea espera en `waiting_approval`. Si no, pasa directo al obrero.
- El obrero ejecuta solo el plan aprobado, en la misma sesiÃ³n y carpeta que el analizador, y guarda un reporte en JSON. Si se desvÃ­a, la tarea vuelve al analizador con el motivo; el plan se replanifica hasta `MAX_PLANES` (3 versiones) y despuÃ©s la tarea falla.
- Rutas: `POST /api/tasks/:id/aprobar-plan` (acepta notas para el obrero) y `POST /api/tasks/:id/rechazar-plan`.
- Pruebas: `server/tests/plan.test.ts` (funciones puras) y `server/tests/analizador.test.ts`, que corre el flujo completo con un `opencode` falso (`server/tests/fixtures/bin/opencode`).
- Estado real: la BD del VM registra sesiones de OpenCode reales en 35 tareas de la fase (19 falladas, 16 terminadas), con trazas y reportes. Pendiente como seÃ±alizaciÃ³n: observar el cierre por silencio del vigilante de inactividad en tareas colgadas.

### 6. Proyectos de GitHub
- Estado: mergeada (PR #14), con integraciÃ³n posterior de GitHub App. Cada tarea de un proyecto Git trabaja en su clon (`telo/<id8>`). AprobaciÃ³n de commit y push ligada al hash del diff; escaneo de secretos antes del commit; la GitHub App vinculada emite tokens breves limitados al repo para clonar, subir y abrir PRs. Prueba real en Test (16 oct. 2026): clonado privado, commit y push completados con la App; falta resolver el 422 de creaciÃ³n de PR en el VM desplegado. Sigue pendiente probar un agente real.
- La clave privada de la GitHub App vive en el VM, fuera del repo y legible solo por el servicio. La instalaciÃ³n se limita a los repositorios seleccionados.
- Clonar repos en el VM. Cada tarea corre en el workspace de su proyecto.
- Antes de commit, push o PR, mostrar el diff en la app y pedir aprobaciÃ³n.
- **Criterio:** el token nunca aparece en logs ni en respuestas de la API. No hay push sin aprobaciÃ³n registrada.

### 7. Login de proveedores desde la app
- Codex inicia sesiÃ³n mediante el flujo de dispositivo. Gemini usa la clave de AI Studio configurada como proveedor.
- La conexiÃ³n OAuth de cuenta Google se retirÃ³: solo almacenaba una autorizaciÃ³n y no alimentaba el uso de modelos ni sus mÃ©tricas.
- **Criterio:** al terminar el flujo, el proveedor aparece como conectado. Ninguna clave se pega en la interfaz.
- **Antes de implementar:** investigar los comandos de login de cada CLI en el VM.

### 8. Notificaciones
- Estado: pendiente. Telegram y Discord quedan fuera por decisiÃ³n del usuario. Hoy los avisos del navegador (`web/src/lib/notificaciones.ts`) solo llegan con Telo abierta.
- Web Push (u otro canal) al fallar, al necesitar aprobaciÃ³n y al terminar una tarea. Es lo Ãºnico que queda de esta fase: requiere claves VAPID, suscripciones por dispositivo y su protocolo de cifrado (RFC 8291).
- **Criterio:** cada evento notifica una vez. Reabrir la app no repite las notificaciones.

### 9. Acceso seguro (Tailscale)
- Estado: el servidor escucha en `127.0.0.1` por defecto (`TELO_ESCUCHAR`). Pendiente en el VM: probar desde el telÃ©fono, confirmar que `tailscale serve` sigue activo tras reiniciar y desactivar la expiraciÃ³n de la clave.
- Telo corre en el VM y solo es accesible desde los dispositivos de la red privada de Tailscale, con HTTPS por `tailscale serve`.
- El login de Telo (`TELO_CLAVE`) sigue activo como segunda capa: Tailscale decide quiÃ©n llega al servidor; Telo decide quiÃ©n puede operarlo.
- Verificado desde la PC: la cookie sale con `Secure`, `HttpOnly` y `SameSite=Strict` a travÃ©s de `serve`.
- Pendiente: probar desde el telÃ©fono; desactivar la expiraciÃ³n de la clave del VM; comprobar que `serve` sigue activo tras reiniciar.
- **Criterio:** PC y telÃ©fono abren la app desde cualquier red. Sin Tailscale, la URL no resuelve. El puerto 3000 no estÃ¡ abierto en el NSG.
- Por ahora no se usa Funnel (acceso pÃºblico): exigirÃ­a endurecer la app antes de publicarla.

### 10. Cuota y saldo de proveedores
- Estado: `GET /api/uso` y el botÃ³n Â«UsoÂ» junto al modelo muestran el gasto y los tokens de las Ãºltimas 5 horas y de los Ãºltimos 7 dÃ­as medidos por Telo. Los lÃ­mites del proveedor no se leen de su API; se muestran como Â«medido por TeloÂ».
- Primera versiÃ³n en `feat/chats-gestion` (migraciÃ³n `008`): el usuario anota el saldo de cada cuenta o clave y Telo resta el uso que registrÃ³ despuÃ©s. Es estimado. NingÃºn proveedor se consulta en vivo.
- Panel con saldo o cuota restante por cuenta o API (OpenCode, OpenRouter, Groq, NVIDIA, Google, Codex) y tiempo restante estimado.
- DecisiÃ³n del usuario: consultar saldo o cuota antes que poner un tope de gasto por tarea.
- **Criterio:** cada proveedor muestra la fecha de su Ãºltima consulta. Si no hay API de saldo, se marca como manual.

### 11. Proyectos: memoria, skills y AGENTS.md
- Estado: completada. Instrucciones, skills `SKILL.md`, memoria y `AGENTS.md` por proyecto se incorporan al contexto del agente; las skills globales se resuelven para todos los runners. Las tareas sin proyecto leen los documentos guÃ­a (`AGENTS.md`, `CLAUDE.md`, `README.md`) de su propio workspace y los antepone al prompt.
- Cada proyecto tiene su configuraciÃ³n: skills en formato `SKILL.md`, memoria que el sistema actualiza sola y su propio `AGENTS.md`.
- **Criterio:** una tarea del proyecto X usa sus skills y su memoria. Cambiar de proyecto no mezcla contexto.

### 12. Runners por proyecto
- Estado: parcial. OpenCode y Codex comparten la interfaz de ejecuciÃ³n y trabajan dentro del aislamiento del agente. Agy no estÃ¡ integrado y los runners aÃºn no se aÃ­slan en contenedores independientes por proyecto.

### 13. Panel del VM
- Estado: parcial. La pestaÃ±a Servidor en Ajustes muestra estado del proceso, carpetas y tamaÃ±os, herramientas instaladas, costos, uso y latencia medida en el navegador. Pendiente: terminal web (no se decide aÃºn si reemplaza a Cockpit).
- Configuraciones del servidor desde la app y terminal web integrada. Evaluar si reemplaza a Cockpit (puerto 9090) o solo lo enlaza.

## Decisiones tomadas

- Stack: TypeScript, Bun, SQLite, PWA. Sin Next.js.
- Acceso: Tailscale. Cloudflare se descartÃ³ (Workers VPC no estÃ¡ disponible en la cuenta) y el Quick Tunnel no sirve como acceso fijo.
- Hasta diez tareas independientes corren en paralelo; las tareas del mismo proyecto se encolan entre sÃ­.
- AprobaciÃ³n del usuario antes de commit, push o PR. La aprobaciÃ³n la aplica el backend, no una instrucciÃ³n al agente.
- Sin tope de gasto por tarea; se consulta saldo o cuota.
- Uso personal, con un solo usuario.
- El agente nunca recibe variables `TELO_*` (la clave de acceso).
- Una tarea que estaba corriendo al reiniciar el servidor queda `interrupted`, no `failed`.
- El agente corre dentro de bubblewrap, que solo le deja ver su carpeta de trabajo. Sin bubblewrap no se ejecuta (falla cerrado).
- Mensajes y tareas: el mensaje del usuario se guarda antes de correr el agente, y un chat ocupado no acepta otro envÃ­o. AsÃ­ los demÃ¡s dispositivos lo ven.
- Reanudar continÃºa la sesiÃ³n del agente en la misma carpeta. Reintentar crea una tarea nueva con el mismo prompt.
- Respaldos: copia diaria en el VM con `VACUUM INTO` y copia a la PC por Tailscale. Los respaldos no se guardan en el repo.
- Git: cada tarea de un proyecto trabaja en su clon. NingÃºn comando del servidor usa un repo que el agente pudo escribir sin quitarle antes la configuraciÃ³n peligrosa (`gitSeguro`).
- Aprobaciones: commit y push se aprueban contra el hash del diff revisado. Si el diff cambia, la aprobaciÃ³n se rechaza.
- Secretos por proyecto cifrados con AES-256-GCM. Sus valores no salen por la API, y el agente de ese proyecto los recibe como variables.
- El servidor escucha en `127.0.0.1`. Tailscale Serve entrega el trÃ¡fico desde el mismo equipo.

## Orden de trabajo

SegÃºn la revisiÃ³n del 10 de octubre, el nÃºcleo es el motor de tareas, el aislamiento del runner, la aprobaciÃ³n y la recuperaciÃ³n. Antes de ampliar proveedores o interfaz:

1. Seguridad del runner: entorno sin secretos, cancelaciÃ³n por grupo de procesos. (`fix/runner-seguridad`)
2. Estados formales y recuperaciÃ³n: `interrupted`, reanudar, reintentar o cancelar. (`006` aplicada. Reanudar y reintentar, en `feat/chats-gestion`, pendiente de revisiÃ³n.)
3. Registro de eventos por tarea, para depurar, auditar y alimentar notificaciones. (`009`, en `feat/chats-gestion`.)
4. Fase 5 (analizador y obrero, PR #28) y fase 6 (Git con aprobaciÃ³n en el backend, PR #14): mergeadas. Falta probarlas con OpenCode real en el VM.
5. Respaldos de la base y del workspace fuera del VM. (`server/scripts/respaldo.ts`, timer en `deploy/` y copia a la PC. Probado en local; falta probar el timer en el VM.)
6. Fase 9 (acceso por Tailscale) y pendientes de la secciÃ³n de acceso.
7. Fases 10, 8 y 13: cuota con niveles de precisiÃ³n, notificaciones por eventos y panel del VM sin terminal web.
8. Fase 4 (rediseÃ±o visual) y proveedores adicionales.

## Preguntas abiertas

- Â¿El panel del VM dentro de la app reemplaza a Cockpit o solo lo enlaza?
- Â¿QuÃ© proveedores tienen API de saldo y cuÃ¡les se consultan a mano?
- Â¿La memoria del agente se actualiza sola o solo con aprobaciÃ³n? La revisiÃ³n recomienda separar observaciones de memoria aprobada.

## Verificación operativa


RevisiÃ³n: 22 de octubre de 2026. Una casilla marcada indica la comprobaciÃ³n descrita, no una validaciÃ³n implÃ­cita en producciÃ³n. El historial anterior estÃ¡ en Git.

## Fiabilidad de la aplicaciÃ³n

- [x] Inicio por cÃ³digo de dispositivo de Codex: enlace sin ANSI, cÃ³digo visible y copiable; pruebas y revisiÃ³n a 390/1440 px.
- [x] La detecciÃ³n de sesiÃ³n consulta `codex login status`, con lÃ­mite de tiempo y cachÃ© breve; no acepta un archivo de configuraciÃ³n como prueba de autenticaciÃ³n.
- [x] El worker comprueba herramientas antes de llamar a un modelo. Los avisos sobre dependencias ausentes se guardan y se entregan al analizador para preparar su instalaciÃ³n antes de las pruebas.
- [x] Las autorizaciones Git se vinculan al mensaje que las originÃ³; repetir una decisiÃ³n no repite la operaciÃ³n.
- [x] Los reportes JSON antiguos muestran resumen y causa; los detalles se despliegan y los bloques de memoria no se muestran. No se evalÃºan expresiones del modelo.
- [x] MÃ©tricas: tokens medidos, costes estimados, datos ausentes e histÃ³ricos sin precisiÃ³n identificada. Uso por tarea en ejecuciones recientes; la memoria sigue incluida en la tarea y no se atribuye dos veces.
- [x] CI definida para cada PR: tipos, suites aisladas del servidor, worker Linux, build y navegador a 390/1440 px. Confirmar la ejecuciÃ³n concreta en el PR antes de fusionar.

## Prueba real de GitHub App en el VM

- [x] Repositorio desechable autorizado: `https://github.com/PABLOCESAR2412/Test.git`; confirmado privado y vacÃ­o por GitHub.
- [x] Configurar `TELO_GITHUB_APP_ID` y `TELO_GITHUB_APP_PRIVATE_KEY_PATH` en el servicio, vincular la instalaciÃ³n en Ajustes e incluir Test en su alcance.
- [x] Inicializar la rama base de Test con README, commit `e0cafee891fcc20c4f369faebf5067041aa54aa0`. PreparaciÃ³n mediante la cuenta de GitHub; no demuestra autenticaciÃ³n con la App de Telo.
- [x] Desde Telo, clonar Test privado con la GitHub App, crear el cambio mÃ­nimo y autorizar commit/push. GitHub confirma la rama `telo/0e680496`, el commit `325247bef1fee13ef793813f1f924d2de744984e` y el autor `telo-orquestador[bot]`.
- [ ] Crear un PR de Test. GitHub respondiÃ³ 422 en la versiÃ³n desplegada y Telo ocultÃ³ el cuerpo de validaciÃ³n; el cÃ³digo de este PR ahora conserva ese detalle. No se fusionÃ³ ni se tocÃ³ Cubo. Reintentar una vez que el PR #53 estÃ© desplegado; no repetir solicitudes mientras el motivo siga sin diagnÃ³stico.

## VerificaciÃ³n operativa despuÃ©s del despliegue

- [ ] Confirmar en el VM la migraciÃ³n 039 (Ã­ndices de `repository_actions`) y la copia previa en `DATA_DIR/respaldos-migracion`; comprobar que se conservan los valores histÃ³ricos.
- [x] En el VM el worker corre el runner OpenCode real (tareas terminadas y fallidas de la Ãºltima fase; clonado, cancelaciÃ³n y reanudaciÃ³n incluidas en los ciclos). Falta observar los cierres del nuevo vigilante de inactividad en tareas colgadas. Las pruebas automÃ¡ticas usan un agente ficticio.
- [ ] Confirmar acceso desde el telÃ©fono por Tailscale y arranque de app, Serve y respaldos tras reiniciar el VM.
- [ ] Confirmar `TELO_PROYECTOS_DIR`, escucha en loopback, clave de cifrado respaldada y desactivaciÃ³n de expiraciÃ³n de la clave Tailscale del VM.
- [ ] Revisar contraste AA en todas las pantallas, ademÃ¡s de las comprobaciones automÃ¡ticas de desbordes.
- [ ] Confirmar presupuesto y alertas de Azure. Revisar ramas remotas y claves SSH antiguas antes de eliminarlas.

## Acceso de desarrollo

La prueba de acceso de GitHub App en Test se completÃ³ para clonado, commit y push. Falta que el flujo desplegado muestre el motivo del rechazo 422 para completar la creaciÃ³n del PR. No compartir claves privadas, tokens ni archivos de sesiÃ³n en el chat.

## Apéndice histórico: fase 2

# Fase 2: seguimiento de cambios

> Registro histÃ³rico. Los estados, cantidades y harnesses de esta fase describen la revisiÃ³n original; las rutas `scratchpad/` eran locales y no estÃ¡n en el repo actual.

Rama: `feat/seguir-tras-cuota` (creada desde `feat/proyectos-tarjetas`, commit 507f01c).
La fase A estÃ¡ en commit `7a93c2b` y subida a `origin`. La fase B estÃ¡ en el Ã¡rbol de trabajo, sin commit. No hay PR.

Leyenda: [x] hecho y verificado Â· [~] hecho, pendiente de confirmar en el VM Â· [ ] pendiente

---

## A. Detener al agotarse la cuota y botÃ³n "Seguir"  âœ… terminada

### A1. Servidor

- [x] `server/src/runners/opencode.ts`: clase `ErrorAgente` con `detalleProveedor`, y funciÃ³n `detalleDelProveedor()` exportada. Usa el evento de error del proveedor o, si no hay, la cola de `stderr` sin rutas. AsÃ­ una carpeta llamada "cuota" o "saldo" no marca cuota por error.
- [x] `server/src/ejecutar.ts`:
  - `PATRON_CUOTA`, `ErrorCuota(modelo, sessionId)`, `esErrorDeCuota()`. Solo mira `detalleProveedor`.
  - `promptContinuacion(prompt)`: prefijo "ContinÃºa donde te quedasteâ€¦".
  - `ejecutarAgente`: el `catch` convierte en `ErrorCuota` los errores de cuota, tambiÃ©n cuando falla el modelo de respaldo.
- [x] `server/src/db/index.ts`: migraciÃ³n `020_cuota_seguir`. Reconstruye `tasks` (estado `sin_cuota`, columnas `modelo_agotado` y `continuar`) y aÃ±ade `conversations.cuota_modelo`.
- [x] `server/src/worker.ts`: `pausarPorCuota()`, `promptDeFase()` y `cancelTask()` acepta `sin_cuota`.
- [x] `server/src/routes/tasks.ts`: `POST /api/tasks/:id/seguir` (body `{model?, effort?}`). Rechaza el mismo modelo con `modelo_sin_cambio`.
- [x] `server/src/routes/chat.ts`: `ejecutarTurno()` compartido entre enviar y seguir; `POST /api/conversations/:id/seguir`; `GET /api/conversations` devuelve `cuota_modelo`; un envÃ­o exitoso lo limpia.
- [x] `server/src/eventos.ts` (tipos `sin_cuota`, `seguida`) y `server/src/routes/analytics.ts` (`sin_cuota` en `TASK_STATUSES`).

### A2. Web

- [x] `web/src/api.ts`: tipos nuevos y `api.continueTask()`, `api.continueChat()`.
- [x] `web/src/lib/model.ts`: etiquetas y mensajes en espaÃ±ol.
- [x] `web/src/components/cuota-aviso.tsx` (nuevo): `AvisoCuota`, compartido por tareas y chats.
- [x] `web/src/styles.css`: bloque `.cuota-aviso` y `.cuota-selector` al final del archivo. Ãmbar solo en el borde.
- [x] `web/src/pages/tasks.tsx`: estado "Sin cuota Â· elige modelo", cancelar desde la tarjeta, aviso y selector de modelo en el detalle, y el error genÃ©rico oculto en `sin_cuota`.
- [x] `web/src/pages/chat.tsx`: `cuota_agotada` en `GUARDADO_EN_ERROR` (el mensaje no vuelve al borrador), `sendError` no repite el aviso, mutaciÃ³n `seguirChat`, aviso debajo de la conversaciÃ³n.
- [x] `web/src/lib/notificaciones.ts` (aviso de sistema) y `web/src/components/tarea-pasos.tsx` (paso final "Sin cuota").
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`).

### A3. Pruebas

- [x] `server/tests/cuota.test.ts`: 13 pruebas (clasificaciÃ³n, migraciÃ³n, rechazos de seguir).
- [x] Punta a punta con servidor real y `opencode` falso (harness local no versionado): 25 de 25 en esa revisiÃ³n.
- [x] RevisiÃ³n visual con un harness local no versionado a 390 y 1440 px, claro y oscuro.

### A4. Problemas encontrados y resueltos

- La clasificaciÃ³n de cuota leÃ­a el mensaje completo, que incluye rutas del servidor. Una carpeta "cuota-â€¦" hacÃ­a que cualquier fallo se viera como cuota. Ahora solo cuenta lo que dijo el proveedor (ver A1).
- El selector de modelo del detalle de tarea abrÃ­a fuera de la pantalla: el contenedor no era posicionado. Se corrigiÃ³ con `.cuota-selector`.
- Las capturas al principio mostraban la versiÃ³n anterior porque `web/dist` no se habÃ­a reconstruido. Regla: reconstruir antes de revisar.

### A5. Pendiente de confirmar en el VM

- [~] La detecciÃ³n de cuota usa patrones (429, "rate limit", "quota", "usage limit", "insufficient", "saldo", etc.). El texto exacto que devuelve OpenCode con un modelo sin cuota no estÃ¡ verificado. Hay que comprobarlo con un modelo real agotado. Si el texto no coincide, la tarea queda en `failed` como antes: no hay regresiÃ³n, pero no se detiene con aviso.
  - CÃ³mo: en el VM, provocar una cuota agotada con un modelo de prueba y revisar `task_events` y la salida de la tarea (`journalctl -u orquestador`).
- [x] El respaldo ante saturaciÃ³n se decide por un estado HTTP transitorio explÃ­cito en `esErrorTransitorioDelProveedor`; la regla amplia antigua se retirÃ³.

---

## B. Claves de Groq, NVIDIA y Gemini  ðŸŸ¡ hecha en servidor y web; falta confirmar en el VM

### Nombres de variable

- Groq: `GROQ_API_KEY`. Confirmado en la documentaciÃ³n de OpenCode.
- Gemini: se envÃ­an **dos** variables, `GOOGLE_GENERATIVE_AI_API_KEY` y `GEMINI_API_KEY`. La nota anterior que daba solo `GEMINI_API_KEY` venÃ­a de un mirror de la versiÃ³n antigua en Go de OpenCode; la versiÃ³n actual probablemente usa `GOOGLE_GENERATIVE_AI_API_KEY` (no verificado). Enviar las dos evita depender de la versiÃ³n. Confirmar en el VM con `opencode models` (id de proveedor `google`).
- NVIDIA: `NVIDIA_API_KEY`. Solo aparece en un artÃ­culo de terceros: **no confirmado**. Ver B-VM.

### Servidor

- [x] `server/src/claves-proveedor.ts` (nuevo): almacenamiento cifrado con AES-256-GCM, AAD `proveedor:<id>`, misma clave maestra `TELO_CLAVE_CIFRADO` que los secretos. Nunca devuelve valores. `entornoProveedores()` entrega las variables al agente y a `opencode models`.
- [x] `server/src/db/index.ts`: migraciÃ³n `021_claves_proveedor` (tabla `provider_keys`).
- [x] `server/src/routes/claves-proveedor.ts` (nuevo): `GET /api/claves-proveedor`, `PUT /api/claves-proveedor/:id` (body `{valor}`), `DELETE /api/claves-proveedor/:id`. CÃ³digos de error: `proveedor_desconocido`, `clave_proveedor_invalida`, `proveedor_sin_clave`, `secretos_no_configurados`. Cada cambio invalida la lista de modelos. Montado en `server/src/index.ts`.
- [x] `server/src/ejecutar.ts`: las claves entran como `extraEnv` de cada ejecuciÃ³n y se ocultan en la salida (`valoresAOcultar`). Si un secreto de proyecto tiene el mismo nombre, gana el del proyecto.
- [x] `server/src/models.ts`: `opencode models` recibe las claves (`entornoDelCli()`); `invalidarModelos()`. Nunca recibe variables `TELO_*`.
- [x] `server/src/routes/providers.ts`: cada proveedor dice `configured`, `enAgente`, `guardable`, `guardada`, `variable`. Nunca el valor. Groq, NVIDIA y Gemini quedan `implemented: true`.

### Web

- [x] `web/src/api.ts`: tipo `ProviderStatus` con `guardable` y `guardada`; `api.setProviderKey()` y `api.deleteProviderKey()`.
- [x] `web/src/pages/settings.tsx`: en Ajustes > Proveedores IA, cada proveedor guardable tiene un campo de clave (`CampoClave`) con Mostrar/Ocultar, Guardar y Quitar. Enter guarda sin enviar el formulario de preferencias.
- [x] `web/src/lib/model.ts`: mensajes en espaÃ±ol para `proveedor_desconocido`, `clave_proveedor_invalida` y `proveedor_sin_clave`.
- [x] `web/src/styles-ajustes.css`: `.aj-clave-fila`.
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`).

### Pruebas

- [x] `server/tests/claves-proveedor.test.ts` (nuevo): 21 pruebas. Guardar y leer, valor cifrado en la base, sin clave maestra, clave que no descifra, validaciÃ³n, estado sin valores, redacciÃ³n, rutas y `GET /providers`.
- [x] `server/tests/entorno-proveedores.test.ts` (nuevo): 3 pruebas de punto a punto con un `opencode` falso. El agente y `opencode models` reciben `GROQ_API_KEY`; ninguno recibe `TELO_*`; la clave que el agente imprime sale oculta en su respuesta.
- [x] `bun test` del servidor: 203 pasan, 0 fallan.
- [x] `tsc --noEmit` del servidor y `bun run build` de la web: pasan.
- [x] RevisiÃ³n visual con un harness local no versionado a 390 y 1440 px, claro y oscuro: sin desborde horizontal ni errores de consola.

### Pendiente de confirmar en el VM (B-VM)

- [ ] NVIDIA: con `NVIDIA_API_KEY` guardada, ejecutar `opencode models --verbose` (con el mismo entorno del servicio) y comprobar que aparecen modelos `nvidia/...`. Si el nombre de variable o el proveedor son otros, corregir `PROVEEDORES_CON_CLAVE` en `server/src/claves-proveedor.ts` y la lista de `server/src/routes/providers.ts`.
- [ ] Gemini: confirmar el id de proveedor que usa OpenCode (`google` u otro) y que `GEMINI_API_KEY` basta para que aparezcan sus modelos.
- [ ] Groq: comprobar que aparecen modelos `groq/...` tras guardar la clave.

CÃ³mo hacerlo en el VM:
1. Confirmar que `TELO_CLAVE_CIFRADO` estÃ¡ en `/etc/orquestador/orquestador.env`. Sin ella, Ajustes responde "secretos no configurados".
2. Entrar a Ajustes > Proveedores IA, pegar la clave en cada proveedor y pulsar Guardar.
3. Revisar la lista de modelos en Ajustes o en el selector del chat.

### Riesgos conocidos

- Las claves guardadas llegan a **todos** los agentes, no solo al proveedor que las usa. Un modelo de Groq podrÃ­a leer la clave de NVIDIA si el agente la busca en su entorno. Mejora posible: pasar a cada agente solo las claves del proveedor de su modelo.
- La app recorta los espacios de los extremos antes de enviar. Un valor con espacios o saltos por dentro se rechaza con `clave_proveedor_invalida`.

---

## C. "Generar anÃ¡lisis": memoria y skills del proyecto  â³ no empezada

- [ ] EjecuciÃ³n del agente que lea el proyecto y devuelva JSON con memoria y skills propuestas. Reusar `ejecutarAgente` con `aprender` (ver `server/src/memoria.ts`: `guardarMemoria`, `extraerMemoria`).
- [ ] MigraciÃ³n nueva: tabla `project_skills` (nombre, descripciÃ³n, contenido, estado propuesto/aceptado, fecha). Rutas en `server/src/routes/projects.ts`.
- [ ] RevisiÃ³n antes de guardar: el usuario acepta o descarta cada propuesta.
- [ ] Sin skills: aviso "Instalar skills" con enlace a la fuente. Antes de escribir el enlace, verificar que `skills.sh` existe y cuÃ¡l es el comando de instalaciÃ³n.
- [ ] UI: `web/src/components/proyecto-skills.tsx` (hoy es placeholder) y la secciÃ³n Memoria en `web/src/pages/proyecto.tsx`.

---

## D. Claude y Codex (y login de cuenta de Gemini)  ðŸ›‘ espera decisiÃ³n tuya

Pregunta abierta: Â¿inicio de sesiÃ³n de cuenta en el VM (como en las capturas: abrir enlace y pegar cÃ³digo) o clave de API?

- Login de cuenta: guarda tokens de terceros en el VM y requiere revisiÃ³n de seguridad. Plan distinto.
- Clave de API: mÃ¡s simple, pero Claude y Codex sin costo solo se logran con cuenta, segÃºn lo que pediste.

No se codifica hasta decidirlo.

---

## Orden recomendado

1. En el VM, confirmar el texto real de cuota de OpenCode (A5) y los nombres de variable de NVIDIA y Gemini (B-VM).
2. C: "Generar anÃ¡lisis".
3. D: esperar tu decisiÃ³n.
4. Commit y PR solo cuando lo pidas.

## E. Correcciones tras probar en el VM  ðŸŸ¡ en curso (rama `feat/seguir-tras-cuota`)

Estado detallado en `FASE3.md`. Resumen:

- [x] **Chat en segundo plano** (`6dddd05`). El turno ya no depende de la peticiÃ³n HTTP. La web comprueba si un envÃ­o llegÃ³ antes de devolver el texto al compositor. Verificado en navegador.
- [x] **Barra lateral.** Sin enlace Chat; los chats de proyecto aparecen con su nombre.
- [x] **Modelos de Groq, NVIDIA y Gemini** visibles cuando su clave llega al CLI. Gemini envÃ­a dos variables. Ajustes muestra cuÃ¡ntos modelos ve OpenCode y avisa si no ve ninguno. Pendiente en el VM: confirmar `google` y `NVIDIA_API_KEY` con `opencode models`.
- [x] **Vista de proyectos.** MÃ©tricas desde `GET /api/projects` y acciones en iconos de 40 px.
- [x] **Memoria del proyecto editable** a mano, con redacciÃ³n y lÃ­mite.
- [~] **Estado y registros del servidor** en Ajustes. Hecho: estado de la unidad y registros con redacciÃ³n. Requiere en el VM: `usermod -aG systemd-journal orquestador` (ver `deploy/README.md`). Pendiente: gasto de Azure (decisiÃ³n del usuario).
- [ ] **Skills configurables** (tarea 7). Bloqueada: hay que confirmar en el VM dÃ³nde lee OpenCode las skills, y decidir si son globales o por proyecto.
- [ ] **Claves y botÃ³n "Instalar"** (tarea 9). Bloqueada: instalar software en el VM necesita aprobaciÃ³n explÃ­cita.
- [ ] **Codex, Gemini y Claude gratis** (tarea 10). Bloqueada: decidir si se acepta el login de dispositivo de Codex en el VM y si Claude se conecta solo con clave de API.

CorrecciÃ³n de la nota de Gemini: ver secciÃ³n B.

### Estado tras la fase 3 (tareas 7, 9 y 10)

- Skills globales y por proyecto, editables desde Ajustes y desde el proyecto. Pendiente en el VM: confirmar que OpenCode las lista.
- OpenCode se puede instalar desde Ajustes con confirmaciÃ³n (comando fijo, `npm install -g --prefix ~/.opencode opencode-ai`). Pendiente: `npm` en el PATH del servicio.
- Codex: inicio de sesiÃ³n por cÃ³digo de dispositivo desde Ajustes. Pendiente: confirmar el comando `codex login --device-auth` y el archivo de sesiÃ³n en el VM. Los agentes todavÃ­a no usan Codex.
- Claude gratis: sin decisiÃ³n; no se implementa.


## Apéndice histórico: fase 3

# Fase 3: correcciones tras probar en el VM

> Documento histÃ³rico de traspaso. Ramas, conteos de pruebas y estados son snapshots de la fecha indicada, no describen el checkout actual. Los harnesses visuales bajo `scratchpad/` eran locales y no estÃ¡n versionados.

Documento de traspaso. Quien lo continÃºe debe leer tambiÃ©n `CLAUDE.md`, `DESIGN.md` y `FASE2.md`.

Rama de trabajo: `fix/notas-acciones-git`, desde `main` (`90f324e`). Contiene las correcciones de la Tarea 11 y de las pruebas de Codex. Sin commit ni push todavÃ­a. La rama `feat/seguir-tras-cuota` ya estÃ¡ en `main` por el PR 35.

Leyenda: [x] hecho y verificado Â· [~] escrito, sin probar Â· [ ] pendiente

---

## Reglas de trabajo (obligatorias)

- Idioma: interfaz, errores y comentarios de negocio en espaÃ±ol. Identificadores segÃºn el archivo.
- Colores y medidas solo de tokens en `web/src/styles.css`. Ãmbar solo para estado activo, alerta o acciÃ³n principal.
- MÃ³vil primero: 390 px sin scroll horizontal; 1440 px tambiÃ©n. Objetivos tÃ¡ctiles de 40 px.
- Errores de API siempre por `errorText()` (`web/src/lib/model.ts`).
- Migraciones: nunca editar una ya aplicada. Esta fase no necesita migraciones nuevas.
- Cada tarea termina con una entrada en `web/src/cambios.json` (`minimo` para correcciones, `mediano` para pantallas o funciones).
- Git: **el agente ejecuta los comandos de git Ã©l mismo**, pero antes pide aprobaciÃ³n explÃ­cita de cada commit y de cada push. No dar comandos al usuario para que los corra. No abrir PR.
- No hacer commit de nada que no haya pasado `bun test`, `tsc` del servidor y `bun run build` de la web.
- Reutilizar componentes existentes (`ConvItem`, `AvisoCuota`, `AppNav`, `errorText`, `api.*`). No duplicar.

## Comandos de verificaciÃ³n

```
cd server && bun test                      # suite actual; los conteos indicados en tareas son histÃ³ricos
cd server && bunx tsc --noEmit -p .       # typecheck servidor
cd web && bun run build                    # typecheck + build web (obligatorio antes de revisar UI)
```

La revisiÃ³n visual histÃ³rica usÃ³ un harness local no versionado. El canal en vivo admite SSE y sondeo; la interfaz actual usa `GET /api/eventos-vivos/poll`.

---

## Estado actual

Lista de control. Se marca lo hecho en cada tarea y aquÃ­ a la vez.

- [x] **Servidor del chat en segundo plano** (commit `6dddd05`). `POST /api/conversations/:id/messages` y `/seguir` guardan el mensaje, lanzan el turno en segundo plano y responden **202** `{ messages: [turno] }`. Los fallos quedan como mensaje `role: "system"` en el chat. Verificado: `bun test tests/chat-turnos.test.ts` pasa (4 de 4) y `tsc --noEmit` del servidor estÃ¡ limpio.
- [x] Evento `chat` en el canal en vivo (`bus.ts`, `routes/stream.ts`, `api.ts`, `lib/eventos-vivos.ts`); la interfaz lo consume mediante sondeo corto.
- [x] `avisarTurnosInterrumpidos()` en el arranque (`index.ts`).
- [x] **Tarea 1.** Web del chat (`chat.tsx`). Hecha: envÃ­o sin respuesta del servidor comprobado contra la lista (sin duplicar ni perder el texto), `GUARDADO_EN_ERROR` quitado, evento `chat` escuchado, aviso `system` como alerta de estado. Verificada con Playwright (corte de respuesta, 409 simulado, fallo del agente, mensaje de otro dispositivo). Captura a 390 y 1440 px. Entrada en `cambios.json`.
- [x] **Tarea 2.** Barra lateral: sin enlace Chat; chats de proyecto visibles con su nombre debajo. Verificada a 390 y 1440 px, sin desborde. `DESIGN.md` y `cambios.json` actualizados.
- [x] **Tarea 3.** Modelos de Groq, NVIDIA y Gemini visibles cuando su clave llega al CLI; Gemini con dos variables; diagnÃ³stico en Ajustes. VerificaciÃ³n registrada entonces: 209 pruebas, `tsc` y revisiÃ³n visual (conteos histÃ³ricos, no actuales). **Pendiente en el VM:** confirmar el id `google` y el nombre de variable de NVIDIA con `opencode models`.
- [x] **Tarea 4.** Vista de proyectos con mÃ©tricas (chats, tareas, Ãºltima actividad desde `GET /api/projects`) y acciones en iconos de 40 px. Verificada a 390 y 1440 px, claro y oscuro: mÃ©tricas, 40 px, anclar desde el icono, confirmaciÃ³n al eliminar, sin desborde. Pruebas de servidor en `proyectos.test.ts`.
- [x] **Tarea 5.** Cierre de la fase 3. VerificaciÃ³n registrada entonces: 246 pruebas, `tsc`, `bun run build` y 29 revisiones de navegador (cifras histÃ³ricas, no actuales). Subido con aprobaciÃ³n del usuario: `502b781` y merge `79b126e`.
- [~] **Tarea 6.** Estado, logs y gasto de Azure en Ajustes. **Hecho:** estado de la unidad y registros (`GET /api/servidor/servicio` y `/logs`, con redacciÃ³n y sin shell; botÃ³n Ver logs activo). Verificado en el navegador y en `servidor-logs.test.ts`. **Pendiente:** gasto de Azure, que espera la decisiÃ³n del usuario sobre la identidad del VM (ver tarea 6, punto 3).
- [x] **Tarea 7.** Skills globales y por proyecto, editables desde la app. Verificada en navegador a 390 y 1440 px, y en `skills.test.ts`. **Pendiente en el VM:** confirmar que OpenCode las lista.
- [x] **Tarea 8.** Memoria del proyecto editable desde la app (`PUT /api/projects/:id/memoria`, con redacciÃ³n y lÃ­mite de 4 000 caracteres; botones Editar, Escribir, Guardar, Cancelar y Borrar). Verificada en el navegador a 390 y 1440 px, y en `proyectos.test.ts`. Supuesto confirmado en el cÃ³digo: "memoria" = memoria aprendida por proyecto.
- [x] **Tarea 9.** BotÃ³n "Instalar" de OpenCode con confirmaciÃ³n en dos pasos y comando fijo, verificado con npm falso (`instalacion.test.ts`) y en navegador. **Pendiente en el VM:** que `npm` exista para el servicio, y que `opencode models` liste los modelos de la clave guardada.
- [~] **Tarea 10.** Codex: login por cÃ³digo de dispositivo, verificado con CLI falso (`login-codex.test.ts`) y en navegador; **pendiente en el VM:** el comando exacto y el archivo de sesiÃ³n. Instalar Codex desde Ajustes: hecho (misma tarjeta que el login, verificado en navegador a 390 y 1440 px). Gemini: clave de AI Studio (tarea 3). Claude: **investigado, no implementado** (ver tarea 10, punto b).
- [~] **Tarea 11.** Acciones git desde los chats (commit, subir rama y abrir PR, siempre con aprobaciÃ³n). En `main` desde los PR 36 a 42. En esta rama se quitan la fusiÃ³n local y el push directo a `main`, el PR usa solo `GITHUB_PR_TOKEN` y las notas del plan dejan de romper la aprobaciÃ³n (ver Tarea 11). La protecciÃ³n de `main` en GitHub ya estÃ¡ hecha.
- [ ] **Tarea 12.** Cola de mensajes del chat: si envÃ­as mÃ¡s mientras el agente responde, se ejecutan en orden. Hoy se rechazan con 409. Pendiente (ver Tarea 12).
- [ ] **Tarea 13.** Wrangler (Cloudflare) instalable desde Ajustes, con inicio de sesiÃ³n por cÃ³digo. Pendiente de dos decisiones (ver Tarea 13).
- [x] **CorrecciÃ³n.** El error Â«opencode saliÃ³ con cÃ³digo 143Â» ya no aparece: el chat explica el lÃ­mite de 3 minutos. Causa en Â«DiagnÃ³stico del 143Â».
- [x] **CorrecciÃ³n.** `/tmp` propio dentro del sandbox: OpenCode ya no falla con Â«Read-only file systemÂ». Verificado con bwrap real.
- [x] **CorrecciÃ³n.** Notas del plan: al aprobar con notas, el obrero ya no rechaza el plan con Â«El plan cambiÃ³ despuÃ©s de su aprobaciÃ³nÂ». El hash cubre el plan sin las notas (`sinNotas`). La prueba extremo a extremo del analizador pasa.
- [x] **CorrecciÃ³n.** Pruebas de Codex: `HOME` se fija y se restaura en `beforeAll`/`afterAll`, y las rutas de sesiÃ³n se calculan en cada uso (`login-cli.ts`). Snapshot de esa suite: 290 aprobadas, 7 omitidas, 0 fallidas.
- [x] **Barra lateral.** Se quitÃ³ el nombre del proyecto debajo de cada chat. Verificada a 390 y 1440 px.

Orden: tareas 1 a 5 primero (ya acordadas), luego 6 a 10 en el orden en que el usuario las pidiÃ³. Decisiones tomadas: skills globales y por proyecto (7), instalar OpenCode con confirmaciÃ³n (9), login de Codex en el VM (10a). Pendiente: Claude gratis (10b), el gasto de Azure (6, necesita la identidad del VM) y lo que queda de las acciones git desde los chats (11).

Antes de seguir: correr `bun test tests/chat-turnos.test.ts`. Si falla, corregir el servidor antes de tocar la web. Si una prueba depende de tiempos, subir la espera de `esperar()`, no quitar la comprobaciÃ³n.

---

## Tarea 1. El chat no se detiene si el mÃ³vil o la PC se duermen, cambian de app o pierden red

**Causa.** Antes, el turno corrÃ­a dentro de la peticiÃ³n HTTP. Si la red se cortaba, `send` fallaba, la web tomaba el error como "no guardado" y devolvÃ­a el texto al compositor. Pero el servidor sÃ­ habÃ­a guardado el mensaje y seguÃ­a el agente: el resultado era un mensaje duplicado y una respuesta que no aparecÃ­a hasta recargar.

**QuÃ© hacer (web, `web/src/pages/chat.tsx`).**
1. En la mutaciÃ³n `send`, en `mutationFn`: si `api.sendMessage` falla con algo que no es `ApiError` (sin respuesta del servidor), pedir `api.listMessages(id)`. Si el Ãºltimo mensaje `role === "user"` tiene el mismo texto (`content.trim()`), dar el envÃ­o por bueno (`return { messages: [] }`). Si no, relanzar el error. Un `ApiError` siempre significa que no se guardÃ³: restaurar borrador como hoy.
2. Quitar `GUARDADO_EN_ERROR` y su uso en `onError`: ya no hay errores tras guardar.
3. `pensando` ya usa `current.ocupada`; dejarlo. Tras el 202 la lista de conversaciones se invalida (ya ocurre en `onSettled`).
4. En `useEventosVivos` (chat.tsx ya lo usa para `actividad`), manejar `evento.tipo === "chat"`: invalidar `["messages", evento.conversacion_id]` y `["conversations"]`.
5. En `lista.map`, antes del ternario `m.role === "user"`, renderizar `m.role === "system"` como aviso: `<p className="tl-alerta" role="status">{m.content}</p>`. Hoy caerÃ­a en la burbuja del agente.

**VerificaciÃ³n.**
- `bun test tests/chat-turnos.test.ts` en verde.
- Playwright: interceptar el POST con `route.fetch()` seguido de `route.abort()`. El servidor recibe el mensaje; el navegador ve un fallo de red. Esperado: el borrador no vuelve, aparece la respuesta del agente sin recargar.
- Playwright con `context.setOffline(true)` durante un turno largo y luego `setOffline(false)`. Esperado: la respuesta aparece al volver.
- Revisar 390 y 1440 px, claro y oscuro. Sin errores de consola.

**Cambios.** `cambios.json` tipo `minimo`.

---

## Tarea 2. Quitar "Chat" de la barra lateral y mostrar todos los chats

**Causa del chat que falta.** `web/src/components/shell.tsx` tiene `if (c.project_id) continue;` en `groupedConversations`. Los chats de proyecto (por ejemplo, los que crea el clonado desde GitHub) no aparecen en la lista. HipÃ³tesis probable, a confirmar con `GET /api/conversations` en el VM: el segundo chat es de un proyecto.

**QuÃ© hacer.**
1. `web/src/components/nav.tsx`: quitar el elemento `to: "/chat"` de `ITEMS`. Afecta a todas las variantes (sidebar, row, rail). La ruta `/chat` se queda, y `/` sigue redirigiendo ahÃ­.
2. `web/src/components/shell.tsx`: quitar el `continue` y su comentario. Los chats de proyecto entran en su grupo de fecha.
3. `web/src/components/conv-item.tsx`: si `conv.project_name` existe, mostrarlo como lÃ­nea secundaria pequeÃ±a (`--ink-2`, 12 px) debajo del tÃ­tulo. Sin duplicar clases: revisar `styles-shell.css` (`.sidebar-conv`, `.sidebar-conv-title`).
4. `DESIGN.md`, secciÃ³n "AppNav": quitar "Chat" de la lista de enlaces.

**VerificaciÃ³n.** Con dos chats (uno sin proyecto y uno de proyecto), ambos aparecen en la barra. Revisar 390 px (cajÃ³n) y 1440 px.

**Cambios.** `cambios.json` tipo `minimo`.

---

## Tarea 3. Groq, NVIDIA y Gemini: que sus modelos aparezcan y funcionen

**Lo que se sabe (verificado en cÃ³digo).** `server/src/models.ts` marca `recommended = free || grupo curado`. Groq y NVIDIA de pago no caen en ningÃºn grupo (`GROUPS`), asÃ­ que quedan fuera del selector de chat (`GET /api/models` sin `all=1`). Aunque la clave llegue a OpenCode, el usuario no ve los modelos. Esa es la causa mÃ¡s probable de "estÃ¡ implementado y no estÃ¡".

**Lo que NO se puede verificar desde aquÃ­.** OpenCode no estÃ¡ instalado en el entorno de trabajo. Las fuentes consultadas no coinciden:
- Un mirror de la documentaciÃ³n (`mintlify`) da `GEMINI_API_KEY`, pero corresponde a la versiÃ³n antigua en Go de opencode. La versiÃ³n actual usa el catÃ¡logo models.dev.
- Otra fuente lista NVIDIA con id de proveedor `nvidia` y clave por `/connect` (que guarda en `~/.local/share/opencode/auth.json`); no nombra variable.
- Un artÃ­culo de terceros da `NVIDIA_API_KEY`. No es documentaciÃ³n oficial.

**QuÃ© hacer.**
1. **Modelos visibles** (`server/src/models.ts`): en `parseModels`, si el proveedor del modelo (`id.split("/")[0]`) tiene clave activa, `recommended = true` y `group` = etiqueta del proveedor (`Groq`, `NVIDIA`, `Google (Gemini)`), salvo que coincida con un grupo curado. Obtener los proveedores activos con una funciÃ³n exportada de `claves-proveedor.ts` (usar `entornoProveedores()` o `tieneClaveProveedor`). `invalidarModelos()` ya se llama al cambiar claves.
2. **Variables de Gemini** (`server/src/claves-proveedor.ts`): cambiar `variable: string` por `variables: string[]`, con `GOOGLE_GENERATIVE_AI_API_KEY` primero y `GEMINI_API_KEY` despuÃ©s, y pasar **las dos** al entorno. AsÃ­ funciona con la versiÃ³n actual o con la antigua. Actualizar:
   - `entornoProveedores()`: asignar cada variable.
   - `server/src/routes/providers.ts`: `variable` = primera; `configured` y `enAgente` miran todas.
   - `server/tests/claves-proveedor.test.ts`: espera `GEMINI_API_KEY` en `PROVEEDORES_CON_CLAVE` (revisar los asserts que cambien).
   - `FASE2.md`: corregir la nota de Gemini.
3. **DiagnÃ³stico en Ajustes** (`web/src/pages/settings.tsx`): pasar a `TarjetaProveedor` el nÃºmero de modelos del proveedor (`models.data.models.filter(m => m.provider === p.id).length`; la lista ya se pide con `all=1`). Mostrar "N modelos disponibles". Si la clave estÃ¡ guardada, `enAgente` es true y el conteo es 0 con los modelos ya cargados, mostrar: "La clave estÃ¡ guardada, pero OpenCode no muestra modelos de este proveedor. Revisa el nombre de la variable en el servidor con `opencode models`." Esto deja claro al usuario, sin adivinar, si OpenCode reconoce la clave.
4. **Pruebas** (`server/tests/entorno-proveedores.test.ts`): el fake de `models` debe imprimir tambiÃ©n `groq/llama-prueba` y `nvidia/nemo-prueba` con coste mayor que cero. Afirmar: con clave guardada de Groq, `groq/...` tiene `recommended: true` y grupo `Groq`; sin clave, `recommended: false`. Actualizar la aserciÃ³n que hoy espera solo `opencode/big-pickle`.

**VerificaciÃ³n en el VM (lo hace el usuario o el agente con acceso).** Con `GROQ_API_KEY` guardada, `opencode models --verbose` debe listar `groq/...`. Para NVIDIA y Gemini, comprobar el nombre exacto de la variable y el id del proveedor. Si el conteo sigue en 0, el diagnÃ³stico de Ajustes lo indica.

**Honestidad con el usuario.** Decir que la lÃ³gica del selector queda arreglada, y que la confirmaciÃ³n de nombres de variable se hace en el VM.

**Cambios.** `cambios.json` tipo `minimo`.

---

## Tarea 4. Mejorar la vista de proyectos

**Estado actual.** `web/src/pages/proyectos.tsx`: tarjeta con nombre, ruta, estado de origen y tres botones de texto al pie (Renombrar, Quitar ancla, Eliminar) que se parten en dos lÃ­neas en 390 px. No muestra actividad.

**QuÃ© hacer.**
1. **Servidor** (`server/src/routes/projects.ts`, `GET /projects`): aÃ±adir por subconsulta `chats` (conversaciones del proyecto), `tareas` (tareas del proyecto) y `ultima_actividad` (mÃ¡ximo de `messages.created_at` de sus chats o `tasks.created_at`, con `COALESCE` para no obtener NULL). Convertir `''` a `null` en JS. Tipo `Project` en `web/src/api.ts`: campos opcionales nuevos.
2. **Tarjeta** (`proyectos.tsx`):
   - Cabecera: nombre (18 px, peso 600) y chip "Anclado" si aplica.
   - Ruta de carpeta en mono, truncada con elipsis (no partir en varias lÃ­neas).
   - LÃ­nea de metadatos en `--ink-2`: "N chats Â· N tareas Â· Ãºltima actividad hace X" (usar `web/src/lib/tiempo.ts` si ya formatea fechas; revisar antes de crear otro).
   - Estado de origen (clonado desde GitHub) como hoy.
   - Pie: el nombre (o un enlace "Abrir") lleva a `/proyectos/$id`. Renombrar, anclar y eliminar pasan a **botones de icono de 40 px** con `aria-label` y `title`, como en `conv-item.tsx`. Eliminar mantiene su confirmaciÃ³n.
   - ConfirmaciÃ³n y renombrado: mantener la lÃ³gica actual.
3. **Cabecera de pÃ¡gina**: tÃ­tulo, subtÃ­tulo con nÃºmero de proyectos y botÃ³n "Nuevo proyecto" (ya existe).
4. **Estilos**: reemplazar las clases `.proyecto-tarjeta*` de la pÃ¡gina por las nuevas. Tokens Ãºnicamente. Sin degradados ni sombras pesadas.

**VerificaciÃ³n.** Captura a 390 y 1440 px, claro y oscuro. Sin scroll horizontal a 390. Con 0 proyectos sigue el estado vacÃ­o. Con un proyecto anclado y uno clonado, revisar el orden (anclados primero, como hoy).

**Cambios.** `cambios.json` tipo `mediano`.

---

## Tarea 5. Cierre

1. `FASE2.md`: aÃ±adir secciÃ³n "E. Correcciones tras probar en el VM" con el estado de las tareas 1 a 4. Corregir la nota de Gemini.
2. `cambios.json`: una entrada por tarea (ya indicadas arriba).
3. Ejecutar todos los comandos de verificaciÃ³n. RevisiÃ³n visual 390 y 1440, claro y oscuro, sin errores de consola.
4. Preguntar al usuario si aprueba el commit y el push. Solo tras su aprobaciÃ³n, ejecutar git tÃº mismo (`git add` de archivos concretos, `git commit`, `git push`). El commit lleva los trailers `Co-Authored-By` y `Claude-Session` indicados en el sistema.

---

## Tarea 6. Estado, logs y gasto de Azure en Ajustes

**QuÃ© ya existe.** `server/src/routes/servidor.ts` (`GET /api/servidor`, cachÃ© de 30 s) da disco, herramientas y carpetas, sin rutas ni IPs. Ajustes lo muestra en "Estado del servidor" y "Almacenamiento" (`web/src/pages/servidor.tsx`). Faltan los logs, el estado del servicio y el gasto.

**Por quÃ© asÃ­.** Ver los errores sin entrar al VM por SSH, y ver el gasto real que da Azure, no una estimaciÃ³n de la app.

**QuÃ© hacer.**
1. **Estado del servicio.** AÃ±adir a `GET /api/servidor` el resultado de `systemctl show orquestador -p ActiveState,SubState,ActiveEnterTimestamp` con lista fija de argumentos, entorno mÃ­nimo (`entornoMinimo()`) y tiempo lÃ­mite, como ya hace `df`.
2. **Logs.** Nueva ruta `GET /api/servidor/logs?lineas=100` (mÃ¡ximo 300). Ejecuta `journalctl -u orquestador -n <N> --no-pager -o short-iso` con `Bun.spawn`, sin shell. La salida pasa por `redaccion.ts` antes de responder. Si el usuario del servidor no puede leer el diario, responde un error legible, no un 500. Requisito en el VM (lo hace el usuario): aÃ±adir `orquestador` al grupo `systemd-journal`. Documentarlo en `deploy/README.md`. No dar sudo.
3. **Gasto de Azure.** Nueva ruta `GET /api/servidor/coste`, con cachÃ© de 1 h. Consulta la API de Cost Management de Azure con la **identidad administrada** del VM, asÃ­ no hay claves en el repo ni en el archivo de entorno. Devuelve gasto del mes en curso, moneda y gasto diario de los Ãºltimos 30 dÃ­as. Si falta la identidad o el rol, responde `coste_no_disponible` con un texto que dice quÃ© permiso falta.
   - **DecisiÃ³n pendiente del usuario:** asignar al VM una identidad administrada con el rol de lector de costes sobre la suscripciÃ³n. Sin eso, la tarjeta muestra el aviso y no inventa cifras.
   - Comprobar en el VM el comando exacto de consulta (`az rest` contra Cost Management o `az consumption`). No verificado desde aquÃ­.
4. **PresentaciÃ³n** en Ajustes, sin tablas: tarjeta "Estado" (icono y texto; Ã¡mbar solo si el servicio no estÃ¡ activo), tarjeta "Gasto del mes" (cifra grande, moneda y fecha de corte), y bloque "Registros" (texto monoespaciado, Ãºltimas 100 lÃ­neas, botÃ³n "Actualizar" con icono). Tokens de `styles.css`.
5. **Pruebas** (`server/tests/servidor-logs.test.ts`): `journalctl` ausente da error legible; un token de prueba en la salida queda oculto; el lÃ­mite de lÃ­neas se respeta. Para el gasto, un `az` falso en el PATH (igual que el `opencode` falso).

**VerificaciÃ³n.** Captura de la pestaÃ±a a 390 y 1440 px, claro y oscuro, con datos y sin datos. Sin errores de consola.

**Cambios.** `mediano`.

---

## Tarea 7. Skills configurables desde la app (hecha)

**DecisiÃ³n del usuario.** Globales y por proyecto.

**CÃ³mo quedÃ³.**
- **Global:** `~/.config/opencode/skills/<nombre>/SKILL.md`. Se edita en Ajustes > Proveedores IA > Skills.
- **Por proyecto:** `<carpeta del proyecto>/.opencode/skills/<nombre>/SKILL.md`. Se edita en la pestaÃ±a del proyecto.
- **Nombre:** `^[a-z0-9]+(-[a-z0-9]+)*$`, hasta 64 caracteres. Es la misma regla que documenta OpenCode. La carpeta se llama igual que la skill.
- **Contenido:** cabecera con `name` igual a la carpeta y `description` de 1 a 1 024 caracteres. MÃ¡ximo 64 KB.
- **Secretos:** un texto con un secreto conocido (`TELO_CLAVE`, clave de proveedor o token con formato de credencial) se rechaza. No se guarda redactado, porque al editar pisarÃ­a el original.
- **Escritura:** archivo temporal con `O_EXCL` y `O_NOFOLLOW`, `fsync` y renombrado. NingÃºn tramo de la ruta puede ser un enlace. La lectura tambiÃ©n usa `O_NOFOLLOW`.
- **Borrar:** solo si la carpeta contiene Ãºnicamente `SKILL.md`. Si hay mÃ¡s archivos, responde 409 y no toca nada.
- **Aislamiento:** en bubblewrap, `~/.config/opencode/skills` se monta en **solo lectura**. El agente la lee y no la escribe: si pudiera escribirla, dejarÃ­a instrucciones para todos los agentes. La carpeta se crea al arrancar el servidor para que el montaje siempre exista.
- **CÃ³digo:** `server/src/skills.ts`, `server/src/routes/skills.ts`, `web/src/components/skills-editor.tsx`, `web/src/components/proyecto-skills.tsx`.

**Diferencia con el plan.** El plan preveÃ­a `TELO_SKILLS_DIR`. No se aÃ±adiÃ³: una variable asÃ­ podrÃ­a apuntar fuera de lo que el agente ve. La ruta global es fija.

**LÃ­mite conocido.** Las skills de proyecto son archivos sin confirmar en el repositorio (aparecen en `git status`). Un chat que trabaja en la carpeta del proyecto las usa. Una tarea de un repositorio Git trabaja en un clon del Ãºltimo commit y no las ve hasta que se confirmen. Llevarlas a esas tareas es una decisiÃ³n aparte.

**Verificado.** `server/tests/skills.test.ts` (14 pruebas): rutas, nombres, cabeceras, tamaÃ±o, secretos, enlaces en el archivo y en la carpeta, escritura que falla sin dejar temporales, borrado con archivos extra y proyecto inexistente. En navegador: crear, guardar, aparecer en la lista y escribir en `.opencode/skills` del proyecto, a 390 y 1440 px.

**No verificado en el VM.**
- Que OpenCode liste `~/.config/opencode/skills` y `.opencode/skills` (la documentaciÃ³n de OpenCode lo describe asÃ­; no hay OpenCode en este entorno).
- El montaje de solo lectura dentro de bubblewrap. AquÃ­ no hay `bwrap`.

**Cambios.** `cambios.json`: mediano (entrada aÃ±adida).

---

## Tarea 8. Memoria del proyecto editable desde la app

**QuÃ© ya existe.** La memoria del proyecto estÃ¡ en `projects.memoria` (migraciÃ³n 014). El agente la escribe al terminar tareas (`server/src/memoria.ts`, `guardarMemoria`, lÃ­mite `MAX_MEMORIA` de 4 000 caracteres). `DELETE /api/projects/:id/memoria` la borra. `web/src/components/proyecto-memoria.tsx` solo muestra el texto y el botÃ³n "Borrar memoria". **No se puede editar.**

**Supuesto.** "Memoria" = la memoria aprendida de cada proyecto. Si el usuario se referÃ­a a su memoria personal, es otra tarea. Confirmar antes de cerrarla.

**QuÃ© hacer.**
1. **Servidor:** `PUT /api/projects/:id/memoria` con `{ texto }`. LÃ­mite `MAX_MEMORIA`. El texto pasa por `redaccion.ts` antes de guardar. Reutilizar `guardarMemoria`; no duplicar.
2. **Web:** en `proyecto-memoria.tsx`, un Ã¡rea de texto con el contenido actual, la fecha de actualizaciÃ³n, "Guardar" (solo activo si cambiÃ³) y "Borrar memoria" como hoy.
3. **Pruebas:** un token de prueba no queda guardado en claro; mÃ¡s de `MAX_MEMORIA` caracteres se rechaza con mensaje claro; proyecto inexistente da 404.

**VerificaciÃ³n.** Captura a 390 y 1440 px, claro y oscuro, con memoria vacÃ­a y con texto.

**Cambios.** `mediano`.

---

## Tarea 9. Claves de proveedores y botÃ³n Â«InstalarÂ» para OpenCode (hecha)

**DecisiÃ³n del usuario.** SÃ­, instalar desde la app, con confirmaciÃ³n.

**CÃ³mo quedÃ³.**
- En la tarjeta de OpenCode aparece "Instalar OpenCode" solo si el CLI no se encuentra. El primer paso muestra el comando; el segundo es "SÃ­, instalar".
- **Comando fijo:** `npm install -g --prefix ~/.opencode opencode-ai`. La API recibe solo el identificador `opencode`; el servidor exige `confirmar: true` en el cuerpo.
- Sin shell. Entorno mÃ­nimo (PATH, HOME, LC_ALL): ninguna variable `TELO_*` ni clave llega a npm. Tiempo mÃ¡ximo de 10 minutos, con terminaciÃ³n del grupo.
- La salida pasa por `redaccion.ts`. Los motivos son legibles: npm no disponible, fallo de npm, tiempo agotado, CLI no visible tras instalar.
- **Por quÃ© npm y no `curl â€¦ | bash`.** La documentaciÃ³n de OpenCode recomienda el script, pero ejecutar un script remoto no es un comando fijo. npm instala un paquete versionado. Con `--prefix ~/.opencode` el ejecutable queda en una carpeta que el agente ya ve en solo lectura, asÃ­ que no hace falta tocar `TELO_LECTURA_EXTRA`.
- Tras instalar, el servidor aÃ±ade `~/.opencode/bin` a su PATH sin reiniciar. Al arrancar hace lo mismo (`asegurarRutaInstalada`).
- **CÃ³digo:** `server/src/instalacion.ts`, `server/src/routes/herramientas.ts`, `web/src/components/instalar-herramienta.tsx`.

**CorrecciÃ³n hecha durante la verificaciÃ³n.** `Bun.which` usa el PATH con el que arrancÃ³ el proceso, no el actual. Tras instalar, el CLI no se veÃ­a. Ahora `server/src/ejecutable.ts` (`hallarEjecutable`, `lanzarEnGrupo`, `matarGrupo`) pasa el PATH vivo, y lo usan todos los sitios que buscan programas.

**Verificado.** `server/tests/instalacion.test.ts` (7 pruebas): lista fija, confirmaciÃ³n obligatoria, npm ausente, salida redactada, PATH actualizado, sin reinstalar. En navegador: comando visible antes de confirmar, instalaciÃ³n, botÃ³n que desaparece y "Activo", a 390 y 1440 px.

**Pendiente en el VM.**
- Que `npm` estÃ© en el PATH del servicio. Si no estÃ¡, el botÃ³n lo dice. El PATH del servicio viene de su unidad systemd.
- `opencode models` debe listar los modelos de la clave de Groq guardada (tarea 3).
- Confirmar el id `google` y el nombre de la variable de NVIDIA.

**Cambios.** `cambios.json`: mediano (entrada aÃ±adida).

---

## Tarea 10. Conectar Codex, Gemini y Claude gratis (parcial)

**Decisiones.**
- **(a) Codex:** aprobado el login de dispositivo, ejecutado en el VM.
- **(b) Claude gratis:** investigado en octubre de 2026. **DecisiÃ³n del usuario: no aÃ±adir Claude por ahora.** Solo tiene el plan gratis; la Ãºnica vÃ­a compatible (clave de API) es de pago. No se implementa ningÃºn acceso con cuenta de Claude.
- **Gemini:** se usa la clave de AI Studio (tarea 3). Telo no ofrece inicio OAuth con una cuenta Google, porque esa autorizaciÃ³n no sirve para OpenCode ni se usa para obtener mÃ©tricas.

**QuÃ© dice la documentaciÃ³n oficial (Claude Code, Â«Legal and complianceÂ»).**
- El OAuth de cuenta de consumo estÃ¡ pensado Â«exclusivamenteÂ» para quien compra Free, Pro, Max, Team o Enterprise y para las aplicaciones nativas de Anthropic.
- Los desarrolladores que construyen productos deben usar **clave de API** (Claude Console) o un proveedor de nube. Anthropic **no permite** a terceros Â«enrutar solicitudes con credenciales de los planes Free, Pro o Max en nombre de sus usuariosÂ», ni Â«recoger, almacenar o intermediar credenciales o tokens de sesiÃ³n de Claude.aiÂ».
- SÃ­ estÃ¡ permitido que una persona inicie sesiÃ³n con su propia suscripciÃ³n en el **binario oficial de Claude Code, sin modificar**.

**QuÃ© significa para Telo.**
- Telo no usa Claude Code para los agentes: usa OpenCode. Usar el OAuth de una cuenta de consumo desde OpenCode, o guardar o reenviar un token de Claude, cae en lo que la documentaciÃ³n prohÃ­be. **Descartado.**
- Copiar tokens de claude.ai o de la app de escritorio: **descartado** (mismo motivo).
- Un runner nuevo que ejecute el binario oficial de Claude Code con la sesiÃ³n de la persona serÃ­a la Ãºnica vÃ­a con cuenta de consumo. TendrÃ­a que confirmarse que el plan gratis incluye Claude Code, y eso no se ha podido comprobar: la pÃ¡gina de soporte de Anthropic no se pudo leer y las fuentes secundarias no coinciden. **No se recomienda con plan gratis.**
- **Ruta compatible:** clave de API de Claude Console, con el mismo flujo de tarjeta que Groq y NVIDIA. Es de pago por uso. Hay que confirmar el nombre de la variable que lee OpenCode (`ANTHROPIC_API_KEY`) con `opencode models`.

**QuÃ© hacer (solo si el usuario tiene plan de pago y lo pide).**
1. `server/src/claves-proveedor.ts`: aÃ±adir Anthropic con `ANTHROPIC_API_KEY`, igual que Groq.
2. `server/src/routes/providers.ts`: tarjeta guardable.
3. Pruebas: `claves-proveedor.test.ts` y `entorno-proveedores.test.ts`, con el modelo `anthropic/...` en el CLI falso.

**CÃ³mo quedÃ³ (Codex).**
- `server/src/login-cli.ts` lanza `codex login --device-auth` en su propio grupo de procesos, con entorno mÃ­nimo. Lee la salida mientras el CLI espera y extrae la URL y el cÃ³digo.
- Rutas: `GET`, `POST` y `DELETE /api/providers/codex/login`. Una sesiÃ³n a la vez (409 si ya hay una). Tiempo mÃ¡ximo de 15 minutos. Cancelar termina el grupo.
- **El token no se lee ni se muestra.** La salida se redacta. El Ã©xito se decide por salida 0 y porque exista el archivo de sesiÃ³n; ese archivo solo se comprueba, nunca se abre.
- `~/.codex` estÃ¡ en `HERRAMIENTAS` de `server/src/runners/aislamiento.ts` y se monta en solo lectura.
- En la tarjeta de Codex: Â«Iniciar sesiÃ³nÂ» â†’ enlace y cÃ³digo â†’ Â«SesiÃ³n iniciada en el servidorÂ». Â«Ya lo hiceÂ» comprueba el estado y mantiene el enlace mientras el CLI espera.
- Codex **no** es todavÃ­a proveedor de los agentes. La tarjeta lo dice.

**Verificado.** `server/tests/login-codex.test.ts` (4 pruebas) con un CLI falso que imprime un token de prueba: el token no aparece en ninguna respuesta, cancelar no deja procesos y sin CLI responde `codex_no_instalado`. En navegador: enlace, cÃ³digo, Â«Ya lo hiceÂ» y sesiÃ³n iniciada, a 390 y 1440 px.

**No verificado (importante).**
- La documentaciÃ³n oficial de Codex (`developers.openai.com/codex/auth`) no se pudo leer en esta sesiÃ³n. El comando `codex login --device-auth` y la ruta `~/.codex/auth.json` vienen de fuentes de terceros. Antes de darlo por bueno en el VM: `codex login --help` y comprobar quÃ© archivo crea.
- **TÃ©rminos de OpenAI:** no revisados. Antes de usar la sesiÃ³n de ChatGPT para agentes (con un runner de Codex), hay que comprobar que el caso estÃ¡ permitido.
- No se sabe si el CLI de Codex estÃ¡ instalado en el VM. Si no lo estÃ¡, la app lo dice.

**Cambios.** `cambios.json`: grande (entrada aÃ±adida, segÃºn el plan).

---

## Tarea 11. Acciones git desde los chats (parcial)

**Objetivo.** Que un chat con proyecto pueda crear commits, subir una rama y abrir PR sin que el usuario copie comandos. Ninguna acciÃ³n se ejecuta sin aprobaciÃ³n explÃ­cita en Telo. El agente nunca recibe la clave SSH ni los tokens de GitHub.

**Estado.** En el cÃ³digo, las acciones llegan por la API `/projects/:id/acciones` (`routes/repository-actions.ts`), que el chat llama directamente cuando el usuario pide git (`routes/chat.ts`). Cada acciÃ³n queda aprobada en `repository_actions`. No existe todavÃ­a la carpeta `.telo/solicitudes` ni la skill `telo-git` de abajo: esas secciones describen el diseÃ±o original. **Pendiente:** que el usuario cree `GITHUB_PR_TOKEN` en los secretos del proyecto, y comprobar con un push directo a `main` que GitHub lo rechaza.

**Decisiones (confirmadas por el usuario).**
- Permiso por defecto de un chat: **sin git**. Quien quiera git lo activa en la configuraciÃ³n del chat. Los niveles intermedios quedan por definir.
- Ramas: solo `telo/<id>`. Nunca `main`, nunca force push, nunca borrar ramas y nunca merge. El merge lo hace el usuario.
- **Subir** (push) sigue con la deploy key y con aprobaciÃ³n previa. Un PR necesita que la rama exista en GitHub, asÃ­ que "solo PR" no quita el push: es el paso anterior.
- **PR**: el token de la API tiene solo el permiso *Pull requests: Read and write* (*Metadata: Read* se aÃ±ade solo), un solo repo y vencimiento de 90 dÃ­as. Se guarda como secreto `GITHUB_PR_TOKEN`, separado de `GITHUB_TOKEN`, que hoy es el respaldo del push por HTTPS. Si la API responde 403 al crear el PR, se aÃ±ade *Contents: Read* y se documenta. En el cÃ³digo, el PR usa solo `GITHUB_PR_TOKEN`: sin respaldo a `GITHUB_TOKEN` ni a la cuenta general de GitHub. Ese nombre no entra al entorno del agente.
- **FusiÃ³n local y push a `main` quitados** (decidido el 15 de octubre, para respetar la protecciÃ³n de `main`): `merge` y `push_main` ya no se crean ni se ejecutan. Una acciÃ³n antigua pendiente de esos tipos falla con un aviso y nunca cae en el camino del PR.
- **ProtecciÃ³n de `main`** en GitHub: hecha por el usuario (*Require a pull request* con 0 aprobaciones, *Do not allow bypassing*, sin force push ni borrado). **Pendiente:** comprobar con un `git push` directo a `main` que GitHub lo rechaza.

**CÃ³mo debe funcionar.**
1. El chat trabaja en un clon propio, como las tareas (`workspace.ts`). Hoy un chat con proyecto trabaja en la carpeta del proyecto, asÃ­ que esto hay que cambiarlo antes.
2. El agente pide una acciÃ³n escribiendo `.telo/solicitudes/*.json` en su clon. El servidor lee la solicitud al terminar cada turno y valida todo contra su propio estado. La carpeta `.telo` no entra en los commits.
3. Tarjetas en el chat, una por acciÃ³n: **Commit** (diff resumido, mensaje y rama), **Subir** (rama `telo/<id>`) y **Abrir PR** (tÃ­tulo y cuerpo redactados por el agente y editables por el usuario). Cada una con Aprobar y Rechazar.
4. Cada aprobaciÃ³n queda ligada a lo que se aprobÃ³: hash del diff en el commit, SHA del commit en el push y hash de tÃ­tulo y cuerpo en el PR. Si algo cambia, la aprobaciÃ³n caduca. Se reutilizan `task_approvals` y la interfaz de `tarea-plan.tsx`.
5. El resultado (SHA, rama o URL del PR) se escribe en el chat y se pasa al agente en el siguiente turno.

**QuÃ© debe saber cada chat.** Una skill global `telo-git` (sistema de skills de la tarea 7): cÃ³mo pedir una acciÃ³n, que solo puede pedir, las reglas de rama y de mensaje, y que nunca use `git push` ni `gh`. Las instrucciones del proyecto aÃ±aden la convenciÃ³n de commits y la plantilla de PR. El chat no recibe claves, tokens ni URLs con credenciales.

**Lo que ya existe y se reutiliza.**
- `git.ts` desactiva los hooks del repo (`core.hooksPath=/dev/null`) y quita filtros, credenciales y `url.*` en los comandos del servidor.
- `subirAprobado` (`workspace.ts`) empuja solo `HEAD:refs/heads/telo/<id>`, sin force, y exige un commit aprobado con el hash coincidente.
- El escaneo de secretos y de archivos sensibles se aplica antes de cada commit.

**ImplementaciÃ³n pendiente, en orden (diseÃ±o original; ver Estado).**
1. Clon propio para chats con proyecto (extender `workspace.ts`) y una migraciÃ³n nueva para el permiso por chat (la siguiente numerada).
2. Permiso por chat en la configuraciÃ³n del chat, por `PATCH /api/conversations/:id`. Sin git por defecto.
3. Lectura de `.telo/solicitudes/*.json` al terminar cada turno, con validaciÃ³n en el servidor.
4. Tarjetas Commit y Subir, con la aprobaciÃ³n generalizada a chats.
5. AcciÃ³n Abrir PR con `GITHUB_PR_TOKEN`. Esto tambiÃ©n resuelve la aprobaciÃ³n `pr`: hoy `plan.ts` y `tarea-plan.tsx` la muestran, pero `routes/tasks.ts` la rechaza con `invalid_accion`. Si se retrasa, hay que decidir si se quita.
6. Skill `telo-git` y texto en las instrucciones del proyecto.
7. Pruebas: sin git se rechaza la solicitud; las ramas fuera de `telo/*` se rechazan; `main` nunca; una aprobaciÃ³n caduca si cambia el diff, el SHA o el tÃ­tulo; PR con API falsa; el token no aparece en ninguna respuesta ni en la salida del agente.
8. VerificaciÃ³n: navegador a 390 y 1440 px, y una prueba real en un repo de prueba (commit, push a `telo/` y PR), con el push directo a `main` rechazado.

**Riesgos.**
- Instrucciones maliciosas en el cÃ³digo o en un issue: la aprobaciÃ³n es sobre el diff real, no sobre lo que diga el agente.
- El agente no debe recibir `gh`, `git push` directo ni credenciales, porque necesitarÃ­a secretos dentro del aislamiento.
- Un token mal acotado: por eso el de PR tiene permiso mÃ­nimo y su propio nombre de secreto.

**Cambios.** `cambios.json`: grande, al implementarse.

---

## DiagnÃ³stico del 143 (Â«opencode saliÃ³ con cÃ³digo 143Â»)

**Causa.** `routes/chat.ts` limita cada turno del chat a 3 minutos (`TIEMPO_TURNO_MS`). Al llegar, `runners/opencode.ts` manda SIGTERM al grupo del agente, que sale con cÃ³digo 143 (128 + 15). `ejecutar.ts` lo trata como tiempo agotado, pero el chat mostraba el cÃ³digo tal cual.

**Lo que se corrigiÃ³.** El chat dice: Â«El agente tardÃ³ mÃ¡s de 3 minutos y se detuvo. Divide la tarea en partes mÃ¡s pequeÃ±as.Â» No se probÃ³ con un agente real de 3 minutos; el cambio comprueba el tiempo transcurrido, y la lÃ³gica es corta.

**Causa secundaria (tambiÃ©n corregida).** `/tmp` era de solo lectura dentro del sandbox de bubblewrap, asÃ­ que OpenCode fallaba al escribir su `TMPDIR` (`/tmp/opencode`). El agente lo reportÃ³ como Â«Read-only file systemÂ». Se aÃ±adiÃ³ `--tmpfs /tmp` en `runners/aislamiento.ts`. Verificado en esta mÃ¡quina con bwrap real: sin el montaje falla con Â«Read-only file systemÂ»; con el montaje escribe, y el host no ve el archivo.

**Pendiente.** Decidir si el lÃ­mite de 3 minutos se queda o se sube. Ver Tarea 12, donde la cola de mensajes depende de esa decisiÃ³n.

---

## Tarea 12. Cola de mensajes del chat (pendiente)

**Hoy.** Si el chat estÃ¡ respondiendo, `POST /api/conversations/:id/messages` responde 409 `conversation_busy` (`motivoDeBloqueo` en `routes/chat.ts`). No hay cola.

**Lo que pidiÃ³ el usuario.** Si envÃ­a mÃ¡s mensajes mientras el agente trabaja, se ejecutan en el orden en que se enviaron.

**DiseÃ±o propuesto.**
1. Guardar el mensaje como pendiente en la conversaciÃ³n. Sigue habiendo un turno a la vez por chat (`ocuparConversacion`).
2. Al terminar un turno, arrancar el siguiente pendiente, en orden de llegada.
3. En el chat: Â«En cola (N)Â» y la opciÃ³n de quitar un mensaje pendiente antes de que arranque.
4. Si el servidor se reinicia con mensajes en cola, avisar como hoy (`avisarTurnosInterrumpidos`) y no ejecutarlos solos.
5. DecisiÃ³n del usuario: el lÃ­mite de 3 minutos por turno se queda o sube.

**Pruebas.** Dos mensajes seguidos: el segundo espera y se ejecuta despuÃ©s. Quitar un pendiente antes de que arranque. Reinicio con cola: no se ejecuta solo.

**Cambio de tipo:** mediano.

---

## Tarea 13. Wrangler (Cloudflare) desde Ajustes (pendiente)

**QuÃ© se verificÃ³.**
- El paquete `wrangler` existe en npm (versiÃ³n 4.151.0 en la revisiÃ³n).
- `wrangler login --device` existe en esa versiÃ³n. No usa servidor de callback: muestra un enlace y un cÃ³digo, igual que el login de Codex. Lo dice la ayuda del CLI (Â«Ãºtil en contenedores o sesiones SSH remotasÂ») y la documentaciÃ³n de Cloudflare.
- El login normal (`wrangler login`) redirige el navegador a `localhost:8976` de la PC del usuario. Si Wrangler corre en el servidor, ese callback nunca llega y el login se queda colgado. Por eso no se usa.

**DiseÃ±o propuesto.**
1. Instalar con el mismo mecanismo que Codex: una entrada nueva en `ACCIONES` (`instalacion.ts`), con el paquete `wrangler` y el binario `wrangler`.
2. Iniciar sesiÃ³n con `wrangler login --device` lanzado en el servidor, igual que `login-cli.ts`. Ajustes muestra el enlace y el cÃ³digo.
3. Alternativa sin login: un token de API en `CLOUDFLARE_API_TOKEN`, guardado como secreto. Wrangler lo lee antes que cualquier login guardado.
4. Las credenciales de Wrangler quedan en el HOME del servidor, que el agente no ve (aislamiento).

**Decisiones pendientes del usuario.**
- Â¿DÃ³nde vive la tarjeta? Â¿Una tarjeta de Cloudflare entre los proveedores, o una secciÃ³n de herramientas en Ajustes?
- Â¿Inicio de sesiÃ³n con cÃ³digo (recomendado, no guarda nada tuyo fuera de Cloudflare) o token de API?

**Cambio de tipo:** grande (integraciÃ³n nueva con credenciales).

---

## Riesgos conocidos

- Las skills globales las edita la app. Hasta confirmar en el VM que OpenCode las lee, no se sabe si el efecto llega a los agentes.
- El montaje de solo lectura de `~/.config/opencode/skills` dentro de bubblewrap no se probÃ³ con `bwrap` (no estÃ¡ en este entorno).
- Las skills de proyecto aparecen como archivos sin confirmar en el repositorio.

- Las claves guardadas llegan a **todos** los agentes, no solo al de su proveedor (`ejecutar.ts` inyecta todas). Mejora posible: pasar solo las claves del proveedor del modelo elegido.
- El chat ya no guarda el mensaje de usuario y la respuesta en la misma transacciÃ³n que la peticiÃ³n. Si el servidor se cae a mitad de un turno, el aviso de reinicio lo cubre, pero el agente no se reanuda.

