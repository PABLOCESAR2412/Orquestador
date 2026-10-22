# AGENTS.md: agentes del producto Orquestador

Este archivo describe cómo trabajan los agentes que Orquestador lanza para cada tarea del usuario. Si un agente trabaja **dentro** de este repo para desarrollarlo, lee primero `CLAUDE.md`.

## Flujo de una tarea

1. **Cola.** La tarea entra como `queued`. Corren hasta diez tareas independientes; dos tareas del mismo proyecto se serializan.
2. **Analizador.** Lee la tarea y su contexto, y produce un plan. No modifica archivos.
3. **Aprobación.** Si el plan incluye commit, push, PR o cambios fuera del workspace, la tarea espera la aprobación del usuario en la app. Sin aprobación, esa parte no se ejecuta.
4. **Obrero.** Ejecuta el plan aprobado dentro de su workspace, prueba lo que cambió y escribe un reporte.
5. **Cierre.** La tarea queda `done`, `failed` o `cancelled`. Se guardan el reporte, el costo y el uso. Se notifica al usuario (fase 8 de `PLAN.md`).

Estados (la migración 019 los introdujo; el esquema va por la 039, ver `PLAN.md` fase 5):

```
queued → analyzing → waiting_approval → running → done | failed | cancelled
                  ↘ running (si el plan no pide aprobación)
running → analyzing (desviación: replanificación, con tope de 3 versiones del plan)
```

Si el plan no requiere aprobación (ningún commit, push o PR, y sin preguntas), pasa directo a `running`. Tras una desviación, siempre espera al usuario.

## Contexto que recibe cada agente

- La tarea del usuario: texto, modelo y esfuerzo.
- `AGENTS.md` y `CLAUDE.md` del proyecto: en tareas con Git figurán en el clon; en tareas sin proyecto, Telo lee los documentos guía del workspace y los antepone al prompt.
- Las skills del proyecto (`SKILL.md`), según la configuración del proyecto.
- La memoria del proyecto, que el sistema actualiza.
- Para "continuar": la sesión anterior de OpenCode (`-s <session>`) y el mismo workspace.

## Analizador

**Entrada:** la tarea y su contexto.

**Salida (JSON):**

```json
{
  "objetivo": "una frase",
  "supuestos": ["..."],
  "pasos": [{ "id": 1, "descripcion": "...", "archivos": ["ruta"] }],
  "criterios_de_aceptacion": ["..."],
  "requiere_aprobacion": ["commit", "push", "pr"],
  "riesgos": ["..."],
  "preguntas": ["..."]
}
```

**Reglas:**

- No edita archivos ni ejecuta comandos que cambien estado.
- Si falta información crítica, la lista en `preguntas`. No la inventa.
- Mantén el plan corto: de 3 a 8 pasos.

## Obrero

**Entrada:** el plan aprobado, el workspace y las skills.

**Reglas:**

- Trabaja solo dentro de su workspace (`data/tasks/<id>` o el repo clonado del proyecto) y solo en los archivos del plan. Si necesita algo fuera, lo reporta.
- Ejecuta las pruebas del proyecto. Si no hay pruebas, lo dice.
- No hace commit, push ni PR por su cuenta. Deja el diff listo para revisión.
- Si falla, detiene la tarea y explica qué pasó y qué intentó.

**Salida (JSON):**

```json
{
  "resumen": "...",
  "cambios": [{ "archivo": "ruta", "tipo": "crear | editar | borrar" }],
  "pruebas": [{ "comando": "...", "resultado": "ok | fallo | no_aplica" }],
  "pendientes": ["..."],
  "diff_disponible": true
}
```

## Reglas comunes

- Responde en el idioma del usuario (español por defecto).
- Nunca imprimas secretos en salidas ni en logs.
- Registra tokens y costo de cada llamada en la tabla `usage`, como ya lo hace el chat.
- El plan lo aprueba el usuario. El obrero no cambia el plan en silencio: si el plan no sirve, lo reporta y la tarea vuelve a analizarse.

## Estado del código

Existen la cola, el runner de OpenCode, el registro de costo, el analizador y el obrero (`server/src/worker.ts`, `server/src/plan.ts`), el plan y el reporte por tarea, y la aprobación del plan. El worker corre con OpenCode real en el VM, con trazas y sesiones (ver `PLAN.md` fase 5). Gobernanza en marcha: purga del historial vencido y índices de `repository_actions` (migración 039), vigilante de inactividad y escaneo de secretos sobre los blobs del índice. Queda fuera la notificación Web Push (fase 8). Ver `TODO.md`.
