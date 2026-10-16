# TODO.md: pendientes inmediatos

Ordenado por prioridad. Marca `[x]` solo cuando esté verificado.

## Login y proyectos (`feat/proyectos-proveedores`, ya mergeado)

- [x] Recuperar el acceso SSH al VM. El bloqueo era la regla de entrada del puerto 22, que no permitía la IP actual de la PC.
- [x] Merge del PR `feat/proyectos-proveedores` (PR #10).
- [x] `TELO_CLAVE` en `/etc/orquestador/orquestador.env` (root, permisos 600), cargado con un override de systemd (`EnvironmentFile=`). Sin clave, el servicio no arranca.
- [ ] Confirmar `TELO_PROYECTOS_DIR` en el mismo archivo de entorno y que la carpeta `/home/orquestador/proyectos` existe.
- [x] Quick Tunnel abierto solo después del merge y con el login activo.
- [x] Verificado en el VM: `GET /api/health` responde 200 y `GET /api/conversations` responde 401 sin sesión.
- [x] Decidir si el servidor escucha solo en `127.0.0.1`. Decidido: sí, por defecto (`server/src/config.ts`, `TELO_ESCUCHAR`). Falta confirmarlo en el VM tras el deploy.
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
- [x] Generar las pantallas en Stitch con `docs/design/STITCH_PROMPT.md` e importar `DESIGN.md`.
- [x] Exportar a HTML/CSS y adaptar el resultado a las variables de `styles.css`. No usar Tailwind.
- [ ] Revisar las cinco pantallas a 390 px y 1440 px con Playwright. Hecho en automático (14 oct): 32 capturas sin desbordes ni errores de consola, y dos revisadas a ojo. Falta el resto a ojo y el contraste AA.

## Herramientas

- [ ] Instalar Playwright MCP: `claude mcp add playwright -- npx @playwright/mcp@latest --headless`.
- [ ] Opcional: instalar caveman desde su README, para tareas internas de los agentes.

## Código

- [x] Mover las pruebas actuales a `tests/`. Verificado: ya no hay `test-analytics`, `test-tasks` ni `shot-*` en el repo.
- [x] Script `test` en `server/package.json` (`bun test`).
- [x] Migraciones 010 (Git y aprobaciones), 011 (secretos) y 012 (instrucciones y programadas) implementadas en `feat/revision-agentes`.
- [x] Migración 013 (`013_oauth_google`): estados de inicio de sesión y conexión de Google, con pruebas en `server/tests/google.test.ts`.
- [x] Migración 014 sustituida: los estados y columnas del analizador están en la migración `019_analizador_obrero`.
- [x] Analizador y obrero implementados y mergeados (PR #28). Falta la prueba con OpenCode real (ver «Pendiente de Pablo»).

## Acceso

- [x] Probar el túnel SSH con la URL de la app desde la PC.
- [ ] Fase 9: probar el acceso por Tailscale desde el teléfono y desactivar la expiración de la clave del VM.

## PR y ramas

- [x] PR #30 fusionado (tsconfig del servidor y `bun run typecheck`, merge `fceffc2`).
- [x] Números de PR en `web/src/cambios.json` completados. Trazados en el historial de `main`: «Clonado», «Proceso del agente» y «Respuestas del chat» son #26; «Aviso de nueva versión» es #27.
- [ ] Decidir si se borran las ramas remotas ya fusionadas (casi todas), y qué hacer con `docs/proyectos-verificado` (un commit sin fusionar).

## Limpieza

- [ ] Eliminar la rama `vm-local` del remoto. Ya está fusionada; requiere confirmación.
- [ ] Eliminar la clave RSA antigua de la PC (`~/.ssh/id_rsa`).
- [ ] Azure: confirmar el presupuesto de 100 USD con alertas al 50, 80 y 100 %.

## Pendiente de Pablo (antes de aprobar y hacer merge)

Lo que no se puede probar desde aquí o requiere una decisión tuya:

- [ ] En el VM, agregar a `/etc/orquestador/orquestador.env`: `TELO_CLAVE_CIFRADO=$(openssl rand -base64 32)`. Guárdala fuera del repo. Sin ella los secretos no se guardan.
- [ ] Instalar `opencode` en el VM y probar un agente real dentro de bubblewrap. Aquí no está instalado, así que solo se probó con un agente falso.
- [ ] Configurar la GitHub App en el VM (`TELO_GITHUB_APP_ID` y `TELO_GITHUB_APP_PRIVATE_KEY_PATH`), vincular la instalación en Ajustes y probar clonado privado, push aprobado y creación de PR en un repositorio de prueba.
- [ ] Después del deploy, confirmar que `tailscale serve` sigue activo y que la app abre desde el teléfono (el servidor ahora escucha solo en 127.0.0.1).
- [ ] Reiniciar el VM y comprobar que las migraciones 010–013 aplican y que la copia previa queda en `DATA_DIR/respaldos-migracion`.
- [ ] Desactivar la expiración de la clave de `vm-1` en Tailscale.
- [x] Borrar la rama remota `feat/acceso-workers-vpc` y la carpeta `edge/`. Verificado: ni la rama ni la carpeta existen.
- [ ] Google: crear el cliente OAuth web en Google Cloud con la URI `<TELO_PUBLIC_URL>/api/google/callback`, poner `TELO_PUBLIC_URL`, `TELO_GOOGLE_CLIENT_ID` y `TELO_GOOGLE_CLIENT_SECRET` en el archivo de entorno del VM, y probar la conexión desde Ajustes. Después confirmar el permiso y la API para leer la cuota.
- [ ] Decidir Codex (solo estado de claves, sin inicio de sesión por ahora).
- [ ] Decidir si la cookie de sesión pasa de `SameSite=Strict` a `Lax`. Con Strict, al volver de Google hay que volver a escribir la clave (la cookie no viaja desde Google). Con Lax, no.
- [ ] Revisar la regla del push: solo `github.com` por HTTPS. Si usas otro host, hay que ampliarla.
- [ ] Revisar el desvío de cancelación: un clon con cambios se conserva para revisión, no se borra.
