import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID, type DecipherGCM } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Hono, type Context } from "hono";
import { db } from "../db";
import { config } from "../config";
import { claveMaestra } from "../secretos";
import { callbackUriGoogleDrive, googleDriveConfigurado, obtenerTokenAccesoGoogleDrive } from "./google-drive-oauth";
import { conTarea, esIdTarea } from "../workspace";

const MAGIC = Buffer.from("TELODRV1");
const HEADER_BYTES = 36;
const TAG_BYTES = 16;
const CHUNK_BYTES = 8 * 1024 * 1024;
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,appProperties";
const JOB_ERRORS = new Set([
  "archive_interrupted", "archive_creation_failed", "drive_auth_required", "drive_permission_or_quota", "drive_upload_expired",
  "drive_api_error", "disk_or_filesystem_error", "integrity_check_failed", "task_not_archivable",
  "task_restore_conflict", "archive_format_unsupported",
]);

type Tarea = { id: string; title: string; status: string; finished_at: string | null; conversation_id: string | null };
type ArchivoDrive = {
  task_id: string; task_title: string; drive_file_id: string; archive_name: string; encrypted_bytes: number;
  source_bytes: number; source_sha256: string | null; sha256: string; archived_at: string; local_removed_at: string | null;
  profile_included: number; previous_drive_file_id: string | null; cleanup_started_at: string | null;
};
type Job = { id: string; task_id: string; action: "archive" | "restore"; state: "queued" | "running" | "done" | "failed"; error: string | null; created_at: string; updated_at: string };
type GoogleFile = { id?: string; name?: string; size?: string; trashed?: boolean; appProperties?: Record<string, string> };

export const googleDriveArchives = new Hono();
let procesando = false;
let automaticoTimer: ReturnType<typeof setInterval> | null = null;

const AUTO_ARCHIVE_INTERVAL_MS = 60_000;
const AUTO_ARCHIVE_GRACE_HOURS = 24;

class ArchivoError extends Error {
  constructor(readonly code: string) { super(code); }
}

const dataDir = () => resolve(config.dataDir);
const tareaDir = (id: string) => join(dataDir(), "tasks", id);
const perfilHash = (id: string) => createHash("sha256").update(id).digest("hex");
const perfilesTarea = (id: string) => ["perfiles-opencode", "perfiles-codex", "perfiles-antigravity"].map((nombre) => ({
  nombre,
  ruta: join(dataDir(), nombre, perfilHash(id)),
}));

async function bytesPerfilesTarea(id: string): Promise<number> {
  const perfiles = perfilesTarea(id).filter((perfil) => validarFuente(perfil.ruta));
  const tamaños = await Promise.all(perfiles.map((perfil) => bytesEn(perfil.ruta)));
  return tamaños.reduce((total, tamaño) => total + tamaño, 0);
}

function eliminarPerfilesTarea(id: string): void {
  for (const perfil of perfilesTarea(id)) {
    if (existsSync(perfil.ruta)) rmSync(perfil.ruta, { recursive: true, force: false });
  }
}

function localDisponible(id: string): boolean {
  try { return lstatSync(tareaDir(id)).isDirectory() && !lstatSync(tareaDir(id)).isSymbolicLink() && realpathSync(tareaDir(id)) === tareaDir(id); }
  catch { return false; }
}

function jobActivo(id: string): boolean {
  return Boolean(db.query("SELECT 1 FROM google_drive_archive_jobs WHERE task_id=? AND state IN ('queued','running') LIMIT 1").get(id));
}

// Used by task continuation endpoints to prevent a resume/archive race and explain how to restore.
export function bloqueoContinuacionDrive(id: string): "archive_in_progress" | "task_workspace_archived" | "archive_cleanup_incomplete" | null {
  if (jobActivo(id)) return "archive_in_progress";
  const guardado = db.query<{ cleanup_started_at: string | null }, [string]>("SELECT cleanup_started_at FROM google_drive_archives WHERE task_id=? LIMIT 1").get(id);
  if (guardado?.cleanup_started_at) return "archive_cleanup_incomplete";
  return guardado && !localDisponible(id) ? "task_workspace_archived" : null;
}

function validarFuente(path: string): boolean {
  try { return lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path; }
  catch { return false; }
}

async function bytesEn(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  let total = 0;
  const pending = [path];
  let vistos = 0;
  while (pending.length) {
    const actual = pending.pop()!;
    const info = await lstat(actual);
    if (info.isSymbolicLink()) { total += info.size; continue; }
    if (!info.isDirectory()) { total += info.size; continue; }
    const hijos = await readdir(actual);
    for (const hijo of hijos) pending.push(join(actual, hijo));
    if (++vistos % 200 === 0) await Bun.sleep(0);
  }
  return total;
}

