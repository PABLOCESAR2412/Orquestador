import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { cifrar, claveMaestra, descifrar } from "./secretos";

// Clave SSH por proyecto para subir ramas a GitHub (deploy key). Telo la crea con ssh-keygen. La
// parte privada se guarda cifrada con AES-256-GCM (misma clave que los secretos) y la pública se
// muestra para pegarla en el repo. GitHub exige permiso de escritura para que una deploy key suba
// ramas, y no puede limitarla a una rama: por eso Telo solo empuja a la rama de cada tarea.
// El agente nunca recibe esta clave. Solo el servidor la usa, en un archivo temporal que se borra
// al terminar el comando Git.

// Clave pública de host de github.com (ed25519). Se fija para no confiar en la primera conexión.
// Huella publicada por GitHub: SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.
// Si GitHub la rota, la subida falla cerrada: nunca conecta sin verificar.
export const HOST_GITHUB_ED25519 =
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

// Error con código para la API. Los códigos se traducen en web/src/lib/model.ts.
export class ErrorClaveSsh extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type ClavePublica = { publica: string; huella: string; creada_en: string };

type FilaClave = { iv: string; tag: string; value_enc: string };

// El texto asociado ata el cifrado a su proyecto: copiar la fila a otro proyecto no descifra.
const textoAsociado = (projectId: string) => `${projectId}|clave_ssh`;

// Directorio temporal dentro de DATA_DIR. No se usa /tmp: el aislamiento de los agentes monta el
// sistema en solo lectura, así que /tmp les sería visible. DATA_DIR sí queda oculto para ellos.
function dirTemporal(prefijo: string): string {
  const base = join(config.dataDir, "tmp");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(base, prefijo));
}

// Huella con el mismo formato que ssh-keygen: SHA256 del blob de la clave, en base64 sin relleno.
export function huellaDe(linea: string): string {
  const blob = Buffer.from(linea.trim().split(/\s+/)[1] ?? "", "base64");
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

// Convierte la URL normalizada de GitHub (https://github.com/<dueño>/<repo>) a su forma SSH.
// Devuelve null para cualquier otro destino.
export function urlSshDeGithub(urlHttps: string): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_][A-Za-z0-9_.-]*)$/.exec(urlHttps);
  return m ? `git@github.com:${m[1]}/${m[2]}.git` : null;
}

export function clavePublicaDe(projectId: string): ClavePublica | null {
  const fila = db
    .query<{ public_key: string; fingerprint: string; created_at: string }, [string]>(
      "SELECT public_key, fingerprint, created_at FROM project_ssh_keys WHERE project_id = ?",
    )
    .get(projectId);
  return fila ? { publica: fila.public_key, huella: fila.fingerprint, creada_en: fila.created_at } : null;
}

// Crea el par de claves de un proyecto. Falla si ya tiene una: para cambiarla, primero se borra.
export async function generarClaveProyecto(projectId: string): Promise<ClavePublica> {
  const clave = claveMaestra();
  if (!clave) throw new ErrorClaveSsh("clave_sin_cifrado");
  if (clavePublicaDe(projectId)) throw new ErrorClaveSsh("clave_existente");

  const dir = dirTemporal("clave-");
  try {
    const ruta = join(dir, "clave");
    let codigo: number;
    try {
      const proceso = Bun.spawn(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "telo", "-f", ruta],
        { stdout: "ignore", stderr: "ignore" },
      );
      codigo = await proceso.exited;
    } catch {
      // ssh-keygen no está instalado en el servidor.
      throw new ErrorClaveSsh("clave_no_generada");
    }
    if (codigo !== 0) throw new ErrorClaveSsh("clave_no_generada");

    const privada = readFileSync(ruta, "utf8");
    const publica = readFileSync(`${ruta}.pub`, "utf8").trim();
    const cifrado = cifrar(clave, privada, textoAsociado(projectId));
    const guardada = db
      .query(
        `INSERT INTO project_ssh_keys (project_id, public_key, fingerprint, iv, tag, value_enc)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO NOTHING`,
      )
      .run(projectId, publica, huellaDe(publica), cifrado.iv, cifrado.tag, cifrado.value_enc);
    if (guardada.changes === 0) throw new ErrorClaveSsh("clave_existente");
    const creada = clavePublicaDe(projectId);
    if (!creada) throw new ErrorClaveSsh("clave_no_generada");
    return creada;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function borrarClaveProyecto(projectId: string): boolean {
  return db.query("DELETE FROM project_ssh_keys WHERE project_id = ?").run(projectId).changes > 0;
}

// Ejecuta fn con la clave del proyecto disponible solo durante la llamada. La parte privada se
// escribe en un directorio temporal (0600), fn recibe el GIT_SSH_COMMAND que la usa, y el
// directorio se borra al terminar, incluso si fn falla.
export async function conClaveSsh<T>(
  projectId: string,
  fn: (entorno: Record<string, string>) => Promise<T>,
): Promise<T> {
  const clave = claveMaestra();
  if (!clave) throw new ErrorClaveSsh("clave_sin_cifrado");
  const fila = db
    .query<FilaClave, [string]>("SELECT iv, tag, value_enc FROM project_ssh_keys WHERE project_id = ?")
    .get(projectId);
  if (!fila) throw new ErrorClaveSsh("clave_no_encontrada");

  let privada: string;
  try {
    privada = descifrar(clave, fila, textoAsociado(projectId));
  } catch {
    throw new ErrorClaveSsh("clave_ilegible");
  }

  const dir = dirTemporal("ssh-");
  try {
    // La ruta va entre comillas simples dentro del comando del shell: no puede llevar comillas ni espacios.
    if (/[\s'"\\]/.test(dir)) throw new ErrorClaveSsh("ruta_no_segura");
    const rutaClave = join(dir, "clave");
    const rutaHosts = join(dir, "known_hosts");
    writeFileSync(rutaClave, privada.endsWith("\n") ? privada : `${privada}\n`, { mode: 0o600 });
    writeFileSync(rutaHosts, `${HOST_GITHUB_ED25519}\n`, { mode: 0o600 });

    const sshCommand = [
      "ssh",
      "-i",
      `'${rutaClave}'`,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "IdentityAgent=none",
      "-o",
      `UserKnownHostsFile='${rutaHosts}'`,
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=20",
    ].join(" ");
    return await fn({ GIT_SSH_COMMAND: sshCommand });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
