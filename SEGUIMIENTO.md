# Seguimiento de Telo

Registro central de fases, revisiones y hallazgos. Actualizado: 4 de noviembre de 2026.

Estados: [x] resuelto con evidencia; [ ] pendiente; [~] implementado sin validar. Los estados históricos describen su fecha y no certifican el despliegue actual. Registra aquí nuevos hallazgos y actualiza cada resolución con su prueba.

## Fiabilidad de chat, reanudación y cola — PR pendiente, 4 de noviembre de 2026

- [x] «Seguir» libera al inicio el bloqueo de cuota para aceptar mensajes nuevos; si el modelo vuelve a agotar la cuota, el turno restaura el bloqueo.
- [x] El contexto de un mensaje se corta antes de su fila persistida: no duplica el mensaje actual ni incorpora avisos posteriores. Los errores de imágenes, adjuntos, cursor, reintento, vista previa y subchats tienen mensajes específicos; `/detener` comparte el código `subagent_read_only`.
- [x] La cola local despacha chats disponibles aunque el usuario cambie de conversación y ya no depende de observar ocupado/libre para avanzar. Tras reinicio, conserva los textos, limpia las marcas ejecutables y avisa cuántos mensajes quedaron pendientes.
- [x] El canal en vivo señala cuando el cliente quedó detrás del búfer; la interfaz invalida consultas y recupera el estado persistido. OpenCode cierra el grupo de procesos también si falla el registro de uso.
- [x] Revisados Codex, Command Code, Antigravity, aislamiento, respaldos de cuota y registro de uso: no se encontró otro fallo concreto que requiera cambio en esta tarea. La cola del servidor sigue avanzando después de un error genérico; se conserva el comportamiento actual porque no hay un control explícito de pausa/reanudación para esos mensajes.
- [x] Pruebas enfocadas de contexto, eventos, traducción de errores, recuperación de cola y limpieza de OpenCode; typecheck del servidor, build web y actualización de Graphify aprobados. La suite completa en Windows tuvo 88 fallos de entorno al crear/configurar repositorios Git temporales y un timeout de limpieza (637 aprobadas, 103 omitidas); Playwright no inició porque Chromium no está instalado. Dos pruebas nuevas de runner de chat se omiten en Windows por requerir `setsid`.

## MP4 y ZIP en entregables del chat

- Las referencias `../entregables/<id>/archivo` se resuelven solo cuando la carpeta corresponde a un workspace de la conversación. El MP4 conserva la reproducción por rangos y el ZIP se sirve como descarga. La prueba de rutas rechaza identificadores ajenos y rutas que intentan salir de la carpeta.

## Aprobación móvil, actividad y destino de Cloudflare

- La aprobación, cancelación y reanálisis comparten la fila de herramientas del compositor móvil. La prueba de Chromium comprueba posición y tamaño de los botones.
- Antigravity acumula los fragmentos del mismo paso antes de registrar su narración. Los pasos de herramienta mantienen sus propias entradas.
- El analizador distingue Pages de Workers y pregunta por proyecto y dominio si el destino sigue ambiguo. La revisión de Pages detecta un proyecto inexistente antes de copiar el lote. La tarjeta publica únicamente sitios estáticos de Pages.

## Confirmación de Pages, sesión y compositor móvil

- Pages presenta la rama de producción, tamaño, nombres de muestra y huella del lote. Al confirmar vuelve a copiar y comparar los bytes que recibirá Wrangler. Cambios de archivo, cuenta, ruta, proyecto o rama invalidan la revisión.
- Una rotación invalida la aprobación de los secretos del plan. Si la credencial sigue disponible, el worker devuelve el plan a aprobación con la nueva revisión. Un secreto retirado impide continuar con esa autorización.
- Login devuelve 503 sin emitir una cookie si no puede guardar la sesión. El selector de modelos del chat flota sobre el botón como Uso. El envío a cola vacía el compositor y detiene el dictado de ese mensaje, incluso si guardar el borrador falla.

## Publicación segura, secretos por tarea y dependencias — 4 de noviembre de 2026

- [x] Pages verifica nombres y contenido antes de invocar Wrangler con el detector de Git. Prueba con un secreto ficticio dentro de un bundle y publicación simulada de un directorio limpio. El escaneo cubre valores conocidos y patrones en contenido legible, no inspecciona el interior de archivos comprimidos.
- [x] El analizador ve nombres de secretos operativos del proyecto. Solo el obrero recibe los solicitados y confirmados explícitamente con el hash del plan. Los planes antiguos sin solicitud siguen siendo válidos y no conceden secretos operativos. El filtro de claves de inferencia conserva la integración seleccionada.
- [x] Actualizadas dependencias transitivas. El servidor queda sin avisos de bun audit. En la web queda el aviso de deepmerge sin versión corregida; el parche local bloquea la clave de prototipo al copiar y fusionar. Se comprobaron la exportación y vista previa XLSX, la compilación PWA y las dos entradas de la prueba de deepmerge.
- [ ] Confirmar en la VM la aprobación de una tarea con un secreto y el rechazo de un artefacto que lo contenga.

## Preguntas del chat y animaciones HyperFrames — PR #183, 4 de noviembre de 2026

- [x] El analizador recibe hasta ocho mensajes anteriores del mismo chat, redactados y acotados a 5600 caracteres. Usa ese contexto para interpretar respuestas breves y evitar repetir preguntas, sin reabrir solicitudes anteriores.
- [x] Los agentes aislados fijan el caché npm en /tmp/telo-npm-cache; la carpeta es efímera y escribible aunque HOME esté oculto. La instalación continúa usando el proxy controlado cuando Telo lo proporciona.
- [~] HyperFrames usage --json muestra cuota de la cuenta del proveedor de IA, no disponibilidad del render. Node.js 22+, Chromium y FFmpeg corresponden al render local; Blender no es requisito general y TTS solo afecta narración. Falta ejecutar doctor --json en la VM después de desplegar para confirmar sus herramientas y acceso a red.

## Publicación, cuotas y Oficina — PR #182, 4 de noviembre de 2026

- [x] Pages reutiliza el token y el ID de cuenta de Proveedores en una publicación estática confirmada desde Telo. El destino existente necesita permiso Pages Edit y la tarea debe conservar sus archivos compilados. La regresión en `claves-proveedor.test.ts` verifica las credenciales y los archivos que recibe Wrangler simulado.
- [x] Los informes reconocen «no se encontraron archivos … en el workspace», orientan a vincular el proyecto o restaurar fuentes y retiran pendientes que pedían copiar el token a variables del workspace. El contrato impide pedir que se salte el sandbox y dirige las instalaciones de OpenCode al proxy controlado de Telo. La actividad del supervisor descarta los fragmentos de texto y conserva las acciones observables. CI del PR #183 aprobada (run 524).
- [x] Un push de cambios ya preparados se planifica con comprobaciones Git. Las advertencias del monorepo sugieren instalar desde la raíz cuando corresponde compilar o probar. Si falta la copia de trabajo, Telo protege la reanudación y redacta rutas internas en los nuevos informes. Cobertura en `comprobaciones-tarea.test.ts`, `plan.test.ts` y `cuota.test.ts`.
- [x] Uso muestra cuota y saldo publicados por cada servicio. Antigravity presenta las ventanas que devuelve su CLI. Ollama consulta los créditos de la cuenta y enlaza sus tarifas vigentes. Casos en `cuota-antigravity.test.ts` y `cuota-ollama.test.ts`.
- [x] Oficina ajusta la altura visible y corrige la orientación de los personajes. Sus apodos se guardan por conversación en la migración 060. La acción de detener usa la cancelación del supervisor para los auxiliares. Verificación con SQLite y Playwright a 390 y 1440 px con datos simulados.
- [x] La actividad de Graphify empieza contraída. Pasaron la comprobación de tipos, el build web, 124 pruebas focalizadas del servidor, 101 de interfaz y el recorrido Playwright de chat y cuotas a 390 y 1440 px. El recorrido local omitió video real por falta de fixture.
- [ ] Validar la publicación de ProgramPulse en la VM después de recuperar su repositorio y comprobar el alcance del token guardado.

## Ajustes de conexiones y skills — 3 de noviembre de 2026

- [~] Conexiones muestra las integraciones externas Meta y búsqueda de empleo/clientes con acceso al formulario MCP genérico. El estado confirma que el MCP está registrado, no que responda.
- [x] Retirado de esta pantalla el catálogo de skills y las sugerencias de Obsidian, Harvey y Orca. Las skills existentes siguen disponibles en su sección de Ajustes; no se borraron skills ni conexiones MCP guardadas.
- [x] Meta no tiene OAuth ni publicación nativos en Telo: la tarjeta explica el requisito de un MCP HTTPS externo que gestione su propia autenticación. CI 41706404816 pasó: pruebas y build web, smoke Playwright y HTML preview; typecheck, suite del servidor y worker aislado.
- [x] `deploy/orquestador-antigravity.conf` sí está versionado. «cannot stat» ocurre antes de systemd: la ruta relativa no existe desde el directorio actual, o el checkout del VM aún no contiene el archivo. `deploy/README.md` ahora usa ruta absoluta y comprueba el archivo antes de instalarlo.
- [~] El catálogo de modelos ya usa el cargador que pasa XDG_RUNTIME_DIR y DBUS_SESSION_BUS_ADDRESS y acepta JSON/texto. Ajustes consulta su endpoint directo y diferencia sesión ausente, errores de login, Secret Service, red, tiempo agotado y catálogo vacío; así el fallo ya no queda oculto como lista vacía. Pruebas y verificación en la VM pendientes. Command Code Go por SSH muestra un callback a localhost de la VM; Ajustes ahora documenta el túnel SSH con el puerto que imprime cmdc y conserva la API key como alternativa headless.

## Catálogo de modelos OpenCode v2 — 3 de noviembre de 2026

- [x] OpenCode 2 retiró `opencode models --verbose`, que Telo todavía exigía. El catálogo conserva compatibilidad con versiones anteriores, consulta `GET /api/model` en un servidor OpenCode temporal limitado a loopback y usa `opencode models` como respaldo si la API local no responde. El selector conserva IDs incluso cuando el CLI solo publica el listado corto; contexto, variantes y precios solo se muestran cuando el catálogo los publica. Un precio ausente nunca se interpreta como gratuito.
- [x] Siete pruebas focalizadas de modelos aprobadas; CI 41744670137 también pasó el typecheck y la suite completa del servidor, el worker aislado, build y pruebas de interfaz. El primer CI falló porque el fixture del broker simulaba `Bun.spawn` pero no la presencia del ejecutable; ahora simula ambos. Checks `servidor` e `interfaz` verdes.
- [ ] Falta desplegarlo en la VM y confirmar allí el catálogo real con la sesión del usuario; el cambio del repo por sí solo no actualiza el servicio.

## Antigravity CLI, Command Code Go y Ollama Cloud — PR #176

- [~] Antigravity: Ajustes inicia `agy` en una terminal remota, muestra únicamente el enlace HTTPS de `accounts.google.com`, recibe el código en la pantalla y comprueba `/usage` más el archivo de sesión que usa el aislamiento. Pruebas sintéticas de host permitido/rechazado y flujo UI a 390/1440 px aprobadas; falta autorizar una cuenta real en la VM. El servicio necesita lingering y el bus de Secret Service configurados con `deploy/orquestador-antigravity.conf`.
- [~] Command Code Go: Ajustes acepta una API key headless cifrada, consulta modelos con `COMMAND_CODE_API_KEY` y la entrega solo al CLI seleccionado. Es autenticación del CLI Go, no de su Provider API. Pruebas de parser, clave headless y UI aprobadas; falta validar la clave de la cuenta real. El saldo oficial sigue consultándose desde `/usage`.
- [~] Ollama Cloud: guarda `OLLAMA_API_KEY` cifrada, consulta `https://ollama.com/v1/models`, llama a `https://ollama.com/v1` mediante el broker con catálogo/modelo permitido y registra el uso de Telo. Pruebas del catálogo, compilación y UI aprobadas; falta probar una clave real. Precio y saldo quedan como desconocidos porque no se encontró una API oficial de saldo/cuota; la cuenta de Ollama sigue siendo la fuente de facturación.
- [x] Interfaz: filas CLI de ancho completo, estado visible «Instalado · falta sesión» y formularios de conexión. Playwright pasó a 390 y 1440 px sin desbordamiento horizontal.
- [x] Verificación final: suite del servidor 706 aprobadas, 100 omitidas y 0 fallidas; `bun run typecheck`, compilación web y `git diff --check` pasan. La prueba Playwright omitió solo el fixture opcional de video.
- [x] CI de GitHub: suite principal 795 aprobadas, 11 omitidas y 0 fallidas; flujo aislado de worker 9 aprobadas y 0 fallidas; checks de servidor e interfaz verdes. El timeout explícito de 15 s evita que Bun corte antes de la espera interna de 10 s.

## Bloqueos de publicación y reintentos — PR #174

- [x] Diagnóstico del intento Cloudflare Pages: ese workspace no tenía `package.json`, lockfile, fuentes ni `dist/`, y el proceso no tenía `CLOUDFLARE_API_TOKEN`. El inicio de sesión en un navegador no se comparte con el servicio aislado; un token tampoco crea el proyecto o los archivos fuente.
- [x] Los informes reconocen los faltantes de workspace/credenciales, marcan `Requiere configuración` y no ofrecen una corrección repetible. La acción de corrección solo aparece en el informe fallido más reciente y desaparece al enviar otro mensaje.
- [x] Una sola reanudación para 5xx/429 transitorios, sin duplicarla si OpenCode ya agotó sus reintentos internos. El obrero se autocorrige una vez como máximo y admite una sola replanificación.
- [~] La publicación directa desde el agente sigue bloqueada por aislamiento. Falta configurar y validar un flujo explícito de publicación en la VM; no se desplegó esta tarea.

## Publicación, modelos visibles y Antigravity — PR #171

- [x] Merge: el token temporal incluye `Contents: write` y `Pull requests: read`; la consulta previa del PR ya no falla por faltar lectura. Las autorizaciones siguen ligadas al SHA. Regresión GitHub App aprobada.
- [x] Seguimiento persistente tras subir o crear PR: consulta GitHub Actions e integración, inicia hasta dos correcciones locales y prepara su aprobación de subida. No ejecuta nuevos commits, pushes o merges sin revisión. Conserva modelo actual y proyecto; la migración 058 guarda el SHA fuente y el workspace lo comprueba antes de editar. Deduplica push→PR, guarda creación y estado en una transacción y recupera las publicaciones de las últimas 24 horas al reiniciar. Doce pruebas focalizadas y prueba Git real de Linux aprobadas (conflicto, rama nueva desde main y rechazo de SHA avanzado, incluido reintento). Los bloqueos externos de cuenta/permisos requieren intervención en el servicio correspondiente.
- [x] Identidad futura de commits: conserva el ID personal verificado por GitHub y usa su dirección noreply con ID para valores predeterminados antiguos; respeta correos personalizados y no atribuye organizaciones a una persona. La metadata antigua se actualiza al emitir el token de la App. Trece pruebas de GitHub aprobadas. No reescribe los commits existentes ni sustituye la vinculación de cuenta/equipo en Vercel.
- [x] Antigravity nativo: catálogo, sesión y runner `antigravity/*`, independientes de Google API; eventos, uso verificable y continuidad por sesión. Perfil aislado, configuración obligatoria de sandbox nativo y credencial SSH montada en lectura, sin copia al perfil. Pruebas sintéticas de catálogo, despacho y uso aprobadas. Keyring sin almacén de archivos no se declara conectado; renovar OAuth puede requerir volver a iniciar sesión por SSH.
- [x] Cloudflare Workers AI: Account ID validado y token cifrado; catálogo oficial y broker con modelo autorizado, sin exponer la clave al agente. Pruebas de credenciales, catálogo y separación de proveedores aprobadas. La asignación diaria gratuita no convierte las tarifas de los modelos en cero ni los habilita como respaldo automático gratuito.
- [x] Ajustes: cada API/CLI permite guardar los modelos visibles; filas compactas para CLIs instalados, acceso a sesión bajo demanda y actualización del catálogo. El selector retira Artificial Analysis y espacia las cabeceras. Tab cambia Construir/Planear sin perder el borrador; Mayúsculas+Tab permite mover el foco. Smoke Playwright a 390/1440 px aprobado: persistencia de modelos tras recarga, exclusión de sesiones en Solo gratis, tarjetas retiradas, sesión bajo demanda y seguimiento de publicación.
- [x] Validación CI Linux en aad0538 (run 41376662899): 763 pruebas de servidor aprobadas, 11 omitidas, cero fallos; worker con Bubblewrap real, 9 aprobadas. Web: 73 aprobadas, build, Playwright con video sintético a 390/1440 px y HTML preview aprobados. La ejecución nativa real de AGY y las cuentas de proveedores no se sustituyen por esta evidencia sintética.
- [ ] VM: validar una respuesta real de Antigravity y que sus herramientas no puedan leer su credencial dentro del sandbox nativo; comprobar formato y ubicación del almacén SSH instalado. Validar Cloudflare con Account ID y token de Workers AI; la sesión Wrangler no sustituye ese token. Confirmar seguimiento real del PR y resolución de sus conflictos/checks. El PR de Gestor-Tareas también muestra un bloqueo externo de identidad en Vercel, que no se elimina cambiando permisos de merge.

## Crear PR con GitHub App — PR #170, corrección de refs legibles

- [x] La instalación de `Telo-Orquestador` ya cubre todos los repositorios y tiene `Contents: Read and write` y `Pull requests: Read and write`. La captura muestra que el commit y push terminaron; el error 422 ocurre después, al crear el PR.
- [x] Causa en el token del PR: se limitaba a `pull_requests:write`; GitHub también necesita `contents:read` para resolver las ramas `head` y `base`. El token temporal ahora pide solo esos dos alcances, sin ampliar escritura del contenido.
- [x] Un `422` con `not all refs are readable` se distingue del caso real `No commits between`. Prueba focalizada: `bun test tests/github-app.test.ts`, 10 aprobadas.
- [ ] VM: desplegar esta corrección y volver a preparar/autorizar la creación del PR pendiente. Verificar que GitHub lo cree usando la App ya instalada.

## Codex CLI y estado de publicación — continuación PR #170

- [x] Codex: `--skip-git-repo-check` ahora va después de `exec`, tanto en ejecuciones nuevas como al reanudar. La causa de la captura era el flag en la posición global, que el CLI rechaza. El sandbox no cambia. Prueba focalizada: `bun test tests/codex-tokens-registro.test.ts`, 6 aprobadas.
- [x] Ajustes: Wrangler y Vercel muestran su versión y estado en «CLIs y herramientas locales». Cuando están instalados, sus guías de instalación/publicación desaparecen; si no están instalados, la guía sigue disponible. El smoke de interfaz cubre ambos estados.
- [x] Gemini/OpenCode: el error «Unexpected server error» de la captura corresponde al HTTP 500 del proveedor. Telo ya hizo tres intentos con el mismo modelo y preservó el modelo seleccionado; no es una falta de permisos local ni se cambia el enrutamiento automáticamente. Requiere una respuesta sana del proveedor o que el usuario seleccione un respaldo.
- [x] Validación local: `bun run build`, 73 pruebas web y 6 pruebas focalizadas de Codex aprobadas. El smoke Playwright no pudo arrancar porque falta Chromium y la red de esta sesión no permite descargarlo; el chequeo visual queda para CI del PR.
- [ ] VM: después del despliegue, probar Codex CLI con una tarea y confirmar la respuesta real de Gemini/OpenCode cuando el proveedor deje de devolver 500.

## GitHub, cuotas de cuenta y acceso a CLIs — rama fix/settings-auth-usage-20261101

