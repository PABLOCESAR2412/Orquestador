import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

// Misma regla que el servidor: mayúsculas, números y guion bajo; sin prefijo TELO_.
const NOMBRE_VALIDO = /^[A-Z_][A-Z0-9_]{1,63}$/;
const MAX_VALOR = 8_192;

export function nombreSecretoValido(nombre: string): boolean {
  return NOMBRE_VALIDO.test(nombre) && !nombre.startsWith("TELO_");
}

export type ParSecreto = { nombre: string; valor: string };

// Lee un bloque pegado como en Vercel: una línea KEY=VALOR por secreto. Acepta «export», comillas y líneas con #.
// Devuelve los pares válidos y los números de las líneas que no se pudieron leer (sin mostrar su contenido).
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

// Secretos del proyecto. El servidor nunca devuelve sus valores: aquí solo se escriben o se borran.
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
  // El valor viaja por esta referencia y no por las variables de la mutación: así no queda en la caché de React Query.
  const valorEnvio = useRef<string | null>(null);
  // Bloque pegado en varias líneas: el estado solo guarda los nombres; los valores quedan en la referencia hasta guardar o cancelar.
  const [pegado, setPegado] = useState<{ nombres: string[]; omitidas: number[] } | null>(null);
  const paresPegado = useRef<ParSecreto[]>([]);

  const disponible = secretos.data?.disponible ?? false;
  const nombreMal = nombre.length > 0 && !nombreSecretoValido(nombre);

  const refrescar = () => void qc.invalidateQueries({ queryKey: ["project-secrets", id] });

  const guardar = useMutation({
    // Las variables llevan solo el nombre. El valor se toma de la referencia y se borra al enviarlo.
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

  // Guarda los secretos del bloque uno a uno. Si uno falla, la lista se conserva para reintentar: guardar dos veces es seguro.
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
    <section className="panel tarea-seccion" aria-labelledby="proyecto-secretos-titulo">
      <h2 id="proyecto-secretos-titulo">Secretos</h2>
      <p className="muted-note">
        Los agentes de este proyecto reciben cada secreto como variable de entorno. Telo nunca vuelve a mostrar sus valores.
        Para cargar varios a la vez, pega un bloque KEY=VALOR, una línea por secreto, en el campo Nombre.
      </p>

      {secretos.isPending && <p className="muted-note">Cargando los secretos…</p>}
      {secretos.isError && (
        <>
          <p className="error" role="alert">
            {errorText(secretos.error)}
          </p>
          <div>
            <button type="button" className="ghost" onClick={() => void secretos.refetch()}>
              Reintentar
            </button>
          </div>
        </>
      )}

      {secretos.data && !secretos.data.disponible && (
        <p className="error" role="alert">
          El servidor no tiene configurada la clave de cifrado de secretos
        </p>
      )}

      {secretos.data && secretos.data.secretos.length === 0 && (
        <p className="muted-note">Este proyecto todavía no tiene secretos.</p>
      )}

      {secretos.data && secretos.data.secretos.length > 0 && (
        <ul className="secretos-lista" aria-label="Secretos guardados">
          {secretos.data.secretos.map((s) => (
            <li key={s.nombre} className="secreto-fila">
              <div className="secreto-info">
                <span className="secreto-nombre">{s.nombre}</span>
                <span className="muted-note">Actualizado: {cuando(s.actualizado_en)}</span>
              </div>
              <div className="secreto-acciones">
                <button
                  type="button"
                  className="ghost task-mini-btn"
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
                  <div className="programada-confirmar-acciones">
                    <button
                      type="button"
                      className="danger-solid task-mini-btn"
                      disabled={quitar.isPending}
                      onClick={() => quitar.mutate(s.nombre)}
                    >
                      Sí, borrar
                    </button>
                    <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmarNombre(null)}>
                      No
                    </button>
                  </div>
                ) : (
                  <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmarNombre(s.nombre)}>
                    Borrar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmarNombre && (
        <p className="muted-note">
          ¿Borrar {confirmarNombre}? Los agentes dejarán de recibirlo en sus próximas ejecuciones.
        </p>
      )}
      {quitar.isError && (
        <p className="error" role="alert">
          {errorText(quitar.error)}
        </p>
      )}

      {pegado && (
        <div className="secretos-pegado" role="region" aria-label="Secretos pegados, por confirmar">
          <p>
            Se encontraron {pegado.nombres.length} {pegado.nombres.length === 1 ? "secreto" : "secretos"}:{" "}
            <span className="tarea-codigo">{pegado.nombres.join(", ")}</span>. Los valores no se muestran. Los que ya
            existen se reemplazan.
          </p>
          {pegado.omitidas.length > 0 && (
            <p className="muted-note">
              Se omitieron las líneas {pegado.omitidas.join(", ")}: no tienen un nombre válido o un valor.
            </p>
          )}
          {lote.isError && (
            <p className="error" role="alert">
              {errorText(lote.error)}
            </p>
          )}
          <div className="savebar">
            <button type="button" className="ghost" disabled={lote.isPending} onClick={cancelarPegado}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              disabled={!disponible || lote.isPending}
              onClick={() => lote.mutate()}
            >
              {lote.isPending
                ? "Guardando…"
                : pegado.nombres.length === 1
                  ? "Guardar secreto"
                  : `Guardar ${pegado.nombres.length} secretos`}
            </button>
          </div>
        </div>
      )}

      <form
        className="tarea-formulario"
        autoComplete="off"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!disponible || nombreMal || !nombre || !valor || guardar.isPending) return;
          // El valor sale del campo antes de enviarlo: no queda en pantalla ni en el estado.
          valorEnvio.current = valor;
          setValor("");
          guardar.mutate(nombre);
        }}
      >
        <div className="campo">
          <label className="field-label" htmlFor="secreto-nombre">
            Nombre
          </label>
          <input
            id="secreto-nombre"
            className="text-input tarea-campo-ancho"
            placeholder="GITHUB_TOKEN"
            maxLength={64}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onPaste={(e) => {
              // Un bloque KEY=VALOR se reparte entre los campos (o se confirma si son varios). Otro texto se pega tal cual.
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
            aria-describedby="secreto-nombre-ayuda"
            aria-invalid={nombreMal}
          />
          <p id="secreto-nombre-ayuda" className={nombreMal ? "error" : "muted-note"}>
            {nombreMal
              ? "Usa solo mayúsculas, números y guion bajo, y no empieces con TELO_."
              : "Mayúsculas, números y guion bajo. No puede empezar con TELO_."}
          </p>
        </div>

        <div className="campo">
          <label className="field-label" htmlFor="secreto-valor">
            Valor
          </label>
          <input
            id="secreto-valor"
            ref={valorRef}
            className="text-input tarea-campo-ancho"
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_VALOR}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            disabled={!disponible}
            aria-describedby="secreto-valor-ayuda"
          />
          <p id="secreto-valor-ayuda" className="muted-note">
            Se guarda cifrado. Al guardar, el campo se vacía.
          </p>
        </div>

        {guardar.isError && (
          <p className="error" role="alert">
            {errorText(guardar.error)}
          </p>
        )}

        <div className="savebar">
          <button
            type="submit"
            className="primary"
            disabled={!disponible || nombre.length === 0 || nombreMal || valor.length === 0 || guardar.isPending}
          >
            {guardar.isPending ? "Guardando…" : "Guardar secreto"}
          </button>
        </div>
      </form>
    </section>
  );
}
