import { useMemo, useState } from "react";

type Nodo = { id: string; label?: string; community?: number; source_file?: string; source_location?: string };
type Enlace = { source: string; target: string; relation?: string };
export type GrafoGraphify = { nodes: Nodo[]; links: Enlace[] };

export function leerGrafoGraphify(texto: string): GrafoGraphify {
  const dato: unknown = JSON.parse(texto);
  if (!dato || typeof dato !== "object") throw new Error("El archivo no contiene un grafo válido.");
  const grafo = dato as { nodes?: unknown; links?: unknown };
  if (!Array.isArray(grafo.nodes) || !Array.isArray(grafo.links) || grafo.nodes.length > 5000 || grafo.links.length > 30000) throw new Error("El grafo debe tener hasta 5000 nodos y 30000 enlaces.");
  const nodes: Nodo[] = grafo.nodes.flatMap((valor) => {
    if (!valor || typeof valor !== "object") return [];
    const n = valor as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id) return [];
    return [{ id: n.id, label: typeof n.label === "string" ? n.label : undefined, community: typeof n.community === "number" && Number.isFinite(n.community) ? n.community : undefined, source_file: typeof n.source_file === "string" ? n.source_file : undefined, source_location: typeof n.source_location === "string" ? n.source_location : undefined }];
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links = grafo.links.filter((e): e is Enlace => e && typeof e === "object" && typeof e.source === "string" && typeof e.target === "string" && ids.has(e.source) && ids.has(e.target));
  if (!nodes.length) throw new Error("El grafo no contiene nodos válidos.");
  return { nodes, links };
}

export function GrafoGraphifyVista({ grafo }: { grafo: GrafoGraphify }) {
  const [busca, setBusca] = useState("");
  const [activo, setActivo] = useState<string | null>(null);
  const puntos = useMemo(() => {
    const grupos = [...new Set(grafo.nodes.map((n) => n.community ?? -1))];
    const indices = new Map<number, number>();
    return grafo.nodes.map((n) => {
      const grupo = n.community ?? -1, i = indices.get(grupo) ?? 0;
      indices.set(grupo, i + 1);
      const angulo = 2 * Math.PI * grupos.indexOf(grupo) / Math.max(1, grupos.length);
      const centroX = 500 + Math.cos(angulo) * 260, centroY = 330 + Math.sin(angulo) * 220;
      const giro = i * 2.399963, radio = Math.sqrt(i) * 5;
      return { ...n, x: centroX + Math.cos(giro) * radio, y: centroY + Math.sin(giro) * radio };
    });
  }, [grafo]);
  const posiciones = useMemo(() => new Map(puntos.map((n) => [n.id, n])), [puntos]);
  const seleccionado = posiciones.get(activo ?? "");
  const termino = busca.trim().toLocaleLowerCase();
  const resultados = termino ? puntos.filter((n) => `${n.label ?? n.id} ${n.source_file ?? ""}`.toLocaleLowerCase().includes(termino)).slice(0, 30) : [];
  return <section className="graphify-vista" aria-label="Grafo importado de Graphify">
    <div className="graphify-lienzo"><svg viewBox="0 0 1000 660" role="img" aria-label="Nodos y relaciones del grafo importado">
      {grafo.links.map((e, i) => { const a = posiciones.get(e.source), b = posiciones.get(e.target); return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="graphify-linea" /> : null; })}
      {puntos.map((n) => <circle key={n.id} cx={n.x} cy={n.y} r={activo === n.id ? 5 : 2.5} fill={`hsl(${((n.community ?? 0) * 137.508) % 360} 60% 60%)`} onClick={() => setActivo(n.id)}><title>{n.label ?? n.id}</title></circle>)}
    </svg></div>
    <aside className="graphify-panel"><label>Buscar nodos<input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nombre o archivo" /></label>
      {seleccionado ? <div><strong>{seleccionado.label ?? seleccionado.id}</strong><p>{seleccionado.source_file} {seleccionado.source_location}</p></div> : <p>Selecciona un nodo para ver su origen.</p>}
      {resultados.map((n) => <button key={n.id} type="button" onClick={() => setActivo(n.id)}>{n.label ?? n.id}</button>)}
      <small>{grafo.nodes.length} nodos · {grafo.links.length} enlaces · importado en esta sesión</small>
    </aside>
  </section>;
}
