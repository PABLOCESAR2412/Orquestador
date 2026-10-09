# TODO.md: pendientes inmediatos

Ordenado por prioridad. Marca `[x]` solo cuando esté verificado.

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
