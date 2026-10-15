import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type LoginCodex } from "../api";
import { errorText, motivoTexto } from "../lib/model";

// Inicio de sesión de Codex con la cuenta de ChatGPT. Lo ejecuta el servidor: aquí solo se ven el enlace y el
// código que imprime el CLI. El token nunca llega a la app, y la sesión solo se comprueba por su existencia.
export function LoginCodexPanel() {
  const qc = useQueryClient();
  const clave = ["codex-login"];
  const [mensajeConfirmacion, setMensajeConfirmacion] = useState<string | null>(null);
  const [mostrarDetalles, setMostrarDetalles] = useState(false);

  const estado = useQuery({
    queryKey: clave,
    queryFn: api.codexLogin,
    refetchInterval: (consulta) => (consulta.state.data?.estado === "esperando" ? 2_000 : false),
  });
  const modelos = useQuery({
    queryKey: ["codex-models"],
    queryFn: api.codexModels,
    enabled: mostrarDetalles && Boolean(estado.data?.conectada),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const iniciar = useMutation({
    mutationFn: api.iniciarCodexLogin,
    onSuccess: (datos: LoginCodex) => {
      setMensajeConfirmacion(null);
      qc.setQueryData(clave, datos);
    },
  });
  const cancelar = useMutation({
    mutationFn: api.cancelarCodexLogin,
    onSuccess: (datos: LoginCodex) => {
      setMensajeConfirmacion(null);
      qc.setQueryData(clave, datos);
    },
  });
  const confirmar = useMutation({
    mutationFn: api.confirmarCodexLogin,
    onSuccess: (datos: LoginCodex) => {
      qc.setQueryData(clave, datos);
      if (datos.conectada) {
        setMensajeConfirmacion("¡Sesión detectada y confirmada en el servidor!");
      } else {
        setMensajeConfirmacion(
          "Aún no detectamos la sesión en el servidor. Si ya completaste la autorización en tu navegador, espera unos segundos y vuelve a pulsar «Ya lo hice»."
        );
      }
    },
    onError: (err) => {
      setMensajeConfirmacion(errorText(err));
    },
  });

  const datos = estado.data;
  const esperando = datos?.estado === "esperando";
  const conectada = Boolean(datos?.conectada && !esperando);
  const error = iniciar.error ?? cancelar.error ?? (estado.isError ? estado.error : null);

  return (
    <div className="login-codex">
      <p className="aj-nota">
        Se inicia en el servidor. Abre el enlace en tu navegador, escribe el código y vuelve aquí.
      </p>

      {conectada && (
        <p className="aj-nota" role="status" style={{ color: "var(--accent)" }}>
          Sesión iniciada en el servidor.
        </p>
      )}

      {conectada && (
        <button type="button" className="aj-btn" aria-expanded={mostrarDetalles} onClick={() => setMostrarDetalles((v) => !v)}>
          {mostrarDetalles ? "Ocultar sesión y modelos" : "Mostrar sesión y modelos"}
        </button>
      )}

      {conectada && mostrarDetalles && (
        <section className="login-codex-modelos" aria-labelledby="login-codex-modelos-titulo">
          <div className="aj-tarjeta-cabecera">
            <h4 id="login-codex-modelos-titulo" className="aj-tarjeta-titulo-simple">Modelos disponibles en Codex</h4>
            <button type="button" className="aj-texto-btn" onClick={() => void modelos.refetch()} disabled={modelos.isFetching}>
              {modelos.isFetching ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
          <p className="aj-nota">Catálogo de la sesión de ChatGPT. Las tareas de Telo todavía se ejecutan con OpenCode.</p>
          {modelos.isPending && <p className="aj-nota">Consultando modelos de Codex…</p>}
          {modelos.isError && <p className="aj-error" role="alert">{errorText(modelos.error)}</p>}
          {modelos.data && modelos.data.models.length === 0 && <p className="aj-nota">Codex no devolvió modelos disponibles.</p>}
          {modelos.data && modelos.data.models.length > 0 && (
            <ul className="login-codex-lista" aria-label="Modelos disponibles en Codex">
              {modelos.data.models.map((modelo) => (
                <li key={modelo.id}>
                  <span><strong>{modelo.name}</strong><small>{modelo.id}</small></span>
                  {modelo.context > 0 && <span className="aj-mono">{modelo.context.toLocaleString("es")} tokens</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {esperando && (
        <div className="login-codex-paso" role="status">
          {datos?.url ? (
            <a className="login-codex-enlace" href={datos.url} target="_blank" rel="noopener noreferrer">
              {datos.url}
            </a>
          ) : (
            <p className="aj-nota">Esperando el enlace del CLI…</p>
          )}
          {datos?.codigo && (
            <p className="aj-nota">
              Código: <span className="login-codex-codigo">{datos.codigo}</span>
            </p>
          )}
          <div className="instalar-acciones">
            <button
              type="button"
              className="aj-btn aj-btn-primario"
              disabled={confirmar.isPending}
              onClick={() => {
                setMensajeConfirmacion(null);
                confirmar.mutate();
              }}
            >
              {confirmar.isPending ? "Comprobando…" : "Ya lo hice"}
            </button>
            <button type="button" className="aj-btn" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
              Cancelar
            </button>
          </div>
          {mensajeConfirmacion && (
            <p className="aj-nota aj-nota-aviso" role="status" style={{ marginTop: 8 }}>
              {mensajeConfirmacion}
            </p>
          )}
          {datos?.salida && (
            <details style={{ marginTop: 12, fontSize: 13 }}>
              <summary style={{ cursor: "pointer", opacity: 0.85 }}>Ver salida del terminal</summary>
              <pre className="aj-registros-texto" style={{ marginTop: 6 }}>{datos.salida}</pre>
            </details>
          )}
        </div>
      )}

      {datos?.estado === "fallido" && (
        <>
          <p className="aj-nota aj-nota-aviso" role="alert">
            {motivoTexto(datos.motivo)}
          </p>
          {datos.salida && <pre className="aj-registros-texto">{datos.salida}</pre>}
        </>
      )}
      {error && (
        <p className="aj-error" role="alert">
          {errorText(error)}
        </p>
      )}

      {!esperando && (!conectada || mostrarDetalles) && (
        <button
          type="button"
          className="aj-btn aj-btn-primario"
          disabled={iniciar.isPending}
          onClick={() => iniciar.mutate()}
        >
          {datos?.conectada ? "Volver a iniciar sesión" : "Iniciar sesión"}
        </button>
      )}
    </div>
  );
}
