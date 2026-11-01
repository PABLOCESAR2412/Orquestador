import type { PasoActividad } from "../api";

export type RolAuxiliarVivo = "arquitectura" | "seguridad" | "verificacion";
export type AuxiliarVivo = {
  rol: RolAuxiliarVivo;
  modelo: string;
  estado: "running" | "done" | "failed" | "cancelled";
  avance: string;
  instruccion: string | null;
  pasos: PasoActividad[];
};

export function auxiliaresEnVivo(pasos: PasoActividad[]): AuxiliarVivo[] {
  const auxiliares = new Map<RolAuxiliarVivo, AuxiliarVivo>();
  const hito = /^Auxiliar (arquitectura|seguridad|verificacion) \(([^)]+)\):\s*(.+)$/i;
  const accion = /^\[(arquitectura|seguridad|verificacion)\]\s*(.+)$/i;
  for (const paso of pasos) {
    const texto = paso.tipo === "texto" ? paso.titulo : "";
    const resultadoHito = texto.match(hito);
    const resultadoAccion = paso.tipo === "accion" ? paso.titulo.match(accion) : null;
    const rol = (resultadoHito?.[1] ?? resultadoAccion?.[1]) as RolAuxiliarVivo | undefined;
    if (!rol) continue;
    let auxiliar = auxiliares.get(rol);
    if (!auxiliar) {
      auxiliar = {
        rol,
        modelo: resultadoHito?.[2] ?? "Modelo auxiliar",
        estado: "running",
        avance: "Preparando revisión de solo lectura",
        instruccion: null,
        pasos: [],
      };
      auxiliares.set(rol, auxiliar);
    }
    if (resultadoHito) {
      auxiliar.modelo = resultadoHito[2];
      const detalle = resultadoHito[3].replace(/[.!]+$/, "");
      if (/^encargo del supervisor:/i.test(detalle)) {
        auxiliar.instruccion = detalle.replace(/^encargo del supervisor:\s*/i, "");
        continue;
      }
      if (auxiliar.estado === "running" || /^(?:termin[oó]|reutilic[eé]|fall[oó]|(?:se\s+)?cancel|inici[oó])/i.test(detalle)) auxiliar.avance = detalle;
      if (/^(?:termin[oó] la revisi[oó]n|reutilic[eé] la revisi[oó]n)/i.test(detalle)) auxiliar.estado = "done";
      else if (/^fall[oó](?:\s|:|$)/i.test(detalle)) auxiliar.estado = "failed";
      else if (/^(?:se\s+)?cancel(?:[oó]|ado)/i.test(detalle)) auxiliar.estado = "cancelled";
      else if (/^inici[oó] la revisi[oó]n/i.test(detalle)) auxiliar.estado = "running";
    } else if (resultadoAccion && paso.tipo === "accion") {
      auxiliar.pasos.push({ ...paso, titulo: resultadoAccion[2] });
      if (auxiliar.estado === "running") auxiliar.avance = paso.titulo.replace(/^\[[^\]]+\]\s*/, "");
      // Una herramienta puede fallar y corregirse: el hito final determina el estado del auxiliar.
    }
  }
  return [...auxiliares.values()];
}
