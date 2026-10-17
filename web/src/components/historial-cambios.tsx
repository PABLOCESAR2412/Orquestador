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
    version: `v${VERSION_SISTEMA}`,
    actual: true,
    tipoSemver: "Cambio Mediano (Minor)",
    fecha: "2026-10-16",
    titulo: "Múltiples chats por proyecto, chats libres independientes y optimizaciones de sistema",
    resumen:
      "Soporte integral para múltiples conversaciones independientes dentro de cada proyecto y chats libres fuera de proyectos. Monitorización de cuota de Gemini en vivo, métricas segmentadas en analítica y nuevo historial de versiones alineado a Telo.",
    items: [
      {
        tag: "FEATURE",
        titulo: "Múltiples chats por proyecto",
        descripcion:
          "Cada proyecto puede albergar múltiples conversaciones simultáneas, compartiendo el workspace, las instrucciones y la memoria del proyecto.",
      },
      {
        tag: "FEATURE",
        titulo: "Chats libres independientes",
        descripcion:
          "Creación de chats rápidos sin vincular a ningún proyecto, con workspace aislado por conversación y distinción visual permanente en la barra lateral.",
      },
      {
        tag: "FEATURE",
        titulo: "Botón multifunción + Nuevo",
        descripcion:
          "Menú desplegable en la barra lateral para crear rápidamente un proyecto, un chat libre o un chat adicional dentro del proyecto activo.",
      },
      {
        tag: "FEATURE",
        titulo: "Monitorización de cuota de Google Gemini en vivo",
        descripcion:
          "Consulta y estimación en tiempo real del límite diario (1.500 RPD) y por minuto (15 RPM), con desglose de porcentaje restante y alertas preventivas.",
      },
      {
        tag: "MEJORA",
        titulo: "Segmentación en analítica",
        descripcion:
          "Diferenciación de métricas de modelos y agentes externos frente al consumo del propio sistema Telo, con agregación por modelo.",
      },
      {
        tag: "ARQUITECTURA",
        titulo: "Resiliencia SSE e índices de base de datos",
        descripcion:
          "Reconexión SSE transparente con Last-Event-ID, rate limiting por IP, modularización de ajustes y sesiones dinámicas por dispositivo.",
      },
    ],
  },
  {
    version: "v10.6.0",
    actual: false,
    tipoSemver: "Cambio Mediano (Minor)",
    fecha: "2026-10-16",
    titulo: "Metodología Gauntlet para Telo, plantillas de proyecto y Git asistido",
    resumen:
      "Incorporación nativa de la metodología Gauntlet para diseño de sistemas, plantillas de inicio rápido para proyectos y flujo asistido de Git con aprobación de PR y merge.",
    items: [
      {
        tag: "FEATURE",
        titulo: "Metodología Gauntlet nativa en Telo",
        descripcion:
          "Directrices estructuradas para análisis por capas, verificación rigurosa y plantillas para creación de sistemas, páginas web y módulos.",
      },
      {
        tag: "FEATURE",
        titulo: "Flujo asistido de Git y Pull Requests",
        descripcion:
          "Autorización y revisión de commits, subida a ramas de trabajo y merge asistido desde la propia interfaz de Telo.",
      },
      {
        tag: "MEJORA",
        titulo: "Bloques de código enriquecidos y referencias visuales",
        descripcion:
          "Soporte mejorado de Markdown con diagramas Mermaid, tablas estructuradas y referencias interactivas a archivos modificados.",
      },
    ],
  },
  {
    version: "v10.0.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-15",
    titulo: "Sesiones dinámicas por dispositivo con revocación y propuestas de memoria",
    resumen:
      "Arquitectura de sesiones activas por dispositivo con revocación inmediata, propuestas de memoria contextuales sin dependencias externas y modularización del motor de chat.",
    items: [
      {
        tag: "ARQUITECTURA",
        titulo: "Sesiones dinámicas por dispositivo",
        descripcion:
          "Registro y visualización de dispositivos conectados con capacidad de revocación remota en tiempo real.",
      },
      {
        tag: "FEATURE",
        titulo: "Propuestas de memoria autónomas",
        descripcion:
          "Detección y sugerencia de aprendizajes clave y convenciones del proyecto para persistencia en memoria.",
      },
      {
        tag: "ARQUITECTURA",
        titulo: "Modularización del motor de chat",
        descripcion:
          "Separación del despachador de turnos, aislamiento de procesos y gestión reactiva de cuotas agotadas.",
      },
    ],
  },
  {
    version: "v9.0.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-14",
    titulo: "GitHub App, credenciales seguras y aislamiento de ramas",
    resumen:
      "Emisión de credenciales temporales mediante GitHub App con verificación previa de permisos, ramas de trabajo aisladas por tarea y gestión segura de secretos.",
    items: [
      {
        tag: "ARQUITECTURA",
        titulo: "Autenticación segura con GitHub App",
        descripcion:
          "Tokens de instalación acotados para clonado y operaciones de repositorio sin exponer claves personales.",
        pr: 51,
      },
      {
        tag: "FEATURE",
        titulo: "Aprobación de commit y push",
        descripcion:
          "Verificación visual de diffs antes de registrar cambios en el repositorio con bloqueo de secretos sensibles.",
        pr: 14,
      },
    ],
  },
  {
    version: "v8.0.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-13",
    titulo: "Arquitectura Analizador-Obrero y reportes estructurados",
    resumen:
      "Flujo de dos fases para tareas autónomas de Telo: el Analizador genera un plan validado, el usuario autoriza la ejecución y el Obrero ejecuta de forma aislada entregando un reporte verificable.",
    items: [
      {
        tag: "ARQUITECTURA",
        titulo: "Separación Analizador / Obrero",
        descripcion:
          "El analizador no modifica archivos; el obrero trabaja estrictamente dentro de su workspace clonado.",
        pr: 28,
      },
      {
        tag: "FEATURE",
        titulo: "Planes estructurados y reportes",
        descripcion:
          "Aprobación o revisión de pasos de tarea, con trazabilidad de cambios, pruebas ejecutadas y diffs unificados.",
        pr: 28,
      },
    ],
  },
  {
    version: "v5.0.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-13",
    titulo: "Actualización automática de Telo y tareas de fondo con systemd",
    resumen:
      "Supervisión y actualización continua de Telo desde la rama main mediante temporizadores de systemd y tareas programadas en segundo plano.",
    items: [
      {
        tag: "FEATURE",
        titulo: "Actualizador continuo con systemd",
        descripcion:
          "Descarga y despliegue automático de versiones desde la rama principal sin pérdida de estado.",
        pr: 22,
      },
      {
        tag: "FEATURE",
        titulo: "Tareas programadas",
        descripcion:
          "Ejecución autónoma y periódica de tareas configuradas por proyecto o globales.",
        pr: 14,
      },
    ],
  },
  {
    version: "v1.0.0",
    actual: false,
    tipoSemver: "Cambio Grande (Major)",
    fecha: "2026-10-11",
    titulo: "Lanzamiento del Núcleo de Telo",
    resumen:
      "Primera versión del orquestador de agentes Telo: sandboxing seguro con Bubblewrap, colas reactivas con SQLite y streaming en tiempo real.",
    items: [
      {
        tag: "ARQUITECTURA",
        titulo: "Aislamiento de agentes con Bubblewrap",
        descripcion:
          "Ejecución de agentes dentro de contenedores efímeros sin acceso a secretos ni variables globales del servidor.",
        pr: 13,
      },
      {
        tag: "FEATURE",
        titulo: "Streaming SSE reactivo",
        descripcion:
          "Recepción en vivo de pasos de razonamiento, comandos y eventos de ejecución.",
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
              <p className="tl-cambios-subtitulo">Registro de novedades y mejoras de Telo</p>
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
          {/* Tarjeta explicativa SemVer según las reglas de Telo */}
          <div className="tl-semver-caja">
            <h3 className="tl-semver-titulo">Control Semántico de Versiones (SemVer) de Telo:</h3>
            <ul className="tl-semver-lista">
              <li className="tl-semver-item">
                <strong>• Grande (Major):</strong> Arquitectura, seguridad, aislamiento, base de datos y migraciones.
              </li>
              <li className="tl-semver-item">
                <strong>• Mediano (Minor):</strong> Nuevos módulos, habilidades, plantillas e integraciones.
              </li>
              <li className="tl-semver-item">
                <strong>• Mínimo (Patch):</strong> Optimizaciones, interfaz, rendimiento y correcciones.
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
