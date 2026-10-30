import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { config } from "./config";
import { getModels } from "./models";

const PETICION_DELEGAR = /\b(?:subagentes?|agentes?\s+(?:en\s+)?paralelo|por\s+medio\s+de\s+(?:sus?\s+)?agentes?|(?:usa|utiliza|crea|lanza|activa|emplea)\s+(?:tus?\s+)?agentes?|agentes?\s+(?:para\s+que|que)\s+(?:revisen|analicen|investiguen|trabajen|verifiquen)|deleg(?:a|ar|ando)|llama\s+a\s+(?:varios|m[aá]s\s+de\s+uno|un\s+subagente))\b/i;
const MAX_MODELOS = 4;

export type PreparacionSubagentes = {
  instruccion: string;
  directorio: string;
  rutaCaptura: string;
  finalizarCaptura: () => void;
  limpiar: () => void;
};

export function eliminarPerfilSubagentes(directorio: string | null | undefined): void {
  if (!directorio) return;
  const raiz = resolve(join(config.dataDir, "perfiles-subagente"));
  const destino = resolve(directorio);
  if (!destino.startsWith(`${raiz}${sep}`)) return;
  rmSync(destino, { recursive: true, force: true });
}

export function pideSubagentes(prompt: string): boolean {
  return PETICION_DELEGAR.test(prompt);
}

function slug(valor: string): string {
  return valor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "modelo";
}

function modelosNombrados(prompt: string, catalogo: Awaited<ReturnType<typeof getModels>>) {
  const texto = prompt.toLocaleLowerCase();
  const candidatos = catalogo
    .filter((modelo) =>
      (modelo.id.length >= 5 && texto.includes(modelo.id.toLocaleLowerCase())) ||
      (modelo.name.trim().length >= 8 && texto.includes(modelo.name.toLocaleLowerCase())),
    )
    .sort((a, b) => Math.max(b.id.length, b.name.length) - Math.max(a.id.length, a.name.length));
  const unicos = new Map<string, (typeof candidatos)[number]>();
  for (const candidato of candidatos) {
    unicos.set(candidato.id, candidato);
    if (unicos.size >= MAX_MODELOS) break;
  }
  return [...unicos.values()];
}

