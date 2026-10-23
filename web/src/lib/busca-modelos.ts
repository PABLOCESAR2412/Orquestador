import { type ModelInfo } from "../api";
import { nombreProveedor } from "./model";

// Buscador dentro del catálogo: baja a minúsculas y quita tildes para que "config" halle "Configuración".
export function normalizaBusca(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// Coincidencia por nombre, identificador, familia y nombre visible del proveedor.
export function coincideModelo(
  modelo: { name: string; id: string; group: string; provider: string },
  busca: string,
): boolean {
  const q = normalizaBusca(busca).trim();
  if (!q) return true;
  const campos = [modelo.name, modelo.id, modelo.group, nombreProveedor(modelo.provider)];
  return campos.some((campo) => normalizaBusca(campo).includes(q));
}

// Agrupa el resultado de una búsqueda por proveedor, conservando el orden del catálogo.
export function agruparPorProveedor(modelos: ModelInfo[]): [string, ModelInfo[]][] {
  const grupos = new Map<string, ModelInfo[]>();
  for (const m of modelos) {
    const lista = grupos.get(m.provider) ?? [];
    lista.push(m);
    grupos.set(m.provider, lista);
  }
  return [...grupos.entries()];
}
