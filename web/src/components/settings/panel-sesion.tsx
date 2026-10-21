import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { LoadingSkeleton } from "../loading-skeleton";
import { errorText } from "../../lib/model";

export function SesionPanel() {
  const qc = useQueryClient();
  const [saliendo, setSaliendo] = useState(false);
  const sesiones = useQuery({ queryKey: ["sesiones"], queryFn: api.listSessions });
  const refrescar = () => void qc.invalidateQueries({ queryKey: ["sesiones"] });

  const revocar = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: refrescar,
  });

  const cerrarOtras = useMutation({
    mutationFn: () => api.closeOtherSessions(),
    onSuccess: refrescar,
  });

  const salir = async () => {
    setSaliendo(true);
    try {
      await api.logout();
    } finally {
      location.assign("/entrar");
    }
  };

  const lista = sesiones.data ?? [];
  const otras = lista.filter((s) => !s.actual);

  return (
    <article className="aj-tarjeta" aria-labelledby="ajustes-sesion">
      <div className="aj-tarjeta-cabecera" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div>
          <h3 id="ajustes-sesion" className="aj-tarjeta-titulo-simple">
            Dispositivos y sesiones activas
          </h3>
          <p className="aj-nota">
            Sesiones autenticadas en este u otros dispositivos. Puedes revocar el acceso a cualquier equipo en caso de pérdida o renovación.
          </p>
        </div>
        {otras.length > 0 && (
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: "12px", whiteSpace: "nowrap" }}
            disabled={cerrarOtras.isPending}
            onClick={() => cerrarOtras.mutate()}
          >
            {cerrarOtras.isPending ? "Cerrando…" : "Cerrar demás sesiones"}
          </button>
        )}
      </div>

      {sesiones.isLoading && !sesiones.data && <LoadingSkeleton tipo="lineas" cantidad={3} />}
      {sesiones.isError && <p className="aj-error" role="alert">{errorText(sesiones.error)}</p>}

      {lista.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px", marginBottom: "16px" }}>
          {lista.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius)",
                background: s.actual ? "var(--surface-hover)" : "var(--surface)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>{s.actual ? "Este dispositivo (sesión actual)" : "Dispositivo conectado"}</strong>
                  {s.actual && (
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "1px 6px",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--signal-soft)",
                        color: "var(--signal)",
                        border: "1px solid var(--signal-line)",
                      }}
                    >
                      Actual
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "12px", color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.user_agent ? s.user_agent.slice(0, 90) : "Navegador web"}
                </span>
                <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>
                  {s.ip ? `IP: ${s.ip} · ` : ""}Última actividad: {new Date(s.last_seen_at).toLocaleString("es")}
                </span>
              </div>
              <div>
                {!s.actual && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ color: "var(--danger)", fontSize: "12px", padding: "4px 8px" }}
                    disabled={revocar.isPending}
                    onClick={() => revocar.mutate(s.id)}
                  >
                    Revocar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="aj-acciones" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--line)" }}>
        <button type="button" className="aj-btn sesion-salir" onClick={() => void salir()} disabled={saliendo}>
          {saliendo ? "Cerrando sesión…" : "Cerrar sesión en este navegador"}
        </button>
      </div>
    </article>
  );
}
