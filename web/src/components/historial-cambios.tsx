import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import cambios from "../cambios.json";
import { VERSION_SISTEMA } from "../lib/version-sistema";
import { useDialogo } from "./controls";

export type ReleaseItem = {
  tag: "FEATURE" | "ARQUITECTURA" | "MEJORA" | "FIX";
  titulo: string;
  descripcion: string;
  pr?: number | null;
};

export type Release = {
  version: string;
  actual?: boolean;
  tipoSemver: "Cambio Grande (Major)" | "Cambio Mediano (Minor)" | "Optimizaciones (Patch)";
  fecha: string;
  titulo: string;
  resumen: string;
  items: ReleaseItem[];
};

export const RELEASES_DESTACADAS: Release[] = [
  {
    version: "v2.0.0",
    actual: true,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-16",
    titulo: "Rediseño Tríptico de Escritorio & Modo Claro de Precisión",
    resumen:
      "Transformación integral de la experiencia de usuario inspirada en Claude Desktop, Antigravity Desktop y Codex Desktop. Incorpora modo claro de alta fidelidad basado en Stitch MCP, Command Palette (Ctrl+K), inspector de diffs Git side-by-side/unificado, telemetría y runner status LED, tareas programadas y analíticas avanzadas.",
    items: [
      {
        tag: "FEATURE",
        titulo: "Modo Claro 'Orquestador Light Precision' (Stitch MCP)",
        descripcion:
          "Implementación completa del tema claro y sincronización con el sistema (oscuro/claro/sistema) preservando la paleta ámbar industrial (#d9a441/#b88628), con tokens CSS variables para fondos, tarjetas y tipografía de precisión.",
      },
      {
        tag: "FEATURE",
        titulo: "Paleta de Comandos Global (Ctrl+K / ⌘K)",
        descripcion:
          "Acceso rápido a cualquier sección, ejecución de agentes, creación de proyectos, cambio de tema y acciones de desarrollo mediante teclado con búsqueda difusa en tiempo real.",
      },
      {
        tag: "FEATURE",
        titulo: "Inspector de Diffs Git (Estilo Codex Desktop)",
        descripcion:
          "Visualizador de cambios de código con vistas unificada y dividida (split view), conteo de adiciones/eliminaciones por archivo, pestañas interactivas y barra de aprobación de commits.",
      },
      {
        tag: "FEATURE",
        titulo: "Bloques de Razonamiento Expandibles & Quick Commands (Estilo Claude Desktop)",
        descripcion:
          "Integración de bloques <details className='thought-block'> para visualizar el pensamiento interno del modelo y barra de comandos rápidos (/plan, /diff, /test, /run, /status) en Chat.",
      },
      {
        tag: "FEATURE",
        titulo: "Barra Superior de Telemetría (Estilo Antigravity Desktop)",
        descripcion:
          "Cabecera global con indicador LED de estado del runner (Workers/Actions), selector de rama activa, acceso directo a la paleta y conmutador rápido de tema.",
      },
      {
        tag: "FEATURE",
        titulo: "Módulo de Tareas Programadas",
        descripcion:
          "Soporte para tareas recurrentes con frecuencias cron (cada hora, diario, nocturno), control de pausa/reanudación y ejecución inmediata.",
      },
      {
        tag: "FEATURE",
        titulo: "Sincronización de Skills en Workspace & Comandos @, $, /",
        descripcion:
          "Sincronización automática de skills (.opencode/skills y skills/) desde el proyecto hacia el workspace clonado de cada tarea, con fallback ante límites de GitHub y reconocimiento de comandos @, $ y / en el chat.",
      },
    ],
  },
  {
    version: "v1.9.0",
    actual: false,
    tipoSemver: "Cambio Mediano (Minor)",
    fecha: "2026-10-15",
    titulo: "GitHub App, Credenciales Temporales y Aislamiento de Sesiones",
    resumen:
      "Infraestructura de alta seguridad para interacción con repositorios mediante GitHub App con permisos acotados, sesiones activas con revocación y cola de mensajes persistente.",
    items: [
      {
        tag: "FEATURE",
        titulo: "Autenticación con GitHub App",
        descripcion:
          "Emisión de tokens efímeros para clonar, subir ramas y crear PRs con verificación previa de permisos.",
        pr: 51,
      },
      {
        tag: "FEATURE",
        titulo: "Aislamiento y Concurrencia de Chats",
        descripcion:
          "Ejecución de hasta diez turnos concurrentes con estado aislado por conversación y serialización de tareas por proyecto.",
        pr: 58,
      },
      {
        tag: "MEJORA",
        titulo: "Cola Persistente de Mensajes",
        descripcion:
          "Cola interactiva con edición, reordenamiento, redirección al compositor y despacho automático.",
        pr: 48,
      },
      {
        tag: "MEJORA",
        titulo: "Sesiones por Dispositivo con Revocación",
        descripcion:
          "Detección de navegadores y dispositivos activos con posibilidad de revocar sesiones sospechosas.",
        pr: 53,
      },
    ],
  },
  {
    version: "v1.8.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-14",
    titulo: "Arquitectura Analizador-Obrero y Aprobación de Planes",
    resumen:
      "Flujo de dos fases para tareas autónomas: el Analizador genera un plan JSON validado y estructurado, el usuario aprueba o solicita ajustes en el compositor, y el Obrero ejecuta de manera aislada.",
    items: [
      {
        tag: "ARQUITECTURA",
        titulo: "Flujo Analizador / Obrero",
        descripcion:
          "Separación estricta de responsabilidades: el analizador no muta archivos y el obrero ejecuta solo lo autorizado.",
        pr: 28,
      },
      {
        tag: "FEATURE",
        titulo: "Aprobación de Plan Integrada en el Compositor",
        descripcion:
          "Acciones de aprobación y rechazo sin cuadros de diálogo secundarios, respondiendo notas directamente en el chat.",
      },
      {
        tag: "FEATURE",
        titulo: "Reportes Estructurados y Diff en Vivo",
        descripcion:
          "Resumen de cambios por archivo, pruebas ejecutadas y diff unificado listo para revisión.",
      },
    ],
  },
  {
    version: "v1.5.0",
    actual: false,
    tipoSemver: "Cambio Mediano (Minor)",
    fecha: "2026-10-13",
    titulo: "Ecosistema Multi-Proveedor, Skills CLI y Codex",
    resumen:
      "Soporte para múltiples proveedores de IA (OpenAI Codex, Groq, NVIDIA, Google Gemini), almacenamiento cifrado de claves en servidor y compatibilidad con el ecosistema de skills de OpenCode.",
    items: [
      {
        tag: "FEATURE",
        titulo: "Inicio de Sesión Codex CLI",
        descripcion:
          "Flujo OAuth Device Code para conectar cuentas de OpenAI sin manipular tokens en texto plano.",
        pr: 34,
      },
      {
        tag: "FEATURE",
        titulo: "Skills CLI y Catálogo de Skills",
        descripcion:
          "Gestión e importación de skills desde repositorios comunitarios e integración en el razonamiento del agente.",
        pr: 34,
      },
      {
        tag: "MEJORA",
        titulo: "Memoria Adaptativa por Proyecto",
        descripcion:
          "Memoria persistente que aprende convenciones y reglas del proyecto entre turnos.",
        pr: 17,
      },
    ],
  },
  {
    version: "v1.0.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-11",
    titulo: "Lanzamiento del Núcleo de Orquestador",
    resumen:
      "Primera versión de la plataforma Orquestador con sandboxing Bubblewrap, base de datos SQLite con migraciones seguras y streaming de eventos en tiempo real.",
    items: [
      {
        tag: "ARQUITECTURA",
        titulo: "Sandboxing Aislado",
        descripcion:
          "Ejecución de procesos del agente restringidos con Bubblewrap sin acceso a variables del sistema.",
        pr: 13,
      },
      {
        tag: "FEATURE",
        titulo: "Streaming SSE y Reactividad",
        descripcion:
          "Canal en vivo de pasos y telemetría de ejecución de agentes.",
        pr: 13,
      },
    ],
  },
];

