import { db } from "./db";
import { registrarEvento } from "./eventos";
import { getModels, validateSelection } from "./models";
import { getPreferences } from "./preferences";
import { entornoDeProyecto } from "./secretos";
import { entornoProveedores } from "./claves-proveedor";
import { redactar } from "./redaccion";
import { AislamientoError, aislamientoActivo, prepararPerfilOpenCode } from "./runners/aislamiento";
import { ErrorAgente, runOpenCode, type RunResult, type Usage } from "./runners/opencode";
import { runCodex } from "./runners/codex";
import { promptConHistorial, sesionCompatible } from "./conversacion-contexto";
import { conMemoria, extraerMemoria, guardarMemoria, guardarPropuestaMemoria, memoriaDelProyecto, quitarBloqueMemoria } from "./memoria";
import { conservarMemoriaSegunJev, puntuarMemoriaJev } from "./jev";
import { inyectarSkillsEnPrompt } from "./resolucion-skills";
import { imagenesDelPrompt } from "./chat-adjuntos";
import { configuracionMcpParaAgente } from "./conexiones-mcp";

// Longitud mínima de un valor de secreto para ocultarlo en la salida. Más corto, aparecería en texto normal.
const MINIMO_OCULTAR = 4;

// Punto único para lanzar un agente, lo usan tareas y chats. Añade el entorno del proyecto
// y, si el proveedor falla por saturación, reintenta una vez con el modelo de respaldo.

export type OpcionesAgente = {
  prompt: string;
  model: string;
  variant?: string | null;
  sessionId?: string | null;
  sessionModel?: string | null;
  cwd: string;
  timeoutMs?: number | null;
  signal?: AbortSignal;
  onSesion?: (sessionId: string | null, model: string | null) => void;
  onLinea?: (linea: string) => void;
  onSubagente?: (linea: string) => void;
  // Solo para la tarea: registra el cambio de modelo en su historial.
  taskId?: string;
  projectId?: string | null;
  conversationId?: string | null;
  soloLectura?: boolean;
  // Solo para la tarea: pide al agente escribir la memoria del proyecto al final y la guarda.
  aprender?: boolean;
  // Solo para chats: añade instrucciones de estilo (respuestas concretas y verificables). Las tareas no lo usan.
  estilo?: "chat";
  // Directorio temporal de perfiles de subagentes por ejecución de OpenCode.
  opencodeConfigDir?: string;
  // Captura temporal de eventos de hijos OpenCode, en el mismo perfil efímero.
  opencodeSubagentesTracePath?: string;
};

// `modelo` es el que realmente respondió (puede ser el de respaldo), para registrar el uso.
export type ResultadoAgente = RunResult & { modelo: string; variante: string | null };

// Contrato común, antes de los prompts de fase, para chats y tareas con cualquier runner.
export const CONTRATO_EJECUCION = [
  "Contrato de ejecución común de Telo (aplica a cualquier modelo y proveedor):",
  "- Interpreta la petición como objetivo y respeta sus restricciones. Usa el historial, memoria, instrucciones y skills pertinentes; no repitas trabajo terminado.",
  "- Define alcance, precondiciones y evidencia de término. Si falta un dato bloqueante, pregunta; si no, elige una opción segura y explícala al final.",
  "- Inspecciona contexto y herramientas antes de usarlas; no afirmes capacidades sin comprobarlas.",
  "- Haz el cambio o investigación mínimos que resuelvan el objetivo, dentro del workspace y las autorizaciones recibidas.",
  "- Para investigar, busca en Internet y respalda afirmaciones con enlaces directos en Markdown. Usa materiales pertinentes (documentación, estudios, libros, videos, informes, datasets u otros), prioriza fuentes primarias fiables y atribuye autor/editor si está disponible; nunca inventes enlaces ni fuentes. Si no puedes consultar, dilo.",
  "- Para imágenes, videos o voz, usa primero herramientas locales gratuitas o MCP configurados; no llames APIs que puedan cobrar. Si no puedes producir el formato, explica el límite sin fingir resultados ni usar proveedores de pago.",
  "- Verifica el resultado y comunica evidencia observable, separando lo correcto, lo fallido y lo no probado; nunca inventes resultados.",
  "- Respeta el formato de fase: JSON para análisis/reportes y conversación natural para chats. En trabajos largos, da avances breves; no repitas planes ni muestres razonamiento privado.",
  "- Redacta en español la actividad visible y los avisos de progreso. Conserva sin traducir comandos, código, rutas, nombres propios y citas.",
  "- Explica decisiones con conclusiones y evidencia útil; no reveles razonamiento interno privado.",
].join("\n");

