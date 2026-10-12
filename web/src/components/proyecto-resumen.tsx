import type { ProjectDetail } from "../api";
import { formatBytes } from "./tarea-formato";

// Resumen del proyecto: tarjetas Stitch (Estado del repo, Tareas, Agente / Tamaño).
export function ProyectoResumen({ detalle }: { detalle: ProjectDetail }) {
  const { git, tareas, chats, tamano_bytes: tamano } = detalle;

  const repoEstado = git
    ? `git:${git.rama} (${git.sucio ? "con cambios" : "limpio"})`
    : "Sin Git";

  return (
    <section className="panel" aria-labelledby="proyecto-resumen-titulo">
      <h2 id="proyecto-resumen-titulo" className="panel-title">
        Resumen del proyecto
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div style={{ background: "var(--surface-lowest)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <span className="help-note" style={{ display: "block", marginBottom: 4 }}>
            Estado del repositorio
          </span>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{repoEstado}</span>
        </div>

        <div style={{ background: "var(--surface-lowest)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <span className="help-note" style={{ display: "block", marginBottom: 4 }}>
            Tareas ejecutadas
          </span>
          <span style={{ fontWeight: 600, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>
            {tareas.total} {tareas.total === 1 ? "tarea" : "tareas"}
          </span>
        </div>

        <div style={{ background: "var(--surface-lowest)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <span className="help-note" style={{ display: "block", marginBottom: 4 }}>
            Chats y almacenamiento
          </span>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {chats} chats · {formatBytes(tamano)}
          </span>
        </div>
      </div>
    </section>
  );
}
