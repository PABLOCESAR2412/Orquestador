import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { config } from "./config";
import { ArchivoError, normalizarRuta } from "./archivos-proyecto";

export function resolverReferenciaEntregable(referencia: string | undefined, raices: string[]) {
  const prefijo = /^\.\.[\\/]entregables[\\/]([a-f0-9]{64})[\\/](.+)$/.exec(referencia ?? "");
  if (!prefijo) return { raices, ruta: normalizarRuta(referencia), referencia: null };
  const raiz = resolve(config.dataDir, "entregables", prefijo[1]!);
  if (!raices.includes(raiz)) throw new ArchivoError("project_path_not_found", 404);
  return { raices: [raiz], ruta: normalizarRuta(prefijo[2]), referencia };
}

// Destino persistente independiente del árbol Git, aislado por workspace.
export function carpetaEntregables(workspace: string): string {
  const id = createHash("sha256").update(resolve(workspace)).digest("hex");
  return resolve(join(config.dataDir, "entregables", id));
}