function spawnTar(id: string, incluirPerfil: boolean) {
  // Normaliza propietario, mtimes y orden; permite comparar el mismo workspace antes de
  // volver a subirlo sin marcarlo modificado solo porque cambió la fecha del tar.
  const args = ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-czf", "-", "-C", dataDir(), `tasks/${id}`];
  if (incluirPerfil) {
    for (const perfil of perfilesTarea(id)) {
      if (validarFuente(perfil.ruta)) args.push("-C", join(dataDir(), perfil.nombre), perfilHash(id));
    }
  }
  const child = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
  // Drain stderr so filesystem diagnostics cannot fill the pipe and stall tar.
  child.stderr?.resume();
  return child;
}

function esperarProceso(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((ok, fail) => {
    child.once("error", () => fail(new ArchivoError("archive_creation_failed")));
    child.once("close", (code) => code === 0 ? ok() : fail(new ArchivoError("archive_creation_failed")));
  });
}

async function medirTar(id: string, incluirPerfil: boolean): Promise<{ bytes: number; sha256: string }> {
  const child = spawnTar(id, incluirPerfil);
  const cerrado = esperarProceso(child);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const parte of child.stdout!) { bytes += (parte as Buffer).length; hash.update(parte as Buffer); }
    await cerrado;
    return { bytes, sha256: hash.digest("hex") };
  } catch {
    child.kill("SIGKILL");
    await cerrado.catch(() => {});
    throw new ArchivoError("archive_creation_failed");
  }
}

function claveArchivo(id: string, salt: Buffer): Buffer {
  const master = claveMaestra();
  if (!master) throw new ArchivoError("drive_auth_required");
  return Buffer.from(hkdfSync("sha256", master, salt, Buffer.from(`google-drive-task-archive-v1:${id}`), 32));
}

async function* partesCifradas(id: string, incluirPerfil: boolean, esperado: { bytes: number; sha256: string }): AsyncGenerator<Buffer> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", claveArchivo(id, salt), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(`${id}|TELODRV1`));
  const cabecera = Buffer.concat([MAGIC, salt, iv]);
  let generados = cabecera.length;
  yield cabecera;
  const child = spawnTar(id, incluirPerfil);
  const cerrado = esperarProceso(child);
  const hashFuente = createHash("sha256");
  try {
    for await (const parte of child.stdout!) {
      hashFuente.update(parte as Buffer);
      const cifrado = cipher.update(parte as Buffer);
      if (cifrado.length) { generados += cifrado.length; yield cifrado; }
    }
    await cerrado;
    const final = cipher.final();
    if (final.length) { generados += final.length; yield final; }
    const tag = cipher.getAuthTag();
    generados += tag.length;
    yield tag;
    if (generados !== HEADER_BYTES + esperado.bytes + TAG_BYTES || hashFuente.digest("hex") !== esperado.sha256) {
      throw new ArchivoError("archive_creation_failed");
    }
  } catch (error) {
    child.kill("SIGKILL");
    await cerrado.catch(() => {});
    if (error instanceof ArchivoError) throw error;
    throw new ArchivoError("archive_creation_failed");
  }
}

async function* bloques(partes: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let pendiente: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  for await (const parte of partes) {
    pendiente = pendiente.length ? Buffer.concat([pendiente, parte]) : parte;
    while (pendiente.length >= CHUNK_BYTES) {
      yield pendiente.subarray(0, CHUNK_BYTES);
      pendiente = pendiente.subarray(CHUNK_BYTES);
    }
  }
  if (pendiente.length) yield pendiente;
}

async function token(): Promise<string> {
  const value = await obtenerTokenAccesoGoogleDrive();
  if (!value) throw new ArchivoError("drive_auth_required");
  return value;
}

async function driveFetch(url: string, init: RequestInit, bearer?: string): Promise<{ response: Response; bearer: string }> {
  let current = bearer ?? await token();
  let response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${current}` }, signal: init.signal ?? AbortSignal.timeout(120_000) });
  if (response.status === 401) {
    current = await token();
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${current}` }, signal: init.signal ?? AbortSignal.timeout(120_000) });
  }
  if (response.status === 401) throw new ArchivoError("drive_auth_required");
  return { response, bearer: current };
}

function sessionUrl(response: Response): string {
  const location = response.headers.get("location");
  if (!location) throw new ArchivoError("drive_api_error");
  const url = new URL(location);
  if (url.protocol !== "https:" || !["www.googleapis.com", "upload.googleapis.com"].includes(url.hostname) || !url.pathname.startsWith("/upload/drive/v3/files")) {
    throw new ArchivoError("drive_api_error");
  }
  return url.toString();
}

