# Despliegue automático en el VM

## Migración 023: precisión del uso

La migración agrega columnas e índice sin modificar tokens, costes ni filas existentes. Los registros anteriores quedan con precisión `desconocida`; los nuevos distinguen datos medidos, estimados y ausentes. El arranque crea una copia previa consistente y registra la migración para no repetirla.

Para revertir el código, vuelve al commit anterior y conserva las columnas nuevas: los lectores y escritores anteriores siguen funcionando con sus valores por defecto. No borres registros ni elimines columnas para volver atrás. Si fuera necesaria una recuperación completa, usa el procedimiento de respaldos con el servicio detenido y la copia anterior a `023_precision_uso`.

## Prueba de GitHub App

La instalación en GitHub y la configuración del servicio son pasos distintos. Si Ajustes muestra `TELO_GITHUB_APP_ID` o `TELO_GITHUB_APP_PRIVATE_KEY_PATH` ausentes, la prueba con App está pendiente aunque una sesión de GitHub anterior pueda publicar.

Repositorio de prueba autorizado: `PABLOCESAR2412/Test` (privado). Si está vacío, crea primero un README en la rama base: un pull request necesita una base con commits. Después incluye el repo en la instalación de la App, configura el servicio como se indica en la sección de GitHub App y vincula la instalación en Ajustes.

Desde Telo: clona Test, pide un cambio mínimo en un archivo de prueba, revisa el diff y autoriza commit/push y PR. Comprueba que aparecen el commit y el PR en Test y registra URL, SHA y método de autenticación. No tomes una subida mediante credenciales heredadas como prueba de la App. La prueba no requiere fusionar el PR ni modificar Cubo.

Un timer de systemd revisa `main` cada 5 minutos. Si hay commits nuevos, `actualizar.sh` obtiene un `flock` compartido con el respaldo y crea una marca de mantenimiento. La API rechaza escrituras nuevas y el worker deja de tomar tareas; espera a que terminen los trabajos admitidos. Si siguen activos, el ciclo se pospone sin detenerlos. Una vez drenado, para el servicio, avanza `main`, instala dependencias congeladas y compila la interfaz. Después arranca y comprueba `/api/health`; ante un build o arranque fallido, restaura el código anterior, reinstala, recompila y verifica. La base conserva las migraciones aditivas.

La primera instalación de este protocolo requiere una actualización manual con agentes terminados y servicio parado: un servidor anterior no expone el contador de trabajos. Verifica que no quedan procesos OpenCode/Codex externos y pausa también el timer de respaldo durante ese primer cambio. No modifiques el checkout de un servicio activo.

El respaldo usa la misma pausa y no publica una copia parcial. Si un proceso termina con SIGKILL, puede quedar `.git/telo-mantenimiento`: la API deja de bloquear a los 30 minutos, pero las herramientas conservan la marca y posponen operaciones. Para recuperarlo, un administrador debe comprobar que los servicios de despliegue/respaldo están inactivos y que `flock -n .git/telo-operacion.lock true` obtiene el candado; solo entonces retirar el directorio vacío con `rmdir .git/telo-mantenimiento` y repetir la operación. No se roba una marca existente.

## Respaldos en Cloudflare R2

El timer diario crea una copia SQLite verificada y un archivo del espacio de trabajo. R2 es opcional y usa la API S3 con un bucket privado. Telo sube el conjunto local más reciente por defecto, revisa el tamaño y la etiqueta de cada objeto, publica un manifiesto de conjunto completo y solo entonces poda los respaldos remotos. Conserva un conjunto completo en R2 y una copia local por defecto. Si la subida o la validación fallan, no borra copias locales.

1. En Cloudflare, crea un bucket privado y un token S3 de R2 con permisos de lectura y escritura restringidos a ese bucket. Guarda el ID de cuenta, el nombre del bucket, el Access Key ID y el Secret Access Key; Cloudflare muestra el secreto una sola vez. No habilites acceso público.
2. En el VM, crea el archivo de credenciales fuera del repo y edítalo con `sudoedit`:

   ```bash
   sudo install -o root -g root -m 600 /dev/null /etc/orquestador/r2-backups.env
   sudoedit /etc/orquestador/r2-backups.env
   ```

   Contenido (reemplaza los dos valores de ejemplo en el editor, nunca los pegues en el chat):

   ```ini
   TELO_R2_ACCOUNT_ID=ID_DE_CUENTA
   TELO_R2_BUCKET=telo-respaldos
   TELO_R2_ACCESS_KEY_ID=CLAVE_DE_ACCESO
   TELO_R2_SECRET_ACCESS_KEY=SECRETO_DE_ACCESO
   TELO_R2_PREFIX=respaldos
   TELO_R2_RESPALDOS_CONSERVAR=1
   TELO_R2_RESPALDOS_LOCALES=1
   ```

   El endpoint se construye con el ID de cuenta. `TELO_R2_RESPALDOS_LOCALES=1` deja el conjunto más reciente en el VPS para que siga funcionando `copiar-respaldo-pc.ps1`; usa `0` solo si no necesitas esa copia local. El servidor guarda el conjunto completo más reciente en R2 y elimina los anteriores después de verificar la subida. Puedes subir el número si quieres guardar más historial.
