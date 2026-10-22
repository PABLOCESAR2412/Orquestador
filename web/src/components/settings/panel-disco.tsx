import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PoliticaDisco } from "../../api";
import { errorText } from "../../lib/model";
import { formatBytes } from "../tarea-formato";

export function DiscoPanel() {
  const consulta = useQuery({ queryKey: ["mantenimiento-disco"], queryFn: api.mantenimientoDisco, refetchInterval: 30_000 });
  const cliente = useQueryClient();
  const [borrador, editar] = useState<PoliticaDisco | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const p = borrador ?? consulta.data?.politica;
  const ultimo = consulta.data?.ultimo;
  async function ejecutar(accion: "guardar" | "analizar" | "limpiar") {
    setOcupado(true); setError(""); setAviso("");
    try {
      if (accion === "guardar" && p) {
        const estado = await api.guardarPoliticaDisco(p);
        cliente.setQueryData(["mantenimiento-disco"], estado); editar(null); setAviso("Configuración guardada en el servidor.");
      } else if (accion !== "guardar") {
        const r = await api.limpiarDisco(accion);
        setAviso(`${r.carpetas} carpetas ${accion === "limpiar" ? "retiradas" : "candidatas"}. ${r.ocupadas} tareas ocupadas omitidas. ${r.errores} incidencias.`);
        await consulta.refetch();
        void cliente.invalidateQueries({ queryKey: ["servidor"] });
      }
    } catch (e) { setError(errorText(e)); }
    finally { setOcupado(false); }
  }
  return <section className="aj-tarjeta" aria-labelledby="disco-mantenimiento">
    <h3 id="disco-mantenimiento" className="aj-tarjeta-titulo-simple">Limpieza de dependencias</h3>
    <p className="aj-nota">Retira paquetes reinstalables de tareas terminadas. Conserva código, cambios, sesiones y entregables. Omite chats y proyectos ocupados. No guardes cambios manuales dentro de los paquetes.</p>
    {consulta.isPending && <p role="status">Consultando configuración…</p>}
    {consulta.isError && <p className="aj-error" role="alert">{errorText(consulta.error)} <button type="button" className="aj-btn" onClick={() => void consulta.refetch()}>Reintentar</button></p>}
    {p && <fieldset disabled={ocupado || consulta.data?.enCurso} className="disco-controles" onKeyDown={e => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); void ejecutar("guardar"); }
    }}>
      <legend>Programación y límites</legend>
      <label><input type="checkbox" checked={p.automatica} onChange={e => editar({ ...p, automatica: e.target.checked })} /> Habilitar limpieza automática</label>
      <div className="disco-campos">
        <label>Uso del disco que activa la limpieza (%)<input type="number" min={75} max={95} required value={p.umbral} onChange={e => editar({ ...p, umbral: Number(e.target.value) })} /></label>
        <label>O revisar cada (horas)<input type="number" min={6} max={168} required value={p.intervaloHoras} onChange={e => editar({ ...p, intervaloHoras: Number(e.target.value) })} /></label>
        <label>Conservar dependencias recientes (días)<input type="number" min={1} max={90} required value={p.antiguedadDias} onChange={e => editar({ ...p, antiguedadDias: Number(e.target.value) })} /></label>
      </div>
      <p className="aj-nota">Comprueba el umbral cada minuto. Con uso alto, reintenta como máximo una vez por hora. Los botones usan la configuración guardada.</p>
      <div className="disco-acciones">
        <button type="button" className="aj-btn" disabled={!borrador} onClick={() => void ejecutar("guardar")}>Guardar configuración</button>
        <button type="button" className="aj-btn" onClick={() => void ejecutar("analizar")}>Analizar sin borrar</button>
        <button type="button" className="aj-btn" onClick={() => void ejecutar("limpiar")}>Limpiar dependencias ahora</button>
      </div>
    </fieldset>}
    {(ocupado || consulta.data?.enCurso) && <p role="status">Revisando almacenamiento…</p>}
    {aviso && <p role="status">{aviso}</p>}{error && <p className="aj-error" role="alert">{error}</p>}
    {ultimo && <p className="aj-nota">Última {ultimo.modo === "limpiar" ? "limpieza" : "revisión"}: {new Date(ultimo.fecha).toLocaleString("es")} · {ultimo.carpetas} carpetas · {ultimo.errores} incidencias. Espacio disponible: {ultimo.libreDespues === null ? "Sin medición" : formatBytes(ultimo.libreDespues)}.</p>}
    <p className="aj-nota">Al continuar una tarea, el agente reinstala las dependencias necesarias con su lockfile. Las cachés del sistema y los respaldos se administran por separado.</p>
  </section>;
}
