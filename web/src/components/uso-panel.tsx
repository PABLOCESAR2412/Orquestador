import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type LimitesOpenAI, type LimitesOpenCode, type LimitesOpenRouter, type UsoProveedor } from "../api";
import { errorText, nombreProveedor, proveedorDeModelo } from "../lib/model";
import { useDialogo } from "./controls";

type Props = {
  // Id del modelo del chat ("proveedor/modelo"). null: el servidor elige el predeterminado.
  modelo: string | null;
  onCerrar: () => void;
  // Botón que abrió el panel: recibe el foco al cerrar.
  disparador?: RefObject<HTMLElement | null>;
};

export function UsoPanel({ modelo, onCerrar, disparador }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [previo] = useState(() => document.activeElement as HTMLElement | null);
  const queryClient = useQueryClient();
  const proveedorId = proveedorDeModelo(modelo);

  const cerrar = () => {
    (disparador?.current ?? previo)?.focus();
    onCerrar();
  };
  useDialogo(ref, cerrar);

  const usaDatosCompartidos = ["google", "openai", "opencode", "openrouter"].includes(proveedorId ?? "");
  const uso = useQuery({
    queryKey: ["uso"],
    queryFn: () => api.usage(),
    enabled: usaDatosCompartidos,
    refetchInterval: 60_000,
  });
  const requiereApi = ["google", "openai", "groq", "xai", "nvidia", "openrouter"].includes(proveedorId ?? "");
  const requiereSesion = proveedorId === "opencode" || proveedorId === "commandcode";
  const proveedores = useQuery({
    queryKey: ["providers"],
    queryFn: api.listProviders,
    staleTime: 5 * 60_000,
    enabled: requiereApi || requiereSesion,
  });
  const actualizarUso = useMutation({
    mutationFn: () => api.usage(true),
    onSuccess: (datos) => queryClient.setQueryData(["uso"], datos),
  });
  const proveedor: UsoProveedor | null =
    uso.data?.proveedores.find((p) => p.id === proveedorId) ?? null;
  const estadoProveedor = proveedores.data?.find((p) => p.id === proveedorId);
  const faltaClave = (requiereApi && estadoProveedor && !estadoProveedor.configured) ||
    (requiereSesion && estadoProveedor && (!estadoProveedor.configured || !estadoProveedor.sesion));

  useLayoutEffect(() => {
    const panel = ref.current;
    const trigger = disparador?.current;
    const contenedor = panel?.parentElement;
    if (!panel || !trigger || !contenedor) return;
    const ubicar = () => {
      const caja = contenedor.getBoundingClientRect();
      const boton = trigger.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      const izquierda = Math.max(8, Math.min(caja.width - rect.width - 8, boton.left + boton.width / 2 - caja.left - rect.width / 2));
      const arriba = boton.top - caja.top - rect.height - 10;
      panel.style.left = `${izquierda}px`;
      panel.style.right = "auto";
      panel.style.top = `${arriba}px`;
      panel.style.bottom = "auto";
      panel.style.setProperty("--usage-origin-x", `${boton.left + boton.width / 2 - caja.left - izquierda}px`);
      panel.style.setProperty("--usage-origin-y", "100%");
    };
    ubicar();
    const observer = new ResizeObserver(ubicar);
    observer.observe(panel);
    window.addEventListener("resize", ubicar);
    window.visualViewport?.addEventListener("resize", ubicar);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", ubicar);
      window.visualViewport?.removeEventListener("resize", ubicar);
    };
  }, [disparador, proveedorId, uso.data]);

  let cuerpo: ReactNode;
  if (proveedorId === "codex") {
    cuerpo = <CuotaSesionCodex />;
  } else if (proveedorId === "antigravity") {
    cuerpo = <CuotaSesionAntigravity />;
  } else if (proveedorId === "ollama") {
    cuerpo = <BalanceOllamaPanel />;
  } else if (proveedorId === "deepseek") {
    cuerpo = <BalanceDeepSeekPanel />;
  } else if (!proveedorId) {
    cuerpo = (
      <p className="usage-note">
        {modelo
          ? "No se reconoce el proveedor de este modelo."
          : "El modelo predeterminado lo elige el servidor. Elige un modelo para ver el uso de su proveedor."}
      </p>
    );
  } else if (usaDatosCompartidos && uso.isPending) {
    cuerpo = <p className="usage-note">Cargando uso…</p>;
  } else if (usaDatosCompartidos && uso.isError) {
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
        {proveedorId === "openai" && <LimitesOpenAILive datos={proveedor?.openaiLimits ?? uso.data?.openaiLimits} />}
        {proveedorId === "opencode" && <LimitesOpenCodeLive datos={proveedor?.openCodeLimits ?? uso.data?.openCodeLimits} />}
        {proveedorId === "openrouter" && <LimitesOpenRouterLive datos={proveedor?.openRouterLimits ?? uso.data?.openRouterLimits} alActualizar={() => actualizarUso.mutate()} actualizando={actualizarUso.isPending} />}
        {proveedorId === "commandcode" && <LimitesCommandCodeGo />}
        {proveedorId === "google" && <p className="usage-note">Google aplica límites por proyecto y modelo. Consulta la cuota en <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer">Google AI Studio · Usage</a>.</p>}
        {proveedorId === "anthropic" && <p className="usage-note">Consulta el saldo y los límites en la <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">consola de Anthropic</a>.</p>}
        {proveedorId === "xai" && <p className="usage-note">Consulta el <a href="https://docs.x.ai/console/usage" target="_blank" rel="noopener noreferrer">uso de tu cuenta xAI</a> y sus <a href="https://docs.x.ai/developers/rate-limits" target="_blank" rel="noopener noreferrer">límites por modelo</a>.</p>}
        {proveedorId === "groq" && <p className="usage-note">Consulta los límites de tu organización en <a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener noreferrer">Groq Cloud</a>.</p>}
        {proveedorId === "nvidia" && <p className="usage-note">Consulta el acceso de tu cuenta en el <a href="https://build.nvidia.com/" target="_blank" rel="noopener noreferrer">catálogo de NVIDIA</a>.</p>}
        {!usaDatosCompartidos && !["commandcode", "anthropic", "xai", "groq", "nvidia"].includes(proveedorId) && (
          <p className="usage-note">La cuota de la cuenta se consulta en el panel del proveedor.</p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className={`usage-popover${proveedorId === "codex" ? " is-codex-usage" : ""}${proveedorId === "antigravity" ? " is-antigravity-usage" : ""}`} role="dialog" aria-label="Uso del proveedor" ref={ref}>
        <div className="usage-title-row">
          <span className="usage-title">
            {proveedor?.nombre ?? (proveedorId ? nombreProveedor(proveedorId) : "Uso de proveedor")}
          </span>
          <button type="button" className="ghost task-mini-btn" aria-label="Cerrar uso del proveedor" onClick={cerrar}>
            ✕
          </button>
        </div>

        {faltaClave && <p className="usage-note" role="status">{proveedorId === "opencode" ? "Telo no detecta una sesión de OpenCode Console en el servidor." : proveedorId === "commandcode" ? "Telo no detecta la sesión de Command Code Go en el servidor." : `Falta la clave API para usar ${proveedor?.nombre ?? proveedorId}. El precio $0 no evita este requisito.`} <Link to="/ajustes" search={{ pestana: proveedorId === "opencode" || proveedorId === "commandcode" ? "servidor" : "proveedores" }}>Revisar proveedor</Link></p>}
        {cuerpo}
      </div>
    </>
  );
}

function LimitesOpenAILive({ datos }: { datos?: LimitesOpenAI }) {
  const t = (valor: number | null) => valor === null ? "—" : valor.toLocaleString("es-EC");
  return (
    <section className="usage-models" aria-label="Límites de OpenAI por proyecto">
      <div className="usage-models-heading">
        <span className="window-label">Límites de OpenAI</span>
        <span className="window-meta">{datos?.mensaje ?? "Consultando el proyecto…"}</span>
      </div>
      {datos?.estado === "consultado" && datos.limites.length > 0 ? (
        <ul className="usage-model-list" aria-label="Topes configurados por modelo">
          {datos.limites.map((limite) => (
              <li className="usage-model-row" key={limite.modelo}>
                <code className="usage-model-name">{limite.modelo}</code>
                <span className="window-meta">Tope: {t(limite.rpm)} RPM · {t(limite.tpm)} TPM{limite.rpd === null ? "" : ` · ${t(limite.rpd)} RPD`}</span>
              </li>
          ))}
        </ul>
      ) : datos?.estado === "consultado" ? (
        <p className="usage-note usage-models-empty">OpenAI no devolvió límites para este proyecto.</p>
      ) : datos?.estado === "sin_configurar" ? (
        <p className="usage-note usage-models-empty">La consulta exacta requiere configurar <code>TELO_OPENAI_ADMIN_API_KEY</code> y <code>TELO_OPENAI_PROJECT_ID</code> en el servidor.</p>
      ) : datos ? (
        <p className="usage-note usage-models-empty" role="status">{datos.mensaje}</p>
      ) : null}
      <p className="usage-models-footnote">Consulta los <a href="https://developers.openai.com/api/docs/guides/rate-limits" target="_blank" rel="noopener noreferrer">límites de la API</a> y el <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer">uso de tu cuenta</a>.</p>
    </section>
  );
}

function LimitesOpenCodeLive({ datos }: { datos?: LimitesOpenCode }) {
  const dinero = (valor: number) => `$${valor.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const fecha = (instante: number) => Number.isFinite(instante)
    ? new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(new Date(instante))
    : "sin fecha de reinicio";
  const go = datos?.go;
  return (
    <section className="usage-models" aria-label="Cuota de OpenCode Console y Go">
      <div className="usage-models-heading">
        <span className="window-label">OpenCode Console</span>
        <span className="window-meta">{datos?.espacio ?? datos?.mensaje ?? "Consultando el CLI…"}</span>
      </div>
      {go && (
        <ul className="usage-model-list" aria-label="Allowance de OpenCode Go">
          {(["rolling", "weekly", "monthly"] as const).map((ventana) => {
            const medidor = go[ventana];
            const nombre = ventana === "rolling" ? "5 h" : ventana === "weekly" ? "Semana" : "Mes";
            return <li className="usage-model-row" key={ventana}><strong>{nombre}: {Math.max(0, 100 - medidor.percent).toLocaleString("es-EC", { maximumFractionDigits: 1 })}% restante</strong><span className="window-meta">{medidor.percent.toLocaleString("es-EC", { maximumFractionDigits: 1 })}% usado · reinicia {fecha(medidor.resetsAt)}</span></li>;
          })}
        </ul>
      )}
      {datos?.presupuestos.map((presupuesto) => (
        <div className="usage-model-row" key={presupuesto.id}>
          <strong>{presupuesto.id}: {dinero(Math.max(0, presupuesto.limit - presupuesto.spent))} restantes</strong>
          <span className="window-meta">{dinero(presupuesto.spent)} de {dinero(presupuesto.limit)} · reinicia {fecha(presupuesto.resetsAt)}</span>
          {presupuesto.models.length > 0 && <span className="window-meta">{presupuesto.models.slice(0, 6).map((modelo) => `${modelo.name}: ${dinero(modelo.spent)}`).join(" · ")}</span>}
        </div>
      ))}
      {datos && datos.estado !== "consultado" && <p className="usage-note usage-models-empty" role="status">{datos.mensaje}</p>}
      {datos?.estado === "consultado" && !go && datos.presupuestos.length === 0 && <p className="usage-note usage-models-empty">{datos.mensaje}</p>}
      {datos?.estado === "sin_sesion" && <p className="usage-note usage-models-empty">Conecta OpenCode Console en el CLI del servidor para habilitar los límites de cuenta.</p>}
      <p className="usage-models-footnote">Consulta experimental del CLI de OpenCode; los contadores por modelo de Telo siguen cubriendo solo este servidor.</p>
    </section>
  );
}

function LimitesOpenRouterLive({ datos, alActualizar, actualizando }: { datos?: LimitesOpenRouter; alActualizar: () => void; actualizando: boolean }) {
  const usd = (valor: number | null) => valor === null ? "No informado" : `$${valor.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const solicitudes = datos?.solicitudesGratis;
  return (
    <section className="usage-models" aria-label="Saldo y solicitudes gratis de OpenRouter">
      <div className="usage-models-heading">
        <div>
          <span className="window-label">OpenRouter · límites de la clave</span>
          <span className="window-meta">{datos?.mensaje ?? "Consultando OpenRouter…"}</span>
        </div>
        <button type="button" className="ghost task-mini-btn" aria-label="Actualizar uso de OpenRouter" title="Consultar ahora" disabled={actualizando} onClick={alActualizar}>
          {actualizando ? "…" : "↻"}
        </button>
      </div>
      {datos?.estado === "consultado" && (
        <div className="usage-window-totals">
          <div><span>Uso de la clave</span><strong>{usd(datos.usoUsd)}</strong></div>
          <div><span>Saldo restante</span><strong>{usd(datos.restanteUsd)}</strong></div>
          <div><span>Límite de la clave</span><strong>{usd(datos.limiteUsd)}{datos.reinicio ? ` · ${datos.reinicio}` : ""}</strong></div>
        </div>
      )}
      {solicitudes && <div className="usage-model-row"><strong>{solicitudes.restantes.toLocaleString("es-EC")} solicitudes gratis restantes</strong><span className="window-meta">{solicitudes.usadas.toLocaleString("es-EC")} usadas de {solicitudes.limite.toLocaleString("es-EC")} en la ventana diaria reportada por OpenRouter.</span></div>}
      {datos?.estado === "consultado" && !solicitudes && <p className="usage-note">Esta clave no informó un contador de solicitudes gratis.</p>}
      {datos && datos.estado !== "consultado" && <p className="usage-note usage-models-empty" role="status">{datos.mensaje}</p>}
      <p className="usage-models-footnote">{datos?.esGratis === true ? "Clave de nivel gratuito." : datos?.esGratis === false ? "Clave asociada a una cuenta que no figura como nivel gratuito." : "El nivel de la clave no está informado."} Los proveedores de cada modelo pueden aplicar sus propios límites.</p>
    </section>
  );
}

function LimitesCommandCodeGo() {
  return (
    <section className="usage-models" aria-label="Límites del plan Command Code Go">
      <div className="usage-models-heading"><span className="window-label">Command Code Go · topes publicados</span><span className="window-meta">Plan de USD 1/mes</span></div>
      <ul className="usage-model-list">
        <li className="usage-model-row"><strong>Créditos incluidos al mes: USD 10 de uso</strong><span className="window-meta">Se renuevan con el ciclo de facturación.</span></li>
        <li className="usage-model-row"><strong>Ventana móvil de 5 horas: USD 3</strong><span className="window-meta">Uso compartido entre modelos; se abre con la primera solicitud.</span></li>
        <li className="usage-model-row"><strong>Ventana móvil de 7 días: USD 6</strong><span className="window-meta">Uso compartido entre modelos; las ventanas cuentan desde el primer uso.</span></li>
      </ul>
      <p className="usage-note usage-models-footnote">Los límites se miden por créditos consumidos y varían según el modelo; los valores publicados son una guía, no un contador en vivo. Para ver remanente y reinicios exactos, usa <code>/usage</code> en el CLI o la página Usage de Studio. Telo muestra aparte las llamadas y tokens que inició su servidor. <a href="https://commandcode.ai/docs/resources/pricing-limits" target="_blank" rel="noopener noreferrer">Consultar la página oficial</a>.</p>
    </section>
  );
}

function CuotaSesionAntigravity() {
  const queryClient = useQueryClient();
  const cuota = useQuery({
    queryKey: ["antigravity-usage"],
    queryFn: () => api.antigravityUsage(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const actualizar = useMutation({
    mutationFn: () => api.antigravityUsage(true),
    onSuccess: (datos) => queryClient.setQueryData(["antigravity-usage"], datos),
  });
  const datos = cuota.data;
  const grupos = datos?.grupos ?? [];
  return (
    <section className="usage-codex-quota" aria-label="Cuota de Antigravity CLI">
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">Cuota de Antigravity</span>
          {cuota.isPending && <span className="window-meta">Consultando Antigravity…</span>}
          {datos?.plan && <span className="window-meta">{datos.plan}</span>}
        </div>
        <button type="button" className="ghost task-mini-btn" aria-label="Actualizar cuota de Antigravity" title="Consultar ahora" disabled={actualizar.isPending} onClick={() => actualizar.mutate()}>{actualizar.isPending ? "…" : "↻"}</button>
      </div>
      {datos?.comprobadoEn && <span className="window-meta">Consultado {formatearFechaCuota(datos.comprobadoEn)}</span>}
      {datos?.estado === "activo" && grupos.map((grupo, indice) => (
        <section className="usage-antigravity-grupo" aria-label={grupo.nombre} key={`${grupo.nombre}-${indice}`}>
          <strong className="window-label">{grupo.nombre}</strong>
          {grupo.ventanas.map((ventana) => (
            <VentanaCuota key={ventana.id} {...ventana} />
          ))}
        </section>
      ))}
      {datos?.estado === "activo" && grupos.length === 0 && <p className="usage-note">La CLI no devolvió ventanas de cuota en un formato reconocido. Consulta <code>/usage</code> en Antigravity.</p>}
      {datos?.estado === "sin_cli" && <p className="usage-note">Antigravity CLI no está instalada en el servidor.</p>}
      {datos?.estado === "sin_sesion" && <p className="usage-note">El proceso del servidor no puede leer la sesión o el keyring de Google. Revisa el login de Antigravity en Ajustes.</p>}
      {datos?.estado === "no_disponible" && <p className="usage-note">Antigravity no devolvió una cuota legible. Vuelve a consultar.</p>}
      {(cuota.isError || actualizar.isError) && <p className="usage-note" role="alert">No se pudo consultar /usage en este momento.</p>}
    </section>
  );
}

function formatearFechaCuota(valor: string | null): string | null {
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(fecha);
}

function VentanaCuota({ nombre, restantePorcentaje, reiniciaEn, restante = null, unidad = null }: {
  nombre: string;
  restantePorcentaje: number | null;
  reiniciaEn: string | null;
  restante?: number | null;
  unidad?: string | null;
}) {
  const porcentaje = restantePorcentaje === null ? null : Math.round(restantePorcentaje);
  const reinicio = formatearFechaCuota(reiniciaEn);
  return (
    <div className="usage-codex-window">
      <div className="usage-window-heading">
        <span className="window-label">{nombre}</span>
        {porcentaje !== null ? <strong>{porcentaje}% restante</strong> : restante !== null && <strong>{restante.toLocaleString("es-EC")}{unidad ? ` ${unidad}` : ""} restante</strong>}
      </div>
      {restantePorcentaje !== null && <progress className={restantePorcentaje <= 10 ? "is-low" : ""} max={100} value={restantePorcentaje} aria-label={`${nombre}: ${porcentaje}% restante`} />}
      {(porcentaje !== null || reinicio) && <div className="usage-codex-window-meta">
        <span className="window-meta">{porcentaje !== null && `Uso ${100 - porcentaje}%`}</span>
        {reinicio && <span className="window-meta">Reinicia {reinicio}</span>}
      </div>}
    </div>
  );
}

function BalanceOllamaPanel() {
  const balance = useQuery({
    queryKey: ["ollama-balance"],
    queryFn: api.ollamaBalance,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const datos = balance.data;
  const incluido = datos?.incluidos;
  const consultado = formatearFechaCuota(datos?.comprobadoEn ?? null);
  const reinicio = formatearFechaCuota(incluido?.reiniciaEn ?? null);
  const dinero = (valor: number) => formatearSaldo(String(valor), "USD");
  return (
    <section className="usage-codex-quota" aria-label="Créditos de Ollama Cloud">
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">Créditos de la cuenta</span>
          {consultado && <span className="window-meta">Consultado {consultado}</span>}
        </div>
        <button type="button" className="ghost task-mini-btn" aria-label="Actualizar créditos de Ollama" disabled={balance.isFetching} onClick={() => void balance.refetch()}>{balance.isFetching ? "…" : "↻"}</button>
      </div>
      {balance.isPending && <p className="usage-note">Consultando créditos…</p>}
      {(balance.isError || datos?.estado === "no_disponible") && <p className="usage-note" role="status">Ollama no devolvió el saldo. Puedes revisarlo en tu cuenta.</p>}
      {datos?.estado === "sin_clave" && <p className="usage-note">Configura una clave de Ollama en Ajustes → Proveedores IA.</p>}
      {datos?.estado === "clave_invalida" && <p className="usage-note">Ollama rechazó la clave. Revísala en Ajustes → Proveedores IA.</p>}
      {datos?.estado === "rate_limit" && <p className="usage-note">Ollama limitó la consulta. Vuelve a intentar en un minuto.</p>}
      {incluido && <div className="usage-account-balance">
        <span className="window-meta">Créditos incluidos restantes</span>
        <strong>{dinero(incluido.restanteUsd)}</strong>
        {incluido.limiteUsd !== null && incluido.limiteUsd >= incluido.restanteUsd && <span className="window-meta">Uso {dinero(incluido.limiteUsd - incluido.restanteUsd)} de {dinero(incluido.limiteUsd)}</span>}
        {reinicio && <span className="window-meta">Reinicia {reinicio}</span>}
      </div>}
      {datos?.ventanas.map((ventana) => <VentanaCuota key={ventana.nombre} {...ventana} />)}
      {datos?.compradosUsd != null && <span className="window-meta">Créditos comprados restantes · {dinero(datos.compradosUsd)}</span>}
      <p className="usage-note">Cada modelo consume créditos según su tarifa. <a href="https://ollama.com/pricing#model-pricing" target="_blank" rel="noopener noreferrer">Tarifas por modelo</a> · <a href="https://ollama.com/settings" target="_blank" rel="noopener noreferrer">Uso de tu cuenta</a></p>
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
          <span className="window-label">Cuota de sesión</span>
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
          <div className="usage-codex-window-meta">
            <span className="window-meta">Uso {Math.round(ventana.usadoPorcentaje)}%</span>
            <span className="window-meta">Reinicia {fecha(ventana.reiniciaEn)}</span>
          </div>
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
