import { db } from "./db";
import type { Usage } from "./runners/opencode";

export function canonicalizarModelo(modelo: string): string {
  if (modelo === "argon" || modelo === "gemini-4-argon") {
    return "google/gemini-4-argon";
  }
  if (modelo.startsWith("gemini-")) {
    return `google/${modelo}`;
  }
  return modelo;
}

export function proveedorDeModelo(modelo: string): string {
  const m = canonicalizarModelo(modelo);
  // La integración de entrada gobierna el consumo, aunque el modelo tenga otro fabricante.
  return m.split("/")[0] || "opencode";
}

// Cada paso se persiste al llegar: fallos, cancelaciones y respaldos conservan el consumo previo.
export function registrarUsoAgente(
  modelo: string,
  uso: Usage,
  contexto: { conversationId?: string | null; projectId?: string | null; taskId?: string; turnId?: string | null; usageRole?: string; providerEventId?: string },
): void {
  const modeloCanonico = canonicalizarModelo(modelo);
  const provider = proveedorDeModelo(modeloCanonico);
  const costo = uso.cost;
  const costPrecision = uso.costeDisponible === undefined ? "desconocida" : uso.costeDisponible ? "estimado" : "no_disponible";

  db.query(
    `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens,
      reasoning_tokens, cache_read_tokens, cost, project_id, task_id, tokens_precision, cost_precision,
      turn_id, usage_role, provider_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING`,
  ).run(
    crypto.randomUUID(), contexto.conversationId ?? null, provider, modeloCanonico,
    uso.input, uso.output, uso.reasoning, uso.cacheRead, costo,
    contexto.projectId ?? null, contexto.taskId ?? null,
    uso.tokensEstimados ? "estimado" : uso.tokensMedidos === undefined ? "desconocida" : uso.tokensMedidos ? "medida" : "no_disponible",
    costPrecision,
    contexto.turnId ?? null, contexto.usageRole ?? "unknown",
    contexto.providerEventId ?? null,
  );
}
