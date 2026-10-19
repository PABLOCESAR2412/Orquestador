# Despliegue automático en el VM

## Migración 023: precisión del uso

La migración agrega columnas e índice sin modificar tokens, costes ni filas existentes. Los registros anteriores quedan con precisión `desconocida`; los nuevos distinguen datos medidos, estimados y ausentes. El arranque crea una copia previa consistente y registra la migración para no repetirla.

Para revertir el código, vuelve al commit anterior y conserva las columnas nuevas: los lectores y escritores anteriores siguen funcionando con sus valores por defecto. No borres registros ni elimines columnas para volver atrás. Si fuera necesaria una recuperación completa, usa el procedimiento de respaldos con el servicio detenido y la copia anterior a `023_precision_uso`.

## Prueba de GitHub App

La instalación en GitHub y la configuración del servicio son pasos distintos. Si Ajustes muestra `TELO_GITHUB_APP_ID` o `TELO_GITHUB_APP_PRIVATE_KEY_PATH` ausentes, la prueba con App está pendiente aunque una sesión de GitHub anterior pueda publicar.

Repositorio de prueba autorizado: `PABLOCESAR2412/Test` (privado). Si está vacío, crea primero un README en la rama base: un pull request necesita una base con commits. Después incluye el repo en la instalación de la App, configura el servicio como se indica en la sección de GitHub App y vincula la instalación en Ajustes.

Desde Telo: clona Test, pide un cambio mínimo en un archivo de prueba, revisa el diff y autoriza commit/push y PR. Comprueba que aparecen el commit y el PR en Test y registra URL, SHA y método de autenticación. No tomes una subida mediante credenciales heredadas como prueba de la App. La prueba no requiere fusionar el PR ni modificar Cubo.

Un timer de systemd revisa `main` cada 5 minutos. Si hay commits nuevos, el script `actualizar.sh` trae el código, compila la interfaz y reinicia `orquestador` solo cuando cambió `server/`.

## Reglas

- **No reinicia con ejecuciones en curso.** Un reinicio marca como fallidas las tareas activas (`worker.ts`). Si hay un `opencode run` o `codex exec` vivo, espera al siguiente ciclo.
- **`web/` no reinicia nada.** El servidor lee `web/dist` en cada petición. Los clientes ven la versión nueva con el aviso de "Recargar ahora".
- **`bun install --frozen-lockfile` en cada ciclo** que cambie dependencias.
- **Si falla el build o el servidor no responde**, vuelve a la versión anterior y no reintenta ese mismo commit hasta que llegue uno nuevo.

## Instalación en el VM (una vez)

Usuario `orquestador`, repo en `/home/orquestador/orquestador`.

1. Pone el VM al día a mano, incluido el servidor, para que el timer parta de una versión conocida:

   ```bash
   cd ~/orquestador
   git switch main && git pull --ff-only
   (cd server && bun install --frozen-lockfile)
   (cd web && bun install --frozen-lockfile && bun run build)
   sudo systemctl restart orquestador
   ```

2. Revisa la ruta de `bun` y de `systemctl`:

   ```bash
   which bun        # si no es /home/orquestador/.bun/bin/bun, ajusta PATH en orquestador-deploy.service
   which systemctl  # si no es /usr/bin/systemctl, ajusta la regla de sudoers
   ```

3. Instala el script, las unidades y la regla de sudo, que solo permite reiniciar `orquestador`:

   ```bash
   chmod +x deploy/actualizar.sh
   sudo cp deploy/orquestador-deploy.service deploy/orquestador-deploy.timer /etc/systemd/system/
   echo 'orquestador ALL=(root) NOPASSWD: /usr/bin/systemctl restart orquestador' | sudo tee /etc/sudoers.d/orquestador-deploy >/dev/null
   sudo chmod 440 /etc/sudoers.d/orquestador-deploy
   sudo visudo -cf /etc/sudoers.d/orquestador-deploy
   sudo systemctl daemon-reload
   sudo systemctl enable --now orquestador-deploy.timer
   ```

## Uso y revisión

```bash
systemctl list-timers orquestador-deploy.timer     # cuándo corre el siguiente ciclo
journalctl -u orquestador-deploy -n 50             # qué hizo el último ciclo
sudo systemctl start orquestador-deploy.service    # forzar un ciclo ahora
```

Para pausar el despliegue automático: `sudo systemctl disable --now orquestador-deploy.timer`.

