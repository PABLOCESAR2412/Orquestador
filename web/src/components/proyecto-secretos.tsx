import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";

const NOMBRE_VALIDO = /^[A-Z_][A-Z0-9_]{1,63}$/;
const MAX_VALOR = 8_192;

export function nombreSecretoValido(nombre: string): boolean {
  return NOMBRE_VALIDO.test(nombre) && !nombre.startsWith("TELO_");
}

export type ParSecreto = { nombre: string; valor: string };

export function parsearPegado(texto: string): { pares: ParSecreto[]; omitidas: number[] } {
  const pares: ParSecreto[] = [];
  const omitidas: number[] = [];
  texto.split(/\r?\n/).forEach((crudo, i) => {
    const linea = crudo.trim();
    if (!linea || linea.startsWith("#")) return;
    const sinExport = linea.replace(/^export\s+/, "");
    const corte = sinExport.indexOf("=");
    if (corte <= 0) {
      omitidas.push(i + 1);
      return;
    }
    const nombre = sinExport.slice(0, corte).trim();
    let valor = sinExport.slice(corte + 1).trim();
    const comilla = valor.charAt(0);
    if (valor.length >= 2 && (comilla === '"' || comilla === "'") && valor.endsWith(comilla)) {
      valor = valor.slice(1, -1);
    }
    if (!nombreSecretoValido(nombre) || valor === "" || valor.length > MAX_VALOR) {
      omitidas.push(i + 1);
      return;
    }
    pares.push({ nombre, valor });
  });
  return { pares, omitidas };
}

export function ProyectoSecretos({ id }: { id: string }) {
  const qc = useQueryClient();
  const secretos = useQuery({
    queryKey: ["project-secrets", id],
    queryFn: () => api.listProjectSecrets(id),
  });

  const [nombre, setNombre] = useState("");
  const [valor, setValor] = useState("");
  const [confirmarNombre, setConfirmarNombre] = useState<string | null>(null);
  const valorRef = useRef<HTMLInputElement>(null);
  const valorEnvio = useRef<string | null>(null);
  const [pegado, setPegado] = useState<{ nombres: string[]; omitidas: number[] } | null>(null);
  const paresPegado = useRef<ParSecreto[]>([]);

  const disponible = secretos.data?.disponible ?? false;
  const nombreMal = nombre.length > 0 && !nombreSecretoValido(nombre);

  const refrescar = () => void qc.invalidateQueries({ queryKey: ["project-secrets", id] });

  const guardar = useMutation({
    mutationFn: (nombreSecreto: string) => {
      const enviar = valorEnvio.current ?? "";
      valorEnvio.current = null;
      return api.setProjectSecret(id, nombreSecreto, enviar);
    },
    onSuccess: () => {
      setNombre("");
      refrescar();
    },
  });

  const lote = useMutation({
    mutationFn: async () => {
      for (const par of paresPegado.current) {
        await api.setProjectSecret(id, par.nombre, par.valor);
      }
    },
    onSuccess: () => {
      paresPegado.current = [];
      setPegado(null);
      refrescar();
    },
  });

  const cancelarPegado = () => {
    paresPegado.current = [];
    setPegado(null);
    lote.reset();
  };

  const quitar = useMutation({
    mutationFn: (n: string) => api.deleteProjectSecret(id, n),
    onSettled: () => {
      setConfirmarNombre(null);
      refrescar();
    },
  });

  return (
    <section className="panel" aria-labelledby="proyecto-secretos-titulo">
      <h2 id="proyecto-secretos-titulo" className="panel-title">
        Secretos
      </h2>
      <p className="help-note">
        Variables de entorno inyectadas en las tareas del proyecto. Los valores guardados nunca se muestran.
      </p>

      {secretos.isPending && <p className="help-note">Cargando los secretos…</p>}
      {secretos.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(secretos.error)}</span>
          <button type="button" className="btn-ghost" onClick={() => void secretos.refetch()}>
            Reintentar
          </button>
        </div>
      )}

      {secretos.data && !secretos.data.disponible && (
        <div className="error-box" role="alert">
          <span className="error-text">
            El servidor no tiene configurada la clave de cifrado de secretos
          </span>
        </div>
      )}

      {secretos.data && secretos.data.secretos.length === 0 && (
        <p className="help-note">Este proyecto todavía no tiene secretos.</p>
      )}

      {secretos.data && secretos.data.secretos.length > 0 && (
        <div className="secrets-group">
          {secretos.data.secretos.map((s) => (
            <div key={s.nombre} className="secret-item">
              <span className="secret-key">{s.nombre}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="secret-masked">••••••••••••••••••••</span>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  disabled={!disponible}
                  onClick={() => {
                    setNombre(s.nombre);
                    setValor("");
                    valorRef.current?.focus();
                  }}
                >
                  Reemplazar
                </button>
                {confirmarNombre === s.nombre ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ background: "var(--danger)", color: "#fff", padding: "4px 8px", fontSize: 12 }}
                      disabled={quitar.isPending}
                      onClick={() => quitar.mutate(s.nombre)}
                    >
                      Sí
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                      onClick={() => setConfirmarNombre(null)}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 12, color: "var(--danger)" }}
                    onClick={() => setConfirmarNombre(s.nombre)}
                  >
                    Borrar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pegado && (
        <div className="error-box" style={{ background: "var(--surface)", border: "1px solid var(--line)", flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink)" }}>
            Se encontraron {pegado.nombres.length} secretos:{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{pegado.nombres.join(", ")}</span>. Los valores no se muestran.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-ghost" disabled={lote.isPending} onClick={cancelarPegado}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!disponible || lote.isPending}
              onClick={() => lote.mutate()}
            >
              {lote.isPending ? "Guardando…" : `Guardar ${pegado.nombres.length} secretos`}
            </button>
          </div>
        </div>
      )}

      <form
        className="form-group"
        autoComplete="off"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!disponible || nombreMal || !nombre || !valor || guardar.isPending) return;
          valorEnvio.current = valor;
          setValor("");
          guardar.mutate(nombre);
        }}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="secreto-nombre">
            Nombre del secreto
          </label>
          <input
            id="secreto-nombre"
            className="input-text"
            placeholder="GITHUB_TOKEN"
            maxLength={64}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onPaste={(e) => {
              const texto = e.clipboardData.getData("text");
              if (!texto.includes("=")) return;
              const { pares, omitidas } = parsearPegado(texto);
              if (pares.length === 0) return;
              e.preventDefault();
              if (pares.length === 1 && omitidas.length === 0) {
                paresPegado.current = [];
                setPegado(null);
                setNombre(pares[0].nombre);
                setValor(pares[0].valor);
                return;
              }
              paresPegado.current = pares;
              setPegado({ nombres: pares.map((p) => p.nombre), omitidas });
              setNombre("");
              setValor("");
            }}
            disabled={!disponible}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="secreto-valor">
            Valor
          </label>
          <input
            id="secreto-valor"
            ref={valorRef}
            className="input-text"
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_VALOR}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            disabled={!disponible}
          />
        </div>

        {guardar.isError && (
          <div className="error-box" role="alert">
            <span className="error-text">{errorText(guardar.error)}</span>
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          style={{ marginTop: 8 }}
          disabled={!disponible || nombre.length === 0 || nombreMal || valor.length === 0 || guardar.isPending}
        >
          {guardar.isPending ? "Guardando…" : "Guardar secreto"}
        </button>
      </form>
    </section>
  );
}
