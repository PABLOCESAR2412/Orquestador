import datos from "../cambios.json";

// Versión del sistema (X.Y.Z), calculada desde web/src/cambios.json. No se escribe a mano:
// agregar una entrada a `cambios` la sube sola. Distinta de version.json del build (ver lib/version.ts).
//   X: cambios grandes, sobre la base.
//   Y: sube 1 por cada 5 cambios medianos.
//   Z: sube 1 por cada 10 cambios mínimos.
const [baseX, baseY, baseZ] = datos.base.split(".").map(Number);

const cuenta = { grande: 0, mediano: 0, minimo: 0 };
for (const cambio of datos.cambios) {
  if (cambio.tipo === "grande") cuenta.grande++;
  else if (cambio.tipo === "mediano") cuenta.mediano++;
  else if (cambio.tipo === "minimo") cuenta.minimo++;
}

export const VERSION_SISTEMA = [
  baseX + cuenta.grande,
  baseY + Math.floor(cuenta.mediano / 5),
  baseZ + Math.floor(cuenta.minimo / 10),
].join(".");
