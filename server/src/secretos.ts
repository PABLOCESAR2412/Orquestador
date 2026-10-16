import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "./db";

// Secretos por proyecto, cifrados con AES-256-GCM. La clave viene de TELO_CLAVE_CIFRADO (32 bytes
// en base64) y vive en el archivo de entorno del servidor. Sin clave, el resto de la app sigue
// funcionando: los secretos no se guardan ni se leen. Ningún valor sale de este módulo salvo
// hacia el entorno de un agente del proyecto o hacia un comando Git del servidor.

const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_CLAVE = 32;
export const MAX_VALOR_SECRETO = 8192;

const PATRON_NOMBRE = /^[A-Z_][A-Z0-9_]{1,63}$/;
// Nombres que tocarían el comportamiento del sistema, del agente, de Telo o del cargador de
// bibliotecas y de intérpretes. Un secreto de proyecto no puede llamarse así.
const PREFIJOS_PROHIBIDOS = [
  "TELO_",
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "IFS",
  "ENV",
  "BASH_ENV",
  "PYTHONPATH",
  "NODE_OPTIONS",
  "LD_",
  "DYLD_",
  "GIT_",
  "BASH_",
  "NODE_",
  "PYTHON",
  "LC_",
  "XDG_",
  "OPENCODE_",
  "SSL_",
  "HTTP_",
  "HTTPS_",
  "LOCPATH",
  "GCONV_",
  "NLSPATH",
  "CDPATH",
  "ZDOTDIR",
  "PROMPT_",
  "SSH_",
  "PERL",
  "RUBY",
  "JAVA_",
  "_JAVA",
  "BUN_",
  "NPM_",
];
const NOMBRES_PROHIBIDOS = new Set([
  "TERM",
  "TZ",
  "LANG",
  "TMPDIR",
  "NO_PROXY",
  "ALL_PROXY",
  "PS1",
  "PS4",
  "CLASSPATH",
]);

// Variables que nunca van al entorno de un agente: el servidor las usa para subir (GITHUB_TOKEN)
// y para crear pull requests (GITHUB_PR_TOKEN).
export const SECRETOS_SOLO_SERVIDOR: readonly string[] = ["GITHUB_TOKEN", "GITHUB_PR_TOKEN"];

export type CifradoSecreto = { iv: string; tag: string; value_enc: string };

// Verdadero si el nombre tocaría el sistema, el agente o Telo. Lo usan la API de secretos y el
// entorno del agente, para que ningún secreto de proyecto pueda sobrescribir esas variables.
export function esVariableReservada(nombre: string): boolean {
  return PREFIJOS_PROHIBIDOS.some((prefijo) => nombre.startsWith(prefijo)) || NOMBRES_PROHIBIDOS.has(nombre);
}

export function nombreSecretoValido(nombre: string): boolean {
  if (!PATRON_NOMBRE.test(nombre)) return false;
  return !esVariableReservada(nombre);
}

export function valorSecretoValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length >= 1 && valor.length <= MAX_VALOR_SECRETO && !valor.includes("\0");
}

// Lee la clave del entorno. Devuelve null si falta o no decodifica a exactamente 32 bytes.
export function claveMaestra(): Buffer | null {
  const texto = process.env.TELO_CLAVE_CIFRADO?.trim();
  if (!texto) return null;
  const bytes = Buffer.from(texto, "base64");
  if (bytes.length !== LARGO_CLAVE || bytes.toString("base64") !== texto) return null;
  return bytes;
}

export function secretosDisponibles(): boolean {
  return claveMaestra() !== null;
}

// El texto asociado (AAD) ata el cifrado a su fila: copiar un valor a otro proyecto o nombre falla.
function textoAsociado(projectId: string, nombre: string): string {
  return `${projectId}|${nombre}`;
}

export function cifrar(clave: Buffer, texto: string, aad: string): CifradoSecreto {
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv(ALGORITMO, clave, iv, { authTagLength: LARGO_TAG });
  cifrador.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    value_enc: enc.toString("base64"),
  };
}

