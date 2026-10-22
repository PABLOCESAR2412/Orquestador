// Deduplica retransmisiones, pero una transición running → failed vuelve a avisar.
export function registrarTransicion(estados: Map<string, string>, id: string, estado: string): boolean {
  const previo = estados.get(id);
  estados.set(id, estado);
  return !!estado && previo !== estado;
}
