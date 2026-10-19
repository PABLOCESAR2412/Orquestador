import { db } from "./db";
import { publicar } from "./bus";

// Pasos del agente en un chat: el texto que dice mientras trabaja y cada acción (leer, buscar,
// editar, ejecutar) con una vista previa. OpenCode los emite como líneas JSON con `--format json`.
// Se guardan por turno para verlos después, y se publican al canal en vivo mientras el agente corre.

export type EstadoAccion = "hecha" | "error" | "en_curso";

export type ItemActividad =
  | { tipo: "texto"; texto: string }
  | { tipo: "accion"; herramienta: string; titulo: string; detalle: string | null; estado: EstadoAccion; callId?: string | null };

// Tope por turno: un agente que se desboca no debe llenar la base.
const MAX_ITEMS_TURNO = 300;
const MAX_TITULO = 160;
const MAX_DETALLE = 2000;
// Un texto intermedio puede ser casi una respuesta entera: el tope sigue al del mensaje del chat.
const MAX_TEXTO = 8000;
const MAX_LINEAS_VISTA = 30;

type Registro = Record<string, unknown>;

const esRegistro = (v: unknown): v is Registro => typeof v === "object" && v !== null && !Array.isArray(v);
const cadena = (v: unknown): string | null => (typeof v === "string" ? v : null);

function recortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

// Las primeras líneas de la salida: lo que se ve sin abrir nada.
export function vistaDe(salida: string, lineas = MAX_LINEAS_VISTA): string {
  const partes = salida.replace(/\s+$/, "").split("\n");
  const corte = partes.slice(0, lineas).join("\n");
  const resto = partes.length > lineas ? `\n… (${partes.length - lineas} líneas más)` : "";
  return recortar(corte + resto, MAX_DETALLE);
}

// La ruta cabe en el título: se queda con el final, que es lo que distingue el archivo.
function rutaCorta(ruta: string): string {
  return ruta.length > 80 ? `…${ruta.slice(-79)}` : ruta;
}

function diffDe(antes: string, despues: string): string {
  const quitar = antes.split("\n").map((l) => `- ${l}`);
  const poner = despues.split("\n").map((l) => `+ ${l}`);
  return recortar([...quitar, ...poner].join("\n"), MAX_DETALLE);
}

// Título legible y vista previa según la herramienta. Las herramientas desconocidas se describen
// con su nombre y su entrada, sin inventar significado. Si falló, el motivo va primero en la vista.
export function describirAccion(
  herramienta: string,
  entrada: Registro,
  salida: string | null,
  error: string | null,
): { titulo: string; detalle: string | null } {
  const base = describirSinError(herramienta, entrada, salida ?? error);
  if (!error) return base;
  const motivo = vistaDe(error);
  const cuerpo = base.detalle && base.detalle !== motivo ? `${motivo}\n\n${base.detalle}` : motivo;
  return { titulo: base.titulo, detalle: recortar(cuerpo, MAX_DETALLE) };
}

