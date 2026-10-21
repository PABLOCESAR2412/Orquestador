import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, type ConexionMcp } from "../../api";
import { errorText } from "../../lib/model";
import { LoadingSkeleton } from "../loading-skeleton";

type Borrador = { nombre: string; url: string; token: string };
const BORRADOR_VACIO: Borrador = { nombre: "", url: "", token: "" };

export function PanelConexiones() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [nuevo, setNuevo] = useState(BORRADOR_VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Borrador>(BORRADOR_VACIO);
  const [quitarToken, setQuitarToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const conexiones = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: api.listMcpConnections,
    staleTime: 30_000,
  });
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders, staleTime: 60_000 });
  const github = useQuery({ queryKey: ["github-cuenta"], queryFn: api.githubCuenta, staleTime: 60_000 });
  const githubApp = useQuery({ queryKey: ["github-app-installations"], queryFn: api.githubAppInstalaciones, staleTime: 60_000 });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ["mcp-connections"] });
  const crear = useMutation({
    mutationFn: api.createMcpConnection,
    onSuccess: () => {
      setNuevo(BORRADOR_VACIO);
      setError(null);
      setAviso("Conexión añadida. Estará disponible en las próximas tareas y respuestas nuevas.");
      invalidar();
    },
    onError: (e) => { setAviso(null); setError(errorText(e)); },
  });
  const actualizar = useMutation({
    mutationFn: ({ id, ...body }: { id: string; nombre?: string; url?: string; token?: string; habilitada?: boolean; quitar_token?: boolean }) =>
      api.updateMcpConnection(id, body),
    onSuccess: (conexion) => {
      setEditando(null);
      setQuitarToken(false);
      setError(null);
      setAviso(`“${conexion.nombre}” quedó actualizado.`);
      invalidar();
    },
    onError: (e) => { setAviso(null); setError(errorText(e)); },
  });
  const borrar = useMutation({
    mutationFn: api.deleteMcpConnection,
    onSuccess: () => {
      setError(null);
      setAviso("Conexión eliminada.");
      invalidar();
    },
    onError: (e) => { setAviso(null); setError(errorText(e)); },
  });

  const lista = conexiones.data?.conexiones ?? [];
  const google = proveedores.data?.find((proveedor) => proveedor.id === "google");
  const githubConectado = Boolean(github.data?.conectado || githubApp.data?.seleccionada);

  const enviarNueva = () => {
    setError(null);
    setAviso(null);
    crear.mutate({
      nombre: nuevo.nombre.trim(),
      url: nuevo.url.trim(),
      ...(nuevo.token ? { token: nuevo.token } : {}),
    });
  };

  const empezarEdicion = (conexion: ConexionMcp) => {
    setAviso(null);
    setError(null);
    setEditando(conexion.id);
    setEdicion({ nombre: conexion.nombre, url: conexion.url, token: "" });
    setQuitarToken(false);
  };

  const guardarEdicion = (conexion: ConexionMcp) => actualizar.mutate({
    id: conexion.id,
    nombre: edicion.nombre.trim(),
    url: edicion.url.trim(),
    ...(!quitarToken && edicion.token ? { token: edicion.token } : {}),
    ...(quitarToken ? { quitar_token: true } : {}),
  });

  const estadoConsultaError = [conexiones, proveedores, github, githubApp].find((consulta) => consulta.isError);

  return (
    <div className="aj-stack aj-conexiones">
      <section className="aj-seccion" aria-labelledby="aj-conexiones-titulo">
        <div className="aj-seccion-cabecera">
          <div>
            <h2 id="aj-conexiones-titulo" className="aj-titulo-seccion">Conexiones</h2>
            <p className="aj-nota aj-conexiones-intro">
              Administra servicios que Telo puede ofrecer a sus agentes. Un servidor MCP (Model Context Protocol) conecta herramientas externas, como tu LMS o gestor de tareas.
            </p>
          </div>
        </div>

        <div className="aj-conexion-nativas" aria-label="Conexiones integradas">
          <article className="aj-conexion-nativa">
            <div className="aj-conexion-identidad">
              <span className="aj-conexion-marca" aria-hidden="true">GH</span>
              <div>
                <h3>GitHub</h3>
                <p>{githubConectado ? "Cuenta o GitHub App vinculada" : "Gestiona repositorios y acciones Git"}</p>
              </div>
            </div>
            <span className={`aj-conexion-estado${githubConectado ? " is-ok" : ""}`}>
              <i aria-hidden="true" />{github.isPending || githubApp.isPending ? "Consultando…" : githubConectado ? "Vinculada" : "Sin vincular"}
            </span>
            <button type="button" className="aj-btn" onClick={() => void navigate({ to: "/ajustes", search: { pestana: "proveedores" } })}>
              Administrar
            </button>
          </article>
          <article className="aj-conexion-nativa">
            <div className="aj-conexion-identidad">
              <span className="aj-conexion-marca" aria-hidden="true">G</span>
              <div>
                <h3>Google · Gemini</h3>
                <p>{google?.configured ? "Proveedor de modelos de Google" : "Configura Gemini en proveedores de IA"}</p>
              </div>
            </div>
            <span className={`aj-conexion-estado${google?.configured && google.enAgente ? " is-ok" : ""}`}>
              <i aria-hidden="true" />{proveedores.isPending ? "Consultando…" : google?.configured && google.enAgente ? "Clave disponible" : "No configurada"}
            </span>
            <button type="button" className="aj-btn" onClick={() => void navigate({ to: "/ajustes", search: { pestana: "proveedores" } })}>
              Administrar
            </button>
          </article>
        </div>
        <p className="aj-nota">También puedes integrar Google Workspace u otros servicios mediante un servidor MCP compatible.</p>
      </section>

      <section className="aj-seccion aj-conexiones-mcp" aria-labelledby="aj-mcp-titulo">
        <div className="aj-seccion-cabecera">
          <div>
            <div className="aj-titulo-con-chip">
              <h2 id="aj-mcp-titulo" className="aj-titulo-seccion">Servidores MCP</h2>
              <span className="aj-chip">{lista.length} {lista.length === 1 ? "conexión" : "conexiones"}</span>
            </div>
            <p className="aj-nota">Añade un endpoint HTTPS remoto. Los servidores habilitados se ofrecen a OpenCode y Codex en cada nueva ejecución.</p>
          </div>
        </div>

        {estadoConsultaError && (
          <div className="aj-error-bloque" role="alert">
            <p className="aj-error">No se pudo cargar el estado de las conexiones: {errorText(estadoConsultaError.error)}</p>
            <button type="button" className="aj-btn" onClick={() => void estadoConsultaError.refetch()}>Reintentar</button>
          </div>
        )}
        {conexiones.isPending && <LoadingSkeleton tipo="lineas" cantidad={2} />}

        {lista.length > 0 && (
          <div className="aj-conexiones-lista" aria-label="Servidores MCP configurados">
            {lista.map((conexion) => (
              <article className="aj-conexion-remota" key={conexion.id}>
                <div className="aj-conexion-remota-cabecera">
                  <div className="aj-conexion-datos">
                    <div className="aj-conexion-titulo">
                      <h3>{conexion.nombre}</h3>
                      <span className={`aj-conexion-estado${conexion.habilitada ? " is-ok" : ""}`}>
                        <i aria-hidden="true" />{conexion.habilitada ? "Habilitada" : "Pausada"}
                      </span>
                    </div>
                    <p className="aj-mono aj-conexion-url">{conexion.url}</p>
                    <p className="aj-nota">{conexion.autenticacion_configurada ? "Token Bearer guardado y cifrado" : "Sin token Bearer"} · Se usa en ejecuciones nuevas</p>
                  </div>
                  <div className="aj-conexion-acciones">
                    <button
                      type="button"
                      className="aj-btn"
                      disabled={actualizar.isPending || borrar.isPending}
                      onClick={() => actualizar.mutate({ id: conexion.id, habilitada: !conexion.habilitada })}
                    >
                      {conexion.habilitada ? "Pausar" : "Habilitar"}
                    </button>
                    <button type="button" className="aj-btn" onClick={() => editando === conexion.id ? setEditando(null) : empezarEdicion(conexion)}>
                      {editando === conexion.id ? "Cerrar" : "Editar"}
                    </button>
                    <button
                      type="button"
                      className="aj-btn aj-btn-peligro"
                      disabled={borrar.isPending}
                      onClick={() => {
                        if (window.confirm(`¿Eliminar “${conexion.nombre}”? Los agentes dejarán de recibir esta conexión.`)) {
                          borrar.mutate(conexion.id);
                        }
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                {editando === conexion.id && (
                  <div className="aj-conexion-edicion">
                    <CampoConexion label="Nombre" value={edicion.nombre} onChange={(nombre) => setEdicion({ ...edicion, nombre })} onEnter={() => guardarEdicion(conexion)} />
                    <CampoConexion label="URL HTTPS del servidor" value={edicion.url} onChange={(url) => setEdicion({ ...edicion, url })} tipo="url" onEnter={() => guardarEdicion(conexion)} />
                    <CampoConexion
                      label="Nuevo token Bearer (opcional)"
                      value={edicion.token}
                      onChange={(token) => { setEdicion({ ...edicion, token }); setQuitarToken(false); }}
                      tipo="password"
                      placeholder={conexion.autenticacion_configurada ? "Deja vacío para conservar el token" : "Sin token"}
                      onEnter={() => guardarEdicion(conexion)}
                    />
                    {conexion.autenticacion_configurada && (
                      <label className="aj-conexion-quitar-token">
                        <input type="checkbox" checked={quitarToken} onChange={(e) => setQuitarToken(e.target.checked)} />
                        Quitar el token guardado
                      </label>
                    )}
                    <div className="aj-conexion-acciones">
                      <button type="button" className="aj-btn aj-btn-primario" disabled={actualizar.isPending} onClick={() => guardarEdicion(conexion)}>
                        {actualizar.isPending ? "Guardando…" : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {!conexiones.isPending && !conexiones.isError && lista.length === 0 && (
          <div className="aj-conexiones-vacio">
            <span className="aj-conexion-marca" aria-hidden="true">MCP</span>
            <p><strong>Aún no hay servidores MCP.</strong> Añade uno para conectar Telo con tus herramientas.</p>
          </div>
        )}

        <div className="aj-conexion-nueva">
          <h3>Añadir servidor</h3>
          <p className="aj-nota">Usa la URL remota que te proporcionó el servicio. El token, si agregas uno, se guarda cifrado en este servidor.</p>
          <div className="aj-conexion-edicion">
            <CampoConexion label="Nombre" value={nuevo.nombre} onChange={(nombre) => setNuevo({ ...nuevo, nombre })} placeholder="Mi LMS" onEnter={enviarNueva} />
            <CampoConexion label="URL HTTPS del servidor" value={nuevo.url} onChange={(url) => setNuevo({ ...nuevo, url })} tipo="url" placeholder="https://ejemplo.com/mcp" onEnter={enviarNueva} />
            <CampoConexion label="Token Bearer (opcional)" value={nuevo.token} onChange={(token) => setNuevo({ ...nuevo, token })} tipo="password" autoComplete="new-password" onEnter={enviarNueva} />
            <div className="aj-conexion-acciones">
              <button
                type="button"
                className="aj-btn aj-btn-primario"
                disabled={crear.isPending || !nuevo.nombre.trim() || !nuevo.url.trim()}
                onClick={enviarNueva}
              >
                {crear.isPending ? "Añadiendo…" : "Añadir conexión"}
              </button>
            </div>
          </div>
        </div>

        <p className="aj-nota aj-conexiones-confianza">
          Conecta solo servidores de confianza: sus herramientas pueden recibir instrucciones y contexto de la tarea. El transporte debe ser HTTPS; OAuth y servidores locales todavía no están disponibles aquí.
        </p>
        {error && <p className="aj-error" role="alert">{error}</p>}
        {aviso && <p className="aj-conexion-aviso" role="status">{aviso}</p>}
      </section>
    </div>
  );
}

function CampoConexion({
  label,
  value,
  onChange,
  tipo = "text",
  placeholder,
  autoComplete,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tipo?: "text" | "url" | "password";
  placeholder?: string;
  autoComplete?: string;
  onEnter: () => void;
}) {
  return (
    <label className="aj-conexion-campo">
      <span className="aj-campo-etiqueta">{label}</span>
      <input
        className="aj-input"
        type={tipo}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete ?? (tipo === "password" ? "off" : undefined)}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          onEnter();
        }}
      />
    </label>
  );
}
