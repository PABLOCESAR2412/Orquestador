import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { config } from "./config";

// Destino persistente independiente del árbol Git, aislado por workspace.
export function carpetaEntregables(workspace: string): string {
  const id = createHash("sha256").update(resolve(workspace)).digest("hex");
  return resolve(join(config.dataDir, "entregables", id));
}