function describirSinError(
  herramienta: string,
  entrada: Registro,
  resultado: string | null,
): { titulo: string; detalle: string | null } {
  const ruta = cadena(entrada.filePath) ?? cadena(entrada.path) ?? "";
  const vista = resultado?.trim() ? vistaDe(resultado) : null;

  if (/^(github|gh)(?:[._-]|$)/i.test(herramienta)) {
    const entradaTxt = Object.keys(entrada).length ? recortar(JSON.stringify(entrada), MAX_DETALLE) : null;
    return { titulo: "Usó la integración de GitHub", detalle: vista ?? entradaTxt };
  }

  switch (herramienta) {
    case "read":
      return { titulo: `Leyó ${rutaCorta(ruta) || "un archivo"}`, detalle: vista };
    case "list":
      return { titulo: `Listó ${rutaCorta(ruta) || "la carpeta"}`, detalle: vista };
    case "glob":
      return { titulo: `Buscó archivos «${cadena(entrada.pattern) ?? ""}»`, detalle: vista };
    case "grep": {
      const donde = ruta ? ` en ${rutaCorta(ruta)}` : "";
      return { titulo: `Buscó «${cadena(entrada.pattern) ?? ""}»${donde}`, detalle: vista };
    }
    case "bash": {
      const comando = cadena(entrada.command) ?? "";
      const descripcion = cadena(entrada.description)?.trim();
      const partes = [comando ? `$ ${comando}` : null, vista].filter((p): p is string => !!p);
      return {
        titulo: `Ejecutó ${recortar(descripcion || comando || "un comando", 120)}`,
        detalle: partes.length ? recortar(partes.join("\n"), MAX_DETALLE) : null,
      };
    }
    case "edit": {
      const antes = cadena(entrada.oldString);
      const despues = cadena(entrada.newString);
      const detalle = antes !== null && despues !== null ? diffDe(antes, despues) : vista;
      return { titulo: `Editó ${rutaCorta(ruta) || "un archivo"}`, detalle };
    }
    case "write": {
      const contenido = cadena(entrada.content);
      return {
        titulo: `Escribió ${rutaCorta(ruta) || "un archivo"}`,
        detalle: contenido !== null ? vistaDe(contenido) : vista,
      };
    }
    case "patch":
      return { titulo: "Aplicó un parche", detalle: vista };
    case "websearch":
    case "web_search":
    case "search_web": {
      const consulta = cadena(entrada.query) ?? cadena(entrada.q) ?? cadena(entrada.search_term);
      const entradaTxt = Object.keys(entrada).length ? recortar(JSON.stringify(entrada), MAX_DETALLE) : null;
      return {
        titulo: `Buscó en la web${consulta ? ` «${recortar(consulta, 100)}»` : ""}`,
        detalle: vista ?? entradaTxt,
      };
    }
    case "webfetch":
    case "fetch_url": {
      const url = cadena(entrada.url) ?? "";
      return { titulo: `Consultó ${recortar(url || "una página", 120)}`, detalle: vista };
    }
    case "agent":
    case "subagent":
    case "invoke_subagent":
    case "delegate":
    case "task":
    case "spawn": {
      const rol = cadena(entrada.role) ?? cadena(entrada.agent) ?? cadena(entrada.type) ?? cadena(entrada.name);
      const tarea = cadena(entrada.prompt) ?? cadena(entrada.description) ?? cadena(entrada.task) ?? "";
      const partes = [
        tarea ? `Tarea asignada:\n${tarea}` : null,
        vista ? `Resultado:\n${vista}` : null,
      ].filter(Boolean);
      const rolTexto = rol ? ` (${rol})` : "";
      return {
        titulo: `Se activó subagente${rolTexto}: ${recortar(tarea || "ejecutando tarea", 100)}`,
        detalle: partes.length ? recortar(partes.join("\n\n"), MAX_DETALLE) : null,
      };
    }
    case "skill":
    case "skills":
    case "use_skill":
    case "apply_skill":
    case "load_skill": {
      const nombre = cadena(entrada.skill) ?? cadena(entrada.name) ?? cadena(entrada.skill_name) ?? "";
      const args = Object.entries(entrada)
        .filter(([k]) => !["skill", "name", "skill_name"].includes(k))
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      const partes = [
        args ? `Parámetros: ${args}` : null,
        vista ? `Resultado:\n${vista}` : null,
      ].filter(Boolean);
      return {
        titulo: `Aplicando skill ${nombre || "especializada"}`,
        detalle: partes.length ? recortar(partes.join("\n\n"), MAX_DETALLE) : null,
      };
    }
    default: {
      if (herramienta.startsWith("skill_") || herramienta.startsWith("skill-")) {
        const nombre = herramienta.replace(/^skill[-_]/, "");
        return {
          titulo: `Aplicando skill ${nombre}`,
          detalle: vista ?? (Object.keys(entrada).length ? recortar(JSON.stringify(entrada), MAX_DETALLE) : null),
        };
      }
      if (herramienta.startsWith("subagent_") || herramienta.startsWith("agent_")) {
        const rol = herramienta.slice(herramienta.indexOf("_") + 1);
        const tarea = cadena(entrada.prompt) ?? cadena(entrada.description) ?? "";
        return {
          titulo: `Se activó subagente (${rol}): ${recortar(tarea || "ejecutando tarea", 100)}`,
          detalle: vista ?? (tarea ? `Tarea asignada:\n${tarea}` : null),
        };
      }
      const entradaTxt = Object.keys(entrada).length ? recortar(JSON.stringify(entrada), MAX_DETALLE) : null;
      return { titulo: `Usó ${herramienta}`, detalle: vista ?? entradaTxt };
    }
  }
}

