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
  const [guiaMcp, setGuiaMcp] = useState<{ nombre: string; detalle: string } | null>(null);

  const conexiones = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: api.listMcpConnections,
    staleTime: 30_000,
  });
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders, staleTime: 60_000 });
  const github = useQuery({ queryKey: ["github-cuenta"], queryFn: api.githubCuenta, staleTime: 60_000 });
  const githubApp = useQuery({ queryKey: ["github-app-installations"], queryFn: api.githubAppInstalaciones, staleTime: 60_000 });
  const skills = useQuery({ queryKey: ["connection-skills"], queryFn: () => api.listSkills(), staleTime: 60_000 });
  const servidor = useQuery({ queryKey: ["integration-prerequisite-tools"], queryFn: api.serverStatus, staleTime: 30_000 });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ["mcp-connections"] });
  const crear = useMutation({
    mutationFn: api.createMcpConnection,
    onSuccess: () => {
      setNuevo(BORRADOR_VACIO);
      setGuiaMcp(null);
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
  const skillsPorNombre = new Map((skills.data?.skills ?? []).map((skill) => [skill.nombre, skill]));
  const herramientasPorNombre = new Map((servidor.data?.herramientas ?? []).map((herramienta) => [herramienta.nombre, herramienta]));
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

  const prepararMcp = (nombre: string, detalle: string) => {
    setGuiaMcp({ nombre, detalle });
    setNuevo({ ...BORRADOR_VACIO, nombre });
    window.setTimeout(() => document.getElementById("aj-mcp-nueva")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  const conexionMcpPorAlias = (...aliases: string[]) => {
    const normalizar = (valor: string) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    return lista.find((conexion) => aliases.some((alias) => normalizar(conexion.nombre).includes(normalizar(alias))));
  };

  const estadoMcp = (...aliases: string[]) => {
    if (conexiones.isPending) return "Consultando conexión MCP…";
    const conexion = conexionMcpPorAlias(...aliases);
    if (!conexion) return "Sin MCP compatible registrado";
    return conexion.habilitada ? `MCP «${conexion.nombre}» registrado · sin prueba` : `MCP «${conexion.nombre}» pausado`;
  };

  const gestionarMcp = () => document.getElementById("aj-mcp-titulo")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const estadoSkill = (nombre: string) => {
    if (skills.isPending) return "Consultando skill…";
    const skill = skillsPorNombre.get(nombre);
    return skill?.valida ? "Disponible en Telo" : "No instalada o inválida";
  };

  const nodeMajor = Number(herramientasPorNombre.get("node")?.version?.match(/v?(\d+)/)?.[1] ?? 0);
  const libreServidor = servidor.data?.disco.find((disco) => disco.etiqueta === "datos")?.libreBytes ?? null;

  const estadoConsultaError = [conexiones, proveedores, github, githubApp, skills, servidor].find((consulta) => consulta.isError);

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

      <section className="aj-seccion" aria-labelledby="aj-habilidades-integraciones-titulo">
        <div className="aj-seccion-cabecera">
          <div>
            <h2 id="aj-habilidades-integraciones-titulo" className="aj-titulo-seccion">Habilidades e integraciones</h2>
            <p className="aj-nota aj-conexiones-intro">Estado real de las skills locales, herramientas del servidor y accesos externos que faltan. «Disponible» indica que Telo tiene los requisitos locales; no confirma una cuenta o servicio remoto.</p>
          </div>
        </div>

        <div className="aj-integraciones-catalogo">
          <h3>Funciones locales</h3>
          <div className="aj-integracion-fila">
            <div><strong>Context7 · documentación técnica</strong><p>Busca documentación actual de bibliotecas y APIs durante el trabajo.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("context7")?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("context7")}</span>
            <span className="aj-integracion-requisito">Sin token adicional</span>
          </div>
          <div className="aj-integracion-fila">
            <div><strong>HyperFrames · animaciones y video HTML</strong><p>Se invoca bajo demanda con npx; el diagnóstico final de HyperFrames también revisa Chromium.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("hyperframes-video")?.valida && nodeMajor >= 22 && herramientasPorNombre.get("ffmpeg")?.disponible && herramientasPorNombre.get("ffprobe")?.disponible ? " is-ok" : ""}`}><i aria-hidden="true" />{skills.isPending || servidor.isPending ? "Consultando…" : skillsPorNombre.get("hyperframes-video")?.valida && nodeMajor >= 22 && herramientasPorNombre.get("ffmpeg")?.disponible && herramientasPorNombre.get("ffprobe")?.disponible ? "Requisitos locales listos" : "Revisar requisitos locales"}</span>
            <span className="aj-integracion-requisito">{servidor.isPending ? "Consultando Node…" : nodeMajor >= 22 ? `Node ${nodeMajor} · cumple versión 22+` : nodeMajor ? `Node ${nodeMajor} · requiere versión 22+` : "Node no disponible"} · FFmpeg {herramientasPorNombre.get("ffmpeg")?.disponible ? "listo" : "faltante"} · FFprobe {herramientasPorNombre.get("ffprobe")?.disponible ? "listo" : "faltante"}{libreServidor === null ? "" : ` · ${(libreServidor / 1024 ** 3).toFixed(1)} GiB libres`}</span>
          </div>
          {([ ["superpowers", "Superpowers", "Flujos de ingeniería, depuración y revisión locales."], ["ecc-workflows", "ECC · Everything Claude Code", "Patrones locales de contexto, agentes y flujos de ingeniería." ] ] as const).map(([id, nombre, descripcion]) => (
            <div className="aj-integracion-fila" key={id}>
              <div><strong>{nombre}</strong><p>{descripcion}</p></div>
              <span className={`aj-conexion-estado${skillsPorNombre.get(id)?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill(id)}</span>
              <span className="aj-integracion-requisito">Sin credenciales externas</span>
            </div>
          ))}
        </div>

        <div className="aj-integraciones-catalogo">
          <h3>Servicios externos</h3>
          <div className="aj-integracion-fila">
            <div><strong>Instagram · Meta</strong><p>La skill prepara publicaciones. Para publicar de verdad se necesita OAuth de Meta, una cuenta profesional y permisos aprobados; Telo aún no implementa ese flujo directo.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("instagram-agent")?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("instagram-agent")}</span>
            <span className="aj-integracion-requisito">Para publicar hacen falta Meta App ID/Secret, OAuth y permisos de una cuenta profesional. El formulario MCP no configura esas credenciales.</span>
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Obsidian · vault</strong><p>Necesita Obsidian Local REST API o un puente MCP, su URL y token. El endpoint debe ser HTTPS y accesible desde la VM; localhost de tu PC no llega al servidor.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("obsidian-vault")?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("obsidian-vault")}</span>
            <span className="aj-integracion-requisito">{estadoMcp("Obsidian")} · Necesitas un puente MCP HTTPS accesible desde la VM y el Bearer de ese puente; el token del plugin REST por sí solo no sirve aquí.</span>
            {conexionMcpPorAlias("Obsidian")
              ? <button type="button" className="aj-btn" onClick={gestionarMcp}>Gestionar MCP</button>
              : <button type="button" className="aj-btn" onClick={() => prepararMcp("Obsidian · puente MCP", "Necesitas un puente MCP remoto con HTTPS, accesible desde la VM. El formulario guarda la URL MCP y el token Bearer del puente. El REST API de Obsidian por sí solo no es MCP.")}>Configurar puente MCP</button>}
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Harvey · legal</strong><p>La skill organiza análisis y borradores; el acceso real requiere autorización de tu organización y un conector/API compatible.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("harvey-legal")?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("harvey-legal")}</span>
            <span className="aj-integracion-requisito">{estadoMcp("Harvey")} · Configurable solo si tu organización ofrece un endpoint MCP HTTPS y autoriza el uso. Telo admite Bearer; no implementa OAuth ni credenciales API propias de Harvey.</span>
            {conexionMcpPorAlias("Harvey")
              ? <button type="button" className="aj-btn" onClick={gestionarMcp}>Gestionar MCP</button>
              : <button type="button" className="aj-btn" onClick={() => prepararMcp("Harvey · MCP de organización", "Solo continúa si tu organización te entrega un endpoint MCP remoto HTTPS y autoriza este uso. El token se guarda cifrado y se envía como Bearer; este formulario no configura OAuth ni una API propia de Harvey.")}>Preparar campos MCP</button>}
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Orca · constructor de agentes</strong><p>La skill redacta una especificación local. El producto Orca aún debe identificarse y ofrecer una integración compatible antes de crear agentes allí.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("orca-agent-builder")?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("orca-agent-builder")}</span>
            <span className="aj-integracion-requisito">{estadoMcp("Orca")} · Falta identificar el producto Orca y su API/conector. Telo aún no tiene campos compatibles; la skill solo prepara una especificación.</span>
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Búsqueda web · empleo y clientes</strong><p>Las skills pueden preparar búsquedas y propuestas; para consultar resultados actuales hace falta un proveedor de búsqueda o servidor MCP con búsqueda web.</p></div>
            <span className={`aj-conexion-estado${skillsPorNombre.get("ai-job-search")?.valida && skillsPorNombre.get("find-clients")?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{skills.isPending ? "Consultando…" : `Empleo: ${estadoSkill("ai-job-search")} · Clientes: ${estadoSkill("find-clients")}`}</span>
            <span className="aj-integracion-requisito">{estadoMcp("Búsqueda web", "Web search", "Search MCP")}; el servidor debe exponer búsqueda web y aceptar Bearer si requiere autenticación.</span>
            {conexionMcpPorAlias("Búsqueda web", "Web search", "Search MCP")
              ? <button type="button" className="aj-btn" onClick={gestionarMcp}>Gestionar MCP</button>
              : <button type="button" className="aj-btn" onClick={() => prepararMcp("Búsqueda web · MCP", "Necesitas un endpoint MCP HTTPS que ofrezca una herramienta de búsqueda web. El token Bearer es opcional si el proveedor lo exige. Añadirlo no prueba que las búsquedas respondan.")}>Configurar MCP</button>}
          </div>
        </div>
      </section>

      <section className="aj-seccion aj-conexiones-mcp" aria-labelledby="aj-mcp-titulo">
        <div className="aj-seccion-cabecera">
          <div>
            <div className="aj-titulo-con-chip">
              <h2 id="aj-mcp-titulo" className="aj-titulo-seccion">Servidores MCP</h2>
              <span className="aj-chip">{lista.length} {lista.length === 1 ? "conexión" : "conexiones"}</span>
            </div>
            <p className="aj-nota">Añade un endpoint de servidor MCP remoto por HTTPS y, si ese servidor lo requiere, un token Bearer. Los servidores habilitados se ofrecen a OpenCode y Codex en cada nueva ejecución; Telo no comprueba aquí si responden o si aceptan el token.</p>
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
                    <p className="aj-nota">{conexion.autenticacion_configurada ? "Token Bearer guardado y cifrado" : "Sin token Bearer"} · Se ofrece en ejecuciones nuevas · Sin prueba de conexión</p>
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

        <div className="aj-conexion-nueva" id="aj-mcp-nueva">
          <h3>{guiaMcp ? `Configurar ${guiaMcp.nombre}` : "Añadir servidor MCP"}</h3>
          <p className="aj-nota">{guiaMcp?.detalle ?? "Usa la URL HTTPS de un servidor MCP remoto. Si exige Bearer, pega aquí ese token: Telo lo guarda cifrado en este servidor."}</p>
          {conexiones.data?.cifrado_disponible === false && <p className="aj-error" role="alert">El servidor no tiene disponible la clave maestra de cifrado. Puedes guardar una conexión sin token; para guardar credenciales, configura la clave del servidor primero.</p>}
          <div className="aj-conexion-edicion">
            <CampoConexion label="Nombre" value={nuevo.nombre} onChange={(nombre) => setNuevo({ ...nuevo, nombre })} placeholder="Mi servidor MCP" onEnter={enviarNueva} />
            <CampoConexion label="URL HTTPS del servidor" value={nuevo.url} onChange={(url) => setNuevo({ ...nuevo, url })} tipo="url" placeholder="https://ejemplo.com/mcp" onEnter={enviarNueva} />
            <CampoConexion label="Token Bearer (opcional; se cifra al guardar)" value={nuevo.token} onChange={(token) => setNuevo({ ...nuevo, token })} tipo="password" autoComplete="new-password" onEnter={enviarNueva} />
            <div className="aj-conexion-acciones">
              <button
                type="button"
                className="aj-btn aj-btn-primario"
                disabled={crear.isPending || !nuevo.nombre.trim() || !nuevo.url.trim() || Boolean(nuevo.token && conexiones.data?.cifrado_disponible === false)}
                onClick={enviarNueva}
              >
                {crear.isPending ? "Añadiendo…" : "Añadir conexión"}
              </button>
            </div>
          </div>
        </div>

        <p className="aj-nota aj-conexiones-confianza">
          Conecta solo servidores de confianza: sus herramientas pueden recibir instrucciones y contexto de la tarea. Este formulario admite MCP remoto por HTTPS y autenticación Bearer opcional; no acepta claves de API arbitrarias, OAuth ni servicios locales directamente.
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
