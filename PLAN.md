# PLAN.md: hoja de ruta de Orquestador

Estado al 9 de octubre de 2026. Una fase no se marca como hecha hasta cumplir sus criterios de aceptación.

## Visión

Lanzar tareas de IA desde el teléfono o la PC y dejarlas corriendo en un VM de forma continua. El sistema pide aprobación antes de tocar repositorios y avisa cuando una tarea falla, necesita aprobación o termina. Todos los proveedores (OpenCode, Google/agy, Codex) se gestionan desde una sola interfaz, con su cuota, costo y rendimiento.

## Fases

### 0. Base: hecho
- Servidor Hono, SQLite con migraciones e interfaz Vite/React en el VM, como servicio systemd.
- Chat con OpenCode: sesiones con contexto, y tokens y costo por mensaje.
- **Criterio:** el servicio sigue corriendo al cerrar la sesión SSH o apagar la PC.

### 1. Chat moderno: hecho
- Selector de modelo con medidor de costo, esfuerzo por modelo y barra lateral.
- **Criterio:** funciona a 390 px y 1440 px, sin scroll horizontal.

### 2. Tareas en segundo plano: hecho (PR #4)
- Cola de una tarea a la vez. Cancelar mata el árbol de procesos. Al arrancar, las tareas que quedaron en ejecución se marcan como fallidas.
- **Criterio:** cancelar una tarea con un proceso hijo (`sleep`) termina en pocos segundos, sin quedar colgada.

### 3. App instalable, analíticas y ajustes: mergeada (PR #5)
- PWA instalable. Analíticas: KPI, costo por día y por modelo, presupuesto del mes. Ajustes: modelo, esfuerzo, presupuesto y aviso.
- **Pendiente de validar en el VM:** que la migración `004_settings` esté aplicada y que `GET /api/preferences` responda 200.
- **Criterio:** la app se instala desde HTTPS en el teléfono.

### 4. Rediseño visual: en curso
- Sistema de diseño en `DESIGN.md`. Pantallas generadas en Stitch con `docs/design/STITCH_PROMPT.md`. `impeccable` como guía de revisión.
- **Criterio:** las cinco pantallas revisadas a 390 px y 1440 px. Contraste AA. Solo tokens de color. Sin cambios de comportamiento.

### 5. Analizador y obrero por tarea: implementada (`feat/analizador-obrero`, sin PR)
- Migración `019_analizador_obrero`: la tabla `tasks` se reconstruye con los estados `analyzing` y `waiting_approval`, y las columnas `plan`, `reporte` y `plan_aprobado_en`. Es la única migración que se aplica con claves foráneas apagadas (`sinClaves`); el runner comprueba la integridad antes de confirmar. El historial (`task_events`) y las aprobaciones (`task_approvals`) se conservan.
- El analizador produce un plan en JSON (`server/src/plan.ts`). Si el plan pide commit, push o PR, o trae preguntas, la tarea espera en `waiting_approval`. Si no, pasa directo al obrero.
- El obrero ejecuta solo el plan aprobado, en la misma sesión y carpeta que el analizador, y guarda un reporte en JSON. Si se desvía, la tarea vuelve al analizador con el motivo; el plan se replanifica hasta `MAX_PLANES` (3 versiones) y después la tarea falla.
- Rutas: `POST /api/tasks/:id/aprobar-plan` (acepta notas para el obrero) y `POST /api/tasks/:id/rechazar-plan`.
- Pruebas: `server/tests/plan.test.ts` (funciones puras) y `server/tests/analizador.test.ts`, que corre el flujo completo con un `opencode` falso (`server/tests/fixtures/bin/opencode`).
- Pendiente: probar con OpenCode real en el VM. Los criterios de aceptación se cumplen con el falso; con un modelo real, el JSON del analizador y el reporte del obrero pueden necesitar ajuste de los prompts.

### 6. Proyectos de GitHub
- Estado (`feat/revision-agentes`): cada tarea de un proyecto Git trabaja en su clon (`telo/<id8>`). Aprobación de commit y push ligada al hash del diff; escaneo de secretos antes del commit; push solo a `github.com` por HTTPS con `GITHUB_TOKEN` como secreto del proyecto. Pendiente: probar un push real a GitHub y un agente real en el VM.
- Token de acceso personal fine-grained, cifrado con AES-256-GCM. La clave maestra vive en el archivo de entorno del servicio, fuera del repo.
- Clonar repos en el VM. Cada tarea corre en el workspace de su proyecto.
- Antes de commit, push o PR, mostrar el diff en la app y pedir aprobación.
- **Criterio:** el token nunca aparece en logs ni en respuestas de la API. No hay push sin aprobación registrada.