// Convierte una línea de salida de OpenCode en un paso del proceso, o null si no aporta nada que mostrar.
// Solo cuenta lo terminado: una herramienta en curso no tiene resultado que enseñar todavía.
export function itemDeLinea(linea: string): ItemActividad | null {
  if (!linea.includes('"type"')) return null;
  let evento: unknown;
  try {
    evento = JSON.parse(linea);
  } catch {
    return null;
  }
  if (!esRegistro(evento)) return null;
  // Codex CLI usa Responses de tipo item.started/item.completed en lugar del formato de OpenCode.
  // Traducimos solo acciones observables; los eventos de razonamiento nunca se muestran.
  if ((evento.type === "item.started" || evento.type === "item.completed") && esRegistro(evento.item)) {
    const item = evento.item;
    const id = cadena(item.id);
    const tipo = cadena(item.type);
    const completado = evento.type === "item.completed";
    const estadoItem = cadena(item.status);
    const estado: EstadoAccion = completado
      ? estadoItem === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0) ? "error" : "hecha"
      : "en_curso";

    if (tipo === "command_execution") {
      const comando = cadena(item.command) ?? "";
      const salida = completado ? cadena(item.aggregated_output) : null;
      const codigo = typeof item.exit_code === "number" ? item.exit_code : null;
      const error = estado === "error" ? salida ?? `El comando terminó con código ${codigo ?? "de error"}` : null;
      const accion = describirAccion("bash", { command: comando }, salida, error);
      return {
        tipo: "accion",
        herramienta: "bash",
        titulo: recortar(accion.titulo, MAX_TITULO),
        detalle: accion.detalle,
        estado,
        ...(id ? { callId: id } : {}),
      };
    }

    if (tipo === "file_change") {
      const cambios = Array.isArray(item.changes) ? item.changes.filter(esRegistro) : [];
      const rutas = cambios
        .map((cambio) => cadena(cambio.path) ?? cadena(cambio.file_path))
        .filter((ruta): ruta is string => ruta !== null);
      const detalle = cambios
        .map((cambio, indice) => {
          const clase = cadena(cambio.kind);
          return `${clase ? `${clase}: ` : ""}${rutas[indice] ?? "archivo"}`;
        });
      const titulo = rutas.length === 1
        ? `Modificó ${rutaCorta(rutas[0])}`
        : `Modificó ${rutas.length || "varios"} archivos`;
      return {
        tipo: "accion",
        herramienta: "edit",
        titulo: recortar(titulo, MAX_TITULO),
        detalle: detalle.length ? vistaDe(detalle.join("\n")) : null,
        estado,
        ...(id ? { callId: id } : {}),
      };
    }

    if (tipo === "web_search" || tipo === "web_search_call") {
      const consulta = cadena(item.query);
      return {
        tipo: "accion",
        herramienta: "websearch",
        titulo: `Buscó en la web${consulta ? ` «${recortar(consulta, 100)}»` : ""}`,
        detalle: null,
        estado,
        ...(id ? { callId: id } : {}),
      };
    }

    if (tipo === "mcp_tool_call") {
      const servidor = cadena(item.server);
      const herramienta = cadena(item.tool);
      return {
        tipo: "accion",
        herramienta: "mcp",
        titulo: `Usó ${[servidor, herramienta].filter(Boolean).join(" · ") || "una integración"}`,
        detalle: null,
        estado,
        ...(id ? { callId: id } : {}),
      };
    }
    return null;
  }
  // OpenCode anuncia esta transición como evento de sesión; se guarda en el mismo registro de pasos.
  if (evento.type === "session.compacted") {
    return { tipo: "accion", herramienta: "compaction", titulo: "Contexto compactado automáticamente", detalle: null, estado: "hecha" };
  }
  if (!esRegistro(evento.part)) return null;
  const parte = evento.part;

  if (parte.type === "compaction" || parte.mode === "compaction" || parte.summary === true) {
    return { tipo: "accion", herramienta: "compaction", titulo: "Contexto compactado automáticamente", detalle: null, estado: "hecha" };
  }

  if (evento.type === "text" && cadena(parte.text)?.trim()) {
    return { tipo: "texto", texto: recortar(cadena(parte.text)!.trim(), MAX_TEXTO) };
  }

  if (parte.type === "tool") {
    const estado = esRegistro(parte.state) ? parte.state : null;
    const situacion = cadena(estado?.status);
    if (!estado || (situacion !== "running" && situacion !== "completed" && situacion !== "error")) return null;
    const herramienta = (cadena(parte.tool) ?? "herramienta").toLowerCase();
    const entrada = esRegistro(estado.input) ? estado.input : {};
    const salida = situacion === "completed" ? cadena(estado.output) : null;
    const error = situacion === "error" ? (cadena(estado.error) ?? "La herramienta falló") : null;
    const { titulo, detalle } = describirAccion(herramienta, entrada, salida, error);
    return {
      tipo: "accion",
      herramienta,
      titulo: recortar(titulo, MAX_TITULO),
      detalle,
      estado: situacion === "running" ? "en_curso" : situacion === "completed" ? "hecha" : "error",
      ...((cadena(parte.callID) ?? cadena(parte.callId))
        ? { callId: cadena(parte.callID) ?? cadena(parte.callId) }
        : {}),
    };
  }
  return null;
}

