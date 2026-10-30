import { useEffect, useRef, useState } from "react";
import type { ModelInfo, TrabajadorOrquestacion, RolTrabajadorOrquestacion } from "../api";
import { useDialogo } from "./controls";

const ROLES: { id: RolTrabajadorOrquestacion; titulo: string; patron: RegExp }[] = [
  { id: "arquitectura", titulo: "Arquitectura y alcance", patron: /deepseek|big.?pickle|glm|luna|sonnet|opus/i },
  { id: "seguridad", titulo: "Seguridad y riesgos", patron: /deepseek|claude|glm|sol|sonnet|opus/i },
  { id: "verificacion", titulo: "Verificación y casos límite", patron: /luna|gemini|big.?pickle|deepseek|glm|flash/i },
];

function recomendar(modelos: ModelInfo[], excluir: Set<string> = new Set()): TrabajadorOrquestacion[] {
  const disponibles = modelos.filter((modelo) => modelo.free && !excluir.has(modelo.id));
  const usados = new Set<string>();
  return ROLES.flatMap(({ id, patron }) => {
    const ordenados = [...disponibles].sort((a, b) =>
      Number(b.recommended) - Number(a.recommended) || Number(patron.test(b.name)) - Number(patron.test(a.name)),
    );
    const modelo = ordenados.find((candidato) => !usados.has(candidato.id));
    if (!modelo) return [];
    usados.add(modelo.id);
    return [{ rol: id, model: modelo.id }];
  });
}

function opcionesPorCosto(modelos: ModelInfo[]) {
  const gratis = modelos.filter((modelo) => modelo.free);
  const otros = modelos.filter((modelo) => !modelo.free);
  return { gratis, otros };
}

