import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type UsoProveedor } from "../api";
import { errorText, formatUsd } from "../lib/model";
import { compact } from "./charts";
import { useDialogo } from "./controls";
import { CuotasPanel } from "./cuotas-panel";

type Props = {
  // Id del modelo del chat ("proveedor/modelo"). null: el servidor elige el predeterminado.
  modelo: string | null;
  onCerrar: () => void;
  // Botón que abrió el panel: recibe el foco al cerrar.
  disparador?: RefObject<HTMLElement | null>;
};

type Ventana = { costoUsd: number; tokens: number; llamadas: number };

// Lo que va antes de "/" en el id del modelo es el proveedor.
const proveedorDe = (modelo: string | null) => (modelo && modelo.includes("/") ? modelo.split("/")[0] : null);

export function UsoPanel({ modelo, onCerrar, disparador }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [previo] = useState(() => document.activeElement as HTMLElement | null);
  const [anotando, setAnotando] = useState(false);
  const proveedorId = proveedorDe(modelo);

  const cerrar = () => {
    (disparador?.current ?? previo)?.focus();
    onCerrar();
  };
  useDialogo(ref, cerrar);

  // Solo consulta mientras el panel está abierto y refresca el uso cada 30 s.
  const uso = useQuery({
    queryKey: ["uso"],
    queryFn: api.usage,
    enabled: proveedorId !== null,
    refetchInterval: 30_000,
  });
  const proveedor: UsoProveedor | null = uso.data?.proveedores.find((p) => p.id === proveedorId) ?? null;
  const medido = proveedor?.precision === "medida_telo";

  let cuerpo: ReactNode;
  if (!proveedorId) {
    cuerpo = (
      <p className="muted-note">
        {modelo
          ? "No se reconoce el proveedor de este modelo."
          : "El modelo predeterminado lo elige el servidor. Elige un modelo para ver el uso de su proveedor."}
      </p>
    );
  } else if (uso.isPending) {
    cuerpo = <p className="muted-note">Cargando uso…</p>;
  } else if (uso.isError) {
    cuerpo = (
      <div className="estado-linea">
        <p className="error" role="alert">
          {errorText(uso.error)}
        </p>
        <button type="button" className="ghost task-mini-btn" onClick={() => void uso.refetch()}>
          Reintentar
        </button>
      </div>
    );
  } else if (!proveedor || proveedor.precision === "sin_datos") {
    cuerpo = <p className="muted-note">Todavía no hay uso registrado de este proveedor.</p>;
  } else {
    cuerpo = (
      <>
        <div className="uso-ventanas">
          <VentanaUso titulo="Últimas 5 horas" datos={proveedor.ultimas5h} />
          <VentanaUso titulo="Últimos 7 días" datos={proveedor.ultimos7d} />
        </div>
        {proveedor.cuotaRestanteUsd !== null && (
          <p className="uso-saldo">
            Saldo restante estimado: <strong>{formatUsd(proveedor.cuotaRestanteUsd)}</strong>
          </p>
        )}
        <p className="muted-note">
          Los límites de 5 horas y semanales del proveedor no se leen de su API. Estas cifras son lo que Telo registró.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className="uso-panel" role="dialog" aria-label="Uso del proveedor" ref={ref}>
        <div className="uso-panel-head">
          <h2>{proveedor?.nombre ?? proveedorId ?? "Uso"}</h2>
          {medido && <span className="badge badge-neutral">Medido por Telo</span>}
          <button type="button" className="ghost task-mini-btn" onClick={cerrar}>
            Cerrar
          </button>
        </div>

        {cuerpo}

        <button type="button" className="ghost" aria-expanded={anotando} onClick={() => setAnotando((v) => !v)}>
          {anotando ? "Ocultar saldos" : "Anotar saldo de una cuenta o clave"}
        </button>
        {anotando && <CuotasPanel onCerrar={() => setAnotando(false)} />}
      </div>
    </>
  );
}

function VentanaUso({ titulo, datos }: { titulo: string; datos: Ventana }) {
  return (
    <div className="uso-ventana" role="group" aria-label={titulo}>
      <span className="uso-ventana-etiqueta">{titulo}</span>
      <strong>{formatUsd(datos.costoUsd)}</strong>
      <span className="uso-ventana-meta">
        {compact(datos.tokens)} tokens · {datos.llamadas} llamadas
      </span>
    </div>
  );
}
