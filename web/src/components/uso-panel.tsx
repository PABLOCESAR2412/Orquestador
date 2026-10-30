import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type UsoProveedor, type UsoVentanaProveedor } from "../api";
import { errorText, formatUsd, proveedorDeModelo } from "../lib/model";
import { compact } from "./charts";
import { useDialogo } from "./controls";

type Props = {
  // Id del modelo del chat ("proveedor/modelo"). null: el servidor elige el predeterminado.
  modelo: string | null;
  onCerrar: () => void;
  // Botón que abrió el panel: recibe el foco al cerrar.
  disparador?: RefObject<HTMLElement | null>;
};

type Ventana = UsoVentanaProveedor;

export function UsoPanel({ modelo, onCerrar, disparador }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [previo] = useState(() => document.activeElement as HTMLElement | null);
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
    const googleLive = proveedor?.googleLive ?? (proveedorId === "google" ? uso.data?.googleLive : undefined);
    const ventanaVacia: Ventana = { costoUsd: 0, costoEstimadoUsd: 0, costesEstimados: 0, costesNoDisponibles: 0, costesDesconocidos: 0, tokens: 0, tokensMedidos: 0, tokensEstimados: 0, tokensNoDisponibles: 0, tokensDesconocidos: 0, llamadasSinTokens: 0, llamadas: 0 };
    const ultimos7d = proveedor?.ultimos7d ?? ventanaVacia;
    const ultimas5h = proveedor?.ultimas5h ?? ventanaVacia;
    const mesActual = proveedor?.mesActual ?? ventanaVacia;
    cuerpo = (
      <>
        {googleLive && (
          <div className="usage-window" role="region" aria-label="Estado de conexión con Google AI Studio">
            <div className="usage-window-heading">
              <div className="usage-window-copy">
                <span className="window-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className={`usage-status-dot${googleLive.conectado ? " is-online" : ""}`} aria-hidden="true" />
                  Comprobación de Google AI Studio
                </span>
                <span className="window-meta">{googleLive.mensaje}</span>
              </div>
            </div>
            <div className="usage-window-totals" style={{ marginTop: "8px" }}>
              <div>
                <span>Conexión</span>
                <strong>{googleLive.conectado ? "Disponible" : "No confirmada"}</strong>
              </div>
              <div>
                <span>Última comprobación</span>
                <strong>{new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(googleLive.ultimaComprobacion))}</strong>
              </div>
            </div>
          </div>
        )}
        <VentanaUso
          titulo="Últimos 7 días"
          datos={ultimos7d}
        />
        <VentanaUso
          titulo="Últimas 5 horas"
          datos={ultimas5h}
        />
        <VentanaUso
          titulo="Mes actual (UTC)"
          datos={mesActual}
        />
        <p className="usage-note">
          {proveedorId === "google"
            ? "Telo registra sus llamadas, no el uso total ni la cuota de Google. La comprobación en vivo solo valida la clave; aquí Google no devuelve el saldo ni los límites efectivos del proyecto y modelo."
            : "Telo registra sus llamadas, no el uso hecho fuera de Telo. Aún no consulta las APIs oficiales de cuota de cada proveedor, así que no muestra cuánto saldo queda."}
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

      </div>
    </>
  );
}

function VentanaUso({
  titulo,
  datos,
}: {
  titulo: string;
  datos: Ventana | null;
}) {
  const gastoUsd = datos?.costoEstimadoUsd ?? 0;
  const costosCompletos = Boolean(datos && datos.llamadas > 0 && datos.costesEstimados === datos.llamadas && datos.costesNoDisponibles === 0 && datos.costesDesconocidos === 0);

  const tieneUso = datos && (datos.tokens > 0 || datos.llamadas > 0);
  const precisionTokens = datos
    ? [
        datos.tokensMedidos > 0 ? `${compact(datos.tokensMedidos)} medidos` : "",
        datos.tokensEstimados > 0 ? `${compact(datos.tokensEstimados)} estimados` : "",
        datos.llamadasSinTokens > 0 ? `${datos.llamadasSinTokens} llamadas sin tokens confirmados` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const etiquetaCoste = datos?.costesEstimados
    ? `≈ ${formatUsd(gastoUsd)} estimado${costosCompletos ? "" : " (parcial)"}`
    : "Sin dato fiable";
  const promedioPorMil = datos && costosCompletos && datos.tokensMedidos === datos.tokens && datos.tokens > 0
    ? gastoUsd / datos.tokens * 1000
    : null;
  const etiquetaPromedio = promedioPorMil === null
    ? "No disponible"
    : `≈ ${new Intl.NumberFormat("es", { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(promedioPorMil)} US$/1.000 tokens`;

  return (
    <div className="usage-window" role="group" aria-label={`${titulo}: uso registrado`}>
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">{titulo}</span>
          <span className="window-meta">
            {tieneUso
              ? `${compact(datos.tokens)} tokens · ${datos.llamadas} llamada${datos.llamadas === 1 ? "" : "s"}${precisionTokens ? ` · ${precisionTokens}` : ""}`
              : "0 tokens · 0 llamadas registradas"}
          </span>
        </div>
      </div>
      <div className="usage-window-totals">
        <div>
          <span>Estimación de coste</span>
          <strong>{etiquetaCoste}</strong>
        </div>
        <div>
          <span>Estimación por 1.000 tokens</span>
          <strong>{etiquetaPromedio}</strong>
        </div>
      </div>
    </div>
  );
}
