import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { hallarEjecutable } from "./ejecutable";
import { aislamientoActivo } from "./runners/aislamiento";

export function revisarDependencias(cwd: string): string[] {
  const carpetas = [cwd, join(cwd, "server"), join(cwd, "web")];
  for (const grupo of ["apps", "packages"]) {
    try {
      if (lstatSync(join(cwd, grupo)).isSymbolicLink()) continue;
      for (const entrada of readdirSync(join(cwd, grupo), { withFileTypes: true }).slice(0, 60))
        if (entrada.isDirectory()) carpetas.push(join(cwd, grupo, entrada.name));
    } catch { /* El proyecto puede no ser un monorepo. */ }
  }
  const avisos: string[] = [];
  let workspaces: string[] = [];
  for (const carpeta of carpetas) {
    try {
      const rutaRelativa = relative(cwd, carpeta).replaceAll("\\", "/");
      if (rutaRelativa && workspaces.some((patron) => !patron.startsWith("!") && new Bun.Glob(patron).match(rutaRelativa))
          && !workspaces.some((patron) => patron.startsWith("!") && new Bun.Glob(patron.slice(1)).match(rutaRelativa))) continue;
      if (!existsSync(carpeta) || lstatSync(carpeta).isSymbolicLink()) continue;
      const ruta = join(carpeta, "package.json");
      if (!existsSync(ruta) || lstatSync(ruta).isSymbolicLink()) continue;
      if (lstatSync(ruta).size > 256_000) continue;
      const manifiesto = JSON.parse(readFileSync(ruta, "utf8"));
      if (carpeta === cwd) {
        const declarados = Array.isArray(manifiesto.workspaces) ? manifiesto.workspaces : manifiesto.workspaces?.packages;
        if (Array.isArray(declarados)) workspaces = declarados.filter((patron): patron is string => typeof patron === "string" && patron.length > 0);
      }
      const tieneDependencias = Object.keys(manifiesto.dependencies ?? {}).length || Object.keys(manifiesto.devDependencies ?? {}).length;
      if (!tieneDependencias && !(carpeta === cwd && workspaces.length)) continue;
      if (existsSync(join(carpeta, "node_modules")) || (carpeta !== cwd && existsSync(join(cwd, "node_modules")))) continue;
      const bun = existsSync(join(carpeta, "bun.lock")) || existsSync(join(carpeta, "bun.lockb"));
      const pnpm = existsSync(join(carpeta, "pnpm-lock.yaml"));
      const yarn = existsSync(join(carpeta, "yarn.lock"));
      const npm = existsSync(join(carpeta, "package-lock.json"));
      const gestor: string | null = typeof manifiesto.packageManager === "string" ? manifiesto.packageManager.split("@")[0] : null;
      const nombre = (["bun", "pnpm", "yarn", "npm"] as const).find((gestorValido) => gestor === gestorValido)
        ?? (bun ? "bun" : pnpm ? "pnpm" : yarn ? "yarn" : "npm");
      const congelado = { bun, pnpm, yarn, npm }[nombre];
      const comando = nombre === "npm" ? (npm ? "npm ci" : "npm install") : `${nombre} install${congelado ? " --frozen-lockfile" : ""}`;
      avisos.push(`Faltan dependencias en ${rutaRelativa || "la raíz"}. Si la tarea requiere compilar o ejecutar pruebas, prepara ${comando} aquí.${hallarEjecutable(nombre) ? "" : ` El servidor necesita ${nombre} para ejecutar ese comando.`}`);
    } catch { avisos.push(`No se pudo revisar package.json de ${relative(cwd, carpeta) || "la raíz"}. Revisa su formato antes de ejecutar pruebas.`); }
  }
  return avisos;
}

export function comprobarHerramientas(requiereGit: boolean): string[] {
  const necesarias = ["opencode", ...(requiereGit ? ["git"] : []), ...(aislamientoActivo() ? ["bwrap", "setsid"] : [])];
  return necesarias.filter(nombre => !hallarEjecutable(nombre)).map(nombre =>
    `Falta ${nombre} en el servidor. Instálalo o corrige el PATH del servicio antes de reintentar la tarea.`);
}
