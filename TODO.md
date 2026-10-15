# TODO.md: estado y pendientes

Actualizado el 15 de octubre de 2026. Lo probado en local no implica despliegue en el VM.

## Implementado en esta revisión

- [x] Conservar clones con cambios, archivos ignorados o commits sin subida aprobada; conservar los espacios de trabajo de chats.
- [x] Chats en la cola del worker, con clon propio y continuidad entre mensajes.
- [x] Separar análisis de solo lectura y ejecución; validar y versionar planes y exigir aprobación por hash (migración 016).
- [x] Guardar reportes del obrero y detener cambios fuera del alcance Git del plan para revisión, conservando los archivos.
- [x] Solicitudes de init, commit, push y PR con autorización visible en el chat.
- [x] Configuración Git por proyecto: autor, remoto, rama destino, token cifrado y comprobación de acceso. Se reutiliza la clave SSH existente.
- [x] Skills por proyecto: pegar instrucciones, importar SKILL.md o buscar en catálogos oficiales. No instala recursos auxiliares.
- [x] Contexto del propio chat e intercambio opcional de contexto reciente dentro del proyecto.
- [x] Uso incremental por paso del agente, incluidos fallos y cancelaciones; distinguir falta de datos de consumo cero.
- [x] Modelo y esfuerzo en un mismo selector; sugerencias del historial con Tab y progreso del agente.
- [x] Compilación web y revisión con Playwright a 390 y 1440 px para chat y configuración del proyecto.
- [x] Suite del servidor ejecutada en Linux/WSL. Ver el reporte de la revisión para el resultado final.

## Antes de desplegar

- [ ] Revisar el diff de feat/flujo-seguro-proyectos. Commit, push y PR de esta rama solo cuando Pablo los pida.
- [ ] Probar la migración 016 sobre una copia de la base del VM y conservar el respaldo previo.
- [ ] Instalar/comprobar OpenCode y bubblewrap en el entorno de ejecución real.
- [ ] Configurar TELO_PROYECTOS_DIR y TELO_CLAVE_CIFRADO en el archivo de entorno del servicio; respaldar la clave de cifrado fuera del VM.
- [ ] Probar un proveedor real dentro de bubblewrap, análisis/aprobación/ejecución y recuperación tras reinicio.
- [ ] Probar token de GitHub o deploy key con permiso de escritura en un repositorio de prueba. Para PR, el token necesita Pull requests de escritura.
- [ ] Probar push y PR reales desde sus autorizaciones. La identidad Git del autor no concede acceso remoto.
- [ ] Comprobar restauración de base y workspace, timer de respaldo y copia fuera del VM.
- [ ] Verificar acceso desde el teléfono por Tailscale, persistencia de serve tras reinicio y expiración de la clave del VM.
- [ ] Confirmar presupuesto de Azure y alertas al 50, 80 y 100 %.

## Producto pendiente

- [ ] Notificaciones por finalización, fallo y aprobación, sin duplicarlas.
- [ ] Runners adicionales de Codex y Google/agy, después de validar el flujo central en el VM.
- [ ] Login de GitHub mediante OAuth/device flow si se decide configurar una aplicación GitHub. Hoy se usa token cifrado por proyecto o deploy key.
- [ ] Cuotas/saldo consultados al proveedor cuando exista API; las cifras actuales son consumo informado por el runner y saldos manuales estimados.
- [ ] Completar skills que dependan de scripts/referencias: la importación actual incluye solo SKILL.md y lo advierte.
- [ ] Decidir la política de aprobación de memoria aprendida, terminal web y sustitución o enlace a Cockpit.
- [ ] Verificar las demás vistas en móvil/escritorio y contraste del sistema visual completo.
