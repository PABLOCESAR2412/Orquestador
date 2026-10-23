import { lstatSync, mkdirSync, rmdirSync, utimesSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export function respaldoAislado(datos: string): boolean {
  return process.env.TELO_RESPALDO_PRUEBA_AISLADA === "1" && resolve(datos).startsWith(resolve(tmpdir()) + sep);
}
export function marcaRespaldo(): string {
  return process.env.TELO_MARCA_DESPLIEGUE || resolve(import.meta.dir, "../../.git/telo-mantenimiento");
}
export function candadoRespaldo(): string { return join(dirname(marcaRespaldo()), "telo-operacion.lock"); }

// El llamador mantiene flock durante la operación. Una marca preexistente se
// conserva: nunca se retira una concesión cuya propiedad no pertenece a este proceso.
export async function pausarParaRespaldo(): Promise<() => void> {
  const marca = marcaRespaldo();
  mkdirSync(marca, { mode: 0o700 });
  const identidad = lstatSync(marca);
  const propia = () => {
    try {
      const actual = lstatSync(marca);
      return !actual.isSymbolicLink() && actual.dev === identidad.dev && actual.ino === identidad.ino;
    } catch { return false; }
  };
  const reloj = setInterval(() => {
    try { if (propia()) { const ahora = new Date(); utimesSync(marca, ahora, ahora); } }
    catch { /* El fallo del disco lo reportará la copia; el reloj no aborta el proceso. */ }
  }, 30_000);
  let cerrado = false;
  const liberar = () => {
    if (cerrado) return;
    cerrado = true; clearInterval(reloj);
    if (propia()) rmdirSync(marca);
  };
  try {
    const api = new URL(process.env.TELO_API || `http://127.0.0.1:${process.env.PORT || 3000}`);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(api.hostname)) throw new Error("El respaldo solo consulta el servidor local");
    let listo = false;
    for (let i = 0; i < 5; i++) {
      try {
        const respuesta = await fetch(new URL("/api/health", api), { signal: AbortSignal.timeout(3_000) });
        const estado = await respuesta.json() as { ok?: boolean; despliegue?: { mantenimiento: boolean; activas: number } };
        if (estado.ok && estado.despliegue?.mantenimiento && estado.despliegue.activas === 0) { listo = true; break; }
      } catch {
        const servicio = Bun.spawnSync(["systemctl", "is-active", "orquestador.service"], { stdout: "pipe", stderr: "ignore" });
        if (servicio.exitCode === 3 && ["inactive", "failed"].includes(servicio.stdout.toString().trim())) { listo = true; break; }
      }
      await Bun.sleep(2_000);
    }
    if (!listo) throw new Error("El respaldo se pospone: hay trabajos activos o el servicio no admite drenado seguro");
    const agentes = Bun.spawnSync(["pgrep", "-f", "(^|/)opencode run( |$)|(^|/)codex( .*)? exec( |$)"], { stdout: "ignore", stderr: "ignore" });
    if (agentes.exitCode !== 1) throw new Error("El respaldo se pospone: hay agentes externos o no se pudo comprobar su cierre");
    return liberar;
  } catch (error) { liberar(); throw error; }
}