3. Instala la versión actualizada del servicio y ejecuta una prueba manual:

   ```bash
   sudo cp ~/orquestador/deploy/orquestador-respaldo.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl start orquestador-respaldo.service
   journalctl -u orquestador-respaldo.service -n 50 --no-pager
   ```

   El primer respaldo con R2 sube el conjunto local más reciente disponible. Telo reduce copias locales solo después de confirmar el conjunto completo actual en R2; un error deja los archivos del VPS intactos. El servicio no migra automáticamente copias históricas anteriores.

Para desactivar R2, borra o renombra `/etc/orquestador/r2-backups.env`, recarga systemd y el siguiente respaldo usará la retención local de `TELO_RESPALDOS_CONSERVAR`.

## Reglas

- **No reinicia con ejecuciones en curso.** Un reinicio marca como fallidas las tareas activas (`worker.ts`). Si hay un `opencode run` o `codex exec` vivo, espera al siguiente ciclo.
- **Servidor e interfaz coherentes.** Se instala y compila con el servicio parado; los clientes reciben el aviso de "Recargar ahora" después del arranque verificado.
- **`bun install --frozen-lockfile` en cada ciclo** que cambie dependencias.
- **Si falla el build o el servidor no responde**, vuelve a la versión anterior y no reintenta ese mismo commit hasta que llegue uno nuevo.

## Archivos sensibles del VM

El archivo de entorno `/etc/orquestador/orquestador.env` (con `TELO_CLAVE` y la clave de cifrado) y la clave privada de la GitHub App viven en `/etc/orquestador`. Crea el archivo de entorno con dueño `root:root` y permisos `0600`: `systemd` lo lee como root antes de bajar al servicio, y así ni un accidente de permisos lo deja legible para el usuario `orquestador`.

El aislamiento de los agentes oculta `/etc/orquestador` completo y la ruta que apunte `TELO_GITHUB_APP_PRIVATE_KEY_PATH` (aunque esté fuera de esa carpeta). Para ocultar rutas sensibles adicionales, añádelas en `TELO_OCULTAR_EXTRA` (rutas absolutas separadas por `:`) en el archivo de entorno, y reinicia el servicio.

## Instalación en el VM (una vez)

Usuario `orquestador`, repo en `/home/orquestador/orquestador`.

1. Pone el VM al día a mano, incluido el servidor, para que el timer parta de una versión conocida:

   ```bash
   cd ~/orquestador
   # Esperar trabajos y pausar el timer de respaldo antes de la primera instalación.
   sudo systemctl stop orquestador
   git switch main && git pull --ff-only
   (cd server && bun install --frozen-lockfile)
   (cd web && bun install --frozen-lockfile && bun run build)
   sudo systemctl start orquestador
   curl -fsS http://127.0.0.1:3000/api/health
   ```

2. Revisa la ruta de `bun` y de `systemctl`:

   ```bash
   which bun        # si no es /home/orquestador/.bun/bin/bun, ajusta PATH en orquestador-deploy.service
   which systemctl  # si no es /usr/bin/systemctl, ajusta la regla de sudoers
   ```

3. Instala el script, las unidades y la regla de sudo, que solo permite parar, arrancar y reiniciar `orquestador`. Requiere `flock` (util-linux), curl y pgrep:

   ```bash
   chmod +x deploy/actualizar.sh
   sudo cp deploy/orquestador-deploy.service deploy/orquestador-deploy.timer /etc/systemd/system/
   echo 'orquestador ALL=(root) NOPASSWD: /usr/bin/systemctl stop orquestador, /usr/bin/systemctl start orquestador, /usr/bin/systemctl restart orquestador' | sudo tee /etc/sudoers.d/orquestador-deploy >/dev/null
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

Sin ese permiso, la pestaña muestra un aviso en lugar de los registros. El gasto de Azure necesita aparte una identidad administrada del VM con permiso de lectura de costes (pendiente de decisión; ver `SEGUIMIENTO.md`, tarea 6).

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