export function conContratoEjecucion(prompt: string): string {
  return `${CONTRATO_EJECUCION}\n---\n${prompt}`;
}

// Un único límite para chats y tareas, sin depender del proveedor elegido.
const MAX_AGENTES_SIMULTANEOS = 10;
let agentesActivos = 0;
const colaAgentes: { signal?: AbortSignal; resolve: () => void; reject: (error: Error) => void; cancelar?: () => void }[] = [];

function liberarAgente(): void {
  const siguiente = colaAgentes.shift();
  if (siguiente) {
    if (siguiente.cancelar) siguiente.signal?.removeEventListener("abort", siguiente.cancelar);
    siguiente.resolve();
    return;
  }
  agentesActivos -= 1;
}

async function reservarAgente(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new Error("Ejecución cancelada.");
  if (agentesActivos < MAX_AGENTES_SIMULTANEOS && colaAgentes.length === 0) {
    agentesActivos += 1;
    return liberarAgente;
  }
  await new Promise<void>((resolve, reject) => {
    const espera: (typeof colaAgentes)[number] = { signal, resolve, reject };
    if (signal) {
      espera.cancelar = () => {
        const indice = colaAgentes.indexOf(espera);
        if (indice !== -1) colaAgentes.splice(indice, 1);
        reject(new Error("Ejecución cancelada."));
      };
      signal.addEventListener("abort", espera.cancelar, { once: true });
    }
    colaAgentes.push(espera);
  });
  return liberarAgente;
}

export function canonicalizarModelo(modelo: string): string {
  if (modelo.startsWith("opencode/gemini-")) {
    return modelo.replace("opencode/gemini-", "google/gemini-");
  }
  if (modelo === "opencode/argon" || modelo === "opencode/gemini-4-argon") {
    return "google/gemini-4-argon";
  }
  if (modelo === "argon" || modelo === "gemini-4-argon") {
    return "google/gemini-4-argon";
  }
  if (modelo.startsWith("gemini-")) {
    return `google/${modelo}`;
  }
  return modelo;
}

export function proveedorDeModelo(modelo: string): string {
  const m = canonicalizarModelo(modelo);
  if (m.startsWith("google/") || m.includes("/google/") || /gemini|argon/i.test(m)) {
    return "google";
  }
  if (m.startsWith("codex/") || m === "codex" || m.includes("/codex/")) {
    return "codex";
  }
  if (m.startsWith("openai/") || m.includes("/openai/")) {
    return "openai";
  }
  if (m.startsWith("groq/") || m.includes("/groq/")) {
    return "groq";
  }
  if (m.startsWith("nvidia/") || m.includes("/nvidia/")) {
    return "nvidia";
  }
  if (m.startsWith("openrouter/")) {
    return "openrouter";
  }
  return m.split("/")[0] || "opencode";
}

export function estimarCosteGemini(modelo: string, inputTokens: number, outputTokens: number): number {
  const esPro = /pro/i.test(modelo);
  const tarifaInput = esPro ? 1.25 / 1_000_000 : 0.075 / 1_000_000;
  const tarifaOutput = esPro ? 5.00 / 1_000_000 : 0.30 / 1_000_000;
  return Math.round((inputTokens * tarifaInput + outputTokens * tarifaOutput) * 10_000) / 10_000;
}

