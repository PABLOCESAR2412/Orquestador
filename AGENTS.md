# AGENTS.md: agentes del producto Orquestador

Este archivo describe cómo trabajan los agentes que Orquestador lanza para cada tarea del usuario. Si un agente trabaja **dentro** de este repo para desarrollarlo, lee primero `CLAUDE.md`.

## Flujo de una tarea

1. **Cola.** La tarea entra como `queued`. Solo corre una a la vez; las demás esperan.
2. **Analizador.** Lee la tarea y su contexto, y produce un plan. No modifica archivos.
3. **Aprobación.** Si el plan incluye commit, push, PR o cambios fuera del workspace, la tarea espera la aprobación del usuario en la app. Sin aprobación, esa parte no se ejecuta.
4. **Obrero.** Ejecuta el plan aprobado dentro de su workspace, prueba lo que cambió y escribe un reporte.
5. **Cierre.** La tarea queda `done`, `failed` o `cancelled`. Se guardan el reporte, el costo y el uso. Se notifica al usuario (fase 8 de `PLAN.md`).

La migración 016 conserva `status` para la cola y añade `phase` para el flujo del agente:

```
queued/analyzing → running/analyzing → queued/waiting_approval
  → queued/executing → running/executing → done/completed
```

Todos los planes nuevos esperan aprobación, también los de chat. Se guardan versiones en `task_plans`; la aprobación queda ligada al hash del plan. Los estados `failed`, `interrupted` y `cancelled` se mantienen. Si el obrero solicita desviarse o modifica archivos fuera del alcance aprobado, queda `interrupted/waiting_approval` y debe analizarse otra versión; sus cambios se conservan para revisión.

## Contexto que recibe cada agente

- La tarea del usuario: texto, modelo y esfuerzo.
- `AGENTS.md` y `CLAUDE.md` del proyecto, si existen en su repo.
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
- Mantén el plan corto: de 1 a 8 pasos. Lista rutas relativas; no se admite `.git` ni salir del workspace. Para directorios nuevos lista cada archivo que se creará.

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

La cola usa un analizador de solo lectura y un obrero con plan aprobado. `tasks.plan`, `report`, `plan_hash` y `approved_hash` guardan el contrato, y `task_plans` conserva sus versiones. El uso se registra por cada evento `step_finish`, también antes de fallos, cancelaciones y cambios de modelo. Los chats usan la misma cola y conservan su tarea y clon entre turnos. Git y PR se solicitan como autorizaciones independientes dentro del chat; el backend es quien los ejecuta.