export async function prepararSubagentes(opts: {
  prompt: string;
  modelo: string;
  esfuerzo?: string | null;
  idEjecucion: string;
  listarModelos?: typeof getModels;
  directorioBase?: string;
}): Promise<PreparacionSubagentes | null> {
  if (!pideSubagentes(opts.prompt) || opts.modelo.startsWith("codex/")) return null;

  let catalogo: Awaited<ReturnType<typeof getModels>> = [];
  try {
    catalogo = await (opts.listarModelos ?? getModels)();
  } catch {
    // La delegación sin cambio de modelo aún puede heredar el modelo principal.
  }
  const mismo = catalogo.find((m) => m.id === opts.modelo);
  const seleccionados = modelosNombrados(opts.prompt, catalogo);
  if (seleccionados.length === 0) {
    seleccionados.push(mismo ?? {
      id: opts.modelo,
      name: opts.modelo,
      provider: opts.modelo.split("/")[0] ?? "",
      inputUsd: 0,
      outputUsd: 0,
      context: 0,
      variants: [],
      free: false,
      costTier: "medio",
      costWarning: null,
      group: "",
      recommended: false,
    });
  }

  const directorio = join(opts.directorioBase ?? config.dataDir, "perfiles-subagente", opts.idEjecucion);
  const carpetaAgentes = join(directorio, "agents");
  const carpetaPlugins = join(directorio, "plugins");
  const rutaCaptura = join(directorio, "subagentes.ndjson");
  mkdirSync(carpetaAgentes, { recursive: true });
  mkdirSync(carpetaPlugins, { recursive: true });
  const alias = seleccionados.map((modelo, indice) => {
    const nombre = `telo-${slug(modelo.name)}-${indice + 1}`;
    const variante = opts.esfuerzo && modelo.variants.includes(opts.esfuerzo) ? `#${opts.esfuerzo}` : "";
    const idModelo = JSON.stringify(`${modelo.id}${variante}`);
    const archivo = join(carpetaAgentes, `${nombre}.md`);
    writeFileSync(
      archivo,
      [
        "---",
        `description: Subagente temporal ${slug(modelo.id)} para la tarea solicitada`,
        "mode: subagent",
        `model: ${idModelo}`,
        "---",
        "Trabajas como subagente de Telo. Atiende únicamente la tarea que te asignó el agente principal y conserva las reglas del workspace. Si un comando, prueba o cambio falla, revisa el error, corrige la causa dentro del encargo y repite la comprobación fallida; limita la autocorrección a dos intentos. Si no se resuelve, devuelve el error y lo que intentaste. No inicies otros subagentes.",
        "",
      ].join("\n"),
      { encoding: "utf8", flag: "wx" },
    );
    return { nombre, modelo: modelo.name, id: modelo.id };
  });

  const detalle = alias.map((a) => `- ${a.nombre}: ${a.modelo} (${a.id})`).join("\n");
  // En `opencode run` no hay una persona atendiendo solicitudes interactivas de permiso.
  // Autoriza la herramienta task solo para los perfiles efímeros creados para esta petición;
  // los demás subagentes siguen sujetos a la política global de OpenCode.
  const permisosTask: Record<string, string> = { "*": "deny" };
  for (const agente of alias) permisosTask[agente.nombre] = "allow";
  writeFileSync(
    join(directorio, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      permission: { task: permisosTask },
    }),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const plugin = `import { appendFileSync } from "node:fs";

const salida = ${JSON.stringify(rutaCaptura)};
const hijos = new Set();
const llamadas = new Map();
const pendientes = new Map();
let eventos = 0;
let bytes = 0;
const LIMITE_EVENTOS = 5000;
const LIMITE_BYTES = 8 * 1024 * 1024;
const LIMITE_LINEA = 32 * 1024;
const recortar = (valor, max = 30000) => typeof valor === "string" ? valor.slice(0, max) : "";
const compactar = (valor, profundidad = 0) => {
  if (typeof valor === "string") return recortar(valor, 1200);
  if (valor === null || typeof valor === "number" || typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) return valor.slice(0, 20).map((item) => compactar(item, profundidad + 1));
  if (valor && typeof valor === "object" && profundidad < 3) {
    return Object.fromEntries(Object.entries(valor).slice(0, 20).map(([clave, item]) => [clave, compactar(item, profundidad + 1)]));
  }
  return valor && typeof valor === "object" ? "[contenido omitido]" : undefined;
};
const emitir = (dato) => {
  if (eventos >= LIMITE_EVENTOS) return;
  try {
    const linea = JSON.stringify(dato);
    const tamano = Buffer.byteLength(linea, "utf8") + 1;
    if (tamano > LIMITE_LINEA || bytes + tamano > LIMITE_BYTES) return;
    appendFileSync(salida, linea + "\\n", { encoding: "utf8" });
    eventos += 1;
    bytes += tamano;
  } catch {}
};
const registrarHijo = (id, parentId, info, pendiente) => {
  if (!id || !parentId) return;
  if (!hijos.has(id)) {
    hijos.add(id);
    emitir({
      kind: "created",
      sessionId: id,
      parentSessionId: parentId,
      title: recortar(info?.title || pendiente?.description || "Subagente", 300),
      agent: recortar(pendiente?.agent || info?.agent || "Subagente", 100),
      model: info?.model?.providerID && info?.model?.modelID ? recortar(info.model.providerID + "/" + info.model.modelID, 200) : "",
      prompt: recortar(pendiente?.prompt || info?.title || "Tarea delegada"),
    });
  }
  if (pendiente?.callID) llamadas.set(pendiente.callID, id);
};
const agregarPendiente = (parentId, dato) => {
  if (!parentId) return;
  const lista = pendientes.get(parentId) || [];
  lista.push(dato);
  pendientes.set(parentId, lista);
};
const tomarPendiente = (parentId, titulo) => {
  const lista = pendientes.get(parentId) || [];
  const buscado = String(titulo || "").trim().toLowerCase();
  const indice = buscado ? lista.findIndex((t) => t.description.toLowerCase() === buscado) : -1;
  const [dato] = lista.splice(indice >= 0 ? indice : 0, 1);
  if (lista.length) pendientes.set(parentId, lista); else pendientes.delete(parentId);
  return dato;
};

export const TeloSubagentes = async () => ({
  event: async ({ event }) => {
    const props = event?.properties || {};
    if (event?.type === "message.part.updated") {
      const parte = props.part;
      if (parte?.type === "tool" && String(parte.tool || "").toLowerCase() === "task") {
        const estado = parte.state || {};
        const entrada = estado.input || {};
        const metadata = estado.metadata || {};
        const llamada = {
          description: recortar(entrada.description || estado.title || "Subtarea", 300),
          prompt: recortar(entrada.prompt || entrada.task || entrada.description || estado.title || "Subtarea"),
          agent: recortar(entrada.subagent_type || entrada.agent || entrada.subagent || "Subagente", 100),
          callID: parte.callID,
        };
        const sessionId = metadata.sessionId;
        if (estado.status === "running") {
          if (sessionId) {
            const pendiente = tomarPendiente(parte.sessionID, llamada.description) || llamada;
            registrarHijo(sessionId, parte.sessionID, {}, pendiente);
          } else if (!llamadas.has(parte.callID)) agregarPendiente(parte.sessionID, llamada);
        }
        if (sessionId) llamadas.set(parte.callID, sessionId);
        if (estado.status === "completed" || estado.status === "error") {
          const hijo = sessionId || llamadas.get(parte.callID);
          if (hijo && hijos.has(hijo)) {
            emitir({ kind: "result", sessionId: hijo, status: estado.status === "completed" ? "done" : "failed", result: recortar(estado.output || estado.error, 30000) });
          }
          llamadas.delete(parte.callID);
        }
      }

      if (parte?.sessionID && hijos.has(parte.sessionID) && (parte.type === "tool" || (parte.type === "text" && parte.time?.end))) {
        if (parte.type !== "tool" || ["running", "completed", "error"].includes(parte.state?.status)) {
          const parteCompacta = parte.type === "text"
            ? { type: "text", text: recortar(parte.text, 8000) }
            : {
                type: "tool",
                tool: recortar(parte.tool || "herramienta", 100),
                callID: recortar(parte.callID || "", 128),
                state: {
                  status: parte.state?.status,
                  input: compactar(parte.state?.input),
                  output: recortar(parte.state?.output, 3000),
                  error: recortar(parte.state?.error, 3000),
                },
              };
          const evento = { type: parte.type, sessionID: parte.sessionID, part: parteCompacta };
          emitir({ kind: "activity", sessionId: parte.sessionID, line: JSON.stringify(evento) });
        }
      }
    }

    if (event?.type === "session.created" || event?.type === "session.updated") {
      const info = props.info || {};
      const id = info.id || props.sessionID;
      if (id && info.parentID) {
        const pendiente = hijos.has(id) ? null : tomarPendiente(info.parentID, info.title);
        registrarHijo(id, info.parentID, info, pendiente);
      }
    }

    const id = props.sessionID;
    if (id && hijos.has(id) && event?.type === "session.idle") emitir({ kind: "status", sessionId: id, status: "done" });
    if (id && hijos.has(id) && event?.type === "session.status" && props.status?.type === "idle") emitir({ kind: "status", sessionId: id, status: "done" });
    if (id && hijos.has(id) && event?.type === "session.error") emitError(id, props.error);
  },
});

function emitError(sessionId, error) {
  const detalle = error?.data?.message || error?.message || "El subagente informó un error.";
  emitir({ kind: "result", sessionId, status: "failed", result: recortar(detalle, 30000) });
}
`;
  const pluginPath = join(carpetaPlugins, "telo-subagentes.js");
  writeFileSync(pluginPath, plugin, { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(rutaCaptura, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    directorio,
    rutaCaptura,
    instruccion: [
      "El usuario pidió expresamente delegar esta tarea en subagentes.",
      "Explica qué encargo asignas a cada perfil y lanza trabajos independientes en paralelo cuando sea posible. Usa cada perfil una vez inicialmente; si una sesión informa un error sin resolver, continúa esa misma sesión con una instrucción de corrección concreta una sola vez. No crees un reemplazo ni repitas un trabajo ya completado. Si la corrección no resuelve el error, toma el control si está dentro del alcance o informa el bloqueo con evidencia.",
      "Perfiles temporales disponibles:",
      detalle,
      "Al terminar, integra las respuestas y verifica cada afirmación y cambio de los subagentes contra el workspace o fuentes fiables. Informa qué comprobaste, qué pruebas ejecutaste y qué no pudiste verificar; no afirmes que algo pasó sin evidencia.",
    ].join("\n"),
    finalizarCaptura: () => {
      rmSync(pluginPath, { force: true });
      rmSync(rutaCaptura, { force: true });
    },
    limpiar: () => rmSync(directorio, { recursive: true, force: true }),
  };
}
