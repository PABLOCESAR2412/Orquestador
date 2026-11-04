import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { Hono } from "hono";
import { cuentaCloudflare, valorClaveApiProveedor } from "../claves-proveedor";
import { cuentaCloudflareValida } from "../cloudflare";
import { config } from "../config";
import { sinLimiteDeInactividad } from "../conexion";
import { db } from "../db";
import { registrarEvento } from "../eventos";
import { hallarEjecutable } from "../ejecutable";
import { conProyectoRevisado } from "../ocupacion";
import { leerConTope } from "../runners/proteccion";
import { detectorDeSecretos } from "../redaccion";
import { entornoDeProyecto, valoresDeProyecto } from "../secretos";
import { conTarea, esIdTarea, esSensible, rutaClon } from "../workspace";
import { ArchivoError, normalizarRuta } from "../archivos-proyecto";

const MAX_ARCHIVOS = 20_000;
const MAX_ARCHIVO = 25 * 1024 * 1024;
const MAX_PUBLICACION = 512 * 1024 * 1024;
const NOMBRE_PROYECTO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ARCHIVO_PRIVADO = /^(?:\.(?:env|dev\.vars)(?:\.|$)|\.(?:git|npmrc|wrangler|yarnrc)(?:\.|$)|wrangler\.(?:toml|jsonc?)$|node_modules$)/i;

export async function copiarArchivosPages(clon: string, directorio: string, destino: string, valores: string[]) {
  const contieneSecreto = detectorDeSecretos(valores);
  const partes = normalizarRuta(directorio);
  if (!partes.length) throw new ArchivoError("invalid_project_path", 400);
  if (!(await lstat(clon)).isDirectory()) throw new ArchivoError("project_path_not_directory", 400);
  let carpeta = await realpath(clon);
  for (const parte of partes) {
    if (ARCHIVO_PRIVADO.test(parte)) throw new ArchivoError("invalid_project_path", 400);
    carpeta = join(carpeta, parte);
    if (!(await lstat(carpeta)).isDirectory()) throw new ArchivoError("project_path_not_directory", 400);
  }
  const raiz = carpeta + sep;
  let entradas = 0;
  let archivos = 0;
  let bytes = 0;
  const lote = createHash("sha256");
  const muestra: string[] = [];
  async function copiar(origen: string, salida: string, ruta = "") {
    if (await realpath(origen) !== origen) throw new ArchivoError("invalid_project_path", 400);
    await mkdir(salida);
    const listado = await readdir(origen, { withFileTypes: true });
    listado.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entrada of listado) {
      if (++entradas > MAX_ARCHIVOS) throw new ArchivoError("pages_assets_too_large", 413);
      const nombre = entrada.name;
      if (contieneSecreto(nombre)) throw new ArchivoError("pages_assets_secret_detected", 400);
      if (ARCHIVO_PRIVADO.test(nombre) || esSensible(nombre) || /^_worker\.js$/i.test(nombre))
        throw new ArchivoError("pages_assets_unsupported", 400);
      const relativa = ruta ? ruta + "/" + nombre : nombre;
      const archivo = join(origen, nombre);
      const copia = join(salida, nombre);
      if (entrada.isDirectory()) {
        await copiar(archivo, copia, relativa);
        continue;
      }
      if (!entrada.isFile()) throw new ArchivoError("pages_assets_unsupported", 400);
      const fd = await open(archivo, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await fd.stat();
        const abierto = process.platform === "linux" ? await readlink(`/proc/self/fd/${fd.fd}`) : await realpath(archivo);
        if (!info.isFile() || info.nlink !== 1 || !abierto.startsWith(raiz)) throw new ArchivoError("pages_assets_unsupported", 400);
        bytes += info.size;
        if (bytes > MAX_PUBLICACION || info.size > MAX_ARCHIVO) throw new ArchivoError("pages_assets_too_large", 413);
        const contenido = Buffer.alloc(info.size + 1);
        const { bytesRead } = await fd.read(contenido, 0, contenido.length, 0);
        if (bytesRead !== info.size) throw new ArchivoError("pages_assets_unsupported", 400);
        const datos = contenido.subarray(0, bytesRead);
        if (contieneSecreto(datos.toString("utf8"))) throw new ArchivoError("pages_assets_secret_detected", 400);
        await writeFile(copia, datos, { flag: "wx" });
        lote.update(JSON.stringify([relativa, createHash("sha256").update(datos).digest("hex")]) + "\n");
        if (muestra.length < 12) muestra.push(relativa);
        archivos++;
      } finally {
        await fd.close();
      }
    }
  }
  await copiar(carpeta, destino);
  if (!archivos) throw new ArchivoError("pages_assets_empty", 400);
  return { digest: lote.digest("hex"), archivos, bytes, muestra };
}

export const cloudflarePages = new Hono();

