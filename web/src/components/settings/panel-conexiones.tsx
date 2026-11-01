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
  const instalarSkills = useMutation({
    mutationFn: async ({ repositorio, nombres }: { grupo: string; repositorio: string; nombres: string[] }) => {
      for (const nombre of nombres) {
        await api.installSkill(`npx skills add ${repositorio} --skill ${nombre}`);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["connection-skills"] }),
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
    if (skills.isError) return "No se pudo consultar";
    const skill = skillsPorNombre.get(nombre);
    if (!skill) return "No instalada";
    return skill.valida ? "Instalada y válida" : "Inválida · revisar antes de reemplazar";
  };
  const skillDisponible = (...nombres: string[]) => nombres.some((nombre) => skillsPorNombre.get(nombre)?.valida);
  const skillsDisponibles = (...nombres: string[]) => nombres.every((nombre) => skillsPorNombre.get(nombre)?.valida);
  const abrirSkills = () => {
    void navigate({ to: "/ajustes", search: { pestana: "proveedores" } });
    window.setTimeout(() => document.getElementById("aj-skills-titulo")?.scrollIntoView({ behavior: "smooth", block: "start" }), 180);
  };
  const accionSkills = (grupo: string, repositorio: string, nombres: string[]) => {
    if (!skills.isSuccess) return null;
    const faltantes = nombres.filter((nombre) => !skillsPorNombre.has(nombre));
    const invalidas = nombres.some((nombre) => skillsPorNombre.has(nombre) && !skillsPorNombre.get(nombre)?.valida);
    const instalando = instalarSkills.isPending && instalarSkills.variables?.grupo === grupo;
    const errorInstalacion = instalarSkills.isError && instalarSkills.variables?.grupo === grupo;
    if (!faltantes.length && !invalidas && !errorInstalacion) return null;
    return (
      <div className="aj-integracion-acciones">
        {faltantes.length > 0 && (
          <button
            type="button"
            className="aj-btn"
            disabled={instalarSkills.isPending}
            onClick={() => instalarSkills.mutate({ grupo, repositorio, nombres: faltantes })}
          >
            {instalando ? "Instalando…" : `Instalar${faltantes.length > 1 ? ` ${faltantes.length} skills` : ""}`}
          </button>
        )}
        {invalidas && <button type="button" className="aj-btn" onClick={abrirSkills}>Revisar en Skills</button>}
        {errorInstalacion && <p className="aj-error" role="alert">No se pudo importar desde el repositorio: {errorText(instalarSkills.error)}</p>}
      </div>
    );
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
            <div><strong>Context7 · documentación técnica</strong><p>Skill de Upstash; Telo activa su MCP remoto al necesitar documentación. <a href="https://github.com/upstash/context7/tree/master/plugins/agent-plugins/context7/skills/context7-mcp" target="_blank" rel="noreferrer">Repositorio fuente</a>.</p></div>
            <span className={`aj-conexion-estado${skillDisponible("context7-mcp") ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("context7-mcp")}</span>
            <span className="aj-integracion-requisito">Funciona sin clave con cuota básica. Una clave opcional aumenta la cuota y permite repositorios privados: <a href="https://context7.com/dashboard" target="_blank" rel="noreferrer">crear clave en Context7</a>.</span>
            {accionSkills("context7", "upstash/context7", ["context7-mcp"])}
          </div>
          <div className="aj-integracion-fila">
            <div><strong>HyperFrames · animaciones y video HTML</strong><p>Skills del repositorio de HeyGen. Telo conserva el <code>SKILL.md</code> principal, no los archivos de referencia del plugin. <a href="https://github.com/heygen-com/hyperframes/tree/main/skills" target="_blank" rel="noreferrer">Ver skills fuente</a>. Se ejecuta bajo demanda con npx.</p></div>
            <span className={`aj-conexion-estado${skillsDisponibles("hyperframes", "hyperframes-cli", "hyperframes-registry", "media-use") && nodeMajor >= 22 && herramientasPorNombre.get("ffmpeg")?.disponible && herramientasPorNombre.get("ffprobe")?.disponible ? " is-ok" : ""}`}><i aria-hidden="true" />{skills.isPending || servidor.isPending ? "Consultando…" : skillsDisponibles("hyperframes", "hyperframes-cli", "hyperframes-registry", "media-use") && nodeMajor >= 22 && herramientasPorNombre.get("ffmpeg")?.disponible && herramientasPorNombre.get("ffprobe")?.disponible ? "Requisitos base presentes" : "Revisar requisitos locales"}</span>
            <span className="aj-integracion-requisito">{servidor.isPending ? "Consultando Node…" : nodeMajor >= 22 ? `Node ${nodeMajor} · cumple versión 22+` : nodeMajor ? `Node ${nodeMajor} · requiere versión 22+` : "Node no disponible"} · FFmpeg {herramientasPorNombre.get("ffmpeg")?.disponible ? "listo" : "faltante"} · FFprobe {herramientasPorNombre.get("ffprobe")?.disponible ? "listo" : "faltante"}{libreServidor === null ? "" : ` · ${ (libreServidor / 1024 ** 3).toFixed(1)} GiB libres ahora (espacio disponible, no requisito fijo)`}</span>
            {accionSkills("hyperframes", "heygen-com/hyperframes", ["hyperframes", "hyperframes-cli", "hyperframes-registry", "media-use"])}
          </div>
          {([ ["using-superpowers", "Superpowers", "obra/superpowers", "Skill de flujo de trabajo. Telo importa el SKILL.md; no instala hooks ni el plugin completo."], ["strategic-compact", "ECC · Everything Claude Code", "affaan-m/everything-claude-code", "Skill strategic-compact. Telo no instala el paquete entero, sus hooks o agentes." ] ] as const).map(([id, nombre, repositorio, descripcion]) => (
            <div className="aj-integracion-fila" key={id}>
              <div><strong>{nombre}</strong><p>{descripcion} <a href={`https://github.com/${repositorio}`} target="_blank" rel="noreferrer">Repositorio fuente</a>.</p></div>
              <span className={`aj-conexion-estado${skillsPorNombre.get(id)?.valida ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill(id)}</span>
              <span className="aj-integracion-requisito">No requiere credenciales externas.</span>
              {accionSkills(nombre, repositorio, [id])}
            </div>
          ))}
        </div>

        <div className="aj-integraciones-catalogo">
          <h3>Servicios externos</h3>
          <div className="aj-integracion-fila">
            <div><strong>Instagram · Meta</strong><p>Instrucciones de contenido de <a href="https://github.com/Jakeschincariol/instagram-agent-skill" target="_blank" rel="noreferrer">Jakeschincariol</a>; Telo importa solo cada <code>SKILL.md</code>. Preparan guiones, no publican ni conectan la API de Meta.</p></div>
            <span className={`aj-conexion-estado${skillsDisponibles("ig-plan", "ig-reel", "ig-story", "ig-caption", "ig-carousel", "ig-human") ? " is-ok" : ""}`}><i aria-hidden="true" />{skills.isPending ? "Consultando…" : skillsDisponibles("ig-plan", "ig-reel", "ig-story", "ig-caption", "ig-carousel", "ig-human") ? "Skills de contenido instaladas" : "Skills de contenido incompletas"}</span>
            <span className="aj-integracion-requisito">Para publicar: cuenta Creator o Business, app Meta y OAuth con permisos de contenido. Puedes usar el flujo Instagram Login sin vincular una Página; el flujo Facebook Login sí la exige. Telo aún no implementa OAuth/publicación. La verificación empresarial no se necesita para redactar.</span>
            {accionSkills("instagram", "Jakeschincariol/instagram-agent-skill", ["ig-plan", "ig-reel", "ig-story", "ig-caption", "ig-carousel", "ig-human"])}
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Obsidian · vault</strong><p>Skills de <a href="https://github.com/kepano/obsidian-skills" target="_blank" rel="noreferrer">kepano/obsidian-skills</a> (proyecto comunitario). Telo importa solo los <code>SKILL.md</code>; no es el conector del vault.</p></div>
            <span className={`aj-conexion-estado${skillsDisponibles("obsidian-markdown", "obsidian-cli") ? " is-ok" : ""}`}><i aria-hidden="true" />{skillsDisponibles("obsidian-markdown", "obsidian-cli") ? "Skills de Obsidian instaladas" : "Skills de Obsidian incompletas"}</span>
            <span className="aj-integracion-requisito">{estadoMcp("Obsidian")} · Necesitas un puente MCP HTTPS accesible desde la VM y el Bearer de ese puente; el token del plugin REST por sí solo no sirve aquí.</span>
            {accionSkills("obsidian", "kepano/obsidian-skills", ["obsidian-markdown", "obsidian-cli"])}
            {conexionMcpPorAlias("Obsidian")
              ? <button type="button" className="aj-btn" onClick={gestionarMcp}>Gestionar MCP</button>
              : <button type="button" className="aj-btn" onClick={() => prepararMcp("Obsidian · puente MCP", "Necesitas un puente MCP remoto con HTTPS, accesible desde la VM. El formulario guarda la URL MCP y el token Bearer del puente. El REST API de Obsidian por sí solo no es MCP.")}>Configurar puente MCP</button>}
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Harvey · servicio legal</strong><p>Telo no trae un conector a Harvey. El BYOMCP documentado por Harvey permite que Harvey consuma un MCP de tu organización; no es un endpoint de Harvey para que Telo lo llame. <a href="https://help.harvey.ai/articles/joining-harvey-mcp-connector-library" target="_blank" rel="noreferrer">Documentación de Harvey</a>.</p></div>
            <span className={`aj-conexion-estado${conexionMcpPorAlias("Harvey")?.habilitada ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoMcp("Harvey")}</span>
            <span className="aj-integracion-requisito">Para que Telo use Harvey, pide a Harvey o al administrador de tu tenant una API/MCP oficial y su autenticación. Este formulario admite HTTPS y Bearer estático; si Harvey exige OAuth, habría que añadir ese flujo. Para que Harvey use Telo, tendríamos que construir un servidor MCP de Telo y registrarlo con tu administrador de Harvey.</span>
            {conexionMcpPorAlias("Harvey")
              ? <button type="button" className="aj-btn" onClick={gestionarMcp}>Gestionar MCP</button>
              : <button type="button" className="aj-btn" onClick={() => prepararMcp("Harvey · API/MCP oficial", "Antes de configurar, solicita a Harvey o al administrador del tenant una API/MCP oficialmente admitida, su URL HTTPS y el método de autenticación. Este formulario solo admite Bearer estático; no inicia OAuth. Para que Harvey llame a Telo hace falta desarrollar un servidor MCP en Telo y registrarlo en Harvey.")}>Configurar API/MCP oficial</button>}
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Orca · herramientas locales</strong><p>La skill CLI enseña a usar ese ejecutable; no crea agentes en un servicio llamado Orca.</p></div>
            <span className={`aj-conexion-estado${skillDisponible("orca-cli") ? " is-ok" : ""}`}><i aria-hidden="true" />{estadoSkill("orca-cli")}</span>
            <span className="aj-integracion-requisito">Para conectar un servicio Orca, primero confirma cuál producto es y solicita a su equipo una API/MCP compatible. Telo no tiene una integración de ese servicio.</span>
          </div>
          <div className="aj-integracion-fila">
            <div><strong>Búsqueda web · empleo y clientes</strong><p>La skill de empleo viene de <a href="https://github.com/MadsLorentzen/ai-job-search" target="_blank" rel="noreferrer">MadsLorentzen</a>; prospección, de <a href="https://github.com/coreyhaines31/marketingskills" target="_blank" rel="noreferrer">Corey Haines</a>. Telo solo importa sus <code>SKILL.md</code>; para búsqueda actual hace falta un MCP.</p></div>
            <span className={`aj-conexion-estado${skillDisponible("job-application-assistant") && skillDisponible("prospecting") ? " is-ok" : ""}`}><i aria-hidden="true" />{skills.isPending ? "Consultando…" : `Empleo: ${estadoSkill("job-application-assistant")} · Clientes: ${estadoSkill("prospecting")}`}</span>
            <span className="aj-integracion-requisito">{estadoMcp("Búsqueda web", "Web search", "Search MCP")}; el servidor debe exponer búsqueda web y aceptar Bearer si requiere autenticación.</span>
            {accionSkills("empleo", "MadsLorentzen/ai-job-search", ["job-application-assistant"])}
            {accionSkills("prospeccion", "coreyhaines31/marketingskills", ["prospecting"])}
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