function offsetConfirmado(response: Response, maximo: number): number {
  const range = response.headers.get("range");
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new ArchivoError("drive_api_error");
  const confirmado = Number(match[1]) + 1;
  if (!Number.isSafeInteger(confirmado) || confirmado > maximo) throw new ArchivoError("drive_api_error");
  return confirmado;
}

async function consultarCarga(uploadUrl: string, total: number, bearer: string): Promise<{ offset: number; fileId: string | null; bearer: string }> {
  const { response, bearer: actualizado } = await driveFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Length": "0", "Content-Range": `bytes */${total}` },
  }, bearer);
  if (response.status === 308) return { offset: offsetConfirmado(response, total), fileId: null, bearer: actualizado };
  if (response.status === 200 || response.status === 201) {
    const file = await response.json() as GoogleFile;
    if (typeof file.id !== "string") throw new ArchivoError("drive_api_error");
    return { offset: total, fileId: file.id, bearer: actualizado };
  }
  if (response.status === 404) throw new ArchivoError("drive_upload_expired");
  throw response.status === 403 ? new ArchivoError("drive_permission_or_quota") : new ArchivoError("drive_api_error");
}

async function metadatosDrive(fileId: string, bearer: string): Promise<{ file: GoogleFile; bearer: string }> {
  const url = `${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=id,name,size,trashed,appProperties`;
  const { response, bearer: usado } = await driveFetch(url, {}, bearer);
  if (!response.ok) throw response.status === 403 ? new ArchivoError("drive_permission_or_quota") : new ArchivoError("drive_api_error");
  return { file: await response.json() as GoogleFile, bearer: usado };
}

async function verificarBytesRemotos(fileId: string, expectedBytes: number, expectedHash: string, bearer: string): Promise<void> {
  const { response } = await driveFetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`, {}, bearer);
  if (!response.ok || !response.body) throw new ArchivoError(response.status === 403 ? "drive_permission_or_quota" : "drive_api_error");
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      hash.update(value);
    }
  } finally { reader.releaseLock(); }
  const actual = hash.digest("hex");
  if (bytes !== expectedBytes || actual !== expectedHash) throw new ArchivoError("integrity_check_failed");
}

async function subirArchivo(id: string, incluirPerfil: boolean, fuente: { bytes: number; sha256: string }): Promise<{ fileId: string; name: string; bytes: number; sha256: string }> {
  const total = HEADER_BYTES + fuente.bytes + TAG_BYTES;
  const name = `telo-tarea-${id}.tar.gz.enc`;
  const metadata = { name, mimeType: "application/octet-stream", appProperties: { teloTaskId: id, teloFormat: "1" } };
  const { response: inicio, bearer: inicioToken } = await driveFetch(DRIVE_UPLOAD, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(total) },
    body: JSON.stringify(metadata),
  });
  if (!inicio.ok) throw inicio.status === 403 ? new ArchivoError("drive_permission_or_quota") : new ArchivoError("drive_api_error");
  const uploadUrl = sessionUrl(inicio);
  const hash = createHash("sha256");
  let offset = 0;
  let bearer = inicioToken;
  let fileId: string | null = null;
  for await (const bloque of bloques(partesCifradas(id, incluirPerfil, fuente))) {
    const start = offset;
    hash.update(bloque);
    const finBloque = start + bloque.length;
    let sinProgreso = 0;
    while (offset < finBloque) {
      const porEnviar = bloque.subarray(offset - start);
      const fin = offset + porEnviar.length - 1;
      let response: Response;
      try {
        const resultado = await driveFetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(porEnviar.length), "Content-Range": `bytes ${offset}-${fin}/${total}` },
          body: porEnviar,
        }, bearer);
        response = resultado.response;
        bearer = resultado.bearer;
      } catch (error) {
        if (error instanceof ArchivoError) throw error;
        const estado = await consultarCarga(uploadUrl, total, bearer);
        bearer = estado.bearer;
        if (estado.fileId) { fileId = estado.fileId; offset = total; break; }
        if (estado.offset < offset || estado.offset > finBloque) throw new ArchivoError("drive_api_error");
        sinProgreso = estado.offset === offset ? sinProgreso + 1 : 0;
        if (sinProgreso >= 5) throw new ArchivoError("drive_api_error");
        offset = estado.offset;
        continue;
      }
      if (response.status === 308) {
        const confirmado = offsetConfirmado(response, finBloque);
        if (confirmado < offset) throw new ArchivoError("drive_api_error");
        sinProgreso = confirmado === offset ? sinProgreso + 1 : 0;
        if (sinProgreso >= 5) throw new ArchivoError("drive_api_error");
        offset = confirmado;
        continue;
      }
      if (response.status === 200 || response.status === 201) {
        if (finBloque !== total) throw new ArchivoError("drive_api_error");
        const result = await response.json() as GoogleFile;
        if (typeof result.id !== "string") throw new ArchivoError("drive_api_error");
        fileId = result.id;
        offset = finBloque;
        break;
      }
      if (response.status === 404) throw new ArchivoError("drive_upload_expired");
      if (response.status >= 500) {
        const estado = await consultarCarga(uploadUrl, total, bearer);
        bearer = estado.bearer;
        if (estado.fileId) { fileId = estado.fileId; offset = total; break; }
        if (estado.offset < offset || estado.offset > finBloque) throw new ArchivoError("drive_api_error");
        sinProgreso = estado.offset === offset ? sinProgreso + 1 : 0;
        if (sinProgreso >= 5) throw new ArchivoError("drive_api_error");
        offset = estado.offset;
        continue;
      }
      throw response.status === 403 ? new ArchivoError("drive_permission_or_quota") : new ArchivoError("drive_api_error");
    }
    if (fileId) break;
  }
  if (!fileId && offset === total) fileId = (await consultarCarga(uploadUrl, total, bearer)).fileId;
  if (!fileId || offset !== total) throw new ArchivoError("drive_api_error");
  const digest = hash.digest("hex");
  const { response: actualizado, bearer: bearerActualizado } = await driveFetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=id,appProperties`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appProperties: { teloTaskId: id, teloFormat: "1", sha256: digest } }),
  }, bearer);
  if (!actualizado.ok) throw actualizado.status === 403 ? new ArchivoError("drive_permission_or_quota") : new ArchivoError("drive_api_error");
  const { file, bearer: bearerFinal } = await metadatosDrive(fileId, bearerActualizado);
  if (file.trashed || file.appProperties?.teloTaskId !== id || file.appProperties?.teloFormat !== "1" || file.appProperties?.sha256 !== digest || Number(file.size) !== total) {
    throw new ArchivoError("integrity_check_failed");
  }
  await verificarBytesRemotos(fileId, total, digest, bearerFinal);
  return { fileId, name, bytes: total, sha256: digest };
}

