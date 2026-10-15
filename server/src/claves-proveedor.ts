import { db } from "./db";
import { claveMaestra, cifrar, descifrar } from "./secretos";

// Claves de proveedor guardadas desde Ajustes (Groq, NVIDIA, Gemini). Se cifran con la misma clave maestra
// que los secretos (AES-256-GCM, AAD "proveedor:<id>") y llegan a los agentes con el nombre de variable que
// OpenCode espera. La API nunca devuelve el valor: solo dice si la clave está configurada.

// `variables`: la primera es la que se muestra en Ajustes; las demás son alias que OpenCode también puede leer.
export type ProveedorConClave = { id: string; etiqueta: string; variables: string[] };

// Nombres de variable: GROQ_API_KEY está en la documentación de OpenCode. Para Gemini la versión actual
// usa GOOGLE_GENERATIVE_AI_API_KEY y la antigua GEMINI_API_KEY: se envían las dos.
// NVIDIA_API_KEY viene de un artículo de terceros y debe confirmarse con `opencode models` en el VM.
export const PROVEEDORES_CON_CLAVE: ProveedorConClave[] = [
  { id: "groq", etiqueta: "Groq", variables: ["GROQ_API_KEY"] },
  { id: "nvidia", etiqueta: "NVIDIA", variables: ["NVIDIA_API_KEY"] },
  { id: "google", etiqueta: "Google (Gemini)", variables: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"] },
];

const MIN_CLAVE = 8;
const MAX_CLAVE = 512;

type FilaClave = { iv: string; tag: string; value_enc: string };

const textoAsociado = (id: string) => `proveedor:${id}`;

export function proveedorConClave(id: string): ProveedorConClave | null {
  return PROVEEDORES_CON_CLAVE.find((p) => p.id === id) ?? null;
}

// Una clave de API no tiene espacios: un valor con espacios o saltos suele ser texto pegado de más.
export function claveProveedorValida(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length >= MIN_CLAVE && valor.length <= MAX_CLAVE && !/\s/.test(valor);
}

export function tieneClaveProveedor(id: string): boolean {
  return db.query("SELECT 1 AS ok FROM provider_keys WHERE proveedor = ?").get(id) !== null;
}

// Devuelve la fecha de actualización, o null si no hay clave maestra para cifrar.
export function guardarClaveProveedor(id: string, valor: string): string | null {
  const clave = claveMaestra();
  if (!clave) return null;
  const cifrado = cifrar(clave, valor, textoAsociado(id));
  db.query(
    `INSERT INTO provider_keys (proveedor, iv, tag, value_enc, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(proveedor) DO UPDATE SET
       iv = excluded.iv, tag = excluded.tag, value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
  ).run(id, cifrado.iv, cifrado.tag, cifrado.value_enc);
  return (
    db
      .query<{ updated_at: string }, [string]>("SELECT updated_at FROM provider_keys WHERE proveedor = ?")
      .get(id)?.updated_at ?? null
  );
}

export function borrarClaveProveedor(id: string): boolean {
  return db.query("DELETE FROM provider_keys WHERE proveedor = ?").run(id).changes > 0;
}

export function estadoClaves(): {
  id: string;
  etiqueta: string;
  variable: string;
  configurada: boolean;
  actualizada_en: string | null;
}[] {
  const fechas = new Map(
    db
      .query<{ proveedor: string; updated_at: string }, []>("SELECT proveedor, updated_at FROM provider_keys")
      .all()
      .map((f) => [f.proveedor, f.updated_at]),
  );
  return PROVEEDORES_CON_CLAVE.map((p) => ({
    id: p.id,
    etiqueta: p.etiqueta,
    variable: p.variables[0],
    configurada: fechas.has(p.id),
    actualizada_en: fechas.get(p.id) ?? null,
  }));
}

// Proveedores cuya clave llega de verdad al CLI y a los agentes (guardada y descifrable).
// Devuelve id -> etiqueta. Lo usa la lista de modelos para mostrar los del proveedor.
export function proveedoresConClave(): Map<string, string> {
  const entorno = entornoProveedores();
  return new Map(
    PROVEEDORES_CON_CLAVE.filter((p) => p.variables.some((v) => Object.hasOwn(entorno, v))).map((p) => [p.id, p.etiqueta]),
  );
}

// Variables de las claves guardadas, listas para el entorno de un agente o de `opencode models`.
// Una clave que no descifra se omite sin mostrar nada. Nunca lanza error.
export function entornoProveedores(): Record<string, string> {
  try {
    const clave = claveMaestra();
    if (!clave) return {};
    const filas = db
      .query<FilaClave & { proveedor: string }, []>("SELECT proveedor, iv, tag, value_enc FROM provider_keys")
      .all();
    const entorno: Record<string, string> = {};
    for (const fila of filas) {
      const proveedor = proveedorConClave(fila.proveedor);
      if (!proveedor) continue;
      try {
        const valor = descifrar(clave, fila, textoAsociado(proveedor.id));
        for (const variable of proveedor.variables) entorno[variable] = valor;
      } catch {
        // Una clave que no descifra se omite: no se registra su contenido ni su nombre.
      }
    }
    return entorno;
  } catch {
    return {};
  }
}
