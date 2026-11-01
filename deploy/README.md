# Despliegue automático en el VM

## Migración 023: precisión del uso

La migración agrega columnas e índice sin modificar tokens, costes ni filas existentes. Los registros anteriores quedan con precisión `desconocida`; los nuevos distinguen datos medidos, estimados y ausentes. El arranque crea una copia previa consistente y registra la migración para no repetirla.

Para revertir el código, vuelve al commit anterior y conserva las columnas nuevas: los lectores y escritores anteriores siguen funcionando con sus valores por defecto. No borres registros ni elimines columnas para volver atrás. Si fuera necesaria una recuperación completa, usa el procedimiento de respaldos con el servicio detenido y la copia anterior a `023_precision_uso`.

## Prueba de GitHub App

La instalación en GitHub y la configuración del servicio son pasos distintos. Si Ajustes muestra `TELO_GITHUB_APP_ID` o `TELO_GITHUB_APP_PRIVATE_KEY_PATH` ausentes, la prueba con App está pendiente aunque una sesión de GitHub anterior pueda publicar.

Repositorio de prueba autorizado: `PABLOCESAR2412/Test` (privado). Si está vacío, crea primero un README en la rama base: un pull request necesita una base con commits. Después incluye el repo en la instalación de la App, configura el servicio como se indica en la sección de GitHub App y vincula la instalación en Ajustes.

Desde Telo: clona Test, pide un cambio mínimo en un archivo de prueba, revisa el diff y autoriza commit/push y PR. Comprueba que aparecen el commit y el PR en Test y registra URL, SHA y método de autenticación. No tomes una subida mediante credenciales heredadas como prueba de la App. La prueba no requiere fusionar el PR ni modificar Cubo.

Un timer de systemd revisa `main` cada 5 minutos y comparte con el respaldo un `flock`. Si el cambio se limita a `web/src/*.css`, `web/src/cambios.json` y documentación (`README.md`, `SEGUIMIENTO.md` o este archivo), no crea una pausa ni reinicia el servidor. La interfaz se compila en una carpeta temporal; primero se publican los assets con hash y al final se sustituye `index.html`, para que las tareas y las pestañas abiertas sigan usando archivos completos. Los assets antiguos se conservan para clientes que aún los soliciten.

Antes de desplegar cualquier commit de `main`, el timer consulta GitHub Actions para ese SHA, toma la ejecución más reciente del workflow `.github/workflows/ci.yml` disparada por un `push` a `main` y exige que los trabajos `servidor` e `interfaz` terminen con `success`. Si falta una ejecución, sigue en curso, falla o falta un trabajo, ese ciclo se pospone; el siguiente vuelve a consultar sin requerir otro commit. La falta de autenticación, permiso o red también bloquea el despliegue. El PAT solo se usa durante esta consulta en `orquestador-deploy.service` y se elimina del entorno antes de compilar; nunca se pasa al servicio web ni a los agentes.

La instalación de Antigravity descarga el instalador oficial por HTTPS, limita su tamaño y comprueba su sintaxis antes de ejecutarlo. Google no publica un checksum o firma verificable para ese script; TLS protege el transporte, pero no ofrece una verificación criptográfica independiente del contenido.

Como el repositorio es privado, crea un token fine-grained limitado al repositorio `PABLOCESAR2412/Orquestador` con **Repository permissions → Actions: Read-only**. Los PAT fine-grained no ofrecen el permiso `Checks`; por eso el actualizador lee los workflow runs y sus jobs mediante la API de Actions. No habilites permisos de escritura. Si el PAT ya se creó sin `Actions: Read-only`, GitHub no permite cambiar sus permisos: crea otro con ese alcance. En el VM edita el archivo directamente; no pegues el valor en el chat ni en un comando:

```bash
sudo install -o root -g root -m 600 /dev/null /etc/orquestador/deploy.env
sudoedit /etc/orquestador/deploy.env
```

Contenido dentro del editor:

```ini
TELO_GITHUB_CI_TOKEN=github_pat_REEMPLAZAR_EN_EL_EDITOR
```

Al pasar desde la versión que consultaba la API Checks, el primer despliegue de este cambio tiene que ser manual: el actualizador viejo no puede usar un PAT fine-grained para esa API. Guarda el PAT en `deploy.env` y, cuando no haya tareas activas, actualiza así el checkout. Primero comprueba que `git status --short` no muestre cambios; si aparecen archivos, consérvalos y no uses `reset`.