- [x] GitHub App: un fallo al emitir el token identifica repositorio, permiso y enlace de configuración; la prueba reproduce 403. En ese momento faltaba instalar la App en el repositorio destino; el usuario actualizó después la instalación a todos los repositorios y concedió lectura/escritura. El 422 de creación de PR se corrige en la sección superior.
- [x] Codex CLI: `exec` y `resume` incluyen `--skip-git-repo-check` dentro del subcomando `exec`, donde el CLI lo acepta. El sandbox y sus permisos permanecen sin cambios. (La corrección de posición del argumento está registrada en la continuación de PR #170.)
- [x] Uso: el panel dejó de duplicar Analytics y no presenta costes o cuotas sin respaldo oficial. Conserva la cuota de sesión de Codex, consulta el balance oficial de DeepSeek y enlaza las consolas verificadas para otros proveedores. Prueba sintética del endpoint DeepSeek y smoke de interfaz aprobados; no se consultaron cuentas reales.
- [x] Ajustes: DeepSeek aparece como motor de inferencia; OpenCode, Codex y Antigravity se presentan una sola vez en herramientas locales; Hermes y xAI quedan ocultos. Antigravity mantiene el login interactivo en su propio CLI por SSH; Telo no recibe el código ni reutiliza esa sesión.
- [x] Validación local: 46 pruebas focalizadas del servidor, typecheck, build web y smoke Playwright a 390/1440 px aprobados. El smoke no hace llamadas a proveedores reales; la captura de video se omitió por no configurar un fixture.
- [ ] Pendiente en VM: desplegar PR #169 y esta corrección de lectura de refs; después volver a preparar y autorizar el PR desde `Gestor-Tareas`. La instalación ya cubre todos los repositorios y tiene permisos de lectura/escritura. Verificar Antigravity y el acceso OAuth de OpenCode manualmente en la terminal SSH del usuario `orquestador`.

## Correcciones de chat, cuotas y broker — PR #168, 1 de noviembre de 2026

- [x] Codex: reproducido el error de Bubblewrap de la captura. Se usaba como origen una ruta que solo existía dentro del sandbox. El montaje ahora toma el archivo real del host y conserva autenticación/configuración en solo lectura. Prueba con Bubblewrap real: ambos alias se leen, no se pueden escribir, el estado del perfil sí se escribe y la autenticación no se copia al perfil persistente.
- [x] Atajos Git: siete consultas normales que empezaban por commit/push/pr/pull request llegan al agente. Se mantienen las órdenes explícitas y la aprobación existente, incluidos «git commit sin push» y «prepara de nuevo el git commit y push». Regresiones de rutas y acciones Git aprobadas.
- [x] Gemini: RESOURCE_EXHAUSTED/429 por minuto o ambiguo usa los reintentos del mismo modelo; no marca cuota agotada. Los límites diarios, saldo insuficiente y límites cero conservan el tratamiento de cuota. El código HTTP también se obtiene de error.code. Prueba de ejecución con error Google estructurado y éxito posterior: dos llamadas al mismo modelo, sin memoria de cuota agotada. Los avisos históricos no se reescriben.
- [x] Contexto: el medidor incluye el último uso de analizador/obrero del chat de proyecto y excluye revisores independientes. Compartir contexto y su listado solo consideran otros chats raíz del proyecto; varios subagentes propios ya no desplazan al chat vecino. Regresiones SQL/API y composición del prompt aprobadas.
- [x] Precios: un catálogo sin precios completos, finitos y no negativos se muestra como «Precio no disponible», no como gratis. No entra en respaldos por cuota ni en el respaldo por fallo de proveedor con precio desconocido. Se conserva selected como política por defecto. Pruebas de catálogo, candidatos, formato y filtro Solo gratis aprobadas; selector revisado a 390 y 1440 px.
- [x] Broker: admite la ruta Google de Gemini en Zen y APIs directas DeepSeek/xAI con claves por proveedor; verifica el modelo autorizado y conserva las claves reales en el servidor. Las sesiones OAuth de OpenCode sin broker específico y los proveedores sin ruta no se ofrecen bajo aislamiento. Codex nativo conserva su sesión; una sesión OAuth no se interpreta como API key. Pruebas con transporte sintético y socket Unix real para las cuatro rutas, cabeceras, claves, modelo ajeno y catálogo aprobadas.
- [x] Espera: se elimina el corte de 120 s sin bytes para inferencia; la espera inicial útil de tres minutos y la cancelación del runner siguen vigentes. La web pública mantiene su timeout. Prueba del broker confirma timeout de inferencia desactivado y destrucción de la conexión al cancelar antes de una respuesta.
- [x] Validación: suite única Linux 726 aprobadas, 11 omitidas y cero fallidas; worker separado con Bubblewrap real: nueve aprobadas. Después del ajuste final de filtrado de claves, 36 pruebas focalizadas aprobadas. Web: 73 aprobadas; typecheck del servidor y build aprobados. Playwright a 390/1440 px con MP4 real aprobado; sin consumo de proveedores reales. El aviso previo de tamaño de paquetes sigue presente.
- [ ] Pendiente confirmar en la VM desplegada el inicio de Codex con su sesión y las respuestas reales de las APIs que se utilicen. No hay acceso remoto en esta sesión. Tras merge/despliegue ejecutar deploy/verificar-agentes.sh y reintentar la tarea fallida; no crear manualmente /tmp/telo-codex-global/auth.json ni otra clave. OAuth de OpenCode sin broker y endpoints personalizados siguen sin soporte, ocultos bajo aislamiento.

## Referencias visuales, Planear y optimización — PR #167, 1 de noviembre de 2026

- [x] Planear/Construir en el compositor y /plan: migración 057 aditiva, build por defecto y modo guardado por mensaje/tarea. Planear fuerza solo lectura en el punto común, bloquea secretos operativos y aprendizaje, termina después del analizador y no pasa por aprobación ni obrero. Construir conserva el flujo actual. Prueba Linux con Bubblewrap real: nueve escenarios del worker aprobados, incluido un plan con operaciones Git propuestas sin ninguna acción de publicación creada; regresión de cola conserva el modo original.
- [x] Referencias visuales: guía de diagnóstico para «arregla esto», archivos de solo lectura para ambos runners, selección del turno actual y reutilización explícita del historial. No reenviar capturas irrelevantes. Capacidad visual tomada de metadatos declarados (formatos v1/v2); si es falsa, detener antes de la inferencia sin sustituir modelo. La capacidad desconocida no se afirma como verificada. Pruebas de aislamiento entre chats, recepción de archivos y veto de un modelo de texto aprobadas.
- [x] Video de referencia: seis muestras, tiempos, duración y resolución, con límite de espera de metadatos. No se envían audio ni clip completo. Playwright a 390/1440 px con MP4 real: decodificación, subida y apertura de la hoja enviada aprobadas; hoja revisada visualmente. El fixture reutilizaba IDs de mensajes y podía validar una imagen anterior: ahora usa IDs únicos, sirve el archivo real y espera la imagen exacta. CI genera además una referencia sintética.
- [x] Skills: una guía principal automática para video/interfaz; documentos grandes bajo demanda, deduplicación del cuerpo, máximo ocho guías y presupuesto de 16.000 caracteres (8.000 por cuerpo). El contenido dentro de adjuntos no activa skills. El contrato común resume ahorro Caveman lite/Ponytail y conserva estructura, español, permisos y evidencia, bajo 2.000 caracteres. Regresiones de resolución y contexto aprobadas.
- [x] RTK OSS 1.1.0: instalador con SHA-256 fijado, sin scripts remotos, sin sobrescribir otra versión; instalación e idempotencia comprobadas como usuario sin privilegios en Linux. Plugin OpenCode envuelve comandos simples compatibles; conserva composición y formatos de máquina. Codex recibe la disponibilidad real y la guía de uso; sus lecturas nativas no pasan por el plugin. RTK real dentro de Bubblewrap conserva un fallo de prueba y su evidencia. No se promete un porcentaje de ahorro ni se cambia el proveedor.
- [x] Espera inicial del proveedor limitada a tres minutos en ambos runners: busy/latidos/reintentos no demuestran progreso; texto, generación observada e inicio de herramientas sí. Sesión y archivos se conservan al cortar. Regresiones Linux para espera infinita, sesión recuperable y herramienta larga aprobadas. Este límite cubre la primera actividad útil, no toda la duración posterior.
- [x] Validación: suite unificada Linux 714 aprobadas, 11 omitidas, cero fallidas; después de los últimos casos de cola y adjuntos, 69 pruebas focalizadas aprobadas. Worker separado: nueve aprobadas. Web: 72 aprobadas, typecheck servidor y build aprobados. Smoke visual a 390/1440 px con referencia real aprobado. Aviso previo de tamaño de paquetes conservado.
- [ ] Pendiente despliegue y diagnóstico con el proveedor real de la VM. El corte nuevo no modifica procesos antiguos ya iniciados; detener el chat atascado antes de actualizar. Instalar RTK sin sudo y ejecutar deploy/verificar-agentes.sh tras recibir el cambio. Antes de revertir a código anterior, terminar o cancelar tareas Planear pendientes, pues ese código no conoce su restricción.

## Respeto del modelo elegido y auditoría de consumo — PR #166, 1 de noviembre de 2026

- [x] El resumen real de la VM aportado por el usuario sitúa el último consumo registrado de DeepSeek antes del primer uso de Gemini del periodo examinado. Predominan registros históricos sin rol. Esa tabla no acredita llamadas simultáneas ocultas; los intentos rechazados sin tokens tampoco se deducen de ella.
- [x] Se corrige el aviso: identifica la ejecución anterior pausada y el modelo seleccionado para continuar. Cambiar el selector no se presenta como si ya se hubiese reanudado la tarea.
- [x] Solo el modelo elegido por defecto, incluso con respaldos antiguos guardados. La política selected/configured/automatic exige elección explícita para sustituir por cuota o 5xx; las listas anteriores se conservan inactivas. Los agentes internos de OpenCode quedan fijados al modelo del turno; títulos y resúmenes internos innecesarios se desactivan.
- [x] Se reproduce y corrige el doble registro de un evento de uso repetido: los IDs estables de sesión/paso deduplican tanto el stream como el agregado y la persistencia, también al reanudar. Se conservan dos pasos distintos con contadores iguales. No se modifica el historial: sin IDs antiguos no puede acreditarse qué filas eran duplicadas ni atribuir los totales a este defecto.
- [x] Suite unificada Linux: 704 aprobadas, 10 omitidas y 0 fallidas. Pruebas focalizadas locales: 13 aprobadas para preferencias, elección de candidatos, configuración de modelos internos e idempotencia; web: 72 aprobadas. Typecheck del servidor y build aprobados.
- [ ] Pendiente confirmar el aviso y el modelo efectivo tras desplegar en la VM. La tabla histórica no demuestra que otros modelos consumieran durante el turno de Gemini ni equivale a una factura del proveedor.

## Continuidad automática por cuota — PR #165, 1 de noviembre de 2026

- [x] Con política configured, el punto común prueba solo los respaldos guardados y el respaldo general si es gratuito o de una sesión Codex elegida. La política automatic añade hasta tres modelos gratuitos con precio explícito de proveedores conectados, priorizando proveedores distintos. selected es el valor predeterminado y no sustituye modelos. Los modelos de pago y de precio desconocido no entran automáticamente; no se hacen llamadas de sondeo a modelos.
- [x] Una cuota confirmada se recuerda en app_settings por modelo y proyecto durante 15 minutos, sobrevive reinicios y evita volver a gastar intentos durante la pausa. No se inventa saldo ni se atribuye la cuota de un modelo a los demás. Una respuesta válida retira su pausa; al caducar se puede comprobar de nuevo.
- [x] Chats, analizador, obrero y revisores comparten la sustitución. Los cambios se muestran en actividad; uso y sesión siguen ligados al modelo que ejecutó. La migración 056 conserva por separado modelo solicitado y modelo real de cada revisión para reutilizarla tras cambiar de proveedor.
- [x] Pruebas: suite unificada Linux con 698 aprobadas, 10 omitidas y 0 fallidas; 13 pruebas focalizadas de cuota, continuidad y reanudación aprobadas; integración adicional del worker con Bubblewrap real: 8 aprobadas. Web con 72 aprobadas, typecheck del servidor, build y smoke a 390/1440 px aprobados. Se comprobó la recuperación tras credencial rechazada o saturación temporal de un respaldo, la sesión nueva entre proveedores, el límite de tres alternativas y la cancelación sin llamadas adicionales.
- [ ] Validación operativa pendiente tras desplegar: agotamiento real de OpenAI/Codex y continuidad con los proveedores conectados de la VM. Las pruebas sustituyen los proveedores; tener credencial y precio gratuito en el catálogo no acredita saldo ni éxito de una llamada real.

## Modelo y estados de los auxiliares — PR #165, 1 de noviembre de 2026

- [x] La migración 055 deja los chats existentes y nuevos en herencia del modelo seleccionado. Conserva la lista antigua sin utilizarla; activar «Usar modelos diferentes para los auxiliares» y guardar es necesario para usarla. El panel deja de rellenar modelos gratuitos automáticamente.
- [x] Chats libres y tareas de proyecto comparten esa elección. La integración del worker confirma tres revisores Gemini aun con OpenCode guardado, y conserva la selección personalizada cuando se activa expresamente. Una regresión del chat confirma que cambiar de modelo cambia los tres revisores del turno siguiente; 61 pruebas focalizadas aprobadas. No cambia el requisito de pedir agentes en el mensaje actual.
- [x] El panel reconoce «falló tras…», revisiones reutilizadas y cancelaciones. Un error de herramienta recuperable no termina el auxiliar; acciones tardías no reactivan uno finalizado. Cuatro regresiones web aprobadas.
- [x] Verificación local: suite unificada Linux con 690 aprobadas, 10 omitidas y 0 fallidas; integración adicional del worker con Bubblewrap real: 8 aprobadas. Web: 71 aprobadas, typecheck del servidor, build y smoke a 390/1440 px aprobados. Los proveedores se sustituyen por fixtures; no acredita respuesta real de Gemini. El build conserva el aviso de tamaño y el smoke omite decodificación de video sin fixture.
- [ ] Tras desplegar, probar un turno nuevo con Gemini y una petición explícita de varios agentes; comprobar tres revisiones del modelo elegido y su uso. Los turnos ya iniciados conservan su configuración de ejecución.

## Revisión del flujo de chat, aislamiento y despliegue — PR #164, 1 de noviembre de 2026

- [x] Linux local (Ubuntu 24.04, Bun 1.4.2): suite unificada con 689 pruebas aprobadas, 10 omitidas y ningún fallo en 89 archivos. Integración adicional del worker: 8 aprobadas con Bubblewrap real. Web: 67 aprobadas; typecheck del servidor y build web aprobados. Smoke UI aprobado a 390 y 1440 px; decodificación de video omitida sin fixture. Además, 11 pruebas de red y aislamiento aprobadas como usuario Linux sin privilegios. El build conserva el aviso de tamaño de paquetes.
- [x] Delegación solo por petición explícita: chats libres y de proyecto comparten auditoría gestionada; sin configuración guardada se usan hasta tres revisores del modelo elegido. Los encargos, modelos y acciones se publican, las etapas terminadas se reutilizan y el obrero queda único. Prueba: worker-turnos, incluido chat sin Supervisor guardado y petición directa posterior.
- [x] Skills seleccionadas por la solicitud actual, no por menciones del historial; se descartan documentos inválidos y de otros proyectos. UI/UX Pro Max conserva sus recursos y ruta por proyecto. Pruebas: resolucion-skills, ejecucion-contexto, skills-proyecto y montaje real de solo lectura en aislamiento.
- [x] Perfiles independientes por turno y rol, retirados al terminar. Los análisis no reciben secretos operativos ni MCP configurados ajenos al endpoint oficial de Context7. Pruebas: ejecucion-contexto, entorno-proveedores y conexiones-mcp.
- [x] Red y loopback separados por ejecución, /run oculto y egreso mediante proxy Unix. Bloqueo de privados/metadata/IPv6 local y fijación de IP tras resolver. Prueba real de namespace y broker: red-agente.test.ts; incluye rechazo de modelos no autorizados y ausencia de claves reales en montajes.
- [x] Broker de claves OpenCode para las integraciones API admitidas: el agente recibe una clave sustituta y Telo añade la real solo en rutas de inferencia y modelos del turno. OAuth y endpoints no implementados fallan cerrados. OpenCode 1.19.5 real arrancó a través del broker y llegó a Zen; el modelo gratuito devolvió cuota agotada. No se confirmó una respuesta final con credenciales reales.
- [x] Perfil Codex escribible, sin bypass del sandbox y con comprobación de política administrada; también al entrar de respaldo. Resume conserva perfil, modo y contadores. Pruebas: codex-tokens-registro y tokens-codex. La sesión real del usuario requiere validación en VM.
- [x] Uso atribuido a integración y modelo reales, coste cero conservado y espera de reintentos cancelable. Los mensajes finales de hijos nativos generan uso por rol/sesión, sin duplicar eventos (migración 054). Se corrigió la ruta de captura oculta del plugin: prueba ejecutando el plugin dentro de Bubblewrap y persistencia idempotente en subagentes-chat.
- [x] Reanudación rechaza enlaces maliciosos en perfiles. La sincronización de skills deja de fallar silenciosamente: retira copias obsoletas a DATA_DIR/skills-retiradas, conservando cambios locales. Un clon legado con skill versionada sin manifiesto se bloquea para revisión. Prueba: skills-seguras y aislamiento, ejecutadas en Linux.
- [x] Diagnóstico operativo: deploy.env existe pero systemctl no declara EnvironmentFiles. Se añade configurar-actualizador.sh para instalar las unidades que cargan el PAT existente, sin reiniciar Telo. verificar-agentes.sh permite repetir pruebas sintéticas en VM sin llamadas de pago. Sintaxis de shell y comprobaciones de despliegue incluidas en CI.
- [x] Se elimina una dependencia circular del registro de uso y se corrige una prueba de paginación que asumía menos de 50 conversaciones. La suite unificada confirma ambas regresiones.
- [x] El usuario confirmó despliegue de 22cdb34 en su VM y configuración del actualizador con PAT de Actions de solo lectura. verificar-agentes.sh terminó con 26 pruebas aprobadas y 8 de integración del worker, sin fallos, y typecheck aprobado.
- [ ] Pendiente en la VM del usuario: probar arranque/resume con sus sesiones reales y cuotas disponibles. Las comprobaciones sintéticas no acreditan respuestas reales de cada proveedor. No se dispone de acceso SSH a esa VM desde esta sesión.
- [ ] Pendiente de compatibilidad: brokers para OAuth de OpenCode y endpoints personalizados, y validación operativa de cada proveedor con credenciales reales. El egreso web público sigue permitido; el broker no es una política de autorización de todas las acciones externas.

## Skills de diseño y desarrollo — 1 de noviembre de 2026

- [x] Se agregan Code Review y Writing Plans al catálogo global de arranque; TDD y Systematic Debugging ya estaban incluidos. El importador reconoce sus nombres y el alias escrito `writting-plans` resuelve a `writing-plans`.
- [x] Ajustes > Conexiones permite instalar UI/UX Pro Max y las skills de revisión, planes, TDD y depuración desde sus repositorios fuente. UI/UX Pro Max importa la guía, reglas, datos y cuatro scripts permitidos, con límites de tamaño y rutas; no ejecuta contenido durante la instalación.
- [x] El resolver activa cada skill por tipo de tarea o mención explícita, evitando cargar los flujos de planes/TDD cuando no aplican. Writing Plans y Code Review incluyen una nota para respetar aprobaciones y límites de Telo.
- [x] Verificación local: 38 pruebas enfocadas aprobadas; typecheck del servidor y build de producción web aprobados.
- [ ] Falta validar la instalación y ejecución en la VM Linux después del despliegue.

## Piloto de ejecución directa y auditoría delegada — 31 de octubre de 2026

- [~] La ruta directa sigue siendo la predeterminada: la delegación solo corre si el usuario la pide explícitamente y el chat tiene la orquestación gestionada habilitada. La rama gestionada ya no crea perfiles nativos como alternativa oculta; si no hay revisores configurados, continúa con el supervisor.
- [~] La auditoría gestionada por Telo acepta hasta tres revisores de roles distintos (arquitectura, seguridad y verificación), aislados en solo lectura. Los perfiles nativos de OpenCode, cuando se usan con delegación explícita, tienen permisos limitados a lectura y búsqueda; no pueden ejecutar shell, escribir ni delegar de nuevo.
- [~] Se persiste cada revisión gestionada por mensaje de origen. Al reanudar el mismo pedido se reutilizan las etapas completadas que conservan modelo y rol; fallos e interrupciones vuelven a ejecutarse. OpenCode todavía no expone aquí checkpoints ni uso individual de cada subagente; para medir el piloto, activa el Supervisor gestionado de Telo.
- [~] El panel «Ver proceso» muestra llamadas, tokens medidos/estimados, coste estimado y desglose por supervisor/revisor e integración/modelo. No presenta el coste estimado como facturación real; los proveedores que no informan uso quedan marcados como no verificables. El alcance es el turno del chat, no el saldo de la cuenta del proveedor.
- [~] La oficina invalida su lista por eventos de inicio/finalización/configuración y conserva un sondeo de respaldo cada 30 s. Sus animaciones siguen siendo locales y no generan llamadas de modelo.
- [x] Verificación local: `server bun run typecheck`, `web bun run build`, `web bun run test:ui` en 390/1440 px y las pruebas focalizadas (44 aprobadas, 17 omitidas) pasan. La suite completa pasó con 598 aprobadas, 71 omitidas y 0 fallidas; el smoke no incluyó decodificación de video porque no se configuró un fixture local.
- [~] La suite del worker con bubblewrap y la comparación de auditoría directa vs delegada con un proveedor real siguen pendientes de CI Linux y del despliegue en la VM. Este equipo no tiene WSL, Docker ni acceso a la VM.
- [ ] Piloto pendiente: comparar manualmente una auditoría directa y otra delegada sobre el mismo repositorio; revisar cobertura/evidencia, duración, tokens por modelo y revisiones reutilizadas. Validar migración y comportamiento en Linux/VM antes de desplegar.

## Presentación de respuestas del chat — 31 de octubre de 2026

- [~] Se refuerza el contrato del chat para responder en el idioma del usuario y omitir razonamiento privado, borradores y notas internas. No se añadió un filtro heurístico que pueda borrar respuestas válidas. Pendiente validar en la VM con una tarea larga.
- [x] Las respuestas de trabajos largos y skills ahora deben usar títulos y listas legibles. En solicitudes de video, Telo valida que el MP4 exista y pueda servirse, enlaza el archivo y, si falta, hace un único intento de recuperación en la misma sesión; si no lo consigue, declara la entrega incompleta. CI Linux del PR #161 pasó en servidor e interfaz, incluida la suite unificada y sus pruebas de integración. Pendiente verificarlo en la VM con un render real.
- [~] La primera columna de tablas queda compacta y sin salto por carácter; las tablas anchas conservan el desplazamiento de su contenedor. Pendiente revisión visual en escritorio y móvil.

## Calidad de video, actividad y analíticas — 31 de octubre de 2026

- [~] Las solicitudes de video activan una guía breve de diseño: jerarquía tipográfica, paleta, contraste móvil, ritmo, transiciones y revisión de fotogramas; exige enlazar el MP4 final. Revisé visualmente muestras del usuario: tienen identidad y composición consistentes, pero algunos intermedios son demasiado oscuros; la guía pide evitarlos.
- [~] El proceso del chat diferencia supervisor y subagentes con iconos y separación visual, incluidos los pasos de herramientas.
- [~] El volumen permite filtrar un rango de fecha y hora, agrupar por día, hora o minuto y consultar peticiones/tokens por modelo. Los intervalos se agrupan en UTC; el rango seleccionado usa la hora local del navegador.
- [~] Analíticas presenta el equivalente a tarifa API pública por modelo solo con tokens medidos y tarifas conocidas; diferencia coste registrado y equivalencia, que no representa facturación real.
- [x] Verificación local: typecheck del servidor, pruebas focalizadas de analíticas y skills de video, build y smoke visual en 390/1440 px aprobados. El smoke omite decodificación de video porque no se configuró un fixture para esa prueba.
- [ ] Pendiente: confirmar en la VM filtros con uso real, tarifas que el catálogo no publique y render/entrega real de video.

## Selector y oficina — 31 de octubre de 2026

- [~] Selector: integraciones plegadas inicialmente, identificación compacta y barra accesible de esfuerzo con confirmación. Mantiene proveedor en modelos destacados.
- [~] Oficina: plano 2D con personajes y mobiliario; el descanso se anima localmente y el control de Jev se retira de esta pantalla.
- [~] Cerebro: mapa de chats y proyectos basado en pertenencia real, separado del mapa de enlaces de notas. No es un grafo semántico de Graphify.
- [~] El catálogo de OpenCode deja de bloquear indefinidamente la creación de tareas: se limita la espera y se consume también stderr. La causa concreta de la demora reportada requiere registros de la VM.
- [ ] Pendiente calcular equivalentes de API para suscripciones con precios y modelos verificables, y confirmar el coste y cuota reales con cada proveedor.
- [~] La oficina muestra todos los chats y utiliza una hoja de personajes aportada por el usuario; las nuevas salas son una maqueta. Quedan pendientes el modo Planear/Construir real, nombres de agentes, rutas y animaciones hacia reuniones y validación visual.

## Seguridad, despliegue y estado operativo — 31 de octubre de 2026

- [~] Seguridad: `TELO_SIN_CLAVE` exige escucha loopback y rechaza solicitudes con host no local o cabeceras de proxy. No usarlo detrás de un proxy que elimine esas cabeceras; validar en Linux y VM. `.gitignore` ya excluye extensiones habituales de llaves privadas.
- [x] Instaladores: OpenCode y Codex usan versiones exactas; Antigravity se descarga por HTTPS a un temporal, con límite de tamaño y validación `bash -n` antes de ejecutarse. El proveedor no publica checksum/firma del script, así que queda explícito el límite de verificación del contenido.
- [~] Despliegue: `actualizar.sh` consulta la API de Actions para el SHA exacto de `main` y exige que el último workflow de push tenga `servidor` e `interfaz` verdes. Usa PAT fine-grained con `Actions: Read-only` (el permiso Checks no existe para esos PAT) y lo quita del entorno antes de compilar. Pruebas locales específicas pasan; falta guardar el PAT en `/etc/orquestador/deploy.env` y observar un ciclo real en la VM.
- [x] Suite unificada: el CI corre `bun test --timeout 60000 --max-concurrency=1` en un solo proceso Linux, además de worker, typecheck, build, pruebas web y Playwright. Los checks `servidor` e `interfaz` del PR #159 pasaron. Los 89 fallos de la ejecución Windows anterior no representan el resultado Linux y no se trasladaron a CI.
- [ ] Dependencias: el último `bun audit` no pudo consultar `registry.npmjs.org` por `DNSResolveFailed`; el informe previo señalaba 11 avisos, pero no hay una lista actual verificable por paquete. Repetir en una red con acceso y actualizar solo dependencias afectadas con lockfile y CI.
- [ ] Aislamiento de red de agentes: requiere un proxy de egreso que permita proveedores sin exponer servicios locales; no activar `--unshare-net` mientras no exista esa ruta.
- [x] Higiene: se asignaron los 24 PR históricos consultando los commits que introdujeron cada entrada. `styles.css` y `styles-chat.css` se dividieron en hojas temáticas menores de 1.500 líneas; el build de antes y después produjo exactamente los mismos SHA-256 para `index.css` y `chat.css`. `pages/chat.tsx` tiene 2.487 líneas, por debajo del umbral señalado.
- [~] La ejecución registra tiempos de preparación del workspace y de primera salida del agente; falta desplegar y medir una reanudación real para identificar y corregir su causa.
- [~] Auditoría del 31/10: `bun audit` informa 1 aviso moderado en servidor y 10 en web (6 moderados, 4 bajos). La suite única en Windows produjo 509 aprobadas, 73 omitidas y 89 fallidas; no es comparable con los cinco fallos observados en Linux. Pruebas focalizadas del filtro local y typecheck del servidor aprobados.
- [~] El cerebro permite importar durante la sesión un graph.json de Graphify, explorar sus nodos y consultar el archivo de origen; la importación no indexa automáticamente los proyectos ni persiste el grafo.
- [~] El selector compacta precio e índice, muestra opciones de esfuerzo y amplía coincidencias no ambiguas por nombre; falta validar cobertura contra el catálogo real y el flujo en la VM.
- [x] HyperFrames: el usuario confirmó `hyperframes browser ensure` listo, `doctor` en 0.8.225 y actualización de las cuatro skills principales. Whisper, TTS Kokoro y MusicGen son opcionales; no se instalan sin una necesidad concreta y evaluación de recursos.
- [~] Integraciones plegadas por defecto, selector de esfuerzo en barra, oficina pixelada y mapa de chats agrupados por proyecto. Validación local de interfaz a 390 y 1440 px; faltan casos reales en VM.
- [~] El catálogo de OpenCode tiene un límite de espera y consume stderr para evitar esperas indefinidas. La causa del retraso reportado requiere registros de la VM.
- [ ] El mapa de chats muestra pertenencia, no relaciones semánticas Graphify. Queda pendiente integrar indexación por proyecto y recuperación de contexto, así como equivalentes de precio fiables para sesiones de suscripción.

## Oficina y cerebro — 31 de octubre de 2026

- [~] La oficina presenta conversaciones principales y subchats existentes; las animaciones son decorativas y no crean agentes. Pendiente revisión visual y operativa en la VM.
- [~] El baúl interno admite notas Markdown globales y por proyecto, búsqueda local, importación de archivos y mapa de enlaces. No introduce notas en los prompts ni reduce tokens automáticamente.
- [ ] Pendientes: importación y exportación del baúl completo conservando carpetas, selección de notas relevantes con presupuesto de contexto, creación de agentes desde la oficina y validación en dispositivos.

## Oficina interactiva — 31 de octubre de 2026

- [~] La vista agrupa conversaciones por supervisor y muestra subchats registrados; la selección abre el chat real. El plano pixelado es una representación local y no crea agentes ni actividad. Pendiente verificar con conversaciones reales y accesibilidad visual.
- [~] Vista inicial de tareas reales con acceso a cada tarea, actualización periódica y movimientos locales sin llamadas a modelos. Pendiente comprobar visualmente en móvil y escritorio y validar en la VM.
- [ ] Añadir subagentes reales, acceso a sus chats, notificaciones y salas de tarea; no representar como actividad real los movimientos decorativos.
- [~] La oficina permite pedir una elección puntual a Jev, con una consulta por minuto, registro separado de intentos y tokens informados, y una estimación indicativa según la tarifa pública. La animación básica no necesita proveedor. Faltan prueba real de Jev y comprobación de la migración en Linux.

## CI del PR #154 — 31 de octubre de 2026

- [x] El fallo de `servidor` no era latencia: `server/tests/uso-agente.test.ts` encontró que el contrato común de cada llamada tenía 2.140 caracteres y excedía el tope de 2.000.
- [x] Se compactó sin quitar las reglas que comprueba el test: localmente el contrato queda en 1.660 caracteres (480 menos, ~22 %). `bun test tests/uso-agente.test.ts` y `bun run typecheck` pasan localmente.
- [x] Publicada la corrección en #154. En la rama del PR quedó en 1.811 caracteres y conserva la regla de persistencia de recursos entre reinicios; commits `dcdf4b2` y `068da05`.
- [x] GitHub terminó `servidor` e `interfaz` para `068da051a480ede17b18544675a65e8d1d5d26a4`: ambos pasaron y la rama es integrable. Queda una advertencia de mantenimiento de GitHub Actions: `checkout@v4` y `upload-artifact@v4` migran de Node 20 a Node 24; no afecta el resultado del CI.

## Delegación explícita al continuar chats — 31 de octubre de 2026

- [x] La solicitud de usar auxiliares queda asociada al mensaje raíz. Los mensajes «Seguir donde se quedó» heredan ese origen solo mientras no exista una respuesta final; una petición nueva no hereda permisos antiguos.
- [x] Los auxiliares gestionados por Telo consumen el origen al terminar su análisis. Los perfiles nativos solo lo consumen al observar el evento `created`; preparar una configuración no cuenta como agente iniciado.
- [x] Añadida cobertura unitaria que corre en Windows y una prueba de turno completo para CI Linux.
- [ ] Falta confirmar el caso en la VM tras desplegar el cambio; la conversación «Top skills» sigue activa y no se debe detener para probar el fix.

## Piloto del cerebro interno compatible con Obsidian — 31 de octubre de 2026

- [x] Decisión: baúl Markdown administrado por Telo, sin instalar Obsidian en la VM. Las notas se importan por lotes desde archivos `.md`, se exportan como `.md` y admiten enlaces `[[nota]]`.
- [x] Primera fase del piloto: notas globales y por proyecto, edición con límite de 48 KB, búsqueda léxica local y mapa clicable de enlaces existentes. El grafo se calcula sin modelos. Las notas son manuales; la memoria automática de proyecto y los documentos de chat permanecen separados.
- [ ] Pendiente del piloto: exportar/importar un baúl completo como carpeta o archivo, preservar carpetas de Obsidian y revisar la experiencia en la VM.
- [ ] Segunda fase: recuperar únicamente las notas relevantes al chat/tarea dentro de un presupuesto corto de contexto; mostrar qué notas se incluyeron. Sin llamadas a modelos para generar el grafo ni para seleccionar notas.
- [ ] Tercera fase: evaluar un mapa de código opcional (Graphify) y una vista de oficina que represente eventos reales de tareas y auxiliares. No simular actividad.
- Riesgo a controlar: no mezclar memoria aprendida, documentos por chat y notas globales/proyecto; respetar el workspace y el aislamiento de cada proyecto.

## Cuotas, uso de API y respaldo automático — 31 de octubre de 2026

- [x] El panel «Uso» consulta la cuenta local de Codex CLI por el App Server oficial y muestra plan, ventanas de uso, porcentaje restante, reinicios y hora de restablecimiento cuando Codex los entrega. La consulta es local, tiene tiempo máximo y caché de un minuto; no muestra correo ni credenciales.
- [x] OpenAI API queda diferenciada: el plan de ChatGPT/Codex y la facturación de API son distintos. El panel de Codex muestra la cuota de sesión; las llamadas de API siguen en el registro de uso de Telo y no se suman a la cuota Plus.
- [x] Antigravity incluye el comando interactivo `/usage` para consultar cuota por modelo. La CLI no documenta una API estructurada de cuota para que Telo la lea. La cuota de Antigravity/Google AI Plus es distinta del consumo de Gemini API; el panel de Google enlaza a la página de uso de AI Studio.
- [x] Ajustes permite crear una lista ordenada de hasta 20 modelos gratuitos del catálogo y modelos de la sesión Codex. Ante una respuesta inequívoca de cuota agotada, Telo intenta la lista sin cambiar a modelos con coste de API; informa el cambio en actividad y registra el uso bajo el modelo que realmente respondió. Si todos fallan por cuota, conserva el comportamiento de pausa reanudable.
- [x] Anthropic se explica como uso de API registrado por Telo; no se presenta como acceso al saldo Claude.ai/Claude Code. La suscripción de Claude y el consumo de API se facturan por separado.
- [ ] Pendiente de validar en la VM: lectura real de `account/rateLimits/read` con la sesión Codex del servicio, porcentajes y horarios de reinicio. Si systemd no comparte el login de Codex del usuario `orquestador`, el panel debe indicar que no hay sesión disponible.
- [ ] Pendiente de prueba operativa: agotar cuotas de forma controlada para demostrar que el turno avanza al siguiente modelo, mantiene el workspace/historial, registra el proveedor real y se detiene reanudable al terminar la lista. No provocar agotamiento real de cuota solo para probarlo.
- Fuentes primarias: [Codex App Server (cuenta y rate limits)](https://learn.chatgpt.com/docs/app-server), [reinicios y límites de Codex](https://help.openai.com/en/articles/20001498-how-resets-work-in-codex), [uso de Antigravity CLI](https://antigravity.google/docs/cli/commands/usage?app=antigravity-ide), [facturación de Gemini API](https://ai.google.dev/gemini-api/docs/billing), [separación entre Claude y API](https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan).

## Catálogo del chat por integración — 31 de octubre de 2026

- [x] **Codex ya aparece y ejecuta modelos desde el chat.** El repositorio contiene el runner `codex exec`, `GET /api/providers/codex/models` y la consulta de catálogo de la sesión. Por tanto, la nota de fase 3 que decía «los agentes todavía no usan Codex» ya no describe el código actual; era un estado histórico.
- [x] El selector separa los catálogos por integración (`Groq API`, `NVIDIA API`, `OpenRouter`, `OpenAI API`, `OpenCode`, etc.) y permite plegar cada lista. Codex queda en su propia sección: **Codex CLI · sesión de ChatGPT**. OpenAI API es una conexión distinta y sigue usando su clave API.
- [x] Corregido el estado de Codex: el runner usa el login del CLI y no `OPENAI_API_KEY`; la sesión conectada habilita sus modelos sin etiquetarlos como catálogo informativo. La lista dedicada ya no duplica Codex que también aparece en `/api/models`.
- [x] «Solo gratis» omite Codex y el contador lo refleja, porque el uso de la sesión depende del plan y su cuota, no de que el catálogo marque coste API cero.
- [ ] Este cambio comprueba el comportamiento del código y el catálogo configurado en el servidor; la prueba de inicio de sesión y ejecución real debe repetirse tras desplegarlo en la VM.

## Instalación de Antigravity CLI — 31 de octubre de 2026

- [x] Ajustes permite instalar el CLI oficial (`agy`) desde la VM en `~/.local/bin`. La instalación usa el comando oficial sin opciones que el script no admite; la API solo acepta el identificador fijo `antigravity` y requiere confirmación explícita.
- [x] Corregidos `--skip-aliases` y `--skip-path`: la CLI 1.4.12 instalada en la VM confirmó que el script solo acepta `--dir` y `--help`.
- [x] La tarjeta junto a Codex explica el acceso OAuth soportado por SSH: iniciar `~/.local/bin/agy` en terminal interactiva como `orquestador`, abrir la URL en el equipo y devolver el código a esa terminal. La sesión no se transmite a Telo.
- [ ] Este cambio solo instala y guía el inicio de sesión. Antigravity aún no ejecuta chats ni tareas de Telo. Antes de habilitarlo como runner hay que validar disponibilidad de la sesión/keyring para el servicio systemd, invocación headless `agy -p`, eventos `stream-json`, límites de cuenta, cancelación y aislamiento Bubblewrap.
- Fuente primaria: [instalación y autenticación remota](https://antigravity.google/docs/install?tab=cli), [modo headless](https://antigravity.google/docs/cli/headless/).

## Hermes: preparación del piloto — 31 de octubre de 2026

- [x] Ajustes instala Hermes en la VM con el instalador oficial y muestra el estado bajo una integración separada. La tarjeta guía OAuth propio con `HERMES_HOME="$HOME/.hermes-telo"`, desactiva `auth.adopt_external_logins` antes del login y no copia `~/.codex/auth.json`. El estado solo confirma que encuentra una entrada OAuth de Codex en el almacén Hermes, no que una llamada funcione.
- [x] La instalación no habilita Hermes como runner ni lo lista como modelo ejecutable. La delegación solicitada sigue funcionando por el mecanismo actual hasta que el piloto supere las comprobaciones de seguridad y ciclo de vida.
- [ ] **Bloqueo técnico antes de enrutar chats/subagentes:** Hermes ofrece `hermes chat --oneshot --format stream-json` y delegación de hijos, pero la documentación advierte que turnos y delegaciones pueden pertenecer al gateway. Además, el sandbox actual oculta `HOME` y todavía no monta un perfil Hermes aislado. Falta probar en Linux que la tarea y todos sus hijos quedan dentro de Bubblewrap, que detener una sola conversación termina todos sus procesos sin tocar hermanos, y que sesiones OAuth concurrentes no pisan su estado.
- [ ] **Piloto de aceptación:** instalar y autenticar el perfil independiente; ejecutar una solicitud unitaria y otra que pida dos auxiliares; comprobar que una solicitud sin pedir agentes no delega; revisar actividad y resultados de cada hijo; cancelar mientras trabajan y comprobar que no queda proceso; forzar una cuota agotada y verificar el aviso reutilizable. Solo después habilitar selector/modelos y ruta Hermes por chat.
- **Cuota de ChatGPT:** Hermes documenta OAuth de Codex, pero deja sin documentar qué planes son elegibles y cómo contabiliza su cuota. No se debe contar con un ahorro frente al runner actual hasta probarlo en la cuenta. Hermes puede adoptar credenciales externas si esa opción está habilitada; el flujo de Ajustes la desactiva y usa un login propio. No se copia ni reutiliza el archivo de Codex CLI.
- Fuentes primarias: [CLI y eventos JSONL](https://hermes-agent.nousresearch.com/docs/reference/cli-commands), [delegación de subagentes](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation), [proveedor Codex y cuota del plan](https://hermes-agent.nousresearch.com/docs/integrations/providers), [seguridad](https://hermes-agent.nousresearch.com/docs/user-guide/security).

## Concurrencia por proveedor y evaluación de Hermes — 30 de octubre de 2026

- [x] **Admisión global sin presupuesto por proveedor.** Había diez puestos comunes; varias ejecuciones del mismo servicio podían ocuparlos incluso durante reintentos. Ahora las ejecuciones principales tienen límite por proveedor (OpenCode 1; demás 2; configurable con `TELO_CONCURRENCIA_PROVEEDORES`, valores 1–10), además del máximo global de diez. Las esperas no ocupan puestos, conservan orden por proveedor, se pueden cancelar sin afectar al agente activo y no impiden admitir otro proveedor. Cada intento reserva el proveedor real; se libera antes del backoff o de usar un respaldo.
- [x] **El worker también aplica el presupuesto antes de clonar.** La preparación y ejecución de un proveedor ocupado no llenan los diez slots con tareas que solo esperan, y la búsqueda de la siguiente tarea puede saltar a otro proveedor. Se conserva la serialización del proyecto. La prueba mantiene doce tareas de OpenCode (la primera bloqueada), demuestra que Google llega a revisión de plan y, tras cancelar la primera, que se atienden las demás.
- [x] **Actividad congelada con el canal de eventos caído.** El sondeo devolvía nuevos pasos, pero el efecto de React descartaba la respuesta si ya había actividad del mismo turno. Ahora integra los pasos y sus cambios de estado, conserva eventos posteriores y evita reabrir herramientas finalizadas por una respuesta atrasada. La espera de capacidad tiene una acción visible propia.
- [x] **Los límites diarios de modelos gratis se reintentaban como si fueran cortes breves.** Las analíticas del 25–31 de octubre muestran 8,8 M de tokens de agente; el proveedor agotó solicitudes `free-models-per-day` y Telo seguía probando reintentos, luego modelos de respaldo. Esa respuesta ahora se clasifica como cuota agotada para detener ese modelo y dejar elegir otro; los `429` temporales sin límite diario siguen con reintentos. Regresión: `server/tests/cuota.test.ts` (21 pass).
- **Consumo observado en la VM:** 30,1 M tokens en 30 días, 28,7 M de entrada; 19,9 M asociados a tareas y 11,4 M a chats. Últimos 7 días: 8,8 M en 640 registros medidos. Los modelos gratuitos OpenCode concentran el uso. Esto no prueba una relación causal con “tres proyectos”; la duración y cantidad de llamadas por tarea pesan más que el número de proyectos por sí solo.
- **Consumo auxiliar separado:** Jev/TypeSafe marca 245,2 k tokens en 156 llamadas durante 7 días, principalmente 132 ordenamientos de sugerencias (228,6 k). Su cuota es independiente de los modelos de agentes. Reducir o cachear esas llamadas puede ahorrar esa cuota auxiliar, no los tokens gratuitos de OpenCode.
- Evidencia local: 34 pruebas focalizadas de capacidad/worker/actividad/runner y 65 pruebas web, typecheck y build pasan. Playwright completo pasa a 390/1440 px; fuerza un 503 del canal de eventos y confirma que el sondeo actualiza la misma acción de cola y muestra la siguiente herramienta. Falta completar CI en este commit.
- **Evidencia de la VM:** en la consulta operativa estaba en `83d1f1c9a69f` (todavía sin PR #143), OpenCode 1.18.35, servicio activo desde 01:43 UTC y dos tareas en curso. El diario consultado no mostró un reinicio general posterior ni un OOM; esto no prueba que la API esté generando. No se atribuye toda espera a OpenCode ni a cuota sin trazas del proveedor.
- [x] **Piloto elegido: Hermes CLI de una sola ejecución, manteniendo Telo.** El CLI documenta `hermes chat --oneshot --format stream-json` y `delegate_task`; OpenClaw no se incorpora en esta fase. El nuevo bloque de Ajustes prepara la instalación y el login independiente; todavía no sustituye el runner ni habilita el catálogo de Hermes.
- **Condiciones del piloto:** fijar versión de Hermes y proveedor/modelo soportados (no asumir que los modelos gratuitos ni los IDs de OpenCode se transfieren); mantener cola, aprobaciones Git, uso y directorio de trabajo bajo Telo; restringir delegación a petición explícita y máximo dos hijos, sin anidamiento; meter el runner y todos sus hijos en Bubblewrap y un perfil de sesión separado; conservar la sesión histórica de OpenCode sin interpretarla como una sesión Hermes.
- **Prueba de aceptación:** mismo proveedor/modelo, prompts y workspace en ambos motores; caso unitario, dos hijos pedidos, cuatro tareas de proveedores independientes, saturación de un mismo proveedor, error de herramienta, cancelación de una sola tarea y reanudación tras reinicio. Verificar resultados con marcadores/archivos deterministas, ninguna escritura duplicada, ausencia de efectos sobre hermanos y de acceso fuera del workspace; medir primer evento útil, éxito, duración, tokens/coste y memoria máxima. El piloto solo se promueve con evidencia real; el límite del proveedor se mantiene con cualquier harness.
- Fuentes primarias: [Hermes ACP](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp), [delegación Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation), [ACP de OpenClaw](https://docs.openclaw.ai/tools/acp-agents), [cola de OpenClaw](https://docs.openclaw.ai/concepts/queue).

## Esperas del proveedor y consultas de diff — 30 de octubre de 2026

- [x] **409 repetidos en chats.** La API de la VM confirmó `task_without_repo` para dos tareas antiguas fallidas, distintas de las ejecuciones actuales. Aunque conservaban rama/base en la base de datos, ya no había clon utilizable. La consulta de diff devuelve HTTP 200 con `estado: sin_repo`; las aprobaciones de escritura conservan su rechazo. La interfaz deja de sondear al recibir ese estado o un error persistente, también en reparaciones de conflictos.
- [x] **Estados ocultos por la CLI.** Un plugin local por ejecución recoge herramientas en curso y estados de proveedor (`busy`, generación, reintento, `idle`) que `opencode run --format json` omite. Solo cuenta señales de generación, sin copiar texto parcial ni razonamiento, agrupa las frecuentes y limita bytes/eventos. No añade llamadas al proveedor. El JSON y el plugin se montan de solo lectura; solo su captura temporal permite escritura. Reutiliza el lector y los identificadores de actividad existentes; un inicio atrasado no revierte una acción terminada.
- [x] **Reintentos internos sin fin visible.** Al tercer reintento interno consecutivo informado por OpenCode se termina el grupo con error recuperable, conservando sesión y archivos. No se corta por duración ni por silencio. Una herramienta `invalid` queda marcada como error y el indicador de inactividad reconoce también cambios de contenido dentro del mismo paso.
- Evidencia: 50 pruebas dirigidas pasan, typecheck del servidor y build web pasan. Playwright completo pasa en 390/1440 px y verifica que un diff sin clon no se repita tras el intervalo de sondeo. La suite adicional de aislamiento requiere Linux; el caso previo que crea un enlace falla con EPERM en este Windows restringido y queda para CI, sin relajar la protección.
- [ ] **Confirmación operativa de las pausas.** El análisis actual de Apex-Suite y el video usan GLM gratuito con esfuerzo máximo. El análisis emitió búsquedas, lectura y un `todowrite`; el video alcanzó diez acciones y una herramienta inválida. Esto no demuestra por sí solo un bloqueo del proceso. La VM confirma CLI y bubblewrap disponibles; SSH rechaza la autenticación por clave pública. Tras desplegar hay que comprobar el plugin con el OpenCode instalado y observar si la pausa corresponde a reintentos, generación o falta real de eventos. No se han cancelado ni reiniciado trabajos del usuario durante esta revisión.
- Referencias del protocolo: [salida JSON de la CLI](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/cli/cmd/run.ts), [estados de sesión](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/schema/src/session-status-event.ts), [eventos de plugins](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/plugin/index.ts).

## Compactación fuera de la respuesta — 30 de octubre de 2026

- [x] **El resumen interno aparecía como entrega.** La plantilla `Objective / Important Details / Work State / Next Move / Relevant Files` coincide con el resumen de OpenCode. Su CLI emite los bloques de texto sin incluir siempre los metadatos `summary` del mensaje. Telo reconoce la plantilla completa o los metadatos explícitos, guarda el resumen como actividad de compactación y lo excluye de la respuesta final; conserva sesión y contabilidad de uso. Si el proceso termina solo con compactación, avisa que todavía falta la respuesta final.
- [x] **Consulta plegada.** «Ver compactación» queda cerrado al abrir el chat y carga el resumen desde la actividad al expandir. Los mensajes antiguos con la firma completa también se pliegan, sin modificar sus datos guardados. Respuestas normales y ejemplos dentro de bloques de código no se clasifican por unas pocas palabras sueltas.
- Evidencia local: 24 pruebas dirigidas de compactación/actividad/marcas y typecheck del servidor pasan; build web correcto. El recorrido de navegador comprueba resumen antiguo, carga de un resumen nuevo y respuesta final separada en 390/1440 px. Falta confirmar el flujo con OpenCode real en la VM tras desplegar.
- Fuente de la firma y del comportamiento de la CLI: [plantilla de OpenCode](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/session/compaction.ts), [emisión de texto en la CLI](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/cli/cmd/run.ts).
- El primer CI expuso una carrera previa en `login-codex.test.ts`: el test recibía URL/código antes de la línea del token ficticio y comprobaba su redacción demasiado pronto. Ahora espera la salida comprobable y cancela en `finally` para no arrastrar el proceso al siguiente caso. No cambia el login del producto.

## Delegación explícita y dictado móvil — 30 de octubre de 2026

- [x] **Delegación por turno.** Guardar auxiliares en el Supervisor ya no inicia selección ni llamadas en peticiones normales. La solicitud actual debe pedir delegación; negaciones, consultas informativas y citas no la autorizan. Una función o modelo nombrado limita los auxiliares. OpenCode recibe `task: deny` en ejecuciones unitarias, también al reanudar sesiones; los perfiles autorizados permiten sus alias temporales y los hijos deniegan más delegación. Las plantillas aplican una especialidad al principal; la opción de auxiliares añade una petición explícita al borrador.
- [x] **Dictado móvil duplicado.** Se reconstruye la transcripción desde la lista completa de resultados del navegador en vez de añadir cada resultado final de nuevo. Se conservan las sesiones anteriores al reiniciar el motor y las repeticiones realmente dictadas. Regresiones en `chat-dictado.test.ts` y en el compositor de Playwright.
- Evidencia: pruebas dirigidas de delegación y runner, 64 pruebas web, typecheck de servidor y build web pasan. Los casos de chat con procesos requieren Linux y quedan para CI. Falta comprobar voz en el teléfono físico y un piloto real de subagentes en la VM; los runners de las pruebas son simulados. La decisión posterior del usuario de probar Hermes queda registrada en la sección de instalación del piloto.

## Inicialización de perfiles de subagentes — 30 de octubre de 2026

- [x] **OpenCode fallaba al iniciar subagentes (`FileSystem.writeFile .../.gitignore`).** El perfil temporal se montaba completo en solo lectura, pero OpenCode escribe `.gitignore` al inicializar su configuración. Ahora Telo precrea ese archivo y monta solo él en lectura/escritura; el JSON, los prompts y plugins permanecen de solo lectura, y el registro NDJSON conserva su montaje separado. `aislamiento.test.ts` comprueba el montaje puntual; la suite completa de servidor pasó en CI Linux. La prueba local queda limitada por el permiso de symlinks de Windows.

## Revisión de seguridad y flujos — 30 de octubre de 2026

Correcciones preparadas en [PR #140](https://github.com/PABLOCESAR2412/Orquestador/pull/140); estos resultados locales no certifican su despliegue en la VM.

- [x] **S01 · La copia de skills podía escribir fuera del workspace (alta).** Un enlace en el destino o en sus ancestros redirigía la escritura del servidor; un enlace duro permitía modificar otro archivo. Se validan destinos, se reemplazan archivos atómicamente y se verifica `.opencode` antes de escribir. Cinco regresiones fallaron antes y pasan después en `skills-seguras.test.ts`.
- [x] **S02 · Otra aplicación en distinto puerto del mismo host podía mutar la API con la cookie (media).** `SameSite=Strict` no separa esos puertos. Se valida Origin antes de las mutaciones, se rechaza el origen opaco y los metadatos de otro sitio; siguen disponibles clientes CLI sin Origin y el callback OAuth GET. Pruebas sobre revocación de sesiones real y proxy simulado en `seguridad-origen.test.ts`.
- [x] **S03 · Una sesión inactiva más de 60 días podía renovarse (media).** Ahora se rechaza y elimina antes de actualizar su actividad. Regresión rojo→verde en `sesiones-dispositivos.test.ts`.
- [x] **S04 · HTML descargado conservaba código activo que omitía el filtro de texto (media).** Se usa el parser HTML nativo, se retiran atributos ejecutables y URLs inseguras y se antepone una CSP dentro del archivo. Las descargas antiguas se vuelven a proteger. `documentos.test.ts` y Chrome verifican los casos normal, NBSP, VT y doctype malformado, con código posterior al filtro bloqueado y sin peticiones externas.
- [x] **F01 · «Detener» cancelaba el último turno en cola y dejaba ejecutándose el anterior.** Ahora aborta la tarea activa y cancela todas las pendientes de ese chat; conserva las sesiones y los workspaces. Regresión en `chat-cola.test.ts`.
- [x] **F02 · Un turno en cola ocultaba el plan que esperaba aprobación.** Backend e interfaz priorizan la tarea activa o pendiente de aprobación y después la cola FIFO. Regresiones en `chat-cola.test.ts` y `web/tests/chat-tareas.test.ts`.
- [x] **F03 · Actividad, subchats y tarjetas Git podían aparecer bajo otro mensaje.** Migración aditiva `049_task_message`: cada tarea nueva guarda su mensaje origen, validado contra su conversación. Se conserva en Seguir y en reparación de conflictos. Las tareas antiguas quedan sin asociación, sin inventar vínculos; las cadenas commit→push→PR respetan el null explícito. `worker-turnos.test.ts` ejecuta el worker real con runner simulado; `migracion-turno-tarea.test.ts` comprueba base anterior, respaldo, idempotencia, escritor antiguo y FK SET NULL. Volver al binario previo conserva la columna nullable y los datos.
- [x] **F04 · Las lecturas Git privadas omitían el helper de credenciales.** Los tres fetch reciben ahora helper y entorno; sin instalación App se intenta también la sesión global antes del token del proyecto. Dos regresiones sin red comprueban actualización, rama PR y diagnóstico de conflictos; el token no aparece en argumentos.
- [x] **F05 · La cancelación de una tarea quedaba bloqueada durante mantenimiento.** La puerta admitía detener/cancelar pero omitía la ruta real `/api/tasks/:id/cancel`. Regresión rojo→verde en `despliegue.test.ts`.
- Evidencia local: 12 suites de seguridad/planes/programadas **119 pass, 3 skip**; pase de Git/cola/migraciones/worker **81 pass, 14 skip** y cinco casos dirigidos finales; Git+skills **42 pass**; web **62 pass**; typecheck servidor y build web correctos. Playwright pasa en 390/1440 px y las exportaciones HTML superan cuatro casos de seguridad. Las omisiones corresponden a procesos/aislamiento que requieren Linux o recursos de prueba.
- Cobertura revisada sin otro fallo confirmado: lectura de archivos y streams, previews con origen opaco, aprobaciones ligadas al diff, secretos/cifrado/redacción, OAuth Drive, medios, MCP, subagentes, retención, planificador y coordinación de mantenimiento.
- [ ] **S05 · Separar el estado global de Codex por conversación (prioridad alta).** `aislamiento.ts` expone `~/.codex` en lectura a todos los runners: si hay historiales/configuración globales, el agente puede leerlos. El runner Codex tampoco tiene perfil propio; hay que diseñar la migración de sesiones y respaldos, y validar escritura/renovación de credenciales con Codex real en Linux antes de cambiar ese montaje. No está resuelto por este PR.
- [ ] **Validación de producción:** comprobar Origin con el proxy HTTPS real, arranque con migración 049, lectura de un repositorio privado real y un flujo de dos turnos con subagentes. No se accedió a credenciales ni se desplegó en la VM desde esta revisión.
- [ ] **Siguientes mejoras recomendadas:** política de permisos MCP por tarea y proxy de egreso para separar la red del sandbox. Son brechas de arquitectura ya registradas en la revisión del harness; requieren conservar el acceso de los proveedores y no imponer un corte fijo de tareas largas.

## Contexto Git al crear chats — 30 de octubre de 2026

- [~] **La paleta y el comando «Nuevo chat» podían crear una conversación libre dentro de un proyecto activo.** Esas rutas enviaban `projectId: null`, por lo que los turnos no recibían `project_id` y el worker no preparaba la copia Git del proyecto. La paleta y el comando del chat ahora heredan el proyecto seleccionado. «Nuevo chat libre» sigue creando una conversación independiente; los botones del proyecto ya vinculaban su `project_id`.
- [x] **La paleta anunciaba Ctrl+N para «Nuevo chat», aunque ese atajo abre «Nuevo proyecto».** Se quitó la etiqueta engañosa del atajo.
- Validación: `cd web && bun run build` (TypeScript y Vite) completó correctamente. La advertencia de tamaño de chunk ya existía; queda pendiente comprobar el flujo visual en la VM después del despliegue.

## Política de despliegue refinada — 30 de octubre de 2026

- [~] **Las tareas ya no se pausan por cambios visuales o documentación.** `deploy/actualizar.sh` reconoce commits limitados a CSS, el registro de cambios y los documentos operativos; los CSS se construyen en staging y se publican con los assets antes que `index.html`, sin reiniciar el servicio. Cambios de API, workers, runners, interfaz funcional, dependencias, configuración o migraciones siguen usando el drenado y la pausa reanudable por precaución.
- [ ] **Validación en la VM:** la modificación del actualizador en sí requiere un primer despliegue con el protocolo actual (drenar tareas activas). Después, confirmar que una tarea sintética sigue activa durante un cambio solo CSS y que un cambio de runtime sí se pausa y puede reanudarse. No se ha desplegado desde este workspace.

## Ajustes visuales e inventario real de skills — 30 de octubre de 2026

- [~] **La escala del texto desalineaba la interfaz.** La raíz aplica la escala una sola vez y las áreas usan su altura. Compilación web correcta; la revisión visual al 90 %, 100 % y 125 % en 390 y 1440 px sigue pendiente porque el entorno de revisión bloqueó el acceso del navegador a localhost.
- [~] **El hilo del chat estaba desplazado respecto al compositor.** El ancho interior de la columna queda igual al ancho máximo del compositor y con márgenes simétricos; la conversación corta queda junto al compositor. Smoke visual pendiente por el bloqueo del navegador local.
- [~] **El indicador de carga parecía dos puntos orbitando.** El SVG conserva el arco animado, con extremos rectos en vez de extremos redondos que parecían puntos. Smoke visual pendiente.
- [~] **Ajustes de proveedores e integraciones.** OpenCode aparece como motor local, se retiraron cifras redundantes de consumo y se añadieron controles para plegar credenciales. Las claves guardadas siguen ocultas por el servidor; el ojo solo revela la clave nueva mientras se escribe. Compilación web correcta; revisión visual pendiente.
- [~] **Skills e integraciones.** La selección automática y los alias usan los nombres de origen; Conexiones enlaza repositorios y permite instalar las skills que falten con el importador existente. Telo solo importa `SKILL.md`, no sus referencias o scripts. Harvey Specterbot y las antiguas skills de muestra solo se eliminan si coinciden byte por byte con la copia sembrada por Telo; las versiones editadas se conservan. Compilación y tipo del servidor correctos; los ocho comandos de instalación pasan el parser y la prueba de conservación de skills personalizadas pasa. Las pruebas que escriben skills fallan en Windows en la operación atómica `renameSync`; WSL no inicia en este equipo. Falta repetir instalación y validar herramientas en Linux/VM.
- [ ] **Pendientes con credenciales o capacidad externa.** Meta puede conectarse mediante un MCP HTTPS externo que gestione OAuth; Telo no implementa inicio de sesión ni publicación nativos. Empleo y búsqueda de clientes requieren elegir un proveedor MCP real. Context7 ya tiene MCP remoto sin token; la clave de Upstash es opcional y eleva cuota. HyperFrames no usa clave API para render local: el espacio libre es una lectura actual, no un mínimo fijo; falta ejecutar `npx hyperframes doctor` y verificar un render en la VM. Codex conserva el inicio de sesión; `OPENAI_API_KEY` sería otra vía con facturación separada.

## Confirmación del estado operativo — 30 de octubre de 2026

- [x] **Google Drive en la VM:** el usuario confirma que el flujo funciona.
- [x] **Restauración desde R2:** el usuario confirma que funciona.
- [ ] **Web Push en Android:** no funciona; sigue pendiente la entrega real en el dispositivo.
- [x] **Aislamiento y recursos en Linux:** el usuario confirma que funcionan. Esta revisión local en Windows no repitió esas pruebas.
- [x] **Otras verificaciones operativas anotadas:** el usuario confirma que están bien.
- [~] **Integraciones externas:** el usuario está comprobándolas; actualizar cada integración cuando confirme el resultado.
- [~] **Arranque de tareas largas:** el usuario reporta que las tareas no llegan a iniciar. En el código, el estado sigue `queued` durante la preparación del clon; esto explica la falta de actividad visible, pero no demuestra que la demora real de VM/proveedor tenga la misma causa. Falta registrar duración por fase y reproducirlo en la VM.
- [~] **Subagentes nativos de OpenCode:** la captura concreta dice que el usuario rechazó permiso para una llamada. Los perfiles efímeros permiten `task` solo para los alias de esa petición y deniegan los demás. Cada subagente recibe instrucciones para corregir errores de comandos o pruebas hasta dos veces; si persisten, el Supervisor puede continuar una vez la sesión existente con una corrección concreta. La vista muestra el encargo y la actividad en la rama del agente, con actualización cada segundo. Pruebas unitarias cubren permisos e instrucciones; falta un piloto real en la VM para validar delegación y reparación.
- [~] **Respuesta del chat:** el selector automático recibe solo el mensaje actual y tiene un máximo de 15 segundos; si falla, Telo omite auxiliares opcionales y deja responder al Supervisor. La delegación explícita inicia los auxiliares sin llamada de selección. La actividad muestra cuánto tardan el selector, cada auxiliar y el Supervisor. Esto reduce una lectura de historial y evita esperar el límite anterior de 90 segundos; falta comparar tiempos con las cuentas y VM reales.
- [~] **Actividad larga del chat:** la duración total sigue abierta y el usuario conserva la cancelación manual. La vista avisa tras 2 minutos sin pasos nuevos, aclara que no puede confirmar avance y destaca «Supervisor» en la narración. Falta comprobar el aviso en una ejecución desplegada.
- [~] **Proveedores IA:** Ajustes agrupa Gemini, Groq, NVIDIA NIM y OpenRouter en pestañas; las claves guardadas quedan ocultas tras «Editar». «Probar conexión» consulta el catálogo de modelos del proveedor sin generar texto. El endpoint está cubierto con una respuesta simulada; faltan comprobaciones con las cuentas reales.
- [~] **Auxiliares gestionados por Telo:** piloto en la VM con un chat aislado y un caso sintético. En la segunda corrida, Arquitectura (`opencode/deepseek-v4.1-flash-free`) y Seguridad (`opencode/glm-5.3-flash-free`) terminaron en paralelo; el supervisor integró ambos informes y confirmó `ARQ-8K` y `SEC-3M` en 43 s. La primera corrida falló en Seguridad con OpenCode código 1 al crear `workspace` (`CREATE TABLE`), aunque Arquitectura respondió; la repetición pasó, así que queda pendiente encontrar la causa del fallo intermitente. La delegación de Telo sirve para análisis en paralelo, pero no crea subchats ni usa `Task` nativo de OpenCode.

## Revisión del harness de agentes — 30 de octubre de 2026

El video presenta un mapa conceptual —instrucciones, herramientas, bucle, errores, modelo, memoria, permisos y parada—, no un estándar formal. El estado del producto y el orden para cerrar brechas son:

**Hallazgo en el arranque:** en `server/src/worker.ts`, una tarea de proyecto permanece `queued` y sin evento de inicio mientras `prepararCopia` completa el espacio de trabajo; `server/src/workspace.ts` ejecuta varias operaciones Git con topes de hasta 10 minutos. Esto puede explicar la falta de actividad visible durante el inicio, pero no confirma que la llamada al proveedor o el proceso de la VM fallen. El primer diagnóstico debe separar cola, preparación del clon y primera salida del modelo, registrando la duración de cada fase.

- [x] **Instrucciones y bucle:** `AGENTS.md`/`CLAUDE.md`, analizador, plan con aprobación por hash, obrero, replanificación con tope de 3 planes y hasta 2 correcciones del obrero. Las reparaciones de subagentes también están acotadas.
- [~] **Herramientas y contexto:** Telo configura MCP y añade Context7 de forma condicional; las demás conexiones MCP habilitadas se entregan a cada ejecución. Falta permitir una lista de servidores/herramientas por tarea y medir cuánto contexto y tokens agrega cada conexión. No asumir que el costo de MCP observado en el video se repite en Telo: medir primero el uso real informado por el proveedor.
- [x] **Modelo y costo:** el usuario puede escoger modelo/esfuerzo y Telo registra llamadas, tokens y costo cuando el proveedor los informa. Falta un conjunto fijo de tareas que compare el mismo modelo con configuraciones distintas del harness.
- [~] **Memoria:** hay sesiones separadas y memoria por proyecto limitada a 4.000 caracteres; Jev puntúa las propuestas y, si no está disponible, quedan para aprobación del usuario. Falta definir caducidad y probar ataques de envenenamiento de memoria/contexto.
- [~] **Permisos y aislamiento:** Bubblewrap oculta datos del servidor, limita la escritura al workspace y los cambios Git requieren aprobaciones. Las herramientas MCP activas no tienen una política de autorización por servidor/acción aplicada fuera del modelo. La red del sandbox sigue habilitada para hablar con proveedores; aislamiento de red y límites de CPU/memoria requieren diseño y pruebas reales en Linux.
- [~] **Errores y parada:** hay reintentos de fallos transitorios, correcciones acotadas, cancelación que termina el grupo de procesos y aviso de silencio. Las ejecuciones largas no tienen timeout ni presupuesto máximo de costo/tokens por tarea; mantenerlas largas es deliberado, así que los futuros límites deben ser configurables y permitir continuar, no volver a matar tareas a los 15 minutos.
- [~] **Cierre verificable:** Telo valida el JSON del plan/reporte y compara cambios con el alcance, pero la declaración de pruebas del agente no es un verificador independiente. Hace falta un gate que adjunte evidencia reproducible del comando, su resultado y la versión del workspace.
- [~] **Evaluación y trazas:** las pruebas de servidor cubren transiciones y fallos simulados; todavía no hay evals repetibles que comparen éxito, latencia, tokens, costo y reparación en ejecuciones reales. Ya existen eventos de actividad y uso; la exportación a convenciones GenAI de OpenTelemetry queda para una fase posterior y debe evitar guardar prompts, secretos o resultados sensibles.

**Orden de trabajo:** (1) exponer y medir las fases de cola, preparación del clon y primera salida; después reproducir el arranque en la VM para separar demora del clon de un fallo del proveedor/proceso; (2) crear un piloto interno de 5–8 tareas con workspace y versión de modelo fijos, verificadores deterministas y medición de éxito, primer evento, duración, tokens, costo y reintentos; (3) usar ese piloto para decidir el allowlist MCP por tarea y presupuestos configurables; (4) probar Bubblewrap, límites de recursos y egreso en Linux; (5) comparar runtimes —OpenCode, Codex y eventualmente Hermes— con el mismo piloto antes de sustituir el motor.

Terminal-Bench sirve como referencia externa, no como requisito de conformidad. Para una prueba externa, empezar con tareas pertinentes de Terminal-Bench 2.1 en contenedores aislados: su versión 2.1 corrigió problemas en 28 de las 89 tareas de 2.0. El Agent Control Standard de OWASP se puede evaluar después como contrato de hooks/auditoría; al 30 de octubre de 2026 su especificación está en `v0.1.0`, así que no convertirla todavía en dependencia del núcleo.

Referencias: [NIST AI RMF Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf), [OWASP Top 10 para aplicaciones agénticas 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/), [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html), [MCP — consideraciones de seguridad](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/security-considerations.mdx), [OpenTelemetry GenAI](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md), [OWASP Agent Control Standard](https://github.com/GenAI-Security-Project/agent-control-standard) y [Terminal-Bench 2.1](https://www.tbench.ai/news/terminal-bench-2-1).

## Agentes predefinidos y generación de video — 29 de octubre de 2026

- [~] **El compositor permite iniciar skills personales desde un botón «Agentes».** Incluye HyperFrames, Instagram, Obsidian, Superpowers, ECC, Harvey, Orca, búsqueda de empleo y búsqueda de clientes. El formulario propone el borrador como objetivo y «Completar campos vacíos desde el chat» solo copia datos explícitos con etiquetas claras, sin adivinarlos ni sobrescribir campos ya escritos. «Usar en el chat» prepara el mensaje para revisión y envío manual; no ejecuta publicaciones ni acciones externas.
- [~] **HyperFrames se activa junto con la skill de animación en solicitudes de video.** El agente comprueba el disco antes de descargar o renderizar; con menos de 4 GiB libres no ejecuta HyperFrames en la VM y deja preparada la composición HTML para renderizar en otro equipo o después de liberar espacio. Con suficiente espacio verifica Node 22+ y FFmpeg con `npx --yes hyperframes doctor`; el diagnóstico comprueba además FFprobe y Chromium empaquetado. `npx` descarga la herramienta bajo demanda y evita instalación global. Falta verificar en la VM los requisitos y un render real cuando haya margen de disco.
- [x] **Ajustes > Conexiones simplificado.** Ya no presenta un catálogo de skills ni tarjetas de Obsidian, Harvey u Orca; las skills conservan su sección independiente. Meta y búsqueda de empleo/clientes llevan al formulario MCP genérico, y el estado no promete que el servicio remoto responda. CI 41707155482 pasó, incluido build y smoke visual.
- [ ] **Integraciones externas pendientes:** configurar un MCP HTTPS para Meta que gestione su propia autenticación y elegir un proveedor MCP para empleo/clientes. Obsidian, Harvey y Orca no forman parte del catálogo activo de Conexiones. Context7, Superpowers y ECC son skills locales; HyperFrames sigue sujeto a Node 22+, FFmpeg, FFprobe, Chromium y una prueba de render real en la VM.

## Continuidad de tareas largas — 29 de octubre de 2026

- [ ] **Animación/video sin resultado tras más de una hora — 30 de octubre.** La captura muestra `opencode/minimax-m3.1-flash-free`, 1 h 14 min de procesamiento, 68 acciones del Supervisor y el estado «Solicitud enviada al modelo». La petición sí llegó al flujo del agente; la captura no permite saber si quedó en un ciclo de herramientas, esperando al proveedor o bloqueada durante la generación/render. No cancelar ni atribuirlo a una carga fallida sin evidencia. Pendiente de observar si termina y, si vuelve a atascarse, revisar eventos/salida, procesos y archivos del workspace para ubicar la última fase completada.
- [~] **A04 · El vigilante cerraba chats y tareas tras 15 minutos sin salida del modelo.** Causa confirmada en `server/src/runners/opencode.ts`: el proceso se mata por silencio y el worker deja la tarea como `failed`; no es el archivador de Drive. El código local desactiva ese límite para turnos de chat, auxiliares y tareas; el control manual «Detener» sigue disponible. Esta entrega identifica etapas solo mediante acciones observables (lecturas, búsquedas, ediciones, comandos y consultas externas), separa al supervisor de los agentes y muestra el registro independiente de cada subagente en un panel plegable. No expone razonamiento interno privado ni inventa actividad cuando el proveedor no ha emitido eventos; además, tras 2 minutos sin pasos nuevos avisa del silencio sin cancelar el turno. Falta desplegar esta rama y confirmar en producción que ya no aparece el aviso de 15 minutos ni el nuevo estado de silencio.
- [x] **El archivado de Drive no cancela ejecuciones activas.** Solo incluye estados terminales (`done`, `failed`, `cancelled`) tras 24 horas y excluye acciones Git pendientes. Conserva en la base local el chat, mensajes, estado y acciones; archiva cifrado el espacio de trabajo y, cuando corresponde, el perfil privado. Para continuar un espacio ya retirado del disco, primero se restaura desde Ajustes > Servidor > Almacenamiento. La copia local se elimina únicamente después de verificar la copia cifrada remota.

## Archivo externo de espacios de tareas — 28 de octubre de 2026

Entrega: [PR #130](https://github.com/PABLOCESAR2412/Orquestador/pull/130), abierto para revisión; todavía no está fusionado ni desplegado.

- [~] **A01 · Los espacios de tareas terminadas ocupaban el disco de la VM.** Se agrega archivo cifrado en Google Drive con OAuth `drive.file`, cargas reanudables, comprobación SHA-256/GCM y restauración en staging. La interfaz permite archivar y liberar una tarea terminada de forma explícita; conserva historial y base de datos locales. Los proyectos completos no se mueven. OAuth ya está configurado en la VM. Tras fusionar y desplegar el PR, falta validar el flujo con una tarea pequeña, comprobar la restauración y confirmar el ahorro real antes de archivar más tareas.
- [x] **A02 · La URL de callback de OAuth podía quedar mal configurada o ser poco visible.** Se usa y muestra el callback exacto desde el origen HTTPS del VM, sin `/chat`; pasos documentados en `deploy/README.md`.
- [x] **A03 · La expiración de una sesión de carga de Drive se mostraba como error genérico.** Se informa que puede reintentarse y que los archivos locales se conservan.

## Corrección de tareas sin progreso — 23 de octubre de 2026

- [x] **R20 · El vigilante de inactividad podía dejar una tarea viva sin emitir progreso (MEDIA).** El ajuste `TELO_TIEMPO_INACTIVIDAD_MS=0` apagaba la protección y la actividad de CPU/E/S del grupo reiniciaba el reloj aunque el runner no emitiera eventos. Ahora cero o un valor inválido usa 15 minutos; el watchdog se reinicia solo con salida observable del agente, y una ejecución que sí sigue emitiendo progreso conserva duración ilimitada. Evidencia: `server/tests/proteccion.test.ts` (5 aprobadas), `bun run typecheck` y suites relacionadas (12 omitidas por requerir Linux/bubblewrap/setsid). El disco de producción no se ha medido en esta revisión, así que su relación con la captura queda sin confirmar.
## Iniciativa del obrero: ciclo de corrección — 23 de octubre de 2026

Entrega: [PR #129](https://github.com/PABLOCESAR2412/Orquestador/pull/129). Va sobre los PR #128 (reintentos del cliente) y #127 (cola de mensajes): fusionar en orden.

- [x] **Un reporte con fallo ya no mata la tarea de inmediato: el obrero se autocorrige.** Al terminar con `estado: "fallo"`, el worker devuelve el fallo (reporte y salida reciente) al mismo agente en su misma sesión (`promptCorreccion`), dentro del plan aprobado y con la comprobación de alcance por ciclo, igual que la ejecución original. Tope de 2 ciclos por tarea (`TELO_CICLOS_OBRERO` lo ajusta; 0 desactiva la iniciativa); agotados, la tarea falla con el último reporte, como siempre. Cada ciclo queda en el historial con su evento «Corrección del obrero (iniciativa)».
- [x] **Desviaciones y límites intactos.** Si la corrección necesita salirse del plan, la tarea vuelve al analizador con el motivo (replanificación con su tope de 3 planes); la cuota agotada y la cancelación operan igual dentro del ciclo. El push de una corrección sobre una tarea con PR redispara el CI de esa PR automáticamente.
- **Pendiente siguiente, fuera de este PR: auto-fix del CI de la PR.** Leer los checks fallidos del head de la PR y alimentarlos al ciclo exige decidir el token de lectura de logs de CI en el VM, la cadencia de vigilancia y el techo de coste por tarea; queda documentado como su propio ítem.
- Verificación: servidor **76/76 suites** en verde (por proceso propio, como el CI) con dos pruebas nuevas en `worker-flujo.test.ts` (corrección con éxito en la misma sesión; agotar ciclos y fallar con el último reporte) y el binario falso ampliado (`fixture/corrige`, `fixture/fallo-reporte`); web `tsc` limpio, 58 unitarios pass y build ok.

## Tarea 12: cola de mensajes del chat — 23 de octubre de 2026

Entrega: [PR #127](https://github.com/PABLOCESAR2412/Orquestador/pull/127). Va sobre el PR #126 (contiene sus commits).

- [x] **Lo que envías mientras el agente responde queda en cola y se ejecuta en orden de llegada.** Antes el servidor rechazaba el mensaje con 409 `conversation_busy` y había que reenviarlo a mano. Ahora el POST guarda el mensaje y lo encola: los chats de proyecto usan su cola propia de tareas (el worker las corre en orden) y los chats libres guardan el mensaje con `en_cola = 1` (migración 043); al terminar un turno, `arrancarSiguienteEnCola` arranca el pendiente más antiguo dentro del `finally`, y sigue habiendo un turno a la vez por chat.
- [x] **En el chat: insignia «En cola» y quitar antes de que arranque.** El hilo marca el pendiente con su insignia y un botón de quitar (`DELETE /api/conversations/:id/messages/:mensajeId`; 404 si ya arrancó). La cola local del compositor sigue igual para lo que aún no llegó al servidor.
- [x] **Un reinicio no ejecuta los pendientes por su cuenta.** Al arrancar, `avisarTurnosInterrumpidos` limpia las banderas `en_cola` y los avisos de siempre piden volver a enviar. «Detener» cancela el turno y vacía la cola con un aviso que lo dice («…los N mensajes en cola quedaron sin ejecutar»).
- Guardas que se conservan: los reintentos no se encolan (409 como hoy), la cuota agotada sigue bloqueando (`chat_quota_pending`) y un proyecto en revisión de Git bloquea su instante (`proyecto_ocupado`). El límite de 3 minutos por turno ya no existe (`TIEMPO_TURNO_MS = null`); el vigilante de silencio de 15 minutos que quedaba en esa entrega se desactivó después en A04.
- Verificación: servidor **76/76 suites** en verde (cada una en proceso propio, como el CI) con pruebas nuevas de orden, quitar, detener con cola y reinicio (`chat-turnos.test.ts`, y `chat-cola.test.ts` actualizado al nuevo solape: encola tarea nueva y supersede la acción git pendiente); web `tsc` limpio, 58 unitarios pass, build ok y humo UI PASS.

## Lote de correcciones — 23 de octubre de 2026

Entrega: [PR #126](https://github.com/PABLOCESAR2412/Orquestador/pull/126). Incluye el contenido de [PR #125](https://github.com/PABLOCESAR2412/Orquestador/pull/125) (cierre de pendientes del seguimiento), que se retira al fusionar este.

- [x] **El 502 puntual en `/api/servidor` era la ventana de reinicio del servicio, y el cliente ahora la atraviesa.** El handler del servidor ya estaba defendido (cachés compartidos entre solicitudes simultáneas, mediciones con tiempos de espera, `statSync` acotado a dos ficheros conocidos, nada que lance), así que la falla del usuario coincidió con el breve reinicio del proceso (despliegue o mantenimiento) y la puerta respondió 502. En `web/src/api.ts` las peticiones GET idempotentes reintentan ante 502/503/504 y ante una conexión caída: 2 reintentos con esperas de 400/800 ms. Las mutaciones jamás reintentan (no se duplica un envío real) y los códigos definitivos (4xx, 500) fallan al primer intento. Este reintento por petición complementa el que las consultas TanStack ya tenían (`reintentarConsultaTransitoria`) y cubre las rutas que no pasan por ellas (entrar, llamadas manuales). Nuevas pruebas: `web/tests/peticiones.test.ts` (dos 502 y éxito en el tercero; POST con 502 sin reintento; GET con 500 sin reintento; conexión caída con 3 intentos).
- [x] **Los dos tests del guard de bases dejan de depender de dónde viva el repositorio.** Fallaban al correr la suite en un worktree dentro de `%TEMP%`: el guard permite cualquier directorio estrictamente debajo del temporal del sistema, así que el `server/data` propio del clon parecía permitido y nada lanzaba (artefacto de ubicación; el guard no tenía regresión y no hubo fixtures en la base real: sondeo de la base del usuario con 0 filas de hoy). Los dos tests ahora rechazan `tmpdir()` en seco — la raíz misma queda fuera del permitido por diseño del guard — y pasan igual en local, CI y clones dentro o fuera del temporal.
- Verificación fiel al CI: servidor `typecheck` ok y **76/76 suites** verdes ejecutando cada una en proceso propio (`bun test` por suite, como hace el workflow; la corrida monoproceso era la que revelaba los dos fallos del guard); web: `tsc -b` limpio, 58 unitarios pass, build ok, humo `test:ui` PASS y preview HTML aislada PASS en 390/1440 px.

## Humo que aguanta el historial del fixture — revisión del 23 de octubre

Entrega: [PR #124](https://github.com/PABLOCESAR2412/Orquestador/pull/124).

- [x] Devuelve a verde el `interfaz` de `main` (el merge de la reauditoría quedó con el humo rojo). En la verificación tras «Enviar», `getByText('Mensaje recibido', { exact: true })` resolvía 2 elementos: el fixture acumula el historial de la conversación y ya hay dos respuestas idénticas (la del segmento previo y la nueva). La espera ahora usa `.first()`; no hay bug de la app: son las dos burbujas legítimas que el fixture dejó y la burbuja del usuario aparece una sola vez.
- Pruebas: `tsc` limpio; unitarios 54 pass/0 fail; build ok; `test:ui` PASS en 390/1440 px con el cambio final; la condición del doble reproduce de forma intermitente en local (1 de 3 pasadas) y esa fue la causa del rojo en CI (`run 39972167683`).
## Cierre de pendientes del seguimiento — 23 de octubre de 2026

Entrega: [PR #125](https://github.com/PABLOCESAR2412/Orquestador/pull/125).

- [x] **El parche de sprintf-js se mantiene tras evaluar la vía oficial.** No hay versión corregida (la última es 1.1.3, setiembre de 2023) y el advisory [GHSA-hp3w-g68c-fv3c / CVE-2026-97058](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) se retiró el 22 de octubre de 2026 («la aplicación debe manejar la excepción») sin versiones corregidas. El criterio del pendiente queda evaluado: el parche local acota la precisión a los límites de ECMAScript y seguirá vigente hasta que exista una 1.1.4+ oficial con el arreglo.
- El resto del inventario (validaciones del VM: primer ciclo real del timer de despliegue, respaldos/R2, Web Push en Android con VAPID, migración 039, Tailscale, proveedores NVIDIA/Gemini/Groq, contraste AA, presupuesto Azure; las tareas 7, 9 y 10 y la 13 que exigen decisiones del usuario; las que esperan datos: aviso 404 y «PR de Test») quedan abiertas documentando ese porqué; Tarea 12 (cola de mensajes del chat) y las skills propuestas por proyecto esperan su propio plan, un ítem por PR.
- Higiene: `*.tsbuildinfo` entra en `.gitignore`, y el bullet histórico «PR #115.» de los avisos pasa a «PR #118.» (ese PR absorbió su contenido).

## Revisión adicional — 23 de octubre de 2026

Entrega: [PR #123](https://github.com/PABLOCESAR2412/Orquestador/pull/123).

- [x] **R19 · Endpoint de Web Push permitía solicitudes a destinos HTTPS arbitrarios (MEDIA).** Se limita a hosts de FCM, Apple, Mozilla y Windows Push; se vuelve a validar antes de enviar, incluidas filas antiguas. Las redirecciones se inspeccionan manualmente y se descartan; el servidor no las sigue. Las suscripciones vencidas o redirigidas y sus entregas en cola se eliminan. Se limita el registro a 20 dispositivos, con renovación permitida. Evidencia: `server/tests/push.test.ts` (17 aprobadas), `bun run typecheck` y CI del PR.
- [x] **Seguimiento histórico desactualizado.** A11 ahora refleja que el chat directo usa el vigilante de actividad de #122; A12/H8 reflejan la limpieza aplicada y el almacenamiento confirmado por el usuario en producción.

## Reauditoría del 23 de octubre de 2026 — cierre de hallazgos

Entrega: [PR #122](https://github.com/PABLOCESAR2412/Orquestador/pull/122). Base inicial: `cc653a6` (PR #117); integración posterior de main `a08b383` conserva los PRs #118–#121. Este lote comprueba de nuevo el comportamiento corregido; los registros anteriores conservan su valor histórico. Verificación local: 76 suites de servidor en procesos separados (532 pruebas aprobadas, 63 omitidas por plataforma/opt-in), 54 pruebas web, tipos y build correctos. La suite de respaldo requirió identificar su fixture como aislado; pasó al repetirla. Tras integrar main se repitieron las suites afectadas. CI Linux del PR completa la validación POSIX; no equivale a despliegue en VM.

- [x] **R01 · Secretos ocultables en el índice (ALTA).** Exclusión exacta de `.opencode`; se examinan todas las coincidencias aunque la primera sea de ejemplo y cada blob se pasa como registro estructurado, sin etiquetas falsificables con NUL. Evidencia prevista: `escaneo-estructurado.test.ts`, `acciones-git.test.ts` y `secretos.test.ts`.
- [x] **R02 · Cambio de archivo entre validación y streaming (ALTA).** PDF, imagen y video leen el descriptor ya validado, sin reabrir la ruta; se cierra al terminar, cancelar o fallar, también en consultas de metadatos y rangos inválidos. Evidencia: `binarios-descriptor.test.ts` y `media-routes.test.ts`.
- [x] **R03 · Merge sin tarea no ligado a revisión (ALTA).** Toda tarjeta guarda el SHA aprobado y lo exige en el PUT; las tarjetas anteriores sin SHA requieren nueva revisión. Evidencia: `acciones-git.test.ts`.
- [x] **R04 · Proyecto borrable durante trabajo pendiente (ALTA).** Se bloquea el borrado durante analyzing, waiting_approval, queued, running, reservas de chat y acciones Git ejecutándose. Evidencia: `proyectos.test.ts`.
- [x] **R05 · Línea de Codex sin límite de memoria (ALTA).** Tope de 2 MiB aplicado antes de parsear o propagar stdout; descarta la línea excesiva y permite procesar los eventos válidos siguientes. Evidencia: `codex-tokens-registro.test.ts`, `proteccion.test.ts`.
- [x] **R06 · Respaldo incompleto de sesiones y proyectos (ALTA).** Incluye perfiles de OpenCode/subagentes y proyectos registrados, con inventario de restauración; fotografía bases SQLite con WAL mediante VACUUM INTO. Los archivos normales se enlazan durante la preparación para evitar otra copia completa en disco. Evidencia: `respaldo-integral.test.ts` recupera código y sesión desde el archivo generado.
- [x] **R07 · Respuestas asíncronas modificaban otro chat (ALTA).** Adjuntos, dictado y aprobación capturan conversación y revisión del borrador; conservan el texto del chat abierto y las ediciones posteriores. Evidencia: Playwright `ui-smoke.mjs` en 390/1440 px y pruebas del borrador/dictado.
- [x] **R08 · Alcance omitía eliminaciones o excedía sus límites silenciosamente (ALTA).** Compara unión del inventario inicial/final de ignorados; ante más de 400 archivos, tamaño excesivo o lectura fallida detiene la comprobación conservando el trabajo. Evidencia: `alcance-ignorados.test.ts`.
- [x] **R09 · Un dispositivo sellaba entregas fallidas de los demás (MEDIA).** Migración aditiva 042: cola persistente por evento/dispositivo, leases recuperables y reintentos limitados en paralelo. Descarta avisos de planes/fallos ya resueltos sin borrar entregas previas. Evidencia: `push.test.ts`.
- [x] **R10 · Historial completo descargado y renderizado cada cuatro segundos (MEDIA).** Páginas SQL de 40 mensajes, cursores incrementales, reconciliación de mensajes retirados y ventana residente de 120; navegación a anteriores y exportación completa explícita. Evidencia: `chat-paginacion-preview.test.ts`, `chat-mensajes.test.ts` y Playwright.
- [x] **R11 · Primera cuenta acumulada de Codex descontada indebidamente (MEDIA).** Sesión nueva parte de cero; resume recupera línea base real y no factura historia desconocida. Evidencia: `codex-tokens-registro.test.ts`, `tokens-codex.test.ts`.
- [x] **R12 · Descendientes retenían tuberías tras terminar Codex (MEDIA).** Cierre del grupo y drenado acotado a cuatro segundos, conservando eventos de uso ya recibidos. Evidencia: `codex-tokens-registro.test.ts` y `codex-reintento.test.ts`.
- [x] **R13 · Tiempo de conexión sin servidor Bun efectivo (MEDIA).** El contexto HTTP enlaza el socket y `server.timeout` con la petición real. Evidencia: `conexion.test.ts`.
- [x] **R14 · Despliegue y respaldo podían competir con agentes y limpiezas (ALTA).** Candado flock común, pausa de admisión y contador de ejecuciones, clonados, instalación/login y limpieza; se incluyen las lecturas que preparan Git. Parada antes de modificar dependencias/build y rollback también al fallar el arranque. Una marca ajena se conserva. Evidencia: `despliegue.test.ts`, `despliegue-script.test.ts`, `respaldo-pausa.test.ts`, `mantenimiento-disco.test.ts`. La recuperación de una marca tras SIGKILL y el primer despliegue se documentan en `deploy/README.md`.
- [x] **R15 · HTML aislado no cargaba sus recursos relativos (MEDIA).** Acceso inicial autenticado; capacidad aleatoria temporal, revocable y ligada a sesión/chat/carpeta para CSS, módulos e imágenes. CSP sin conexiones a API, origen opaco y lectura por descriptor. Evidencia: `chat-paginacion-preview.test.ts` y `html-preview.mjs`, con cookie SameSite=Strict, CSS importado, módulos relativos e imagen en 390/1440 px.
- [x] **R16 · Aviso visible suprimido sin respetar preferencia y destino incorrecto (MEDIA).** Service worker espera confirmación explícita de la página; al faltar usa aviso del sistema. Etiqueta común evita duplicados y el destino usa `/tareas/:id`. Evidencia: `push-serviceworker.test.ts`, pruebas web de notificaciones y `push.test.ts`.
- [x] **R17 · R2 con cero copias locales terminaba en falso error (MEDIA).** Tamaños capturados antes de podar; solo se publican conjuntos DB+tar completos. Evidencia: `respaldo-integral.test.ts` ejecuta el CLI con almacenamiento simulado y retención local cero.
- [x] **R18 · Runtime OpenCode redirigible por enlace simbólico (ALTA).** Rechaza `.opencode` enlazado/junction; analizador usa runtime temporal tmpfs y no obtiene escritura en su workspace. Evidencia: `aislamiento.test.ts` y recorrido Linux en CI.

Evidencia Linux: [servidor del PR #122](https://github.com/PABLOCESAR2412/Orquestador/actions/runs/39970505720/job/120472073686), 593 ejecuciones aprobadas, 0 fallos; incluye worker con bubblewrap, los casos POSIX omitidos en Windows y restauración del fixture SQLite con WAL. El primer recorrido UI en CI encontró una aserción que leía el campo antes del commit asíncrono de React: la prueba espera ahora texto y persistencia observables, sin pausas de tiempo arbitrarias.

Pendientes operativos de este cierre (no sustituidos por mocks): instalar la regla sudoers de stop/start del despliegue y hacer la primera actualización con el servicio parado; probar respaldo/restauración completa de la VM sobre una copia; confirmar entrega en dispositivos reales. No se modificó la VM ni se usaron proveedores facturables para estas pruebas.

## Hallazgos — auditoría del 21 de octubre de 2026

- [x] **H1 · Escaneo de secretos solo por el diff textual (ALTA).** Con `.gitattributes` el agente podía ocultar contenido; ahora se escanea el blob del índice de cada archivo añadido o modificado (`archivosConSecretosEnBlobs`, topes por blob y total), con la prueba del binario escondido rechazado, y el escáner no bloquea tokens de prueba con marca evidente (ficticia, example…) porque los del dueño cuentan siempre. Evidencia: PR #102, `test: el escaneo de secretos ve el blob…` y `secretos.test.ts`.
- [x] **H2 · Tarea colgada retenía el slot (MEDIA).** Vigilante de inactividad en el runner de OpenCode: si el agente no emite ninguna línea en `TELO_TIEMPO_INACTIVIDAD_MS` (15 minutos por defecto; 0 lo apaga), se cierra el grupo y la tarea falla con un mensaje claro. El drenado al abortar ya contaba el uso (los eventos pendientes se parsean igual), no hizo falta código nuevo. Evidencia: PR #102.
- [x] **H3 · Base sin techo y `repository_actions` sin índices (MEDIA).** Migración `039_indices_repository_actions` (tarea+acción+estado, conversación+fecha, proyecto+estado+fecha) y `purgarHistorial()` en el ciclo de limpieza: borra eventos, planes, aprobaciones y solicitudes de tareas terminadas hace más de `TELO_RETENCION_DIAS` (120 días por defecto; 0 la apaga). Las tareas se conservan: son la historia del usuario. Evidencia: PR #102, `retencion.test.ts` (7/7).
- [x] **H4 · Guías no llegaban en tareas sin proyecto (MEDIA).** `conInstrucciones` lee los documentos guía del workspace (`AGENTS.md`, `CLAUDE.md`, `README.md`) y antepone hasta 8 KB al prompt. Evidencia: PR #102, `mejoras-arquitectura.test.ts` (8/8).
- [x] **H5 · Suite inservible en Windows (MEDIA).** Causa raíz: `db` singleton abierto una vez por proceso (el primer `DATA_DIR` de prueba ganaba y un `db.close()` rompía el resto: dominó de 103 fallos). Ahora `db` es un Proxy ligado al `DATA_DIR` vigente: reabre al cerrarse y aplica migraciones por apertura; `clave-ssh` anotada `skipIf` en Windows (ejercita OpenSSH POSIX, se verifica en el VM) y `media-routes` cierra la base antes de borrar su carpeta. Evidencia: PR #102, suite completa 485 tests, 0 fail.
- [x] **H6 · Evento `conflictos_pr_preparados` y errores crudos en la tarjeta (BAJA).** Etiqueta «PR preparado: conflictos por resolver» y `textoErrorTarea` que traduce los códigos guardados a frases. Nota: la etiqueta del evento entró también por el PR #103 y quedó deduplicada en el rebase. Evidencia: PR #102 (+#103).
- [x] **H7 · Web Push — fase 8 (MEDIA).** Notificaciones que valen sin la app abierta: claves VAPID autogeneradas y cifradas, suscripción por dispositivo (`push_subscripciones`), envío al fallar, al pedir aprobación y al terminar, dedupe por evento (`push_enviados`) y receptor en el service worker (`push-listener.js`); no duplica el aviso si la app está visible y da de baja las suscripciones vencidas (404/410). Evidencia: PR #105, `push.test.ts` (claves cifradas, validación, dedupe, caducidad), suite 492 tests, 0 fail.
- [x] **H8 · Registro y gobernanza de disco (BAJA).** Optimización específica en PR #106 aplicada en la VM: el usuario confirmó el retiro de 130 carpetas y 16 GB disponibles (46 % usado). El registro unifica hallazgos, fases y operativa.

### Análisis menores de la auditoría (mejoras sin bloqueo)

- [x] **A-m1 · Drenado al abortar (tokens).** Verificado que los eventos pendientes se siguen consumiendo y registrando tras el rechazo: no perdió uso; no hace falta cambio.
- [x] **A-m2 · Tokens incrementales de Codex (22-oct).** El CLI emite `token_count` con la cuenta acumulada mientras corre el turno; si la ejecución muere a mitad de turno, el uso real quedaba sin registrar (y el resultado se estimaba). Ahora al terminar —éxito, fallo o cancelación— se registra el delta no contado por ningún turno completado, descontando lo ya registrado y el historial que traen los `resume` (nunca se cuenta dos veces). Evidencia: PR #109, `tokens-codex.test.ts` y `codex-reintento.test.ts`.
- [x] **A-m3 · Desalineación de documentación.** AGENTS.md citaba «migración 019» como vigente y decía que faltaba probar OpenCode real en el VM (ya corre real); corregido y desalineación de migraciones resuelta aquí. Evidencia: PR #102.
- [x] **A-m4 · Higiene del repo local.** `main` local quedó rezagada frente a `origin/main` y ~47 ramas locales viejas; se adelanta `main` con avance rápido y se archivan las ramas sin fusión como `archivo/<rama>` (equipo local, no va por PR).
- [x] **A-m5 · Títulos en modelos que la cuenta no tiene (22-oct).** El `opencode.json` del tiempo de ejecución no fijaba `small_model`: para los títulos de sesión y la compactación, OpenCode escoge «un modelo barato del catálogo del proveedor» y caía en `gpt-5.4-nano` (402, fuera del plan) o `big-pickle` (429, límite del free tier) aunque la tarea usara DeepSeek. Ahora se fija al modelo elegido por el usuario. Hallazgo desde el registro de inferencia del proveedor (429/402 con modelos que nadie pidió). Evidencia: PR #105, prueba en `conexiones-mcp.test.ts`.
- [x] **A-m6 · Aislamiento de pruebas: falsa alarma local y guard sin preload (22-oct).** Tras fusionar, un test de A03 parecía fallar en un corredor local; la revisión lo cierra como falsa alarma: `server/bunfig.toml` ya carga el preload al correr desde `server/`, y el fallo provenía de un checkout situado dentro del directorio temporal — el guard admite cualquier base bajo el TMP, mientras que en el VM el checkout vive fuera. Endurecimiento de la revisión: el guard de `abrirBase` también se activa con `NODE_ENV === "test"` (bun test lo fija), de modo que no duerme si el preload no cargara; test de regresión que borra la bandera y espera el mismo rechazo. Evidencia: PR #108, `auditoria-regresiones.test.ts` (9/9).
- [x] **A-m7 · Sensibilidad local de `acciones-git` (22-oct).** En 3 de 5 corridas locales, 3 tests rotativos de `acciones-git.test.ts` fallaban con tope interno de 15 s en `aprobarTarea`/`pedir`, con distinto conjunto en cada corrida y CI verde en los mismos commits: sensibilidad a la carga del entorno, no un bug de Telo. Subido el tope interno de esos tests a 60 s; en el VM el margen es gratis porque suelen pasar en segundos. Evidencia: PR #109, suite completa 520 tests 0 fail y checks del PR.
- [x] **A-m8 · Reintentos del proveedor ante 429 y errores temporales (22-oct).** Revisado contra el estado actual: la política ya está construida a nivel `ejecutar` (#104) y no corresponde duplicarla en los runners. Tras «session not found» descarta la sesión y reintenta reconstruyendo el contexto del chat; ante 5xx reintenta una vez con 1200 ms y ante 429 transitorio (el de cuota va por su propio camino) con 2500 ms, pidiendo continuar donde quedó (`promptContinuacion`, sin repetir pasos); si sigue fallando recurre al modelo de respaldo de Ajustes con protección del plan gratuito (nunca salta solo a uno de pago) y deja el evento `modelo_respaldo` en la bitácora de la tarea. Lo primero que añadí fue un bucle de reintentos dentro de los runners; lo retiré: duplicaba esa política, gastaba su presupuesto antes de que actuara y rompía su suite `reintento-transitorio.test.ts` en CI (los tests del 5xx y del respaldo cuentan los intentos con un binario falso). Evidencia: PR #109 (bucle retirado) y check `servidor` con esa suite en verde.
- [x] **A-m9 · Notificaciones repetidas al reiniciar la app (22-oct, reporte del usuario).** Al abrir Telo volvían a sonar los avisos del pasado (tareas ya terminadas, la acción Git fallada, chats que piden atención). El hook de notificaciones guardaba «ya avisadas» solo en memoria del arranque y la primera aparición de un id contaba como transición, así que cada arranque trataba el estado viejo como novedad. Ahora la primera vez que se ve un id solo siembra el punto de partida (sin aviso): el estado que ya existía al abrir no suena y lo que cambia con la app abierta sí. Una tarea que ya corría se siembra una vez por sondeo (listTasks) para no perder su fallo posterior por eventos vivos, y el caso especial `git-*` aprobado quedó subsumido. Los avisos que valen con la app cerrada siguen llegando por Web Push cuando el evento pasa, sin retransmisión. El test pinneado de `web/tests/notificaciones-estado.test.ts` fijaba el comportamiento viejo («notifica pendientes iniciales») y se reescribió a esta expectativa (los 31 tests de la web, en verde). Evidencia: PR #110; build web ✓ y checks del PR.
- [x] **A-m10 · Barras de scroll nativas y compactación invisible (22-oct, pedido del usuario).** Dos reglas de diseño: (1) el reset global borraba la cara temática de las barras y en Windows aparecían las nativas grises (hilo, bloques de código, laterales); ahora toda barra usa los tokens del tema activo (`scrollbar-width/color` estándar + `::-webkit-scrollbar` de resguardo, pista transparente y pulgar `--bar`/`--line-strong` en hover). (2) La compactación automática del contexto funcionaba en todos los OpenCode run (`compaction: { auto: true, prune: true }`), pero solo se sabía abriendo «Ver proceso»: ahora el turno que compactó deja marca en su respuesta (migración 041, `marcarRespuestaCompactada`) y el hilo dibuja el hito «Sesión compactada · el contexto anterior se resumió para continuar» con los tokens del tema, tanto en chats sueltos como de proyecto y continuaciones. Evidencia: PR #111; prueba `mensajes-compactados.test.ts` (2 ✓), 31 tests de la web ✓ y builds ✓.

## Hallazgos — auditoría del usuario del 22 de octubre de 2026

El usuario pasó una lista de 22 hallazgos y pidió corregirlos: se tratan por tramos con PRs separados. El tramo 1 va en [PR #112](https://github.com/PABLOCESAR2412/Orquestador/pull/112) (sobre main, sin solape con el PR #111 pendiente de fusión); los tramos 2 y 3 quedan como trabajo pendiente al final de esta sección. En el mismo mensaje añadió dos hallazgos nuevos, resueltos también: el push que seguía apareciendo tras subir (va dentro del PR #112) y el dictado por voz ([PR #113](https://github.com/PABLOCESAR2412/Orquestador/pull/113), apilado sobre #112).

### Tramo 1 — Git, secretos y notificaciones ([PR #112](https://github.com/PABLOCESAR2412/Orquestador/pull/112))

- [x] **Escáner Git completo y bloqueo.** El pre-commit tomaba como mucho 400 archivos, 8 MB en total y 1,5 MB por blob, y un blob que no se podía leer se saltaba sin avisar: ahí cabía un secreto fuera de la revisión. Ahora se escanea el blob íntegro de cada archivo añadido o modificado, leído del índice (no pasa por los atributos del worktree que el agente escribe); si un blob no se puede leer completo o pasa el tope (16 MB por archivo, 64 MB en total, para no fundir la memoria), queda en `sinVerificar` y el commit se rechaza con `escaneo_incompleto` listando los archivos culpables. Nada entra a Git sin haberse revisado entero. Evidencia: PR #112, test «un archivo que el escaneo no puede verificar completo bloquea el commit» (17 MB rechazado).
- [x] **Tokens MCP y claves de proveedor en el filtro central.** La redacción y el escaneo solo veían los secretos del proyecto con sus patrones fijos: un token de conexión MCP o una clave de proveedor guardada en Ajustes podían salir en diffs, registros y commits. Ahora `valoresSecretosServidor()` (redaccion.ts) reúne claves de proveedor, la clave de la integración interna y los tokens MCP descifrados (`valoresTokensMcp()` en conexiones-mcp.ts), y entra en `redactar()` (todo lo que sale del servidor) y en los dos escáneres de commits, aunque el proyecto no declare el valor. Evidencia: PR #112, tests nuevos en `seguridad.test.ts` (token MCP y clave NVIDIA redactados y bloqueados).
- [x] **Merge ligado al SHA revisado.** La autorización de merge enviaba el PUT a GitHub sin `sha`; un push o amend posterior al visto bueno se fusionaba igual. Al decidir un merge se compara la punta del PR con el commit aprobado para la subida de la tarea (`task_approvals`, acción push): punta distinta → 409 `pr_cambiado` sin llamar a la API de fusión; punta igual → el PUT declara `sha` y GitHub valida en su lado. Merges sin tarea ligada quedan como estaban. Evidencia: PR #112, dos tests nuevos de merge en `acciones-git.test.ts`.
- [x] **Borrar un proyecto en ejecución.** DELETE /projects/:id quitaba registro y carpeta aunque hubiera una tarea `queued`/`running` del proyecto (carrera con el agente sobre la misma carpeta), y si el borrado físico fallaba solo lo registraba y borraba el registro, dejando la carpeta huérfana. Ahora responde 409 `proyecto_en_curso` si hay tareas en marcha o un chat activo del proyecto, y 409 `carpeta_no_borrada` sin quitar el registro cuando el disco no deja borrar. Evidencia: PR #112, tests de borrado en `proyectos.test.ts` (409 con tarea `running` y 200 sin ejecuciones).
- [x] **Cancelar conserva los ignorados.** El chequeo de copia limpia al cancelar miraba solo archivos no ignorados: con entregables tapados por `.gitignore`, el clon parecía limpio y se borraba con el trabajo dentro. El chequeo mira también los ignorados (`--ignored`), el mismo criterio que `limpiarCopias`: la copia cancelada se conserva mientras haya algo que revisar. Evidencia: PR #112, test de copia cancelada con entregable ignorado.
- [x] **Web Push sella tras la confirmación.** `avisarPush` registraba el evento como enviado ANTES de entregarlo; un 503 perdía el aviso para siempre. Ahora el sello va tras el primer 2xx: envíos en paralelo con 10 s de tope por endpoint, dos reintentos (1,5 s y 4 s) si todo falla con errores recuperables, y sin sello cuando nadie confirma. El dedupe por versión (`revisar#N`, cada replanificación avisa una sola vez y no bloquea la vuelta siguiente) completa el aprovechamiento. Evidencia: PR #112, `push.test.ts` (fallo transitorio no sella y el reintento entrega; versiones/revisar#1 y revisar#2).
- [x] **El service worker no calla sin permiso.** El receptor de push suprimía el aviso si alguna ventana estaba visible, aunque las notificaciones locales estuvieran bloqueadas: el aviso quedaba mudo. Solo calla si hay ventana visible y `Notification.permission === "granted"` (la página avisa por su cuenta); en otro caso el worker muestra la notificación él mismo. Evidencia: PR #112; revisión del listener en `web/public/push-listener.js`, sin pruebas de worker.
- [x] **El botón de push se apaga tras subir (hallazgo añadido por el usuario).** Tras un push exitoso la tarjeta de revisión seguía ofreciendo «Commit y subir»: la aprobación de push se registraba pero `pushVigente` exigía que el destino fuera exactamente la rama de la tarea (con destino «base» daba falso) y un rebase sobre la punta de la base podía además cambiar el SHA y desactivar `commitVigente`. El payload del diff ahora expone el hash del diff que se aprobó subiendo (`aprobaciones.push.hash`; la fila solo se escribe tras un push exitoso) y la tarjeta oculta el botón cuando ese mismo trabajo ya está subido, mostrando «Cambios subidos a X» con el destino; si luego hay cambios nuevos con otro hash, el botón vuelve porque es otro trabajo. Evidencia: typecheck y suites de push/acciones-git/proyectos (76 pass); CI al empujar el PR.

### Dictado por voz no funcionaba ([PR #113](https://github.com/PABLOCESAR2412/Orquestador/pull/113), apilado sobre #112)

- [x] **Dictado por voz reescrito con reanudación y sin duplicados.** El dictado no reanudaba el reconocimiento: el motor corta solo tras un silencio o cada ~60 s y al cortar el dictado terminaba a mitad de frase; además reconstruía el texto desde el resultado 0 de cada evento (los tramos confirmados podían duplicarse) y avisaba el `aborted` del motor como un error. Reescrito como controlador inyectable en `chat-dictado.ts` (`crearDictador`): reanuda tras el corte mientras el usuario sigue dictando con lo acumulado, separa tramos interinos y confirmados vía `resultIndex` (nada se escribe dos veces al confirmar un tramo), silencia `aborted`, corta con aviso en permiso denegado/red rota, evita que la instancia vieja mate a la nueva y que los resultados tardíos rellenen el compositor tras el envío, y si falta soporte (Firefox o página sin https) el botón —ahora siempre visible— explica el porqué con un aviso. Evidencia: `web/tests/chat-dictado.test.ts` (6 tests: composición sin duplicar, reanudación, instancia vieja, permiso, sin motor y mensajes); suite web 37 pass y build ✓; la prueba con micrófono real queda manual.

### Tramo 2 — estabilidad y robustez ([PR #114](https://github.com/PABLOCESAR2412/Orquestador/pull/114), apilado sobre #113)

- [x] **La salida del agente deja de crecer en RAM sin tope.** El stdout de OpenCode acumulaba un string sin límite; ahora hay tope de 16 MB conservando arranque (eventos de sesión) y cola (detalle del fallo) con marcador en medio, y el stderr y las líneas sin fin bajan con tope de 1 MB (`leerConTope` compartido en `runners/proteccion.ts`).
- [x] **Vigilante de inactividad y nivel de esfuerzo también en Codex, y chats con vigilante.** `iniciarVigilante` se extrae y Codex corta el grupo si lleva más del tope sin emitir nada (el error lo dice); el `variant` llega a Codex como `-c model_reasoning_effort=`; los turnos del chat heredan el mismo tope (`TELO_TIEMPO_INACTIVIDAD_MS`, 15 min por defecto).
- [x] **Streaming de binarios del proyecto.** PDF, imagen y MP4 ya no se cargan completos en RAM para responder: el validador lee solo la cabecera (1 KB) para verificar la firma y el servido va por `Bun.file(rutaReal)` con `slice()` para Range 206.
- [x] **Skills del proyecto sin enlaces simbólicos.** La copia al clon salta cualquier entrada simbólica (`copiarCarpetaSana` con `readdirSync`/`lstat`) y exige carpeta real de origen: un enlace copiado dejaría al agente escribir fuera de su sandbox.
- [x] **Tope de arranque de `index.ts`.** Si el proceso no llega a la escucha en `TELO_TOPE_ARRANQUE_MS` (120 s) sale con código 2 y diagnóstico claro en lugar de quedarse mudo.
- [x] **El alcance del plan vigila también los archivos ignorados.** `capturarAlcance` guarda el mapa de hashes de `git ls-files --others --ignored --exclude-standard` (excluidas `node_modules`, `.venv`, `target` y demás ruido; tope 400 archivos / 64 MB) y `comprobarAlcance` vuelve a hashear: un ignorado cambiado y no declarado sale como fuera del plan, el declarado queda permitido y si el listado falla es fail-soft. La visibilidad del dif en la tarjeta cuando solo hay cambios ignorados queda para el tramo 3.
- [x] **Reporte honesto con pruebas en fallo.** Si el propio reporte declara una prueba `fallo`, el servidor marca el estado como fallo con la nota de por qué; la desviación declarada por el agente no se toca.
- [x] **Verificación.** Typecheck del servidor; suite completa 473 pass / 62 skip / 2 fail (los 2 del guard local, falsa alarma); `plan.test.ts` +2, `alcance-ignorados.test.ts` +3 con repo Git real, `proteccion.test.ts` +3, `skills-seguras.test.ts` +1; trio de push/acciones-git/proyectos 76 pass tras el rebase; CI del PR.
- [x] **Las 2 pruebas del guard de base eran falsa alarma, cerrada con CI.** Fallan solo en Windows cuando la suite corre entera en el mismo proceso; con la misma punta, CI pasa («servidor: success» en el PR #112, commit ed5af1a). Precedente ya documentado en cambios (#108).

### Pendientes de esta auditoría

- [ ] **Tramo 3 — rediseños (PR posterior, un ítem por PR con su plan).**
  - Paginación del historial de conversaciones: `GET /conversations` con `antes=<cursor>` y `limite=50`, carga incremental en la barra lateral al llegar al fondo.
  - Borradores por conversación: mapa `conversationId → borrador` en localStorage con expiración e hidratación al entrar al chat, con aviso de recuperación.
  - Previsualización HTML de recursos de proyecto: reutilizar la vía `/archivo-html` (iframe de origen opaco que no hereda permisos) para los archivos del panel de recursos del proyecto, con CSP sin `connect-src` a la API.
  - `actualizar.sh` del VM: parada del servicio, pull de main, instalación de dependencias en server y web, build, migraciones y arranque con health check verificable.
  - Respaldo con inventario y restauración asistida: `scripts/respaldo.ts --inventario` (manifiesto con hash por conjunto) y `--restaurar <conjunto> --aplicar` con modo secado; checkpoint WAL para copiar SQLite de forma consistente (cubre además el M06 de perfiles-opencode).
  - Visibilidad de la tarjeta de revisión cuando el dif «se ve vacío» porque todo lo que cambió está en archivos ignorados.


## Auditoría del 22 de octubre: correcciones comprobadas

Entrega: [PR #104](https://github.com/PABLOCESAR2412/Orquestador/pull/104). Fusionado en main; no se certifica el despliegue por esta resolución.

- [x] **A01 — Respaldar y restaurar entregables independientes.** El tar incluye entregables y adjuntos. Regresión: respaldo real de SQLite/tar y recuperación del contenido del documento.
- [x] **A02 — Eliminar sesiones heredadas no revocables.** Solo se aceptan sesiones registradas; regresión: cookie HMAC rechazada, sesión nueva válida y logout efectivo. Las cookies antiguas requieren nuevo login.
- [x] **A03 — Aislar obligatoriamente las pruebas de la base local.** Preload obligatorio desde raíz y server, DATA_DIR temporal por ejecución y rechazo de bases fuera del directorio temporal. La suite que fallaba ahora pasa sin preparar variables a mano.
- [x] **A04 — Corregir excepciones del alcance del plan.** Excepción exacta de .opencode y comparación por contenido para tareas sin Git. Pruebas de prefijos parecidos con Git y sin Git aprobadas.
- [x] **A05 — Permitir previews HTML dinámicas con aislamiento efectivo.** Endpoint HTML autenticado con CSP sandbox y origen opaco. Playwright CLI con cabeceras reales: JavaScript activo y acceso a parent.document bloqueado con SecurityError; capturas a 390/1440 px.
- [x] **A06 — Hacer atómica la actualización de conversaciones.** Validación previa y escritura transaccional. Regresión: un 400 conserva título y anclado; actualización válida aprobada.
- [x] **A07 — Notificar nuevas transiciones aunque repitan estado.** Deduplicación por transición en lugar de historial eterno de estados. Regresión: failed duplicado no avisa, running → failed avisa otra vez; pendientes iniciales de chat/Git se recuerdan.
- [x] **A08 — Evitar cerrar herramientas activas por silencio del agente.** El vigilante considera CPU/IO del grupo de procesos, no solo stdout. Fixture /proc verifica actividad CPU e IO y ausencia de actividad. Integración real Linux pendiente.
- [x] **A09 — Resolver o mitigar las dos alertas de dependencias.** uuid fijado a 11.1.1; sprintf-js lleva parche versionado que acota precisión. Pruebas de buffer insuficiente y formatos extremos aprobadas. bun audit conserva un aviso por versión de sprintf-js: mitigado, no eliminado del catálogo.

### Fallo posterior de CI

- [x] **A10 — Telemetría del agente ficticio fuera del plan en Linux.** El fixture escribía llamadas.jsonl y el servidor actualizaba salida.log en el workspace. El comparador atribuía ambos al agente y replanificaba. Telemetría del fixture movida a .opencode/fixture-analizador; el worker excluye solo su salida.log en la raíz exacta de la tarea libre. Las regresiones comprueban que otros logs siguen detectándose. Regresiones locales aprobadas; CI servidor Linux aprobada en 0ce2997, ejecución 39827164211 (incluye analizador y worker).

### Investigación de demora del chat (22 de octubre)

- [x] **A11 — Chat directo sin actividad observable ni recuperación por silencio.** Corregido en el código vigente: los turnos libres pasan `tiempoSinActividadMs` al runner, que observa actividad del grupo de procesos; no hay límite de duración total. Si se atasca, falla con aviso y conserva la sesión para continuar. Evidencia: `server/src/routes/chat.ts`, `server/src/runners/proteccion.ts` y CI Linux de PR #122.
- [x] **A12 — Poco espacio libre en el VPS.** Resuelto con la optimización de PR #106, aplicada por el usuario: retiradas 130 carpetas de dependencias regenerables; medición posterior de 16 GB libres y 46 % de uso. El usuario confirma que las verificaciones de producción están completadas.
- Producción informa commit f94a33b50e21 (PR #103); este lote #104 todavía no estaba desplegado durante la consulta. La latencia visible osciló entre 115 y 964 ms: esos valores por sí solos no explican cuatro horas sin pasos registrados. El endpoint consultado no aporta CPU/RAM libre del sistema; no se atribuye el fallo a saturación de memoria sin medirla.

### Validación de este lote

- 57 suites independientes del servidor: 435 pruebas aprobadas, cero fallos, 61 omisiones de integración/plataforma. Dos regresiones finales adicionales (base fuera del temporal y .git inválido) también aprobadas: 437 casos distintos en total.
- TypeScript del servidor aprobado; 31 pruebas web aprobadas.
- Compilación y recorrido web completo aprobados a 390/1440 px, con el MP4 adjunto como fixture local de decodificación/envío.
- Preview HTML comprobada mediante Playwright CLI contra el servidor real aislado.
- [ ] Validar worker/bubblewrap y CPU/IO con procesos Linux reales; Android físico y restauración del conjunto R2 en el VPS.
- [x] **Sustituir el parche de sprintf-js cuando exista una versión oficial corregida — evaluado el 23 de octubre: no existe ninguna.** La última publicada sigue siendo 1.1.3 (setiembre de 2023) y el advisory [GHSA-hp3w-g68c-fv3c / CVE-2026-97058](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) (precisión sin límite en `toFixed`/`toExponential`) se **retiró el 22 de octubre de 2026** sin versiones corregidas: quedó en que la aplicación debe manejar la excepción. El parche local se mantiene porque acota la precisión a los límites de ECMAScript; si aparece una 1.1.4+ oficial con el arreglo, se sustituye y se retira el parche.
- No se restauraron ni eliminaron filas de las bases locales preexistentes; los nuevos tests obligan a usar temporales.

### Correcciones anteriores conservadas

- [x] Historial Git fuera del hilo y acciones ligadas al turno: cubierto por el recorrido web actual.
- [x] Navegación supervisor/subchat, selección de modelos, mensajes y aprobación Git: recorrido de interfaz a 390/1440 px.
- [x] Paletas, versiones y presentación de respuestas: suites web actuales.
- Los estados y pruebas originales permanecen abajo como archivo histórico. Las casillas operativas sin evidencia nueva siguen pendientes.

### Plan

1. Centralizar el historial sin perder contenido ni cerrar pendientes operativos sin prueba.
2. Corregir conservación de archivos, sesiones y aislamiento de pruebas.
3. Corregir alcance, API, previews, notificaciones y herramientas largas.
4. Revisar dependencias, ejecutar regresiones y actualizar cada estado.
5. Mantener pendientes las comprobaciones que requieren VPS, Linux o Android.

### Evidencia inicial

Commit a06b9bf: 55 suites (425 aprobadas, 1 fallo por base compartida, 61 omisiones). Suite aislada: 8 aprobadas. Web: 30 casos, build y Playwright 390/1440 px. Se reprodujeron sesión heredada tras logout, PATCH parcial, omisión de prefijos .opencode y bloqueo CSP del HTML. El respaldo omitía entregables. A07/A08 se detectaron por lectura de código. La suite defectuosa escribió fixtures en la base local: no se tocó el VPS ni se restauraron filas automáticamente.

## Despliegue que no separa interfaz y servidor — tramo 3

Entrega: [PR #121](https://github.com/PABLOCESAR2412/Orquestador/pull/121).

- [x] **Los cinco minutos no rompen el contrato.** Mientras haya ejecuciones en curso, `actualizar.sh` pospone el reinicio del servidor ciclo tras ciclo; antes la interfaz nueva quedaba igual servida ante un servidor anterior y el shell nuevo rompía con «Cannot read properties of undefined (reading 'find')». Ahora el script decide antes de compilar: si cambió `server/` y hay ejecuciones, trae el código pero no recompila la interfaz; las dos partes avanzan en el primer ciclo libre.
- [x] Los cambios que solo tocan la interfaz se siguen despliegando al instante (no tocan el contrato del servidor); el health check y la vuelta atrás quedan como estaban. Nota actualizada en `deploy/README.md`.
- Pruebas: `bash -n` válido y revisión de los cuatro casos (sin cambios, solo web, web+server con ejecuciones, web+server libres). La verificación final es operativa en el VM: al fusionar, el siguiente ciclo libre despliega server+web juntos.

## Historial que aguanta un servidor desactualizado — tramo 3

Entrega: [PR #120](https://github.com/PABLOCESAR2412/Orquestador/pull/120).

- [x] **Blinda el shell ante la mezcla de versiones.** El fallo de producción «Cannot read properties of undefined (reading 'find')» venía de pedir al shell la página del historial a un servidor anterior al paginado: el servidor viejo ignora `?limite=` y contesta el array plano, y el shell nuevo leía `.conversations` sobre él. `normalizaPaginaConversaciones` envuelve el array con `siguiente=null` para que ambas formen vistas; el error desaparece aunque el despliegue renueve interfaz y servidor en momentos distintos (el reinicio se pospone mientras haya agentes en curso).
- Pruebas: `web/tests/pagina-conversaciones.test.ts` (+3: página intacta, array plano envuelto, array vacío). Verificación local: `tsc` exit 0; web 51 pass/0 fail; build y humo PASS.

## Selector de modelos con buscador — tramo 3

Entrega: [PR #119](https://github.com/PABLOCESAR2412/Orquestador/pull/119).

- [x] **Buscador dentro de la lista.** El selector de modelos estrena la fila de búsqueda del mock (lupa + campo `type="search"` que ya estaba en los estilos sin uso): escribes y el catálogo se filtra en vivo por nombre, identificador, familia o nombre visible del proveedor, sin tildes ni mayúsculas de por medio («config» halla «Configuración»). Los resultados se agrupan por proveedor; «Tus modelos», «Predeterminado» y el aviso de inteligencia se esconden mientras escribes, y la sección Codex también filtra.
- [x] **Proveedor visible en cada fila.** Todas las filas, incluidas las de Codex, llevan un chip con el proveedor. El catálogo grande queda con tope de 120 resultados y una nota lo avisa cuando se trunca.
- [x] **Limpieza y estado vacío.** El botón ✕ restaura la vista completa y cuando nada coincide se dice «Sin resultados para «…»» en lugar de dejar la lista sin explicar.
- Pruebas: `web/tests/busca-modelos.test.ts` (+8: normalización sin tildes, coincidencia por campo y agrupado que conserva el orden). Humo: escribir «other» deja solo «Other Test» (chip «Groq API», contador «1 modelo disponible»), «inexistente» muestra el estado vacío y el ✕ restaura «Tus modelos». Web 48 pass/0 fail; `tsc` exit 0; build y humo PASS.

## Detener en caliente — correcciones de uso reportadas (PR #118)

- [x] Un microcorte del proveedor ya no rinde la tarea a mitad del trabajo. El 5xx/429 tenía un solo reintento a los 1,2 s: «Unexpected server error» repetido dejaba la tarea en «Requiere corrección» y el usuario tenía que decir «siga». Ahora hay hasta 3 reintentos con esperas crecientes (5xx: 1,2/10/30 s; 429: 2,5/15/45 s) y cada intento retoma la sesión ya abierta para continuar donde quedó; si se agota, el mensaje final lo dice («Telo lo reintentó automáticamente…») y remite a «Seguir» u otro modelo. La mejora cubre tareas y turnos de chat porque comparten motor de ejecución.
- [x] «Detener» recupera una ocupación huérfana. Si el chat figuraba respondiendo sin turno ni tarea viva (cierre raro del runner), la ruta devolvía «not_running» sin efecto; ahora libera la ocupación y publica el estado terminado. El botón sigue accesible mientras la petición está en curso. El abort del runner revisado línea a línea era correcto (grupo `setsid` por proceso); lo que faltaba era este estado.
- [x] Los avisos de archivos y adjuntos ausentes dicen qué pasó. Por la vía de mutaciones caían al mensaje genérico de 404 que empuja a recargar la página; ahora nombran el elemento (el agente pudo mover o borrar el entregable) y el texto genérico deja de culpar a la página. PR #118.
- [x] La voz se promete solo si la herramienta responde. La instrucción del chat y la skill de video piden verificar el TTS/MCP de voz antes de ofrecer narración; si no existe, se anuncia en la primera respuesta que irá sin voz, sin fingir resultados ni llamar servicios de pago.
- [x] Verificación: typechecks de servidor y web (exit 0); `cuota.test.ts` +1 (el envoltorio de reintentos no rompe la clasificación transitoria), `chat-turnos.test.ts` +1 (libera ocupación huérfana sin procesos, corre en cualquier entorno); par de ficheros 42 pass/0 fail; suite completa del servidor en el CI del PR.
- [ ] Si el aviso genérico de 404 vuelve a aparecer, anotar qué botón lo produjo (abrir un MP4/PDF, enviar mensaje…): el diagnóstico no identificó la ruta exacta y con ese dato se cierra el caso.

## Rediseño de borradores — sobrevivir a envíos interrumpidos (tramo 3)

Entrega: [PR #117](https://github.com/PABLOCESAR2412/Orquestador/pull/117). Segundo PR del tramo 3; alcance acordado con el usuario: el borrador de envío no se pierde aunque la app muera (recarga o cierre) entre vaciar el compositor y que el servidor confirme el mensaje.

- [x] **Marcador de envío en vuelo.** Al enviar el borrador (solo el envío directo; la cola ya era persistente y el drenaje retira el elemento solo tras la confirmación del POST), `chat.tsx` guarda en localStorage (`web/src/lib/chat-borrador.ts`, clave `telo:envio:<id>`) el texto que era el borrador y el contenido compuesto exacto. `onSuccess` lo borra (guardado confirmado) y `onError` lo borra tras restaurar el borrador como hasta ahora.
- [x] **Reconciliación al reabrir el chat.** Con la lista de mensajes cargada se decide una sola vez: si el último mensaje del usuario coincide con el contenido guardado, no se pinta nada que duplique y el marcador se retira; si no se guardó, el borrador se reconstruye (fusionando con lo ya escrito, leyendo el borrador persistido de ESE chat para evitar cruces al cambiar de chat). Restaurar tras saber que no se guardó evita pintar un borrador que haya que retirar a mitad de vista.
- Pruebas: `web/tests/chat-borrador.test.ts` (+3): borrador por chat, marcador completo y marcador corrupto/incompleto. Suite web 34/0; `tsc` limpio.
- Fuera de alcance anotado: los adjuntos ya subidos no se restauran al compositor (el texto sí); el feedback de revisión de plan no lleva marcador. Sin cambio de servidor.

## Rediseño del historial — paginación (tramo 3)

Entrega: [PR #116](https://github.com/PABLOCESAR2412/Orquestador/pull/116). Un PR por ítem del tramo 3; este es el primero (paginación del historial).

- [x] **Servidor.** `GET /api/conversations?limite=&antes=` responde `{ conversations, siguiente }` con el mismo orden del listado completo (anclados por `pinned_at` primero; luego `created_at` DESC con `rowid` como desempate; el corte se hace sobre la lista ya ordenada en JS con `conversations.conv_rowid` añadido a la consulta). El cursor codifica `anclado;pinned_at;created_at;rowid` de la ÚLTIMA fila entregada y la página siguiente empieza después de ella, así no se pierde ni se repite ninguna conversación entre tandas; cuando no queda nada detrás no se anuncia `siguiente`. Sin `limite` la respuesta sigue siendo el array completo: chat, notificaciones y selectores no cambian de contrato. Cursor inválido u hora malformada vuelve a la primera página en lugar de romper.
- [x] **Muelle web.** La consulta del sidebar pasa a la primera tanda de 50 (`["conversations","historial"]`, refresco de 5 s sin cambios) y acumula tandas con «Cargar anteriores»; la lista combinada quita ids repetidos (la primera tanda manda, para que un recién anclado que estaba en una tanda vieja no se vea dos veces), eliminar purga la conversación de las tandas cargadas y la búsqueda con filtro pide la lista completa por separado (`["conversations","buscar"]`), mientras llega muestra lo ya cargado para no parpadear. El chat (`chat.tsx`) y las notificaciones mantienen la lista completa y sus updates optimistas intactos.
- Pruebas: `server/tests/conversations-paginado.test.ts` (+6): lista heredada intacta, reparto con anclados y empates de fecha, resto con cursor y `siguiente` nulo, cursor inválido, `limite=0` heredado y cadenas completas sin perder ni repetir. TypeScript de servidor y web aprobado.
- Pendiente propio anotado: las tandas antiguas cargadas a mano no se refrescan al renombrar/anclar elementos que viven fuera de la primera tanda (solo se purgan al eliminar); refrescarlas por cursor queda para un ajuste posterior si se nota en uso.

## Hoja de ruta

Fuente histórica: PLAN.md.

### PLAN.md: hoja de ruta de Orquestador

Estado al 14 de octubre de 2026. Una fase no se marca como hecha hasta cumplir sus criterios de aceptación.

#### Visión

Lanzar tareas de IA desde el teléfono o la PC y dejarlas corriendo en un VM de forma continua. El sistema pide aprobación antes de tocar repositorios y avisa cuando una tarea falla, necesita aprobación o termina. Todos los proveedores (OpenCode, Google/agy, Codex) se gestionan desde una sola interfaz, con su cuota, costo y rendimiento.

#### Fases

##### 0. Base: hecho
- Servidor Hono, SQLite con migraciones e interfaz Vite/React en el VM, como servicio systemd.
- Chat con OpenCode: sesiones con contexto, y tokens y costo por mensaje.
- **Criterio:** el servicio sigue corriendo al cerrar la sesión SSH o apagar la PC.

##### 1. Chat moderno: hecho
- Selector de modelo con medidor de costo, esfuerzo por modelo y barra lateral.
- **Criterio:** funciona a 390 px y 1440 px, sin scroll horizontal.

##### 2. Tareas en segundo plano: hecho (PR #4)
- Cola de hasta diez tareas independientes en paralelo; las tareas del mismo proyecto se serializan. Cancelar mata el árbol de procesos. Al arrancar, las que seguían en ejecución pasan a `interrupted`.
- **Criterio:** cancelar una tarea con un proceso hijo (`sleep`) termina en pocos segundos, sin quedar colgada.

##### 3. App instalable, analíticas y ajustes: mergeada (PR #5)
- PWA instalable. Analíticas: KPI, costo por día y por modelo, presupuesto del mes. Ajustes: modelo, esfuerzo, presupuesto y aviso.
- **Pendiente de validar en el VM:** que la migración `004_settings` esté aplicada y que `GET /api/preferences` responda 200.
- **Criterio:** la app se instala desde HTTPS en el teléfono.

##### 4. Rediseño visual: en curso
- Sistema de diseño en `DESIGN.md`. Pantallas generadas en Stitch con `docs/design/STITCH_PROMPT.md`. `impeccable` como guía de revisión.
- Revisión automática del 14 de octubre: 32 capturas (8 vistas, 390 y 1440 px, claro y oscuro) sin desbordes horizontales ni errores de consola. Falta revisar el resto a ojo y el contraste AA.
- **Criterio:** las cinco pantallas revisadas a 390 px y 1440 px. Contraste AA. Solo tokens de color. Sin cambios de comportamiento.

##### 5. Analizador y obrero por tarea: mergeada (PR #28). OpenCode real corre en el VM
- Migración `019_analizador_obrero`: la tabla `tasks` se reconstruye con los estados `analyzing` y `waiting_approval`, y las columnas `plan`, `reporte` y `plan_aprobado_en`. Es la única migración que se aplica con claves foráneas apagadas (`sinClaves`); el runner comprueba la integridad antes de confirmar. El historial (`task_events`) y las aprobaciones (`task_approvals`) se conservan.
- El analizador produce un plan en JSON (`server/src/plan.ts`). Si el plan pide commit, push o PR, o trae preguntas, la tarea espera en `waiting_approval`. Si no, pasa directo al obrero.
- El obrero ejecuta solo el plan aprobado, en la misma sesión y carpeta que el analizador, y guarda un reporte en JSON. Si se desvía, la tarea vuelve al analizador con el motivo; el plan se replanifica hasta `MAX_PLANES` (3 versiones) y después la tarea falla.
- Rutas: `POST /api/tasks/:id/aprobar-plan` (acepta notas para el obrero) y `POST /api/tasks/:id/rechazar-plan`.
- Pruebas: `server/tests/plan.test.ts` (funciones puras) y `server/tests/analizador.test.ts`, que corre el flujo completo con un `opencode` falso (`server/tests/fixtures/bin/opencode`).
- Estado real: la BD del VM registra sesiones de OpenCode reales en 35 tareas de la fase (19 falladas, 16 terminadas), con trazas y reportes. Pendiente como señalización: observar el cierre por silencio del vigilante de inactividad en tareas colgadas.

##### 6. Proyectos de GitHub
- Estado: mergeada (PR #14), con integración posterior de GitHub App. Cada tarea de un proyecto Git trabaja en su clon (`telo/<id8>`). Aprobación de commit y push ligada al hash del diff; escaneo de secretos antes del commit; la GitHub App vinculada emite tokens breves limitados al repo para clonar, subir y abrir PRs. Prueba real en Test (16 oct. 2026): clonado privado, commit y push completados con la App; falta resolver el 422 de creación de PR en el VM desplegado. Sigue pendiente probar un agente real.
- La clave privada de la GitHub App vive en el VM, fuera del repo y legible solo por el servicio. La instalación se limita a los repositorios seleccionados.
- Clonar repos en el VM. Cada tarea corre en el workspace de su proyecto.
- Antes de commit, push o PR, mostrar el diff en la app y pedir aprobación.
- **Criterio:** el token nunca aparece en logs ni en respuestas de la API. No hay push sin aprobación registrada.

##### 7. Login de proveedores desde la app
- Codex inicia sesión mediante el flujo de dispositivo. Gemini usa la clave de AI Studio configurada como proveedor.
- La conexión OAuth de cuenta Google se retiró: solo almacenaba una autorización y no alimentaba el uso de modelos ni sus métricas.
- **Criterio:** al terminar el flujo, el proveedor aparece como conectado. Ninguna clave se pega en la interfaz.
- **Antes de implementar:** investigar los comandos de login de cada CLI en el VM.

##### 8. Notificaciones
- Estado histórico: pendiente al redactar este plan. Actualización del 22 de octubre: Web Push implementado en PR #105; validación de entrega real con app cerrada pendiente en Android. Telegram y Discord quedan fuera por decisión del usuario.
- Web Push (u otro canal) al fallar, al necesitar aprobación y al terminar una tarea. Es lo único que queda de esta fase: requiere claves VAPID, suscripciones por dispositivo y su protocolo de cifrado (RFC 8291).
- **Criterio:** cada evento notifica una vez. Reabrir la app no repite las notificaciones.

##### 9. Acceso seguro (Tailscale)
- Estado: el servidor escucha en `127.0.0.1` por defecto (`TELO_ESCUCHAR`). Pendiente en el VM: probar desde el teléfono, confirmar que `tailscale serve` sigue activo tras reiniciar y desactivar la expiración de la clave.
- Telo corre en el VM y solo es accesible desde los dispositivos de la red privada de Tailscale, con HTTPS por `tailscale serve`.
- El login de Telo (`TELO_CLAVE`) sigue activo como segunda capa: Tailscale decide quién llega al servidor; Telo decide quién puede operarlo.
- Verificado desde la PC: la cookie sale con `Secure`, `HttpOnly` y `SameSite=Strict` a través de `serve`.
- Pendiente: probar desde el teléfono; desactivar la expiración de la clave del VM; comprobar que `serve` sigue activo tras reiniciar.
- **Criterio:** PC y teléfono abren la app desde cualquier red. Sin Tailscale, la URL no resuelve. El puerto 3000 no está abierto en el NSG.
- Por ahora no se usa Funnel (acceso público): exigiría endurecer la app antes de publicarla.

##### 10. Cuota y saldo de proveedores
- Estado: `GET /api/uso` y el botón «Uso» junto al modelo muestran el gasto y los tokens de las últimas 5 horas y de los últimos 7 días medidos por Telo. Los límites del proveedor no se leen de su API; se muestran como «medido por Telo».
- Primera versión en `feat/chats-gestion` (migración `008`): el usuario anota el saldo de cada cuenta o clave y Telo resta el uso que registró después. Es estimado. Ningún proveedor se consulta en vivo.
- Panel con saldo o cuota restante por cuenta o API (OpenCode, OpenRouter, Groq, NVIDIA, Google, Codex) y tiempo restante estimado.
- Decisión del usuario: consultar saldo o cuota antes que poner un tope de gasto por tarea.
- **Criterio:** cada proveedor muestra la fecha de su última consulta. Si no hay API de saldo, se marca como manual.

##### 11. Proyectos: memoria, skills y AGENTS.md
- Estado: completada. Instrucciones, skills `SKILL.md`, memoria y `AGENTS.md` por proyecto se incorporan al contexto del agente; las skills globales se resuelven para todos los runners. Las tareas sin proyecto leen los documentos guía (`AGENTS.md`, `CLAUDE.md`, `README.md`) de su propio workspace y los antepone al prompt.
- Cada proyecto tiene su configuración: skills en formato `SKILL.md`, memoria que el sistema actualiza sola y su propio `AGENTS.md`.
- **Criterio:** una tarea del proyecto X usa sus skills y su memoria. Cambiar de proyecto no mezcla contexto.

##### 12. Runners por proyecto
- Estado: parcial. OpenCode y Codex comparten la interfaz de ejecución y trabajan dentro del aislamiento del agente. Agy no está integrado y los runners aún no se aíslan en contenedores independientes por proyecto.

##### 13. Panel del VM
- Estado: parcial. La pestaña Servidor en Ajustes muestra estado del proceso, carpetas y tamaños, herramientas instaladas, costos, uso y latencia medida en el navegador. Pendiente: terminal web (no se decide aún si reemplaza a Cockpit).
- Configuraciones del servidor desde la app y terminal web integrada. Evaluar si reemplaza a Cockpit (puerto 9090) o solo lo enlaza.

#### Decisiones tomadas

- Stack: TypeScript, Bun, SQLite, PWA. Sin Next.js.
- Acceso: Tailscale. Cloudflare se descartó (Workers VPC no está disponible en la cuenta) y el Quick Tunnel no sirve como acceso fijo.
- Hasta diez tareas independientes corren en paralelo; las tareas del mismo proyecto se encolan entre sí.
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

#### Orden de trabajo

Según la revisión del 10 de octubre, el núcleo es el motor de tareas, el aislamiento del runner, la aprobación y la recuperación. Antes de ampliar proveedores o interfaz:

1. Seguridad del runner: entorno sin secretos, cancelación por grupo de procesos. (`fix/runner-seguridad`)
2. Estados formales y recuperación: `interrupted`, reanudar, reintentar o cancelar. (`006` aplicada. Reanudar y reintentar, en `feat/chats-gestion`, pendiente de revisión.)
3. Registro de eventos por tarea, para depurar, auditar y alimentar notificaciones. (`009`, en `feat/chats-gestion`.)
4. Fase 5 (analizador y obrero, PR #28) y fase 6 (Git con aprobación en el backend, PR #14): mergeadas. Falta probarlas con OpenCode real en el VM.
5. Respaldos de la base y del workspace fuera del VM. (`server/scripts/respaldo.ts`, timer en `deploy/` y copia a la PC. Probado en local; falta probar el timer en el VM.)
6. Fase 9 (acceso por Tailscale) y pendientes de la sección de acceso.
7. Fases 10, 8 y 13: cuota con niveles de precisión, notificaciones por eventos y panel del VM sin terminal web.
8. Fase 4 (rediseño visual) y proveedores adicionales.

#### Preguntas abiertas

- ¿El panel del VM dentro de la app reemplaza a Cockpit o solo lo enlaza?
- ¿Qué proveedores tienen API de saldo y cuáles se consultan a mano?
- ¿La memoria del agente se actualiza sola o solo con aprobación? La revisión recomienda separar observaciones de memoria aprobada.


## Pendientes anteriores

Fuente histórica: TODO.md.

### Pendientes y verificación

Revisión: 22 de octubre de 2026. Una casilla marcada indica la comprobación descrita, no una validación implícita en producción. El historial anterior está en Git.

#### Fiabilidad de la aplicación

- [x] Inicio por código de dispositivo de Codex: enlace sin ANSI, código visible y copiable; pruebas y revisión a 390/1440 px.
- [x] La detección de sesión consulta `codex login status`, con límite de tiempo y caché breve; no acepta un archivo de configuración como prueba de autenticación.
- [x] El worker comprueba herramientas antes de llamar a un modelo. Los avisos sobre dependencias ausentes se guardan y se entregan al analizador para preparar su instalación antes de las pruebas.
- [x] Las autorizaciones Git se vinculan al mensaje que las originó; repetir una decisión no repite la operación.
- [x] Los reportes JSON antiguos muestran resumen y causa; los detalles se despliegan y los bloques de memoria no se muestran. No se evalúan expresiones del modelo.
- [x] Métricas: tokens medidos, costes estimados, datos ausentes e históricos sin precisión identificada. Uso por tarea en ejecuciones recientes; la memoria sigue incluida en la tarea y no se atribuye dos veces.
- [x] CI definida para cada PR: tipos, suites aisladas del servidor, worker Linux, build y navegador a 390/1440 px. Confirmar la ejecución concreta en el PR antes de fusionar.

#### Prueba real de GitHub App en el VM

- [x] Repositorio desechable autorizado: `https://github.com/PABLOCESAR2412/Test.git`; confirmado privado y vacío por GitHub.
- [x] Configurar `TELO_GITHUB_APP_ID` y `TELO_GITHUB_APP_PRIVATE_KEY_PATH` en el servicio, vincular la instalación en Ajustes e incluir Test en su alcance.
- [x] Inicializar la rama base de Test con README, commit `e0cafee891fcc20c4f369faebf5067041aa54aa0`. Preparación mediante la cuenta de GitHub; no demuestra autenticación con la App de Telo.
- [x] Desde Telo, clonar Test privado con la GitHub App, crear el cambio mínimo y autorizar commit/push. GitHub confirma la rama `telo/0e680496`, el commit `325247bef1fee13ef793813f1f924d2de744984e` y el autor `telo-orquestador[bot]`.
- [ ] Crear un PR de Test. GitHub respondió 422 en la versión desplegada y Telo ocultó el cuerpo de validación; el código de este PR ahora conserva ese detalle. No se fusionó ni se tocó Cubo. Reintentar una vez que el PR #53 esté desplegado; no repetir solicitudes mientras el motivo siga sin diagnóstico.

#### Verificación operativa después del despliegue

- [ ] Confirmar en el VM la migración 039 (índices de `repository_actions`) y la copia previa en `DATA_DIR/respaldos-migracion`; comprobar que se conservan los valores históricos.
- [x] En el VM el worker corre el runner OpenCode real (tareas terminadas y fallidas de la última fase; clonado, cancelación y reanudación incluidas en los ciclos). Falta observar los cierres del nuevo vigilante de inactividad en tareas colgadas. Las pruebas automáticas usan un agente ficticio.
- [ ] Confirmar acceso desde el teléfono por Tailscale y arranque de app, Serve y respaldos tras reiniciar el VM.
- [ ] Confirmar `TELO_PROYECTOS_DIR`, escucha en loopback, clave de cifrado respaldada y desactivación de expiración de la clave Tailscale del VM.
- [ ] Revisar contraste AA en todas las pantallas, además de las comprobaciones automáticas de desbordes.
- [ ] Confirmar presupuesto y alertas de Azure. Revisar ramas remotas y claves SSH antiguas antes de eliminarlas.

#### Acceso de desarrollo

La prueba de acceso de GitHub App en Test se completó para clonado, commit y push. Falta que el flujo desplegado muestre el motivo del rechazo 422 para completar la creación del PR. No compartir claves privadas, tokens ni archivos de sesión en el chat.


## Archivo histórico: fase 2

Fuente histórica: FASE2.md.

### Fase 2: seguimiento de cambios

> Registro histórico. Los estados, cantidades y harnesses de esta fase describen la revisión original; las rutas `scratchpad/` eran locales y no están en el repo actual.

Rama: `feat/seguir-tras-cuota` (creada desde `feat/proyectos-tarjetas`, commit 507f01c).
La fase A está en commit `7a93c2b` y subida a `origin`. La fase B está en el árbol de trabajo, sin commit. No hay PR.

Leyenda: [x] hecho y verificado · [~] hecho, pendiente de confirmar en el VM · [ ] pendiente

---

#### A. Detener al agotarse la cuota y botón "Seguir"  ✅ terminada

##### A1. Servidor

- [x] `server/src/runners/opencode.ts`: clase `ErrorAgente` con `detalleProveedor`, y función `detalleDelProveedor()` exportada. Usa el evento de error del proveedor o, si no hay, la cola de `stderr` sin rutas. Así una carpeta llamada "cuota" o "saldo" no marca cuota por error.
- [x] `server/src/ejecutar.ts`:
  - `PATRON_CUOTA`, `ErrorCuota(modelo, sessionId)`, `esErrorDeCuota()`. Solo mira `detalleProveedor`.
  - `promptContinuacion(prompt)`: prefijo "Continúa donde te quedaste…".
  - `ejecutarAgente`: el `catch` convierte en `ErrorCuota` los errores de cuota, también cuando falla el modelo de respaldo.
- [x] `server/src/db/index.ts`: migración `020_cuota_seguir`. Reconstruye `tasks` (estado `sin_cuota`, columnas `modelo_agotado` y `continuar`) y añade `conversations.cuota_modelo`.
- [x] `server/src/worker.ts`: `pausarPorCuota()`, `promptDeFase()` y `cancelTask()` acepta `sin_cuota`.
- [x] `server/src/routes/tasks.ts`: `POST /api/tasks/:id/seguir` (body `{model?, effort?}`). Rechaza el mismo modelo con `modelo_sin_cambio`.
- [x] `server/src/routes/chat.ts`: `ejecutarTurno()` compartido entre enviar y seguir; `POST /api/conversations/:id/seguir`; `GET /api/conversations` devuelve `cuota_modelo`; un envío exitoso lo limpia.
- [x] `server/src/eventos.ts` (tipos `sin_cuota`, `seguida`) y `server/src/routes/analytics.ts` (`sin_cuota` en `TASK_STATUSES`).

##### A2. Web

- [x] `web/src/api.ts`: tipos nuevos y `api.continueTask()`, `api.continueChat()`.
- [x] `web/src/lib/model.ts`: etiquetas y mensajes en español.
- [x] `web/src/components/cuota-aviso.tsx` (nuevo): `AvisoCuota`, compartido por tareas y chats.
- [x] `web/src/styles.css`: bloque `.cuota-aviso` y `.cuota-selector` al final del archivo. Ámbar solo en el borde.
- [x] `web/src/pages/tasks.tsx`: estado "Sin cuota · elige modelo", cancelar desde la tarjeta, aviso y selector de modelo en el detalle, y el error genérico oculto en `sin_cuota`.
- [x] `web/src/pages/chat.tsx`: `cuota_agotada` en `GUARDADO_EN_ERROR` (el mensaje no vuelve al borrador), `sendError` no repite el aviso, mutación `seguirChat`, aviso debajo de la conversación.
- [x] `web/src/lib/notificaciones.ts` (aviso de sistema) y `web/src/components/tarea-pasos.tsx` (paso final "Sin cuota").
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`).

##### A3. Pruebas

- [x] `server/tests/cuota.test.ts`: 13 pruebas (clasificación, migración, rechazos de seguir).
- [x] Punta a punta con servidor real y `opencode` falso (harness local no versionado): 25 de 25 en esa revisión.
- [x] Revisión visual con un harness local no versionado a 390 y 1440 px, claro y oscuro.

##### A4. Problemas encontrados y resueltos

- La clasificación de cuota leía el mensaje completo, que incluye rutas del servidor. Una carpeta "cuota-…" hacía que cualquier fallo se viera como cuota. Ahora solo cuenta lo que dijo el proveedor (ver A1).
- El selector de modelo del detalle de tarea abría fuera de la pantalla: el contenedor no era posicionado. Se corrigió con `.cuota-selector`.
- Las capturas al principio mostraban la versión anterior porque `web/dist` no se había reconstruido. Regla: reconstruir antes de revisar.

##### A5. Pendiente de confirmar en el VM

- [~] La detección de cuota usa patrones (429, "rate limit", "quota", "usage limit", "insufficient", "saldo", etc.). El texto exacto que devuelve OpenCode con un modelo sin cuota no está verificado. Hay que comprobarlo con un modelo real agotado. Si el texto no coincide, la tarea queda en `failed` como antes: no hay regresión, pero no se detiene con aviso.
  - Cómo: en el VM, provocar una cuota agotada con un modelo de prueba y revisar `task_events` y la salida de la tarea (`journalctl -u orquestador`).
- [x] El respaldo ante saturación se decide por un estado HTTP transitorio explícito en `esErrorTransitorioDelProveedor`; la regla amplia antigua se retiró.

---

#### B. Claves de Groq, NVIDIA y Gemini  🟡 hecha en servidor y web; falta confirmar en el VM

##### Nombres de variable

- Groq: `GROQ_API_KEY`. Confirmado en la documentación de OpenCode.
- Gemini: se envían **dos** variables, `GOOGLE_GENERATIVE_AI_API_KEY` y `GEMINI_API_KEY`. La nota anterior que daba solo `GEMINI_API_KEY` venía de un mirror de la versión antigua en Go de OpenCode; la versión actual probablemente usa `GOOGLE_GENERATIVE_AI_API_KEY` (no verificado). Enviar las dos evita depender de la versión. Confirmar en el VM con `opencode models` (id de proveedor `google`).
- NVIDIA: `NVIDIA_API_KEY`. Solo aparece en un artículo de terceros: **no confirmado**. Ver B-VM.

##### Servidor

- [x] `server/src/claves-proveedor.ts` (nuevo): almacenamiento cifrado con AES-256-GCM, AAD `proveedor:<id>`, misma clave maestra `TELO_CLAVE_CIFRADO` que los secretos. Nunca devuelve valores. `entornoProveedores()` entrega las variables al agente y a `opencode models`.
- [x] `server/src/db/index.ts`: migración `021_claves_proveedor` (tabla `provider_keys`).
- [x] `server/src/routes/claves-proveedor.ts` (nuevo): `GET /api/claves-proveedor`, `PUT /api/claves-proveedor/:id` (body `{valor}`), `DELETE /api/claves-proveedor/:id`. Códigos de error: `proveedor_desconocido`, `clave_proveedor_invalida`, `proveedor_sin_clave`, `secretos_no_configurados`. Cada cambio invalida la lista de modelos. Montado en `server/src/index.ts`.
- [x] `server/src/ejecutar.ts`: las claves entran como `extraEnv` de cada ejecución y se ocultan en la salida (`valoresAOcultar`). Si un secreto de proyecto tiene el mismo nombre, gana el del proyecto.
- [x] `server/src/models.ts`: `opencode models` recibe las claves (`entornoDelCli()`); `invalidarModelos()`. Nunca recibe variables `TELO_*`.
- [x] `server/src/routes/providers.ts`: cada proveedor dice `configured`, `enAgente`, `guardable`, `guardada`, `variable`. Nunca el valor. Groq, NVIDIA y Gemini quedan `implemented: true`.

##### Web

- [x] `web/src/api.ts`: tipo `ProviderStatus` con `guardable` y `guardada`; `api.setProviderKey()` y `api.deleteProviderKey()`.
- [x] `web/src/pages/settings.tsx`: en Ajustes > Proveedores IA, cada proveedor guardable tiene un campo de clave (`CampoClave`) con Mostrar/Ocultar, Guardar y Quitar. Enter guarda sin enviar el formulario de preferencias.
- [x] `web/src/lib/model.ts`: mensajes en español para `proveedor_desconocido`, `clave_proveedor_invalida` y `proveedor_sin_clave`.
- [x] `web/src/styles-ajustes.css`: `.aj-clave-fila`.
- [x] `web/src/cambios.json`: entrada nueva (tipo `mediano`).

##### Pruebas

- [x] `server/tests/claves-proveedor.test.ts` (nuevo): 21 pruebas. Guardar y leer, valor cifrado en la base, sin clave maestra, clave que no descifra, validación, estado sin valores, redacción, rutas y `GET /providers`.
- [x] `server/tests/entorno-proveedores.test.ts` (nuevo): 3 pruebas de punto a punto con un `opencode` falso. El agente y `opencode models` reciben `GROQ_API_KEY`; ninguno recibe `TELO_*`; la clave que el agente imprime sale oculta en su respuesta.
- [x] `bun test` del servidor: 203 pasan, 0 fallan.
- [x] `tsc --noEmit` del servidor y `bun run build` de la web: pasan.
- [x] Revisión visual con un harness local no versionado a 390 y 1440 px, claro y oscuro: sin desborde horizontal ni errores de consola.

##### Pendiente de confirmar en el VM (B-VM)

- [ ] NVIDIA: con `NVIDIA_API_KEY` guardada, ejecutar `opencode models --verbose` (con el mismo entorno del servicio) y comprobar que aparecen modelos `nvidia/...`. Si el nombre de variable o el proveedor son otros, corregir `PROVEEDORES_CON_CLAVE` en `server/src/claves-proveedor.ts` y la lista de `server/src/routes/providers.ts`.
- [ ] Gemini: confirmar el id de proveedor que usa OpenCode (`google` u otro) y que `GEMINI_API_KEY` basta para que aparezcan sus modelos.
- [ ] Groq: comprobar que aparecen modelos `groq/...` tras guardar la clave.

Cómo hacerlo en el VM:
1. Confirmar que `TELO_CLAVE_CIFRADO` está en `/etc/orquestador/orquestador.env`. Sin ella, Ajustes responde "secretos no configurados".
2. Entrar a Ajustes > Proveedores IA, pegar la clave en cada proveedor y pulsar Guardar.
3. Revisar la lista de modelos en Ajustes o en el selector del chat.

##### Riesgos conocidos

- Las claves guardadas llegan a **todos** los agentes, no solo al proveedor que las usa. Un modelo de Groq podría leer la clave de NVIDIA si el agente la busca en su entorno. Mejora posible: pasar a cada agente solo las claves del proveedor de su modelo.
- La app recorta los espacios de los extremos antes de enviar. Un valor con espacios o saltos por dentro se rechaza con `clave_proveedor_invalida`.

---

#### C. "Generar análisis": memoria y skills del proyecto  ⏳ no empezada

- [ ] Ejecución del agente que lea el proyecto y devuelva JSON con memoria y skills propuestas. Reusar `ejecutarAgente` con `aprender` (ver `server/src/memoria.ts`: `guardarMemoria`, `extraerMemoria`).
- [ ] Migración nueva: tabla `project_skills` (nombre, descripción, contenido, estado propuesto/aceptado, fecha). Rutas en `server/src/routes/projects.ts`.
- [ ] Revisión antes de guardar: el usuario acepta o descarta cada propuesta.
- [ ] Sin skills: aviso "Instalar skills" con enlace a la fuente. Antes de escribir el enlace, verificar que `skills.sh` existe y cuál es el comando de instalación.
- [ ] UI: `web/src/components/proyecto-skills.tsx` (hoy es placeholder) y la sección Memoria en `web/src/pages/proyecto.tsx`.

---

#### D. Claude y Codex (y login de cuenta de Gemini)  🛑 espera decisión tuya

Pregunta abierta: ¿inicio de sesión de cuenta en el VM (como en las capturas: abrir enlace y pegar código) o clave de API?

- Login de cuenta: guarda tokens de terceros en el VM y requiere revisión de seguridad. Plan distinto.
- Clave de API: más simple, pero Claude y Codex sin costo solo se logran con cuenta, según lo que pediste.

No se codifica hasta decidirlo.

---

#### Orden recomendado

1. En el VM, confirmar el texto real de cuota de OpenCode (A5) y los nombres de variable de NVIDIA y Gemini (B-VM).
2. C: "Generar análisis".
3. D: esperar tu decisión.
4. Commit y PR solo cuando lo pidas.

#### E. Correcciones tras probar en el VM  🟡 en curso (rama `feat/seguir-tras-cuota`)

Estado detallado en `FASE3.md`. Resumen:

- [x] **Chat en segundo plano** (`6dddd05`). El turno ya no depende de la petición HTTP. La web comprueba si un envío llegó antes de devolver el texto al compositor. Verificado en navegador.
- [x] **Barra lateral.** Sin enlace Chat; los chats de proyecto aparecen con su nombre.
- [x] **Modelos de Groq, NVIDIA y Gemini** visibles cuando su clave llega al CLI. Gemini envía dos variables. Ajustes muestra cuántos modelos ve OpenCode y avisa si no ve ninguno. Pendiente en el VM: confirmar `google` y `NVIDIA_API_KEY` con `opencode models`.
- [x] **Vista de proyectos.** Métricas desde `GET /api/projects` y acciones en iconos de 40 px.
- [x] **Memoria del proyecto editable** a mano, con redacción y límite.
- [~] **Estado y registros del servidor** en Ajustes. Hecho: estado de la unidad y registros con redacción. Requiere en el VM: `usermod -aG systemd-journal orquestador` (ver `deploy/README.md`). Pendiente: gasto de Azure (decisión del usuario).
- [ ] **Skills configurables** (tarea 7). Bloqueada: hay que confirmar en el VM dónde lee OpenCode las skills, y decidir si son globales o por proyecto.
- [ ] **Claves y botón "Instalar"** (tarea 9). Bloqueada: instalar software en el VM necesita aprobación explícita.
- [ ] **Registro histórico de la fase 3: Codex, Gemini y Claude gratis** (tarea 10). Entonces estaba pendiente aceptar el login de dispositivo de Codex; la integración Codex CLI actual se documenta al inicio de este archivo. Claude gratis continúa sin implementar.

Corrección de la nota de Gemini: ver sección B.

##### Estado tras la fase 3 (tareas 7, 9 y 10)

- Skills globales y por proyecto, editables desde Ajustes y desde el proyecto. Pendiente en el VM: confirmar que OpenCode las lista.
- OpenCode se puede instalar desde Ajustes con confirmación (comando fijo, `npm install -g --prefix ~/.opencode opencode-ai`). Pendiente: `npm` en el PATH del servicio.
- Codex: estado histórico antes de integrar el runner. Hoy el selector consulta el catálogo de la sesión y `codex/*` se ejecuta con `codex exec`; ver «Catálogo del chat por integración» al inicio. La verificación de despliegue real sigue pendiente.
- Claude gratis: sin decisión; no se implementa.


## Archivo histórico: fase 3

Fuente histórica: FASE3.md.

### Fase 3: correcciones tras probar en el VM

> Documento histórico de traspaso. Ramas, conteos de pruebas y estados son snapshots de la fecha indicada, no describen el checkout actual. Los harnesses visuales bajo `scratchpad/` eran locales y no están versionados.

Documento de traspaso. Quien lo continúe debe leer también `CLAUDE.md`, `DESIGN.md` y `FASE2.md`.

Rama de trabajo: `fix/notas-acciones-git`, desde `main` (`90f324e`). Contiene las correcciones de la Tarea 11 y de las pruebas de Codex. Sin commit ni push todavía. La rama `feat/seguir-tras-cuota` ya está en `main` por el PR 35.

Leyenda: [x] hecho y verificado · [~] escrito, sin probar · [ ] pendiente

---

#### Reglas de trabajo (obligatorias)

- Idioma: interfaz, errores y comentarios de negocio en español. Identificadores según el archivo.
- Colores y medidas solo de tokens en `web/src/styles.css`. Ámbar solo para estado activo, alerta o acción principal.
- Móvil primero: 390 px sin scroll horizontal; 1440 px también. Objetivos táctiles de 40 px.
- Errores de API siempre por `errorText()` (`web/src/lib/model.ts`).
- Migraciones: nunca editar una ya aplicada. Esta fase no necesita migraciones nuevas.
- Cada tarea termina con una entrada en `web/src/cambios.json` (`minimo` para correcciones, `mediano` para pantallas o funciones).
- Git: **el agente ejecuta los comandos de git él mismo**, pero antes pide aprobación explícita de cada commit y de cada push. No dar comandos al usuario para que los corra. No abrir PR.
- No hacer commit de nada que no haya pasado `bun test`, `tsc` del servidor y `bun run build` de la web.
- Reutilizar componentes existentes (`ConvItem`, `AvisoCuota`, `AppNav`, `errorText`, `api.*`). No duplicar.

#### Comandos de verificación

```
cd server && bun test                      # suite actual; los conteos indicados en tareas son históricos
cd server && bunx tsc --noEmit -p .       # typecheck servidor
cd web && bun run build                    # typecheck + build web (obligatorio antes de revisar UI)
```

La revisión visual histórica usó un harness local no versionado. El canal en vivo admite SSE y sondeo; la interfaz actual usa `GET /api/eventos-vivos/poll`.

---

#### Estado actual

Lista de control. Se marca lo hecho en cada tarea y aquí a la vez.

- [x] **Servidor del chat en segundo plano** (commit `6dddd05`). `POST /api/conversations/:id/messages` y `/seguir` guardan el mensaje, lanzan el turno en segundo plano y responden **202** `{ messages: [turno] }`. Los fallos quedan como mensaje `role: "system"` en el chat. Verificado: `bun test tests/chat-turnos.test.ts` pasa (4 de 4) y `tsc --noEmit` del servidor está limpio.
- [x] Evento `chat` en el canal en vivo (`bus.ts`, `routes/stream.ts`, `api.ts`, `lib/eventos-vivos.ts`); la interfaz lo consume mediante sondeo corto.
- [x] `avisarTurnosInterrumpidos()` en el arranque (`index.ts`).
- [x] **Tarea 1.** Web del chat (`chat.tsx`). Hecha: envío sin respuesta del servidor comprobado contra la lista (sin duplicar ni perder el texto), `GUARDADO_EN_ERROR` quitado, evento `chat` escuchado, aviso `system` como alerta de estado. Verificada con Playwright (corte de respuesta, 409 simulado, fallo del agente, mensaje de otro dispositivo). Captura a 390 y 1440 px. Entrada en `cambios.json`.
- [x] **Tarea 2.** Barra lateral: sin enlace Chat; chats de proyecto visibles con su nombre debajo. Verificada a 390 y 1440 px, sin desborde. `DESIGN.md` y `cambios.json` actualizados.
- [x] **Tarea 3.** Modelos de Groq, NVIDIA y Gemini visibles cuando su clave llega al CLI; Gemini con dos variables; diagnóstico en Ajustes. Verificación registrada entonces: 209 pruebas, `tsc` y revisión visual (conteos históricos, no actuales). **Pendiente en el VM:** confirmar el id `google` y el nombre de variable de NVIDIA con `opencode models`.
- [x] **Tarea 4.** Vista de proyectos con métricas (chats, tareas, última actividad desde `GET /api/projects`) y acciones en iconos de 40 px. Verificada a 390 y 1440 px, claro y oscuro: métricas, 40 px, anclar desde el icono, confirmación al eliminar, sin desborde. Pruebas de servidor en `proyectos.test.ts`.
- [x] **Tarea 5.** Cierre de la fase 3. Verificación registrada entonces: 246 pruebas, `tsc`, `bun run build` y 29 revisiones de navegador (cifras históricas, no actuales). Subido con aprobación del usuario: `502b781` y merge `79b126e`.
- [~] **Tarea 6.** Estado, logs y gasto de Azure en Ajustes. **Hecho:** estado de la unidad y registros (`GET /api/servidor/servicio` y `/logs`, con redacción y sin shell; botón Ver logs activo). Verificado en el navegador y en `servidor-logs.test.ts`. **Pendiente:** gasto de Azure, que espera la decisión del usuario sobre la identidad del VM (ver tarea 6, punto 3).
- [x] **Tarea 7.** Skills globales y por proyecto, editables desde la app. Verificada en navegador a 390 y 1440 px, y en `skills.test.ts`. **Pendiente en el VM:** confirmar que OpenCode las lista.
- [x] **Tarea 8.** Memoria del proyecto editable desde la app (`PUT /api/projects/:id/memoria`, con redacción y límite de 4 000 caracteres; botones Editar, Escribir, Guardar, Cancelar y Borrar). Verificada en el navegador a 390 y 1440 px, y en `proyectos.test.ts`. Supuesto confirmado en el código: "memoria" = memoria aprendida por proyecto.
- [x] **Tarea 9.** Botón "Instalar" de OpenCode con confirmación en dos pasos y comando fijo, verificado con npm falso (`instalacion.test.ts`) y en navegador. **Pendiente en el VM:** que `npm` exista para el servicio, y que `opencode models` liste los modelos de la clave guardada.
- [~] **Tarea 10 (registro histórico).** Codex: login por código de dispositivo e instalación desde Ajustes. El runner Codex CLI y el catálogo del chat se añadieron después; ver «Catálogo del chat por integración». Gemini: clave de AI Studio (tarea 3). Claude: **investigado, no implementado** (ver tarea 10, punto b).
- [~] **Tarea 11.** Acciones git desde los chats (commit, subir rama y abrir PR, siempre con aprobación). En `main` desde los PR 36 a 42. En esta rama se quitan la fusión local y el push directo a `main`, el PR usa solo `GITHUB_PR_TOKEN` y las notas del plan dejan de romper la aprobación (ver Tarea 11). La protección de `main` en GitHub ya está hecha.
- [x] **Tarea 12.** Cola de mensajes del chat: si envías más mientras el agente responde, se ejecutan en orden. Hecha en el PR #127 (ver «Tarea 12: cola de mensajes del chat»).
- [ ] **Tarea 13.** Wrangler (Cloudflare) instalable desde Ajustes, con inicio de sesión por código. Pendiente de dos decisiones (ver Tarea 13).
- [x] **Corrección.** El error «opencode salió con código 143» ya no aparece: el chat explica el límite de 3 minutos. Causa en «Diagnóstico del 143».
- [x] **Corrección.** `/tmp` propio dentro del sandbox: OpenCode ya no falla con «Read-only file system». Verificado con bwrap real.
- [x] **Corrección.** Notas del plan: al aprobar con notas, el obrero ya no rechaza el plan con «El plan cambió después de su aprobación». El hash cubre el plan sin las notas (`sinNotas`). La prueba extremo a extremo del analizador pasa.
- [x] **Corrección.** Pruebas de Codex: `HOME` se fija y se restaura en `beforeAll`/`afterAll`, y las rutas de sesión se calculan en cada uso (`login-cli.ts`). Snapshot de esa suite: 290 aprobadas, 7 omitidas, 0 fallidas.
- [x] **Barra lateral.** Se quitó el nombre del proyecto debajo de cada chat. Verificada a 390 y 1440 px.

Orden: tareas 1 a 5 primero (ya acordadas), luego 6 a 10 en el orden en que el usuario las pidió. Decisiones tomadas: skills globales y por proyecto (7), instalar OpenCode con confirmación (9), login de Codex en el VM (10a). Pendiente: Claude gratis (10b), el gasto de Azure (6, necesita la identidad del VM) y lo que queda de las acciones git desde los chats (11).

Antes de seguir: correr `bun test tests/chat-turnos.test.ts`. Si falla, corregir el servidor antes de tocar la web. Si una prueba depende de tiempos, subir la espera de `esperar()`, no quitar la comprobación.

---

#### Tarea 1. El chat no se detiene si el móvil o la PC se duermen, cambian de app o pierden red

**Causa.** Antes, el turno corría dentro de la petición HTTP. Si la red se cortaba, `send` fallaba, la web tomaba el error como "no guardado" y devolvía el texto al compositor. Pero el servidor sí había guardado el mensaje y seguía el agente: el resultado era un mensaje duplicado y una respuesta que no aparecía hasta recargar.

**Qué hacer (web, `web/src/pages/chat.tsx`).**
1. En la mutación `send`, en `mutationFn`: si `api.sendMessage` falla con algo que no es `ApiError` (sin respuesta del servidor), pedir `api.listMessages(id)`. Si el último mensaje `role === "user"` tiene el mismo texto (`content.trim()`), dar el envío por bueno (`return { messages: [] }`). Si no, relanzar el error. Un `ApiError` siempre significa que no se guardó: restaurar borrador como hoy.
2. Quitar `GUARDADO_EN_ERROR` y su uso en `onError`: ya no hay errores tras guardar.
3. `pensando` ya usa `current.ocupada`; dejarlo. Tras el 202 la lista de conversaciones se invalida (ya ocurre en `onSettled`).
4. En `useEventosVivos` (chat.tsx ya lo usa para `actividad`), manejar `evento.tipo === "chat"`: invalidar `["messages", evento.conversacion_id]` y `["conversations"]`.
5. En `lista.map`, antes del ternario `m.role === "user"`, renderizar `m.role === "system"` como aviso: `<p className="tl-alerta" role="status">{m.content}</p>`. Hoy caería en la burbuja del agente.

**Verificación.**
- `bun test tests/chat-turnos.test.ts` en verde.
- Playwright: interceptar el POST con `route.fetch()` seguido de `route.abort()`. El servidor recibe el mensaje; el navegador ve un fallo de red. Esperado: el borrador no vuelve, aparece la respuesta del agente sin recargar.
- Playwright con `context.setOffline(true)` durante un turno largo y luego `setOffline(false)`. Esperado: la respuesta aparece al volver.
- Revisar 390 y 1440 px, claro y oscuro. Sin errores de consola.

**Cambios.** `cambios.json` tipo `minimo`.

---

#### Tarea 2. Quitar "Chat" de la barra lateral y mostrar todos los chats

**Causa del chat que falta.** `web/src/components/shell.tsx` tiene `if (c.project_id) continue;` en `groupedConversations`. Los chats de proyecto (por ejemplo, los que crea el clonado desde GitHub) no aparecen en la lista. Hipótesis probable, a confirmar con `GET /api/conversations` en el VM: el segundo chat es de un proyecto.

**Qué hacer.**
1. `web/src/components/nav.tsx`: quitar el elemento `to: "/chat"` de `ITEMS`. Afecta a todas las variantes (sidebar, row, rail). La ruta `/chat` se queda, y `/` sigue redirigiendo ahí.
2. `web/src/components/shell.tsx`: quitar el `continue` y su comentario. Los chats de proyecto entran en su grupo de fecha.
3. `web/src/components/conv-item.tsx`: si `conv.project_name` existe, mostrarlo como línea secundaria pequeña (`--ink-2`, 12 px) debajo del título. Sin duplicar clases: revisar `styles-shell.css` (`.sidebar-conv`, `.sidebar-conv-title`).
4. `DESIGN.md`, sección "AppNav": quitar "Chat" de la lista de enlaces.

**Verificación.** Con dos chats (uno sin proyecto y uno de proyecto), ambos aparecen en la barra. Revisar 390 px (cajón) y 1440 px.

**Cambios.** `cambios.json` tipo `minimo`.

---

#### Tarea 3. Groq, NVIDIA y Gemini: que sus modelos aparezcan y funcionen

**Lo que se sabe (verificado en código).** `server/src/models.ts` marca `recommended = free || grupo curado`. Groq y NVIDIA de pago no caen en ningún grupo (`GROUPS`), así que quedan fuera del selector de chat (`GET /api/models` sin `all=1`). Aunque la clave llegue a OpenCode, el usuario no ve los modelos. Esa es la causa más probable de "está implementado y no está".

**Lo que NO se puede verificar desde aquí.** OpenCode no está instalado en el entorno de trabajo. Las fuentes consultadas no coinciden:
- Un mirror de la documentación (`mintlify`) da `GEMINI_API_KEY`, pero corresponde a la versión antigua en Go de opencode. La versión actual usa el catálogo models.dev.
- Otra fuente lista NVIDIA con id de proveedor `nvidia` y clave por `/connect` (que guarda en `~/.local/share/opencode/auth.json`); no nombra variable.
- Un artículo de terceros da `NVIDIA_API_KEY`. No es documentación oficial.

**Qué hacer.**
1. **Modelos visibles** (`server/src/models.ts`): en `parseModels`, si el proveedor del modelo (`id.split("/")[0]`) tiene clave activa, `recommended = true` y `group` = etiqueta del proveedor (`Groq`, `NVIDIA`, `Google (Gemini)`), salvo que coincida con un grupo curado. Obtener los proveedores activos con una función exportada de `claves-proveedor.ts` (usar `entornoProveedores()` o `tieneClaveProveedor`). `invalidarModelos()` ya se llama al cambiar claves.
2. **Variables de Gemini** (`server/src/claves-proveedor.ts`): cambiar `variable: string` por `variables: string[]`, con `GOOGLE_GENERATIVE_AI_API_KEY` primero y `GEMINI_API_KEY` después, y pasar **las dos** al entorno. Así funciona con la versión actual o con la antigua. Actualizar:
   - `entornoProveedores()`: asignar cada variable.
   - `server/src/routes/providers.ts`: `variable` = primera; `configured` y `enAgente` miran todas.
   - `server/tests/claves-proveedor.test.ts`: espera `GEMINI_API_KEY` en `PROVEEDORES_CON_CLAVE` (revisar los asserts que cambien).
   - `FASE2.md`: corregir la nota de Gemini.
3. **Diagnóstico en Ajustes** (`web/src/pages/settings.tsx`): pasar a `TarjetaProveedor` el número de modelos del proveedor (`models.data.models.filter(m => m.provider === p.id).length`; la lista ya se pide con `all=1`). Mostrar "N modelos disponibles". Si la clave está guardada, `enAgente` es true y el conteo es 0 con los modelos ya cargados, mostrar: "La clave está guardada, pero OpenCode no muestra modelos de este proveedor. Revisa el nombre de la variable en el servidor con `opencode models`." Esto deja claro al usuario, sin adivinar, si OpenCode reconoce la clave.
4. **Pruebas** (`server/tests/entorno-proveedores.test.ts`): el fake de `models` debe imprimir también `groq/llama-prueba` y `nvidia/nemo-prueba` con coste mayor que cero. Afirmar: con clave guardada de Groq, `groq/...` tiene `recommended: true` y grupo `Groq`; sin clave, `recommended: false`. Actualizar la aserción que hoy espera solo `opencode/big-pickle`.

**Verificación en el VM (lo hace el usuario o el agente con acceso).** Con `GROQ_API_KEY` guardada, `opencode models --verbose` debe listar `groq/...`. Para NVIDIA y Gemini, comprobar el nombre exacto de la variable y el id del proveedor. Si el conteo sigue en 0, el diagnóstico de Ajustes lo indica.

**Honestidad con el usuario.** Decir que la lógica del selector queda arreglada, y que la confirmación de nombres de variable se hace en el VM.

**Cambios.** `cambios.json` tipo `minimo`.

---

#### Tarea 4. Mejorar la vista de proyectos

**Estado actual.** `web/src/pages/proyectos.tsx`: tarjeta con nombre, ruta, estado de origen y tres botones de texto al pie (Renombrar, Quitar ancla, Eliminar) que se parten en dos líneas en 390 px. No muestra actividad.

**Qué hacer.**
1. **Servidor** (`server/src/routes/projects.ts`, `GET /projects`): añadir por subconsulta `chats` (conversaciones del proyecto), `tareas` (tareas del proyecto) y `ultima_actividad` (máximo de `messages.created_at` de sus chats o `tasks.created_at`, con `COALESCE` para no obtener NULL). Convertir `''` a `null` en JS. Tipo `Project` en `web/src/api.ts`: campos opcionales nuevos.
2. **Tarjeta** (`proyectos.tsx`):
   - Cabecera: nombre (18 px, peso 600) y chip "Anclado" si aplica.
   - Ruta de carpeta en mono, truncada con elipsis (no partir en varias líneas).
   - Línea de metadatos en `--ink-2`: "N chats · N tareas · última actividad hace X" (usar `web/src/lib/tiempo.ts` si ya formatea fechas; revisar antes de crear otro).
   - Estado de origen (clonado desde GitHub) como hoy.
   - Pie: el nombre (o un enlace "Abrir") lleva a `/proyectos/$id`. Renombrar, anclar y eliminar pasan a **botones de icono de 40 px** con `aria-label` y `title`, como en `conv-item.tsx`. Eliminar mantiene su confirmación.
   - Confirmación y renombrado: mantener la lógica actual.
3. **Cabecera de página**: título, subtítulo con número de proyectos y botón "Nuevo proyecto" (ya existe).
4. **Estilos**: reemplazar las clases `.proyecto-tarjeta*` de la página por las nuevas. Tokens únicamente. Sin degradados ni sombras pesadas.

**Verificación.** Captura a 390 y 1440 px, claro y oscuro. Sin scroll horizontal a 390. Con 0 proyectos sigue el estado vacío. Con un proyecto anclado y uno clonado, revisar el orden (anclados primero, como hoy).

**Cambios.** `cambios.json` tipo `mediano`.

---

#### Tarea 5. Cierre

1. `FASE2.md`: añadir sección "E. Correcciones tras probar en el VM" con el estado de las tareas 1 a 4. Corregir la nota de Gemini.
2. `cambios.json`: una entrada por tarea (ya indicadas arriba).
3. Ejecutar todos los comandos de verificación. Revisión visual 390 y 1440, claro y oscuro, sin errores de consola.
4. Preguntar al usuario si aprueba el commit y el push. Solo tras su aprobación, ejecutar git tú mismo (`git add` de archivos concretos, `git commit`, `git push`). El commit lleva los trailers `Co-Authored-By` y `Claude-Session` indicados en el sistema.

---

#### Tarea 6. Estado, logs y gasto de Azure en Ajustes

**Qué ya existe.** `server/src/routes/servidor.ts` (`GET /api/servidor`, caché de 30 s) da disco, herramientas y carpetas, sin rutas ni IPs. Ajustes lo muestra en "Estado del servidor" y "Almacenamiento" (`web/src/pages/servidor.tsx`). Faltan los logs, el estado del servicio y el gasto.

**Por qué así.** Ver los errores sin entrar al VM por SSH, y ver el gasto real que da Azure, no una estimación de la app.

**Qué hacer.**
1. **Estado del servicio.** Añadir a `GET /api/servidor` el resultado de `systemctl show orquestador -p ActiveState,SubState,ActiveEnterTimestamp` con lista fija de argumentos, entorno mínimo (`entornoMinimo()`) y tiempo límite, como ya hace `df`.
2. **Logs.** Nueva ruta `GET /api/servidor/logs?lineas=100` (máximo 300). Ejecuta `journalctl -u orquestador -n <N> --no-pager -o short-iso` con `Bun.spawn`, sin shell. La salida pasa por `redaccion.ts` antes de responder. Si el usuario del servidor no puede leer el diario, responde un error legible, no un 500. Requisito en el VM (lo hace el usuario): añadir `orquestador` al grupo `systemd-journal`. Documentarlo en `deploy/README.md`. No dar sudo.
3. **Gasto de Azure.** Nueva ruta `GET /api/servidor/coste`, con caché de 1 h. Consulta la API de Cost Management de Azure con la **identidad administrada** del VM, así no hay claves en el repo ni en el archivo de entorno. Devuelve gasto del mes en curso, moneda y gasto diario de los últimos 30 días. Si falta la identidad o el rol, responde `coste_no_disponible` con un texto que dice qué permiso falta.
   - **Decisión pendiente del usuario:** asignar al VM una identidad administrada con el rol de lector de costes sobre la suscripción. Sin eso, la tarjeta muestra el aviso y no inventa cifras.
   - Comprobar en el VM el comando exacto de consulta (`az rest` contra Cost Management o `az consumption`). No verificado desde aquí.
4. **Presentación** en Ajustes, sin tablas: tarjeta "Estado" (icono y texto; ámbar solo si el servicio no está activo), tarjeta "Gasto del mes" (cifra grande, moneda y fecha de corte), y bloque "Registros" (texto monoespaciado, últimas 100 líneas, botón "Actualizar" con icono). Tokens de `styles.css`.
5. **Pruebas** (`server/tests/servidor-logs.test.ts`): `journalctl` ausente da error legible; un token de prueba en la salida queda oculto; el límite de líneas se respeta. Para el gasto, un `az` falso en el PATH (igual que el `opencode` falso).

**Verificación.** Captura de la pestaña a 390 y 1440 px, claro y oscuro, con datos y sin datos. Sin errores de consola.

**Cambios.** `mediano`.

---

#### Tarea 7. Skills configurables desde la app (hecha)

**Decisión del usuario.** Globales y por proyecto.

**Cómo quedó.**
- **Global:** `~/.config/opencode/skills/<nombre>/SKILL.md`. Se edita en Ajustes > Proveedores IA > Skills.
- **Por proyecto:** `<carpeta del proyecto>/.opencode/skills/<nombre>/SKILL.md`. Se edita en la pestaña del proyecto.
- **Nombre:** `^[a-z0-9]+(-[a-z0-9]+)*$`, hasta 64 caracteres. Es la misma regla que documenta OpenCode. La carpeta se llama igual que la skill.
- **Contenido:** cabecera con `name` igual a la carpeta y `description` de 1 a 1 024 caracteres. Máximo 64 KB.
- **Secretos:** un texto con un secreto conocido (`TELO_CLAVE`, clave de proveedor o token con formato de credencial) se rechaza. No se guarda redactado, porque al editar pisaría el original.
- **Escritura:** archivo temporal con `O_EXCL` y `O_NOFOLLOW`, `fsync` y renombrado. Ningún tramo de la ruta puede ser un enlace. La lectura también usa `O_NOFOLLOW`.
- **Borrar:** solo si la carpeta contiene únicamente `SKILL.md`. Si hay más archivos, responde 409 y no toca nada.
- **Aislamiento:** en bubblewrap, `~/.config/opencode/skills` se monta en **solo lectura**. El agente la lee y no la escribe: si pudiera escribirla, dejaría instrucciones para todos los agentes. La carpeta se crea al arrancar el servidor para que el montaje siempre exista.
- **Código:** `server/src/skills.ts`, `server/src/routes/skills.ts`, `web/src/components/skills-editor.tsx`, `web/src/components/proyecto-skills.tsx`.

**Diferencia con el plan.** El plan preveía `TELO_SKILLS_DIR`. No se añadió: una variable así podría apuntar fuera de lo que el agente ve. La ruta global es fija.

**Límite conocido.** Las skills de proyecto son archivos sin confirmar en el repositorio (aparecen en `git status`). Un chat que trabaja en la carpeta del proyecto las usa. Una tarea de un repositorio Git trabaja en un clon del último commit y no las ve hasta que se confirmen. Llevarlas a esas tareas es una decisión aparte.

**Verificado.** `server/tests/skills.test.ts` (14 pruebas): rutas, nombres, cabeceras, tamaño, secretos, enlaces en el archivo y en la carpeta, escritura que falla sin dejar temporales, borrado con archivos extra y proyecto inexistente. En navegador: crear, guardar, aparecer en la lista y escribir en `.opencode/skills` del proyecto, a 390 y 1440 px.

**No verificado en el VM.**
- Que OpenCode liste `~/.config/opencode/skills` y `.opencode/skills` (la documentación de OpenCode lo describe así; no hay OpenCode en este entorno).
- El montaje de solo lectura dentro de bubblewrap. Aquí no hay `bwrap`.

**Cambios.** `cambios.json`: mediano (entrada añadida).

---

#### Tarea 8. Memoria del proyecto editable desde la app

**Qué ya existe.** La memoria del proyecto está en `projects.memoria` (migración 014). El agente la escribe al terminar tareas (`server/src/memoria.ts`, `guardarMemoria`, límite `MAX_MEMORIA` de 4 000 caracteres). `DELETE /api/projects/:id/memoria` la borra. `web/src/components/proyecto-memoria.tsx` solo muestra el texto y el botón "Borrar memoria". **No se puede editar.**

**Supuesto.** "Memoria" = la memoria aprendida de cada proyecto. Si el usuario se refería a su memoria personal, es otra tarea. Confirmar antes de cerrarla.

**Qué hacer.**
1. **Servidor:** `PUT /api/projects/:id/memoria` con `{ texto }`. Límite `MAX_MEMORIA`. El texto pasa por `redaccion.ts` antes de guardar. Reutilizar `guardarMemoria`; no duplicar.
2. **Web:** en `proyecto-memoria.tsx`, un área de texto con el contenido actual, la fecha de actualización, "Guardar" (solo activo si cambió) y "Borrar memoria" como hoy.
3. **Pruebas:** un token de prueba no queda guardado en claro; más de `MAX_MEMORIA` caracteres se rechaza con mensaje claro; proyecto inexistente da 404.

**Verificación.** Captura a 390 y 1440 px, claro y oscuro, con memoria vacía y con texto.

**Cambios.** `mediano`.

---

#### Tarea 9. Claves de proveedores y botón «Instalar» para OpenCode (hecha)

**Decisión del usuario.** Sí, instalar desde la app, con confirmación.

**Cómo quedó.**
- En la tarjeta de OpenCode aparece "Instalar OpenCode" solo si el CLI no se encuentra. El primer paso muestra el comando; el segundo es "Sí, instalar".
- **Comando fijo:** `npm install -g --prefix ~/.opencode opencode-ai`. La API recibe solo el identificador `opencode`; el servidor exige `confirmar: true` en el cuerpo.
- Sin shell. Entorno mínimo (PATH, HOME, LC_ALL): ninguna variable `TELO_*` ni clave llega a npm. Tiempo máximo de 10 minutos, con terminación del grupo.
- La salida pasa por `redaccion.ts`. Los motivos son legibles: npm no disponible, fallo de npm, tiempo agotado, CLI no visible tras instalar.
- **Por qué npm y no `curl … | bash`.** La documentación de OpenCode recomienda el script, pero ejecutar un script remoto no es un comando fijo. npm instala un paquete versionado. Con `--prefix ~/.opencode` el ejecutable queda en una carpeta que el agente ya ve en solo lectura, así que no hace falta tocar `TELO_LECTURA_EXTRA`.
- Tras instalar, el servidor añade `~/.opencode/bin` a su PATH sin reiniciar. Al arrancar hace lo mismo (`asegurarRutaInstalada`).
- **Código:** `server/src/instalacion.ts`, `server/src/routes/herramientas.ts`, `web/src/components/instalar-herramienta.tsx`.

**Corrección hecha durante la verificación.** `Bun.which` usa el PATH con el que arrancó el proceso, no el actual. Tras instalar, el CLI no se veía. Ahora `server/src/ejecutable.ts` (`hallarEjecutable`, `lanzarEnGrupo`, `matarGrupo`) pasa el PATH vivo, y lo usan todos los sitios que buscan programas.

**Verificado.** `server/tests/instalacion.test.ts` (7 pruebas): lista fija, confirmación obligatoria, npm ausente, salida redactada, PATH actualizado, sin reinstalar. En navegador: comando visible antes de confirmar, instalación, botón que desaparece y "Activo", a 390 y 1440 px.

**Pendiente en el VM.**
- Que `npm` esté en el PATH del servicio. Si no está, el botón lo dice. El PATH del servicio viene de su unidad systemd.
- `opencode models` debe listar los modelos de la clave de Groq guardada (tarea 3).
- Confirmar el id `google` y el nombre de la variable de NVIDIA.

**Cambios.** `cambios.json`: mediano (entrada añadida).

---

#### Tarea 10. Conectar Codex, Gemini y Claude gratis (parcial)

**Decisiones.**
- **(a) Codex:** aprobado el login de dispositivo, ejecutado en el VM.
- **(b) Claude gratis:** investigado en octubre de 2026. **Decisión del usuario: no añadir Claude por ahora.** Solo tiene el plan gratis; la única vía compatible (clave de API) es de pago. No se implementa ningún acceso con cuenta de Claude.
- **Gemini:** se usa la clave de AI Studio (tarea 3). Telo no ofrece inicio OAuth con una cuenta Google, porque esa autorización no sirve para OpenCode ni se usa para obtener métricas.

**Qué dice la documentación oficial (Claude Code, «Legal and compliance»).**
- El OAuth de cuenta de consumo está pensado «exclusivamente» para quien compra Free, Pro, Max, Team o Enterprise y para las aplicaciones nativas de Anthropic.
- Los desarrolladores que construyen productos deben usar **clave de API** (Claude Console) o un proveedor de nube. Anthropic **no permite** a terceros «enrutar solicitudes con credenciales de los planes Free, Pro o Max en nombre de sus usuarios», ni «recoger, almacenar o intermediar credenciales o tokens de sesión de Claude.ai».
- Sí está permitido que una persona inicie sesión con su propia suscripción en el **binario oficial de Claude Code, sin modificar**.

**Qué significa para Telo.**
- Telo no usa Claude Code para los agentes: usa OpenCode. Usar el OAuth de una cuenta de consumo desde OpenCode, o guardar o reenviar un token de Claude, cae en lo que la documentación prohíbe. **Descartado.**
- Copiar tokens de claude.ai o de la app de escritorio: **descartado** (mismo motivo).
- Un runner nuevo que ejecute el binario oficial de Claude Code con la sesión de la persona sería la única vía con cuenta de consumo. Tendría que confirmarse que el plan gratis incluye Claude Code, y eso no se ha podido comprobar: la página de soporte de Anthropic no se pudo leer y las fuentes secundarias no coinciden. **No se recomienda con plan gratis.**
- **Ruta compatible:** clave de API de Claude Console, con el mismo flujo de tarjeta que Groq y NVIDIA. Es de pago por uso. Hay que confirmar el nombre de la variable que lee OpenCode (`ANTHROPIC_API_KEY`) con `opencode models`.

**Qué hacer (solo si el usuario tiene plan de pago y lo pide).**
1. `server/src/claves-proveedor.ts`: añadir Anthropic con `ANTHROPIC_API_KEY`, igual que Groq.
2. `server/src/routes/providers.ts`: tarjeta guardable.
3. Pruebas: `claves-proveedor.test.ts` y `entorno-proveedores.test.ts`, con el modelo `anthropic/...` en el CLI falso.

**Cómo quedó (Codex).**
- `server/src/login-cli.ts` lanza `codex login --device-auth` en su propio grupo de procesos, con entorno mínimo. Lee la salida mientras el CLI espera y extrae la URL y el código.
- Rutas: `GET`, `POST` y `DELETE /api/providers/codex/login`. Una sesión a la vez (409 si ya hay una). Tiempo máximo de 15 minutos. Cancelar termina el grupo.
- **El token no se lee ni se muestra.** La salida se redacta. El éxito se decide por salida 0 y porque exista el archivo de sesión; ese archivo solo se comprueba, nunca se abre.
- `~/.codex` está en `HERRAMIENTAS` de `server/src/runners/aislamiento.ts` y se monta en solo lectura.
- En la tarjeta de Codex: «Iniciar sesión» → enlace y código → «Sesión iniciada en el servidor». «Ya lo hice» comprueba el estado y mantiene el enlace mientras el CLI espera.
- Esta nota era anterior al runner Codex y está superada: ahora los modelos `codex/*` se listan con la sesión y se ejecutan con `codex exec`. Ver el estado actualizado al inicio de `SEGUIMIENTO.md`.

**Verificado.** `server/tests/login-codex.test.ts` (4 pruebas) con un CLI falso que imprime un token de prueba: el token no aparece en ninguna respuesta, cancelar no deja procesos y sin CLI responde `codex_no_instalado`. En navegador: enlace, código, «Ya lo hice» y sesión iniciada, a 390 y 1440 px.

**No verificado (importante).**
- La documentación oficial de Codex (`developers.openai.com/codex/auth`) no se pudo leer en esta sesión. El comando `codex login --device-auth` y la ruta `~/.codex/auth.json` vienen de fuentes de terceros. Antes de darlo por bueno en el VM: `codex login --help` y comprobar qué archivo crea.
- **Términos de OpenAI:** no revisados. Antes de usar la sesión de ChatGPT para agentes (con un runner de Codex), hay que comprobar que el caso está permitido.
- No se sabe si el CLI de Codex está instalado en el VM. Si no lo está, la app lo dice.

**Cambios.** `cambios.json`: grande (entrada añadida, según el plan).

---

#### Tarea 11. Acciones git desde los chats (parcial)

**Objetivo.** Que un chat con proyecto pueda crear commits, subir una rama y abrir PR sin que el usuario copie comandos. Ninguna acción se ejecuta sin aprobación explícita en Telo. El agente nunca recibe la clave SSH ni los tokens de GitHub.

**Estado.** En el código, las acciones llegan por la API `/projects/:id/acciones` (`routes/repository-actions.ts`), que el chat llama directamente cuando el usuario pide git (`routes/chat.ts`). Cada acción queda aprobada en `repository_actions`. No existe todavía la carpeta `.telo/solicitudes` ni la skill `telo-git` de abajo: esas secciones describen el diseño original. **Pendiente:** que el usuario cree `GITHUB_PR_TOKEN` en los secretos del proyecto, y comprobar con un push directo a `main` que GitHub lo rechaza.

**Decisiones (confirmadas por el usuario).**
- Permiso por defecto de un chat: **sin git**. Quien quiera git lo activa en la configuración del chat. Los niveles intermedios quedan por definir.
- Ramas: solo `telo/<id>`. Nunca `main`, nunca force push, nunca borrar ramas y nunca merge. El merge lo hace el usuario.
- **Subir** (push) sigue con la deploy key y con aprobación previa. Un PR necesita que la rama exista en GitHub, así que "solo PR" no quita el push: es el paso anterior.
- **PR**: el token de la API tiene solo el permiso *Pull requests: Read and write* (*Metadata: Read* se añade solo), un solo repo y vencimiento de 90 días. Se guarda como secreto `GITHUB_PR_TOKEN`, separado de `GITHUB_TOKEN`, que hoy es el respaldo del push por HTTPS. Si la API responde 403 al crear el PR, se añade *Contents: Read* y se documenta. En el código, el PR usa solo `GITHUB_PR_TOKEN`: sin respaldo a `GITHUB_TOKEN` ni a la cuenta general de GitHub. Ese nombre no entra al entorno del agente.
- **Fusión local y push a `main` quitados** (decidido el 15 de octubre, para respetar la protección de `main`): `merge` y `push_main` ya no se crean ni se ejecutan. Una acción antigua pendiente de esos tipos falla con un aviso y nunca cae en el camino del PR.
- **Protección de `main`** en GitHub: hecha por el usuario (*Require a pull request* con 0 aprobaciones, *Do not allow bypassing*, sin force push ni borrado). **Pendiente:** comprobar con un `git push` directo a `main` que GitHub lo rechaza.

**Cómo debe funcionar.**
1. El chat trabaja en un clon propio, como las tareas (`workspace.ts`). Hoy un chat con proyecto trabaja en la carpeta del proyecto, así que esto hay que cambiarlo antes.
2. El agente pide una acción escribiendo `.telo/solicitudes/*.json` en su clon. El servidor lee la solicitud al terminar cada turno y valida todo contra su propio estado. La carpeta `.telo` no entra en los commits.
3. Tarjetas en el chat, una por acción: **Commit** (diff resumido, mensaje y rama), **Subir** (rama `telo/<id>`) y **Abrir PR** (título y cuerpo redactados por el agente y editables por el usuario). Cada una con Aprobar y Rechazar.
4. Cada aprobación queda ligada a lo que se aprobó: hash del diff en el commit, SHA del commit en el push y hash de título y cuerpo en el PR. Si algo cambia, la aprobación caduca. Se reutilizan `task_approvals` y la interfaz de `tarea-plan.tsx`.
5. El resultado (SHA, rama o URL del PR) se escribe en el chat y se pasa al agente en el siguiente turno.

**Qué debe saber cada chat.** Una skill global `telo-git` (sistema de skills de la tarea 7): cómo pedir una acción, que solo puede pedir, las reglas de rama y de mensaje, y que nunca use `git push` ni `gh`. Las instrucciones del proyecto añaden la convención de commits y la plantilla de PR. El chat no recibe claves, tokens ni URLs con credenciales.

**Lo que ya existe y se reutiliza.**
- `git.ts` desactiva los hooks del repo (`core.hooksPath=/dev/null`) y quita filtros, credenciales y `url.*` en los comandos del servidor.
- `subirAprobado` (`workspace.ts`) empuja solo `HEAD:refs/heads/telo/<id>`, sin force, y exige un commit aprobado con el hash coincidente.
- El escaneo de secretos y de archivos sensibles se aplica antes de cada commit.

**Implementación pendiente, en orden (diseño original; ver Estado).**
1. Clon propio para chats con proyecto (extender `workspace.ts`) y una migración nueva para el permiso por chat (la siguiente numerada).
2. Permiso por chat en la configuración del chat, por `PATCH /api/conversations/:id`. Sin git por defecto.
3. Lectura de `.telo/solicitudes/*.json` al terminar cada turno, con validación en el servidor.
4. Tarjetas Commit y Subir, con la aprobación generalizada a chats.
5. Acción Abrir PR con `GITHUB_PR_TOKEN`. Esto también resuelve la aprobación `pr`: hoy `plan.ts` y `tarea-plan.tsx` la muestran, pero `routes/tasks.ts` la rechaza con `invalid_accion`. Si se retrasa, hay que decidir si se quita.
6. Skill `telo-git` y texto en las instrucciones del proyecto.
7. Pruebas: sin git se rechaza la solicitud; las ramas fuera de `telo/*` se rechazan; `main` nunca; una aprobación caduca si cambia el diff, el SHA o el título; PR con API falsa; el token no aparece en ninguna respuesta ni en la salida del agente.
8. Verificación: navegador a 390 y 1440 px, y una prueba real en un repo de prueba (commit, push a `telo/` y PR), con el push directo a `main` rechazado.

**Riesgos.**
- Instrucciones maliciosas en el código o en un issue: la aprobación es sobre el diff real, no sobre lo que diga el agente.
- El agente no debe recibir `gh`, `git push` directo ni credenciales, porque necesitaría secretos dentro del aislamiento.
- Un token mal acotado: por eso el de PR tiene permiso mínimo y su propio nombre de secreto.

**Cambios.** `cambios.json`: grande, al implementarse.

---

#### Diagnóstico del 143 («opencode salió con código 143»)

**Causa.** `routes/chat.ts` limita cada turno del chat a 3 minutos (`TIEMPO_TURNO_MS`). Al llegar, `runners/opencode.ts` manda SIGTERM al grupo del agente, que sale con código 143 (128 + 15). `ejecutar.ts` lo trata como tiempo agotado, pero el chat mostraba el código tal cual.

**Lo que se corrigió.** El chat dice: «El agente tardó más de 3 minutos y se detuvo. Divide la tarea en partes más pequeñas.» No se probó con un agente real de 3 minutos; el cambio comprueba el tiempo transcurrido, y la lógica es corta.

**Causa secundaria (también corregida).** `/tmp` era de solo lectura dentro del sandbox de bubblewrap, así que OpenCode fallaba al escribir su `TMPDIR` (`/tmp/opencode`). El agente lo reportó como «Read-only file system». Se añadió `--tmpfs /tmp` en `runners/aislamiento.ts`. Verificado en esta máquina con bwrap real: sin el montaje falla con «Read-only file system»; con el montaje escribe, y el host no ve el archivo.

**Pendiente.** Decidir si el límite de 3 minutos se queda o se sube. Ver Tarea 12, donde la cola de mensajes depende de esa decisión.

---

#### Tarea 12. Cola de mensajes del chat (hecha: PR #127)

**Entrega.** [PR #127](https://github.com/PABLOCESAR2412/Orquestador/pull/127). El diseño de abajo se implementó tal cual, salvo dos ajustes: los reintentos siguen fallando con 409 mientras hay turno (retoman la sesión propia del turno terminado) y la decisión del límite de 3 minutos quedó sin efecto porque el límite ya no existe (`TIEMPO_TURNO_MS = null`).

**Hoy.** Si el chat está respondiendo, `POST /api/conversations/:id/messages` responde 409 `conversation_busy` (`motivoDeBloqueo` en `routes/chat.ts`). No hay cola.

**Lo que pidió el usuario.** Si envía más mensajes mientras el agente trabaja, se ejecutan en el orden en que se enviaron.

**Diseño propuesto.**
1. Guardar el mensaje como pendiente en la conversación. Sigue habiendo un turno a la vez por chat (`ocuparConversacion`).
2. Al terminar un turno, arrancar el siguiente pendiente, en orden de llegada.
3. En el chat: «En cola (N)» y la opción de quitar un mensaje pendiente antes de que arranque.
4. Si el servidor se reinicia con mensajes en cola, avisar como hoy (`avisarTurnosInterrumpidos`) y no ejecutarlos solos.
5. Decisión del usuario: el límite de 3 minutos por turno se queda o sube.

**Pruebas.** Dos mensajes seguidos: el segundo espera y se ejecuta después. Quitar un pendiente antes de que arranque. Reinicio con cola: no se ejecuta solo.

**Cambio de tipo:** mediano.

---

#### Tarea 13. Wrangler (Cloudflare) desde Ajustes (pendiente)

**Qué se verificó.**
- El paquete `wrangler` existe en npm (versión 4.151.0 en la revisión).
- `wrangler login --device` existe en esa versión. No usa servidor de callback: muestra un enlace y un código, igual que el login de Codex. Lo dice la ayuda del CLI («útil en contenedores o sesiones SSH remotas») y la documentación de Cloudflare.
- El login normal (`wrangler login`) redirige el navegador a `localhost:8976` de la PC del usuario. Si Wrangler corre en el servidor, ese callback nunca llega y el login se queda colgado. Por eso no se usa.

**Diseño propuesto.**
1. Instalar con el mismo mecanismo que Codex: una entrada nueva en `ACCIONES` (`instalacion.ts`), con el paquete `wrangler` y el binario `wrangler`.
2. Iniciar sesión con `wrangler login --device` lanzado en el servidor, igual que `login-cli.ts`. Ajustes muestra el enlace y el código.
3. Alternativa sin login: un token de API en `CLOUDFLARE_API_TOKEN`, guardado como secreto. Wrangler lo lee antes que cualquier login guardado.
4. Las credenciales de Wrangler quedan en el HOME del servidor, que el agente no ve (aislamiento).

**Decisiones pendientes del usuario.**
- ¿Dónde vive la tarjeta? ¿Una tarjeta de Cloudflare entre los proveedores, o una sección de herramientas en Ajustes?
- ¿Inicio de sesión con código (recomendado, no guarda nada tuyo fuera de Cloudflare) o token de API?

**Cambio de tipo:** grande (integración nueva con credenciales).

---

#### Riesgos conocidos

- Las skills globales las edita la app. Hasta confirmar en el VM que OpenCode las lee, no se sabe si el efecto llega a los agentes.
- El montaje de solo lectura de `~/.config/opencode/skills` dentro de bubblewrap no se probó con `bwrap` (no está en este entorno).
- Las skills de proyecto aparecen como archivos sin confirmar en el repositorio.

- Las claves guardadas llegan a **todos** los agentes, no solo al de su proveedor (`ejecutar.ts` inyecta todas). Mejora posible: pasar solo las claves del proveedor del modelo elegido.
- El chat ya no guarda el mensaje de usuario y la respuesta en la misma transacción que la petición. Si el servidor se cae a mitad de un turno, el aviso de reinicio lo cubre, pero el agente no se reanuda.


## Archivo histórico: revisión del 15 de octubre

Fuente histórica: docs/REVISION-2026-10-15.md.

### Revisión del flujo de trabajo — 15 de octubre de 2026

> Snapshot del 15 de octubre de 2026. Ramas, cifras de pruebas y tamaños de bundle describen esa revisión, no el estado actual. La migración que reconstruyó estados y añadió plan/reporte fue `019_analizador_obrero`; la secuencia vigente está en `server/src/db/index.ts`.

Rama: feat/flujo-seguro-proyectos. Cambios locales, sin commit, push ni despliegue.

#### Cambios

- Conservación de cambios pendientes, archivos ignorados y commits sin subida aprobada. Los clones de chats se conservan para mantener continuidad.
- Cola compartida de chats y tareas; una conversación reutiliza su tarea, sesión y clon. No se comparte la carpeta de escritura entre chats.
- Analizador de solo lectura, validación del plan JSON, historial de versiones y aprobación por hash. Todos los planes nuevos esperan aprobación antes del obrero.
- Obrero con .git de solo lectura, reporte JSON y comprobación del alcance Git del plan. Los desvíos se detienen para revisar otro plan, sin borrar los cambios. Las pruebas reportadas como fallidas dejan la tarea fallida.
- Configuración por proyecto de autor, remoto GitHub, rama destino, token cifrado y comprobación de acceso. Clonar o configurar autor no concede permisos para push.
- Autorizaciones independientes de init, commit, push y PR en el chat. Autorizar commit solo prepara la siguiente solicitud, nunca autoriza push. La tarjeta muestra el remoto fijado al crear el clon.
- Skills por proyecto desde texto, URL SKILL.md de GitHub o catálogos oficiales. Contexto del chat propio y opción de compartir mensajes recientes dentro del proyecto.
- Registro de uso por paso recibido, incluso antes de fallos/cancelaciones y por cada intento de respaldo.
- Selector de modelo con esfuerzo en su pie, sugerencias locales con Tab, tiempo transcurrido y carga del código por pantalla. El archivo JS principal pasó de aproximadamente 522 KB a 310 KB minificados.

#### Verificación

- Suite del servidor en Linux/WSL: 143 pruebas aprobadas, cero fallidas. La integración del worker se omite en la suite general para no consumir fixtures ajenos; sus hooks también aparecen como omitidos.
- Integración aislada con bubblewrap real y proveedor simulado: 5 pruebas aprobadas, 37 aserciones. Incluye análisis sin escritura, .git protegido, autorización por hash, uso tras fallo/cancelación, desvíos del plan y autorizaciones sucesivas de commit/push sin publicar.
- Compilación web con TypeScript y Vite: aprobada.
- Playwright a 390 y 1440 px en chat, configuración de proyecto y detalle de tarea: sin errores JavaScript ni desbordes. Tab completa la sugerencia; el selector envía el esfuerzo elegido; guardar skills y activar contexto funcionan contra una API local de prueba. Los modelos y el consumo Google de la prueba son fixtures, no una consulta a la cuenta real.

#### Límites y despliegue

La migración `019_analizador_obrero` reconstruye de forma compatible los estados de la cola y añade plan, reporte y aprobación. El servidor realiza un respaldo previo al migrar una base existente. Probar primero sobre una copia del VM.

No se usaron credenciales reales de GitHub/Google ni se cambió el entorno del VM. Push se comprueba localmente con remotos simulados y PR con REST simulado. Para operar en producción, configura la GitHub App en el servidor y vincula una instalación limitada a los repositorios necesarios; el acceso usa tokens breves con Contents o Pull requests según la acción. Las claves SSH existentes se conservan como alternativa.

El consumo de Google es el informado por OpenCode a Telo. No importa el historial externo, saldo ni cuotas del proveedor. Las skills importadas contienen solo SKILL.md: no se instalan sus scripts ni referencias. La comprobación de alcance compara cambios que Git registra; no vigila nuevos archivos ignorados ni demuestra que el agente haya seguido semánticamente todos los pasos.

Comandos normales: cd server y bun test; para integración aislada en Linux con bubblewrap/python3, bun run test:worker. Compilación: cd web y bun run build.

### Alternativa Cloudflare (verificada el 22 de octubre)

La interfaz puede alojarse con Workers Static Assets y R2 Standard ofrece 10 GB-mes gratuitos con cuotas de operaciones. El núcleo actual usa Bun, procesos OpenCode/Git y herramientas Linux: Workers no sustituye ese entorno y node:child_process es un stub. Containers exige Workers Paid (mínimo 5 USD/mes más consumo): no satisface el requisito de coste cero. Prioridad: liberar disco de la VM y evaluar descarga de entregables verificados a R2 dentro de su cuota; no se inició migración ni se contrataron servicios.

Fuentes: https://developers.cloudflare.com/containers/platform/pricing/ ; https://developers.cloudflare.com/r2/pricing/ ; https://developers.cloudflare.com/workers/configuration/compatibility-flags/ ; https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

### Verificación operativa del respaldo — 22 de octubre

- [x] Copiados tar y DB del conjunto 2026-10-22T03-34-43 a `scratch/vm-respaldo-verificado/`, fuera del control de versiones. Ambos coinciden por SHA-256 con la copia existente en la PC. Tar: 2.970.440.587 bytes y 377.485 entradas legibles; SQLite: 6.234.112 bytes, integrity_check=ok, ninguna clave foránea rota. Evidencia local: `scratch/vm-respaldo-verificado/verificacion.json`.
- [x] El usuario retiró exclusivamente el tar autorizado desde su terminal administrativa. Su salida df confirma 4,2 GB disponibles y 86 % ocupado. Se conservan la DB y ambas copias verificadas en la PC.
- [ ] Resolver crecimiento recurrente: conservar un tar local diario vuelve a consumir unos 3 GB. Evaluar retención local después de verificar R2 y revisar dependencias regenerables sin eliminar trabajo pendiente. No se cambiaron políticas ni se migró infraestructura.
### Optimización de tareas y respaldo — 22 de octubre

- [x] Diagnóstico aportado por el usuario: tareas 14 GB, datos 16 GB, perfiles de sesiones 1,4 GB. Una tarea contiene 773 MB de node_modules y 63 MB de .opencode/node_modules sobre 861 MB totales. No extrapolar ese ahorro al resto sin medir.
- [x] Herramienta `server/scripts/optimizar-disco.ts`: simulación por defecto; aplicar exige Linux y servicio inactivo. Solo tareas terminadas con finished_at; no sigue enlaces y exige directorio ignorado, sin archivos registrados en Git, package.json y lockfile. No retira perfiles, Git, código ni entregables. .opencode necesita su propio lockfile.
- [x] Nuevos respaldos omiten esos directorios reconstruibles y conservan manifiestos/lockfiles. Contrato de agentes indica reinstalar con frozen/ci si faltan dependencias; no se ejecutan instalaciones privilegiadas ni fuera del aislamiento. Cambios manuales dentro de paquetes ignorados requieren conservación previa por el operador.
- [x] Pruebas locales: 7 de dependencias/CLI/tar/enlaces, 5 de R2, 8 regresiones de auditoría y 5 del contrato/uso: 25 aprobadas. TypeScript servidor y build web aprobados. Prueba Linux de aplicación con systemd pendiente; Windows valida junctions y fixtures reales de Git/tar.
- [ ] Desplegar, simular con datos reales, detener servicio, aplicar desde terminal administrativa y medir df antes/después. Este desarrollo no ha borrado dependencias de la VM. Procedimiento en CLAUDE.md, sección Espacio de dependencias.
Implementación publicada en PR #106: https://github.com/PABLOCESAR2412/Orquestador/pull/106. Aplicación y ahorro real en producción pendientes.


### Integración del PR #105 con main — 22 de octubre

- [x] Conflictos documentales resueltos conservando auditorías del 21 y 22 de octubre, apéndices históricos y correcciones de CI de main. Los registros de cambios de #104 y #105 se conservan juntos. Pruebas de integración locales: 22 de Web Push/MCP/auditoría/dependencias y 31 web aprobadas; instalación frozen, TypeScript servidor y build PWA aprobados. Suite completa del servidor y CI posteriores pendientes.
- [ ] Web Push real en Android y configuración de producción: la integración de ramas no certifica entrega a un dispositivo ni despliega VAPID.

### Integración del PR #106 con main

- [x] Resueltos los conflictos de seguimiento y versiones, conservando Web Push/modelo pequeño de #105 y la optimización de disco de #106. Verificación: 24 pruebas de disco, R2, Push y MCP aprobadas; TypeScript servidor y build PWA aprobados. La aplicación en la VM sigue pendiente.

### Revisión final de almacenamiento y mantenimiento desde Ajustes — 22 de octubre

- [x] Aplicación real del PR #106 confirmada por el usuario: 130 carpetas retiradas; df muestra 14 GB ocupados, 16 GB disponibles y 46 % de uso. El usuario confirmó que Telo funciona correctamente. Esta evidencia sustituye el pendiente de aplicación inicial del PR #106; no certifica todavía la política nueva.
- [x] M01 — Faltaban controles de mantenimiento en la app. Añadidos analizar sin borrar, limpiar dependencias y configuración persistente por umbral/intervalo/antigüedad. Política apagada por defecto, 85 % / 24 h / 7 días iniciales. La comprobación cada minuto no lanza limpiezas más de una vez por hora con uso alto. Evidencia: pruebas de política, filtros y rutas.
- [x] M02 — La limpieza en vivo necesitaba protección frente a reanudaciones. Reutiliza conTarea y comprueba estado, antigüedad y ocupación del chat/proyecto antes de cada retiro. Conserva código, Git, sesiones y entregables. No limpia tareas activas ni recientes. Una operación de mantenimiento a la vez. Evidencia: fixtures activos/recientes/chat ocupado y confirmación obligatoria.
- [x] M03 — El borrado síncrono de muchos paquetes podía bloquear la API. Retiro atómico fuera del repo y borrado asíncrono, con recuperación de retiros interrumpidos. El agente puede reinstalar al continuar. Evidencia: limpieza real de fixtures, veto antes de borrar y recuperación tras reinicio.
- [x] M04 — El diagnóstico no mostraba perfiles de sesiones, entregables y adjuntos. Ahora aparecen separados y sin rutas absolutas. Evidencia: prueba del endpoint de diagnóstico.
- [x] M05 — Los botones de mantenimiento dentro del formulario general podían enviar preferencias ajenas. Tipo button explícito, Enter guarda solo la política, sin barra de guardado duplicada. Evidencia: Playwright comprueba cero escrituras adicionales de preferencias y recorrido a 390/1440 px sin desbordes ni errores JavaScript.
- [x] Verificación de este lote: 27 pruebas de servidor (9 dependencias, 5 mantenimiento, 8 auditoría, 5 R2), 31 pruebas web, TypeScript servidor y build PWA aprobados. Playwright: guardar política, Enter, analizar y limpiar a 390/1440 px con API local simulada. Detector de diseño sin hallazgos. Playwright CLI no estaba instalado; se usó el harness Playwright versionado del proyecto. El video real se omitió en ese recorrido porque no se configuró fixture; no se modificó su flujo.
- [ ] Desplegar y activar la política desde Ajustes si se desea; comprobar primer ciclo real en Linux. No se modificó la configuración de producción ni se detuvieron agentes desde esta revisión.
- [x] M06 — Perfiles y proyectos incluidos en el respaldo mediante inventario y fotografías SQLite consistentes; prueba de recuperación desde tar con WAL abierto aprobada en `respaldo-integral.test.ts` (R06/R14 de la reauditoría del 23-oct). Prueba de restauración operativa en VM pendiente; los respaldos antiguos mantienen su alcance.
- [ ] M07 — Revisar por separado caché de paquetes del sistema, journal y respaldos manuales. Requiere medición administrativa actual y política específica; no mezclar esas rutas con dependencias de tareas. No se ha demostrado cuánto espacio adicional se recuperaría.

Implementación: PR #107 https://github.com/PABLOCESAR2412/Orquestador/pull/107. Pendientes de despliegue y validación operativa conservados.

### Detener el agente desde el chat — 22 de octubre

- [x] Faltaba un botón de cancelación general en el compositor. Añadido Detener cuando el chat figura ocupado o en proceso, también en móvil. Pausa la cola local sin retirar sus mensajes ni el borrador.
- [x] Turnos libres sin AbortSignal: cada ejecución registra su controlador y la nueva ruta autenticada de detener lo aborta. En proyectos reutiliza cancelTask. El cierre libera ocupación y conserva sesión/workspace; muestra aviso de parada en lugar de un error genérico. Subchats siguen siendo de solo lectura.
- [x] Pruebas: 21 casos de chat aprobados y 8 regresiones de auditoría, TypeScript servidor y build web aprobados. Playwright verificó botón, llamada de detener y cola pausada a 390/1440 px. Los 12 casos de runner Linux, incluida cancelación real del grupo, se omiten en Windows y quedan para CI. No se detuvo ninguna ejecución de producción desde esta tarea.

- [x] Ajustes: retirada la etiqueta Datos del servidor y la hora junto a las pestañas, con sus estilos sin uso. Sin cambios en las métricas. Validación: compilación web. PR #107.

- [x] Ejecuciones recientes: ancho fijo de columnas, nombres/encabezados con salto de línea y proveedor separado; contención del desplazamiento horizontal en tablas. Playwright con nombre de modelo largo confirma tabla dentro del panel y página sin desborde a 390/1440 px; build web aprobado. Datos y cálculos sin cambios. PR #107.

# Publicación de demos con Wrangler y Vercel — 1 de noviembre de 2026

- [x] Ajustes instala Wrangler `4.156.0` y Vercel CLI `65.5.0` con versiones fijadas, muestra su estado y ofrece comandos copiables de inicio de sesión y despliegue desde SSH. Ambos admiten publicación por CLI sin vincular un repositorio; un sitio estático de demo no necesita base de datos.
- [x] Las sesiones OAuth permanecen en el HOME del usuario `orquestador`. Bubblewrap oculta el HOME al agente, así que ni `.wrangler` ni `.vercel` se montan en el sandbox. La publicación automática iniciada por un agente todavía requiere una acción de servidor con aprobación explícita; no se entregan estas credenciales al modelo.
- [x] El error de la captura es un HTTP 500 genérico. La clasificación existente lo considera transitorio, reanuda la sesión e intenta tres veces con esperas; solo cambia a otro modelo si la política y los respaldos configurados lo permiten. La captura no trae logs ni identificador de solicitud para atribuir el 500 a Telo o a un proveedor concreto.
- [x] Verificación local: pruebas dirigidas del servidor, 26 aprobadas y 19 omitidas en Windows (flujos que requieren Linux/setsid); TypeScript del servidor y build web aprobados; Playwright UI smoke aprobado a 390 y 1440 px, incluidos comandos copiables y ausencia de scroll horizontal. El MP4 de fixture no se configuró y esa parte del smoke se omitió.
- [ ] Instalar en la VM, autorizar la cuenta personal de Cloudflare y Vercel desde sus flujos de dispositivo, comprobar `whoami` y hacer una publicación de vista previa real. Esta rama no instala ni inicia sesión en la VM antes del merge.

Referencias oficiales: [Cloudflare Wrangler login por dispositivo](https://developers.cloudflare.com/workers/wrangler/commands/general/), [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Vercel login](https://vercel.com/docs/cli/login), [Vercel deploy desde CLI sin Git](https://vercel.com/docs/deployments).

### Push de workflows desde Telo — 3 de noviembre de 2026

- [x] El rechazo al subir `Cubo/.github/workflows/cubo-deploy.yml` confirma que la credencial de GitHub App no incluía `Workflows`. El flujo pedía solo `Contents: write`; GitHub exige también `Workflows: write` para que una App actualice archivos de Actions por Git. [Documentación de contenidos](https://docs.github.com/en/rest/repos/contents) y [permisos de GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).
- [x] Telo ahora solicita `Workflows: write` únicamente si el diff toca `.github/workflows` (incluida la ruta anterior de un renombrado); conserva `Contents: write` y el acceso limitado al repo. Si GitHub deniega el permiso, la acción indica cómo activarlo en la App y aprobarlo para la instalación.
- [x] Verificación local: pruebas de GitHub App (16 aprobadas), TypeScript del servidor y `git diff --check` aprobados. Las pruebas de acciones Git no completaron en este entorno Windows porque el sandbox impide a Git escribir configuración en los repositorios temporales que crean.
- [ ] En GitHub, habilitar `Repository permissions → Workflows → Read and write` en la GitHub App y aprobar la actualización en su instalación. Luego desplegar esta versión y repetir push de rama y creación de PR; el código no puede conceder ese permiso a la cuenta por sí mismo.

# Oficina pixel art — 3 de noviembre de 2026

Rama `feat/oficina-pixel`, sobre `main` en `ae7d15c`. Reemplaza la oficina anterior por un plano pixel art con un personaje por chat. Es solo decorativa y dinámica: no cambia ningún dato del chat ni de las tareas, y no llama a ningún modelo.

- [x] **Plano y capacidad.** Con las piezas entregadas se compuso un plano ampliado (`web/scripts/oficina-plano.py`, repetición de bandas del plano original sin generar arte nuevo): **30 escritorios** (5 × 6) y una mesa conjunta de 8 puestos, **3 salas de reuniones** de 8 asientos, zona de descanso con **el doble de capacidad** (2 mesas × 4 sillas), oficina del gerente con cola de 8 puestos, baño y puertas en todas las paredes interiores. Las franjas celestes son ventanas; las puertas se abrieron aparte.
- [x] **Assets.** `web/scripts/oficina-assets.py` (Python con Pillow, numpy y scipy; se ejecuta a mano, no forma parte del build) segmenta las hojas por proyección de la transparencia, limpia el halo verde, normaliza por ancho de cabeza y empaqueta WebP a 2×. Pasan de ≈16,7 MB originales a **≈452 KB** versionados (plano 147 KB). Los originales de ChatGPT no se versionan; `oficina-fuentes.json` solo guarda sus nombres. Si cambian los assets, se vuelve a correr el script y, si cambia el plano, se recalibra `oficina-mapa.ts` con `?calibrar`.
- [x] **Motor determinista en el cliente** (`web/src/lib/oficina-motor.ts`, sin modelo ni DOM): semilla por id de chat, reservas de escritorio, rutas por Dijkstra sobre un grafo de puntos, ciclo de ocio (copiadora, charla, café, baño). Estado derivado de campos que ya existen: `en_proceso`/`ocupada` → trabaja en su escritorio con la pantalla encendida; `work_mode: "plan"` → sala de reuniones con sus subagentes; subagentes en ejecución → 8 s en sala y después mesa conjunta; `pendiente_aprobacion` → cola frente al gerente. El texto bajo cada personaje es el último paso de los eventos `actividad`; mientras no llegue ninguno se muestra «En ejecución».
- [x] **Pantalla.** Lienzo con zoom y arrastre (puntero, pellizco, Ctrl + rueda y teclado), un solo `requestAnimationFrame` a ~30 fps en pausa con la pestaña oculta, `prefers-reduced-motion` = posiciones finales. Las etiquetas miden lo mismo con cualquier zoom y se muestran por prioridad solo si no se encimarían. Panel «Agentes» con detalle, subagentes y lista de todos (accesible por teclado). Modo `?demo=N` y `?calibrar` solo en desarrollo y `localhost`.
- [x] **Limpieza.** Se retiró `/api/jev/oficina` (GET y POST), el tipo `"oficina"` de `evaluarConJev` y `getJevOficina`/`decidirJevOficina` de `api.ts`: ya nada los usaba y el POST gastaba la cuota de Jev. La tabla `uso_jev_oficina` y su migración 052 se conservan (no se editan migraciones aplicadas).
- [x] **PWA.** Los sprites no se precargan al instalar; se guardan al abrir la Oficina (`StaleWhileRevalidate`, caché `telo-oficina`) para que sigan disponibles sin conexión. Sin hash en el nombre, así que un reemplazo de archivos llega en la visita siguiente.
- [x] **Verificación (3 de noviembre).** `cd web && bun run build` pasa; `cd web && bun test` 100 aprobadas (incluye 20 de motor y 5 de datos de la oficina); `cd server && bun test tests/claves-proveedor.test.ts` 33 aprobadas. Playwright contra `web/dist` con la API simulada, a 390 y 1440 px, tema oscuro y claro, con 30 chats de demostración y con 10 conversaciones realistas (en proceso, planificando, con subagentes, esperando aprobación): sin desborde horizontal y sin errores de consola. Rendimiento con 60 agentes: ≈1,6 % de CPU en scripts y ≈600 nodos DOM.
- [ ] **Fallos previos del servidor, sin relación con este cambio.** `cd server && bun test` falla en 7 pruebas (respaldo, worker, `uuid`/`sprintf`) tanto en `main` como en esta rama; los errores de carga son de `web-push` y `@aws-sdk/*`, que no están instalados en el entorno donde se probó. Pendiente confirmarlo en un entorno con las dependencias completas.
- [ ] **Assets por mejorar (los entrega el usuario).** Hojas «trabajar» de Ana, Diego, Javier y Luis: de la cintura para arriba, sin silla ni cola de fantasma (hoy se recortan con `corte_trabajar`); fondo transparente sin halo verde; mismo tamaño de cabeza entre las hojas de caminar y trabajar.
- [ ] **Pendiente de decisión.** Un chat con `cuota_modelo` o con error no se marca todavía en la oficina; solo se marca la espera de aprobación. Con más de 30 chats activos, los de actividad más antigua no tienen escritorio y se cuentan como «+N sin escritorio».
- [ ] Probar en el VM con chats reales tras el merge (la simulación usa respuestas de API falsas).