export function OrquestacionChat({
  modelo,
  esfuerzo,
  habilitada,
  preactivarAuxiliares = false,
  seleccionAutomatica,
  trabajadores,
  modelos,
  guardando,
  error,
  onCerrar,
  onGuardar,
}: {
  modelo: string | null;
  esfuerzo: string | null;
  habilitada: boolean;
  preactivarAuxiliares?: boolean;
  seleccionAutomatica: boolean;
  trabajadores: TrabajadorOrquestacion[];
  modelos: ModelInfo[];
  guardando: boolean;
  error?: string | null;
  onCerrar: () => void;
  onGuardar: (config: { model: string; effort: string | null; orquestacion_habilitada: boolean; orquestacion_seleccion_automatica: boolean; orquestacion_trabajadores: TrabajadorOrquestacion[] }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sugerenciasInicialesAplicadas = useRef(Boolean(trabajadores.length || !preactivarAuxiliares));
  const [coordinador, setCoordinador] = useState(modelo ?? "");
  const [esfuerzoActual, setEsfuerzoActual] = useState(esfuerzo);
  const [activa, setActiva] = useState(habilitada || preactivarAuxiliares);
  const [seleccionAutomaticaActual, setSeleccionAutomaticaActual] = useState(preactivarAuxiliares ? true : seleccionAutomatica);
  const [auxiliares, setAuxiliares] = useState<TrabajadorOrquestacion[]>(() =>
    trabajadores.length
      ? trabajadores
      : preactivarAuxiliares
        ? recomendar(modelos, new Set([modelo ?? ""]))
        : trabajadores,
  );
  const [verModelosConCosto, setVerModelosConCosto] = useState(() =>
    Boolean((modelo && modelos.some((item) => item.id === modelo && !item.free)) || trabajadores.some((trabajador) => modelos.some((item) => item.id === trabajador.model && !item.free))),
  );
  useDialogo(ref, onCerrar);

  useEffect(() => {
    if (!preactivarAuxiliares || !activa || sugerenciasInicialesAplicadas.current || !modelos.length) return;
    sugerenciasInicialesAplicadas.current = true;
    if (!auxiliares.length) setAuxiliares(recomendar(modelos, new Set([coordinador])));
  }, [activa, auxiliares.length, coordinador, modelos, preactivarAuxiliares]);

  const modeloCoordinador = modelos.find((item) => item.id === coordinador);
  const seleccionados = new Set([coordinador, ...auxiliares.map((trabajador) => trabajador.model)]);
  const disponibles = modelos.filter((item) => item.free || verModelosConCosto || seleccionados.has(item.id));
  const grupos = opcionesPorCosto(disponibles);
  const recomendaciones = recomendar(modelos, new Set([coordinador]));
  const elegirCoordinador = (id: string) => {
    setCoordinador(id);
    setAuxiliares((actuales) => actuales.filter((trabajador) => trabajador.model !== id));
    const elegido = modelos.find((item) => item.id === id);
    if (esfuerzoActual && !elegido?.variants.includes(esfuerzoActual)) setEsfuerzoActual(null);
  };
  const actualizarAuxiliar = (indice: number, cambios: Partial<TrabajadorOrquestacion>) => {
    setAuxiliares((actuales) => actuales.map((item, actual) => actual === indice ? { ...item, ...cambios } : item));
  };
  const reponerRecomendaciones = () => {
    setAuxiliares(recomendar(modelos, new Set([coordinador])));
  };
  const agregarAuxiliar = () => {
    if (auxiliares.length >= 3) return;
    const ocupado = new Set([coordinador, ...auxiliares.map((trabajador) => trabajador.model)]);
    const sugerido = recomendar(modelos, ocupado)[0]?.model
      ?? modelos.find((item) => (item.free || verModelosConCosto) && !ocupado.has(item.id))?.id;
    if (!sugerido) return;
    setAuxiliares((actuales) => [...actuales, { rol: ROLES[actuales.length % ROLES.length]!.id, model: sugerido }]);
  };
  const guardar = () => {
    if (!coordinador) return;
    onGuardar({
      model: coordinador,
      effort: esfuerzoActual,
      orquestacion_habilitada: activa,
      orquestacion_seleccion_automatica: seleccionAutomaticaActual,
      orquestacion_trabajadores: auxiliares,
    });
  };

  const seleccionarModelo = (valor: string, alElegir: (id: string) => void, ariaLabel: string, excluir: Set<string> = new Set()) => (
    <select className="tl-campo-texto tl-orquestacion-select" aria-label={ariaLabel} value={valor} onChange={(event) => alElegir(event.target.value)}>
      <option value="">Selecciona un modelo</option>
      {grupos.gratis.length > 0 && <optgroup label="Gratis según el catálogo de Telo">
        {grupos.gratis.filter((item) => item.id === valor || !excluir.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.provider}</option>)}
      </optgroup>}
      {grupos.otros.length > 0 && <optgroup label="Puede tener costo">
        {grupos.otros.filter((item) => item.id === valor || !excluir.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.provider}</option>)}
      </optgroup>}
    </select>
  );

  return (
    <>
      <div className="scrim" onClick={onCerrar} />
      <div className="tl-dialogo tl-dialogo-documento tl-orquestacion-dialog" role="dialog" aria-modal="true" aria-labelledby="orquestacion-titulo" ref={ref}>
        <div className="tl-dialogo-cabecera">
          <h2 className="tl-dialogo-h2" id="orquestacion-titulo">Supervisor del chat</h2>
          <button type="button" className="tl-boton" onClick={onCerrar} aria-label="Cerrar supervisor">Cerrar</button>
        </div>
        <div className="tl-dialogo-cuerpo">
          {error && <p className="tl-alerta" role="alert">{error}</p>}
          <p className="tl-orquestacion-nota">El supervisor responde y es el único que aplica cambios. Los auxiliares analizan en paralelo y solo lectura. Telo realiza llamadas separadas a los modelos que configures; no se crean credenciales por agente. Cada proveedor debe estar conectado en Configuración → Proveedores IA. Guardar solo prepara el chat: las llamadas empiezan cuando envíes un mensaje.</p>

          <label className="tl-campo">
            <span className="tl-campo-etiqueta">Modelo supervisor</span>
            {seleccionarModelo(coordinador, elegirCoordinador, "Modelo supervisor")}
            <span className="tl-campo-ayuda">Este modelo también será el seleccionado para el chat en escritorio y móvil.</span>
          </label>

          {modeloCoordinador && !modeloCoordinador.free && (
            <p className="tl-orquestacion-costo" role="note">El supervisor seleccionado no aparece como gratis en el catálogo de Telo; consulta las condiciones del proveedor antes de usarlo.</p>
          )}

          <label className="tl-orquestacion-toggle">
            <input type="checkbox" checked={activa} onChange={(event) => {
              const habilitar = event.target.checked;
              setActiva(habilitar);
              if (habilitar) {
                setSeleccionAutomaticaActual(true);
                if (!auxiliares.length && recomendaciones.length) setAuxiliares(recomendaciones);
              }
            }} />
            <span>Activar auxiliares para esta conversación</span>
          </label>

          {activa && (
            <section className="tl-orquestacion-trabajadores" aria-label="Modelos auxiliares">
              <div className="tl-orquestacion-subtitulo">
                <h3>Modelos de trabajo</h3>
                <div className="tl-orquestacion-controles">
                  <button type="button" className="ghost task-mini-btn" onClick={reponerRecomendaciones} disabled={!recomendar(modelos, new Set([coordinador])).length}>Rellenar con sugerencias gratis</button>
                  <button type="button" className="ghost task-mini-btn" onClick={agregarAuxiliar} disabled={auxiliares.length >= 3 || modelos.every((item) => (!item.free && !verModelosConCosto) || seleccionados.has(item.id))}>Añadir modelo</button>
                </div>
              </div>
              <p className="tl-orquestacion-nota">El supervisor evalúa el mensaje actual y el contexto reciente, y elige cuáles de estos modelos candidatos usar en cada petición. Puedes configurar hasta tres modelos auxiliares; el supervisor puede elegir ninguno, algunos o todos.</p>
              {auxiliares.map((trabajador, indice) => (
                <div className="tl-orquestacion-auxiliar" key={`${indice}-${trabajador.model}`}>
                  <label className="tl-campo">
                    <span className="tl-campo-etiqueta">Función auxiliar {indice + 1}</span>
                    <select className="tl-campo-texto tl-orquestacion-select" aria-label={`Función auxiliar ${indice + 1}`} value={trabajador.rol} onChange={(event) => actualizarAuxiliar(indice, { rol: event.target.value as RolTrabajadorOrquestacion })}>
                      {ROLES.map(({ id, titulo }) => <option key={id} value={id}>{titulo}</option>)}
                    </select>
                  </label>
                  <label className="tl-campo">
                    <span className="tl-campo-etiqueta">Modelo auxiliar {indice + 1}</span>
                    {seleccionarModelo(trabajador.model, (model) => {
                      if (model) actualizarAuxiliar(indice, { model });
                      else setAuxiliares((actuales) => actuales.filter((_item, actual) => actual !== indice));
                    }, `Modelo auxiliar ${indice + 1}`, new Set([coordinador, ...auxiliares.filter((_otro, actual) => actual !== indice).map((otro) => otro.model)]))}
                  </label>
                  {(() => {
                    const seleccionado = modelos.find((item) => item.id === trabajador.model);
                    return seleccionado && !seleccionado.free
                      ? <span className="tl-campo-ayuda">Este modelo puede tener costo o consumir una cuota de pago del proveedor.</span>
                      : null;
                  })()}
                  <button type="button" className="tl-boton tl-orquestacion-quitar" aria-label={`Quitar auxiliar ${indice + 1}`} onClick={() => setAuxiliares((actuales) => actuales.filter((_item, actual) => actual !== indice))}>Quitar modelo</button>
                </div>
              ))}
              {!auxiliares.length && <p className="tl-orquestacion-costo" role="note">{recomendaciones.length ? "Todavía no hay modelos auxiliares seleccionados. El supervisor puede responder sin análisis auxiliares." : "El catálogo no tiene modelos marcados como gratis disponibles para auxiliares. Puedes mostrar modelos con posible costo y añadirlos manualmente, o guardar el supervisor sin auxiliares."}</p>}
              <label className="tl-orquestacion-toggle tl-orquestacion-incluir-costo">
                <input type="checkbox" checked={verModelosConCosto} onChange={(event) => setVerModelosConCosto(event.target.checked)} />
                <span>Mostrar modelos que pueden tener costo</span>
              </label>
              <p className="tl-campo-ayuda">Las sugerencias son reglas locales basadas en nombres y etiquetas del catálogo; no son una evaluación de la petición por un modelo.</p>

              <fieldset className="tl-orquestacion-modo">
                <legend>Cómo usar los auxiliares</legend>
                <label className="tl-orquestacion-opcion">
                  <input type="radio" name="orquestacion-modo" checked={seleccionAutomaticaActual} onChange={() => setSeleccionAutomaticaActual(true)} />
                  <span><strong>Elegir según cada petición</strong><small>El supervisor consulta su modelo una vez para elegir qué funciones y modelos auxiliares ejecutar según el mensaje y el contexto reciente.</small></span>
                </label>
                <label className="tl-orquestacion-opcion">
                  <input type="radio" name="orquestacion-modo" checked={!seleccionAutomaticaActual} onChange={() => setSeleccionAutomaticaActual(false)} />
                  <span><strong>Ejecutar todos los seleccionados</strong><small>Usa cada modelo configurado en todos los turnos, sin una llamada de selección adicional.</small></span>
                </label>
              </fieldset>
            </section>
          )}

          <p className="tl-orquestacion-costo" role="note">El modo automático añade una consulta al supervisor y las llamadas de los auxiliares elegidos. Aumenta consumo y demora. “Gratis” es solo la etiqueta del catálogo de Telo; cuotas y límites dependen del proveedor.</p>
          <div className="tl-dialogo-acciones tl-orquestacion-acciones">
            <button type="button" className="tl-boton" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="tl-boton tl-boton-primario" onClick={guardar} disabled={guardando || !coordinador}>
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
