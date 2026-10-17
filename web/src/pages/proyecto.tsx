import { useState } from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useShell } from "../components/shell-context";
import { chatDelProyecto, nuevoChatDelProyecto, chatsDelProyecto } from "../lib/chat-proyecto";
import { errorText } from "../lib/model";
import { ProyectoResumen } from "../components/proyecto-resumen";
import { ProyectoInstrucciones } from "../components/proyecto-instrucciones";
import { ProyectoMemoria } from "../components/proyecto-memoria";
import { ProyectoArchivos } from "../components/proyecto-archivos";
import { ProyectoSkills } from "../components/proyecto-skills";
import { ProyectoConfiguracion } from "../components/proyecto-configuracion";
import { ProyectoSecretos } from "../components/proyecto-secretos";
import { ProyectoSiguientePaso } from "../components/proyecto-siguiente";
import { ProyectoClave } from "../components/proyecto-clave";
import { ProyectoClonar } from "../components/proyecto-clonar";

// Vista general de un proyecto: resumen, instrucciones, memoria, skills, documentos, secretos y clave de GitHub.
export function ProjectDetailPage() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  const navigate = useNavigate();

  // Abre el chat del proyecto o crea uno nuevo si se solicita.
  const qc = useQueryClient();
  const { setSelectedConversationId } = useShell();
  const abrirChat = useMutation({
    mutationFn: () => chatDelProyecto(id),
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["project-chats", id] });
      setSelectedConversationId(conv.id);
      void navigate({ to: "/chat" });
    },
  });

  const crearNuevoChat = useMutation({
    mutationFn: () => nuevoChatDelProyecto(id),
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["project-chats", id] });
      setSelectedConversationId(conv.id);
      void navigate({ to: "/chat" });
    },
  });

  const listaChats = useQuery({
    queryKey: ["project-chats", id],
    queryFn: () => chatsDelProyecto(id),
    enabled: id !== "",
  });

  const detalle = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
    enabled: id !== "",
  });

  const datos = detalle.data;
  const proyecto = datos?.project;

  // Un proyecto recién creado abre con su paso siguiente: tarea opcional y chat del proyecto.
  // Si el alta dejó un clonado en marcha, `clonandoEn` es el chat donde se ve.
  const recienCreado = useRouterState({
    select: (s) => (s.location.state as unknown as { proyectoNuevo?: boolean } | undefined)?.proyectoNuevo === true,
  });
  const clonandoEn = useRouterState({
    select: (s) => (s.location.state as unknown as { clonandoEn?: string } | undefined)?.clonandoEn ?? null,
  });
  const [siguienteAbierto, setSiguienteAbierto] = useState(recienCreado);

  return (
    <div className="page-wrap">
      <main className="container">
        <Link to="/proyectos" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Volver a proyectos
        </Link>

        <header className="header-main">
          <div className="header-top">
            <div>
              <h1 className="page-title">{proyecto?.name ?? "Proyecto"}</h1>
              {proyecto && (
                <p className="folder-note">Carpeta: /srv/orquestador/projects/{proyecto.carpeta}</p>
              )}
            </div>
          </div>
          <div className="header-actions">
            {proyecto && (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => abrirChat.mutate()}
                  disabled={abrirChat.isPending || crearNuevoChat.isPending}
                >
                  {abrirChat.isPending ? "Abriendo…" : "Abrir chat"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => crearNuevoChat.mutate()}
                  disabled={abrirChat.isPending || crearNuevoChat.isPending}
                >
                  {crearNuevoChat.isPending ? "Creando…" : "+ Nuevo chat"}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    void navigate({
                      to: "/tareas",
                      state: (prev) => ({ ...prev, proyectoId: proyecto.id }),
                    })
                  }
                >
                  Tarea nueva en este proyecto
                </button>
              </>
            )}
          </div>
        </header>

        {(abrirChat.isError || crearNuevoChat.isError) && (
          <div className="error-box" role="alert">
            <span className="error-text">
              {errorText(abrirChat.error || crearNuevoChat.error)}
            </span>
          </div>
        )}

        {siguienteAbierto && proyecto && !clonandoEn && (
          <ProyectoSiguientePaso proyectoId={proyecto.id} onCerrar={() => setSiguienteAbierto(false)} />
        )}

        {detalle.isPending && <p className="help-note">Cargando el proyecto…</p>}

        {detalle.isError && (
          <div className="error-box" role="alert">
            <span className="error-text">{errorText(detalle.error)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => void detalle.refetch()}>
                Reintentar
              </button>
              <Link to="/proyectos" className="btn-ghost" style={{ textDecoration: "none" }}>
                Ver todos los proyectos
              </Link>
            </div>
          </div>
        )}

        {datos && proyecto && (
          <>
            {proyecto.origen_url && !proyecto.clonado_en && (
              <ProyectoClonar proyecto={proyecto} clonandoEn={clonandoEn} />
            )}
            <ProyectoResumen detalle={datos} />
            <section className="panel" aria-labelledby="proyecto-chats-titulo">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 id="proyecto-chats-titulo" className="panel-title" style={{ margin: 0 }}>
                  Chats del proyecto {listaChats.data ? `(${listaChats.data.length})` : ""}
                </h2>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 10px", fontSize: 13 }}
                  onClick={() => crearNuevoChat.mutate()}
                  disabled={crearNuevoChat.isPending}
                >
                  + Nuevo chat
                </button>
              </div>

              {listaChats.isLoading && <p className="help-note">Cargando chats del proyecto…</p>}

              {listaChats.data && listaChats.data.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {listaChats.data.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "var(--surface-lowest)",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        padding: "10px 14px",
                      }}
                    >
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ flexShrink: 0, color: "var(--ink-2)" }}
                          aria-hidden="true"
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ padding: "4px 10px", fontSize: 13, flexShrink: 0 }}
                        onClick={() => {
                          setSelectedConversationId(c.id);
                          void navigate({ to: "/chat" });
                        }}
                      >
                        Abrir
                      </button>
                    </div>
                  ))}
                </div>
              ) : !listaChats.isLoading ? (
                <p className="help-note">No hay chats creados en este proyecto todavía.</p>
              ) : null}
            </section>
            <ProyectoInstrucciones proyecto={proyecto} />
            <ProyectoMemoria id={proyecto.id} memoria={datos.memoria} />
            <ProyectoSkills id={proyecto.id} />
            <ProyectoConfiguracion key={proyecto.id} id={proyecto.id} />
            <ProyectoArchivos id={proyecto.id} />
            <ProyectoSecretos id={proyecto.id} />
            <ProyectoClave id={proyecto.id} />
          </>
        )}
      </main>
    </div>
  );
}
