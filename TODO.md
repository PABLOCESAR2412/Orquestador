# Pendientes prioritarios

Actualizado: 2 de noviembre de 2026. Esta lista es un resumen; el estado, las pruebas y el contexto están en [SEGUIMIENTO.md](SEGUIMIENTO.md). No dupliques aquí el historial.

## Validaciones operativas

- [ ] Probar en la VM sesiones, ejecución, cuotas y continuidad reales de Codex, OpenAI API, OpenCode, Antigravity y Command Code Go; los mocks no confirman acceso ni saldo de proveedor. La consulta completa de OpenAI necesita `TELO_OPENAI_ADMIN_API_KEY` y `TELO_OPENAI_PROJECT_ID`; el Go exacto sigue en `/usage` de la CLI.
- [ ] Revisar los errores 502/Gemini con el journal después del despliegue. Esta revisión no publicó cambios.
- [ ] Confirmar restauración de respaldos, acceso Tailscale desde el teléfono y entrega real de Web Push.

## Seguridad y fiabilidad

- [ ] Verificar Bubblewrap y perfiles de Codex en Linux/VM. Mantener pendiente el aislamiento de red hasta que exista un proxy de egreso y gestión segura de credenciales.
- [ ] Repetir la auditoría de dependencias con acceso al registro y corregir solo avisos confirmados.

## Cerebro e integraciones

- [x] Consultar el grafo Graphify propio de cada proyecto en análisis y ejecución; agregar los nodos relacionados al prompt y mostrar la consulta y las skills activadas en la actividad del chat. Si no hay grafo, Telo lo indica y sigue sin mezclar contexto de otros proyectos.
- [ ] Completar importación/exportación de la memoria tipo Obsidian y recuperar solo notas relevantes con presupuesto acotado.
- [ ] Validar integraciones que dependen de credenciales, permisos o servicios externos antes de habilitarlas.

## Terminado recientemente

- [x] Guías de proyecto compactas y Graphify local por repo, con reglas para Codex, OpenCode y Antigravity. Ver `AGENTS.md`.
- [ ] Confirmar en la VM el inventario disponible de skills. `RTNK`, `Grailman` y `Hypergrailman` no están instaladas en los directorios locales inspeccionados; no se muestran como activas hasta instalar y validar sus nombres y guías.
- [x] `FASE2.md`, `FASE3.md` y `PLAN.md` se conservan como redirecciones; los detalles viven en un solo seguimiento.