export type FilaActividad = {
  seq: number;
  tipo: "texto" | "accion";
  herramienta: string | null;
  titulo: string;
  detalle: string | null;
  estado: "hecha" | "error" | "texto" | "en_curso";
};

// Guarda el paso con el siguiente número del turno y lo publica al canal en vivo.
// Devuelve null si el turno ya llegó a su tope.
export function registrarActividad(conversacionId: string, turnoId: string, item: ItemActividad): number | null {
  const callId = item.tipo === "accion" ? item.callId ?? null : null;
  if (callId) {
    const existente = db.query<{ seq: number }, [string, string, string]>(
      "SELECT seq FROM chat_actividad WHERE conversation_id=? AND turno_id=? AND call_id=?",
    ).get(conversacionId, turnoId, callId);
    if (existente) {
      const { titulo, detalle } = item.tipo === "accion"
        ? { titulo: item.titulo, detalle: item.detalle }
        : { titulo: item.texto, detalle: null };
      const estado = item.tipo === "accion" ? item.estado : "texto";
      db.query("UPDATE chat_actividad SET titulo=?,detalle=?,estado=? WHERE conversation_id=? AND turno_id=? AND seq=?")
        .run(titulo, detalle, estado, conversacionId, turnoId, existente.seq);
      const paso: FilaActividad = {
        seq: existente.seq,
        tipo: item.tipo,
        herramienta: item.tipo === "accion" ? item.herramienta : null,
        titulo,
        detalle,
        estado,
      };
      publicar({ tipo: "actividad", conversacion_id: conversacionId, turno_id: turnoId, paso });
      return existente.seq;
    }
  }

  const { n } = db
    .query<{ n: number }, [string, string]>(
      "SELECT COUNT(*) AS n FROM chat_actividad WHERE conversation_id = ? AND turno_id = ?",
    )
    .get(conversacionId, turnoId)!;
  if (n >= MAX_ITEMS_TURNO) return null;

  // Un texto intermedio guarda su texto completo en `titulo`; una acción, su título y su vista previa en `detalle`.
  const titulo = item.tipo === "accion" ? item.titulo : item.texto;
  const herramienta = item.tipo === "accion" ? item.herramienta : null;
  const detalle = item.tipo === "accion" ? item.detalle : null;
  const estado = item.tipo === "accion" ? item.estado : "texto";
  const { seq } = db
    .query<{ seq: number }, [string, string, string, string, string, string | null, string | null, string, string | null, string]>(
      `INSERT INTO chat_actividad (conversation_id, turno_id, seq, tipo, herramienta, call_id, titulo, detalle, estado)
       VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_actividad WHERE conversation_id = ? AND turno_id = ?), ?, ?, ?, ?, ?, ?)
       RETURNING seq`,
    )
    .get(conversacionId, turnoId, conversacionId, turnoId, item.tipo, herramienta, callId, titulo, detalle, estado) as {
      seq: number;
    };

  const paso: FilaActividad = { seq, tipo: item.tipo, herramienta, titulo, detalle, estado };
  publicar({ tipo: "actividad", conversacion_id: conversacionId, turno_id: turnoId, paso });
  return seq;
}

export function actividadDelTurno(conversacionId: string, turnoId: string): FilaActividad[] {
  return db
    .query<FilaActividad, [string, string]>(
      "SELECT seq, tipo, herramienta, titulo, detalle, estado FROM chat_actividad WHERE conversation_id = ? AND turno_id = ? ORDER BY seq",
    )
    .all(conversacionId, turnoId);
}
