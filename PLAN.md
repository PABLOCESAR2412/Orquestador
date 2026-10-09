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

### 5. Analizador y obrero por tarea: diseño listo (`AGENTS.md`)
- Separar planificación y ejecución. Migración `005`: nuevos estados de tarea, columnas o tabla para el plan y el resultado, y estado de aprobación.
- **Criterio:** el analizador produce un JSON válido. El obrero ejecuta solo el plan aprobado. El reporte queda guardado. "Continuar" reanuda la misma sesión y el mismo workspace.

### 6. Proyectos de GitHub
- Token de acceso personal fine-grained, cifrado con AES-256-GCM. La clave maestra vive en el archivo de entorno del servicio, fuera del repo.
- Clonar repos en el VM. Cada tarea corre en el workspace de su proyecto.
- Antes de commit, push o PR, mostrar el diff en la app y pedir aprobación.
- **Criterio:** el token nunca aparece en logs ni en respuestas de la API. No hay push sin aprobación registrada.

### 7. Login de proveedores desde la app
- Flujo guiado: la app inicia el login del CLI en el VM (OpenCode, Google, Codex), muestra el enlace y el código, y espera la confirmación. Estado por proveedor.
- Incluye Google aunque la cuenta gratuita no sirva para el servidor.
- **Criterio:** al terminar el flujo, el proveedor aparece como conectado. Ninguna clave se pega en la interfaz.
- **Antes de implementar:** investigar los comandos de login de cada CLI en el VM.

### 8. Notificaciones
- Web Push (u otro canal) al fallar, al necesitar aprobación y al terminar una tarea.
- **Criterio:** cada evento notifica una vez. Reabrir la app no repite las notificaciones.

### 9. Acceso seguro
- Cloudflare Tunnel para publicar la app con HTTPS, sin abrir puertos en Azure.
- Cloudflare Access para exigir login antes de llegar a la app.
- **Criterio:** la URL pública pide login. La PWA se instala desde el teléfono. El puerto 3000 no está abierto en el NSG.

### 10. Cuota y saldo de proveedores
- Panel con saldo o cuota restante por cuenta o API (OpenCode, OpenRouter, Groq, NVIDIA, Google, Codex) y tiempo restante estimado.
- Decisión del usuario: consultar saldo o cuota antes que poner un tope de gasto por tarea.
- **Criterio:** cada proveedor muestra la fecha de su última consulta. Si no hay API de saldo, se marca como manual.

### 11. Proyectos: memoria, skills y AGENTS.md
- Cada proyecto tiene su configuración: skills en formato `SKILL.md`, memoria que el sistema actualiza sola y su propio `AGENTS.md`.
- **Criterio:** una tarea del proyecto X usa sus skills y su memoria. Cambiar de proyecto no mezcla contexto.

### 12. Runners por proyecto
- Agy y Codex en contenedores por proyecto, con la misma interfaz de runner. Agy debe poder editar y subir archivos como lo hace Antigravity. La integración de Codex queda lista aunque no se use.
- Se empieza solo cuando las fases 5, 6 y 11 estén cerradas.

### 13. Panel del VM
- Configuraciones del servidor desde la app y terminal web integrada. Evaluar si reemplaza a Cockpit (puerto 9090) o solo lo enlaza.

## Decisiones tomadas

- Stack: TypeScript, Bun, SQLite, PWA. Sin Next.js.
- Acceso: túnel SSH ahora; Cloudflare Tunnel después. Sin Tailscale.
- Una tarea a la vez; las demás se encolan.
- Aprobación del usuario antes de commit, push o PR.
- Sin tope de gasto por tarea; se consulta saldo o cuota.
- Uso personal, con un solo usuario.

## Preguntas abiertas

- ¿Cuál será la URL pública en Cloudflare y si habrá dominio propio?
- ¿El panel del VM dentro de la app reemplaza a Cockpit o solo lo enlaza?
- ¿Qué proveedores tienen API de saldo y cuáles se consultan a mano?