```bash
sudo systemctl stop orquestador-deploy.timer
sudo systemctl stop orquestador.service
cd ~/orquestador/orquestador
git status --short
git fetch origin main
git merge --ff-only origin/main
(cd server && bun install --frozen-lockfile)
(cd web && bun install --frozen-lockfile && bun run build)
sudo systemctl start orquestador.service
curl -fsS http://127.0.0.1:3000/api/health
sudo systemctl start orquestador-deploy.timer
```

Después de ese primer cambio, `systemd` vuelve a leer `EnvironmentFile` al iniciar cada ciclo. Para comprobar manualmente la puerta nueva:

```bash
sudo systemctl start orquestador-deploy.service
journalctl -u orquestador-deploy.service -n 30 --no-pager
```

Un `403` indica que al PAT le falta `Actions: Read-only` o que GitHub no lo autorizó para ese repositorio; un `404` suele indicar que el repositorio no está incluido en el alcance del token. En ambos casos el actualizador conserva la versión instalada y vuelve a intentarlo en el siguiente ciclo.

Los demás cambios se tratan como potencialmente capaces de afectar el chat o las tareas: la API rechaza nuevas escrituras, el worker deja de tomar trabajos y una señal exclusiva hace que los turnos activos se detengan y queden reanudables. Se conserva la sesión del proveedor y el workspace; al volver el servicio, el usuario puede continuar manualmente. La cola y los planes pendientes de aprobación se conservan. Si algún proceso no termina dentro del plazo, el ciclo se pospone sin detener el servicio. Una vez drenado, el actualizador para el servicio, avanza `main`, instala dependencias congeladas y compila. Después arranca y comprueba `/api/health`; ante un build o arranque fallido, restaura el código anterior, reinstala, recompila y verifica. La base conserva las migraciones aditivas.

La primera instalación de este protocolo requiere una actualización manual con agentes terminados y servicio parado: una versión anterior no reconoce la señal de pausa ni expone el contador de trabajos. Verifica que no quedan procesos OpenCode/Codex externos y pausa también el timer de respaldo durante ese primer cambio. No modifiques el checkout de un servicio activo. Después de instalar esta versión, solo los cambios clasificados como capaces de afectar el runtime detendrán tareas; los cambios visuales CSS y documentación seguirán aplicándose en vivo.

El respaldo usa el mismo candado de mantenimiento y no publica una copia parcial. Si un proceso termina con SIGKILL, puede quedar `.git/telo-mantenimiento`: la API deja de bloquear a los 30 minutos, pero las herramientas conservan la marca y posponen operaciones. Para recuperarlo, un administrador debe comprobar que los servicios de despliegue/respaldo están inactivos y que `flock -n .git/telo-operacion.lock true` obtiene el candado; solo entonces retirar el directorio vacío con `rmdir .git/telo-mantenimiento` y repetir la operación. No se roba una marca existente.

Los cambios en componentes TypeScript de la interfaz, API, workers, runners, dependencias, configuración, migraciones o el propio actualizador pasan por el drenado y reinicio. La regla es deliberadamente conservadora: si el actualizador no reconoce todos los archivos como CSS/documentación segura, pausa primero y despliega después. Esto mantiene la protección de #121 sin interrumpir tareas por ajustes puramente visuales.

## Concurrencia de agentes

Telo admite hasta diez runners principales en total, con una ejecución de OpenCode y dos por cada otro proveedor por defecto. Las esperas no consumen puestos globales; la cola del worker también salta proveedores ocupados antes de preparar nuevos clones. Los reintentos y cambios al modelo de respaldo reservan capacidad para su proveedor real y liberan el puesto entre intentos. El chat muestra cuándo espera capacidad y cuándo obtiene el puesto.

Si la cuota contratada permite más, configurar en el archivo de entorno del servicio y reiniciar siguiendo el drenado:

```ini
TELO_CONCURRENCIA_PROVEEDORES={"opencode":1,"google":2,"groq":2,"nvidia":2,"openrouter":2,"codex":2}
```

Cada valor debe ser un entero entre 1 y 10; una configuración inválida conserva el valor seguro. Esto limita ejecuciones principales, no peticiones HTTP individuales ni los hijos que un harness lanza internamente. La delegación nativa necesita su propio presupuesto en el piloto del nuevo motor. No elimina los límites RPM/TPM de los proveedores ni garantiza que una API gratuita responda más rápido.

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

