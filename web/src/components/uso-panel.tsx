import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type BalanceDeepSeek, type LimitesOpenAI, type LimitesOpenCode, type LimitesOpenRouter, type ModelInfo, type UsoModeloProveedor, type UsoOpenAIAdmin, type UsoProveedor, type UsoVentanaProveedor } from "../api";
import { errorText, formatPrice, formatUsd, proveedorDeModelo } from "../lib/model";
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

function etiquetaRechazo(rechazo: NonNullable<UsoModeloProveedor["ultimoRechazo"]>): string {
  const categoria = rechazo.categoria === "cuota"
    ? "Cuota o saldo agotado"
    : rechazo.categoria === "limite_temporal"
      ? "Límite temporal"
      : rechazo.categoria === "acceso"
        ? "Acceso rechazado"
        : "Modelo no disponible";
  return rechazo.estadoHttp ? `${categoria} · HTTP ${rechazo.estadoHttp}` : categoria;
}

function fechaRechazo(fecha: string): string {
  const iso = fecha.includes("T") ? fecha : `${fecha.replace(" ", "T")}Z`;
  const instante = new Date(iso);
  return Number.isNaN(instante.getTime())
    ? fecha
    : new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(instante);
}

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

  // Solo consulta mientras el panel está abierto; recoge el uso que registra cada paso del agente.
  const uso = useQuery({
    queryKey: ["uso"],
    queryFn: () => api.usage(),
    enabled: proveedorId !== null,
    refetchInterval: 30_000,
  });
  const catalogo = useQuery({
    queryKey: ["models"],
    queryFn: api.listModels,
    enabled: proveedorId !== null,
    staleTime: 5 * 60_000,
  });
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders, staleTime: 5 * 60_000 });
  const actualizarUso = useMutation({
    mutationFn: () => api.usage(true),
    onSuccess: (datos) => queryClient.setQueryData(["uso"], datos),
  });
  const proveedor: UsoProveedor | null =
    uso.data?.proveedores.find((p) => p.id === proveedorId) ?? null;
  const requiereApi = ["google", "openai", "groq", "xai", "nvidia", "openrouter", "deepseek"].includes(proveedorId ?? "");
  const estadoProveedor = proveedores.data?.find((p) => p.id === proveedorId);
  const faltaClave = (requiereApi && estadoProveedor && !estadoProveedor.configured) ||
    ((proveedorId === "opencode" || proveedorId === "commandcode") && estadoProveedor && (!estadoProveedor.configured || !estadoProveedor.sesion));

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
        {proveedorId === "openai" && <LimitesOpenAILive datos={proveedor?.openaiLimits ?? uso.data?.openaiLimits} consumo={proveedor?.openaiUsage ?? uso.data?.openaiUsage} usos={proveedor?.porModelo ?? []} />}
        {proveedorId === "opencode" && <LimitesOpenCodeLive datos={proveedor?.openCodeLimits ?? uso.data?.openCodeLimits} />}
        {proveedorId === "openrouter" && <LimitesOpenRouterLive datos={proveedor?.openRouterLimits ?? uso.data?.openRouterLimits} alActualizar={() => actualizarUso.mutate()} actualizando={actualizarUso.isPending} />}
        {proveedorId === "commandcode" && <LimitesCommandCodeGo />}
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
        <UsoPorModelo proveedor={proveedor} modeloSeleccionado={modelo} proveedorId={proveedorId} modelosCatalogo={catalogo.data?.models ?? []} />
        <p className="usage-note">
          {proveedorId === "google"
            ? <>Google aplica límites por proyecto y modelo; los valores activos se consultan en <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer">Google AI Studio · Usage</a>. El contador de Telo solo ve ejecuciones desde Telo y no puede calcular el saldo restante. La cuota de Antigravity/Google AI Plus es aparte.</>
            : proveedorId === "anthropic"
              ? <>Aquí ves las llamadas a Anthropic API que registra Telo. No se consulta la cuota de Claude.ai/Claude Code; la suscripción de Claude y la facturación de API son productos separados. <a href="https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan" target="_blank" rel="noopener noreferrer">Detalles de facturación de Anthropic</a>.</>
            : proveedorId === "openai"
              ? <>OpenAI API va aparte de ChatGPT y Codex CLI. Con una Admin API key, Telo consulta costes y tokens oficiales de la organización en los últimos 30 días; el ID del proyecto habilita además los topes por modelo. Sin ella, Telo sigue midiendo sus propias llamadas. <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer">Uso de la cuenta</a>.</>
              : proveedorId === "xai"
                ? <>La API de Grok va aparte de la app/web. xAI publica límites por modelo y consumo en su consola; además, la API usa créditos prepago y rechaza peticiones al agotarse. Telo mide lo que envía este servidor. Revisa <a href="https://docs.x.ai/developers/rate-limits" target="_blank" rel="noopener noreferrer">límites por modelo</a>, <a href="https://docs.x.ai/console/usage" target="_blank" rel="noopener noreferrer">uso</a> y <a href="https://docs.x.ai/console/billing" target="_blank" rel="noopener noreferrer">saldo</a>.</>
                : proveedorId === "nvidia"
                  ? <>NVIDIA ofrece acceso sin coste para prototipos a miembros de Developer Program, pero exige cuenta y API key; “gratis” no es acceso anónimo ni ilimitado. No encontré un endpoint público de saldo restante. Telo cuenta el uso local y registra rechazos 401/402/429 por modelo. Consulta el <a href="https://docs.api.nvidia.com/nim/docs/api-quickstart" target="_blank" rel="noopener noreferrer">acceso y API key de NIM</a>.</>
              : proveedorId === "openrouter"
                ? <>OpenRouter entrega saldo y solicitudes gratis restantes para la clave configurada. Los proveedores individuales pueden aplicar límites adicionales; Telo registra solo las llamadas que hace este servidor. <a href="https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key" target="_blank" rel="noopener noreferrer">Qué informa la consulta oficial</a>.</>
                : proveedorId === "commandcode"
                ? <>Command Code Go comparte créditos mensuales y topes móviles de 5 horas y 7 días. No publica una API para que Telo lea tu saldo de cuenta: consulta <code>/usage</code> en la CLI o la página Usage de Studio. Telo mide sus propias llamadas y tokens por modelo. <a href="https://commandcode.ai/docs/resources/pricing-limits" target="_blank" rel="noopener noreferrer">Límites de Go</a>.</>
                : proveedorId === "deepseek"
                  ? <>El balance de la API de DeepSeek aparece arriba; los contadores de abajo cubren solo llamadas desde Telo.</>
              : proveedorId === "opencode"
                    ? <>El precio $0 del catálogo no garantiza acceso. Si el CLI conserva una sesión de Console, Telo consulta su allowance y presupuesto en el endpoint experimental local; si no, muestra el registro de este servidor. Revisa <a href="https://opencode.ai/v2/docs/console/billing/" target="_blank" rel="noopener noreferrer">saldo y facturación</a>.</>
                  : "Telo registra sus llamadas, no el uso hecho fuera de Telo. El proveedor no ofrece a esta clave un saldo restante que Telo pueda consultar; revisa el panel de la cuenta."}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className={`usage-popover${proveedorId === "codex" ? " is-codex-usage" : ""}${proveedorId === "antigravity" ? " is-antigravity-usage" : ""}`} role="dialog" aria-label="Uso del proveedor" ref={ref}>
        <div className="usage-title-row">
          <span className="usage-title">
            {proveedor?.nombre ?? (proveedorId === "google" ? "Google (Gemini)" : proveedorId ?? "Uso de proveedor")}
          </span>
          <button type="button" className="ghost task-mini-btn" onClick={cerrar}>
            ✕
          </button>
        </div>

        {proveedorId === "deepseek" && <BalanceDeepSeekPanel />}
        {faltaClave && <p className="usage-note" role="status">{proveedorId === "opencode" ? "Telo no detecta una sesión de OpenCode Console en el servidor." : proveedorId === "commandcode" ? "Telo no detecta la sesión de Command Code Go en el servidor." : `Falta la clave API para usar ${proveedor?.nombre ?? proveedorId}. El precio $0 no evita este requisito.`} <Link to="/ajustes" search={{ pestana: proveedorId === "opencode" || proveedorId === "commandcode" ? "servidor" : "proveedores" }}>Revisar proveedor</Link></p>}
        {cuerpo}
        {proveedorId === "codex" && (
          <CuotaSesionCodex />
        )}
        {proveedorId === "antigravity" && <CuotaSesionAntigravity />}

      </div>
    </>
  );
}

