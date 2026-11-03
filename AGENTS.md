# AGENTS.md: guía compartida del proyecto Orquestador

Esta guía sirve para Codex CLI, OpenCode, Antigravity y los agentes de Orquestador. Para desarrollar este repo, lee también `CLAUDE.md`; su sección de Graphify y estas reglas permiten trabajar con el contexto del proyecto desde cualquier CLI.

## Flujo de una tarea

1. **Cola.** La tarea entra como `queued`. Corren hasta diez tareas independientes; dos tareas del mismo proyecto se serializan.
2. **Analizador.** Lee la tarea y su contexto, y produce un plan. No modifica archivos.
3. **Aprobación.** Si faltan datos que bloquean el alcance, el plan incluye commit, push o PR, o pide una acción externa, la tarea espera la respuesta o autorización del usuario en la app.
4. **Obrero.** Ejecuta el plan aprobado dentro de su workspace, prueba lo que cambió y escribe un reporte.
5. **Cierre.** La tarea queda `done`, `failed` o `cancelled`. Se guardan el reporte, el costo y el uso. Se notifica al usuario (fase 8 de `SEGUIMIENTO.md`).

Estados de una tarea:

```
queued → analyzing → waiting_approval → running → done | failed | cancelled
                  ↘ running (si el plan no pide aprobación)
running → analyzing (desviación: una replanificación; después requiere intervención del usuario)
```

Sin preguntas bloqueantes ni acciones que requieran aprobación, pasa directo a `running`. Una desviación del plan vuelve a análisis y pide revisión antes de continuar.

## Contexto que recibe cada agente

- La tarea del usuario: texto, modelo y esfuerzo.
- `AGENTS.md` y `CLAUDE.md` del proyecto: en tareas con Git figurán en el clon; en tareas sin proyecto, Telo lee los documentos guía del workspace y los antepone al prompt.
- Las skills del proyecto (`SKILL.md`), según la configuración del proyecto.
- La memoria del proyecto, que el sistema actualiza.
- Si existe `graphify-out/graph.json`, el grafo de este proyecto. Telo consulta por separado durante análisis y ejecución; nunca reutiliza el grafo de otro repo.
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
- Pregunta solo por decisiones que cambian materialmente el alcance, el resultado o el riesgo; primero revisa instrucciones, archivos y respuestas previas. Agrupa hasta tres preguntas y recomienda una opción.
- Mantén el plan corto: de 3 a 8 pasos.

## Obrero

**Entrada:** el plan aprobado, el workspace y las skills.

**Reglas:**

- Trabaja solo dentro de su workspace (`data/tasks/<id>` o el repo clonado del proyecto) y solo en los archivos del plan. Si necesita algo fuera, lo reporta.
- Ejecuta las pruebas del proyecto. Si no hay pruebas, lo dice.
- No hace commit, push ni PR por su cuenta. Deja el diff listo para revisión.
- El resumen describe el resultado observado, no copia el título ni el prompt. Clasifica `tipo_cambio` según el diff (`feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `style`, `revert` o `chore`).
- Si falla, detiene la tarea y explica qué pasó y qué intentó.

**Salida (JSON):**

```json
{
  "resumen": "...",
  "tipo_cambio": "feat | fix | docs | test | refactor | perf | build | ci | style | revert | chore",
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
- El plan se aprueba cuando contiene preguntas bloqueantes o una acción que requiere autorización. El obrero no cambia el alcance aprobado en silencio: si el plan no sirve, lo reporta y vuelve a análisis.

## Mapa de documentos

- `CLAUDE.md`: arquitectura estable, comandos y límites del repo; mantenlo por debajo de 300 líneas.
- `DESIGN.md`: sistema visual; léelo solo para cambios de interfaz.
- `SEGUIMIENTO.md`: evidencia, pendientes operativos e historial. Consulta los encabezados pertinentes, no cargues el archivo completo por defecto.
- `TODO.md`: resumen corto de próximos pasos; los detalles y pruebas están en `SEGUIMIENTO.md`.
- `FASE2.md`, `FASE3.md` y `PLAN.md` son redirecciones históricas a `SEGUIMIENTO.md`; consérvalas para no romper enlaces y no dupliques contenido allí.

## graphify

Cada proyecto tiene su propio grafo local en `graphify-out/`. Esta carpeta es generada y no se mezcla con la de otros proyectos.

Usa la skill o el CLI de Graphify cuando el usuario pida `/graphify`.

- Antes de explorar arquitectura o dependencias, consulta `graphify query "<pregunta concreta>"` si existe `graphify-out/graph.json`. Usa `graphify path "<A>" "<B>"` para relaciones y `graphify explain "<concepto>"` para un símbolo.
- Usa el informe `graphify-out/GRAPH_REPORT.md` solo para orientarte sobre todo el proyecto; verifica en el código las conclusiones que vayas a modificar.
- Si el grafo no existe, créalo con Graphify para este repo, sin incluir dependencias, datos ni directorios temporales. No pidas al usuario que repita el contexto del proyecto.
- En tareas del worker, Telo consulta el grafo local por solicitud con una búsqueda acotada y añade los nodos relacionados al contexto del analizador y el obrero. Cada consulta aparece en «Actividad de Telo: Graphify y skills» junto a las skills efectivamente activadas; si falta el grafo, lo dice y continúa sin contexto cruzado.
- Después de cambios de código, ejecuta `graphify update .` para mantenerlo al día. Las reglas `.graphifyignore` excluyen documentación y artefactos; así esta actualización es AST y no llama a un modelo.
- No uses otro grafo global ni el de una conversación distinta: cada raíz de proyecto mantiene su cerebro separado.
- Al preparar un clon de tarea, Telo sincroniza `graphify-out/graph.json` y `GRAPH_REPORT.md` del repo local y excluye esa carpeta del diff Git. Si el grafo no existe, la actividad lo indica; el agente no lo inventa ni lo sustituye con un grafo global.
- Para habilitar otro repo, ejecuta desde su propia raíz `graphify codex install --project`, `graphify opencode install --project` o `graphify antigravity install --project`; antes de construir su grafo, excluye dependencias y archivos locales en `.graphifyignore`.
