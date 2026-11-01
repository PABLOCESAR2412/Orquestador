import { useRef, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BalanceDeepSeek } from "../api";
import { errorText, proveedorDeModelo } from "../lib/model";
import { useDialogo } from "./controls";

type Props = {
  modelo: string | null;
  onCerrar: () => void;
  disparador?: RefObject<HTMLElement | null>;
};

const CONSOLAS: Record<string, { nombre: string; url: string; texto: string }> = {
  google: { nombre: "Google AI Studio", url: "https://aistudio.google.com/usage", texto: "Uso y límites de Gemini API" },
  groq: { nombre: "Groq Console", url: "https://console.groq.com/", texto: "Uso de Groq API" },
  nvidia: { nombre: "NVIDIA Build", url: "https://build.nvidia.com/settings/billing", texto: "Facturación y uso de NVIDIA" },
  openrouter: { nombre: "OpenRouter", url: "https://openrouter.ai/activity", texto: "Actividad y uso de OpenRouter" },
  opencode: { nombre: "OpenCode Console", url: "https://opencode.ai/console", texto: "Uso y balance de OpenCode" },
};

export function UsoPanel({ modelo, onCerrar, disparador }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const disparadorPrevio = useRef(document.activeElement as HTMLElement | null);
  const proveedorId = proveedorDeModelo(modelo);
  const cerrar = () => {
    (disparador?.current ?? disparadorPrevio.current)?.focus();
    onCerrar();
  };
  useDialogo(ref, cerrar);

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className={`usage-popover${proveedorId === "codex" ? " is-codex-usage" : ""}`} role="dialog" aria-label="Cuota del proveedor" ref={ref}>
        <div className="usage-title-row">
          <span className="usage-title">{nombreProveedor(proveedorId)}</span>
          <button type="button" className="ghost task-mini-btn" onClick={cerrar} aria-label="Cerrar cuota">✕</button>
        </div>
        {!proveedorId ? (
          <p className="usage-note">
            {modelo ? "No se reconoce el proveedor de este modelo." : "Elige un modelo para consultar la cuota de su proveedor."}
          </p>
        ) : proveedorId === "codex" ? (
          <CuotaSesionCodex />
        ) : proveedorId === "deepseek" ? (
          <BalanceDeepSeekPanel />
        ) : CONSOLAS[proveedorId] ? (
          <ConsolaProveedor id={proveedorId} />
        ) : (
          <p className="usage-note">Telo no tiene un endpoint oficial verificado para consultar la cuota de este proveedor.</p>
        )}
      </div>
    </>
  );
}

function nombreProveedor(id: string | null): string {
  if (!id) return "Cuota de sesión";
  if (id === "codex") return "Codex";
  if (id === "deepseek") return "DeepSeek API";
  return CONSOLAS[id]?.nombre ?? id;
}

function ConsolaProveedor({ id }: { id: string }) {
  const consola = CONSOLAS[id]!;
  return (
    <section className="usage-account-quota" aria-label={`Cuota de ${consola.nombre}`}>
      <span className="window-label">Consulta de cuenta</span>
      <p className="usage-note">Telo no consulta una cuota oficial de esta cuenta. El uso de llamadas de Telo se revisa en Analíticas.</p>
      <a className="btn-usage" href={consola.url} target="_blank" rel="noopener noreferrer">{consola.texto} ↗</a>
    </section>
  );
}