// Cada paso se persiste al llegar: fallos, cancelaciones y respaldos conservan el consumo previo.
export function registrarUsoAgente(
  modelo: string,
  uso: Usage,
  contexto: Pick<OpcionesAgente, "conversationId" | "projectId" | "taskId">,
): void {
  const modeloCanonico = canonicalizarModelo(modelo);
  const provider = proveedorDeModelo(modeloCanonico);
  let costo = uso.cost;
  let costPrecision = uso.costeDisponible === undefined ? "desconocida" : uso.costeDisponible ? "estimado" : "no_disponible";

  if (costo === 0 && uso.tokensEstimados !== true && (uso.input > 0 || uso.output > 0) && provider === "google") {
    costo = estimarCosteGemini(modeloCanonico, uso.input, uso.output);
    costPrecision = "estimado";
  }

  db.query(
    `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens,
      reasoning_tokens, cache_read_tokens, cost, project_id, task_id, tokens_precision, cost_precision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(), contexto.conversationId ?? null, provider, modeloCanonico,
    uso.input, uso.output, uso.reasoning, uso.cacheRead, costo,
    contexto.projectId ?? null, contexto.taskId ?? null,
    uso.tokensEstimados ? "estimado" : uso.tokensMedidos === undefined ? "desconocida" : uso.tokensMedidos ? "medida" : "no_disponible",
    costPrecision,
  );
}

// Saturación, error de servidor o límite del proveedor: justifica probar otro modelo.
// Saldo insuficiente: otro modelo no lo arregla, así que nunca se reintenta.
const PATRON_MODELO_NO_ENCONTRADO = /model[_ ]not found|unknown model|no such model/i;
// Solo límites definitivos (no cualquier 429): la tarea o el chat se detienen para que el usuario elija otro modelo.
const PATRON_CUOTA = /(?:\b(?:quota|cuota)\b.*\b(?:exceed(?:ed)?|exhaust(?:ed)?|deplet(?:ed)?|reach(?:ed)?|agotad[ao]|consumid[ao])\b|\b(?:exceed(?:ed)?|exhaust(?:ed)?|deplet(?:ed)?|agotad[ao]|consumid[ao])\b.*\b(?:quota|cuota)\b|\busage limit\b.*\b(?:reach(?:ed)?|exceed(?:ed)?|exhaust(?:ed)?)\b|\bfree usage\b.*\b(?:exhaust(?:ed)?|reach(?:ed)?|exceed(?:ed)?)\b|\bresource[_ ]exhausted\b|\binsufficient[_ ]quota\b|\binsufficient\s+(?:account\s+)?(?:funds|balance|credits?)\b|\b(?:sin|no hay)\s+(?:saldo|cr[eé]ditos)\b)/i;

// Se lanza cuando el modelo se quedó sin cuota. `modelo` es el último que se intentó; `sessionId`, la
// sesión del agente (si llegó a abrirse), para continuarla después con otro modelo.
export class ErrorCuota extends Error {
  constructor(
    readonly modelo: string,
    readonly sessionId: string | null,
  ) {
    super(`Se acabó la cuota del modelo ${modelo}.`);
  }
}

// Solo cuenta lo que dijo el proveedor (ErrorAgente.detalleProveedor), no el mensaje completo.
export function esErrorDeCuota(err: unknown): boolean {
  if (err instanceof ErrorCuota) return true;
  if (err instanceof AislamientoError) return false;
  return PATRON_CUOTA.test(textoDelProveedor(err));
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Valores de secretos del proyecto que el agente pudo imprimir. Se ocultan en su salida, en el
// registro, en el canal en vivo y en el resultado. Se cubren también las versiones escapadas en JSON.
export function valoresAOcultar(propias?: Record<string, string>): string[] {
  const valores = new Set<string>();
  for (const valor of Object.values(propias ?? {})) {
    if (valor.length < 4) continue;
    valores.add(valor);
    const escapado = JSON.stringify(valor).slice(1, -1);
    if (escapado !== valor) valores.add(escapado);
  }
  // Primero los más largos, para que un valor no deje a medias a otro que lo contiene.
  return [...valores].sort((a, b) => b.length - a.length);
}

// Oculta los valores de secretos del proyecto y las credenciales con formato conocido.
export function ocultarValores(texto: string, valores: string[]): string {
  return redactar(texto, valores, MINIMO_OCULTAR);
}

// Lo que dijo el proveedor para clasificar un fallo. Con ErrorAgente, solo el evento de error o la cola
// de la salida sin rutas: el mensaje completo trae la ruta del servidor y del proyecto.
function textoDelProveedor(err: unknown): string {
  return err instanceof ErrorAgente ? err.detalleProveedor : mensajeDe(err);
}

// El respaldo solo se permite cuando el evento del proveedor informa un estado HTTP transitorio.
// No se infiere a partir del mensaje: un 401 o una petición inválida no deben generar otra llamada.
export function codigoHttpDelProveedor(err: unknown): number | null {
  if (!(err instanceof ErrorAgente)) return null;
  try {
    const evento = JSON.parse(err.detalleProveedor) as {
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      error?: {
        message?: unknown;
        status?: unknown;
        statusCode?: unknown;
        data?: { status?: unknown; statusCode?: unknown };
      };
    };
    const candidatos = [
      evento.statusCode,
      evento.status,
      evento.error?.data?.statusCode,
      evento.error?.data?.status,
      evento.error?.statusCode,
      evento.error?.status,
    ];
    const codigo = candidatos.find((codigo): codigo is number =>
      typeof codigo === "number" && Number.isInteger(codigo) && codigo >= 100 && codigo <= 599,
    ) ?? null;
    if (codigo !== null) return codigo;

    // OpenCode a veces omite statusCode en su evento APIError para este fallo 5xx genérico.
    const mensaje = typeof evento.message === "string"
      ? evento.message
      : typeof evento.error?.message === "string" ? evento.error.message : "";
    return /^Unexpected server error(?:\. Check server logs for details\.)?$/i.test(mensaje.trim())
      ? 500
      : null;
  } catch {
    return null;
  }
}

export function esErrorTransitorioDelProveedor(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof AislamientoError || signal?.aborted) return false;
  const codigo = codigoHttpDelProveedor(err);
  if (codigo === 429) return !esErrorDeCuota(err);
  return codigo !== null && codigo >= 500 && codigo <= 599;
}

function esErrorModeloNoEncontrado(err: unknown): boolean {
  return err instanceof ErrorAgente && PATRON_MODELO_NO_ENCONTRADO.test(textoDelProveedor(err));
}

// Solo el código HTTP, nunca el texto del error: el detalle llega a la interfaz.
function etiquetaDelError(err: unknown): string {
  const texto = textoDelProveedor(err);
  const codigo = texto.match(/\b(429|5\d\d)\b/);
  if (codigo) return codigo[1];
  if (/server error|internal error|service unavailable/i.test(texto)) return "500";
  if (/rate limit|too many requests/i.test(texto)) return "429";
  return "Error del proveedor";
}

// Obtiene un resumen conciso de los otros chats recientes del proyecto si compartir_contexto está activo.
export function contextoCompartidoProyecto(projectId: string, omitirConversationId?: string | null): string {
  const params: string[] = [projectId];
  let filtroConv = "";
  if (omitirConversationId) {
    filtroConv = "AND c.id != ?";
    params.push(omitirConversationId);
  }
  const filas = db
    .query<{ id: string; title: string; ultimo_mensaje: string | null }, string[]>(
      `SELECT c.id, c.title,
         (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('user', 'assistant') ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS ultimo_mensaje
       FROM conversations c
       WHERE c.project_id = ? ${filtroConv}
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT 3`,
    )
    .all(...params);

  if (filas.length === 0) return "";
  const resumenes = filas
    .filter((f) => f.title || f.ultimo_mensaje)
    .map((f) => {
      const extracto = f.ultimo_mensaje ? f.ultimo_mensaje.slice(0, 150).replace(/\s+/g, " ").trim() : "Sin actividad reciente";
      return `- Chat "${f.title || "Sin título"}": ${extracto}`;
    });
  if (resumenes.length === 0) return "";
  return `Contexto compartido de otros chats del proyecto:\n${resumenes.join("\n")}`;
}

// Instrucciones del proyecto: se anteponen al prompt de sus tareas y chats. No se guardan ni en
// tasks.prompt ni en el mensaje del chat, así que cambiarlas afecta a los siguientes envíos.
export function conInstrucciones(projectId: string | null | undefined, prompt: string, conversationId?: string | null): string {
  if (!projectId) return prompt;
  const fila = db
    .query<{ instrucciones: string | null; compartir_contexto: number }, [string]>("SELECT instrucciones, compartir_contexto FROM projects WHERE id = ?")
    .get(projectId);
  const texto = fila?.instrucciones?.trim();
  const compartido = fila?.compartir_contexto ? contextoCompartidoProyecto(projectId, conversationId) : "";

  if (!texto && !compartido) return prompt;
  const partes: string[] = [];
  if (texto) partes.push(`Instrucciones del proyecto (escritas por el dueño):\n${texto}`);
  if (compartido) partes.push(compartido);
  return `${partes.join("\n\n")}\n---\n${prompt}`;
}

// Estilo de respuesta de los chats: concreto, con rutas y resultados, y sin repetir la pregunta.
// Va delante del prompt en cada envío; la sesión de OpenCode no lo guarda por sí sola.
export const ESTILO_CHAT = [
  "Estilo de respuesta, presentación y razonamiento nativo de Telo (no lo menciones en la respuesta):",
  "- Conversación natural: habla como un agente que responde al usuario, no como un generador de planes. No repitas planes, listas de pasos ni frases de arranque en cada turno; anuncia brevemente una acción solo si ayuda a entender una espera y entrega el resultado cuando termines.",
  "- Si necesitas documentarte sobre librerías o frameworks modernos, usa skills del proyecto (como context7) o inspecciona el código existente.",
  "- Si una tarea requiere investigación profunda o pasos complejos, organízate paso a paso y puedes coordinar o apoyarte en subagentes especializados.",
  "- Jerarquía visual: Da primero la respuesta o el resultado. Usa ## y ### solo si la explicación tiene secciones reales; en respuestas cortas, usa un párrafo claro. No pongas todo en negrita: reserva **negrita** para etiquetas o conceptos puntuales.",
  "- Respuestas directas: Si la pregunta es breve o conceptual, responde en un párrafo conciso, sin forzar listas ni encabezados.",
  "- Cuándo usar listas numeradas vs viñetas:",
  "  * Usa listas numeradas (1., 2., 3.) ÚNICAMENTE cuando exista un orden secuencial estricto, una guía de pasos cronológicos o prioridades ordenadas.",
  "  * Usa viñetas con guiones (-) para listas de elementos independientes, inventario de archivos modificados, características o hallazgos sin orden secuencial.",
  "- Patrón Diagnóstico (Problema -> Causa -> Solución): Al explicar anomalías, errores o bugs técnicos, presenta de forma estructurada:",
  "  * **Problema:** Qué falló o qué comportamiento indeseado ocurre.",
  "  * **Causa:** Por qué ocurrió, citando la condición o línea exacta.",
  "  * **Solución:** Cómo se resuelve o se resolvió de forma verificable.",
  "- Tablas: Usa tablas Markdown para comparar alternativas, parámetros, métricas o estados antes/después; no conviertas párrafos en tablas.",
  "- Diagramas: Cuando arquitectura, secuencias, dependencias o decisiones se entiendan mejor visualmente, usa un bloque ```mermaid válido (flowchart TD/LR, sequenceDiagram, stateDiagram-v2 o mindmap). No inventes nodos ni relaciones, y evita diagramas decorativos o para respuestas simples.",
  "- Gráficos cuantitativos: Si hay datos numéricos concretos que se entienden mejor visualmente, puedes usar un bloque ```chart con JSON {\"type\":\"bar|line|pie|donut|stats\",\"title\":\"…\",\"unit\":\"…\",\"data\":[{\"label\":\"…\",\"value\":12,\"detail\":\"…\"}]}. Usa solo valores presentes o calculables a partir de la conversación; nunca inventes métricas. Barras, líneas y estadísticas admiten valores negativos; pastel y dona requieren valores no negativos. Para datos insuficientes, usa una tabla Markdown.",
  "- Calidad visual por defecto: Si creas una interfaz, documento, gráfico o imagen, adapta el estilo y la paleta al propósito y a lo que pidió el usuario; define una jerarquía clara, alinea el contenido y deja espacio suficiente para leerlo. Evita solapamientos, recortes, texto ilegible y decoración que compita con los datos. Cuando puedas renderizar el resultado, revísalo y corrige los defectos visibles antes de entregarlo.",
  "- Código: Separa cada fragmento en su propio bloque con el lenguaje indicado (```ts, ```sql, ```json, ```bash, ```markdown, etc.) para conservar resaltado y copia. No mezcles explicación dentro del código.",
  "- Archivos: Cuando señales código del proyecto, cita su ruta relativa exacta entre comillas invertidas (por ejemplo `web/src/components/chat-comandos.tsx:42`) y, si ayuda, la línea relevante. No inventes rutas.",
  "- Mantén clean code, tipos estrictos y no dejes stubs ni regresiones.",
].join("\n");

export function conEstilo(prompt: string, estilo?: "chat", esChatDeProyecto = false): string {
  if (estilo !== "chat") return prompt;
  const formatoVisual = esChatDeProyecto
    ? [
        "- Al explicar arquitectura, secuencias o relaciones de este proyecto, prefiere un diagrama Mermaid adecuado (flowchart, sequenceDiagram, stateDiagram-v2 o mindmap) si aclara el tema; en respuestas simples, responde sin diagrama.",
        "- Para comparar opciones o componentes usa una tabla Markdown; para estructura de carpetas usa un bloque ```text con un árbol legible. No inventes archivos ni relaciones.",
      ].join("\n")
    : "";
  return `${ESTILO_CHAT}${formatoVisual ? `\n${formatoVisual}` : ""}\n---\n${prompt}`;
}

// Primera llamada tras retomar una tarea: evita repetir trabajo y conserva el formato solicitado.
export function promptContinuacion(prompt: string, tieneSesion = true): string {
  const contexto = tieneSesion
    ? [
        "Continúa donde te quedaste. La ejecución anterior se detuvo antes de completar la tarea.",
        "Ya tienes el contexto de lo que hiciste: no repitas pasos completados ni empieces de cero.",
      ]
    : [
        "Continúa la petición con el historial y el estado del workspace disponibles. La sesión anterior no se puede reutilizar, así que no asumas que conoces su razonamiento.",
        "Antes de actuar, revisa los cambios y artefactos actuales para distinguir lo completado de lo pendiente. No repitas cambios terminados.",
      ];
  return [
    "Si una acción no llegó a terminar, revísala antes de repetirla. Después termina lo que falta.",
    "Responde con el mismo formato que pide la instrucción de abajo.",
    ...contexto,
    "---",
    prompt,
  ].join("\n");
}

async function ejecutarAgenteReservado(opts: OpcionesAgente): Promise<ResultadoAgente> {
  const mcp = configuracionMcpParaAgente();
  // Claves de proveedor (Ajustes) y secretos del proyecto. Si un nombre se repite, gana el del proyecto.
  const propias: Record<string, string> = {
    ...entornoProveedores(),
    ...(opts.projectId ? entornoDeProyecto(opts.projectId) : {}),
    ...mcp.variables,
  };
  const ocultos = valoresAOcultar(propias);
  const idPerfil = opts.conversationId
    ? db.query<{ id: string }, [string]>(`
        WITH RECURSIVE familia(id,parent_conversation_id) AS (
          SELECT id,parent_conversation_id FROM conversations WHERE id=?
          UNION ALL
          SELECT padre.id,padre.parent_conversation_id FROM conversations padre JOIN familia f ON f.parent_conversation_id=padre.id
        )
        SELECT id FROM familia WHERE parent_conversation_id IS NULL LIMIT 1
      `).get(opts.conversationId)?.id ?? opts.conversationId
    : opts.taskId;
  // El modelo de respaldo puede usar OpenCode aunque el primario sea Codex.
  const perfilOpenCodeDir = aislamientoActivo() && idPerfil
    ? prepararPerfilOpenCode(idPerfil)
    : undefined;

  // Una sesión solo conserva contexto si pertenece exactamente al modelo que se va a ejecutar.
  let sesion = sesionCompatible(opts.sessionId, opts.sessionModel, opts.model) ? opts.sessionId! : null;
  let modeloSesion: string | null = sesion ? opts.sessionModel! : null;
  const alSesion = (id: string | null, modelo: string | null) => {
    sesion = id;
    modeloSesion = id ? modelo : null;
    opts.onSesion?.(id, id ? modelo : null);
  };
  if (opts.sessionId && !sesion) alSesion(null, null);
  const memoria = opts.projectId ? memoriaDelProyecto(opts.projectId).texto : null;
  const comunes = {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    onLinea: opts.onLinea ? (linea: string) => opts.onLinea?.(ocultarValores(linea, ocultos)) : undefined,
    onSubagente: opts.onSubagente ? (linea: string) => opts.onSubagente?.(ocultarValores(linea, ocultos)) : undefined,
    extraEnv: propias,
    servidoresMcp: mcp.servidores,
    opencodeConfigDir: opts.opencodeConfigDir,
    subagentesTracePath: opts.opencodeSubagentesTracePath,
    perfilOpenCodeDir,
    soloLectura: opts.soloLectura,
  };

  const baseParaModelo = (modelo: string, variante?: string) => {
    if (sesion && modeloSesion !== modelo) alSesion(null, null);
    const prompt = sesion
      ? opts.prompt
      : opts.conversationId
        ? promptConHistorial(opts.conversationId, opts.prompt)
        : opts.prompt;
    const visuales = imagenesDelPrompt(opts.conversationId, prompt);
    return {
      ...comunes,
      prompt: conEstilo(
        conContratoEjecucion(
          conMemoria(
            conInstrucciones(opts.projectId, inyectarSkillsEnPrompt(visuales.prompt, opts.projectId).promptFinal, opts.conversationId),
            memoria,
            opts.aprender === true,
          ),
        ),
        opts.estilo,
        opts.estilo === "chat" && Boolean(opts.projectId),
      ),
      model: modelo,
      variant: variante,
      imagenes: visuales.imagenes,
      sessionId: sesion,
      onSesion: (id: string) => alSesion(id, modelo),
      onUso: (uso: Usage) => registrarUsoAgente(modelo, uso, opts),
    };
  };

  // Un error puede traer fragmentos de la salida del agente: también se limpia.
  const limpiarError = (err: unknown): unknown => {
    if (err instanceof Error && !(err instanceof AislamientoError)) {
      err.message = ocultarValores(err.message, ocultos);
    }
    return err;
  };

  // El resultado sale con los secretos ocultos. Si la tarea aprende, el bloque de memoria se guarda
  // (ya limpio de secretos) y no se muestra en el resultado.
  const terminar = (r: RunResult, modelo: string, variante: string | null): ResultadoAgente => {
    const texto = ocultarValores(r.text, ocultos);
    const textoFinal = ocultarValores(r.textoFinal, ocultos);
    if (opts.aprender && opts.projectId) {
      const nueva = extraerMemoria(texto);
      if (nueva) {
        const projectId = opts.projectId;
        // La memoria es auxiliar: no retiene un turno del agente mientras Jev responde.
        void (async () => {
          try {
            const memoriaAnterior = memoriaDelProyecto(projectId).texto;
            const proyecto = db.query<{ name: string }, [string]>("SELECT name FROM projects WHERE id = ?").get(projectId)?.name ?? "Proyecto";
            let puntuacion: number | null = null;
            let evaluadaPorJev = false;
            try {
              puntuacion = await puntuarMemoriaJev({
                proyectoId: projectId,
                tareaId: opts.taskId,
                signal: opts.signal,
                estado: {
                  proyecto,
                  tarea: opts.prompt.slice(0, 10_000),
                  memoriaAnterior,
                  propuesta: nueva,
                },
              });
              evaluadaPorJev = puntuacion !== null;
            } catch {
              evaluadaPorJev = false;
            }

            if (evaluadaPorJev && puntuacion !== null) {
              const guardar = conservarMemoriaSegunJev(puntuacion) === true;
              if (opts.taskId) {
                try {
                  registrarEvento(
                    opts.taskId,
                    "memoria_evaluada",
                    `Jev puntuó la propuesta ${puntuacion.toFixed(2)} de 3. Telo ${guardar ? "la guardó" : "la dejó fuera"} por su relevancia para futuras tareas.`,
                  );
                } catch {
                  // Si la tarea se borró antes de la evaluación, la decisión aún se puede aplicar al proyecto.
                }
              }
              if (guardar) guardarMemoria(projectId, nueva);
            } else {
              // Jev no estuvo disponible o no pudo evaluar: se guarda como propuesta pendiente de revisión por el usuario
              guardarPropuestaMemoria(projectId, nueva, opts.taskId);
              if (opts.taskId) {
                try {
                  registrarEvento(
                    opts.taskId,
                    "memoria_propuesta",
                    "La memoria no pudo ser evaluada por Jev; quedó guardada como propuesta pendiente de revisión por el usuario.",
                  );
                } catch {
                  // Se ignora si la tarea ya no existe
                }
              }
            }
          } catch (err) {
            console.error("Guardar la memoria del proyecto:", mensajeDe(err));
          }
        })();
      }
    }
    return { ...r, text: opts.aprender ? quitarBloqueMemoria(texto) : texto, textoFinal: opts.aprender ? quitarBloqueMemoria(textoFinal) : textoFinal, modelo, variante };
  };

  async function ejecutarConRunner(modelo: string, params: Parameters<typeof runOpenCode>[0]): Promise<RunResult> {
    if (modelo.startsWith("codex/")) {
      return runCodex(params);
    }
    return runOpenCode(params);
  }

  const inicio = Date.now();
  const varianteInicial = opts.variant ?? undefined;
  const sesionUsada = sesion;
  try {
    const r = await ejecutarConRunner(opts.model, baseParaModelo(opts.model, varianteInicial));
    return terminar(r, opts.model, opts.variant ?? null);
  } catch (err) {
    // Si el tiempo se agotó o se canceló, no se reintenta ni se trata como cuota.
    const agotado = opts.timeoutMs !== undefined && opts.timeoutMs !== null && Date.now() - inicio >= opts.timeoutMs;
    if (agotado || opts.signal?.aborted) throw limpiarError(err);
    // Un modelo sin cuota se marca como tal (ver ErrorCuota); cualquier otro error sigue como antes.
    const comoCuota = (e: unknown, modelo: string): unknown =>
      esErrorDeCuota(e) ? new ErrorCuota(modelo, sesion) : limpiarError(e);

    // OpenCode puede perder una sesión guardada (por limpieza local, cambio de perfil o estado
    // desincronizado). El error ocurre antes de procesar el prompt: descarta solo esa sesión y
    // reintenta una vez reconstruyendo el contexto desde los mensajes de esta conversación.
    if (
      sesionUsada !== null &&
      !opts.model.startsWith("codex/") &&
      err instanceof ErrorAgente &&
      /session\s+not\s+found/i.test(err.message)
    ) {
      alSesion(null, null);
      try {
        const r = await ejecutarConRunner(opts.model, baseParaModelo(opts.model, varianteInicial));
        return terminar(r, opts.model, opts.variant ?? null);
      } catch (reintentoSesionErr) {
        err = reintentoSesionErr;
      }
    }

    // Ante fallo transitorio del servidor (HTTP 5xx) o rate limit transitorio (429 por RPM/TPM),
    // intentamos un reintento breve con backoff antes de recurrir al respaldo o detener la tarea.
    const codigoHttp = codigoHttpDelProveedor(err);
    const esErrorServidor = codigoHttp !== null && codigoHttp >= 500 && codigoHttp <= 599;
    const esRateLimitTransitorio = codigoHttp === 429 && !esErrorDeCuota(err);

    if (esErrorServidor || esRateLimitTransitorio) {
      await Bun.sleep(esRateLimitTransitorio ? 2500 : 1200);
      if (!opts.signal?.aborted) {
        try {
          const parametros = baseParaModelo(opts.model, varianteInicial);
          // El primer intento puede haber completado acciones antes del 429/5xx. Si el runner ya
          // abrió una sesión, retómala y pide continuar desde el estado actual en vez de repetir.
          parametros.prompt = promptContinuacion(parametros.prompt, sesion !== null);
          const r = await ejecutarConRunner(opts.model, parametros);
          return terminar(r, opts.model, opts.variant ?? null);
        } catch (reintentoErr) {
          err = reintentoErr;
        }
      }
    }

    const modeloNoEncontrado = esErrorModeloNoEncontrado(err);
    if (!esErrorTransitorioDelProveedor(err, opts.signal) && !modeloNoEncontrado) throw comoCuota(err, opts.model);

    if (modeloNoEncontrado) {
      // El modelo puede haber desaparecido después de cargar el selector. Actualiza el catálogo
      // antes de validar el respaldo para no encadenar dos IDs obsoletos de OpenCode.
      try { await getModels(true); } catch { /* el respaldo aún se valida con la última lista buena */ }
    }

    const respaldo = getPreferences().fallbackModel;
    if (!respaldo || respaldo === opts.model) throw comoCuota(err, opts.model);

    let validacionRespaldo: Awaited<ReturnType<typeof validateSelection>>;
    try {
      validacionRespaldo = await validateSelection(respaldo, null);
    } catch {
      throw limpiarError(new Error(
        `El modelo ${opts.model} falló y el respaldo ${respaldo} no se pudo comprobar en el catálogo actual. Revisa la conexión de OpenCode y el modelo de respaldo en Ajustes.`,
      ));
    }
    if (!validacionRespaldo.ok) {
      throw limpiarError(new Error(
        `El modelo ${opts.model} falló y el respaldo ${respaldo} ya no está disponible en OpenCode. Elige un modelo que aparezca en el selector de Ajustes y vuelve a intentarlo.`,
      ));
    }
    const principalGratis = (await getModels().catch(() => [])).find((modelo) => modelo.id === opts.model)?.free === true;
    if (principalGratis && !validacionRespaldo.info.free) {
      throw limpiarError(new Error(
        `El modelo gratuito ${opts.model} falló y no se usó el respaldo de pago ${respaldo} para evitar cargos. Elige un respaldo marcado como gratis en Ajustes.`,
      ));
    }

    if (opts.taskId) {
      registrarEvento(opts.taskId, "modelo_respaldo", `${etiquetaDelError(err)} en ${opts.model}; usando ${respaldo}`);
    }
    try {
      const varianteRespaldo = opts.variant && validacionRespaldo.info.variants.includes(opts.variant)
        ? opts.variant
        : undefined;
      const parametrosRespaldo = baseParaModelo(respaldo, varianteRespaldo);
      // El primer modelo pudo alcanzar a ejecutar herramientas antes de fallar; el respaldo revisa
      // el workspace y continúa lo pendiente en vez de repetir el prompt como una tarea nueva.
      parametrosRespaldo.prompt = promptContinuacion(parametrosRespaldo.prompt, false);
      const r = await ejecutarConRunner(respaldo, parametrosRespaldo);
      return terminar(r, respaldo, varianteRespaldo ?? null);
    } catch (errRespaldo) {
      if (esErrorDeCuota(errRespaldo)) throw new ErrorCuota(respaldo, sesion);
      throw limpiarError(new Error(
        `Falló el modelo principal ${opts.model} y también el respaldo ${respaldo}: ${mensajeDe(errRespaldo)}`,
      ));
    }
  }
}

export async function ejecutarAgente(opts: OpcionesAgente): Promise<ResultadoAgente> {
  const liberar = await reservarAgente(opts.signal);
  try {
    return await ejecutarAgenteReservado(opts);
  } finally {
    liberar();
  }
}