// La sesión autenticada y la comprobación de origen de /api protegen esta confirmación.
cloudflarePages.post("/tasks/:id/cloudflare-pages", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ proyecto?: unknown; directorio?: unknown; preparar?: unknown; huella?: unknown }>().catch(() => null);
  const proyecto = typeof body?.proyecto === "string" ? body.proyecto.trim() : "";
  const directorio = typeof body?.directorio === "string" ? body.directorio.trim() : "";
  if (!NOMBRE_PROYECTO.test(proyecto) || !directorio) return c.json({ error: "pages_invalid_destination" }, 400);
  const preparar = body?.preparar === true;
  const huellaConfirmada = typeof body?.huella === "string" && /^[a-f0-9]{64}$/.test(body.huella) ? body.huella : null;
  if (!preparar && !huellaConfirmada) return c.json({ error: "pages_review_required" }, 409);
  const tarea = esIdTarea(id) ? db.query<{ project_id: string | null }, [string]>("SELECT project_id FROM tasks WHERE id=?").get(id) : null;
  if (!tarea?.project_id) return c.json({ error: "task_without_repo" }, 404);
  sinLimiteDeInactividad(c);
  const projectId = tarea.project_id;
  return await conProyectoRevisado(projectId, () => conTarea(id, async () => {
    const actual = db.query<{ status: string; work_mode: string }, [string, string]>("SELECT status, work_mode FROM tasks WHERE id=? AND project_id=?").get(id, projectId);
    if (!actual || actual.work_mode !== "build" || !["done", "failed"].includes(actual.status))
      return c.json({ error: "pages_task_unfinished" }, 409);

    const secretos = entornoDeProyecto(projectId);
    const token = secretos.CLOUDFLARE_API_TOKEN || valorClaveApiProveedor("cloudflare-workers-ai");
    const cuenta = secretos.CLOUDFLARE_API_TOKEN ? secretos.CLOUDFLARE_ACCOUNT_ID ?? cuentaCloudflare() : cuentaCloudflare();
    if (!token || !cuentaCloudflareValida(cuenta)) return c.json({ error: "pages_credentials_missing" }, 409);
    const wrangler = hallarEjecutable("wrangler");
    const node = hallarEjecutable("node");
    if (!wrangler || !node) return c.json({ error: "pages_wrangler_missing" }, 409);

    let temporal: string | undefined;
    try {
      const clon = join(await realpath(config.dataDir), "tasks", id, "repo");
      if (await realpath(rutaClon(id)) !== clon) return c.json({ error: "invalid_project_path" }, 400);
      temporal = await mkdtemp(join(tmpdir(), "telo-pages-"));
      const { digest, ...lote } = await copiarArchivosPages(clon, directorio, join(temporal, "assets"), [...valoresDeProyecto(projectId), token]);
      const respuesta = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cuenta}/pages/projects/${proyecto}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (respuesta.status === 401 || respuesta.status === 403) return c.json({ error: "pages_permission_denied" }, 403);
      if (respuesta.status === 404) return c.json({ error: "pages_project_missing" }, 404);
      if (!respuesta.ok) return c.json({ error: "pages_remote_error" }, 502);
      const datos = await respuesta.json() as { result?: { production_branch?: unknown } };
      const rama = datos.result?.production_branch;
      if (typeof rama !== "string" || !rama || rama.length > 255 || /[\r\n\0]/.test(rama))
        return c.json({ error: "pages_remote_error" }, 502);

      const huella = createHash("sha256").update(JSON.stringify([id, cuenta, proyecto, directorio, rama, digest])).digest("hex");
      if (preparar) return c.json({ huella, rama, ...lote });
      if (huellaConfirmada !== huella) return c.json({ error: "pages_assets_changed" }, 409);

      // Wrangler solo ve la configuración y los archivos estáticos preparados por Telo.
      await writeFile(join(temporal, "wrangler.json"), JSON.stringify({ name: proyecto, pages_build_output_dir: "assets" }));
      const proc = Bun.spawn([wrangler, "pages", "deploy", "assets", "--project-name", proyecto, `--branch=${rama}`], {
        cwd: temporal,
        env: {
          PATH: dirname(node),
          HOME: temporal,
          USERPROFILE: temporal,
          CI: "1",
          WRANGLER_SEND_METRICS: "false",
          CLOUDFLARE_ACCOUNT_ID: cuenta,
          CLOUDFLARE_API_TOKEN: token,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(300_000),
      });
      const [codigo, salida, errores] = await Promise.all([proc.exited, leerConTope(proc.stdout, 64_000), leerConTope(proc.stderr, 32_000)]);
      if (codigo !== 0) return /(?:\b(?:401|403|10000|9109)\b|authentication error)/i.test(errores)
        ? c.json({ error: "pages_permission_denied" }, 403)
        : c.json({ error: "pages_publish_failed" }, 502);
      const dominio = `${proyecto}.pages.dev`;
      const url = salida.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\b/gi)?.find((valor) => {
        const host = new URL(valor).hostname;
        return host === dominio || host.endsWith(`.${dominio}`);
      }) ?? null;
      registrarEvento(id, "pages_publicadas", url ?? "Wrangler terminó sin devolver una URL de despliegue.");
      return c.json({ url });
    } catch (error) {
      if (error instanceof ArchivoError) return c.json({ error: error.code }, error.status);
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return c.json({ error: "pages_assets_missing" }, 404);
      return c.json({ error: "pages_publish_failed" }, 502);
    } finally {
      if (temporal) await rm(temporal, { recursive: true, force: true }).catch(() => {});
    }
  })) ?? c.json({ error: "proyecto_ocupado" }, 409);
});
