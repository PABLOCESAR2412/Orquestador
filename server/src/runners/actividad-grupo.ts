import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// El servidor ve /proc del host: los hijos conservan el grupo creado por setsid.
export function actividadDelGrupo(grupo: number, procDir = "/proc"): string | null {
  try {
    const actividad: string[] = [];
    for (const id of readdirSync(procDir)) {
      if (!/^\d+$/.test(id)) continue;
      try {
        const stat = readFileSync(join(procDir, id, "stat"), "utf8");
        const campos = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
        if (Number(campos[2]) !== grupo) continue;
        let io = "";
        try { io = readFileSync(join(procDir, id, "io"), "utf8"); } catch { /* Puede salir entre ambas lecturas. */ }
        actividad.push(`${id}:${campos[11]}:${campos[12]}:${io}`);
      } catch { /* El proceso puede terminar mientras se recorre /proc. */ }
    }
    return actividad.length ? actividad.sort().join("|") : null;
  } catch { return null; }
}
