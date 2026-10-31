import { limiteProveedor, MAX_TAREAS_SIMULTANEAS, proveedorAgente } from "./limites";

type Espera = {
  modelo: string;
  proveedor: string;
  signal?: AbortSignal;
  estado?: (estado: "waiting" | "ready" | "cancelled") => void;
  resolve: (liberar: () => void) => void;
  reject: (error: Error) => void;
  cancelar?: () => void;
};
let activos = 0;
const porProveedor = new Map<string, number>();
const cola: Espera[] = [];
const avisar = (espera: Espera, estado: "waiting" | "ready" | "cancelled") => {
  try { espera.estado?.(estado); } catch { /* La vista no gobierna la admisión. */ }
};

function admitir(): void {
  for (let i = 0; i < cola.length && activos < MAX_TAREAS_SIMULTANEAS;) {
    const espera = cola[i];
    const ocupados = porProveedor.get(espera.proveedor) ?? 0;
    if (ocupados >= limiteProveedor(espera.modelo)) { i++; continue; }
    cola.splice(i, 1);
    if (espera.cancelar) espera.signal?.removeEventListener("abort", espera.cancelar);
    activos++;
    porProveedor.set(espera.proveedor, ocupados + 1);
    avisar(espera, "ready");
    let liberado = false;
    espera.resolve(() => {
      if (liberado) return;
      liberado = true;
      activos--;
      const restantes = (porProveedor.get(espera.proveedor) ?? 1) - 1;
      if (restantes) porProveedor.set(espera.proveedor, restantes); else porProveedor.delete(espera.proveedor);
      admitir();
    });
  }
}

// Una espera de un proveedor saturado no toma un puesto global ni bloquea a los demás.
export async function reservarAgente(modelo: string, signal?: AbortSignal, estado?: Espera["estado"]): Promise<() => void> {
  if (signal?.aborted) throw new Error("Ejecución cancelada.");
  const liberar = await new Promise<() => void>((resolve, reject) => {
    const espera: Espera = { modelo, proveedor: proveedorAgente(modelo), signal, resolve, reject };
    espera.cancelar = () => {
      const indice = cola.indexOf(espera);
      if (indice < 0) return;
      cola.splice(indice, 1);
      avisar(espera, "cancelled");
      reject(new Error("Ejecución cancelada."));
    };
    signal?.addEventListener("abort", espera.cancelar, { once: true });
    cola.push(espera);
    admitir();
    if (cola.includes(espera)) { espera.estado = estado; avisar(espera, "waiting"); }
  });
  // La cancelación puede llegar después de admitir y antes de reanudar este await.
  if (signal?.aborted) { liberar(); throw new Error("Ejecución cancelada."); }
  return liberar;
}
