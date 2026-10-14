import { Hono } from "hono";
import {
  borrarClaveProveedor,
  claveProveedorValida,
  estadoClaves,
  guardarClaveProveedor,
  proveedorConClave,
} from "../claves-proveedor";
import { invalidarModelos } from "../models";
import { secretosDisponibles } from "../secretos";
import { leerCuerpoJson } from "./projects";

// Claves de proveedor desde Ajustes. El valor se escribe una vez y nunca vuelve por la API:
// solo se dice si está configurada y cuándo se actualizó.
export const clavesProveedor = new Hono();

// GET /api/claves-proveedor -> { disponible, proveedores: [{ id, etiqueta, variable, configurada, actualizada_en }] }
clavesProveedor.get("/claves-proveedor", (c) =>
  c.json({ disponible: secretosDisponibles(), proveedores: estadoClaves() }),
);

// PUT /api/claves-proveedor/:id  body: { valor }
clavesProveedor.put("/claves-proveedor/:id", async (c) => {
  const id = c.req.param("id");
  if (!proveedorConClave(id)) return c.json({ error: "proveedor_desconocido" }, 404);

  const body = await leerCuerpoJson<{ valor?: unknown }>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  if (!claveProveedorValida(body.valor)) return c.json({ error: "clave_proveedor_invalida" }, 400);

  const actualizada = guardarClaveProveedor(id, body.valor);
  if (!actualizada) return c.json({ error: "secretos_no_configurados" }, 503);
  // La lista de modelos cambia con la clave: se vuelve a pedir en la siguiente consulta.
  invalidarModelos();
  return c.json({ id, configurada: true, actualizada_en: actualizada });
});

// DELETE /api/claves-proveedor/:id -> { ok: true }
clavesProveedor.delete("/claves-proveedor/:id", (c) => {
  const id = c.req.param("id");
  if (!proveedorConClave(id)) return c.json({ error: "proveedor_desconocido" }, 404);
  // Código propio: `clave_no_encontrada` ya lo usan las claves de GitHub de los proyectos.
  if (!borrarClaveProveedor(id)) return c.json({ error: "proveedor_sin_clave" }, 404);
  invalidarModelos();
  return c.json({ ok: true });
});
