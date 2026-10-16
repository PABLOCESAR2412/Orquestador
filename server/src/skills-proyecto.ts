import { db } from "./db";
import { redactar } from "./redaccion";
import { valoresDeProyecto } from "./secretos";
import {
  borrarSkill as borrarSkillArchivo,
  guardarSkill as guardarSkillArchivo,
  leerSkill,
  listarSkills as listarSkillsArchivos,
  leerFrontmatter,
  type AmbitoSkills,
  SkillError as SkillArchivoError,
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

type ComandoSkill = { owner: string; repo: string; name: string };

const SKILLS_CONOCIDAS: Record<string, { owner: string; repo: string; name: string }> = {
  playwright: { owner: "openai", repo: "skills", name: "playwright" },
  caveman: { owner: "JuliusBrussee", repo: "caveman", name: "caveman" },
  impeccable: { owner: "pbakaus", repo: "impeccable", name: "impeccable" },
  "frontend-design": { owner: "vercel-labs", repo: "agent-skills", name: "frontend-design" },
  context7: { owner: "upstash", repo: "context7", name: "context7" },
  "context-7": { owner: "upstash", repo: "context7", name: "context7" },
};

// Interpreta el comando de Skills CLI como datos. Soporta comandos completos, abreviados y URLs.
export function parsearComandoSkill(comando: unknown): ComandoSkill {
  if (typeof comando !== "string" || comando.length > 2048) throw new SkillError("invalid_skill_command");
  if (/[;&|`]/.test(comando)) throw new SkillError("invalid_skill_command");
  const limpio = comando.trim().replace(/^[$#/]\s*/, "");
  if (!limpio) throw new SkillError("invalid_skill_command");

  // Si es directamente el nombre de una skill conocida (ej: "playwright", "caveman", "impeccable")
  const claveDirecta = limpio.toLowerCase();
  if (SKILLS_CONOCIDAS[claveDirecta]) {
    return SKILLS_CONOCIDAS[claveDirecta]!;
  }

  // Si es una URL de GitHub directa
  if (limpio.startsWith("https://")) {
    let url: URL;
    try { url = new URL(limpio); } catch { throw new SkillError("invalid_skill_command"); }
    if (url.hostname === "github.com") {
      const partes = url.pathname.split("/").filter(Boolean);
      if (partes.length >= 2) {
        const owner = partes[0]!;
        const repoName = partes[1]!.replace(/\.git$/i, "");
        let name = repoName.toLowerCase();
        if (partes.includes("skills") && partes.length > partes.indexOf("skills") + 1) {
          const despues = partes[partes.indexOf("skills") + 1]!;
          if (despues !== "SKILL.md" && !despues.startsWith(".")) name = despues.toLowerCase();
        } else if (partes[partes.length - 1]?.toLowerCase().endsWith(".md")) {
          const ultimo = partes[partes.length - 1]!;
          if (ultimo.toUpperCase() === "SKILL.MD" && partes.length > 3) {
            name = partes[partes.length - 2]!.toLowerCase();
          } else {
            name = ultimo.replace(/\.md$/i, "").toLowerCase();
          }
        }
        if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(repoName)) {
          return { owner, repo: repoName, name };
        }
      }
    }
  }

  const partes = limpio.split(/\s+/).filter(Boolean).map((parte) => {
    const comillas = /^(?:"(.*)"|'(.*)')$/.exec(parte);
    return comillas ? comillas[1] ?? comillas[2]! : parte;
  });

  let indice: number;
  if (partes[0] === "npx" && partes[1] === "skills" && partes[2] === "add") indice = 3;
  else if (partes[0] === "bunx" && partes[1] === "skills" && partes[2] === "add") indice = 3;
  else if (["pnpm", "yarn"].includes(partes[0]!) && partes[1] === "dlx" && partes[2] === "skills" && partes[3] === "add") indice = 4;
  else if (partes[0] === "skills" && partes[1] === "add") indice = 2;
  else if (partes.length === 1 && partes[0]!.includes("/")) indice = 0;
  else if (partes.length === 1 && SKILLS_CONOCIDAS[partes[0]!.toLowerCase()]) {
    return SKILLS_CONOCIDAS[partes[0]!.toLowerCase()]!;
  } else throw new SkillError("invalid_skill_command");

  const destino = partes[indice];
  if (!destino) throw new SkillError("invalid_skill_command");

  if (SKILLS_CONOCIDAS[destino.toLowerCase()] && partes.length === indice + 1) {
    return SKILLS_CONOCIDAS[destino.toLowerCase()]!;
  }

  let name: string | undefined;
  const opcion = partes[indice + 1];
  if (opcion === "--skill" && partes.length === indice + 3) {
    name = partes[indice + 2];
  } else if (opcion?.startsWith("--skill=") && partes.length === indice + 2) {
    name = opcion.slice("--skill=".length);
  } else if (partes.length === indice + 1) {
    // Sin argumentos adicionales: inferir name más adelante
  } else {
    throw new SkillError("invalid_skill_command");
  }

  let repo = destino;
  if (destino.startsWith("https://")) {
    let url: URL;
    try { url = new URL(destino); } catch { throw new SkillError("invalid_skill_command"); }
    if (url.hostname !== "github.com" || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
      throw new SkillError("invalid_skill_command");
    }
    const segmentos = url.pathname.split("/").filter(Boolean);
    if (segmentos.length !== 2) throw new SkillError("invalid_skill_command");
    repo = `${segmentos[0]}/${segmentos[1]!.replace(/\.git$/i, "")}`;
  }

  const [owner, repoName, extra] = repo.split("/");
  if (extra !== undefined || !owner || !repoName || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repoName)) {
    throw new SkillError("invalid_skill_command");
  }

  if (!name) {
    name = repoName.toLowerCase().replace(/^(?:claude-|opencode-|agent-|skill-)/, "").replace(/-(?:skill|plugin)$/, "");
  }

  validarNombre(name);
  return { owner, repo: repoName, name };
}

function puntuarRutaSkill(ruta: string, nombre: string): number {
  const norm = ruta.toLowerCase();
  if (norm.includes("test") || norm.includes("oracle") || norm.includes("fixture") || norm.includes("mock") || norm.includes("example") || norm.includes("vendor") || norm.includes("node_modules")) {
    return -100;
  }
  let puntos = 0;
  if (norm.includes(`.opencode/skills/${nombre}/skill.md`)) puntos += 100;
  else if (norm.includes(`skills/.curated/${nombre}/skill.md`)) puntos += 95;
  else if (norm.includes(`skills/${nombre}/skill.md`)) puntos += 90;
  else if (norm === `${nombre}/skill.md`) puntos += 85;
  else if (norm === "skill.md") puntos += 80;
  else if (norm.includes(`.claude/skills/${nombre}/skill.md`)) puntos += 75;
  else if (norm.includes(`.agents/skills/${nombre}/skill.md`)) puntos += 70;
  else if (norm.includes(`plugin/skills/${nombre}/skill.md`)) puntos += 65;
  else if (norm.includes("plugins/")) puntos += 60;
  else if (norm.endsWith(`/${nombre}/skill.md`)) puntos += 55;
  else if (norm.endsWith("/skill.md")) puntos += 50;

  const profundidad = ruta.split("/").length;
  puntos -= profundidad * 2;
  return puntos;
}

async function jsonGithub(url: string, limite: number): Promise<Record<string, unknown>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Telo-Orquestador" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SkillError("skill_catalog_failed", 502);
  }
  if (respuesta.status === 404) throw new SkillError("skill_no_encontrada", 404);
  if (!respuesta.ok || !respuesta.body) throw new SkillError("skill_catalog_failed", 502);
  const texto = await leerRespuesta(respuesta, limite);
  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    throw new SkillError("skill_catalog_failed", 502);
  }
}

async function leerRespuesta(respuesta: Response, limite: number): Promise<string> {
  const lector = respuesta.body!.getReader();
  const partes: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limite) throw new SkillError("skill_catalog_failed", 502);
      partes.push(value);
    }
  } finally {
    await lector.cancel().catch(() => {});
    lector.releaseLock();
  }
  const resultado = new Uint8Array(bytes);
  let offset = 0;
  for (const parte of partes) { resultado.set(parte, offset); offset += parte.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(resultado);
}

export async function instalarSkillComando(ambito: AmbitoSkills, comando: unknown) {
  const pedido = parsearComandoSkill(comando);
  const base = `https://api.github.com/repos/${pedido.owner}/${pedido.repo}`;
  const repo = await jsonGithub(base, 128_000);
  const rama = repo.default_branch;
  if (typeof rama !== "string" || !/^[A-Za-z0-9._/-]{1,200}$/.test(rama) || rama.includes("..")) {
    throw new SkillError("skill_catalog_failed", 502);
  }
  const arbol = await jsonGithub(`${base}/git/trees/${encodeURIComponent(rama)}?recursive=1`, 2_000_000);
  if (!Array.isArray(arbol.tree) || arbol.truncated === true) throw new SkillError("skill_catalog_failed", 502);

  const blobs = (arbol.tree as { type?: unknown; path?: unknown }[])
    .filter((item) => item?.type === "blob" && typeof item.path === "string" && (item.path as string).toLowerCase().endsWith("skill.md"))
    .map((item) => item.path as string);

  let candidatos = blobs.filter((path) => {
    const p = path.toLowerCase();
    return p.endsWith(`/${pedido.name}/skill.md`) || p === `${pedido.name}/skill.md` || p === "skill.md";
  });
  if (candidatos.length === 0) {
    candidatos = blobs;
  }
  if (!candidatos.length) throw new SkillError("skill_no_encontrada", 404);

  const ordenados = [...new Set(candidatos)]
    .map((r) => ({ ruta: r, puntos: puntuarRutaSkill(r, pedido.name) }))
    .sort((a, b) => b.puntos - a.puntos);

  const ruta = ordenados[0]!.ruta;
  if (ruta.split("/").some((segmento) => !/^[A-Za-z0-9._-]+$/.test(segmento) || segmento === "." || segmento === "..")) {
    throw new SkillError("invalid_skill_command");
  }
  const fuente = `https://github.com/${pedido.owner}/${pedido.repo}/blob/${rama}/${ruta}`;
  const raw = `https://raw.githubusercontent.com/${pedido.owner}/${pedido.repo}/${rama}/${ruta}`;
  let contenido = await descargar(raw, MAX_CONTENIDO);
  const cabecera = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(contenido);
  if (!cabecera) {
    contenido = `---\nname: ${pedido.name}\ndescription: Instrucciones de ${pedido.name}\nsource: ${fuente}\n---\n\n${contenido}`;
  } else {
    const campos = cabecera[1]!.split(/\r?\n/).filter((linea) => !/^source\s*:/.test(linea));
    campos.push(`source: ${fuente}`);
    contenido = `---\n${campos.join("\n")}\n---${cabecera[2]}${contenido.slice(cabecera[0].length)}`;
  }
  operacionArchivo(() => guardarSkillArchivo(ambito, pedido.name, contenido));
  const detalle = operacionArchivo(() => leerSkill(ambito, pedido.name));
  return { name: pedido.name, content: detalle.contenido, source: fuente };
}
