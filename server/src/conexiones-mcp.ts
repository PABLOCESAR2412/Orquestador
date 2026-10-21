import { randomUUID } from "node:crypto";
import { db } from "./db";
import { claveMaestra, cifrar, descifrar, valorSecretoValido } from "./secretos";

type FilaMcp = {
  id: string;
  name: string;
  url: string;
  enabled: number;
  token_iv: string | null;
  token_tag: string | null;
  token_enc: string | null;
  created_at: string;
  updated_at: string;
};

export type ConexionMcpPublica = {
  id: string;
  nombre: string;
  url: string;
  habilitada: boolean;
  autenticacion_configurada: boolean;
  creada_en: string;
  actualizada_en: string;
};

export type ServidorMcpAgente = {
  clave: string;
  url: string;
  variableToken?: string;
};

export type ConfiguracionMcpAgente = {
  servidores: ServidorMcpAgente[];
  variables: Record<string, string>;
};

export function configuracionOpenCodeMcp(servidores: ServidorMcpAgente[]) {
  return {
    mcp: Object.fromEntries(servidores.map((servidor) => [servidor.clave, {
      type: "remote",
      url: servidor.url,
      enabled: true,
      ...(servidor.variableToken
        ? { headers: { Authorization: `Bearer {env:${servidor.variableToken}}` } }
        : {}),
    }])),
  };
}

export function argumentosConfigMcpCodex(servidores: ServidorMcpAgente[]): string[] {
  return servidores.flatMap((servidor) => [
    "-c", `mcp_servers.${servidor.clave}.url=${JSON.stringify(servidor.url)}`,
    "-c", `mcp_servers.${servidor.clave}.enabled=true`,
    ...(servidor.variableToken
      ? ["-c", `mcp_servers.${servidor.clave}.bearer_token_env_var=${JSON.stringify(servidor.variableToken)}`]
      : []),
  ]);
}

const AAD = (id: string) => `mcp_connections|${id}|token`;
const MAX_NOMBRE = 64;
const MAX_URL = 2048;

export function validarNombreConexion(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0 && valor.trim().length <= MAX_NOMBRE && !/[\r\n\0]/.test(valor);
}

export function normalizarUrlMcp(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > MAX_URL) return null;
  try {
    const url = new URL(valor.trim());
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null;
    return url.toString().replace(/\/$/, "") || url.origin;
  } catch {
    return null;
  }
}

export function validarTokenMcp(valor: unknown): valor is string {
  // El redactor de salidas del agente omite valores menores de cuatro caracteres.
  return valor === "" || (valorSecretoValido(valor) && valor.length >= 4 && !/[\r\n]/.test(valor));
}

function vista(fila: FilaMcp): ConexionMcpPublica {
  return {
    id: fila.id,
    nombre: fila.name,
    url: fila.url,
    habilitada: fila.enabled === 1,
    autenticacion_configurada: fila.token_enc !== null,
    creada_en: fila.created_at,
    actualizada_en: fila.updated_at,
  };
}

export function listarConexionesMcp(): ConexionMcpPublica[] {
  const filas = db.query<FilaMcp, []>(
    `SELECT id, name, url, enabled, token_iv, token_tag, token_enc, created_at, updated_at
       FROM mcp_connections ORDER BY name COLLATE NOCASE`,
  ).all();
  return filas.map(vista);
}

export function crearConexionMcp(nombre: string, url: string, token = ""): ConexionMcpPublica | null {
  const id = randomUUID();
  const cifrado = token ? (() => {
    const clave = claveMaestra();
    if (!clave) return null;
    return cifrar(clave, token, AAD(id));
  })() : null;
  if (token && !cifrado) return null;

  try {
    db.query(
      `INSERT INTO mcp_connections (id, name, url, token_iv, token_tag, token_enc)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, nombre.trim(), url, cifrado?.iv ?? null, cifrado?.tag ?? null, cifrado?.value_enc ?? null);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return null;
    throw error;
  }
  const creada = db.query<FilaMcp, [string]>(
    `SELECT id, name, url, enabled, token_iv, token_tag, token_enc, created_at, updated_at
       FROM mcp_connections WHERE id = ?`,
  ).get(id);
  return creada ? vista(creada) : null;
}

export function actualizarConexionMcp(
  id: string,
  patch: { nombre?: string; url?: string; habilitada?: boolean; token?: string; quitarToken?: boolean },
): ConexionMcpPublica | null {
  const fila = db.query<FilaMcp, [string]>(
    `SELECT id, name, url, enabled, token_iv, token_tag, token_enc, created_at, updated_at
       FROM mcp_connections WHERE id = ?`,
  ).get(id);
  if (!fila) return null;

  let cifrado = fila.token_enc
    ? { iv: fila.token_iv!, tag: fila.token_tag!, value_enc: fila.token_enc }
    : null;
  if (patch.quitarToken) cifrado = null;
  else if (patch.token) {
    const clave = claveMaestra();
    if (!clave) return null;
    cifrado = cifrar(clave, patch.token, AAD(id));
  }

  try {
    db.query(
      `UPDATE mcp_connections
          SET name = ?, url = ?, enabled = ?, token_iv = ?, token_tag = ?, token_enc = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      patch.nombre?.trim() ?? fila.name,
      patch.url ?? fila.url,
      patch.habilitada === undefined ? fila.enabled : patch.habilitada ? 1 : 0,
      cifrado?.iv ?? null,
      cifrado?.tag ?? null,
      cifrado?.value_enc ?? null,
      id,
    );
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return null;
    throw error;
  }
  const actualizada = db.query<FilaMcp, [string]>(
    `SELECT id, name, url, enabled, token_iv, token_tag, token_enc, created_at, updated_at
       FROM mcp_connections WHERE id = ?`,
  ).get(id);
  return actualizada ? vista(actualizada) : null;
}

export function borrarConexionMcp(id: string): boolean {
  return db.query("DELETE FROM mcp_connections WHERE id = ?").run(id).changes > 0;
}

// Los agentes reciben solo servidores habilitados. Los secretos cifrados nunca se serializan a la API
// ni se escriben en archivos de configuración: se resuelven por variables temporales del proceso.
export function configuracionMcpParaAgente(): ConfiguracionMcpAgente {
  const filas = db.query<FilaMcp, []>(
    `SELECT id, name, url, enabled, token_iv, token_tag, token_enc, created_at, updated_at
       FROM mcp_connections WHERE enabled = 1 ORDER BY name COLLATE NOCASE`,
  ).all();
  const servidores: ServidorMcpAgente[] = [];
  const variables: Record<string, string> = {};
  const clave = claveMaestra();

  for (const fila of filas) {
    const servidor: ServidorMcpAgente = {
      clave: `telo_${fila.id.replace(/-/g, "").slice(0, 16)}`,
      url: fila.url,
    };
    if (fila.token_enc && clave) {
      try {
        const variableToken = `MCP_AUTH_${fila.id.replace(/-/g, "").toUpperCase()}`;
        variables[variableToken] = descifrar(
          clave,
          { iv: fila.token_iv!, tag: fila.token_tag!, value_enc: fila.token_enc },
          AAD(fila.id),
        );
        servidor.variableToken = variableToken;
      } catch {
        // Una conexión con una credencial dañada se omite; no se intenta como si fuera pública.
        continue;
      }
    } else if (fila.token_enc) {
      // Sin la clave maestra no se intenta una conexión autenticada sin su credencial.
      continue;
    }
    servidores.push(servidor);
  }
  return { servidores, variables };
}
