import { Fragment, useEffect, useRef, useState, type KeyboardEvent as TeclaReact, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { api, reintentarConsultaTransitoria, type ModelInfo, type Preferences, type ProviderStatus } from "../api";
import { EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { useEventosVivos } from "../lib/eventos-vivos";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { AlmacenamientoServidor, ErrorConReintento, EstadoServidor, useMuestrasLatencia } from "./servidor";
import "../styles-ajustes.css";
import { InstalarHerramienta } from "../components/instalar-herramienta";
import { AntigravityCard } from "../components/antigravity";
import { LoginCodexPanel } from "../components/login-codex";
import { SkillsEditor } from "../components/skills-editor";
import { TemaPanel } from "../components/settings/panel-tema";
import { NotificacionesPanel } from "../components/settings/panel-notificaciones";
import { LoadingSkeleton } from "../components/loading-skeleton";
import { SesionPanel } from "../components/settings/panel-sesion";
import { PanelConexiones } from "../components/settings/panel-conexiones";

const ALERT_OPTIONS = [50, 60, 70, 80, 90, 100];

type Pestana = "personalizacion" | "proveedores" | "conexiones" | "servidor" | "almacenamiento";
type IntegracionLocal = "cli" | "decodificador" | "tts";
const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: "personalizacion", texto: "Personalización" },
  { id: "proveedores", texto: "Proveedores IA" },
  { id: "conexiones", texto: "Conexiones" },
  { id: "servidor", texto: "Estado del servidor" },
  { id: "almacenamiento", texto: "Almacenamiento" },
];

// El prefijo de un modelo ("openai/...") no siempre es el id del proveedor en el servidor ("codex").
const PROVEEDOR_DE_PREFIJO: Record<string, string> = { openai: "codex" };
const PESTANAS_PROVEEDOR = [
  { id: "google", texto: "Google Gemini" },
  { id: "groq", texto: "Groq Cloud" },
  { id: "nvidia", texto: "NVIDIA NIM" },
  { id: "openrouter", texto: "OpenRouter" },
  { id: "opencode", texto: "OpenCode" },
] as const;
const PESTANAS_LOCALES: { id: IntegracionLocal; texto: string }[] = [
  { id: "cli", texto: "CLIs instalados" },
  { id: "decodificador", texto: "Decodificador" },
  { id: "tts", texto: "Voz · TTS" },
];

