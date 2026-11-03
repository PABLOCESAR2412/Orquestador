import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ModeloCodex, type ModelInfo } from "../api";
import { effortLabel, formatPrice, nombreProveedor } from "../lib/model";
import { coincideModelo, agruparPorProveedor, normalizaBusca } from "../lib/busca-modelos";
import { guardarPreferenciasSelector, leerPreferenciasSelector, normalizarIdAnalisis, type PreferenciasSelectorModelos } from "../lib/model-picker-preferencias";
import { useDialogo } from "./controls";
import "../styles-picker.css";

type Props = {
  models: ModelInfo[];
  currentId: string | null;
  // Con conEsfuerzo, modelo y esfuerzo se aplican juntos al confirmar.
  conEsfuerzo?: boolean;
  currentEffort?: string | null;
  // El esfuerzo solo llega cuando conEsfuerzo está activo. null significa "Auto".
  onSelect: (model: ModelInfo | null, effort?: string | null) => void;
  onClose: () => void;
  // Chip o botón que abrió el selector: recibe el foco al cerrar.
  disparador?: RefObject<HTMLElement | null>;
  cargando?: boolean;
  error?: string | null;
  onReintentar?: () => void;
};

const MAX_RESULTS = 120;
const PROVEEDORES_CON_API = new Set(["google", "openai", "groq", "xai", "nvidia", "openrouter"]);

const plural = (n: number) => (n === 1 ? "1 modelo" : `${n} modelos`);

// Alto mínimo del selector de escritorio: buscador, conteo y al menos una fila visibles.
const ALTO_MINIMO = 160;

// Borde superior de lo visible desde el compositor: el primer ancestro que recorta (scroll u overflow oculto) o la ventana.
function limiteVisible(desde: HTMLElement): number {
  for (let n = desde.parentElement; n; n = n.parentElement) {
    if (/auto|hidden|scroll/.test(getComputedStyle(n).overflowY)) return n.getBoundingClientRect().top;
  }
  return 0;
}