function BalanceDeepSeekPanel() {
  const cliente = useQueryClient();
  const balance = useQuery({
    queryKey: ["deepseek-balance"],
    queryFn: api.deepseekBalance,
    staleTime: 60_000,
  });
  const actualizar = useMutation({
    mutationFn: api.deepseekBalance,
    onSuccess: (datos) => cliente.setQueryData(["deepseek-balance"], datos),
  });
  const datos = balance.data;
  const fecha = (valor: string) => {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime())
      ? ""
      : new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(fecha);
  };

  return (
    <section className="usage-account-quota" aria-label="Balance de la cuenta DeepSeek">
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">Balance API</span>
          {datos?.comprobadoEn && <span className="window-meta">Consultado {fecha(datos.comprobadoEn)}</span>}
        </div>
        <button type="button" className="ghost task-mini-btn" aria-label="Actualizar balance de DeepSeek" disabled={actualizar.isPending} onClick={() => actualizar.mutate()}>
          {actualizar.isPending ? "…" : "↻"}
        </button>
      </div>
      {balance.isPending && <p className="usage-note">Consultando balance…</p>}
      {balance.isError && <p className="usage-note" role="alert">{errorText(balance.error)}</p>}
      {datos?.estado === "sin_clave" && <p className="usage-note">No hay una clave API de DeepSeek configurada en Telo.</p>}
      {datos?.estado === "clave_invalida" && <p className="usage-note" role="alert">DeepSeek rechazó la clave. Revísala en Ajustes → Proveedores IA.</p>}
      {datos?.estado === "no_disponible" && <p className="usage-note" role="alert">DeepSeek no devolvió el balance. Vuelve a intentarlo más tarde.</p>}
      {datos?.estado === "activo" && datos.balanceInfos.map((item) => (
        <div className="usage-account-balance" key={item.currency}>
          <span className="window-meta">Saldo disponible · {item.currency}</span>
          <strong>{formatearSaldo(item.totalBalance, item.currency)}</strong>
          {item.grantedBalance !== null && <span className="window-meta">Bonificado {formatearSaldo(item.grantedBalance, item.currency)} · Recargado {formatearSaldo(item.toppedUpBalance ?? "0", item.currency)}</span>}
        </div>
      ))}
      {datos?.estado === "activo" && datos.disponible === false && <p className="usage-note" role="alert">La cuenta no tiene saldo suficiente para nuevas llamadas.</p>}
      {actualizar.isError && <p className="usage-note" role="alert">No se pudo actualizar; se conserva el último balance consultado.</p>}
      <a className="usage-note" href="https://api-docs.deepseek.com/api/get-user-balance/" target="_blank" rel="noopener noreferrer">Cómo se consulta este balance ↗</a>
    </section>
  );
}

function formatearSaldo(valor: string, moneda: "USD" | "CNY"): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return `${valor} ${moneda}`;
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(numero);
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
    if (!valor) return "Sin fecha";
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime())
      ? "Sin fecha"
      : new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(fecha);
  };
  const duracion = (minutos: number | null) => {
    if (minutos === null) return "duración no indicada";
    if (minutos % 1440 === 0) return `${minutos / 1440} d`;
    if (minutos % 60 === 0) return `${minutos / 60} h`;
    return `${minutos} min`;
  };

  return (
    <section className="usage-codex-quota" aria-label="Cuota de la sesión ChatGPT Codex">
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">Cuota de sesión</span>
          <span className="window-meta">{cuota.isPending ? "Consultando Codex…" : datos?.plan ?? "Plan no identificado"}</span>
        </div>
        <button type="button" className="ghost task-mini-btn" aria-label="Actualizar cuota de Codex" title="Consultar ahora" disabled={actualizar.isPending} onClick={() => actualizar.mutate()}>
          {actualizar.isPending ? "…" : "↻"}
        </button>
      </div>
      {datos && <span className="window-meta">Última consulta {fecha(datos.comprobadoEn)}</span>}
      {cuota.isError && <p className="usage-note" role="alert">No se pudo consultar la cuota. Comprueba que Codex CLI tenga una sesión iniciada y actualiza.</p>}
      {actualizar.isError && <p className="usage-note" role="alert">Falló la consulta inmediata; se conserva el último dato disponible.</p>}
      {datos?.estado === "sin_cli" && <p className="usage-note">Codex CLI no está instalado en este servidor.</p>}
      {datos?.estado === "sin_sesion" && <p className="usage-note">No hay una sesión ChatGPT activa en Codex CLI.</p>}
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
      {datos?.estado === "activo" && datos.reiniciosDisponibles !== null && <p className="window-meta">Reinicios disponibles: {datos.reiniciosDisponibles}</p>}
      <p className="usage-note">Cuota de ChatGPT Plus/Codex. La facturación de OpenAI API se consulta por separado.</p>
    </section>
  );
}