async function borrarArchivoDrive(fileId: string): Promise<void> {
  const { response } = await driveFetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new ArchivoError(response.status === 403 ? "drive_permission_or_quota" : "drive_api_error");
}

async function* decodificarStream(response: Response, id: string, esperado: { bytes: number; sha256: string }): AsyncGenerator<Buffer> {
  if (!response.body) throw new ArchivoError("drive_api_error");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let pendiente = Buffer.alloc(0);
  let cabecera: Buffer | null = null;
  let descifrador: DecipherGCM | null = null;
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > esperado.bytes) throw new ArchivoError("integrity_check_failed");
      hash.update(value);
      pendiente = pendiente.length ? Buffer.concat([pendiente, Buffer.from(value)]) : Buffer.from(value);
      if (!cabecera && pendiente.length >= HEADER_BYTES) {
        cabecera = pendiente.subarray(0, HEADER_BYTES);
        if (!cabecera.subarray(0, MAGIC.length).equals(MAGIC)) throw new ArchivoError("archive_format_unsupported");
        const salt = cabecera.subarray(8, 24), iv = cabecera.subarray(24, 36);
        descifrador = createDecipheriv("aes-256-gcm", claveArchivo(id, salt), iv, { authTagLength: TAG_BYTES }) as DecipherGCM;
        descifrador.setAAD(Buffer.from(`${id}|TELODRV1`));
        pendiente = pendiente.subarray(HEADER_BYTES);
      }
      if (descifrador && pendiente.length > TAG_BYTES) {
        const cifrado = pendiente.subarray(0, pendiente.length - TAG_BYTES);
        pendiente = pendiente.subarray(pendiente.length - TAG_BYTES);
        const claro = descifrador.update(cifrado);
        if (claro.length) yield claro;
      }
    }
    if (!descifrador || pendiente.length !== TAG_BYTES) throw new ArchivoError("archive_format_unsupported");
    descifrador.setAuthTag(pendiente);
    const final = descifrador.final();
    if (final.length) yield final;
    if (bytes !== esperado.bytes || hash.digest("hex") !== esperado.sha256) throw new ArchivoError("integrity_check_failed");
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ArchivoError) throw error;
    throw new ArchivoError("integrity_check_failed");
  } finally { reader.releaseLock(); }
}

