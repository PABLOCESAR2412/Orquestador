# Pendientes y verificación

Revisión: 16 de octubre de 2026. Una casilla marcada indica la comprobación descrita, no una validación implícita en producción. El historial anterior está en Git.

## Fiabilidad de la aplicación

- [x] Inicio por código de dispositivo de Codex: enlace sin ANSI, código visible y copiable; pruebas y revisión a 390/1440 px.
- [x] La detección de sesión consulta `codex login status`, con límite de tiempo y caché breve; no acepta un archivo de configuración como prueba de autenticación.
- [x] El worker comprueba herramientas antes de llamar a un modelo. Los avisos sobre dependencias ausentes se guardan y se entregan al analizador para preparar su instalación antes de las pruebas.
- [x] Las autorizaciones Git se vinculan al mensaje que las originó; repetir una decisión no repite la operación.
- [x] Los reportes JSON antiguos muestran resumen y causa; los detalles se despliegan y los bloques de memoria no se muestran. No se evalúan expresiones del modelo.
- [x] Métricas: tokens medidos, costes estimados, datos ausentes e históricos sin precisión identificada. Uso por tarea en ejecuciones recientes; la memoria sigue incluida en la tarea y no se atribuye dos veces.
- [x] CI definida para cada PR: tipos, suites aisladas del servidor, worker Linux, build y navegador a 390/1440 px. Confirmar la ejecución concreta en el PR antes de fusionar.

## Prueba real de GitHub App en el VM

- [x] Repositorio desechable autorizado: `https://github.com/PABLOCESAR2412/Test.git`; confirmado privado y vacío por GitHub.
- [x] Configurar `TELO_GITHUB_APP_ID` y `TELO_GITHUB_APP_PRIVATE_KEY_PATH` en el servicio, vincular la instalación en Ajustes e incluir Test en su alcance.
- [x] Inicializar la rama base de Test con README, commit `e0cafee891fcc20c4f369faebf5067041aa54aa0`. Preparación mediante la cuenta de GitHub; no demuestra autenticación con la App de Telo.
- [x] Desde Telo, clonar Test privado con la GitHub App, crear el cambio mínimo y autorizar commit/push. GitHub confirma la rama `telo/0e680496`, el commit `325247bef1fee13ef793813f1f924d2de744984e` y el autor `telo-orquestador[bot]`.
- [ ] Crear un PR de Test. GitHub respondió 422 en la versión desplegada y Telo ocultó el cuerpo de validación; el código de este PR ahora conserva ese detalle. No se fusionó ni se tocó Cubo. Reintentar una vez que el PR #53 esté desplegado; no repetir solicitudes mientras el motivo siga sin diagnóstico.

## Verificación operativa después del despliegue

- [ ] Confirmar la migración 023 y su copia previa en `DATA_DIR/respaldos-migracion`; comprobar que se conservan los valores históricos.
- [ ] Probar el runner OpenCode real dentro de bubblewrap, incluida instalación de dependencias, cancelación y reanudación. Las pruebas automáticas usan un agente ficticio.
- [ ] Confirmar acceso desde el teléfono por Tailscale y arranque de app, Serve y respaldos tras reiniciar el VM.
- [ ] Confirmar `TELO_PROYECTOS_DIR`, escucha en loopback, clave de cifrado respaldada y desactivación de expiración de la clave Tailscale del VM.
- [ ] Google: completar OAuth en el VM y comprobar el alcance real de la información disponible. No presentar estimaciones de Telo como cuota del proveedor.
- [ ] Revisar contraste AA en todas las pantallas, además de las comprobaciones automáticas de desbordes.
- [ ] Confirmar presupuesto y alertas de Azure. Revisar ramas remotas y claves SSH antiguas antes de eliminarlas.

## Acceso de desarrollo

La prueba de acceso de GitHub App en Test se completó para clonado, commit y push. Falta que el flujo desplegado muestre el motivo del rechazo 422 para completar la creación del PR. No compartir claves privadas, tokens ni archivos de sesión en el chat.
