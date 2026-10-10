# TODO.md: pendientes inmediatos

Ordenado por prioridad. Marca `[x]` solo cuando esté verificado.

## Login y proyectos (`feat/proyectos-proveedores`, ya mergeado)

- [x] Recuperar el acceso SSH al VM. El bloqueo era la regla de entrada del puerto 22, que no permitía la IP actual de la PC.
- [x] Merge del PR `feat/proyectos-proveedores` (PR #10).
- [x] `TELO_CLAVE` en `/etc/orquestador/orquestador.env` (root, permisos 600), cargado con un override de systemd (`EnvironmentFile=`). Sin clave, el servicio no arranca.
- [x] `TELO_PROYECTOS_DIR=/home/orquestador/proyectos` en el archivo de entorno, la carpeta existe y el panel de Proyectos en Ajustes carga sin errores.
- [x] Quick Tunnel abierto solo después del merge y con el login activo.
- [x] Verificado en el VM: `GET /api/health` responde 200 y `GET /api/conversations` responde 401 sin sesión.
- [ ] Decidir si el servidor escucha solo en `127.0.0.1` (`hostname` en `server/src/index.ts`). Pospuesto. Hoy escucha en todas las interfaces; Azure solo deja SSH abierto.
- [ ] Incluir en `tests/` las pruebas de acceso (20 comprobaciones) y de proyectos y proveedores (30 comprobaciones).

## Después del merge (acceso)

- [x] Inicio de sesión desde el navegador a través del túnel SSH, en `http://127.0.0.1:3000`.
- [x] Cookie `telo_sesion` por Quick Tunnel: `HttpOnly`, `Secure` y `SameSite=Strict`.
- [x] Quick Tunnel de prueba con el login activo. Su URL cambia al abrirlo de nuevo, no tiene garantía de disponibilidad y no vuelve sola después de reiniciar el VM.

## En el VM

- [ ] Confirmar que `git log --oneline -1` muestra `597c560` y que `GET /api/preferences` responde 200.
- [ ] Confirmar en `journalctl -u orquestador` la línea `Migración aplicada: 004_settings`.
- [x] Reiniciar el VM por la actualización de kernel. `orquestador` arrancó solo y `GET /api/health` responde 200.

## Diseño (fase 4)

- [ ] Instalar impeccable en el repo: `npx impeccable install --providers=claude --scope=project`.
- [ ] Ejecutar `/impeccable init` y revisar el `PRODUCT.md` que genera.
- [ ] Generar las pantallas en Stitch con `docs/design/STITCH_PROMPT.md` e importar `DESIGN.md`.
- [ ] Exportar a HTML/CSS y adaptar el resultado a las variables de `styles.css`. No usar Tailwind.
- [ ] Revisar las cinco pantallas a 390 px y 1440 px con Playwright.

## Herramientas

- [ ] Instalar Playwright MCP: `claude mcp add playwright -- npx @playwright/mcp@latest --headless`.
- [ ] Opcional: instalar caveman desde su README, para tareas internas de los agentes.

## Código

- [ ] Mover las pruebas actuales (`test-analytics`, `test-tasks`, `shot-*`) a `tests/`, sin rutas locales ni datos fijos.
- [ ] Agregar un script `test` en `server/package.json`.
- [ ] Migración 005: nuevos estados de tarea, columnas `plan` y `resultado`, estado de aprobación.
- [ ] Implementar el analizador (prompt y validación del JSON) y el obrero (ejecuta solo el plan aprobado).

## Acceso

- [x] Probar el túnel SSH con la URL de la app desde la PC.
- [ ] Configurar Cloudflare Tunnel y Access (fase 9) cuando haya URL definida.

## Limpieza

- [ ] Eliminar la rama `vm-local` si todavía existe.
- [ ] Eliminar la clave RSA antigua de la PC (`~/.ssh/id_rsa`).
- [ ] Azure: confirmar el presupuesto de 100 USD con alertas al 50, 80 y 100 %.
