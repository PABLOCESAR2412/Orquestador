import { existsSync } from "node:fs";
import { join } from "node:path";
import { carpetaHome } from "./hogar";
import { hallarEjecutable } from "./ejecutable";

let cache: { ruta: string | null; hasta: number; contexto: string } | null = null;
// Sin inferencia ni instalación durante un turno. Solo reconocer el CLI probado.
export async function rtkDisponible(): Promise<string | null> {
  const contexto = `${carpetaHome()}:${process.env.PATH}`;
  if (cache && cache.hasta > Date.now() && cache.contexto === contexto) return cache.ruta;
  const local = join(carpetaHome(), ".local", "bin", "rtk");
  const ruta = existsSync(local) ? local : hallarEjecutable("rtk");
  let verificado: string | null = null;
  if (ruta) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const p = Bun.spawn([ruta, "--version"], { stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH ?? "" } });
      timer = setTimeout(() => p.kill(), 2_000);
      const salida = await new Response(p.stdout).text();
      if (await p.exited === 0 && /^rtk 1\.1\.0\s*$/.test(salida)) verificado = ruta;
    } catch { /* No bloquear el turno si la herramienta local falla. */ }
    finally { if (timer) clearTimeout(timer); }
  }
  cache = { ruta: verificado, hasta: Date.now() + 60_000, contexto };
  return verificado;
}

// Solo salidas para lectura humana. No tocar cadenas, redirecciones, sustituciones,
// comandos de escritura ni formatos que un script pueda estar interpretando.
export function comandoConRtk(comando: string, ruta: string | null): string {
  if (!ruta || comando.length > 2_000 || /[^\w\s./:@=,+\-]/.test(comando)) return comando;
  if (/(?:^|\s)(?:--json|--porcelain|--format|--exit-code|--check|--numstat|--raw|--name-only|--name-status|--files|--count|--output|--pre|--replace|-c|-l|-q|-0|-z)(?:\s|=|$)/.test(comando)) return comando;
  if (!/^(?:git\s+(?:status|diff|log)\b|rg\s|ls(?:\s|$)|bun\s+test\b)/.test(comando)) return comando;
  return `'${ruta.replaceAll("'", "'\\''")}' ${comando}`;
}