### 7. Login de proveedores desde la app
- Estado: pendiente. Hoy la app muestra si cada clave existe y si llega a los agentes (sin valores). Google y Codex necesitan un flujo de inicio de sesión que requiere crear credenciales OAuth en la cuenta de Google y decisión del usuario.
- Flujo guiado: la app inicia el login del CLI en el VM (OpenCode, Google, Codex), muestra el enlace y el código, y espera la confirmación. Estado por proveedor.
- Incluye Google aunque la cuenta gratuita no sirva para el servidor.
- Estado de Google (`feat/revision-agentes`, sin merge): preparado con OAuth web y PKCE en lugar del login del CLI de la línea anterior. La app guarda la conexión (token de actualización cifrado) y puede desconectarla con revocación. Solo pide `openid email`. Pendiente de probar con las credenciales de Pablo; el permiso y la API de cuota se confirman en ese paso.
- **Criterio:** al terminar el flujo, el proveedor aparece como conectado. Ninguna clave se pega en la interfaz.
- **Antes de implementar:** investigar los comandos de login de cada CLI en el VM.

### 8. Notificaciones
- Estado: pendiente. Telegram y Discord quedan fuera por decisión del usuario.
- Web Push (u otro canal) al fallar, al necesitar aprobación y al terminar una tarea.
- **Criterio:** cada evento notifica una vez. Reabrir la app no repite las notificaciones.

### 9. Acceso seguro (Tailscale)
- Estado: el servidor escucha en `127.0.0.1` por defecto (`TELO_ESCUCHAR`). Pendiente en el VM: probar desde el teléfono, confirmar que `tailscale serve` sigue activo tras reiniciar y desactivar la expiración de la clave.
- Telo corre en el VM y solo es accesible desde los dispositivos de la red privada de Tailscale, con HTTPS por `tailscale serve`.
- El login de Telo (`TELO_CLAVE`) sigue activo como segunda capa: Tailscale decide quién llega al servidor; Telo decide quién puede operarlo.
- Verificado desde la PC: la cookie sale con `Secure`, `HttpOnly` y `SameSite=Strict` a través de `serve`.
- Pendiente: probar desde el teléfono; desactivar la expiración de la clave del VM; comprobar que `serve` sigue activo tras reiniciar.
- **Criterio:** PC y teléfono abren la app desde cualquier red. Sin Tailscale, la URL no resuelve. El puerto 3000 no está abierto en el NSG.
- Por ahora no se usa Funnel (acceso público): exigiría endurecer la app antes de publicarla.

### 10. Cuota y saldo de proveedores
- Estado: `GET /api/uso` y el botón «Uso» junto al modelo muestran el gasto y los tokens de las últimas 5 horas y de los últimos 7 días medidos por Telo. Los límites del proveedor no se leen de su API; se muestran como «medido por Telo».
- Primera versión en `feat/chats-gestion` (migración `008`): el usuario anota el saldo de cada cuenta o clave y Telo resta el uso que registró después. Es estimado. Ningún proveedor se consulta en vivo.
- Panel con saldo o cuota restante por cuenta o API (OpenCode, OpenRouter, Groq, NVIDIA, Google, Codex) y tiempo restante estimado.
- Decisión del usuario: consultar saldo o cuota antes que poner un tope de gasto por tarea.
- **Criterio:** cada proveedor muestra la fecha de su última consulta. Si no hay API de saldo, se marca como manual.

### 11. Proyectos: memoria, skills y AGENTS.md
- Estado: instrucciones por proyecto (se añaden al prompt de sus agentes) y sección única de Proyectos con archivos de solo lectura. Pendiente: skills `SKILL.md` y memoria que el sistema actualiza.
- Cada proyecto tiene su configuración: skills en formato `SKILL.md`, memoria que el sistema actualiza sola y su propio `AGENTS.md`.
- **Criterio:** una tarea del proyecto X usa sus skills y su memoria. Cambiar de proyecto no mezcla contexto.