function LimitesOpenAILive({ datos, consumo, usos }: { datos?: LimitesOpenAI; consumo?: UsoOpenAIAdmin; usos: UsoModeloProveedor[] }) {
  const t = (valor: number | null) => valor === null ? "—" : valor.toLocaleString("es-EC");
  const usd = (valor: number | null) => valor === null ? "No informado" : `$${valor.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const nombreRecurso = (id: string) => id.split("/").at(-1)?.toLowerCase() ?? id.toLowerCase();
  return (
    <section className="usage-models" aria-label="Límites de OpenAI por proyecto">
      <div className="usage-models-heading">
        <span className="window-label">Límites de OpenAI</span>
        <span className="window-meta">{datos?.mensaje ?? "Consultando el proyecto…"}</span>
      </div>
      {consumo?.estado === "consultado" && (
        <>
          <div className="usage-window-totals">
            <div><span>Coste API · 30 días</span><strong>{usd(consumo.costoUsd30d)}</strong></div>
            <div><span>Solicitudes de texto</span><strong>{consumo.solicitudes30d.toLocaleString("es-EC")}</strong></div>
            <div><span>Tokens entrada / salida</span><strong>{compact(consumo.tokensEntrada30d)} / {compact(consumo.tokensSalida30d)}</strong></div>
          </div>
          {consumo.porModelo.length > 0 && (
            <ul className="usage-model-list" aria-label="Solicitudes de texto OpenAI por modelo en los últimos 30 días">
              {consumo.porModelo.map((fila) => <li className="usage-model-row" key={fila.modelo}>
                <code className="usage-model-name">{fila.modelo}</code>
                <span className="window-meta">{fila.solicitudes.toLocaleString("es-EC")} solicitudes · {compact(fila.tokensEntrada)} tokens entrada · {compact(fila.tokensSalida)} salida</span>
              </li>)}
            </ul>
          )}
        </>
      )}
      {consumo && consumo.estado !== "consultado" && <p className="usage-note usage-models-empty" role="status">{consumo.mensaje}</p>}
      {datos?.estado === "consultado" && datos.limites.length > 0 ? (
        <ul className="usage-model-list" aria-label="Topes configurados por modelo">
          {datos.limites.map((limite) => {
            const uso = usos.find((fila) => nombreRecurso(fila.modelo) === nombreRecurso(limite.modelo));
            return (
              <li className="usage-model-row" key={limite.modelo}>
                <code className="usage-model-name">{limite.modelo}</code>
                <span className="window-meta">Tope: {t(limite.rpm)} RPM · {t(limite.tpm)} TPM{limite.rpd === null ? "" : ` · ${t(limite.rpd)} RPD`}</span>
                <span className="window-meta">Telo, último minuto: {uso?.ejecucionesUltimoMinuto ?? 0} ejec. · {compact(uso?.tokensUltimoMinuto ?? 0)} tokens</span>
              </li>
            );
          })}
        </ul>
      ) : datos?.estado === "consultado" ? (
        <p className="usage-note usage-models-empty">OpenAI no devolvió límites para este proyecto.</p>
      ) : datos?.estado === "sin_configurar" ? (
        <p className="usage-note usage-models-empty">La consulta exacta requiere configurar <code>TELO_OPENAI_ADMIN_API_KEY</code> y <code>TELO_OPENAI_PROJECT_ID</code> en el servidor.</p>
      ) : datos ? (
        <p className="usage-note usage-models-empty" role="status">{datos.mensaje}</p>
      ) : null}
      <p className="usage-models-footnote">El coste y los tokens oficiales cubren toda la organización, incluidos clientes fuera de Telo; no representan saldo restante. Los topes por modelo requieren también un ID de proyecto. <a href="https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs" target="_blank" rel="noopener noreferrer">API de costes y uso</a> · <a href="https://developers.openai.com/api/docs/guides/rate-limits" target="_blank" rel="noopener noreferrer">límites y remanentes</a>.</p>
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

function UsoPorModelo({ proveedor, modeloSeleccionado, proveedorId, modelosCatalogo }: { proveedor: UsoProveedor | null; modeloSeleccionado: string | null; proveedorId: string | null; modelosCatalogo: ModelInfo[] }) {
  const modelos = proveedor?.porModelo ?? [];
  const corteDiario = proveedorId === "google" ? "desde medianoche Pacífico" : "desde medianoche UTC";
  const seleccionado = modeloSeleccionado && proveedor?.id === proveedorDeModelo(modeloSeleccionado)
    ? modeloSeleccionado
    : null;
  const lista = [...modelos];
  if (seleccionado && !lista.some((uso) => uso.modelo === seleccionado)) {
    lista.unshift({
      modelo: seleccionado,
      ejecucionesDesdeReinicioDiario: 0,
      tokensDesdeReinicioDiario: 0,
      tokensMedidosDesdeReinicioDiario: 0,
      tokensEstimadosDesdeReinicioDiario: 0,
      ejecucionesUltimas24h: 0,
      tokensUltimas24h: 0,
      tokensMedidosUltimas24h: 0,
      tokensEstimadosUltimas24h: 0,
      ejecucionesUltimoMinuto: 0,
      tokensUltimoMinuto: 0,
      ejecucionesUltimos30d: 0,
      ultimoRechazo: null,
    });
  }

  return (
    <section className="usage-models" aria-label="Uso registrado por modelo">
      <div className="usage-models-heading">
        <span className="window-label">Uso por modelo</span>
        <span className="window-meta">Registro de Telo · {corteDiario}</span>
      </div>
      {lista.length === 0 ? (
        <p className="usage-note usage-models-empty">Aún no hay ejecuciones registradas por modelo.</p>
      ) : (
        <ul className="usage-model-list">
          {lista.map((uso) => {
            const precio = modelosCatalogo.find((fila) => fila.id === uso.modelo);
            return (
              <li className="usage-model-row" key={uso.modelo}>
              <div className="usage-model-summary">
                <code className="usage-model-name">{uso.modelo}</code>
                <strong>{uso.ejecucionesDesdeReinicioDiario.toLocaleString("es-EC")} hoy · {compact(uso.tokensDesdeReinicioDiario)} tok.</strong>
              </div>
              {(uso.tokensMedidosDesdeReinicioDiario > 0 || uso.tokensEstimadosDesdeReinicioDiario > 0) && <span className="window-meta">Hoy: {compact(uso.tokensMedidosDesdeReinicioDiario)} medidos · {compact(uso.tokensEstimadosDesdeReinicioDiario)} estimados</span>}
              {precio && <span className="window-meta">Precio de catálogo: {formatPrice(precio)} por millón de tokens</span>}
              {(uso.tokensMedidosUltimas24h > 0 || uso.tokensEstimadosUltimas24h > 0) && <span className="window-meta">24 h: {compact(uso.tokensMedidosUltimas24h)} medidos · {compact(uso.tokensEstimadosUltimas24h)} estimados</span>}
              {uso.modelo === seleccionado && <span className="window-meta">Modelo seleccionado</span>}
              <span className="window-meta">Últimas 24 h: {uso.ejecucionesUltimas24h} ejec. · {compact(uso.tokensUltimas24h)} tokens</span>
              <span className="window-meta">Último minuto: {uso.ejecucionesUltimoMinuto} ejec. · {compact(uso.tokensUltimoMinuto)} tokens</span>
              {uso.ultimoRechazo && (
                <span className="usage-model-rejection" role="status">
                  Último rechazo: {etiquetaRechazo(uso.ultimoRechazo)} · {fechaRechazo(uso.ultimoRechazo.fecha)}
                </span>
              )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="usage-models-footnote">Los contadores cubren ejecuciones registradas por Telo; no equivalen a los límites ni al saldo total de la cuenta.</p>
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
  return (
    <section className="usage-codex-quota" aria-label="Cuota de Antigravity CLI">
      <div className="usage-window-heading">
        <div className="usage-window-copy">
          <span className="window-label">Cuota de Antigravity</span>
          <span className="window-meta">{cuota.isPending ? "Consultando /usage…" : datos?.comprobadoEn ? `Consultado ${new Intl.DateTimeFormat("es-EC", { hour: "2-digit", minute: "2-digit" }).format(new Date(datos.comprobadoEn))}` : "Sin consulta"}</span>
        </div>
        <button type="button" className="ghost task-mini-btn" aria-label="Actualizar cuota de Antigravity" title="Consultar ahora" disabled={actualizar.isPending} onClick={() => actualizar.mutate()}>{actualizar.isPending ? "…" : "↻"}</button>
      </div>
      {datos?.estado === "activo" && datos.respuesta && <pre className="usage-antigravity-texto">{datos.respuesta}</pre>}
      {datos?.estado === "sin_cli" && <p className="usage-note">Antigravity CLI no está instalada en el servidor.</p>}
      {datos?.estado === "sin_sesion" && <p className="usage-note">El proceso del servidor no puede leer la sesión o el keyring de Google. Revisa el login de Antigravity en Ajustes.</p>}
      {datos?.estado === "no_disponible" && <p className="usage-note">Antigravity no devolvió una cuota legible. {datos.detalle ?? "Vuelve a consultar."}</p>}
      {(cuota.isError || actualizar.isError) && <p className="usage-note" role="alert">No se pudo consultar /usage en este momento.</p>}
      <p className="usage-note">/usage informa la cuota de la cuenta Antigravity; es diferente de la Gemini API.</p>
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
