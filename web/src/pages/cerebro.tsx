import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useShell } from "../components/shell-context";
import { api, type BrainNote, type BrainNoteSummary } from "../api";
import { errorText } from "../lib/model";
import "../styles-cerebro.css";
import { GrafoGraphifyVista, leerGrafoGraphify, type GrafoGraphify } from "../components/grafo-graphify";

function descargar(nombre: string, texto: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/markdown;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").slice(0, 120) || "nota.md";
  enlace.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function tituloMarkdown(nombre: string, contenido: string) {
  const frontmatter = contenido.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  const tituloYml = frontmatter?.[1]?.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  const h1 = contenido.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (tituloYml || h1 || nombre.replace(/\.md$/i, "").replace(/[_-]+/g, " ")).slice(0, 120) || "Nota importada";
}

function Grafo({
  nodos,
  enlaces,
  seleccionado,
  onSeleccionar,
}: {
  nodos: { id: string; title: string }[];
  enlaces: { source: string; target: string }[];
  seleccionado: string | null;
  onSeleccionar: (id: string) => void;
}) {
  const puntos = useMemo(() => {
    const centroX = 170, centroY = 148, radio = Math.min(116, Math.max(42, nodos.length * 12));
    return nodos.map((nodo, index) => {
      const angulo = nodos.length === 1 ? -Math.PI / 2 : (2 * Math.PI * index) / nodos.length - Math.PI / 2;
      return { ...nodo, x: centroX + Math.cos(angulo) * radio, y: centroY + Math.sin(angulo) * radio };
    });
  }, [nodos]);
  const posiciones = new Map(puntos.map((punto) => [punto.id, punto]));
  return (
    <svg className="cerebro-mapa" viewBox="0 0 340 300" role="img" aria-label="Mapa de enlaces entre notas">
      {enlaces.map((enlace, indice) => {
        const a = posiciones.get(enlace.source), b = posiciones.get(enlace.target);
        return a && b ? <line key={`${enlace.source}-${enlace.target}-${indice}`} className="cerebro-enlace" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null;
      })}
      {puntos.map((punto) => (
        <g
          key={punto.id}
          className={`cerebro-nodo${seleccionado === punto.id ? " is-seleccionado" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={`Abrir nota ${punto.title}`}
          onClick={() => onSeleccionar(punto.id)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSeleccionar(punto.id); } }}
        >
          <circle cx={punto.x} cy={punto.y} r="8" />
          <title>{punto.title}</title>
          {nodos.length <= 12 && <text x={punto.x} y={punto.y + 22} textAnchor="middle">{punto.title.slice(0, 10)}</text>}
        </g>
      ))}
      {nodos.length === 0 && <text className="cerebro-mapa-vacio" x="170" y="150" textAnchor="middle">Las notas enlazadas aparecerán aquí</text>}
    </svg>
  );
}

export function BrainPage() {
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const [vistaGrafo, setVistaGrafo] = useState<"notas" | "chats">("chats");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");
  const [grafoImportado, setGrafoImportado] = useState<GrafoGraphify | null>(null);
  const [errorGrafo, setErrorGrafo] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.listConversations });
  const notes = useQuery({ queryKey: ["brain-notes", projectId, query], queryFn: () => api.listBrainNotes(projectId, query) });
  const graph = useQuery({ queryKey: ["brain-graph", projectId], queryFn: () => api.brainGraph(projectId) });
  const selected = useQuery({
    queryKey: ["brain-note", selectedId],
    queryFn: () => api.getBrainNote(selectedId!),
    enabled: selectedId !== null,
  });
  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["brain-notes"] });
    void queryClient.invalidateQueries({ queryKey: ["brain-graph"] });
  };
  const crear = useMutation({
    mutationFn: () => api.createBrainNote({ project_id: projectId, title: "Nota nueva", content: "# Nota nueva\n\n" }),
    onSuccess: (nota) => { setSelectedId(nota.id); setDraftId(nota.id); setTitle(nota.title); setContent(nota.content); setNotice("Nota creada."); invalidar(); },
  });
  const guardar = useMutation({
    mutationFn: () => api.updateBrainNote(selectedId!, { title, content }),
    onSuccess: (nota) => { setTitle(nota.title); setContent(nota.content); setNotice("Cambios guardados."); invalidar(); void queryClient.invalidateQueries({ queryKey: ["brain-note", selectedId] }); },
  });
  const borrar = useMutation({
    mutationFn: () => api.deleteBrainNote(selectedId!),
    onSuccess: () => {
      setSelectedId(notes.data?.notas.find((nota) => nota.id !== selectedId)?.id ?? null);
      setDraftId(null); setTitle(""); setContent(""); setNotice("Nota eliminada."); invalidar();
    },
  });
  const notaActual: BrainNote | undefined = selected.data;
  const mapaChats = useMemo(() => {
    const principales = (conversations.data ?? []).filter((chat) => !chat.parent_conversation_id && (!projectId || chat.project_id === projectId));
    const limitados = principales.slice(0, 24);
    const grupos = [...new Set(limitados.map((chat) => chat.project_id).filter((id): id is string => Boolean(id)))];
    const nodos = [{ id: "raiz", title: projectId ? projects.data?.find((p) => p.id === projectId)?.name ?? "Proyecto" : "General" },
      ...(!projectId ? grupos.map((id) => ({ id: `proyecto:${id}`, title: projects.data?.find((p) => p.id === id)?.name ?? "Proyecto" })) : []),
      ...limitados.map((chat) => ({ id: `chat:${chat.id}`, title: chat.title }))];
    const enlaces = [...(!projectId ? grupos.map((id) => ({ source: "raiz", target: `proyecto:${id}` })) : []),
      ...limitados.map((chat) => ({ source: !projectId && chat.project_id ? `proyecto:${chat.project_id}` : "raiz", target: `chat:${chat.id}` }))];
    return { nodos, enlaces, limitado: principales.length > limitados.length };
  }, [conversations.data, projects.data, projectId]);
  const modificado = Boolean(notaActual && draftId === selectedId && (title !== notaActual.title || content !== notaActual.content));
  const elegirId = (id: string) => {
    if (id === selectedId) return;
    if (modificado && !window.confirm("Hay cambios sin guardar. ¿Descartarlos y abrir otra nota?")) return;
    setDraftId(null);
    setTitle("");
    setContent("");
    setSelectedId(id);
    setNotice("");
  };
  const elegirNota = (nota: BrainNoteSummary) => elegirId(nota.id);

  useEffect(() => {
    if (!selectedId && notes.data?.notas[0]) setSelectedId(notes.data.notas[0].id);
  }, [notes.data, selectedId]);
  useEffect(() => {
    if (notaActual && !modificado) { setTitle(notaActual.title); setContent(notaActual.content); }
    if (notaActual && draftId !== selectedId && !modificado) setDraftId(selectedId);
  }, [notaActual?.id, notaActual?.updated_at, draftId, selectedId, modificado]);

  const importarArchivos = async (archivos: FileList | null) => {
    if (!archivos?.length) return;
    let importadas = 0;
    for (const archivo of Array.from(archivos)) {
      if (!archivo.name.toLowerCase().endsWith(".md") || archivo.size > 48 * 1024) continue;
      const markdown = await archivo.text();
      try {
        const nota = await api.createBrainNote({ project_id: projectId, title: tituloMarkdown(archivo.name, markdown), content: markdown });
        setSelectedId(nota.id);
        setDraftId(nota.id);
        setTitle(nota.title);
        setContent(nota.content);
        importadas++;
      } catch (error) {
        setNotice(`Importé ${importadas} nota(s). ${errorText(error)}`);
        invalidar();
        if (importRef.current) importRef.current.value = "";
        return;
      }
    }
    setNotice(importadas ? `${importadas} nota(s) Markdown importada(s).` : "No encontré archivos .md válidos de hasta 48 KB.");
    invalidar();
    if (importRef.current) importRef.current.value = "";
  };

  return (
    <main className="cerebro-page">
      <header className="cerebro-header">
        <div>
          <h1>Cerebro</h1>
          <p>Notas Markdown propias de Telo. La búsqueda y el mapa se calculan aquí, sin llamar a modelos.</p>
        </div>
        <div className="cerebro-acciones">
          <label className="btn-ghost graphify-importar">Importar grafo de Graphify
            <input type="file" accept=".json,application/json" hidden onChange={async (event) => {
              const archivo = event.target.files?.[0];
              if (!archivo) return;
              try {
                if (archivo.size > 8 * 1024 * 1024) throw new Error("El archivo supera el límite de 8 MB.");
                setGrafoImportado(leerGrafoGraphify(await archivo.text()));
                setErrorGrafo("");
              } catch (error) { setErrorGrafo(error instanceof Error ? error.message : "No se pudo leer el grafo."); }
              event.target.value = "";
            }} />
          </label>
          <input ref={importRef} type="file" accept=".md,text/markdown,text/plain" multiple hidden onChange={(event) => {
            if (modificado && !window.confirm("Hay cambios sin guardar. ¿Descartarlos antes de importar?")) { event.target.value = ""; return; }
            void importarArchivos(event.target.files);
          }} />
          <button className="btn-ghost" type="button" onClick={() => importRef.current?.click()}>Importar .md</button>
          <button className="btn-primary" type="button" disabled={crear.isPending} onClick={() => crear.mutate()}>{crear.isPending ? "Creando…" : "+ Nota"}</button>
        </div>
      </header>
      {errorGrafo && <p className="cerebro-error" role="alert">{errorGrafo}</p>}
      {grafoImportado && <><div className="cerebro-grafo-head"><strong>Grafo de Graphify</strong><button className="btn-ghost" type="button" onClick={() => setGrafoImportado(null)}>Cerrar grafo</button></div><GrafoGraphifyVista grafo={grafoImportado} /></>}
      <div className="cerebro-layout">
        <aside className="cerebro-lista" aria-label="Notas">
          <label className="cerebro-label" htmlFor="cerebro-ambito">Baúl</label>
          <select id="cerebro-ambito" className="cerebro-ambito" value={projectId ?? ""} onChange={(event) => {
            if (modificado && !window.confirm("Hay cambios sin guardar. ¿Descartarlos y cambiar de baúl?")) return;
            setProjectId(event.target.value || null); setSelectedId(null); setDraftId(null); setTitle(""); setContent(""); setNotice("");
          }}>
            <option value="">General</option>
            {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <label className="cerebro-label" htmlFor="cerebro-buscar">Buscar en este baúl</label>
          <input id="cerebro-buscar" className="cerebro-buscar" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Título o contenido" />
          <div className="cerebro-lista-cabecera"><span>{notes.data?.notas.length ?? 0} notas</span><span>Búsqueda local</span></div>
          {notes.isError && <p className="cerebro-error" role="alert">{errorText(notes.error)}</p>}
          <div className="cerebro-notas-lista">
            {(notes.data?.notas ?? []).map((nota) => (
              <button key={nota.id} type="button" className={`cerebro-nota-item${selectedId === nota.id ? " is-activa" : ""}`} onClick={() => elegirNota(nota)}>
                <strong>{nota.title}</strong>
                <span>{nota.resumen || "Sin resumen todavía"}</span>
              </button>
            ))}
            {!notes.isPending && notes.data?.notas.length === 0 && <p className="cerebro-vacio">Este baúl está vacío. Crea una nota o importa Markdown.</p>}
          </div>
        </aside>

        <section className="cerebro-editor" aria-label="Editor Markdown">
          {notaActual ? (
            <>
              <div className="cerebro-editor-head">
                <input aria-label="Título de la nota" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
                <div className="cerebro-editor-acciones">
                  <button type="button" className="btn-ghost" disabled={!notaActual || modificado} onClick={() => descargar(`${title.trim() || "nota"}.md`, content)}>Exportar .md</button>
                  <button type="button" className="btn-ghost" disabled={!notaActual || borrar.isPending} onClick={() => { if (window.confirm(`¿Eliminar «${notaActual.title}»?`)) borrar.mutate(); }}>Eliminar</button>
                  <button type="button" className="btn-primary" disabled={!modificado || guardar.isPending || !title.trim()} onClick={() => guardar.mutate()}>{guardar.isPending ? "Guardando…" : "Guardar"}</button>
                </div>
              </div>
              <textarea className="cerebro-markdown" aria-label="Contenido Markdown" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} placeholder="# Título\n\nEscribe una nota. Enlaza otras con [[Nombre de nota]]." />
              <div className="cerebro-pie">
                <span>Markdown · enlaces `[[nota]]` compatibles con Obsidian</span>
                <span>{new TextEncoder().encode(content).length.toLocaleString()} bytes · límite 48 KB</span>
              </div>
              {(guardar.isError || borrar.isError) && <p className="cerebro-error" role="alert">{errorText(guardar.error || borrar.error)}</p>}
              {notice && <p className="cerebro-notice" role="status">{notice}</p>}
            </>
          ) : (
            <div className="cerebro-sin-seleccion"><strong>Elige una nota</strong><span>El contenido queda separado del historial de chat y de la memoria automática del proyecto.</span></div>
          )}
        </section>

        <aside className="cerebro-grafo" aria-label="Grafo de notas">
          <div className="cerebro-grafo-head"><strong>Mapa</strong><select aria-label="Contenido del mapa" value={vistaGrafo} onChange={(e) => setVistaGrafo(e.target.value as "notas" | "chats")}><option value="chats">Chats y proyectos</option><option value="notas">Enlaces entre notas</option></select></div>
          {vistaGrafo === "notas" ? <><Grafo nodos={graph.data?.nodos ?? []} enlaces={graph.data?.enlaces ?? []} seleccionado={selectedId} onSeleccionar={elegirId} />
            {graph.data?.limitado && <p className="cerebro-vacio">Se muestran las 12 notas más recientes.</p>}<p className="cerebro-vacio">El mapa refleja enlaces `[[...]]` entre notas existentes.</p></> : <>
            <Grafo nodos={mapaChats.nodos} enlaces={mapaChats.enlaces} seleccionado={null} onSeleccionar={(id) => { if (id.startsWith("chat:")) { setSelectedConversationId(id.slice(5)); void navigate({ to: "/chat" }); } }} />
            {conversations.isError && <p className="cerebro-error" role="alert">No se pudieron cargar los chats.</p>}
            {mapaChats.limitado && <p className="cerebro-vacio">Se muestran los primeros 24 chats disponibles.</p>}
            <p className="cerebro-vacio">Cada línea indica pertenencia a un proyecto, no una relación semántica. Selecciona un chat para abrirlo.</p></>}
        </aside>
      </div>
    </main>
  );
}

