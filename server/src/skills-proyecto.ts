import { db } from "./db";
import { redactar } from "./redaccion";
import { valoresDeProyecto } from "./secretos";
import {
  borrarSkill as borrarSkillArchivo,
  guardarSkill as guardarSkillArchivo,
  leerSkill,
  listarSkills as listarSkillsArchivos,
  leerFrontmatter,
  SkillError as SkillArchivoError,
  type AmbitoSkills,
} from "./skills";

export type SkillProyecto = { name: string; content: string; source: string | null };
export type SkillEncontrada = { name: string; url: string; description?: string };

export class SkillError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 413 | 502 = 400,
  ) {
    super(code);
  }
}

const MAX_CONTENIDO = 16_000;
const CATALOGOS = [
  { repo: "anthropics/skills", prefix: "skills/" },
  { repo: "openai/skills", prefix: "skills/.curated/" },
];
let catalogo: { vence: number; skills: SkillEncontrada[] } | null = null;
let cargaCatalogo: Promise<SkillEncontrada[]> | null = null;

function validarNombre(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new SkillError("invalid_skill_name");
  }
}

// Soporta URLs de GitHub de archivos SKILL.md o carpetas (/tree/...) de skills.
function documentoGitHub(input: unknown): { source: string; raw: string; name: string } {
  if (typeof input !== "string" || /[\\\s%?#]/.test(input))
    throw new SkillError("invalid_skill_url");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SkillError("invalid_skill_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/^https:\/\/[^/:]+\//.test(input)
  ) {
    throw new SkillError("invalid_skill_url");
  }
  const partesOriginales = input.slice(input.indexOf("/", 8) + 1).split("/");
  if (partesOriginales.some((p) => !/^[A-Za-z0-9._-]+$/.test(p) || p === "." || p === "..")) {
    throw new SkillError("invalid_skill_url");
  }
  const partes = url.pathname.slice(1).split("/").filter(Boolean);
  if (partes.length < 2) throw new SkillError("invalid_skill_url");
  const [owner, repo] = partes;

  let ref = "main";
  let rutaPartes: string[] = [];

  if (url.hostname === "github.com") {
    const tipo = partes[2];
    if (tipo !== "blob" && tipo !== "tree") throw new SkillError("invalid_skill_url");
    ref = partes[3] || "main";
    rutaPartes = partes.slice(4);
  } else if (url.hostname === "raw.githubusercontent.com") {
    ref = partes[2] || "main";
    rutaPartes = partes.slice(3);
  } else {
    throw new SkillError("invalid_skill_url");
  }

  let nombreSkill = "";
  if (rutaPartes.length === 0) {
    rutaPartes = ["SKILL.md"];
    nombreSkill = repo;
  } else {
    const ultimo = rutaPartes[rutaPartes.length - 1];
    if (ultimo.includes(".")) {
      if (!ultimo.toLowerCase().endsWith(".md")) {
        throw new SkillError("invalid_skill_url");
      }
      if (ultimo.toUpperCase() === "SKILL.MD") {
        nombreSkill = rutaPartes.length > 1 ? rutaPartes[rutaPartes.length - 2] : repo;
      } else {
        nombreSkill = ultimo.replace(/\.md$/i, "");
      }
    } else {
      nombreSkill = ultimo;
      rutaPartes.push("SKILL.md");
    }
  }

  validarNombre(nombreSkill);
  const rutaFinal = rutaPartes.join("/");
  return {
    source: `https://github.com/${owner}/${repo}/blob/${ref}/${rutaFinal}`,
    raw: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rutaFinal}`,
    name: nombreSkill,
  };
}

async function descargar(url: string, limite: number): Promise<string> {
  try {
    let respuesta = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (respuesta.status === 404 && url.includes("/main/")) {
      // Si la rama no es main, intentar con master
      const urlMaster = url.replace("/main/", "/master/");
      const alt = await fetch(urlMaster, { redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (alt.ok) respuesta = alt;
    }
    if (!respuesta.ok || !respuesta.body) throw new SkillError("skill_download_failed", 502);
    const lector = respuesta.body.getReader();
    const partes: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limite) throw new SkillError("skill_too_large");
        partes.push(value);
      }
    } finally {
      await lector.cancel().catch(() => {});
      lector.releaseLock();
    }
    const resultado = new Uint8Array(bytes);
    let offset = 0;
    for (const parte of partes) {
      resultado.set(parte, offset);
      offset += parte.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(resultado);
  } catch (error) {
    if (error instanceof SkillError) throw error;
    throw new SkillError("skill_download_failed", 502);
  }
}

function ambitoProyecto(projectId: string): AmbitoSkills {
  const proyecto = db.query<{ repo_path: string | null }, [string]>(
    "SELECT repo_path FROM projects WHERE id = ?",
  ).get(projectId);
  if (!proyecto?.repo_path) throw new SkillError("project_not_found", 404);
  return { ambito: "proyecto", carpeta: proyecto.repo_path };
}

// El importador y el editor usan los mismos archivos que ya carga OpenCode.
function operacionArchivo<T>(operacion: () => T): T {
  try {
    return operacion();
  } catch (error) {
    if (error instanceof SkillArchivoError) throw new SkillError(error.code, error.status);
    throw error;
  }
}

export function listarSkills(projectId: string): SkillProyecto[] {
  const ambito = ambitoProyecto(projectId);
  const valores = valoresDeProyecto(projectId);
  return operacionArchivo(() => listarSkillsArchivos(ambito).map(({ nombre }) => {
    const content = redactar(leerSkill(ambito, nombre).contenido, valores);
    return { name: nombre, content, source: leerFrontmatter(content)?.source ?? null };
  }));
}

export function guardarSkill(
  projectId: string,
  input: { name: string; content: string; source?: string | null },
): SkillProyecto {
  validarNombre(input.name);
  if (
    typeof input.content !== "string" ||
    !input.content.trim() ||
    input.content.length > MAX_CONTENIDO
  ) {
    throw new SkillError("invalid_skill_content");
  }
  const ambito = ambitoProyecto(projectId);
  let content = redactar(input.content, valoresDeProyecto(projectId));
  const source = input.source == null ? null : documentoGitHub(input.source).source;
  if (!/^---\r?\n/.test(content)) {
    content = `---\nname: ${input.name}\ndescription: Instrucciones de ${input.name} para este proyecto.\n---\n${content}`;
  }
  if (input.source !== undefined) {
    content = content.replace(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/, (_, cabecera: string, salto: string) => {
      const campos = cabecera.split(/\r?\n/).filter((linea) => !/^source\s*:/.test(linea));
      if (source) campos.push(`source: ${source}`);
      return `---\n${campos.join("\n")}\n---${salto}`;
    });
  }
  operacionArchivo(() => guardarSkillArchivo(ambito, input.name, content));
  return { name: input.name, content, source: leerFrontmatter(content)?.source ?? null };
}

export function borrarSkill(projectId: string, name: string): boolean {
  validarNombre(name);
  const ambito = ambitoProyecto(projectId);
  try {
    operacionArchivo(() => borrarSkillArchivo(ambito, name));
    return true;
  } catch (error) {
    if (error instanceof SkillError && error.code === "skill_no_encontrada") return false;
    throw error;
  }
}

async function cargarCatalogos(): Promise<SkillEncontrada[]> {
  const listas = await Promise.all(
    CATALOGOS.map(async ({ repo, prefix }) => {
      const texto = await descargar(
        `https://api.github.com/repos/${repo}/git/trees/main?recursive=1`,
        2_000_000,
      );
      let datos: { tree?: { path?: string; type?: string; sha?: string }[]; truncated?: boolean };
      try {
        datos = JSON.parse(texto);
      } catch {
        throw new SkillError("skill_catalog_failed", 502);
      }
      if (!datos || !Array.isArray(datos.tree) || datos.truncated)
        throw new SkillError("skill_catalog_failed", 502);
      return datos.tree.flatMap((item) => {
        if (
          !item ||
          item.type !== "blob" ||
          typeof item.path !== "string" ||
          !item.path.startsWith(prefix)
        )
          return [];
        const ruta = item.path.slice(prefix.length).split("/");
        if (
          ruta.length !== 2 ||
          ruta[1] !== "SKILL.md" ||
          ruta[0].length > 64 ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ruta[0])
        )
          return [];
        return [{ name: ruta[0], url: `https://github.com/${repo}/blob/main/${item.path}` }];
      });
    }),
  );
  return listas.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function buscarSkills(query: string): Promise<SkillEncontrada[]> {
  if (typeof query !== "string" || query.length > 100) throw new SkillError("invalid_skill_query");
  const termino = query.trim().toLowerCase();
  if (!termino) return [];
  if (!catalogo || catalogo.vence <= Date.now()) {
    if (!cargaCatalogo)
      cargaCatalogo = cargarCatalogos()
        .then((skills) => {
          catalogo = { skills, vence: Date.now() + 10 * 60_000 };
          return skills;
        })
        .finally(() => {
          cargaCatalogo = null;
        });
    await cargaCatalogo;
  }
  return catalogo!.skills.filter((skill) => skill.name.includes(termino)).slice(0, 80);
}

export async function importarSkill(projectId: string, url: string): Promise<SkillProyecto> {
  const documento = documentoGitHub(url);
  const content = await descargar(documento.raw, MAX_CONTENIDO);
  return guardarSkill(projectId, { name: documento.name, content, source: documento.source });
}
