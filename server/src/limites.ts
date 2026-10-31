// Capacidad compartida por el worker y las métricas del servidor.
export const MAX_TAREAS_SIMULTANEAS = 10;

export function proveedorAgente(modelo: string): string {
  return modelo.split("/")[0] || "opencode";
}

// El límite es de admisión de Telo, no una afirmación sobre la cuota contratada.
export function limiteProveedor(modelo: string): number {
  const proveedor = proveedorAgente(modelo);
  try {
    const valor = JSON.parse(process.env.TELO_CONCURRENCIA_PROVEEDORES || "{}")[proveedor];
    if (Number.isInteger(valor) && valor >= 1 && valor <= MAX_TAREAS_SIMULTANEAS) return valor;
  } catch { /* Una configuración inválida mantiene la protección por defecto. */ }
  return proveedor === "opencode" ? 1 : 2;
}