// Lanza error si el texto cifrado, la etiqueta o el AAD no coinciden.
export function descifrar(clave: Buffer, cifrado: CifradoSecreto, aad: string): string {
  const iv = Buffer.from(cifrado.iv, "base64");
  const tag = Buffer.from(cifrado.tag, "base64");
  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) throw new Error("cifrado_invalido");
  const decifrador = createDecipheriv(ALGORITMO, clave, iv, { authTagLength: LARGO_TAG });
  decifrador.setAAD(Buffer.from(aad, "utf8"));
  decifrador.setAuthTag(tag);
  return Buffer.concat([decifrador.update(Buffer.from(cifrado.value_enc, "base64")), decifrador.final()]).toString(
    "utf8",
  );
}

type FilaSecreto = { name: string; iv: string; tag: string; value_enc: string };

export function listarSecretos(projectId: string): { nombre: string; actualizado_en: string }[] {
  return db
    .query<{ nombre: string; actualizado_en: string }, [string]>(
      "SELECT name AS nombre, updated_at AS actualizado_en FROM project_secrets WHERE project_id = ? ORDER BY name",
    )
    .all(projectId);
}

// Guarda o reemplaza un secreto. Requiere clave disponible: quien llama lo comprueba antes.
export function guardarSecreto(
  projectId: string,
  nombre: string,
  valor: string,
): { nombre: string; actualizado_en: string } | null {
  const clave = claveMaestra();
  if (!clave) return null;
  const cifrado = cifrar(clave, valor, textoAsociado(projectId, nombre));
  db.query(
    `INSERT INTO project_secrets (project_id, name, iv, tag, value_enc, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, name) DO UPDATE SET
       iv = excluded.iv, tag = excluded.tag, value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
  ).run(projectId, nombre, cifrado.iv, cifrado.tag, cifrado.value_enc);
  return (
    db
      .query<{ nombre: string; actualizado_en: string }, [string, string]>(
        "SELECT name AS nombre, updated_at AS actualizado_en FROM project_secrets WHERE project_id = ? AND name = ?",
      )
      .get(projectId, nombre) ?? null
  );
}

export function borrarSecreto(projectId: string, nombre: string): boolean {
  return db.query("DELETE FROM project_secrets WHERE project_id = ? AND name = ?").run(projectId, nombre).changes > 0;
}

// Variables de entorno de un proyecto para su agente (sin los secretos solo del servidor). Un secreto que no
// descifra se omite sin mostrar nada. Nunca lanza error.
export function entornoDeProyecto(projectId: string): Record<string, string> {
  try {
    const clave = claveMaestra();
    if (!clave) return {};
    const filas = db
      .query<FilaSecreto, [string]>("SELECT name, iv, tag, value_enc FROM project_secrets WHERE project_id = ?")
      .all(projectId)
      .filter((fila) => !SECRETOS_SOLO_SERVIDOR.includes(fila.name));

    const entorno: Record<string, string> = {};
    for (const fila of filas) {
      try {
        if (!nombreSecretoValido(fila.name)) continue;
        entorno[fila.name] = descifrar(clave, fila, textoAsociado(projectId, fila.name));
      } catch {
        // Un valor que no descifra se omite: no se registra su contenido ni su nombre.
      }
    }
    return entorno;
  } catch {
    return {};
  }
}

// Valor de un secreto para uso del servidor (por ejemplo GITHUB_TOKEN en el push), o null.
// Nunca lanza error y nunca se devuelve a la API.
export function valorSecreto(projectId: string, nombre: string): string | null {
  try {
    const clave = claveMaestra();
    if (!clave) return null;
    const fila = db
      .query<FilaSecreto, [string, string]>(
        "SELECT name, iv, tag, value_enc FROM project_secrets WHERE project_id = ? AND name = ?",
      )
      .get(projectId, nombre);
    if (!fila) return null;
    return descifrar(clave, fila, textoAsociado(projectId, nombre));
  } catch {
    return null;
  }
}

// Todos los valores de un proyecto, GITHUB_TOKEN incluido. Sirven solo para ocultarlos en lo que
// sale del servidor. Un valor que no descifra se omite. Nunca lanza error.
export function valoresDeProyecto(projectId: string): string[] {
  try {
    const clave = claveMaestra();
    if (!clave) return [];
    const filas = db
      .query<FilaSecreto, [string]>("SELECT name, iv, tag, value_enc FROM project_secrets WHERE project_id = ?")
      .all(projectId);
    const valores: string[] = [];
    for (const fila of filas) {
      try {
        valores.push(descifrar(clave, fila, textoAsociado(projectId, fila.name)));
      } catch {
        // Un valor que no descifra se omite.
      }
    }
    return valores;
  } catch {
    return [];
  }
}
