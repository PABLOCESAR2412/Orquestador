import { hallarEjecutable, matarGrupo } from "./ejecutable";

export type ModeloCommandCode = { id: string; nombre: string };

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const TOPE_SALIDA = 2 * 1024 * 1024;

export function parsearModelosCommandCode(texto: string): ModeloCommandCode[] {
  const modelos = new Map<string, ModeloCommandCode>();
  const lista = texto.replace(ANSI, "").split(/\r?\n/);
  for (const linea of lista) {
    if (/^\s*Decision models\s*\(/i.test(linea)) break;
    const fila = /^\s*([A-Za-z0-9][A-Za-z0-9._:/-]{0,159})\s{2,}(.+?)\s*$/.exec(linea);
    if (!fila) continue;
    const id = fila[1];
    // Jev no es un modelo conversacional y el comando solo lo permite en una entrada JSON específica.
    if (/^typesafe\/jev$/i.test(id) || modelos.has(id)) continue;
    modelos.set(id, { id, nombre: fila[2].slice(0, 180) });
  }
  return [...modelos.values()];
}

let cache: { at: number; modelos: ModeloCommandCode[] } | null = null;
const TTL_MS = 5 * 60_000;

// `--list-models` imprime el catálogo antes de dejar abierto el modo interactivo en algunas
// versiones. Leemos hasta el separador de decision models o hasta el tope y cerramos el grupo.
export async function listarModelosCommandCode(forzar = false): Promise<ModeloCommandCode[]> {
  if (!forzar && cache && Date.now() - cache.at < TTL_MS) return cache.modelos;
  // El servidor soportado es Linux; el alias PowerShell de Windows no se ejecuta con Bun.spawn.
  if (process.platform === "win32") return cache?.modelos ?? [];
  const cli = hallarEjecutable("command-code") ?? hallarEjecutable("cmd");
  if (!cli) return cache?.modelos ?? [];

  const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || "/tmp";
  const proc = Bun.spawn(["setsid", cli, "--list-models", "--no-auto-update"], {
    stdin: "ignore", stdout: "pipe", stderr: "ignore",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, NO_COLOR: "1", COMMANDCODE_SKIP_UPDATES: "true" },
  });
  let texto = "";
  const lector = proc.stdout.getReader();
  const reloj = setTimeout(() => matarGrupo(proc), 3_000);
  try {
    while (texto.length < TOPE_SALIDA) {
      const { value, done } = await lector.read();
      if (done) break;
      texto += new TextDecoder().decode(value, { stream: true });
      if (/Decision models\s*\(/i.test(texto)) break;
    }
  } catch {
    // Si la versión del CLI cambia el formato, el parser devuelve el catálogo vacío y Telo conserva el resto.
  } finally {
    clearTimeout(reloj);
    matarGrupo(proc);
    try { lector.releaseLock(); } catch { /* Ya se cerró la lectura. */ }
    await Promise.race([proc.exited, new Promise((resolve) => setTimeout(resolve, 500))]);
  }
  const modelos = parsearModelosCommandCode(texto);
  if (modelos.length) cache = { at: Date.now(), modelos };
  return modelos.length ? modelos : cache?.modelos ?? [];
}
