// Busca un programa en el PATH actual del servidor. Bun.which sin opciones usa el PATH con el que arrancó el
// proceso; si la app instala un CLI después (o añade su carpeta a PATH), eso no lo vería. Por eso se pasa el PATH vivo.
export function hallarEjecutable(nombre: string): string | null {
  return Bun.which(nombre, { PATH: process.env.PATH ?? "" });
}

// Lanza un CLI en su propio grupo de procesos (setsid), como hace runners/opencode.ts. Así, al cancelar o
// agotar el tiempo se pueden terminar también los hijos, que de lo contrario mantendrían abierta la salida.
export function lanzarEnGrupo(
  argv: string[],
  env: Record<string, string>,
  stdin: "ignore" | "pipe" = "ignore",
): Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe"> {
  return Bun.spawn(["setsid", ...argv], { stdin, stdout: "pipe", stderr: "pipe", env });
}

// Termina el grupo completo del proceso lanzado con lanzarEnGrupo. Si el grupo ya no existe, mata solo al padre.
export function matarGrupo(proc: { pid: number; kill(señal?: number): void }): void {
  try {
    process.kill(-proc.pid, 9);
  } catch {
    proc.kill(9);
  }
}
