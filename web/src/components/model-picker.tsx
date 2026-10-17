import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ModeloCodex, type ModelInfo } from "../api";
import { formatPrice, nombreProveedor } from "../lib/model";
import { CostMeter, EffortControl, useDialogo } from "./controls";
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
  const catalogoCodex = useQuery({
    queryKey: ["codex-models"],
    queryFn: api.codexModels,
    enabled: codexConectado,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [onlyFree, setOnlyFree] = useState(false);
  const [draftId, setDraftId] = useState(currentId);
  const [draftEffort, setDraftEffort] = useState(currentEffort);
  const draftModel = models.find((m) => m.id === draftId) ?? null;
  const esfuerzoValido = draftEffort && draftModel?.variants.includes(draftEffort) ? draftEffort : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  // Si no hay disparador, vuelve el elemento que tenía el foco al abrir.
  const [previo] = useState(() => document.activeElement as HTMLElement | null);

  const devolverFoco = () => (disparador?.current ?? previo)?.focus();
  const cerrar = () => {
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
      // 10 px de separación con el compositor y 8 px de aire bajo el borde visible.
      const disponible = ancla.getBoundingClientRect().top - limiteVisible(ancla) - 18;
      el.style.maxHeight = `${Math.max(ALTO_MINIMO, Math.min(window.innerHeight * 0.6, disponible))}px`;
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  const elegir = (m: ModelInfo | null, esfuerzo: string | null = null) => {
    devolverFoco();
    onSelect(m, conEsfuerzo ? esfuerzo : undefined);
  };

  const seleccionar = (m: ModelInfo | null) => {
    if (!m) return elegir(null, null);
    if (!conEsfuerzo || !m.variants || m.variants.length === 0) return elegir(m, null);
    setDraftId(m.id);
    setDraftEffort((v) => (v && m.variants.includes(v) ? v : null));
  };
  const esActual = (m: ModelInfo) => m.id === currentId;

  const groups = useMemo(() => {
    const matches = models.filter((m) => {
      if (onlyFree && !m.free) return false;
      return m.recommended;
    });

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
  }, [models, onlyFree]);

  // Modelos listados tras filtrar: es el contador "N modelos disponibles".
  const listados = useMemo(
    () => groups.reduce((total, [, familias]) => total + familias.reduce((n, [, items]) => n + items.length, 0), 0),
    [groups],
  );

  // Fila de un modelo: nombre con "✓ Activo" si es el actual; precio arriba y costo abajo.
  const fila = (m: ModelInfo) => (
    <button type="button" className="picker-item" aria-current={esActual(m) || undefined} aria-pressed={conEsfuerzo ? m.id === draftId : undefined} onClick={() => seleccionar(m)}>
      <span className="picker-main">
        <span className="picker-nombre-linea">
          <span className="picker-name">{m.name}</span>
          {esActual(m) && <span className="picker-activo">✓ Activo</span>}
        </span>
        <span className="picker-id">{m.id}</span>
      </span>
      <span className="picker-meta">
        <span className="picker-price" title="Precio de entrada / salida por millón de tokens">
          {formatPrice(m)}
        </span>
        <span className="picker-costo">
          <span className="picker-costo-etiqueta">Costo</span>
          <CostMeter tier={m.costTier} />
        </span>
      </span>
    </button>
  );

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div className={`picker${conEsfuerzo ? " picker-con-esfuerzo" : ""}`} role="dialog" aria-modal="true" aria-label="Elegir modelo" ref={dialogRef}>
        <div className="picker-barra">
          <span className="picker-conteo" aria-live="polite">
            {!cargando && !error && (listados === 1 ? "1 modelo disponible" : `${listados} modelos disponibles`)}
          </span>
          <button
            type="button"
            className={`pill${onlyFree ? " on" : ""}`}
            aria-pressed={onlyFree}
            onClick={() => setOnlyFree((v) => !v)}
          >
            Solo gratis
          </button>
        </div>

        <div className="picker-list">
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

          {!cargando && !error && groups.length === 0 && (
            <p className="muted-note pad">Ningún modelo disponible en este momento.</p>
          )}

          {!cargando &&
            !error &&
            groups.map(([proveedor, familias]) => (
              <section key={proveedor} className="picker-proveedor">
                <h3 className="group-title">{nombreProveedor(proveedor)}</h3>
                {familias.map(([familia, items]) => (
                  <div key={familia} className="picker-familia">
                    <div className="picker-familia-cabecera">
                      <h4 className="picker-familia-titulo">{familia}</h4>
                      <span className="picker-familia-conteo">{plural(items.length)}</span>
                    </div>
                    {items.map((m) => (
                      <div key={m.id} className="picker-modelo">
                        {fila(m)}
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}

          {!cargando && !error && codexConectado && (
            <section className="picker-proveedor" aria-labelledby="picker-codex-titulo">
              <h3 id="picker-codex-titulo" className="group-title">Cuenta Codex</h3>
              <p className="picker-proveedor-nota">
                {catalogoCodex.isError
                  ? "No se pudo consultar el catálogo de Codex. Revisa la sesión en Ajustes."
                  : codexEnAgente
                    ? "Modelos disponibles a través de tu sesión activa con ChatGPT."
                    : "Modelos de tu sesión. Telo todavía ejecuta agentes con OpenCode; esta lista es informativa."}
              </p>
              {catalogoCodex.isPending && <p className="picker-cargando" role="status">Consultando modelos de Codex…</p>}
              {catalogoCodex.data?.models.map((modelo) => (
                <FilaCodex
                  key={modelo.id}
                  modelo={modelo}
                  deshabilitado={!codexEnAgente}
                  onSelect={seleccionar}
                  esActual={currentId === `codex/${modelo.id}` || currentId === modelo.id}
                  esDraft={draftId === `codex/${modelo.id}` || draftId === modelo.id}
                />
              ))}
            </section>
          )}
        </div>
        {conEsfuerzo && draftModel && draftModel.variants.length > 0 && (
          <div className="picker-configuracion">
            <div className="picker-eleccion">
              <strong title={draftModel.name}>
                {draftModel.name}
              </strong>
              <span>Nivel de esfuerzo:</span>
            </div>
            <EffortControl
              variants={draftModel.variants}
              value={esfuerzoValido}
              disabled={!draftModel}
              onChange={(nuevoEsfuerzo) => elegir(draftModel, nuevoEsfuerzo)}
            />
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
        <span className="picker-id">{modelInfo.id}</span>
      </span>
      <span className="picker-meta">
        <span className="picker-price">{deshabilitado ? "Solo catálogo" : "Cuenta ChatGPT"}</span>
        {modelo.context > 0 && <span className="picker-codex-context">{modelo.context.toLocaleString("es")} tokens</span>}
      </span>
    </button>
  );
}