export function ModelPicker({
  models,
  currentId,
  conEsfuerzo = false,
  currentEffort = null,
  onSelect,
  onClose,
  disparador,
  cargando = false,
  error = null,
  onReintentar,
}: Props) {
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders, staleTime: 5 * 60_000 });
  const codexConectado = proveedores.data?.some((proveedor) => proveedor.id === "codex" && proveedor.sesion) ?? false;
  const codexEnAgente = proveedores.data?.some((proveedor) => proveedor.id === "codex" && proveedor.enAgente) ?? false;
  const inteligencia = useQuery({
    queryKey: ["model-intelligence"],
    queryFn: api.modelIntelligence,
    staleTime: 12 * 60 * 60_000,
    retry: false,
  });
  const usosModelos = useQuery({
    queryKey: ["model-usage"],
    queryFn: api.modelUsage,
    staleTime: 5 * 60_000,
  });
  const catalogoCodex = useQuery({
    queryKey: ["codex-models"],
    queryFn: api.codexModels,
    enabled: codexConectado,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [onlyFree, setOnlyFree] = useState(false);
  const [textoBusca, setTextoBusca] = useState("");
  const [integracionesAbiertas, setIntegracionesAbiertas] = useState<Record<string, boolean>>({});
  const buscando = textoBusca.trim().length > 0;
  const [preferencias, setPreferencias] = useState<PreferenciasSelectorModelos>(leerPreferenciasSelector);
  const [draftId, setDraftId] = useState(currentId);
  const [draftSeleccionado, setDraftSeleccionado] = useState<ModelInfo | null>(null);
  const [draftEffort, setDraftEffort] = useState(currentEffort);
  const [eligiendoEsfuerzo, setEligiendoEsfuerzo] = useState(false);
  const draftModel = models.find((m) => m.id === draftId) ?? (draftSeleccionado?.id === draftId ? draftSeleccionado : null);
  const esfuerzoValido = draftEffort && draftModel?.variants.includes(draftEffort) ? draftEffort : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  // Si no hay disparador, vuelve el elemento que tenía el foco al abrir.
  const [previo] = useState(() => document.activeElement as HTMLElement | null);

  const devolverFoco = () => (disparador?.current ?? previo)?.focus();
  const cerrar = () => {
    if (eligiendoEsfuerzo && draftModel) onSelect(draftModel, esfuerzoValido);
    devolverFoco();
    onClose();
  };
  useDialogo(dialogRef, cerrar);

  // En escritorio el selector flota sobre su compositor. Si no cabe por encima de la barra superior, se acorta.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    const ancla = el?.offsetParent as HTMLElement | null | undefined;
    if (!el || !ancla) return;
    const ajustar = () => {
      // En móvil es una hoja fija: no se mide contra el compositor de escritorio.
      if (window.matchMedia("(max-width: 760px)").matches) {
        el.style.maxHeight = `${Math.floor((window.visualViewport?.height ?? window.innerHeight) * 0.85)}px`;
        const boton = disparador?.current?.getBoundingClientRect();
        if (boton) {
          el.style.setProperty("--picker-origin-x", `${boton.left + boton.width / 2}px`);
          el.style.setProperty("--picker-origin-y", `${el.getBoundingClientRect().height}px`);
        }
        return;
      }
      // 10 px de separación con el compositor y 8 px de aire bajo el borde visible.
      const disponible = ancla.getBoundingClientRect().top - limiteVisible(ancla) - 18;
      el.style.maxHeight = `${Math.max(ALTO_MINIMO, Math.min(window.innerHeight * 0.6, disponible))}px`;
      const boton = disparador?.current?.getBoundingClientRect();
      if (boton) {
        const caja = el.getBoundingClientRect();
        el.style.setProperty("--picker-origin-x", `${boton.left + boton.width / 2 - caja.left}px`);
        el.style.setProperty("--picker-origin-y", `${boton.top - caja.top}px`);
      }
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    window.visualViewport?.addEventListener("resize", ajustar);
    return () => {
      window.removeEventListener("resize", ajustar);
      window.visualViewport?.removeEventListener("resize", ajustar);
    };
  }, [disparador]);

  const elegir = (m: ModelInfo | null, esfuerzo: string | null = null) => {
    devolverFoco();
    onSelect(m, conEsfuerzo ? esfuerzo : undefined);
  };

  const alternarFijado = (id: string) => {
    const fijados = preferencias.fijados.includes(id)
      ? preferencias.fijados.filter((actual) => actual !== id)
      : [...preferencias.fijados, id];
    const siguiente = { ...preferencias, fijados };
    setPreferencias(siguiente);
    guardarPreferenciasSelector(siguiente);
  };

  const proveedorActual = draftModel?.provider ?? currentId?.split("/")[0] ?? null;
  const integracionActual = (id: string) => id === "codex-sesion" ? proveedorActual === "codex" : proveedorActual === id;
  const integracionAbierta = (id: string) => buscando || (integracionesAbiertas[id] ?? integracionActual(id));
  const alternarIntegracion = (id: string) => setIntegracionesAbiertas((actual) => ({ ...actual, [id]: !actual[id] }));
  const cabeceraIntegracion = (id: string, nombre: string, cantidad: number) => (
    <div className="picker-integracion-heading">
      <h3 className="group-title picker-integracion-titulo">{nombre}</h3>
      <button
        type="button"
        className="picker-integracion-cabecera"
        aria-expanded={integracionAbierta(id)}
        aria-controls={`picker-integracion-${id}`}
        aria-label={`${integracionAbierta(id) ? "Ocultar" : "Mostrar"} modelos de ${nombre}`}
        disabled={buscando}
        onClick={() => alternarIntegracion(id)}
      >
        <span className="picker-integracion-conteo">{plural(cantidad)}</span>
        <svg className="picker-integracion-flecha" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );

  const candidatos = useMemo(
    // Codex se muestra desde su catálogo de sesión abajo, sin duplicar los mismos IDs del catálogo general.
    () => models.filter((m) => m.recommended && m.provider !== "codex" && (!onlyFree || m.free)),
    [models, onlyFree],
  );
  const destacados = useMemo(() => {
    const fijados = preferencias.fijados.flatMap((id) => {
      const modelo = candidatos.find((m) => m.id === id);
      return modelo ? [modelo] : [];
    });
    const masUsados = [...candidatos]
      .filter((m) => !preferencias.fijados.includes(m.id) && (usosModelos.data?.counts[m.id] ?? 0) > 0)
      .sort((a, b) => (usosModelos.data?.counts[b.id] ?? 0) - (usosModelos.data?.counts[a.id] ?? 0))
      .slice(0, 3);
    return [...fijados, ...masUsados];
  }, [candidatos, preferencias, usosModelos.data]);
  const puntajes = useMemo(() => {
    const mapa = new Map<string, (NonNullable<typeof inteligencia.data>["modelos"])[number] | null>();
    for (const modelo of inteligencia.data?.modelos ?? []) {
      for (const clave of new Set([normalizarIdAnalisis(modelo.slug), normalizarIdAnalisis(modelo.name)])) {
        const anterior = mapa.get(clave);
        mapa.set(clave, anterior === undefined || anterior?.slug === modelo.slug ? modelo : null);
      }
    }
    return mapa;
  }, [inteligencia.data]);
  const puntajeDe = (id: string, nombre?: string) => puntajes.get(normalizarIdAnalisis(id)) ?? (nombre ? puntajes.get(normalizarIdAnalisis(nombre)) : null) ?? null;

  const seleccionar = (m: ModelInfo | null) => {
    if (!m) return elegir(null, null);
    if (!conEsfuerzo || !m.variants || m.variants.length === 0) return elegir(m, null);
    setDraftSeleccionado(m);
    setDraftId(m.id);
    setDraftEffort((v) => (v && m.variants.includes(v) ? v : null));
    setEligiendoEsfuerzo(true);
  };
  const esActual = (m: ModelInfo) => m.id === currentId;

  const groups = useMemo(() => {
    const destacadosIds = new Set(destacados.map((m) => m.id));
    const matches = candidatos.filter((m) => !destacadosIds.has(m.id));

    // Primero por proveedor (de dónde viene el modelo) y dentro, por familia.
    const porProveedor = new Map<string, Map<string, ModelInfo[]>>();
    for (const m of matches) {
      const familias = porProveedor.get(m.provider) ?? new Map<string, ModelInfo[]>();
      const bucket = familias.get(m.group) ?? [];
      bucket.push(m);
      familias.set(m.group, bucket);
      porProveedor.set(m.provider, familias);
    }
    const grupos: [string, [string, ModelInfo[]][]][] = [...porProveedor.entries()].map(([prov, familias]) => [
      prov,
      [...familias.entries()],
    ]);
    return grupos;
  }, [candidatos, destacados]);

  // Modelos listados tras filtrar: es el contador "N modelos disponibles".
  const listados = useMemo(
    () => destacados.length + groups.reduce((total, [, familias]) => total + familias.reduce((n, [, items]) => n + items.length, 0), 0) + (!onlyFree && codexConectado ? catalogoCodex.data?.models.length ?? 0 : 0),
    [groups, destacados, onlyFree, codexConectado, catalogoCodex.data],
  );

  // Resultados del buscador: coinciden por nombre, id, familia o proveedor visible;
  // con tope MAX_RESULTS para no montar miles de filas en un catálogo grande.
  const hallazgos = useMemo(() => {
    if (!buscando) return null;
    const lista = candidatos.filter((m) => coincideModelo(m, textoBusca));
    return { total: lista.length, visibles: lista.slice(0, MAX_RESULTS) };
  }, [candidatos, textoBusca, buscando]);
  const gruposBusca = useMemo(
    () => (hallazgos ? agruparPorProveedor(hallazgos.visibles) : []),
    [hallazgos],
  );
  const ocultos = hallazgos ? hallazgos.total - hallazgos.visibles.length : 0;

  // La sección Codex también responde al buscador: sus filas se filtran mientras escribes.
  const codexVisibles = useMemo(() => {
    if (onlyFree) return [];
    if (!buscando || !catalogoCodex.data) return catalogoCodex.data?.models ?? [];
    return catalogoCodex.data.models.filter((modelo) =>
      coincideModelo({ name: modelo.name, id: `codex/${modelo.id}`, group: "Codex CLI · sesión de ChatGPT", provider: "codex" }, textoBusca),
    );
  }, [onlyFree, buscando, catalogoCodex.data, textoBusca]);
  const listadosVisibles = hallazgos ? hallazgos.visibles.length + codexVisibles.length : listados;

  // Fila de un modelo: nombre con "✓ Activo" si es el actual; precio arriba y costo abajo.
  const fila = (m: ModelInfo, mostrarIntegracion = false) => {
    const fijado = preferencias.fijados.includes(m.id);
    const indice = puntajeDe(m.id, m.name);
    const estadoProveedor = proveedores.data?.find((proveedor) => proveedor.id === m.provider);
    const faltaClave = estadoProveedor !== undefined && (
      (PROVEEDORES_CON_API.has(m.provider) && !estadoProveedor.configured) ||
      ((m.provider === "opencode" || m.provider === "commandcode") && (!estadoProveedor.configured || !estadoProveedor.sesion))
    );
    const usaSesion = m.provider === "opencode" || m.provider === "commandcode";
    const requisito = m.provider === "commandcode"
      ? "Instala Command Code e inicia sesión con el plan Go"
      : m.provider === "opencode"
        ? "Inicia sesión en OpenCode Console"
        : `Configura la clave API de ${nombreProveedor(m.provider)}`;
    return (
      <div className="picker-modelo-fila">
        <button type="button" className="picker-item" disabled={faltaClave} title={faltaClave ? `${requisito} en Ajustes para usar este modelo.` : undefined} aria-current={esActual(m) || undefined} aria-pressed={conEsfuerzo ? m.id === draftId : undefined} onClick={() => seleccionar(m)}>
          <span className="picker-main">
            <span className="picker-nombre-linea">
              <span className="picker-name">{m.name}</span>
              {mostrarIntegracion && <span className="picker-proveedor-chip">{nombreProveedor(m.provider)}</span>}
              {esActual(m) && <span className="picker-activo">✓ Activo</span>}
            </span>
          </span>
          <span className="picker-meta">
            <span
              className="picker-price"
              title={m.costAvailable === false
                ? "El catálogo no publica el precio. La disponibilidad depende del proveedor."
                : m.free
                  ? "El catálogo informa precio cero; el proveedor aún puede exigir acceso o aplicar cuotas."
                  : "Precio de entrada / salida por millón de tokens. El proveedor puede aplicar cuotas."}
            >
              {faltaClave ? usaSesion ? "Requiere sesión CLI" : "Requiere clave API" : formatPrice(m)}
            </span>
            {indice && <span className="picker-intelligence" title={`Artificial Analysis Intelligence Index v${inteligencia.data?.version ?? "?"}`}>
              AA {indice.score.toLocaleString("es", { maximumFractionDigits: 1 })}
            </span>}
          </span>
        </button>
        {faltaClave && <Link className="picker-clave-link" to="/ajustes" search={{ pestana: usaSesion ? "servidor" : "proveedores" }}>{usaSesion ? "Iniciar sesión" : "Configurar"}</Link>}
        <button
          type="button"
          className={`picker-fijar${fijado ? " is-fijado" : ""}`}
          aria-label={fijado ? `Quitar ${m.name} de favoritos` : `Anclar ${m.name} en favoritos`}
          aria-pressed={fijado}
          title={fijado ? "Quitar de favoritos" : "Anclar modelo"}
          onClick={() => alternarFijado(m.id)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 17v5M9 10.76V6a3 3 0 0 1 6 0v4.76l2.5 2.5V15h-11v-1.74z" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className={`picker${conEsfuerzo ? " picker-con-esfuerzo" : ""}`} role="dialog" aria-modal="true" aria-label="Elegir modelo" ref={dialogRef}>
        {!eligiendoEsfuerzo && <><div className="picker-head">
          <label className="picker-buscar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              className="picker-search"
              type="search"
              placeholder="Buscar modelos…"
              aria-label="Buscar modelos por nombre o proveedor"
              autoComplete="off"
              value={textoBusca}
              onChange={(e) => setTextoBusca(e.target.value)}
            />
            {buscando && (
              <button
                type="button"
                className="picker-limpiar"
                aria-label="Limpiar búsqueda"
                title="Limpiar búsqueda"
                onClick={() => setTextoBusca("")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </label>
          <button
            type="button"
            className={`pill${onlyFree ? " on" : ""}`}
            aria-pressed={onlyFree}
            title="Filtra por precio cero publicado; no indica la cuota disponible de tu cuenta."
            onClick={() => setOnlyFree((v) => !v)}
          >
            Precio $0
          </button>
        </div>

        <div className="picker-barra">
          <span className="picker-conteo" aria-live="polite">
            {!cargando && !error && (listadosVisibles === 1 ? "1 modelo disponible" : `${listadosVisibles} modelos disponibles`)}
          </span>
        </div>

        <div className="picker-list">
          {!cargando && !error && inteligencia.data?.disponible && (
            <p className="picker-proveedor-nota picker-aa-nota">
              Índice de inteligencia v{inteligencia.data.version ?? "?"} de{" "}
              <a href="https://artificialanalysis.ai/" target="_blank" rel="noreferrer">Artificial Analysis</a>.
            </p>
          )}
          {!cargando && inteligencia.data?.configurado === false && (
            <p className="picker-proveedor-nota picker-aa-nota">
              Puntuación no configurada. Añade <code>TELO_ARTIFICIAL_ANALYSIS_API_KEY</code> al entorno del servidor.
            </p>
          )}
          {!cargando && inteligencia.data?.configurado && !inteligencia.data.disponible && (
            <p className="picker-proveedor-nota picker-aa-nota">Artificial Analysis no respondió. Puedes seguir eligiendo modelos sin esa puntuación.</p>
          )}
          {destacados.length > 0 && !buscando && (
            <section className="picker-proveedor picker-tus-modelos" aria-labelledby="picker-tus-modelos">
              <h3 className="group-title" id="picker-tus-modelos">Tus modelos</h3>
              {preferencias.fijados.some((id) => candidatos.some((m) => m.id === id)) && <p className="picker-proveedor-nota">Anclados y más usados</p>}
              {destacados.map((m) => <div key={m.id} className="picker-modelo">{fila(m, true)}</div>)}
            </section>
          )}
          {!buscando && (
            <button
              type="button"
              className="picker-item"
              aria-current={currentId === null || undefined}
              aria-pressed={conEsfuerzo ? draftId === null : undefined}
              onClick={() => seleccionar(null)}
            >
              <span className="picker-main">
                <span className="picker-name">Predeterminado</span>
                <span className="picker-id">Lo que elija el servidor</span>
              </span>
            </button>
          )}

          {cargando && (
            <p className="picker-cargando" role="status">
              <span className="picker-spinner" aria-hidden="true" />
              Consultando catálogo de modelos del servidor…
            </p>
          )}

          {!cargando && error && (
            <div className="picker-estado">
              <p className="error" role="alert">
                {error}
              </p>
              {onReintentar && (
                <button type="button" className="ghost" onClick={onReintentar}>
                  Reintentar
                </button>
              )}
            </div>
          )}

          {!cargando && !error && buscando && hallazgos && hallazgos.total === 0 && codexVisibles.length === 0 && (
            <p className="muted-note pad">
              Sin resultados para «{textoBusca.trim()}». Prueba con otro nombre de modelo o de proveedor.
            </p>
          )}

          {!cargando && !error && !buscando && groups.length === 0 && codexVisibles.length === 0 && (
            <p className="muted-note pad">Ningún modelo disponible en este momento.</p>
          )}

          {!cargando &&
            !error &&
            (buscando
              ? gruposBusca.map(([proveedor, items]) => (
                  <section key={proveedor} className="picker-proveedor">
                    {cabeceraIntegracion(proveedor, nombreProveedor(proveedor), items.length)}
                    <div id={`picker-integracion-${proveedor}`} hidden={!integracionAbierta(proveedor)}>
                      {items.map((m) => <div key={m.id} className="picker-modelo">{fila(m)}</div>)}
                    </div>
                  </section>
                ))
              : groups.map(([proveedor, familias]) => (
              <section key={proveedor} className="picker-proveedor">
                {cabeceraIntegracion(proveedor, nombreProveedor(proveedor), familias.reduce((n, [, items]) => n + items.length, 0))}
                <div id={`picker-integracion-${proveedor}`} hidden={!integracionAbierta(proveedor)}>
                  {familias.map(([familia, items]) => (
                    <div key={familia} className="picker-familia">
                      <div className="picker-familia-cabecera">
                        <h4 className="picker-familia-titulo">{familia}</h4>
                        <span className="picker-familia-conteo">{plural(items.length)}</span>
                      </div>
                      {items.map((m) => <div key={m.id} className="picker-modelo">{fila(m)}</div>)}
                    </div>
                  ))}
                </div>
              </section>
            )))}

          {!cargando && !error && buscando && ocultos > 0 && hallazgos && (
            <p className="picker-busca-ocultos">
              Se muestran {hallazgos.visibles.length} de {hallazgos.total}. Escribe más para afinar la lista.
            </p>
          )}

          {!cargando && !error && codexConectado && (!buscando || codexVisibles.length > 0) && (
            <section className="picker-proveedor" aria-label="Codex CLI con sesión de ChatGPT">
              {cabeceraIntegracion("codex-sesion", "Codex CLI · sesión de ChatGPT", codexVisibles.length)}
              <div id="picker-integracion-codex-sesion" hidden={!integracionAbierta("codex-sesion")}>
                <p className="picker-proveedor-nota">
                  {catalogoCodex.isError
                    ? "No se pudo consultar el catálogo de Codex. Revisa la sesión en Ajustes."
                    : "Modelos de la integración Codex CLI, autenticada con tu sesión de ChatGPT."}
                </p>
                {catalogoCodex.isPending && <p className="picker-cargando" role="status">Consultando modelos de Codex…</p>}
                {codexVisibles.map((modelo) => (
                  <FilaCodex
                    key={modelo.id}
                    modelo={modelo}
                    deshabilitado={!codexEnAgente}
                    onSelect={seleccionar}
                    esActual={currentId === `codex/${modelo.id}` || currentId === modelo.id}
                    esDraft={draftId === `codex/${modelo.id}` || draftId === modelo.id}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
        </>}
        {eligiendoEsfuerzo && conEsfuerzo && draftModel && draftModel.variants.length > 0 && (
          <div className="picker-configuracion">
            <div className="picker-eleccion">
              <strong title={draftModel.name}>
                {draftModel.name}
              </strong>
              <span>Nivel de esfuerzo:</span>
            </div>
            <div className="picker-esfuerzo-barra">
              <strong aria-hidden="true">{esfuerzoValido ? effortLabel(esfuerzoValido) : "Auto"}</strong>
              <div className="picker-esfuerzo-range-wrap">
                <div className="picker-esfuerzo-marcas" aria-hidden="true">
                  {[...Array(draftModel.variants.length + 1)].map((_, i) => <i key={i} style={{ left: `${(i / draftModel.variants.length) * 100}%` }} />)}
                </div>
                <input type="range" min="0" max={draftModel.variants.length} step="1" list="niveles-esfuerzo"
                  value={esfuerzoValido ? draftModel.variants.indexOf(esfuerzoValido) + 1 : 0}
                  aria-label="Nivel de esfuerzo" aria-valuetext={esfuerzoValido ? effortLabel(esfuerzoValido) : "Auto"}
                  onChange={(event) => setDraftEffort(draftModel.variants[Number(event.target.value) - 1] ?? null)} />
              </div>
              <datalist id="niveles-esfuerzo">{[null, ...draftModel.variants].map((nivel, i) => <option key={nivel ?? "auto"} value={i} label={nivel ? effortLabel(nivel) : "Auto"} />)}</datalist>
              <button type="button" className="ghost picker-esfuerzo-auto" aria-pressed={!esfuerzoValido} onClick={() => setDraftEffort(null)}>Auto</button>
            </div>
            <button type="button" className="picker-volver" aria-label="Volver a los modelos" title="Volver a los modelos" onClick={() => setEligiendoEsfuerzo(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" /></svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function FilaCodex({
  modelo,
  deshabilitado,
  onSelect,
  esActual,
  esDraft,
}: {
  modelo: ModeloCodex;
  deshabilitado: boolean;
  onSelect: (m: ModelInfo) => void;
  esActual: boolean;
  esDraft?: boolean;
}) {
  const modelInfo: ModelInfo = {
    id: `codex/${modelo.id}`,
    provider: "codex",
    name: modelo.name,
    inputUsd: 0,
    outputUsd: 0,
    context: modelo.context,
    variants: modelo.variants && modelo.variants.length > 0 ? modelo.variants : ["low", "medium", "high"],
    free: false,
    costTier: "medio",
    costWarning: null,
    group: "Codex",
    recommended: true,
  };

  return (
    <button
      type="button"
      className="picker-item picker-item-codex"
      disabled={deshabilitado}
      aria-current={esActual || undefined}
      aria-pressed={esDraft || undefined}
      onClick={() => onSelect(modelInfo)}
    >
      <span className="picker-main">
        <span className="picker-nombre-linea">
          <span className="picker-name">{modelo.name}</span>
          {esActual && <span className="picker-activo">✓ Activo</span>}
        </span>
      </span>
      <span className="picker-meta">
        <span className="picker-price">{deshabilitado ? "Solo catálogo" : "Cuenta ChatGPT"}</span>
        {modelo.context > 0 && <span className="picker-codex-context">{modelo.context.toLocaleString("es")} tokens</span>}
      </span>
    </button>
  );
}