## Proxy inverso y límite por IP

El servidor escucha en `127.0.0.1` por defecto, por lo que Tailscale Serve no necesita configuración adicional. Si se cambia `TELO_ESCUCHAR` para aceptar conexiones desde otra interfaz detrás de un proxy, añade a `/etc/orquestador/orquestador.env` `TELO_PROXIES_CONFIABLES` con las IP exactas de los proxies que conectan directamente al servidor, separadas por comas. El proxy debe sobrescribir `CF-Connecting-IP`, `X-Forwarded-For` o `X-Real-IP`; el servidor ignora esas cabeceras para cualquier otro peer.

No declares como confiables las IP de los clientes. Tras cambiar el archivo de entorno, reinicia `orquestador`.

## Registros y estado en Ajustes (una vez)

Ajustes > Estado del servidor muestra el estado de `orquestador` y sus últimos registros. La app los lee con `journalctl`, sin sudo. Para que el usuario `orquestador` pueda leer el diario, hay que añadirlo al grupo de lectura del diario:

```
sudo usermod -aG systemd-journal orquestador
sudo systemctl restart orquestador
```

Sin ese permiso, la pestaña muestra un aviso en lugar de los registros. El gasto de Azure necesita aparte una identidad administrada del VM con permiso de lectura de costes (pendiente de decisión; ver `FASE3.md`, tarea 6).

## Instalar OpenCode y el login de Codex desde Ajustes (una vez)

- **Instalar OpenCode** usa `npm` del PATH de `orquestador.service`. Si no hay `npm`, el botón lo dice. Instala en `~/.opencode`, que el agente ya ve en solo lectura. El servidor añade esa carpeta a su PATH sin reiniciar. No hace falta sudo.
- **Login de Codex** necesita el CLI `codex` en el servidor. Antes de usarlo, confirma con `codex login --help` que existe `--device-auth`, y mira qué archivo de sesión crea (la app espera `~/.codex/auth.json`; si es otro, hay que cambiarlo en `server/src/login-cli.ts`).

## GitHub App para repositorios (una vez)

Telo puede usar una GitHub App instalada en tu cuenta para clonar repositorios privados, subir ramas y crear Pull Requests. En GitHub, limita la instalación a los repositorios de Telo y concede `Contents: read and write` y `Pull requests: read and write` (el permiso de metadatos de repositorio es de solo lectura y viene incluido). Telo solicita credenciales de instalación limitadas a un único repositorio y a `Contents: read` al clonar, `Contents: write` al subir o `Pull requests: write` al abrir un PR.

1. En GitHub, crea una clave privada nueva para la App y copia el archivo `.pem` al VM por un canal seguro. No la guardes en el repo ni la pegues en Telo. Déjala legible solo por el usuario del servicio:

   ```bash
   sudo install -o orquestador -g orquestador -m 600 /ruta/segura/descargada.pem /etc/orquestador/github-app.pem
   ```

2. Añade el App ID y la ruta al archivo de entorno de `orquestador.service` (`/etc/orquestador/orquestador.env`):

   ```text
   TELO_GITHUB_APP_ID=123456
   TELO_GITHUB_APP_PRIVATE_KEY_PATH=/etc/orquestador/github-app.pem
   ```

Para mostrar el Artificial Analysis Intelligence Index junto a los modelos, configura también `TELO_ARTIFICIAL_ANALYSIS_API_KEY` con una clave de la API gratuita de Artificial Analysis. Telo la usa solo desde el servidor y guarda los resultados en caché por 12 horas; sin clave, el selector conserva todas sus funciones y explica que el índice no está configurado.

3. Reinicia el servicio. En Telo, abre Ajustes > Cuenta de GitHub y elige la instalación. Si agregas o quitas repositorios, cambia la selección desde los ajustes de instalación de GitHub; Telo solo podrá operar en esos repositorios.

La App debe tener instalados los permisos antes de emitir credenciales. Los tokens de instalación duran una hora como máximo y Telo no los almacena. La antigua sesión o clave SSH del proyecto sigue disponible como compatibilidad durante la transición; al vincular la App, sus credenciales tienen prioridad.

## Qué no cubre

- No corre migraciones a mano: las aplica el servidor al arrancar.
- Si `main` tiene cambios locales en el VM, el script se detiene con un aviso en el journal. No descarta nada.
- El patrón de ejecuciones incluye OpenCode y Codex. Añadir el patrón de agy cuando ese runner exista.
