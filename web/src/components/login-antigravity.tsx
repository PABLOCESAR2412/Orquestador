import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText, motivoTexto } from "../lib/model";
import { copiarTexto } from "./chat-contenido";

export function LoginAntigravityPanel() {
  const qc = useQueryClient();
  const clave = ["antigravity-login"];
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const estado = useQuery({
    queryKey: clave,
    queryFn: api.antigravityLogin,
    refetchInterval: (consulta) => consulta.state.data?.estado === "esperando" || consulta.state.data?.estado === "verificando" ? 1_500 : false,
  });
  const iniciar = useMutation({
    mutationFn: api.iniciarAntigravityLogin,
    onSuccess: (datos) => {
      setCodigo("");
      setAviso(null);
      qc.setQueryData(clave, datos);
    },
    onError: (error) => setAviso(errorText(error)),
  });
  const confirmar = useMutation({
    mutationFn: api.enviarCodigoAntigravity,
    onSuccess: (datos) => {
      setCodigo("");
      setAviso("Código enviado. Telo espera la confirmación del CLI.");
      qc.setQueryData(clave, datos);
    },
    onError: (error) => setAviso(errorText(error)),
  });
  const cancelar = useMutation({
    mutationFn: api.cancelarAntigravityLogin,
    onSuccess: (datos) => {
      setAviso("Inicio de sesión cancelado.");
      qc.setQueryData(clave, datos);
    },
    onError: (error) => setAviso(errorText(error)),
  });

  const datos = estado.data;
  useEffect(() => {
    if (!datos?.conectada) return;
    void qc.invalidateQueries({ queryKey: ["providers"] });
    void qc.invalidateQueries({ queryKey: ["models"] });
  }, [datos?.conectada, qc]);
  const ocupado = iniciar.isPending || confirmar.isPending || cancelar.isPending || datos?.estado === "verificando";
  const enCurso = datos?.estado === "esperando" || datos?.estado === "verificando";
  const puedeIniciar = datos?.estado !== "esperando" && datos?.estado !== "verificando";

  return (
    <div className="login-antigravity">
      <p className="aj-nota">
        Telo abre la terminal remota de Antigravity, muestra el enlace seguro de Google y recibe aquí el código de autorización.
        Las credenciales permanecen en el servidor.
      </p>
      {datos?.conectada && <p className="aj-nota" role="status">Sesión de Antigravity verificada con <code>/usage</code> y accesible desde el servicio.</p>}
      {datos && !datos.conectada && datos.estado === "inactivo" && (
        <p className="aj-nota" role="status">Sesión no comprobada. Inicia el flujo para autorizar Antigravity desde Telo.</p>
      )}

      {enCurso && (
        <div className="login-antigravity-paso" role="status">
          {datos.url ? (
            <>
              <a className="login-codex-enlace" href={datos.url} target="_blank" rel="noopener noreferrer">Abrir autorización de Google</a>
              <code className="aj-mono login-antigravity-url">{datos.url}</code>
              <button type="button" className="aj-btn" onClick={async () => {
                setAviso(await copiarTexto(datos.url!) ? "Enlace copiado." : "No se pudo copiar el enlace.");
              }}>Copiar enlace</button>
              <label className="aj-campo" htmlFor="antigravity-codigo">
                <span className="aj-campo-etiqueta">Código que aparece en Google</span>
                <input
                  id="antigravity-codigo"
                  className="aj-input aj-mono"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={128}
                  value={codigo}
                  disabled={ocupado || datos.estado !== "esperando"}
                  onChange={(event) => setCodigo(event.target.value)}
                />
              </label>
              <div className="instalar-acciones">
                <button type="button" className="aj-btn aj-btn-primario" disabled={!codigo.trim() || ocupado} onClick={() => confirmar.mutate(codigo)}>
                  {confirmar.isPending || datos.estado === "verificando" ? "Comprobando…" : "Enviar código"}
                </button>
                <button type="button" className="aj-btn" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar</button>
              </div>
            </>
          ) : <p className="aj-nota">Esperando el enlace de autorización…</p>}
        </div>
      )}

      {datos?.estado === "fallido" && <p className="aj-nota aj-nota-aviso" role="alert">{motivoTexto(datos.motivo)}</p>}
      {estado.isError && <p className="aj-error" role="alert">{errorText(estado.error)}</p>}
      {aviso && <p className="aj-nota" role="status">{aviso}</p>}
      {puedeIniciar && (
        <button type="button" className="aj-btn aj-btn-primario" disabled={iniciar.isPending || estado.isPending} onClick={() => iniciar.mutate()}>
          {iniciar.isPending ? "Iniciando…" : datos?.conectada ? "Volver a iniciar sesión" : "Iniciar sesión con Google"}
        </button>
      )}
      <details className="login-antigravity-manual">
        <summary>Comando para iniciar sesión por SSH</summary>
        <div className="instalar-acciones">
          <code className="aj-mono">~/.local/bin/agy</code>
          <button type="button" className="aj-btn" onClick={async () => {
            setAviso(await copiarTexto("~/.local/bin/agy") ? "Comando copiado." : "No se pudo copiar el comando.");
          }}>Copiar comando</button>
        </div>
      </details>
      <p className="aj-nota">Telo revalida la sesión al consultar <code>/usage</code>. La autorización permanece en Secret Service del usuario del servicio.</p>
    </div>
  );
}
