import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Node = { id: string; label?: string; source_file?: string; source_location?: string };
type Link = { source: string; target: string; relation?: string; confidence?: string };
type Graph = { nodes?: Node[]; links?: Link[] };

export type ResultadoGraphify = {
  estado: "consultado" | "sin_coincidencias" | "ausente";
  contexto: string;
  detalle: string;
};

const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_CONTEXTO = 6_000;
const OMITIR = new Set((
  "a al algo con como de del desde donde el ella en entre es esta este esto fue ha hacer hay la las le lo los más me mi muy o para pero por que se si sin sobre su sus te todo todos un una y ya the and for from into is it of or on this that with how what when where code project task error issue fix why"
).split(" "));

function tokens(texto: string): string[] {
  return [...new Set(texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/[a-z0-9_.-]+/g)?.filter((token) => token.length >= 3 && !OMITIR.has(token)) ?? [])];
}

// Consulta local, sin llamadas externas: usa el grafo propio que workspace.ts copia al clon
// de la tarea. El resultado es orientativo y siempre pide verificar las rutas en el código.
export function consultarGraphify(cwd: string, solicitud: string): ResultadoGraphify {
  const ruta = join(cwd, "graphify-out", "graph.json");
  try {
    const info = lstatSync(ruta);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_GRAPH_BYTES) {
      return { estado: "ausente", contexto: "", detalle: "No hay un grafo Graphify válido en el espacio de trabajo del proyecto." };
    }
    const grafo = JSON.parse(readFileSync(ruta, "utf8")) as Graph;
    if (!Array.isArray(grafo.nodes) || !Array.isArray(grafo.links)) {
      return { estado: "ausente", contexto: "", detalle: "El grafo Graphify del proyecto no tiene el formato esperado." };
    }

    const terminos = tokens(solicitud.slice(0, 8_000));
    const nodos = new Map(grafo.nodes.filter((n) => typeof n.id === "string").map((n) => [n.id, n]));
    const relevancia = new Map<string, number>();
    for (const [id, nodo] of nodos) {
      const texto = `${nodo.label ?? ""} ${nodo.source_file ?? ""}`.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase();
      relevancia.set(id, terminos.reduce((total, termino) => total + (texto.includes(termino) ? 1 : 0), 0));
    }
    const inicios = [...nodos.keys()]
      .filter((id) => (relevancia.get(id) ?? 0) > 0)
      .sort((a, b) => (relevancia.get(b)! - relevancia.get(a)!) || etiqueta(nodos.get(a)!).localeCompare(etiqueta(nodos.get(b)!)))
      .slice(0, 3);
    if (!inicios.length) {
      return { estado: "sin_coincidencias", contexto: "", detalle: "El grafo del proyecto no encontró nodos para esta solicitud." };
    }

    const adyacencia = new Map<string, Link[]>();
    for (const link of grafo.links) {
      if (!nodos.has(link.source) || !nodos.has(link.target)) continue;
      adyacencia.set(link.source, [...(adyacencia.get(link.source) ?? []), link]);
      adyacencia.set(link.target, [...(adyacencia.get(link.target) ?? []), link]);
    }
    const profundidad = new Map(inicios.map((id) => [id, 0]));
    const frontera = [...inicios];
    for (let indice = 0; indice < frontera.length && profundidad.size < 30; indice++) {
      const id = frontera[indice]!;
      const nivel = profundidad.get(id)!;
      if (nivel >= 2) continue;
      for (const link of adyacencia.get(id) ?? []) {
        const vecino = link.source === id ? link.target : link.source;
        if (profundidad.has(vecino)) continue;
        profundidad.set(vecino, nivel + 1);
        frontera.push(vecino);
        if (profundidad.size >= 30) break;
      }
    }

    const ordenados = [...profundidad.keys()].sort((a, b) =>
      (profundidad.get(a)! - profundidad.get(b)!) || (relevancia.get(b)! - relevancia.get(a)!) || etiqueta(nodos.get(a)!).localeCompare(etiqueta(nodos.get(b)!)),
    );
    const visibles = new Set(ordenados);
    const lineas = [
      "[CONTEXTO GRAPHIFY DEL PROYECTO — consulta local del grafo de este proyecto]",
      "Usa estas conexiones como mapa para encontrar código relevante. Verifica cada conclusión leyendo sus archivos; el grafo puede estar desactualizado.",
      ...ordenados.map((id) => {
        const n = nodos.get(id)!;
        const fuente = n.source_file ? ` · ${n.source_file}${n.source_location ? `:${n.source_location.replace(/^L/, "")}` : ""}` : "";
        return `NODO ${etiqueta(n)}${fuente}`;
      }),
      ...grafo.links.filter((link) => visibles.has(link.source) && visibles.has(link.target)).slice(0, 45).map((link) =>
        `RELACIÓN ${etiqueta(nodos.get(link.source)!)} —${link.relation ?? "conecta"}→ ${etiqueta(nodos.get(link.target)!)}${link.confidence ? ` [${link.confidence}]` : ""}`,
      ),
      "[FIN DEL CONTEXTO GRAPHIFY]",
    ];
    const contexto = lineas.join("\n").slice(0, MAX_CONTEXTO);
    const focos = inicios.map((id) => etiqueta(nodos.get(id)!)).join(", ");
    return {
      estado: "consultado",
      contexto,
      detalle: `Graphify consultó el grafo de este proyecto: ${profundidad.size} nodos relacionados. Puntos de entrada: ${focos}.`,
    };
  } catch {
    return { estado: "ausente", contexto: "", detalle: "No se pudo leer el grafo Graphify de este proyecto; la tarea continuará sin ese contexto." };
  }
}

function etiqueta(nodo: Node): string {
  return nodo.label?.trim() || nodo.id;
}