type Cambio = (typeof cambios.cambios)[number];
type GrupoCambios = { fecha: string; cambios: Cambio[] };

const gruposCambios = [...cambios.cambios]
  .sort((a, b) => b.fecha.localeCompare(a.fecha))
  .reduce<GrupoCambios[]>((grupos, cambio) => {
    let grupo = grupos.at(-1);
    if (!grupo || grupo.fecha !== cambio.fecha) {
      grupo = { fecha: cambio.fecha, cambios: [] };
      grupos.push(grupo);
    }
    grupo.cambios.push(cambio);
    return grupos;
  }, []);

function fechaLegible(fecha: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${fecha}T12:00:00`));
}

function tipoBadgeClase(tag: ReleaseItem["tag"]): string {
  switch (tag) {
    case "FEATURE":
      return "is-feature";
    case "ARQUITECTURA":
      return "is-arquitectura";
    case "MEJORA":
      return "is-mejora";
    case "FIX":
      return "is-fix";
    default:
      return "is-feature";
  }
}

export function HistorialCambios({
  disparador,
  onCerrar,
}: {
  disparador: RefObject<HTMLButtonElement | null>;
  onCerrar: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const [vista, setVista] = useState<"destacadas" | "detalladas">("destacadas");
  const [filtro, setFiltro] = useState("");

  const cerrar = () => {
    disparador.current?.focus();
    onCerrar();
  };

  useDialogo(dialogRef, cerrar);
  useEffect(() => cerrarRef.current?.focus(), []);

  const gruposFiltrados = useMemo(() => {
    if (!filtro.trim()) return gruposCambios;
    const q = filtro.toLowerCase().trim();
    return gruposCambios
      .map((g) => ({
        fecha: g.fecha,
        cambios: g.cambios.filter(
          (c) =>
            c.titulo.toLowerCase().includes(q) ||
            c.tipo.toLowerCase().includes(q) ||
            (c.pr !== null && `pr #${c.pr}`.includes(q)),
        ),
      }))
      .filter((g) => g.cambios.length > 0);
  }, [filtro]);

  return (
    <>
      <div className="tl-cambios-capa" onClick={cerrar} aria-hidden="true" />
      <div
        className="panel tl-cambios-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Historial de cambios"
        aria-labelledby="tl-cambios-titulo"
        ref={dialogRef}
      >
        {/* Cabecera con icono isométrico, título y botón de cierre */}
        <div className="tl-cambios-cabecera">
          <div className="tl-cambios-marca">
            <svg
              className="tl-cambios-icono"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <div className="tl-cambios-titulo-wrap">
              <h2 id="tl-cambios-titulo" className="tl-cambios-titulo">
                Historial de versiones
              </h2>
              <p className="tl-cambios-subtitulo">Registro de novedades y cambios en Cubo</p>
            </div>
          </div>
          <button
            ref={cerrarRef}
            type="button"
            className="tl-cambios-cerrar"
            onClick={cerrar}
            aria-label="Cerrar modal"
            title="Cerrar (Esc)"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Cuerpo desplazable */}
        <div className="tl-cambios-cuerpo" aria-label="Actualizaciones del sistema">
          {/* Tarjeta explicativa SemVer (idéntica a la referencia) */}
          <div className="tl-semver-caja">
            <h3 className="tl-semver-titulo">Control Semántico de Versiones (SemVer):</h3>
            <ul className="tl-semver-lista">
              <li className="tl-semver-item">
                <strong>• Grande (Major):</strong> Cambios mayores de arquitectura o ruptura de compatibilidad.
              </li>
              <li className="tl-semver-item">
                <strong>• Mediano (Minor):</strong> Nuevas funcionalidades, agentes y módulos.
              </li>
              <li className="tl-semver-item">
                <strong>• Mínimo (Patch):</strong> Optimizaciones, seguridad y correcciones.
              </li>
            </ul>
          </div>

          {/* Pestañas para alternar entre versiones destacadas y registro completo */}
          <div className="tl-cambios-pestanas" role="tablist" aria-label="Modo de vista">
            <button
              type="button"
              role="tab"
              aria-selected={vista === "destacadas"}
              className={`tl-cambios-tab${vista === "destacadas" ? " is-activa" : ""}`}
              onClick={() => setVista("destacadas")}
            >
              Versiones destacadas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={vista === "detalladas"}
              className={`tl-cambios-tab${vista === "detalladas" ? " is-activa" : ""}`}
              onClick={() => setVista("detalladas")}
            >
              Registro detallado ({cambios.cambios.length})
            </button>
          </div>

          {vista === "destacadas" ? (
            /* Lista de tarjetas de versión estilo Cubo */
            RELEASES_DESTACADAS.map((rel) => (
              <article
                key={rel.version}
                className={`tl-version-card${rel.actual ? " is-actual" : ""}`}
                aria-label={`Versión ${rel.version}`}
              >
                <div className="tl-version-header">
                  <span className="tl-version-tag">{rel.version}</span>
                  {rel.actual && <span className="tl-badge-actual">ACTUAL</span>}
                  <span className="tl-badge-tipo">{rel.tipoSemver}</span>
                  <span className="tl-version-fecha">{rel.fecha}</span>
                </div>

                <h3 className="tl-version-titulo">{rel.titulo}</h3>
                <p className="tl-version-resumen">{rel.resumen}</p>

                <ul className="tl-version-items">
                  {rel.items.map((item, idx) => (
                    <li key={idx} className="tl-version-item">
                      <span className={`tl-item-tag ${tipoBadgeClase(item.tag)}`}>{item.tag}</span>
                      <div className="tl-item-cuerpo">
                        <strong>{item.titulo}:</strong>
                        <span>{item.descripcion}</span>
                        {item.pr && (
                          <span className="tl-item-pr" title={`Pull Request #${item.pr}`}>
                            PR #{item.pr}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          ) : (
            /* Vista de registro completo cronológico */
            <div className="tl-cambios-detallados-wrap">
              <div className="tl-cambios-filtro-caja">
                <input
                  type="search"
                  className="tl-cambios-filtro"
                  placeholder="Buscar en todos los cambios..."
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  aria-label="Filtrar cambios detallados"
                />
              </div>

              {gruposFiltrados.length === 0 ? (
                <p className="aj-nota" style={{ padding: "16px 0", textAlign: "center" }}>
                  No se encontraron cambios que coincidan con la búsqueda.
                </p>
              ) : (
                gruposFiltrados.map((grupo) => (
                  <section className="tl-cambios-grupo" key={grupo.fecha}>
                    <h4 className="tl-cambios-grupo-fecha">{fechaLegible(grupo.fecha)}</h4>
                    <ul className="tl-cambios-detallados-lista">
                      {grupo.cambios.map((c, idx) => (
                        <li key={idx} className="tl-cambio-detallado">
                          <span
                            className={`tl-item-tag ${
                              c.tipo === "grande"
                                ? "is-arquitectura"
                                : c.tipo === "mediano"
                                ? "is-feature"
                                : "is-fix"
                            }`}
                          >
                            {c.tipo.toUpperCase()}
                          </span>
                          <div className="tl-item-cuerpo">
                            <span>{c.titulo}</span>
                            {c.pr !== null && <span className="tl-item-pr">PR #{c.pr}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
