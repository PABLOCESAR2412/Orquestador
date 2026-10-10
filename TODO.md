# TODO.md: pendientes inmediatos

Ordenado por prioridad. Marca `[x]` solo cuando esté verificado.

## Antes del merge de `feat/proyectos-proveedores` (login, proyectos, proveedores)

- [ ] Recuperar el acceso SSH al VM: "Connection timed out" en el puerto 22 significa que no llegan paquetes. Revisar en Azure que la VM esté en ejecución, que la IP pública sea la actual (una VM desasignada puede cambiarla) y que la regla de entrada SSH del grupo de seguridad permita tu IP actual.
- [ ] Hacer el merge del PR de `feat/proyectos-proveedores` en GitHub.
- [ ] En el VM, antes de reiniciar: añadir `TELO_CLAVE` (16 o más caracteres) al archivo de entorno de systemd, fuera del repo. Sin ella el servicio no arranca.
- [ ] Si se usarán proyectos: añadir `TELO_PROYECTOS_DIR` y crear la carpeta raíz en el VM.
- [ ] No abrir el túnel de Cloudflare hasta que el login esté en `main` y desplegado en el VM. El comando de actualización despliega `main`.
- [ ] Verificar en el VM: `GET /api/health` responde 200 sin sesión y `GET /api/conversations` responde 401 sin sesión.
- [ ] Decidir si el servidor escucha solo en `127.0.0.1` (`hostname` en `server/src/index.ts`). Hoy escucha en todas las interfaces; Azure solo deja SSH abierto.
- [ ] Incluir en `tests/` las pruebas de acceso (20 comprobaciones) y de proyectos y proveedores (30 comprobaciones).

## Después del merge (acceso)

- [ ] Probar el inicio de sesión desde el navegador a través del túnel SSH.
- [ ] Confirmar que la cookie `telo_sesion` sale con `Secure` por el túnel de Cloudflare. Hoy solo se probó en HTTP local.
- [ ] Quick Tunnel de prueba con el login activo. Su URL cambia al reiniciar y no tiene garantía de disponibilidad.

## En el VM

- [ ] Confirmar que `git log --oneline -1` muestra `597c560` y que `GET /api/preferences` responde 200.
- [ ] Confirmar en `journalctl -u orquestador` la línea `Migración aplicada: 004_settings`.
- [ ] Reiniciar el VM cuando convenga (hay una actualización de kernel pendiente) y verificar que `orquestador` arranca solo.

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

- [ ] Probar el túnel SSH con la URL de la app desde la PC.
- [ ] Configurar Cloudflare Tunnel y Access (fase 9) cuando haya URL definida.

## Limpieza

- [ ] Eliminar la rama `vm-local` si todavía existe.
- [ ] Eliminar la clave RSA antigua de la PC (`~/.ssh/id_rsa`).
- [ ] Azure: confirmar el presupuesto de 100 USD con alertas al 50, 80 y 100 %.
