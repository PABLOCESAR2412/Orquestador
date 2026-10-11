import { Hono } from "hono";
import { db } from "../db";
import { cuotaRestanteUsd, nombreProveedor } from "./cuotas";

// Uso que Telo registró por proveedor. Los límites de 5 horas y semanales del proveedor no se leen
// de su API: lo que se muestra es lo medido por Telo.

type Agregado = { costoUsd: number; tokens: number; llamadas: number };

function agregado(provider: string, ventana: string): Agregado {
  const row = db
    .query<{ costo: number; tokens: number; llamadas: number }, [string, string]>(
      `SELECT COALESCE(SUM(cost), 0) AS costo,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COUNT(*) AS llamadas
         FROM usage WHERE provider = ? AND created_at >= datetime('now', ?)`,
    )
    .get(provider, ventana);
  return {
    costoUsd: Math.round((row?.costo ?? 0) * 10_000) / 10_000,
    tokens: row?.tokens ?? 0,
    llamadas: row?.llamadas ?? 0,
  };
}

// Proveedores: los que tienen uso en 30 días, los que tienen cuentas anotadas y OpenCode.
function proveedoresActivos(): string[] {
  const usados = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM usage WHERE created_at >= datetime('now', '-30 days')")
    .all()
    .map((r) => r.provider);
  const conCuentas = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM quota_accounts")
    .all()
    .map((r) => r.provider);
  return [...new Set([...usados, ...conCuentas, "opencode"])].sort();
}

export const uso = new Hono();

// GET /api/uso
uso.get("/uso", (c) => {
  const proveedores = proveedoresActivos().map((id) => {
    const enUltimos30d = db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM usage WHERE provider = ? AND created_at >= datetime('now', '-30 days')",
      )
      .get(id)!.n;
    return {
      id,
      nombre: nombreProveedor(id),
      ultimas5h: agregado(id, "-5 hours"),
      ultimos7d: agregado(id, "-7 days"),
      cuotaRestanteUsd: cuotaRestanteUsd(id),
      precision: enUltimos30d > 0 ? ("medida_telo" as const) : ("sin_datos" as const),
    };
  });

  return c.json({ generado: new Date().toISOString(), proveedores });
});
