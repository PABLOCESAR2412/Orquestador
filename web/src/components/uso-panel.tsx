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
const proveedorDe = (modelo: string | null) =>
  modelo && modelo.includes("/") ? modelo.split("/")[0] : null;

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
  const proveedor: UsoProveedor | null =
    uso.data?.proveedores.find((p) => p.id === proveedorId) ?? null;

  let cuerpo: ReactNode;
  if (!proveedorId) {
    cuerpo = (
      <p className="usage-note">
        {modelo
          ? "No se reconoce el proveedor de este modelo."
          : "El modelo predeterminado lo elige el servidor. Elige un modelo para ver el uso de su proveedor."}
      </p>
    );
  } else if (uso.isPending) {
    cuerpo = <p className="usage-note">Cargando uso…</p>;
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
  } else {
    const registrado = proveedor?.precision === "medida_telo";
    cuerpo = (
      <>
        <VentanaSaldo
          titulo="Últimas 5 horas"
          datos={registrado ? proveedor.ultimas5h : null}
          saldoUsd={proveedor?.cuotaRestanteUsd ?? null}
        />
        <VentanaSaldo
          titulo="Últimos 7 días"
          datos={registrado ? proveedor.ultimos7d : null}
          saldoUsd={proveedor?.cuotaRestanteUsd ?? null}
        />
        <p className="usage-note">
          {proveedor?.cuotaRestanteUsd === null || !proveedor
            ? "Anota el saldo restante para ver porcentajes. Telo no consulta en vivo los límites ni el saldo del proveedor."
            : "Los porcentajes comparan el costo registrado en cada ventana con ese gasto más el saldo anotado restante. Son una estimación de Telo, no la cuota real del proveedor."}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className="usage-popover" role="dialog" aria-label="Uso del proveedor" ref={ref}>
        <div className="usage-title-row">
          <span className="usage-title">
            {proveedor?.nombre ?? proveedorId ?? "Uso de proveedor"}
          </span>
          <button type="button" className="ghost task-mini-btn" onClick={cerrar}>
            ✕
          </button>
        </div>

        {cuerpo}

        <button
          type="button"
          className="ghost usage-toggle-saldos"
          aria-expanded={anotando}
          onClick={() => setAnotando((v) => !v)}
        >
          {anotando ? "Ocultar saldos" : "Anotar saldo"}
        </button>
        {anotando && <CuotasPanel onCerrar={() => setAnotando(false)} />}
      </div>
    </>
  );
}

function porcentajeGastado(costoUsd: number, saldoUsd: number | null): number | null {
  if (saldoUsd === null) return null;
  const gasto = Math.max(0, costoUsd);
  const saldo = Math.max(0, saldoUsd);
  const total = gasto + saldo;
  if (total === 0) return null;
  return Math.round((gasto / total) * 1000) / 10;
}

function formatoPorcentaje(valor: number): string {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(valor);
}

function VentanaSaldo({
  titulo,
  datos,
  saldoUsd,
}: {
  titulo: string;
  datos: Ventana | null;
  saldoUsd: number | null;
}) {
  const gastoUsd = datos?.costoUsd ?? 0;
  const gastado = porcentajeGastado(gastoUsd, saldoUsd);
  const restante = gastado === null ? null : 100 - gastado;

  return (
    <div className="usage-window" role="group" aria-label={titulo}>
      <div className="window-heading">
        <span className="window-label">{titulo}</span>
        <span className="window-meta">
          {datos ? `${compact(datos.tokens)} tokens · ${datos.llamadas} llamadas` : "Sin uso registrado"}
        </span>
      </div>
      <div className="usage-balance-row">
        <span>Gastado</span>
        <strong>
          {formatUsd(gastoUsd)}{gastado !== null && ` · ${formatoPorcentaje(gastado)} %`}
        </strong>
      </div>
      <div className="usage-balance-row">
        <span>Saldo restante</span>
        <strong>
          {saldoUsd === null ? "Sin anotar" : formatUsd(saldoUsd)}
          {restante !== null && ` · ${formatoPorcentaje(restante)} %`}
        </strong>
      </div>
      {gastado !== null && (
        <div
          className="usage-progress"
          role="meter"
          aria-label={`${titulo}: ${formatoPorcentaje(gastado)} % gastado`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={gastado}
        >
          <span style={{ width: `${gastado}%` }} />
        </div>
      )}
    </div>
  );
}
