import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { getModels } from "./models";

const PETICION_DELEGAR = /\b(subagentes?|agentes?\s+(?:en\s+)?paralelo|deleg(?:a|ar|ando)|llama\s+a\s+(?:varios|m[aá]s\s+de\s+uno|un\s+subagente))\b/i;
const MAX_MODELOS = 4;

export type PreparacionSubagentes = {
  instruccion: string;
  directorio: string;
  limpiar: () => void;
};

export function pideSubagentes(prompt: string): boolean {
  return PETICION_DELEGAR.test(prompt);
}

function slug(valor: string): string {
  return valor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "modelo";
}

function modelosNombrados(prompt: string, catalogo: Awaited<ReturnType<typeof getModels>>) {
  const texto = prompt.toLocaleLowerCase();
  const candidatos = catalogo
    .filter((modelo) =>
      (modelo.id.length >= 5 && texto.includes(modelo.id.toLocaleLowerCase())) ||
      (modelo.name.trim().length >= 8 && texto.includes(modelo.name.toLocaleLowerCase())),
    )
    .sort((a, b) => Math.max(b.id.length, b.name.length) - Math.max(a.id.length, a.name.length));
  const unicos = new Map<string, (typeof candidatos)[number]>();
  for (const candidato of candidatos) {
    unicos.set(candidato.id, candidato);
    if (unicos.size >= MAX_MODELOS) break;
  }
  return [...unicos.values()];
}

export async function prepararSubagentes(opts: {
  prompt: string;
  modelo: string;
  esfuerzo?: string | null;
  idEjecucion: string;
  listarModelos?: typeof getModels;
  directorioBase?: string;
}): Promise<PreparacionSubagentes | null> {
  if (!pideSubagentes(opts.prompt) || opts.modelo.startsWith("codex/")) return null;

  let catalogo: Awaited<ReturnType<typeof getModels>> = [];
  try {
    catalogo = await (opts.listarModelos ?? getModels)();
  } catch {
    // La delegación sin cambio de modelo aún puede heredar el modelo principal.
  }
  const mismo = catalogo.find((m) => m.id === opts.modelo);
  const seleccionados = modelosNombrados(opts.prompt, catalogo);
  if (seleccionados.length === 0) {
    seleccionados.push(mismo ?? {
      id: opts.modelo,
      name: opts.modelo,
      provider: opts.modelo.split("/")[0] ?? "",
      inputUsd: 0,
      outputUsd: 0,
      context: 0,
      variants: [],
      free: false,
      costTier: "medio",
      costWarning: null,
      group: "",
      recommended: false,
    });
  }

  const directorio = join(opts.directorioBase ?? config.dataDir, "perfiles-subagente", opts.idEjecucion);
  const carpetaAgentes = join(directorio, "agents");
  mkdirSync(carpetaAgentes, { recursive: true });
  const alias = seleccionados.map((modelo, indice) => {
    const nombre = `telo-${slug(modelo.name)}-${indice + 1}`;
    const variante = opts.esfuerzo && modelo.variants.includes(opts.esfuerzo) ? `#${opts.esfuerzo}` : "";
    const idModelo = JSON.stringify(`${modelo.id}${variante}`);
    const archivo = join(carpetaAgentes, `${nombre}.md`);
    writeFileSync(
      archivo,
      [
        "---",
        `description: Subagente temporal ${slug(modelo.id)} para la tarea solicitada`,
        "mode: subagent",
        `model: ${idModelo}`,
        "---",
        "Trabajas como subagente de Telo. Atiende únicamente la tarea que te asignó el agente principal, devuelve hallazgos concretos y aclara qué comprobaste. No inicies otros subagentes. Conserva las reglas e instrucciones del workspace.",
        "",
      ].join("\n"),
      { encoding: "utf8", flag: "wx" },
    );
    return { nombre, modelo: modelo.name, id: modelo.id };
  });

  const detalle = alias.map((a) => `- ${a.nombre}: ${a.modelo} (${a.id})`).join("\n");
  return {
    directorio,
    instruccion: [
      "El usuario pidió expresamente delegar esta tarea en subagentes.",
      "Usa el mecanismo de subagentes disponible y lanza trabajo independiente en paralelo cuando sea posible. Para el mismo modelo puedes llamar varias veces al perfil correspondiente.",
      "Perfiles temporales disponibles:",
      detalle,
      "Al terminar, integra las respuestas, indica qué verificó cada subagente y señala los límites o fallos de sus comprobaciones.",
    ].join("\n"),
    limpiar: () => rmSync(directorio, { recursive: true, force: true }),
  };
}
