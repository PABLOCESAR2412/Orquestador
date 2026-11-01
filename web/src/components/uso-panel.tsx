import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
          costeIncluido={proveedorId === "codex"}
        />
        <VentanaUso
          titulo="Últimas 5 horas"
          datos={ultimas5h}
          costeIncluido={proveedorId === "codex"}
        />
        <VentanaUso
          titulo="Mes actual (UTC)"
          datos={mesActual}
          costeIncluido={proveedorId === "codex"}
        />
        <p className="usage-note">
          {proveedorId === "google"
            ? <>Telo registra solo las llamadas Gemini API que salen de Telo. El plan Google AI Plus y la cuota de Antigravity son aparte; revisa Antigravity con <code>/usage</code>. El consumo de Gemini API se consulta en <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer">Google AI Studio · Usage</a>.</>
            : proveedorId === "anthropic"
              ? <>Aquí ves las llamadas a Anthropic API que registra Telo. No se consulta la cuota de Claude.ai/Claude Code; la suscripción de Claude y la facturación de API son productos separados. <a href="https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan" target="_blank" rel="noopener noreferrer">Detalles de facturación de Anthropic</a>.</>
            : "Telo registra sus llamadas, no el uso hecho fuera de Telo. Aún no consulta las APIs oficiales de cuota de cada proveedor, así que no muestra cuánto saldo queda."}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className={`usage-popover${proveedorId === "codex" ? " is-codex-usage" : ""}`} role="dialog" aria-label="Uso del proveedor" ref={ref}>
        <div className="usage-title-row">
          <span className="usage-title">
            {proveedor?.nombre ?? (proveedorId === "google" ? "Google (Gemini)" : proveedorId ?? "Uso de proveedor")}
          </span>
          <button type="button" className="ghost task-mini-btn" onClick={cerrar}>
            ✕
          </button>
        </div>

        {cuerpo}
        {proveedorId === "codex" && (
          <CuotaSesionCodex />
        )}

      </div>
    </>
  );
}

function CuotaSesionCodex() {
  const queryClient = useQueryClient();
  const cuota = useQuery({
    queryKey: ["codex-usage"],
    queryFn: () => api.codexUsage(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const actualizar = useMutation({
    mutationFn: () => api.codexUsage(true),
    onSuccess: (datos) => queryClient.setQueryData(["codex-usage"], datos),
  });
  const datos = cuota.data;
  const fecha = (valor: string | null) => {
    if (!valor) return "No indicada por Codex";
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime())
      ? "No indicada por Codex"
      : new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(fecha);
  };
  const duracion = (minutos: number | null) => {
    if (minutos === null) return "Duración no indicada";
    if (minutos % 1440 === 0) return `${minutos / 1440} d`;
    if (minutos % 60 === 0) return `${minutos / 60} h`;
    return `${minutos} min`;
  };

  return (
    <section className="usage-codex-quota" aria-label="Cuota de la sesión ChatGPT Codex">
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">Cuota de sesión · Codex</span>
          <span className="window-meta">
            {cuota.isPending ? "Consultando Codex…" : datos?.plan ?? "Plan no identificado"}
          </span>
        </div>
        <button
          type="button"
          className="ghost task-mini-btn"
          aria-label="Actualizar cuota de Codex"
          title="Consultar ahora"
          disabled={actualizar.isPending}
          onClick={() => actualizar.mutate()}
        >
          {actualizar.isPending ? "…" : "↻"}
        </button>
      </div>
      {datos && <span className="window-meta">Consultado {fecha(datos.comprobadoEn)}</span>}

      {cuota.isError && (
        <p className="usage-note" role="alert">No se pudo consultar la cuota de Codex. Comprueba que Codex CLI tenga una sesión iniciada y vuelve a actualizar.</p>
      )}
      {actualizar.isError && <p className="usage-note" role="alert">La consulta inmediata falló; se conserva el último dato disponible.</p>}
      {datos?.estado === "sin_cli" && <p className="usage-note">Codex CLI no está instalado en este servidor.</p>}
      {datos?.estado === "sin_sesion" && <p className="usage-note">No hay una sesión ChatGPT activa en Codex CLI. Inicia sesión desde Ajustes.</p>}
      {datos?.estado === "no_disponible" && <p className="usage-note">Codex no entregó los límites de cuota. Reintenta en unos segundos.</p>}

      {datos?.estado === "activo" && datos.ventanas.map((ventana) => (
        <div className="usage-codex-window" key={ventana.id}>
          <div className="usage-window-heading">
            <span className="window-label">{ventana.nombre} · {duracion(ventana.duracionMinutos)}</span>
            <strong>{Math.round(ventana.restantePorcentaje)}% restante</strong>
          </div>
          <progress className={ventana.restantePorcentaje <= 10 ? "is-low" : ""} max={100} value={ventana.restantePorcentaje} aria-label={`${ventana.nombre}: ${Math.round(ventana.restantePorcentaje)}% restante`} />
          <span className="window-meta">Usado {Math.round(ventana.usadoPorcentaje)}% · reinicia {fecha(ventana.reiniciaEn)}</span>
        </div>
      ))}
      {datos?.estado === "activo" && datos.reiniciosDisponibles !== null && (
        <p className="window-meta">Reinicios de cuota disponibles: {datos.reiniciosDisponibles}</p>
      )}
      <p className="usage-note">
        La cuota mostrada pertenece a la sesión de ChatGPT Plus/Codex, no a la clave de OpenAI API. Las llamadas por API se facturan y consultan por separado.
      </p>
    </section>
  );
}

function VentanaUso({
  titulo,
  datos,
  costeIncluido = false,
}: {
  titulo: string;
  datos: Ventana | null;
  costeIncluido?: boolean;
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
  const etiquetaCoste = costeIncluido
    ? "Incluido en el plan; no se calcula por llamada"
    : datos?.costesEstimados
    ? `≈ ${formatUsd(gastoUsd)} estimado${costosCompletos ? "" : " (parcial)"}`
    : "Sin dato fiable";
  const promedioPorMil = !costeIncluido && datos && costosCompletos && datos.tokensMedidos === datos.tokens && datos.tokens > 0
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