### 12. Runners por proyecto
- Estado: pendiente. Sigue sin empezar, como estaba previsto (después de las fases 5, 6 y 11).
- Agy y Codex en contenedores por proyecto, con la misma interfaz de runner. Agy debe poder editar y subir archivos como lo hace Antigravity. La integración de Codex queda lista aunque no se use.
- Se empieza solo cuando las fases 5, 6 y 11 estén cerradas.

### 13. Panel del VM
- Estado: la vista `/servidor` muestra estado del proceso, carpetas y tamaños, herramientas instaladas, costos, uso y latencia medida en el navegador. Pendiente: terminal web (no se decide aún si reemplaza a Cockpit).
- Configuraciones del servidor desde la app y terminal web integrada. Evaluar si reemplaza a Cockpit (puerto 9090) o solo lo enlaza.

## Decisiones tomadas

- Stack: TypeScript, Bun, SQLite, PWA. Sin Next.js.
- Acceso: Tailscale. Cloudflare se descartó (Workers VPC no está disponible en la cuenta) y el Quick Tunnel no sirve como acceso fijo.
- Una tarea a la vez; las demás se encolan.
- Aprobación del usuario antes de commit, push o PR. La aprobación la aplica el backend, no una instrucción al agente.
- Sin tope de gasto por tarea; se consulta saldo o cuota.
- Uso personal, con un solo usuario.
- El agente nunca recibe variables `TELO_*` (la clave de acceso).
- Una tarea que estaba corriendo al reiniciar el servidor queda `interrupted`, no `failed`.
- El agente corre dentro de bubblewrap, que solo le deja ver su carpeta de trabajo. Sin bubblewrap no se ejecuta (falla cerrado).
- Mensajes y tareas: el mensaje del usuario se guarda antes de correr el agente, y un chat ocupado no acepta otro envío. Así los demás dispositivos lo ven.
- Reanudar continúa la sesión del agente en la misma carpeta. Reintentar crea una tarea nueva con el mismo prompt.
- Respaldos: copia diaria en el VM con `VACUUM INTO` y copia a la PC por Tailscale. Los respaldos no se guardan en el repo.
- Git: cada tarea de un proyecto trabaja en su clon. Ningún comando del servidor usa un repo que el agente pudo escribir sin quitarle antes la configuración peligrosa (`gitSeguro`).
- Aprobaciones: commit y push se aprueban contra el hash del diff revisado. Si el diff cambia, la aprobación se rechaza.
- Secretos por proyecto cifrados con AES-256-GCM. Sus valores no salen por la API, y el agente de ese proyecto los recibe como variables.
- El servidor escucha en `127.0.0.1`. Tailscale Serve entrega el tráfico desde el mismo equipo.

## Orden de trabajo

Según la revisión del 10 de octubre, el núcleo es el motor de tareas, el aislamiento del runner, la aprobación y la recuperación. Antes de ampliar proveedores o interfaz:

1. Seguridad del runner: entorno sin secretos, cancelación por grupo de procesos. (`fix/runner-seguridad`)
2. Estados formales y recuperación: `interrupted`, reanudar, reintentar o cancelar. (`006` aplicada. Reanudar y reintentar, en `feat/chats-gestion`, pendiente de revisión.)
3. Registro de eventos por tarea, para depurar, auditar y alimentar notificaciones. (`009`, en `feat/chats-gestion`.)
4. Fase 5 (analizador y obrero) y fase 6 (Git con aprobación en el backend).
5. Respaldos de la base y del workspace fuera del VM. (`server/scripts/respaldo.ts`, timer en `deploy/` y copia a la PC. Probado en local; falta probar el timer en el VM.)
6. Fase 9 (acceso por Tailscale) y pendientes de la sección de acceso.
7. Fases 10, 8 y 13: cuota con niveles de precisión, notificaciones por eventos y panel del VM sin terminal web.
8. Fase 4 (rediseño visual) y proveedores adicionales.

## Preguntas abiertas

- ¿El panel del VM dentro de la app reemplaza a Cockpit o solo lo enlaza?
- ¿Qué proveedores tienen API de saldo y cuáles se consultan a mano?
- ¿La memoria del agente se actualiza sola o solo con aprobación? La revisión recomienda separar observaciones de memoria aprobada.
