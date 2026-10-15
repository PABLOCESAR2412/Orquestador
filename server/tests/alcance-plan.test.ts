import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { capturarAlcance, comprobarAlcance } from "../src/alcance-plan";
import { gitSeguro } from "../src/git";

const raiz = mkdtempSync(join(tmpdir(), "telo-alcance-"));
let contador = 0;
afterAll(() => {
  const absoluta = resolve(raiz);
  if (
    !absoluta.startsWith(resolve(tmpdir()) + sep) ||
    !absoluta.split(sep).pop()!.startsWith("telo-alcance-")
  )
    throw new Error("Raíz temporal inesperada");
  rmSync(absoluta, { recursive: true, force: true });
});

async function crearRepo() {
  const cwd = join(raiz, String(++contador));
  mkdirSync(join(cwd, "src"), { recursive: true });
  const git = async (args: string[]) => {
    const r = await gitSeguro(args, { cwd });
    if (r.code !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  await git(["init"]);
  writeFileSync(join(cwd, "src", "dentro.txt"), "base\n");
  writeFileSync(join(cwd, "fuera.txt"), "base\n");
  writeFileSync(join(cwd, ".gitignore"), "ignorado/\n");
  await git(["add", "-A"]);
  await git([
    "-c",
    "user.name=Prueba",
    "-c",
    "user.email=prueba@example.invalid",
    "commit",
    "-m",
    "base",
  ]);
  return { cwd, git };
}

describe("alcance del plan aprobado", () => {
  test("permite archivos explícitos y contenido de directorios existentes", async () => {
    const { cwd } = await crearRepo();
    const snapshot = await capturarAlcance(cwd, ["src", ".gitignore"]);
    writeFileSync(join(cwd, "src", "dentro.txt"), "modificado\n");
    writeFileSync(join(cwd, "src", "nuevo.txt"), "nuevo\n");
    writeFileSync(join(cwd, ".gitignore"), "otra-carpeta/\n");
    expect(await comprobarAlcance(snapshot)).toEqual([]);
  });

  test("detecta modificaciones y archivos nuevos fuera del plan, sin perderlos", async () => {
    const { cwd } = await crearRepo();
    const snapshot = await capturarAlcance(cwd, ["src/dentro.txt"]);
    writeFileSync(join(cwd, "fuera.txt"), "no autorizado\n");
    writeFileSync(join(cwd, "nuevo.txt"), "nuevo\n");
    expect(await comprobarAlcance(snapshot)).toEqual(["fuera.txt", "nuevo.txt"]);
    expect(readFileSync(join(cwd, "fuera.txt"), "utf8")).toBe("no autorizado\n");
    expect(existsSync(join(cwd, "nuevo.txt"))).toBe(true);
  });

  test("comprueba ambos extremos de renombres y permite borrados aprobados", async () => {
    const { cwd } = await crearRepo();
    const snapshot = await capturarAlcance(cwd, ["src"]);
    rmSync(join(cwd, "src", "dentro.txt"));
    rmSync(join(cwd, "fuera.txt"));
    writeFileSync(join(cwd, "renombrado.txt"), "base\n");
    expect(await comprobarAlcance(snapshot)).toEqual(["fuera.txt", "renombrado.txt"]);
  });

  test("preserva cambios previos de conversación y no los atribuye al nuevo turno", async () => {
    const { cwd, git } = await crearRepo();
    const head = await git(["rev-parse", "HEAD"]);
    writeFileSync(join(cwd, "fuera.txt"), "cambio del turno anterior\n");
    writeFileSync(join(cwd, "previo.txt"), "nuevo del turno anterior\n");
    const snapshot = await capturarAlcance(cwd, ["src/dentro.txt"]);
    writeFileSync(join(cwd, "src", "dentro.txt"), "cambio de este turno\n");
    expect(await comprobarAlcance(snapshot)).toEqual([]);
    expect(readFileSync(join(cwd, "fuera.txt"), "utf8")).toBe("cambio del turno anterior\n");
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
  });

  test("rechaza rutas absolutas, traversal y .git", async () => {
    const { cwd } = await crearRepo();
    for (const ruta of [
      "../fuera",
      "/tmp/fuera",
      "C:\\fuera",
      "src/../../fuera",
      ".git/config",
      "src/.git/config",
      ".",
    ]) {
      await expect(capturarAlcance(cwd, [ruta])).rejects.toThrow();
    }
  });

  test("rechaza directorios simbólicos en el plan", async () => {
    const { cwd } = await crearRepo();
    symlinkSync(
      join(cwd, "src"),
      join(cwd, "enlace"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(lstatSync(join(cwd, "enlace")).isSymbolicLink()).toBe(true);
    await expect(capturarAlcance(cwd, ["enlace/dentro.txt"])).rejects.toThrow();
  });
});