async function restaurarDesdeDrive(archivo: ArchivoDrive): Promise<void> {
  const id = archivo.task_id;
  if (!esIdTarea(id)) throw new ArchivoError("task_restore_conflict");
  const sourceTask = tareaDir(id);
  const profiles = perfilesTarea(id);
  if (existsSync(sourceTask) || (archivo.profile_included === 1 && profiles.some((profile) => existsSync(profile.ruta)))) throw new ArchivoError("task_restore_conflict");
  const { file, bearer } = await metadatosDrive(archivo.drive_file_id, await token());
  if (file.trashed || file.appProperties?.teloTaskId !== id || file.appProperties?.teloFormat !== "1" || file.appProperties?.sha256 !== archivo.sha256 || Number(file.size) !== archivo.encrypted_bytes) {
    throw new ArchivoError("integrity_check_failed");
  }
  const { response } = await driveFetch(`${DRIVE_FILES}/${encodeURIComponent(archivo.drive_file_id)}?alt=media`, {}, bearer);
  if (!response.ok) throw new ArchivoError(response.status === 403 ? "drive_permission_or_quota" : "drive_api_error");

  const staging = join(dataDir(), `.telo-drive-restore-${id}-${randomBytes(5).toString("hex")}`);
  mkdirSync(staging, { recursive: false, mode: 0o700 });
  const child = spawn("tar", ["-xzf", "-", "-C", staging, "--no-same-owner", "--no-same-permissions", "--no-overwrite-dir"], { stdio: ["pipe", "ignore", "pipe"] });
  child.stderr?.resume();
  const cerrado = esperarProceso(child);
  try {
    for await (const chunk of decodificarStream(response, id, { bytes: archivo.encrypted_bytes, sha256: archivo.sha256 })) {
      if (!child.stdin?.write(chunk)) await new Promise<void>((ok) => child.stdin?.once("drain", ok));
    }
    child.stdin?.end();
    await cerrado;
    const stagedTask = join(staging, "tasks", id);
    const stagedProfiles = profiles.map((profile) => ({ ...profile, staged: join(staging, profile.nombre, perfilHash(id)) }))
      .filter((profile) => existsSync(profile.staged));
    if (!validarFuente(stagedTask) || (archivo.profile_included === 1 && (!stagedProfiles.length || stagedProfiles.some((profile) => !validarFuente(profile.staged)))) ||
      (archivo.profile_included !== 1 && stagedProfiles.length > 0)) {
      throw new ArchivoError("integrity_check_failed");
    }
    mkdirSync(join(dataDir(), "tasks"), { recursive: true, mode: 0o700 });
    renameSync(stagedTask, sourceTask);
    const restaurados: string[] = [];
    try {
      for (const profile of stagedProfiles) {
        mkdirSync(join(dataDir(), profile.nombre), { recursive: true, mode: 0o700 });
        renameSync(profile.staged, profile.ruta);
        restaurados.push(profile.ruta);
      }
    } catch (error) {
      rmSync(sourceTask, { recursive: true, force: true });
      for (const profile of restaurados) rmSync(profile, { recursive: true, force: true });
      throw error;
    }
    db.query("UPDATE google_drive_archives SET local_removed_at=NULL WHERE task_id=?").run(id);
    if (archivo.previous_drive_file_id) {
      try {
        await borrarArchivoDrive(archivo.previous_drive_file_id);
        db.query("UPDATE google_drive_archives SET previous_drive_file_id=NULL WHERE task_id=?").run(id);
      } catch { /* La restauración principal ya quedó verificada; se limpiará la copia duplicada al archivar de nuevo. */ }
    }
  } catch (error) {
    child.stdin?.destroy();
    child.kill("SIGKILL");
    await cerrado.catch(() => {});
    throw error instanceof ArchivoError ? error : new ArchivoError("integrity_check_failed");
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function archivarTarea(id: string): Promise<void> {
  if (!esIdTarea(id)) throw new ArchivoError("task_not_archivable");
  const task = db.query<Tarea, [string]>("SELECT id,title,status,finished_at,conversation_id FROM tasks WHERE id=?").get(id);
  if (!task || !["done", "failed", "cancelled"].includes(task.status) || !task.finished_at) throw new ArchivoError("task_not_archivable");
  if (db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND state IN ('pending','executing','approved') LIMIT 1").get(id)) throw new ArchivoError("task_not_archivable");
  let archive = db.query<ArchivoDrive, [string]>("SELECT * FROM google_drive_archives WHERE task_id=?").get(id);
  let profileIncluded: boolean;
  if (archive) {
    profileIncluded = archive.profile_included === 1;
    if (!localDisponible(id)) {
      const { file, bearer } = await metadatosDrive(archive.drive_file_id, await token());
      if (file.trashed || file.appProperties?.teloTaskId !== id || file.appProperties?.sha256 !== archive.sha256 || Number(file.size) !== archive.encrypted_bytes) throw new ArchivoError("integrity_check_failed");
      await verificarBytesRemotos(archive.drive_file_id, archive.encrypted_bytes, archive.sha256, bearer);
      db.query("UPDATE google_drive_archives SET cleanup_started_at=COALESCE(cleanup_started_at,datetime('now')) WHERE task_id=?").run(id);
      if (archive.profile_included === 1) eliminarPerfilesTarea(id);
      db.query("UPDATE google_drive_archives SET local_removed_at=datetime('now'),cleanup_started_at=NULL WHERE task_id=?").run(id);
      return;
    }
    if (archive.previous_drive_file_id) {
      await borrarArchivoDrive(archive.previous_drive_file_id);
      db.query("UPDATE google_drive_archives SET previous_drive_file_id=NULL WHERE task_id=?").run(id);
    }
    const tienePerfil = profileIncluded && perfilesTarea(id).some((profile) => validarFuente(profile.ruta));
    const fuenteActual = await medirTar(id, tienePerfil);
    if (archive.source_sha256 && archive.source_sha256 === fuenteActual.sha256) {
      const { file, bearer } = await metadatosDrive(archive.drive_file_id, await token());
      if (file.trashed || file.appProperties?.teloTaskId !== id || file.appProperties?.sha256 !== archive.sha256 || Number(file.size) !== archive.encrypted_bytes) {
        throw new ArchivoError("integrity_check_failed");
      }
      await verificarBytesRemotos(archive.drive_file_id, archive.encrypted_bytes, archive.sha256, bearer);
    } else if (profileIncluded && !tienePerfil && archive.cleanup_started_at) {
      // A previous cleanup may have removed the exclusive profile before stopping. Its verified
      // remote archive is still the authoritative full copy; do not create an incomplete replacement.
      const { file, bearer } = await metadatosDrive(archive.drive_file_id, await token());
      if (file.trashed || file.appProperties?.teloTaskId !== id || file.appProperties?.sha256 !== archive.sha256 || Number(file.size) !== archive.encrypted_bytes) throw new ArchivoError("integrity_check_failed");
      await verificarBytesRemotos(archive.drive_file_id, archive.encrypted_bytes, archive.sha256, bearer);
    } else if (profileIncluded && !tienePerfil) {
      // Si el perfil falta sin una limpieza interrumpida, no se puede reemplazar una copia
      // completa por otra incompleta ni borrar cambios locales del usuario.
      throw new ArchivoError("task_not_archivable");
    } else {
      const sourceBytes = await bytesEn(tareaDir(id)) + (tienePerfil ? await bytesPerfilesTarea(id) : 0);
      const uploaded = await subirArchivo(id, tienePerfil, fuenteActual);
      db.query(`UPDATE google_drive_archives SET drive_file_id=?,archive_name=?,encrypted_bytes=?,source_bytes=?,source_sha256=?,sha256=?,profile_included=?,previous_drive_file_id=?,archived_at=datetime('now') WHERE task_id=?`)
        .run(uploaded.fileId, uploaded.name, uploaded.bytes, sourceBytes, fuenteActual.sha256, uploaded.sha256, tienePerfil ? 1 : 0, archive.drive_file_id, id);
      // Keep the old ID until deletion succeeds so a retry can clean up a duplicate safely.
      await borrarArchivoDrive(archive.drive_file_id);
      db.query("UPDATE google_drive_archives SET previous_drive_file_id=NULL WHERE task_id=?").run(id);
      profileIncluded = tienePerfil;
    }
  } else {
    if (!localDisponible(id)) throw new ArchivoError("task_not_archivable");
    profileIncluded = task.conversation_id === null && perfilesTarea(id).some((profile) => validarFuente(profile.ruta));
    const sourceBytes = await bytesEn(tareaDir(id)) + (profileIncluded ? await bytesPerfilesTarea(id) : 0);
    const fuente = await medirTar(id, profileIncluded);
    const uploaded = await subirArchivo(id, profileIncluded, fuente);
    // The encrypted, remotely verified copy is indexed before removing local data. A crash can leave
    // a duplicate, never a missing copy; the next restore reconciles it safely.
    db.query(`INSERT INTO google_drive_archives (task_id,task_title,drive_file_id,archive_name,encrypted_bytes,source_bytes,source_sha256,sha256,profile_included)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, task.title, uploaded.fileId, uploaded.name, uploaded.bytes, sourceBytes, fuente.sha256, uploaded.sha256, profileIncluded ? 1 : 0);
    archive = db.query<ArchivoDrive, [string]>("SELECT * FROM google_drive_archives WHERE task_id=?").get(id)!;
  }

  const now = db.query<Tarea, [string]>("SELECT id,title,status,finished_at,conversation_id FROM tasks WHERE id=?").get(id);
  if (!now || !["done", "failed", "cancelled"].includes(now.status) || !localDisponible(id) || jobActivo(id) === false) {
    throw new ArchivoError("task_not_archivable");
  }
  if (db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND state IN ('pending','executing','approved') LIMIT 1").get(id)) throw new ArchivoError("task_not_archivable");
  // Recheck once more immediately before deleting: resume/continue endpoints reject an active archive job.
  const job = db.query<{ id: string }, [string]>("SELECT id FROM google_drive_archive_jobs WHERE task_id=? AND action='archive' AND state='running' ORDER BY created_at DESC LIMIT 1").get(id);
  if (!job) throw new ArchivoError("task_not_archivable");
  db.query("UPDATE google_drive_archives SET cleanup_started_at=COALESCE(cleanup_started_at,datetime('now')) WHERE task_id=?").run(id);
  if (profileIncluded) eliminarPerfilesTarea(id);
  rmSync(tareaDir(id), { recursive: true, force: false });
  db.query("UPDATE google_drive_archives SET local_removed_at=datetime('now'),cleanup_started_at=NULL WHERE task_id=?").run(id);
}

function mensajeError(error: unknown): string {
  const code = error instanceof ArchivoError && JOB_ERRORS.has(error.code) ? error.code : "disk_or_filesystem_error";
  return code;
}

async function ejecutar(job: Job) {
  try {
    await conTarea(job.task_id, async () => {
      if (job.action === "archive") await archivarTarea(job.task_id);
      else {
        const archive = db.query<ArchivoDrive, [string]>("SELECT * FROM google_drive_archives WHERE task_id=?").get(job.task_id);
        if (!archive) throw new ArchivoError("task_restore_conflict");
        await restaurarDesdeDrive(archive);
      }
    });
    db.query("UPDATE google_drive_archive_jobs SET state='done',error=NULL,updated_at=datetime('now') WHERE id=?").run(job.id);
  } catch (error) {
    const code = mensajeError(error);
    db.query("UPDATE google_drive_archive_jobs SET state='failed',error=?,updated_at=datetime('now') WHERE id=?").run(code, job.id);
    // If an archive completed remotely but local removal did not, keep the indexed copy for a safe retry/restore.
  }
}

async function procesarCola() {
  if (procesando) return;
  procesando = true;
  try {
    while (true) {
      const job = db.query<Job, []>("SELECT id,task_id,action,state,error,created_at,updated_at FROM google_drive_archive_jobs WHERE state='queued' ORDER BY created_at LIMIT 1").get();
      if (!job) break;
      const claimed = db.query("UPDATE google_drive_archive_jobs SET state='running',updated_at=datetime('now') WHERE id=? AND state='queued'").run(job.id);
      if (!claimed.changes) continue;
      await ejecutar({ ...job, state: "running" });
    }
  } finally { procesando = false; }
}

function encolarSiguienteAutomatico() {
  if (!googleDriveConfigurado() || !claveMaestra()) return;
  if (!db.query("SELECT 1 FROM google_drive_connection WHERE id=1").get()) return;

  const id = db.transaction(() => {
    if (db.query("SELECT 1 FROM google_drive_archive_jobs WHERE state IN ('queued','running') LIMIT 1").get()) return null;

    const candidatas = db.query<Tarea, []>(`SELECT t.id,t.title,t.status,t.finished_at,t.conversation_id FROM tasks t
      WHERE t.status IN ('done','failed','cancelled')
        AND t.finished_at IS NOT NULL
        AND datetime(t.finished_at) <= datetime('now', '-${AUTO_ARCHIVE_GRACE_HOURS} hours')
        AND NOT EXISTS (SELECT 1 FROM google_drive_archives a WHERE a.task_id=t.id)
        AND NOT EXISTS (SELECT 1 FROM repository_actions r WHERE r.task_id=t.id AND r.state IN ('pending','executing','approved'))
        AND NOT EXISTS (SELECT 1 FROM google_drive_archive_jobs j WHERE j.task_id=t.id AND j.action='archive' AND j.state='failed')
      ORDER BY datetime(t.finished_at) ASC`).all();
    const tarea = candidatas.find((candidata) => localDisponible(candidata.id));
    if (!tarea) return null;

    const jobId = randomUUID();
    db.query("INSERT INTO google_drive_archive_jobs (id,task_id,action,state) VALUES (?,?,'archive','queued')").run(jobId, tarea.id);
    return jobId;
  })();

  if (id) void procesarCola();
}

export function iniciarGoogleDriveArchives() {
  db.query("UPDATE google_drive_archive_jobs SET state='failed',error='archive_interrupted',updated_at=datetime('now') WHERE state='running'").run();
  try {
    const root = dataDir();
    for (const name of readdirSync(root)) {
      if (!name.startsWith(".telo-drive-restore-")) continue;
      const path = join(root, name);
      try { if (lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path) rmSync(path, { recursive: true, force: true }); } catch { /* conservador: deja el residuo para revisión */ }
    }
  } catch { /* DATA_DIR puede no existir en desarrollo */ }
  void procesarCola();
  if (!automaticoTimer) {
    automaticoTimer = setInterval(encolarSiguienteAutomatico, AUTO_ARCHIVE_INTERVAL_MS);
    automaticoTimer.unref?.();
    encolarSiguienteAutomatico();
  }
}

googleDriveArchives.get("/google-drive/archives", (c) => {
  const state = db.query<{ account_email: string }, []>("SELECT account_email FROM google_drive_connection WHERE id=1").get();
  const candidates = db.query<Tarea, []>(`SELECT t.id,t.title,t.status,t.finished_at,t.conversation_id FROM tasks t
    WHERE t.status IN ('done','failed','cancelled') AND t.finished_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM google_drive_archives a WHERE a.task_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM repository_actions r WHERE r.task_id=t.id AND r.state IN ('pending','executing','approved'))
    ORDER BY datetime(t.finished_at) ASC`).all().filter((t) => localDisponible(t.id));
  const archives = db.query<ArchivoDrive, []>("SELECT * FROM google_drive_archives ORDER BY archived_at DESC LIMIT 100").all().map((a) => ({
    task_id: a.task_id, task_title: a.task_title, archive_name: a.archive_name, encrypted_bytes: a.encrypted_bytes,
    source_bytes: a.source_bytes, sha256: a.sha256, archived_at: a.archived_at, local_disponible: localDisponible(a.task_id),
    profile_included: a.profile_included === 1,
    limpieza_pendiente: Boolean(a.cleanup_started_at || a.previous_drive_file_id || (!a.local_removed_at && a.profile_included === 1 && perfilesTarea(a.task_id).some((profile) => existsSync(profile.ruta)))),
  }));
  const jobs = db.query<Job, []>("SELECT id,task_id,action,state,error,created_at,updated_at FROM google_drive_archive_jobs ORDER BY created_at DESC LIMIT 12").all();
  return c.json({
    configurado: googleDriveConfigurado(), callback_uri: callbackUriGoogleDrive(),
    conectado: Boolean(state), cuenta: state?.account_email ?? null, cifrado_disponible: Boolean(claveMaestra()),
    candidatos: candidates, archivos: archives, trabajos: jobs,
  });
});

function encolar(c: Context, taskId: string, action: "archive" | "restore") {
  if (!esIdTarea(taskId)) return c.json({ error: "task_not_found" }, 404);
  if (!db.query("SELECT 1 FROM google_drive_connection WHERE id=1").get()) return c.json({ error: "drive_auth_required" }, 409);
  if (!claveMaestra()) return c.json({ error: "drive_auth_required" }, 503);
  const inserted = db.transaction(() => {
    if (db.query("SELECT 1 FROM google_drive_archive_jobs WHERE state IN ('queued','running') LIMIT 1").get()) return null;
    if (action === "archive") {
      const task = db.query("SELECT 1 FROM tasks WHERE id=? AND status IN ('done','failed','cancelled') AND finished_at IS NOT NULL").get(taskId);
      const archive = db.query<{ local_removed_at: string | null; cleanup_started_at: string | null }, [string]>("SELECT local_removed_at,cleanup_started_at FROM google_drive_archives WHERE task_id=?").get(taskId);
      const local = localDisponible(taskId);
      if (!task || (!local && (!archive || (archive.local_removed_at && !archive.cleanup_started_at)))) return null;
    } else if (!db.query("SELECT 1 FROM google_drive_archives WHERE task_id=?").get(taskId) || localDisponible(taskId)) return null;
    const id = randomUUID();
    db.query("INSERT INTO google_drive_archive_jobs (id,task_id,action,state) VALUES (?,?,?,'queued')").run(id, taskId, action);
    return id;
  })();
  if (!inserted) return c.json({ error: action === "archive" ? "task_not_archivable" : "task_restore_conflict" }, 409);
  void procesarCola();
  return c.json({ id: inserted, task_id: taskId, action, state: "queued" }, 202);
}

googleDriveArchives.post("/google-drive/archives/:id", (c) => encolar(c, c.req.param("id"), "archive"));
googleDriveArchives.post("/google-drive/archives/:id/restore", (c) => encolar(c, c.req.param("id"), "restore"));
