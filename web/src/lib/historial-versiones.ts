export type CambioRegistrado = {
  fecha: string;
  tipo: "grande" | "mediano" | "minimo";
  titulo: string;
  pr: number | null;
};

export type ActualizacionPorPR = {
  pr: number;
  fecha: string;
  tipo: CambioRegistrado["tipo"];
  cambios: CambioRegistrado[];
};

export function historialPorPR(cambios: readonly CambioRegistrado[]): ActualizacionPorPR[] {
  const grupos = new Map<number, ActualizacionPorPR>();

  for (const cambio of cambios) {
    if (cambio.pr === null) continue;
    let grupo = grupos.get(cambio.pr);
    if (!grupo) {
      grupo = { pr: cambio.pr, fecha: cambio.fecha, tipo: cambio.tipo, cambios: [] };
      grupos.set(cambio.pr, grupo);
    }
    if (cambio.fecha > grupo.fecha) grupo.fecha = cambio.fecha;
    grupo.cambios.push(cambio);
    if (cambio.tipo === "grande" || (cambio.tipo === "mediano" && grupo.tipo === "minimo")) {
      grupo.tipo = cambio.tipo;
    }
  }

  return [...grupos.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.pr - a.pr);
}
