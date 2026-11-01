import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText, motivoTexto } from "../lib/model";

type Props = {
  // Herramienta que el servidor sabe instalar (ACCIONES en server/src/instalacion.ts).
  id: string;
  // Nombre que ve la persona, por ejemplo "OpenCode" o "Codex".
  nombre: string;
  // Se muestra solo cuando el CLI ya está instalado, por ejemplo el inicio de sesión.
  children?: ReactNode;
};

// Instalación de un CLI desde Ajustes. Primero se muestra el comando; después se pide confirmar.
// El servidor vuelve a exigir la confirmación y ejecuta solo su comando fijo.
export function InstalarHerramienta({ id, nombre, children }: Props) {
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const clave = ["instalacion", id];

  const estado = useQuery({
    queryKey: clave,
    queryFn: () => api.herramientaInstalacion(id),
    refetchInterval: (consulta) => (consulta.state.data?.estado === "instalando" ? 2_000 : false),
  });

  const instalar = useMutation({
    mutationFn: () => api.instalarHerramienta(id),
    onSuccess: () => {
      setConfirmando(false);
      void qc.invalidateQueries({ queryKey: clave });
    },
  });

  const datos = estado.data;
  const instalando = datos?.estado === "instalando" || instalar.isPending;

  // Al terminar bien, el selector y los proveedores deben reflejar el CLI nuevo sin recargar la página.
  useEffect(() => {
    if (datos?.estado === "lista") {
      void qc.invalidateQueries({ queryKey: ["providers"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    }
  }, [datos?.estado, qc]);

  if (estado.isPending) return <p className="aj-nota">Consultando la instalación…</p>;
  if (estado.isError) return <p className="aj-error" role="alert">{errorText(estado.error)}</p>;

  // Ya instalado y sin instalación en curso: solo queda lo que depende del CLI.
  if (datos?.instalada && !instalando) return children ? <>{children}</> : null;

  return (
    <div className="instalar">
      {instalando && (
        <p className="aj-nota" role="status">
          Instalando {nombre}. Puede tardar un par de minutos; esta página se actualiza sola.
        </p>
      )}
      {datos?.estado === "error" && (
        <>
          <p className="aj-nota aj-nota-aviso" role="alert">
            {motivoTexto(datos.motivo)}
          </p>
          {datos.salida && <pre className="aj-registros-texto">{datos.salida}</pre>}
        </>
      )}
      {instalar.isError && (
        <p className="aj-error" role="alert">
          {errorText(instalar.error)}
        </p>
      )}

      {!confirmando ? (
        <button
          type="button"
          className="aj-btn aj-btn-primario"
          disabled={instalando}
          onClick={() => setConfirmando(true)}
        >
          Instalar {nombre}
        </button>
      ) : (
        <div className="instalar-confirmar" role="group" aria-label={`Confirmar instalación de ${nombre}`}>
          <p className="aj-nota">
            Se ejecutará en el servidor el comando <code className="aj-mono">{datos?.comando}</code>. Tarda uno o dos
            minutos y necesita {id === "antigravity" || id === "hermes" ? "curl y bash" : "npm instalado en la VM"}.
          </p>
          <div className="instalar-acciones">
            <button
              type="button"
              className="aj-btn aj-btn-primario"
              disabled={instalar.isPending}
              onClick={() => instalar.mutate()}
            >
              {instalar.isPending ? "Iniciando…" : "Sí, instalar"}
            </button>
            <button type="button" className="aj-btn" disabled={instalar.isPending} onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