- **Pausa para despliegue.** El actualizador interrumpe tareas y turnos activos, conserva la sesión si ya existe y mantiene el workspace, y solo detiene el servicio cuando ya no quedan ejecuciones externas.
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

3. Instala el script, las unidades y la regla de sudo, que solo permite parar, arrancar y reiniciar `orquestador`. Requiere `flock` (util-linux), curl y pgrep. Antes de habilitar el timer configura `/etc/orquestador/deploy.env` como se indicó arriba:

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
- **Aislamiento de credenciales Codex:** antes de ejecutar modelos Codex en Telo, instala la política administrada que impide que los comandos del agente lean `auth.json` y `config.toml` desde sus dos rutas visibles dentro de Bubblewrap:

  ```bash
  sudo bash ./deploy/instalar-politica-codex.sh orquestador
  ```

  El script crea `/etc/codex/requirements.toml` solo si todavía no existe y lo deja propiedad de `root`; exige que el directorio también sea confiable. Si ya existe una política, no la reemplaza: añade las cuatro rutas a `permissions.filesystem.deny_read` y vuelve a ejecutar el script. Telo verifica la política y los permisos antes de lanzar Codex, y falla de forma cerrada si algo falta. El runner mantiene el sandbox `workspace-write`; Bubblewrap sigue imponiendo su propio límite al workspace.

## Google Drive para archivar espacios de tareas (una vez)

Drive sirve como archivo externo cifrado para los espacios de trabajo de tareas terminadas. El historial de conversaciones y la base de datos siguen en la VM; los proyectos no se mueven. Telo solo libera los archivos locales después de subirlos, comprobar tamaño y SHA-256, y verificar la integridad del cifrado. La primera prueba debe hacerse con una tarea pequeña, comprobando que se puede restaurar antes de archivar más.

1. Habilita **Google Drive API** en el proyecto de Google Cloud y crea un cliente OAuth de tipo aplicación web. Usa el dominio HTTPS de Tailscale como origen; `TELO_PUBLIC_URL` debe ser solo el origen, sin `/chat`:

   ```text
   TELO_PUBLIC_URL=https://vm-1.tail0656a4.ts.net
   ```

2. Registra esta URI exacta en **URIs de redireccionamiento autorizados** del cliente OAuth:

   ```text
   https://vm-1.tail0656a4.ts.net/api/google-drive/oauth/callback
   ```

   Telo también la muestra en Ajustes > Estado del servidor > Almacenamiento cuando `TELO_PUBLIC_URL` y las credenciales tienen un formato válido. El navegador debe poder abrir el dominio de Tailscale y la sesión de Telo debe estar iniciada al conectar.

3. Guarda estos valores en `/etc/orquestador/orquestador.env`, sin ponerlos en el repositorio:

   ```text
   TELO_GOOGLE_DRIVE_CLIENT_ID=...apps.googleusercontent.com
   TELO_GOOGLE_DRIVE_CLIENT_SECRET=...
   TELO_PUBLIC_URL=https://vm-1.tail0656a4.ts.net
   ```

   Protege el archivo con dueño `root:root` y modo `0600`. Mantén el valor actual de `TELO_CLAVE_CIFRADO`: Telo lo usa para cifrar el token de Google y los archivos archivados. Si se pierde o se cambia, no se podrán descifrar esas copias. Guárdalo en un respaldo seguro separado.

4. Reinicia `orquestador`, abre Ajustes > Estado del servidor > Almacenamiento y conecta la cuenta Google que tiene el espacio disponible. Antes de archivar varias tareas, archiva una tarea pequeña y restáurala para confirmar el recorrido completo. Para liberar el disco después de una copia ya verificada, pulsa **Verificar y liberar**; para volver a trabajar en ella, pulsa **Restaurar**.

Si la pantalla de consentimiento OAuth está como **Externa / Prueba**, Google puede caducar el permiso de actualización a los siete días. Para mantener la conexión, revisa el estado de publicación del consentimiento y publícala en **Producción**; este diseño solicita únicamente el alcance `drive.file`. Referencias: [alcances de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) y [caducidad de tokens OAuth](https://developers.google.com/identity/protocols/oauth2).

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
