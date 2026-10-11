import { Hono } from "hono";
import { db } from "../db";

// Saldo o cuota por cuenta o clave. Ningún proveedor tiene todavía una API de saldo verificada,
// así que el saldo lo anota el usuario y el servidor le resta el uso que Telo registró después.
// Precisión: "estimado" = saldo anotado menos uso registrado desde la anotación.
//            "sin_saldo" = no hay ninguna cuenta anotada para ese proveedor.

type CuentaRow = {
  id: string;
  provider: string;
  label: string;
  remaining_usd: number;
  limit_usd: number | null;
  note: string | null;
  updated_at: string;
};

const NOMBRES: Record<string, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  google: "Google (Gemini)",
  openrouter: "OpenRouter",
  groq: "Groq",
  nvidia: "NVIDIA",
  openai: "OpenAI",
};

// Formato de SQLite (UTC): "AAAA-MM-DD HH:MM:SS", comparable como texto.
function ahoraSqlite(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function inicioDelMes(): string {
  const ahora = new Date();
  const inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
  return inicio.toISOString().slice(0, 19).replace("T", " ");
}

function usoDesde(provider: string, desde: string): number {
  const row = db
    .query<{ total: number }, [string, string]>(
      "SELECT COALESCE(SUM(cost), 0) AS total FROM usage WHERE provider = ? AND created_at >= ?",
    )
    .get(provider, desde);
  return row?.total ?? 0;
}

function redondear(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export const cuotas = new Hono();

// GET /api/cuotas -> un bloque por proveedor con uso del mes y sus cuentas
cuotas.get("/cuotas", (c) => {
  const cuentas = db
    .query<CuentaRow, []>(
      "SELECT id, provider, label, remaining_usd, limit_usd, note, updated_at FROM quota_accounts ORDER BY provider, created_at",
    )
    .all();

  // Proveedores: los que tienen cuentas anotadas y los que ya tuvieron uso registrado.
  const usados = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM usage")
    .all()
    .map((r) => r.provider);
  const ids = [...new Set([...usados, ...cuentas.map((x) => x.provider), "opencode"])].sort();

  const mesInicio = inicioDelMes();
  const proveedores = ids.map((id) => {
    const suyas = cuentas
      .filter((cuenta) => cuenta.provider === id)
      .map((cuenta) => {
        const usoPosterior = usoDesde(id, cuenta.updated_at);
        return {
          id: cuenta.id,
          label: cuenta.label,
          anotadoUsd: redondear(cuenta.remaining_usd),
          limiteUsd: cuenta.limit_usd,
          saldoEstimadoUsd: redondear(cuenta.remaining_usd - usoPosterior),
          usoDesdeAnotacionUsd: redondear(usoPosterior),
          anotadoEn: cuenta.updated_at,
          nota: cuenta.note,
          precision: "estimado" as const,
        };
      });
    return {
      id,
      nombre: NOMBRES[id] ?? id,
      gastoMesUsd: redondear(usoDesde(id, mesInicio)),
      cuentas: suyas,
      precision: suyas.length > 0 ? ("estimado" as const) : ("sin_saldo" as const),
    };
  });

  return c.json({ generado: new Date().toISOString(), proveedores });
});

// POST /api/cuotas  body: { provider, label, remainingUsd, limitUsd?, note? }
cuotas.post("/cuotas", async (c) => {
  const body = await c.req
    .json<{ provider?: string; label?: string; remainingUsd?: number; limitUsd?: number | null; note?: string | null }>()
    .catch(() => ({}) as { provider?: string; label?: string; remainingUsd?: number; limitUsd?: number | null; note?: string | null });

  const provider = body.provider?.trim().toLowerCase() ?? "";
  const label = body.label?.trim() ?? "";
  const remaining = Number(body.remainingUsd);
  if (!/^[a-z0-9-]{2,30}$/.test(provider)) return c.json({ error: "invalid_provider" }, 400);
  if (!label || label.length > 60) return c.json({ error: "invalid_label" }, 400);
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 1_000_000) {
    return c.json({ error: "invalid_amount" }, 400);
  }
  const limit = body.limitUsd == null ? null : Number(body.limitUsd);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return c.json({ error: "invalid_amount" }, 400);

  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO quota_accounts (id, provider, label, remaining_usd, limit_usd, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, provider, label, remaining, limit, body.note?.trim() || null, ahoraSqlite());
  return c.json({ id }, 201);
});

// PUT /api/cuotas/:id  body: { remainingUsd, limitUsd?, note? }
// Cada anotación reinicia el cálculo: el uso se cuenta desde el momento de la nueva anotación.
cuotas.put("/cuotas/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ remainingUsd?: number; limitUsd?: number | null; note?: string | null }>()
    .catch(() => ({}) as { remainingUsd?: number; limitUsd?: number | null; note?: string | null });

  const remaining = Number(body.remainingUsd);
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 1_000_000) {
    return c.json({ error: "invalid_amount" }, 400);
  }
  const limit = body.limitUsd == null ? null : Number(body.limitUsd);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return c.json({ error: "invalid_amount" }, 400);

  const result = db
    .query("UPDATE quota_accounts SET remaining_usd = ?, limit_usd = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(remaining, limit, body.note?.trim() || null, ahoraSqlite(), id);
  if (result.changes === 0) return c.json({ error: "quota_not_found" }, 404);
  return c.json({ ok: true });
});

// DELETE /api/cuotas/:id
cuotas.delete("/cuotas/:id", (c) => {
  const result = db.query("DELETE FROM quota_accounts WHERE id = ?").run(c.req.param("id"));
  if (result.changes === 0) return c.json({ error: "quota_not_found" }, 404);
  return c.json({ ok: true });
});
