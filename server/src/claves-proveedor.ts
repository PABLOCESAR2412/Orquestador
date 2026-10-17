import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  { id: "google", etiqueta: "Google (Gemini)", variables: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"] },
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
  if (db.query("SELECT 1 AS ok FROM provider_keys WHERE proveedor = ?").get(id) !== null) {
    return true;
  }
  return valorClaveProveedor(id) !== null;
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

// Jev es una integración interna del servidor; su clave no se añade a PROVEEDORES_CON_CLAVE y
// nunca se incorpora al entorno de OpenCode.
export function claveJevActualizadaEn(): string | null {
  return db.query<{ updated_at: string }, []>("SELECT updated_at FROM provider_keys WHERE proveedor = 'jev'").get()?.updated_at ?? null;
}

export function valorClaveJev(): string | null {
  try {
    const clave = claveMaestra();
    if (!clave) return null;
    const fila = db
      .query<FilaClave, []>("SELECT iv, tag, value_enc FROM provider_keys WHERE proveedor = 'jev'")
      .get();
    return fila ? descifrar(clave, fila, textoAsociado("jev")) : null;
  } catch {
    return null;
  }
}

// Busca credenciales guardadas por OpenCode CLI (opencode auth login) en las ubicaciones estándar
export function claveDeAuthJson(id: string): string | null {
  const home = homedir();
  const paths = [
    join(home, ".local", "share", "opencode", "auth.json"),
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "opencode", "auth.json") : null,
    process.env.APPDATA ? join(process.env.APPDATA, "opencode", "auth.json") : null,
    join(home, ".config", "opencode", "auth.json"),
    join(home, ".opencode", "auth.json"),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      const entrada = j[id] ?? (id === "google" ? j["gemini"] : null);
      if (!entrada) continue;
      if (typeof entrada === "string" && entrada.trim()) return entrada.trim();
      if (typeof entrada === "object" && entrada !== null) {
        const ent = entrada as { key?: string; apiKey?: string; token?: string; access_token?: string };
        const k = ent.key || ent.apiKey || ent.token || ent.access_token;
        if (typeof k === "string" && k.trim()) return k.trim();
      }
    } catch {
      // archivo no legible o JSON inválido: continuar con la siguiente ruta
    }
  }
  return null;
}

export function valorClaveProveedor(id: string): string | null {
  try {
    const clave = claveMaestra();
    if (clave) {
      const fila = db
        .query<FilaClave, [string]>("SELECT iv, tag, value_enc FROM provider_keys WHERE proveedor = ?")
        .get(id);
      if (fila) {
        const descifrada = descifrar(clave, fila, textoAsociado(id));
        if (descifrada) return descifrada;
      }
    }
  } catch {
    // Si no descifra o no hay clave maestra
  }

  // Si no está en BD, buscar en variables de entorno directas
  const proveedor = proveedorConClave(id);
  if (proveedor) {
    for (const v of proveedor.variables) {
      if (process.env[v]) return process.env[v]!;
    }
  }

  // Buscar en credenciales autenticadas de OpenCode (~/.local/share/opencode/auth.json)
  const claveAuth = claveDeAuthJson(id);
  if (claveAuth) return claveAuth;

  return null;
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
  return PROVEEDORES_CON_CLAVE.map((p) => {
    const configurada = fechas.has(p.id) || valorClaveProveedor(p.id) !== null;
    return {
      id: p.id,
      etiqueta: p.etiqueta,
      variable: p.variables[0],
      configurada,
      actualizada_en: fechas.get(p.id) ?? (configurada ? "OpenCode / Entorno" : null),
    };
  });
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
  const entorno: Record<string, string> = {};

  // Primero las claves descifradas de provider_keys (tienen prioridad si fueron fijadas en Telo)
  try {
    const clave = claveMaestra();
    if (clave) {
      const filas = db
        .query<FilaClave & { proveedor: string }, []>("SELECT proveedor, iv, tag, value_enc FROM provider_keys")
        .all();
      for (const fila of filas) {
        const proveedor = proveedorConClave(fila.proveedor);
        if (!proveedor) continue;
        try {
          const valor = descifrar(clave, fila, textoAsociado(proveedor.id));
          for (const variable of proveedor.variables) entorno[variable] = valor;
        } catch {
          // Una clave que no descifra se omite
        }
      }
    }
  } catch {
    // ignorar error de BD
  }

  // Para proveedores configurados mediante auth.json o variables de entorno que no estuvieran en BD:
  for (const p of PROVEEDORES_CON_CLAVE) {
    if (p.variables.some((v) => entorno[v])) continue;
    const val = valorClaveProveedor(p.id);
    if (val) {
      for (const variable of p.variables) {
        entorno[variable] = val;
      }
    }
  }

  return entorno;
}
