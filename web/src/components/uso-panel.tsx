import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type UsoProveedor } from "../api";
import { errorText, formatUsd, proveedorDeModelo } from "../lib/model";
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

export function UsoPanel({ modelo, onCerrar, disparador }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [previo] = useState(() => document.activeElement as HTMLElement | null);
  const [anotando, setAnotando] = useState(false);
  const proveedorId = proveedorDeModelo(modelo);

  const cerrar = () => {
    (disparador?.current ?? previo)?.focus();
    onCerrar();
  };
  useDialogo(ref, cerrar);

  // Solo consulta mientras el panel está abierto; recoge el uso que registra cada paso del agente.
  const uso = useQuery({
    queryKey: ["uso"],
    queryFn: api.usage,
    enabled: proveedorId !== null,
    refetchInterval: 5_000,
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
    const googleLive = proveedor?.googleLive ?? (proveedorId === "google" ? uso.data?.googleLive : undefined);
    const ultimos7d = proveedor?.ultimos7d ?? { costoUsd: 0, tokens: 0, llamadas: 0 };
    const ultimas5h = proveedor?.ultimas5h ?? { costoUsd: 0, tokens: 0, llamadas: 0 };
    cuerpo = (
      <>
        {googleLive && (
          <div className="usage-window" role="region" aria-label="API de Google Gemini en vivo" style={{ borderLeft: googleLive.conectado ? "3px solid var(--ok, #10b981)" : "3px solid var(--error, #ef4444)" }}>
            <div className="usage-window-heading">
              <div className="usage-window-copy">
                <span className="window-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: googleLive.conectado ? "var(--ok, #10b981)" : "var(--error, #ef4444)",
                    }}
                  />
                  Google AI Studio (API en vivo)
                </span>
                <span className="window-meta">{googleLive.mensaje}</span>
              </div>
              <div className="usage-remaining" aria-hidden="true">
                <strong>{formatoPorcentaje(googleLive.porcentajeRestante)} %</strong>
                <span style={{ fontSize: "11px", color: "var(--ink-2)", display: "block" }}>cuota RPD</span>
              </div>
            </div>
            <div className="usage-window-totals" style={{ marginTop: "8px" }}>
              <div>
                <span>Peticiones hoy</span>
                <strong>{googleLive.llamadasHoy} de {googleLive.limiteRpd} RPD</strong>
              </div>
              <div>
                <span>Límite de ritmo</span>
                <strong>{googleLive.limiteRpm} RPM</strong>
              </div>
              <div>
                <span>Tokens hoy</span>
                <strong>{compact(googleLive.tokensHoy)}</strong>
              </div>
              <div>
                <span>Gasto estimado</span>
                <strong>{formatUsd(googleLive.costoHoyUsd)}</strong>
              </div>
            </div>
          </div>
        )}
        <VentanaSaldo
          titulo="Últimos 7 días"
          datos={ultimos7d}
          saldoUsd={proveedor?.cuotaRestanteUsd ?? null}
          porcentajeFijo={proveedorId === "google" && googleLive ? googleLive.porcentajeRestante : null}
          textoSaldo={
            proveedorId === "google" && googleLive && proveedor?.cuotaRestanteUsd === null
              ? `${googleLive.restantesRpd} RPD disponibles`
              : null
          }
        />
        <VentanaSaldo
          titulo="Últimas 5 horas"
          datos={ultimas5h}
          saldoUsd={proveedor?.cuotaRestanteUsd ?? null}
          porcentajeFijo={proveedorId === "google" && googleLive ? googleLive.porcentajeRestante : null}
          textoSaldo={
            proveedorId === "google" && googleLive && proveedor?.cuotaRestanteUsd === null
              ? `${googleLive.restantesRpd} RPD disponibles`
              : null
          }
        />
        <p className="usage-note">
          {proveedorId === "google"
            ? "Métricas en vivo consultadas a Google AI Studio con cuota estándar gratuita (1,500 RPD / 15 RPM). El gasto estimado se calcula según las tarifas oficiales de Google Gemini ($0.075 / $0.30 por millón de tokens)."
            : proveedor?.cuotaRestanteUsd === null || !proveedor
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
            {proveedor?.nombre ?? (proveedorId === "google" ? "Google (Gemini)" : proveedorId ?? "Uso de proveedor")}
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
  porcentajeFijo,
  textoSaldo,
}: {
  titulo: string;
  datos: Ventana | null;
  saldoUsd: number | null;
  porcentajeFijo?: number | null;
  textoSaldo?: string | null;
}) {
  const gastoUsd = datos?.costoUsd ?? 0;
  const gastadoCalc = porcentajeGastado(gastoUsd, saldoUsd);
  const restante = porcentajeFijo !== undefined && porcentajeFijo !== null
    ? porcentajeFijo
    : gastadoCalc === null
    ? null
    : 100 - gastadoCalc;
  const circunferencia = 2 * Math.PI * 8;
  const etiquetaAccesible = restante === null
    ? `${titulo}: ${saldoUsd === null ? "saldo sin anotar" : "porcentaje no disponible"}`
    : `${titulo}: ${formatoPorcentaje(restante)} % restante`;

  const tieneUso = datos && (datos.tokens > 0 || datos.llamadas > 0);

  return (
    <div
      className="usage-window"
      role={restante === null ? "group" : "meter"}
      aria-label={etiquetaAccesible}
      aria-valuemin={restante === null ? undefined : 0}
      aria-valuemax={restante === null ? undefined : 100}
      aria-valuenow={restante ?? undefined}
    >
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">{titulo}</span>
          <span className="window-meta">
            {tieneUso
              ? `${compact(datos.tokens)} tokens · ${datos.llamadas} llamada${datos.llamadas === 1 ? "" : "s"}`
              : "0 tokens · 0 llamadas"}
          </span>
        </div>
        <div className="usage-remaining" aria-hidden="true">
          <strong>{restante === null ? "—" : `${formatoPorcentaje(restante)} %`}</strong>
          {restante !== null && (
            <svg className="usage-ring" viewBox="0 0 20 20">
              <circle className="usage-ring-track" cx="10" cy="10" r="8" />
              <circle
                className="usage-ring-value"
                cx="10"
                cy="10"
                r="8"
                strokeDasharray={`${(restante / 100) * circunferencia} ${circunferencia}`}
              />
            </svg>
          )}
        </div>
      </div>
      <div className="usage-window-totals">
        <div>
          <span>Gastado</span>
          <strong>{formatUsd(gastoUsd)}{gastadoCalc !== null && ` · ${formatoPorcentaje(gastadoCalc)} %`}</strong>
        </div>
        <div>
          <span>Saldo restante</span>
          <strong>
            {textoSaldo ?? (saldoUsd === null ? "Sin anotar" : `${formatUsd(saldoUsd)}${restante !== null ? ` · ${formatoPorcentaje(restante)} %` : ""}`)}
          </strong>
        </div>
      </div>
    </div>
  );
}