function proveedorDeModelo(modelo: string | null | undefined): string | null {
  if (!modelo) return null;
  const prefijo = modelo.split("/")[0];
  return PROVEEDOR_DE_PREFIJO[prefijo] ?? prefijo;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pestana: Pestana = useSearch({ from: "/ajustes" }).pestana ?? "proveedores";

  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const servidor = useQuery({ queryKey: ["servidor"], queryFn: api.serverStatus, refetchInterval: 30_000, retry: reintentarConsultaTransitoria });
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders });
  const latencia = useMuestrasLatencia();
  const install = useInstallPrompt();

  const [draft, setDraft] = useState<Preferences | null>(null);
  const [budgetText, setBudgetText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<string>(PESTANAS_PROVEEDOR[0].id);
  const [integracionLocal, setIntegracionLocal] = useState<IntegracionLocal>("cli");
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const conexionesTts = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: api.listMcpConnections,
    enabled: pestana === "proveedores" && integracionLocal === "tts",
    staleTime: 30_000,
  });

  const value: Preferences | undefined = draft ?? prefs.data;

  useEffect(() => {
    if (prefs.data) setBudgetText(prefs.data.monthlyBudgetUsd?.toString() ?? "");
  }, [prefs.data]);

  // Cambios de tareas en vivo: el estado del servidor se vuelve a pedir con una pausa, para no repetir la consulta en ráfaga.
  const pausa = useRef<number | undefined>(undefined);
  useEventosVivos({}, (evento) => {
    if (evento.tipo !== "tarea" && evento.tipo !== "evento") return;
    window.clearTimeout(pausa.current);
    pausa.current = window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["servidor"] });
    }, 1_500);
  });
  useEffect(() => () => window.clearTimeout(pausa.current), []);

  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === value?.defaultModel) ?? null;

  const update = (patch: Partial<Preferences>) => {
    if (!value) return;
    setSaved(false);
    setDraft({ ...value, ...patch });
  };

  const pickModel = (m: ModelInfo | null) => {
    setPickerOpen(false);
    update({
      defaultModel: m?.id ?? null,
      defaultEffort: m && value?.defaultEffort && m.variants.includes(value.defaultEffort) ? value.defaultEffort : null,
    });
  };

  const save = useMutation({
    mutationFn: (payload: Partial<Preferences>) => api.savePreferences(payload),
    onSuccess: (next) => {
      setDraft(null);
      setSaved(true);
      setBudgetText(next.monthlyBudgetUsd?.toString() ?? "");
      qc.invalidateQueries({ queryKey: ["preferences"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  const submit = () => {
    if (!draft) return;
    const trimmed = budgetText.trim().replace(",", ".");
    let budget: number | null = null;
    if (trimmed !== "") {
      budget = Number(trimmed);
      if (!Number.isFinite(budget) || budget < 0) {
        setLocalError("El presupuesto debe ser un número igual o mayor que cero.");
        return;
      }
    }
    setLocalError(null);
    // Enviar solo campos modificados evita que un modelo antiguo bloquee otro ajuste.
    const previo = prefs.data;
    const cambios: Partial<Preferences> = {};
    if (previo) {
      for (const campo of ["defaultModel", "defaultEffort", "budgetAlertPercent", "compartirContextoChats"] as const) {
        if (draft[campo] !== previo[campo]) cambios[campo] = draft[campo] as never;
      }
    }
    if (budget !== (previo?.monthlyBudgetUsd ?? null)) cambios.monthlyBudgetUsd = budget;
    save.mutate(cambios);
  };

  const savedBudget = prefs.data?.monthlyBudgetUsd?.toString() ?? "";
  const dirty = draft !== null || budgetText !== savedBudget;

  const descartar = () => {
    setDraft(null);
    setBudgetText(savedBudget);
    setLocalError(null);
    setSaved(false);
  };

  // Presupuesto que se está escribiendo (o guardado), para las cifras de cada proveedor.
  const presupuesto = (() => {
    const t = budgetText.trim().replace(",", ".");
    const n = Number(t);
    return t !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  })();

  // Primario y respaldo salen de los modelos elegidos, no de un orden fijo.
  const primarioId = proveedorDeModelo(value?.defaultModel);
  const respaldoId = proveedorDeModelo(prefs.data?.fallbackModel);
  const etiquetaDe = (p: ProviderStatus): string | null =>
    p.id === primarioId ? "Primario" : p.id === respaldoId ? "Respaldo" : p.id === "codex" ? "Sesión" : p.variable === null ? "Local" : null;

  // Diagnóstico interno para distinguir una clave que no expone modelos de una conexión válida.
  const modelosDe = (id: string): { total: number; enSelector: number } | null => {
    if (!models.isSuccess) return null;
    const del = models.data.models.filter((m) => proveedorDeModelo(m.id) === id);
    return { total: del.length, enSelector: del.filter((m) => m.recommended).length };
  };

  const elegirPestana = (p: Pestana) => {
    void navigate({ to: "/ajustes", search: { pestana: p }, replace: true });
  };

  const teclaPestana = (e: TeclaReact<HTMLButtonElement>, indice: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const paso = e.key === "ArrowRight" ? 1 : PESTANAS.length - 1;
    const siguiente = PESTANAS[(indice + paso) % PESTANAS.length];
    elegirPestana(siguiente.id);
    document.getElementById(`aj-tab-${siguiente.id}`)?.focus();
  };

  const configurados = proveedores.data?.filter((p) => p.configured).length ?? 0;
  const proveedoresPrincipales = proveedores.data?.filter((p) => PESTANAS_PROVEEDOR.some((tab) => tab.id === p.id)) ?? [];
  const proveedorActivo = proveedoresPrincipales.find((p) => p.id === proveedorSeleccionado) ?? proveedoresPrincipales[0];
  const proveedoresAdicionales = proveedores.data?.filter((p) => !PESTANAS_PROVEEDOR.some((tab) => tab.id === p.id)) ?? [];
  const proveedorCodex = proveedores.data?.find((p) => p.id === "codex");
  const conexionesTtsLista = (conexionesTts.data?.conexiones ?? []).filter((conexion) => /voice|voz|tts|speech/i.test(conexion.nombre));
  const datos = servidor.data;
  const herramientaMedia = (nombre: string) => datos?.herramientas.find((herramienta) => herramienta.nombre === nombre);
  const plataforma = datos?.proceso.plataforma;
  const eyebrow = ["Sistema / Control", plataforma].filter(Boolean).join(" · ");

  const estadoGuardado = dirty ? "Cambios sin guardar detectados" : saved ? "Cambios guardados" : "Sincronizado";

  return (
    <div className="aj-raiz">
      <form
        className="aj-page"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="aj-cabecera">
          <div className="aj-cabecera-texto">
            {eyebrow && <p className="aj-eyebrow">{eyebrow}</p>}
            <h1 className="aj-titulo">Ajustes y Servidor</h1>
            <p className="aj-descripcion">Personaliza Telo y administra sus motores de inferencia y credenciales.</p>
          </div>
        </header>

        <div className="aj-fila-pestanas">
          <div className="aj-pestanas" role="tablist" aria-label="Secciones de ajustes">
            {PESTANAS.map((p, indice) => (
              <button
                key={p.id}
                id={`aj-tab-${p.id}`}
                type="button"
                role="tab"
                className="aj-pestana"
                aria-selected={pestana === p.id}
                aria-controls={`aj-panel-${p.id}`}
                tabIndex={pestana === p.id ? 0 : -1}
                onClick={() => elegirPestana(p.id)}
                onKeyDown={(e) => teclaPestana(e, indice)}
              >
                {p.texto}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" id={`aj-panel-${pestana}`} aria-labelledby={`aj-tab-${pestana}`} className="aj-panel">
          {pestana === "personalizacion" && <div className="aj-stack"><TemaPanel /></div>}
          {pestana === "conexiones" && <PanelConexiones />}
          {pestana === "proveedores" && (
            <div className="aj-stack">
              <section className="aj-kpis" aria-label="Telemetría de la instancia">
                <Kpi
                  etiqueta="Tiempo activo"
                  icono={<IconoReloj />}
                  valor={datos ? duracionCorta(datos.proceso.segundosActivo) : "—"}
                  pie={datos ? `Desde ${fechaUtc(datos.proceso.arrancado)} UTC` : "Sin datos"}
                />
                <Kpi
                  etiqueta="Workers activos"
                  icono={<IconoRed />}
                  valor={datos ? `${datos.tareas.en_curso} / ${datos.tareas.max_simultaneas}` : "—"}
                  pie={datos ? `${datos.tareas.en_cola} en cola` : "Sin datos"}
                  barra={datos ? Math.min(1, datos.tareas.en_curso / datos.tareas.max_simultaneas) : undefined}
                />
                <Kpi
                  etiqueta="Latencia API"
                  icono={<IconoRayo />}
                  valor={latencia.ms != null ? `${latencia.ms} ms` : latencia.midiendo ? "…" : "—"}
                  pie={
                    latencia.p50 != null && latencia.p99 != null
                      ? `p50: ${latencia.p50} ms · p99: ${latencia.p99} ms`
                      : "Sin medidas todavía"
                  }
                />
                <Kpi
                  etiqueta="Memoria RAM"
                  icono={<IconoChip />}
                  valor={datos ? `${datos.proceso.rssMb.toLocaleString("es", { maximumFractionDigits: 1 })} MB` : "—"}
                  pie="RSS del proceso"
                />
              </section>

              <section className="aj-seccion" aria-labelledby="aj-motores-titulo">
                <div className="aj-seccion-cabecera">
                  <div className="aj-titulo-con-chip">
                    <h2 id="aj-motores-titulo" className="aj-titulo-seccion">
                      Motores de Inferencia
                    </h2>
                    <span className="aj-chip">
                      {proveedores.data ? `${configurados} configurados` : "Consultando…"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="aj-btn"
                    disabled
                    title="La app todavía no puede añadir motores: los proveedores se configuran en el servidor."
                  >
                    <IconoMas />
                    Añadir motor personalizado
                  </button>
                </div>

                {proveedores.isError && (
                  <ErrorConReintento error={proveedores.error} onReintentar={() => void proveedores.refetch()} />
                )}
                {proveedores.isPending && !proveedores.data && <LoadingSkeleton tipo="tarjetas" cantidad={3} />}
                {proveedores.data && proveedoresPrincipales.length > 0 && (
                  <>
                    <div className="aj-proveedores-pestanas" role="tablist" aria-label="Proveedores de inferencia">
                      {PESTANAS_PROVEEDOR.map((tab, indice) => {
                        const proveedor = proveedoresPrincipales.find((p) => p.id === tab.id);
                        if (!proveedor) return null;
                        const conectado = proveedor.configured && proveedor.enAgente;
                        const seleccionado = proveedorActivo?.id === tab.id;
                        return (
                          <button
                            key={tab.id}
                            id={`aj-proveedor-tab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={seleccionado}
                            aria-controls={`aj-proveedor-panel-${tab.id}`}
                            tabIndex={seleccionado ? 0 : -1}
                            className={`aj-proveedor-tab${seleccionado ? " is-activa" : ""}`}
                            onClick={() => setProveedorSeleccionado(tab.id)}
                            onKeyDown={(event) => {
                              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                              event.preventDefault();
                              const direccion = event.key === "ArrowRight" ? 1 : -1;
                              const siguiente = PESTANAS_PROVEEDOR[(indice + direccion + PESTANAS_PROVEEDOR.length) % PESTANAS_PROVEEDOR.length];
                              setProveedorSeleccionado(siguiente.id);
                              document.getElementById(`aj-proveedor-tab-${siguiente.id}`)?.focus();
                            }}
                          >
                            <span className={`aj-proveedor-punto${conectado ? " is-conectado" : ""}`} aria-hidden="true" />
                            {tab.texto}
                          </button>
                        );
                      })}
                    </div>
                    {proveedorActivo && (
                      <TarjetaProveedor
                        key={proveedorActivo.id}
                        p={proveedorActivo}
                        etiqueta={etiquetaDe(proveedorActivo)}
                        modelos={modelosDe(proveedorActivo.id)}
                        tabId={`aj-proveedor-panel-${proveedorActivo.id}`}
                        tabLabelId={`aj-proveedor-tab-${proveedorActivo.id}`}
                      />
                    )}
                    {proveedoresAdicionales.length > 0 && (
                      <div className="aj-proveedores-adicionales" aria-label="Otras APIs">
                        {proveedoresAdicionales.filter((p) => p.id !== "codex").map((p) => (
                          <TarjetaProveedor key={p.id} p={p} etiqueta={etiquetaDe(p)} modelos={modelosDe(p.id)} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="aj-seccion" aria-labelledby="aj-herramientas-locales-titulo">
                <div className="aj-seccion-cabecera">
                  <div>
                    <h2 id="aj-herramientas-locales-titulo" className="aj-titulo-seccion">CLIs y herramientas locales</h2>
                    <p className="aj-nota">Estado de los programas del servidor que usan las tareas y el flujo de medios.</p>
                  </div>
                </div>
                <div className="aj-proveedores-pestanas" role="tablist" aria-label="Integraciones locales">
                  {PESTANAS_LOCALES.map((tab, indice) => {
                    const seleccionado = integracionLocal === tab.id;
                    return (
                      <button
                        key={tab.id}
                        id={`aj-local-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={seleccionado}
                        aria-controls={`aj-local-panel-${tab.id}`}
                        tabIndex={seleccionado ? 0 : -1}
                        className={`aj-proveedor-tab${seleccionado ? " is-activa" : ""}`}
                        onClick={() => setIntegracionLocal(tab.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                          event.preventDefault();
                          const direccion = event.key === "ArrowRight" ? 1 : -1;
                          const siguiente = PESTANAS_LOCALES[(indice + direccion + PESTANAS_LOCALES.length) % PESTANAS_LOCALES.length];
                          setIntegracionLocal(siguiente.id);
                          document.getElementById(`aj-local-tab-${siguiente.id}`)?.focus();
                        }}
                      >
                        {tab.texto}
                      </button>
                    );
                  })}
                </div>
                <div
                  id={`aj-local-panel-${integracionLocal}`}
                  role="tabpanel"
                  aria-labelledby={`aj-local-tab-${integracionLocal}`}
                  className="aj-integracion-local-panel"
                  tabIndex={0}
                >
                  {integracionLocal === "cli" && (
                    <div className="aj-stack">
                      <div className="aj-herramientas-locales" aria-label="Estado de CLI del servidor">
                        {(["opencode", "codex", "agy", "script"] as const).map((nombre) => {
                          const herramienta = herramientaMedia(nombre);
                          const etiqueta = nombre === "agy" ? "Antigravity CLI" : nombre === "script" ? "Terminal remota para OAuth" : `${nombre[0].toUpperCase()}${nombre.slice(1)} CLI`;
                          return (
                            <div className="aj-herramienta-local" key={nombre}>
                              <div><strong>{etiqueta}</strong><small>{herramienta?.version ?? (servidor.isPending ? "Consultando estado del servidor…" : "Versión no disponible")}</small></div>
                              <span className={`aj-estado-proveedor${herramienta?.disponible ? " is-conectado" : herramienta ? " is-error" : ""}`} role="status">
                                <span className="aj-proveedor-punto" aria-hidden="true" />{herramienta?.disponible ? "Instalado" : herramienta ? "No instalado" : "Sin datos"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="aj-proveedores-adicionales" aria-label="Acceso a sesiones CLI">
                        {proveedorCodex && <TarjetaProveedor p={proveedorCodex} etiqueta={etiquetaDe(proveedorCodex)} modelos={modelosDe(proveedorCodex.id)} />}
                        <AntigravityCard />
                      </div>
                    </div>
                  )}
                  {integracionLocal === "decodificador" && (
                    <div className="aj-herramientas-locales">
                      <p className="aj-nota">FFmpeg decodifica y convierte audio y video; FFprobe comprueba metadatos y duración.</p>
                      {(["ffmpeg", "ffprobe"] as const).map((nombre) => {
                        const herramienta = herramientaMedia(nombre);
                        return (
                          <div className="aj-herramienta-local" key={nombre}>
                            <div>
                              <strong>{nombre === "ffmpeg" ? "FFmpeg" : "FFprobe"}</strong>
                              <small>{herramienta?.version ?? (servidor.isPending ? "Consultando estado del servidor…" : "Versión no disponible")}</small>
                            </div>
                            <span className={`aj-estado-proveedor${herramienta?.disponible ? " is-conectado" : herramienta ? " is-error" : ""}`} role="status">
                              <span className="aj-proveedor-punto" aria-hidden="true" />{herramienta?.disponible ? "Instalado" : herramienta ? "No instalado" : "Sin datos"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {integracionLocal === "tts" && (
                    <div className="aj-herramientas-locales">
                      <p className="aj-nota">Telo usa un proveedor MCP de voz, como VoiceStudio. Que esté habilitado confirma el registro, no una generación de audio.</p>
                      {conexionesTts.isPending && <p className="aj-nota">Consultando conexiones…</p>}
                      {conexionesTts.isError && <p className="aj-error" role="alert">{errorText(conexionesTts.error)}</p>}
                      {conexionesTts.isSuccess && (conexionesTtsLista.length ? conexionesTtsLista.map((conexion) => (
                        <div className="aj-herramienta-local" key={conexion.id}>
                          <div><strong>{conexion.nombre}</strong><small>Servidor MCP de voz · la generación se verifica desde la tarea que lo usa</small></div>
                          <span className={`aj-estado-proveedor${conexion.habilitada ? " is-conectado" : " is-error"}`} role="status">
                            <span className="aj-proveedor-punto" aria-hidden="true" />{conexion.habilitada ? "Habilitado" : "Pausado"}
                          </span>
                        </div>
                      )) : (
                        <div className="aj-herramienta-local">
                          <div><strong>No se detectó un MCP con nombre de voz</strong><small>Añade VoiceStudio u otro servidor MCP que exponga una herramienta de voz en Ajustes → Conexiones. El nombre permite identificarlo, pero no confirma que genere audio.</small></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="aj-seccion" aria-labelledby="aj-funciones-auxiliares-titulo">
                <h2 id="aj-funciones-auxiliares-titulo" className="aj-titulo-seccion">Funciones auxiliares</h2>
                <JevPanel />
              </section>

              <section className="aj-seccion" aria-labelledby="aj-skills-titulo">
                <h2 id="aj-skills-titulo" className="aj-titulo-seccion">
                  Skills
                </h2>
                <article className="aj-tarjeta">
                  <SkillsEditor ayuda="Globales: Telo las comparte con OpenCode y Codex, y las activa para cualquier modelo compatible según la tarea. No migra proyectos a Vite+ ni configura Void automáticamente." />
                </article>
              </section>

              {!value && prefs.isError && <p className="aj-error" role="alert">No se pudieron cargar los ajustes.</p>}
              {!value && !prefs.isError && <p className="aj-nota">Cargando ajustes…</p>}

              {value && (
                <>
                  <article className="aj-tarjeta" aria-labelledby="aj-modelos-titulo">
                    <h3 id="aj-modelos-titulo" className="aj-tarjeta-titulo-simple">
                      Modelos
                    </h3>

                    <div className="aj-fila-campo" role="group" aria-labelledby="aj-modelo-predeterminado">
                      <span id="aj-modelo-predeterminado" className="aj-campo-etiqueta-fija">
                        Modelo predeterminado
                      </span>
                      <div className="anchor">
                        <button
                          type="button"
                          className="model-chip"
                          aria-haspopup="dialog"
                          aria-expanded={pickerOpen}
                          onClick={() => setPickerOpen((o) => !o)}
                        >
                          <span className="model-chip-name">{modelInfo?.name ?? value.defaultModel ?? "Predeterminado"}</span>
                        </button>
                        {pickerOpen && (
                          <ModelPicker
                            models={modelList}
                            currentId={value.defaultModel}
                            onSelect={pickModel}
                            onClose={() => setPickerOpen(false)}
                          />
                        )}
                      </div>
                    </div>

                    <div className="aj-fila-campo">
                      <span id="aj-esfuerzo" className="aj-campo-etiqueta-fija">
                        Esfuerzo
                      </span>
                      <EffortControl
                        variants={modelInfo?.variants ?? []}
                        value={value.defaultEffort}
                        disabled={!value.defaultModel}
                        onChange={(effort) => update({ defaultEffort: effort })}
                      />
                    </div>

                    <SelectorRespaldo models={models.data?.models ?? []} modelosListos={models.isSuccess} prefs={prefs.data} />
                    {models.isError && (
                      <div className="aj-error-bloque" role="alert">
                        <p className="aj-error">{errorText(models.error)}</p>
                        <button type="button" className="aj-btn" onClick={() => void models.refetch()}>
                          Reintentar
                        </button>
                      </div>
                    )}
                  </article>

                  <article className="aj-tarjeta" aria-labelledby="aj-presupuesto-titulo">
                    <div className="aj-tarjeta-cabecera">
                      <h3 id="aj-presupuesto-titulo" className="aj-tarjeta-titulo-simple">
                        Presupuesto mensual y aviso
                      </h3>
                      <span className="aj-mono aj-dato-cabecera">
                        {presupuesto !== null ? `US$ ${presupuesto.toFixed(2)} / mes` : "Sin límite"}
                      </span>
                    </div>

                    <div className="aj-fila-campo">
                      <label htmlFor="budget" className="aj-campo-etiqueta-fija">
                        Límite mensual (USD)
                      </label>
                      <input
                        id="budget"
                        className="aj-input"
                        inputMode="decimal"
                        placeholder="Sin límite"
                        value={budgetText}
                        onChange={(e) => {
                          setSaved(false);
                          setBudgetText(e.target.value);
                          if (!draft && value) setDraft({ ...value });
                        }}
                      />
                    </div>

                    <div className="aj-fila-campo">
                      <span id="aj-aviso" className="aj-campo-etiqueta-fija">
                        Avisar al
                      </span>
                      <div className="segmented" role="group" aria-labelledby="aj-aviso">
                        {ALERT_OPTIONS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            aria-pressed={value.budgetAlertPercent === p}
                            onClick={() => update({ budgetAlertPercent: p })}
                          >
                            {p} %
                          </button>
                        ))}
                      </div>
                    </div>

                    {localError && (
                      <p className="aj-error" role="alert">
                        {localError}
                      </p>
                    )}
                  </article>
                </>
              )}

              <GithubPanel />

              <section className="aj-seccion" aria-labelledby="aj-aplicacion-titulo">
                <h2 id="aj-aplicacion-titulo" className="aj-titulo-seccion">
                  Aplicación
                </h2>
                <div className="aj-stack">
                  <article className="aj-tarjeta" aria-labelledby="aj-contexto-chats-titulo">
                    <h3 id="aj-contexto-chats-titulo" className="aj-tarjeta-titulo-simple">
                      Contexto de los chats
                    </h3>
                    <p className="aj-nota">
                      Comparte los mensajes recientes de tus conversaciones con las nuevas tareas para darles contexto continuo del proyecto.
                    </p>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={value?.compartirContextoChats ?? false}
                        onChange={(e) => update({ compartirContextoChats: e.target.checked })}
                      />
                      <span>Compartir contexto entre chats y tareas</span>
                    </label>
                  </article>

                  <article className="aj-tarjeta" aria-labelledby="aj-instalar-titulo">
                    <h3 id="aj-instalar-titulo" className="aj-tarjeta-titulo-simple">
                      Instalar la aplicación
                    </h3>
                    <p className="aj-nota">Instala Telo como aplicación independiente en tu teléfono o PC.</p>
                    {isStandalone() ? (
                      <p className="aj-nota">Ya está instalada como aplicación independiente en este dispositivo.</p>
                    ) : install.canInstall ? (
                      <div>
                        <button type="button" className="aj-btn aj-btn-primario" onClick={() => void install.promptInstall()}>
                          Instalar Telo
                        </button>
                      </div>
                    ) : isIOS() ? (
                      <p className="aj-nota">En iPhone / Safari: toca Compartir y luego “Agregar a pantalla de inicio”.</p>
                    ) : (
                      <p className="aj-nota">
                        Tu navegador no ofrece instalarla desde aquí. Abre el menú del navegador y selecciona “Instalar app”.
                      </p>
                    )}
                  </article>

                  <NotificacionesPanel />
                  <SesionPanel />
                </div>
              </section>
            </div>
          )}

          {pestana === "servidor" && <EstadoServidor latencia={latencia} />}
          {pestana === "almacenamiento" && <AlmacenamientoServidor />}
        </div>

        {save.isError && (
          <p className="aj-error" role="alert">
            {errorText(save.error)}
          </p>
        )}

        {value && (pestana !== "almacenamiento" || dirty) && (
          <div className="aj-barra-guardado">
            <div className="aj-estado-guardado">
              <span className={`aj-punto${dirty ? "" : " is-ok"}`} aria-hidden="true" />
              <span role="status">{estadoGuardado}</span>
            </div>
            <div className="aj-acciones-guardado">
              <button type="button" className="aj-btn" onClick={descartar} disabled={!dirty || save.isPending}>
                Descartar
              </button>
              <button type="submit" className="aj-btn aj-btn-primario" disabled={!dirty || save.isPending}>
                <IconoGuardar />
                {save.isPending ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

// Selector del modelo de respaldo: se guarda al elegirlo, como antes.
function SelectorRespaldo({
  models,
  modelosListos,
  prefs,
}: {
  models: ModelInfo[];
  modelosListos: boolean;
  prefs: Preferences | undefined;
}) {
  const qc = useQueryClient();
  const guardar = useMutation({
    mutationFn: (fallbackModel: string | null) => api.savePreferences({ fallbackModel }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["preferences"] }),
  });

  const guardado = prefs?.fallbackModel ?? null;
  const valor = guardar.isPending ? (guardar.variables ?? "") : (guardado ?? "");

  const opciones = models.filter((m) => m.recommended).map((m) => ({ id: m.id, name: m.name }));
  if (valor && !opciones.some((o) => o.id === valor)) {
    opciones.unshift({ id: valor, name: models.find((m) => m.id === valor)?.name ?? valor });
  }

  return (
    <div className="aj-fila-campo">
      <label htmlFor="modelo-respaldo" className="aj-campo-etiqueta-fija">
        Modelo de respaldo
      </label>
      <div className="aj-campo-doble">
        <select
          id="modelo-respaldo"
          className="aj-input"
          value={valor}
          disabled={!prefs || guardar.isPending || !modelosListos}
          onChange={(e) => guardar.mutate(e.target.value || null)}
        >
          <option value="">Ninguno</option>
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {guardar.isPending && <span className="aj-nota" role="status">Guardando…</span>}
        {guardar.isSuccess && !guardar.isPending && <span className="aj-nota" role="status">Guardado.</span>}
      </div>
      {guardar.isError && (
        <p className="aj-error" role="alert">
          {errorText(guardar.error)}
        </p>
      )}
    </div>
  );
}

function Kpi({
  etiqueta,
  icono,
  valor,
  pie,
  barra,
}: {
  etiqueta: string;
  icono: ReactNode;
  valor: string;
  pie: string;
  barra?: number;
}) {
  const porcentaje = barra !== undefined ? Math.round(barra * 100) : 0;
  return (
    <article className="aj-kpi">
      <div className="aj-kpi-cabecera">
        <span className="aj-kpi-etiqueta">{etiqueta}</span>
        <span className="aj-kpi-icono" aria-hidden="true">
          {icono}
        </span>
      </div>
      <p className="aj-kpi-valor">{valor}</p>
      <p className="aj-kpi-pie">{pie}</p>
      {barra !== undefined && (
        <div className="aj-barra" role="img" aria-label={`${porcentaje} % ocupado`}>
          <div className="aj-barra-relleno" style={{ width: `${porcentaje}%` }} />
        </div>
      )}
    </article>
  );
}

function TarjetaProveedor({
  p,
  etiqueta,
  modelos,
  tabId,
  tabLabelId,
}: {
  p: ProviderStatus;
  etiqueta: string | null;
  // Modelos del proveedor en el catálogo de OpenCode (total) y los que salen en el selector del chat.
  modelos: { total: number; enSelector: number } | null;
  tabId?: string;
  tabLabelId?: string;
}) {
  // Codex está activo cuando hay sesión autenticada; los otros motores requieren clave disponible para agentes.
  const listo = p.id === "codex" || p.id === "opencode" ? p.configured : p.configured && p.enAgente;
  const sinClave = p.variable === null;
  const nota = notaEstado(p, modelos);
  const esMotorDirecto = p.id !== "opencode" && p.id !== "codex" && PESTANAS_PROVEEDOR.some((tab) => tab.id === p.id);
  const [credencialesAbiertas, setCredencialesAbiertas] = useState(!p.configured);
  useEffect(() => {
    if (p.configured) setCredencialesAbiertas(false);
  }, [p.configured]);
  const prueba = useMutation({ mutationFn: () => api.testProvider(p.id) });
  const estadoPrueba = prueba.data?.ok
    ? p.enAgente ? "Conexión comprobada" : "API responde · clave no llega al agente"
    : prueba.data ? "No se pudo conectar" : listo ? "Credenciales listas" : p.configured ? "Clave no disponible para agentes" : "Sin clave configurada";
  const errorPrueba = prueba.data?.error === "provider_key_rejected"
    ? "El proveedor rechazó la clave. Edítala y vuelve a probar."
    : prueba.data?.error === "provider_rate_limited"
      ? "El proveedor limitó la consulta. Espera un momento y vuelve a probar."
      : prueba.data?.error === "provider_key_missing"
        ? "Guarda una clave para probar la conexión."
        : prueba.data?.error === "provider_test_unsupported"
          ? "Este proveedor no admite una prueba desde Telo."
          : prueba.data && !prueba.data.ok
            ? "No se pudo consultar el catálogo. Revisa la clave y el estado del proveedor."
            : prueba.isError
              ? errorText(prueba.error)
              : null;
  const endpoints: Record<string, string> = {
    google: "generativelanguage.googleapis.com",
    groq: "api.groq.com/openai/v1",
    nvidia: "integrate.api.nvidia.com/v1",
    openrouter: "openrouter.ai/api/v1",
  };

  return (
    <article className={`aj-tarjeta${esMotorDirecto ? " aj-tarjeta-proveedor" : ""}`} aria-labelledby={tabId ? tabLabelId : `aj-prov-${p.id}`} id={tabId} role={tabId ? "tabpanel" : undefined}>
      <div className="aj-tarjeta-cabecera">
        <div className="aj-tarjeta-titulo">
          <span className="aj-icono" aria-hidden="true">
            <IconoProveedor id={p.id} />
          </span>
          <div className="aj-tarjeta-texto">
            <div className="aj-nombre">
              <h3 id={`aj-prov-${p.id}`}>{p.name}</h3>
              {etiqueta && <span className="aj-etiqueta">{etiqueta}</span>}
            </div>
            <p className="aj-descripcion-tarjeta">{p.hint}</p>
          </div>
        </div>
        {p.id === "opencode" ? (
          <div className={`aj-estado-proveedor${p.configured ? " is-conectado" : " is-error"}`} role="status">
            <span className="aj-proveedor-punto" aria-hidden="true" />
            {p.configured ? "CLI instalado en el servidor" : "CLI no instalado"}
          </div>
        ) : esMotorDirecto ? (
          <div className={`aj-estado-proveedor${prueba.data?.ok ? " is-conectado" : errorPrueba ? " is-error" : ""}`} role="status">
            <span className="aj-proveedor-punto" aria-hidden="true" />
            {prueba.isPending ? "Probando conexión…" : estadoPrueba}
          </div>
        ) : (
          <div className="aj-interruptor">
            <span>{listo ? "Activo" : "Inactivo"}</span>
            <button
              type="button"
              role="switch"
              aria-checked={listo}
              aria-label={`${p.name}: activo`}
              className="aj-switch"
              disabled
              title={p.id === "codex"
                ? "Refleja si el servidor tiene una sesión de Codex iniciada."
                : "Se activa al guardar la clave aquí o al configurarla en el archivo de entorno del servidor. La app no lo apaga."}
            />
          </div>
        )}
        {p.guardable && (
          <button
            type="button"
            className="aj-texto-btn"
            aria-expanded={credencialesAbiertas}
            aria-controls={`aj-prov-campos-${p.id}`}
            onClick={() => setCredencialesAbiertas((abiertas) => !abiertas)}
          >
            {credencialesAbiertas ? "Ocultar ajustes" : "Mostrar ajustes"}
          </button>
        )}
      </div>

      {(credencialesAbiertas || !p.guardable) && <div className="aj-campos" id={`aj-prov-campos-${p.id}`}>
        {p.id === "codex" ? (
          <div className="aj-campo">
            <div className="aj-campo-etiqueta"><span>Sesión de Codex</span></div>
            <div className="aj-entrada">
              <span>{p.sesion ? "Iniciada en el servidor; credenciales protegidas" : "Sin sesión de Codex"}</span>
            </div>
          </div>
        ) : p.guardable ? (
          <CampoClave p={p} />
        ) : p.id !== "opencode" ? (
          <div className="aj-campo">
            <div className="aj-campo-etiqueta">
              <span>
                Clave API{p.variable ? <> · <span className="aj-mono">{p.variable}</span></> : null}
              </span>
            </div>
            <div className="aj-entrada">
              <span className={p.configured || sinClave ? "" : "aj-entrada-vacia"}>
                {sinClave
                  ? "No aplica: usa el CLI del servidor"
                  : p.configured
                    ? "•".repeat(24)
                    : "Sin clave configurada"}
              </span>
            </div>
          </div>
        ) : null}

        {p.id !== "codex" && <div className="aj-campo">
          <div className="aj-campo-etiqueta">
            <span>{p.id === "opencode" ? "Tipo de conexión" : "Endpoint base"}</span>
          </div>
          <div className="aj-entrada aj-entrada-vacia">
            <span>{p.id === "opencode" ? "CLI local del servidor; las claves se configuran por proveedor" : sinClave ? "No aplica: corre en el servidor" : endpoints[p.id] ?? "Gestionado por el servidor"}</span>
          </div>
        </div>}
      </div>}
      {esMotorDirecto && (
        <div className="aj-probar-proveedor">
          <button type="button" className="aj-btn" disabled={!p.configured || prueba.isPending} onClick={() => prueba.mutate()}>
            {prueba.isPending ? "Probando…" : "Probar conexión"}
          </button>
          {prueba.data?.ok && <p className="aj-nota" role="status">Catálogo consultado. No se generó texto ni se consumieron tokens.</p>}
          {errorPrueba && <p className="aj-error" role="alert">{errorPrueba}</p>}
        </div>
      )}
      {nota && <p className="aj-nota aj-nota-aviso">{nota}</p>}
      {p.id === "opencode" && !p.configured && <InstalarHerramienta id="opencode" nombre="OpenCode" />}
      {p.id === "codex" && (
        <InstalarHerramienta id="codex" nombre="Codex">
          <LoginCodexPanel />
        </InstalarHerramienta>
      )}
    </article>
  );
}

// Clave de un proveedor que se guarda desde la app, cifrada en el servidor. La API solo dice si está guardada:
// el valor no vuelve a mostrarse. Los botones son `type="button"` porque toda la página es un formulario.
function CampoClave({ p }: { p: ProviderStatus }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState("");
  const [verValor, setVerValor] = useState(false);
  const [editando, setEditando] = useState(!p.guardada && !p.configured);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idCampo = `aj-clave-${p.id}`;

  // Cambiar la clave cambia qué modelos hay disponibles, así que la lista se vuelve a pedir.
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["providers"] });
    void qc.invalidateQueries({ queryKey: ["models"] });
  };

  const guardar = useMutation({
    mutationFn: (texto: string) => api.setProviderKey(p.id, texto),
    onSuccess: () => {
      setValor("");
      setEditando(false);
      setError(null);
      setAviso("Clave guardada. Se usará en los próximos envíos.");
      refrescar();
    },
    onError: (e) => {
      setAviso(null);
      setError(errorText(e));
    },
  });

  const quitar = useMutation({
    mutationFn: () => api.deleteProviderKey(p.id),
    onSuccess: () => {
      setError(null);
      setAviso("Clave quitada.");
      setValor("");
      setEditando(true);
      refrescar();
    },
    onError: (e) => {
      setAviso(null);
      setError(errorText(e));
    },
  });

  const ocupado = guardar.isPending || quitar.isPending;
  const enviar = () => {
    const texto = valor.trim();
    if (!texto || ocupado) return;
    setAviso(null);
    setError(null);
    guardar.mutate(texto);
  };

  const estado = p.guardada
    ? "Guardada cifrada en el servidor. No se vuelve a mostrar."
    : p.configured
      ? `Viene del archivo de entorno del servidor (${p.variable}).`
      : "Sin clave configurada.";

  return (
    <div className="aj-campo aj-campo-clave">
      <div className="aj-campo-etiqueta">
        <label htmlFor={editando ? idCampo : undefined}>Clave API · <span className="aj-mono">{p.variable}</span></label>
        {!editando && <button type="button" className="aj-texto-btn" onClick={() => setEditando(true)}>Editar</button>}
        {editando && <button type="button" className="aj-texto-btn" onClick={() => { setEditando(false); setValor(""); setVerValor(false); }}>Cancelar</button>}
      </div>
      {editando ? (
        <div className="aj-clave-fila">
          <input
            id={idCampo}
            className="aj-input aj-mono"
            type={verValor ? "text" : "password"}
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={p.guardada || p.configured ? "Pega una clave nueva" : "Pega la clave"}
            value={valor}
            disabled={ocupado}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              enviar();
            }}
          />
          <button
            type="button"
            className="aj-icono-btn"
            onClick={() => setVerValor((v) => !v)}
            aria-label={verValor ? "Ocultar clave escrita" : "Mostrar clave escrita"}
            aria-pressed={verValor}
            title={verValor ? "Ocultar clave" : "Mostrar clave"}
          >
            <IconoVisibilidad visible={verValor} />
          </button>
          <button type="button" className="aj-btn aj-btn-primario" onClick={enviar} disabled={!valor.trim() || ocupado}>
            {guardar.isPending ? "Guardando…" : "Guardar clave"}
          </button>
          {p.guardada && <button type="button" className="aj-btn" onClick={() => quitar.mutate()} disabled={ocupado}>{quitar.isPending ? "Quitando…" : "Quitar"}</button>}
        </div>
      ) : (
        <div className="aj-clave-guardada">
          <span className="aj-entrada" aria-label="Clave configurada y oculta">••••••••••••••••</span>
          {p.guardada && <button type="button" className="aj-btn" onClick={() => quitar.mutate()} disabled={ocupado}>{quitar.isPending ? "Quitando…" : "Quitar"}</button>}
        </div>
      )}
      <p className="aj-nota">{estado}</p>
      {aviso && <p className="aj-nota" role="status">{aviso}</p>}
      {error && <p className="aj-error" role="alert">{error}</p>}
    </div>
  );
}

function JevPanel() {
  const qc = useQueryClient();
  const estado = useQuery({ queryKey: ["jev"], queryFn: api.getJev });
  const [valor, setValor] = useState("");
  const [visible, setVisible] = useState(false);
  const [configuracionAbiertaManual, setConfiguracionAbiertaManual] = useState<boolean | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: api.setJevKey,
    onSuccess: () => {
      setValor("");
      setVisible(false);
      setConfiguracionAbiertaManual(false);
      setError(null);
      setAviso("Clave guardada cifrada en el servidor. Jev se activará en las próximas evaluaciones.");
      qc.removeQueries({ queryKey: ["jev-recomendaciones"] });
      void qc.invalidateQueries({ queryKey: ["jev"] });
    },
    onError: (err) => {
      setAviso(null);
      setError(errorText(err));
    },
  });
  const quitar = useMutation({
    mutationFn: api.deleteJevKey,
    onSuccess: () => {
      setError(null);
      setAviso("Clave eliminada. Telo vuelve a usar sus sugerencias locales y guarda la memoria con sus reglas actuales.");
      qc.removeQueries({ queryKey: ["jev-recomendaciones"] });
      void qc.invalidateQueries({ queryKey: ["jev"] });
    },
    onError: (err) => {
      setAviso(null);
      setError(errorText(err));
    },
  });
  const probar = useMutation({
    mutationFn: api.testJev,
    onSuccess: () => {
      setError(null);
      setAviso("Conexión correcta. La prueba realizó una evaluación mínima y puede consumir tokens.");
      void qc.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (err) => {
      setAviso(null);
      setError(errorText(err));
    },
  });
  const ocupado = guardar.isPending || quitar.isPending || probar.isPending;
  const configuracionAbierta = configuracionAbiertaManual ?? !estado.data?.configurada;
  const enviar = () => {
    if (!valor.trim() || ocupado || !estado.data?.disponible) return;
    setAviso(null);
    setError(null);
    guardar.mutate(valor.trim());
  };

  return (
    <article className="aj-tarjeta aj-jev" aria-labelledby="aj-jev-titulo">
      <div className="aj-jev-cabecera">
        <h3 id="aj-jev-titulo" className="aj-tarjeta-titulo-simple">TypeSafe Jev</h3>
        <button
          type="button"
          className="aj-texto-btn"
          aria-expanded={configuracionAbierta}
          aria-controls="aj-jev-configuracion"
          onClick={() => setConfiguracionAbiertaManual((abierta) => !(abierta ?? !estado.data?.configurada))}
        >
          {configuracionAbierta ? "Ocultar configuración" : "Editar configuración"}
        </button>
      </div>
      <div>
        <p className="aj-nota">
          Jev ordenará sugerencias, puntuará propuestas de memoria y recomendará una categoría para tareas. Telo decide qué guardar; el modelo, los permisos y las aprobaciones de Git siguen bajo sus reglas.
        </p>
      </div>
      {configuracionAbierta && <div className="aj-campo" id="aj-jev-configuracion">
        <div className="aj-campo-etiqueta">
          <label htmlFor="aj-jev-clave">Clave API</label>
          <button
            type="button"
            className="aj-icono-btn"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar clave escrita" : "Mostrar clave escrita"}
            aria-pressed={visible}
            title={visible ? "Ocultar clave" : "Mostrar clave"}
          >
            <IconoVisibilidad visible={visible} />
          </button>
        </div>
        <div className="aj-clave-fila">
          <input
            id="aj-jev-clave"
            className="aj-input aj-mono"
            type={visible ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={estado.data?.configurada ? "Pega una clave nueva para reemplazarla" : "Pega la clave apikey_…"}
            value={valor}
            disabled={ocupado || (estado.data !== undefined && !estado.data.disponible)}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              enviar();
            }}
          />
          <button type="button" className="aj-btn aj-btn-primario" onClick={enviar} disabled={!valor.trim() || ocupado || !estado.data?.disponible}>
            {guardar.isPending ? "Guardando…" : "Guardar clave"}
          </button>
        </div>
        <p className="aj-nota" role="status">
          {estado.isPending ? "Consultando estado…" : estado.data?.configurada
            ? "Clave guardada cifrada; Telo no vuelve a mostrar su valor."
            : estado.data?.disponible
              ? "Sin clave configurada."
              : "Falta TELO_CLAVE_CIFRADO en el servidor para guardar secretos."}
        </p>
        {estado.data?.actualizada_en && <p className="aj-nota">Actualizada: {new Date(estado.data.actualizada_en).toLocaleString("es")}</p>}
      </div>}
      {!configuracionAbierta && <p className="aj-nota" role="status">{estado.isPending ? "Consultando estado…" : estado.data?.configurada ? "Clave guardada cifrada; el valor permanece oculto." : "Sin clave configurada."}</p>}
      <p className="aj-nota">
        Si guardas la clave, Telo enviará a TypeSafe AI los últimos mensajes del chat, el texto de cada tarea y la propuesta de memoria necesaria para evaluarla. No enviará credenciales conocidas. Puedes quitar la clave aquí cuando quieras.
      </p>
      {estado.isError && <p className="aj-error" role="alert">{errorText(estado.error)}</p>}
      {error && <p className="aj-error" role="alert">{error}</p>}
      {aviso && <p className="aj-nota" role="status">{aviso}</p>}
      <div className="aj-acciones">
        <button type="button" className="aj-btn" onClick={() => probar.mutate()} disabled={!estado.data?.configurada || ocupado}>
          {probar.isPending ? "Probando…" : "Probar conexión"}
        </button>
        {estado.data?.configurada && (
          <button type="button" className="aj-btn" onClick={() => quitar.mutate()} disabled={ocupado}>
            {quitar.isPending ? "Quitando…" : "Quitar clave"}
          </button>
        )}
      </div>
      <p className="aj-nota">La prueba envía una evaluación mínima y puede consumir tokens. El uso de Jev aparece separado en Analíticas.</p>
    </article>
  );
}

function IconoVisibilidad({ visible }: { visible: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="m3 3 18 18" />}
    </svg>
  );
}

// Lo que impide que un proveedor llegue a los agentes, con el nombre real de la variable.
// Un proveedor sin clave que se puede guardar ya lo dice su propio campo, así que no se repite aquí.
function notaEstado(p: ProviderStatus, modelos: { total: number } | null): string | null {
  if (p.id === "opencode") return p.configured ? null : "El CLI de OpenCode no se encontró en el servidor.";
  // Codex: la sesión se inicia desde su panel; los agentes pueden seleccionarlo.
  if (p.id === "codex") return p.configured ? "Sesión conectada con ChatGPT. Los modelos de Codex están disponibles en el selector." : null;
  if (!p.configured) return p.guardable ? null : `Falta ${p.variable ?? "la clave"} en el archivo de entorno del servidor.`;
  if (!p.enAgente) {
    return `La clave está configurada, pero no llega a los agentes: agrégala a TELO_AGENTE_VARIABLES en el archivo de entorno del servidor.`;
  }
  // La clave llega al servidor, pero OpenCode no tiene ningún modelo de este proveedor: casi siempre el nombre
  // de la variable no es el que espera esta versión de OpenCode. Se dice así, sin adivinar cuál es.
  if (modelos && modelos.total === 0) {
    return `La clave está guardada, pero OpenCode no muestra modelos de ${p.name}. En el servidor, revisa con "opencode models" que el nombre de la variable (${p.variable}) sea el que usa esta versión.`;
  }
  return null;
}

function GithubPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const estado = useQuery({ queryKey: ["github-cuenta"], queryFn: api.githubCuenta });
  const app = useQuery({ queryKey: ["github-app-installations"], queryFn: api.githubAppInstalaciones });
  const vincular = useMutation({
    mutationFn: api.vincularGithubApp,
    onSuccess: ({ instalacion }) => {
      setError(null);
      setAviso(`GitHub App vinculada a @${instalacion.login}.`);
      void qc.invalidateQueries({ queryKey: ["github-cuenta"] });
      void qc.invalidateQueries({ queryKey: ["github-app-installations"] });
      void qc.invalidateQueries({ queryKey: ["project-git"] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const desvincularApp = useMutation({
    mutationFn: api.desvincularGithubApp,
    onSuccess: () => {
      setError(null);
      setAviso("Instalación desvinculada de Telo. La instalación de GitHub sigue intacta.");
      void qc.invalidateQueries({ queryKey: ["github-cuenta"] });
      void qc.invalidateQueries({ queryKey: ["github-app-installations"] });
      void qc.invalidateQueries({ queryKey: ["project-git"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  const desconectar = useMutation({
    mutationFn: api.desconectarGithubCuenta,
    onSuccess: () => {
      setError(null);
      setAviso("Credencial anterior eliminada de Telo. Si ya no la necesitas, revócala también en GitHub.");
      void qc.invalidateQueries({ queryKey: ["github-cuenta"] });
      void qc.invalidateQueries({ queryKey: ["github-app-installations"] });
      void qc.invalidateQueries({ queryKey: ["project-git"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  const datos = estado.data;

  return (
    <article className="aj-tarjeta" aria-labelledby="ajustes-github">
      <h3 id="ajustes-github" className="aj-tarjeta-titulo-simple">
        Cuenta de GitHub
      </h3>
      <p className="aj-nota">
        Telo usa una GitHub App instalada en tu cuenta. Cada operación recibe una credencial temporal limitada al repositorio y al permiso que necesita.
      </p>

      {estado.isPending && <p className="aj-nota">Consultando estado de GitHub…</p>}
      {estado.isError && <p className="aj-error" role="alert">{errorText(estado.error)}</p>}
      {app.isPending && <p className="aj-nota">Consultando instalaciones de la GitHub App…</p>}
      {app.isError && <p className="aj-error" role="alert">{errorText(app.error)}</p>}

      {app.data && !app.data.configurado ? (
        <div className="aj-nota" role="status">
          <p>La App ya puede estar instalada en GitHub; falta configurar Telo para que el servidor firme credenciales temporales.</p>
          <p>Faltan en el archivo de entorno del servidor: {app.data?.faltantes.join(", ") || "TELO_GITHUB_APP_ID y TELO_GITHUB_APP_PRIVATE_KEY_PATH"}.</p>
        </div>
      ) : app.data?.configurado ? (
        <div className="aj-github-contenido">
          {datos?.conectado && datos.metodo === "app" && (
            <div className="aj-github-cuenta">
              {datos.avatar_url && (
                <img
                  src={datos.avatar_url}
                  alt={datos.login ?? "GitHub"}
                  className="aj-github-avatar"
                />
              )}
              <div className="aj-github-cuenta-datos">
                <strong>Cuenta conectada</strong>
                <span className="aj-github-login">@{datos.login}</span>
              </div>
              <span className="aj-github-conectada"><span aria-hidden="true" />Conectada</span>
            </div>
          )}
          {datos?.conectado && datos.metodo === "token" && (
            <p className="aj-nota" role="status">Hay una sesión de GitHub anterior como @{datos.login}. Al vincular la App, Telo la priorizará.</p>
          )}
          {!app.data.instalaciones.length ? (
            <p className="aj-nota">
              Telo no encontró instalaciones para esta App. Revisa la instalación en{" "}
              <a href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">GitHub</a>.
            </p>
          ) : (
            <div className="aj-github-instalaciones">
              <h4 className="aj-github-subtitulo">Instalaciones disponibles</h4>
              {app.data.instalaciones.map((instalacion) => {
                const seleccionada = app.data?.seleccionada === instalacion.id;
                const permisosEscritura = [
                  { clave: "contents", nombre: "Contents" },
                  { clave: "pull_requests", nombre: "Pull requests" },
                ] as const;
                const faltanPermisos = permisosEscritura.filter(
                  ({ clave }) => instalacion.permissions?.[clave] !== "write",
                );
                const urlConfiguracion = instalacion.configuration_url ?? "https://github.com/settings/installations";
                return (
                  <div key={instalacion.id} className="aj-github-instalacion">
                    <div className="aj-github-instalacion-datos">
                      <div className="aj-github-identidad">
                        <strong>{instalacion.name}</strong>
                        <span className="aj-github-login">@{instalacion.login}</span>
                      </div>
                      <p className="aj-github-alcance">
                        <span>Acceso a repositorios</span>
                        <strong>{instalacion.repository_selection === "selected" ? "Solo los seleccionados" : "Todos los repositorios"}</strong>
                      </p>
                      <p className="aj-github-alcance">
                        <span>Permisos reportados por GitHub</span>
                        <strong>
                          {permisosEscritura.map(({ clave, nombre }) => `${nombre}: ${instalacion.permissions?.[clave] === "write" ? "lectura y escritura" : instalacion.permissions?.[clave] === "read" ? "solo lectura" : "no concedido"}`).join(" · ")}
                        </strong>
                      </p>
                      {faltanPermisos.length > 0 && (
                        <p className="aj-github-recomendacion aj-github-aviso" role="alert">
                          Falta permiso de escritura para {faltanPermisos.map(({ nombre }) => nombre).join(" y ")}. Actualiza los permisos de esta instalación en{" "}
                          <a href={urlConfiguracion} target="_blank" rel="noopener noreferrer">la configuración de la GitHub App</a>.
                        </p>
                      )}
                      {instalacion.repository_selection === "all" && (
                        <p className="aj-github-recomendacion" role="status">
                          Para limitar el acceso, cambia la instalación a repositorios seleccionados en{" "}
                          <a href={urlConfiguracion} target="_blank" rel="noopener noreferrer">GitHub</a>.
                        </p>
                      )}
                      {seleccionada && !faltanPermisos.length && (
                        <p className="aj-github-recomendacion">
                          <a href={urlConfiguracion} target="_blank" rel="noopener noreferrer">Abrir configuración de esta instalación en GitHub</a>
                        </p>
                      )}
                    </div>
                    <div className="aj-github-instalacion-accion">
                      {seleccionada ? (
                        <span className="aj-github-usada" role="status"><span aria-hidden="true" />Usada por Telo</span>
                      ) : (
                        <button
                          type="button"
                          className="aj-btn aj-btn-primario"
                          disabled={vincular.isPending}
                          onClick={() => vincular.mutate(instalacion.id)}
                        >
                          {vincular.isPending ? "Vinculando…" : "Usar esta instalación"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {datos?.metodo === "app" && (
            <div className="aj-acciones">
              <button type="button" className="aj-btn" onClick={() => desvincularApp.mutate()} disabled={desvincularApp.isPending}>
                {desvincularApp.isPending ? "Desvinculando…" : "Desvincular de Telo"}
              </button>
              {datos.sesion_anterior && (
                <button type="button" className="aj-btn" onClick={() => desconectar.mutate()} disabled={desconectar.isPending}>
                  {desconectar.isPending ? "Eliminando…" : "Eliminar credencial anterior"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}

      {aviso && <p className="aj-nota" role="status" style={{ marginTop: 8 }}>{aviso}</p>}
      {error && <p className="aj-error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
      {datos?.metodo === "token" && (
        <div className="aj-acciones">
          <button type="button" className="aj-btn" onClick={() => desconectar.mutate()} disabled={desconectar.isPending}>
            {desconectar.isPending ? "Quitando…" : "Quitar sesión anterior"}
          </button>
        </div>
      )}
    </article>
  );
}

// Formatos locales de esta pantalla.
function duracionCorta(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  if (total < 60) return `${total} s`;
  const dias = Math.floor(total / 86_400);
  const horas = Math.floor((total % 86_400) / 3_600);
  if (dias > 0) return `${dias}d ${String(horas).padStart(2, "0")}h`;
  const minutos = Math.floor((total % 3_600) / 60);
  return horas > 0 ? `${horas}h ${String(minutos).padStart(2, "0")}m` : `${minutos}m`;
}

function fechaUtc(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// Iconos decorativos: trazo del mismo tamaño que el resto de la app.
const TRAZO = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function IconoReloj() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...TRAZO}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconoRed() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...TRAZO}>
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <path d="M12 8v4M5 16v-2h14v2" />
    </svg>
  );
}

function IconoRayo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...TRAZO}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconoChip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...TRAZO}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  );
}

function IconoMas() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconoCopia() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconoGuardar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconoProveedor({ id }: { id: string }) {
  if (id === "opencode") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" {...TRAZO}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (id === "codex") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" {...TRAZO}>
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...TRAZO}>
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}
