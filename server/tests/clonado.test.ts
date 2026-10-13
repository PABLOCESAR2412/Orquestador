import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal compartida por todos los archivos de prueba (ver proyectos.test.ts).
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { codigoDeErrorClon, urlGithubNormalizada, clonarRepositorio, ErrorClonado } = await import("../src/clonado");
const { projects } = await import("../src/routes/projects");
const { db } = await import("../src/db");

const CLAVE_VALIDA = randomBytes(32).toString("base64");
const json = (cuerpo: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
});

describe("URL de GitHub", () => {
  test("acepta https y ssh, con o sin .git, y las deja en https normalizada", () => {
    expect(urlGithubNormalizada("https://github.com/acme/app.git")).toEqual({
      url: "https://github.com/acme/app",
      repo: "app",
    });
    expect(urlGithubNormalizada("git@github.com:acme/mi.repo.git")).toEqual({
      url: "https://github.com/acme/mi.repo",
      repo: "mi.repo",
    });
    expect(urlGithubNormalizada("  https://github.com/acme/app/  ")?.repo).toBe("app");
  });

  test("rechaza otros hosts, rutas extra y nombres con trampas", () => {
    expect(urlGithubNormalizada("https://gitlab.com/acme/app")).toBeNull();
    expect(urlGithubNormalizada("https://github.com/acme/app/tree/main")).toBeNull();
    expect(urlGithubNormalizada("https://github.com/-acme/app")).toBeNull();
    expect(urlGithubNormalizada("https://github.com/acme/..")).toBeNull();
    expect(urlGithubNormalizada("https://github.com/acme/app;rm -rf x")).toBeNull();
    expect(urlGithubNormalizada("")).toBeNull();
  });
});

describe("errores de Git", () => {
  test("cada causa conocida tiene su código, sin texto de Git", () => {
    expect(codigoDeErrorClon("git@github.com: Permission denied (publickey).\nfatal: Could not read")).toBe(
      "clave_no_autorizada",
    );
    expect(codigoDeErrorClon("ERROR: Repository not found.")).toBe("repo_no_encontrado");
    expect(codigoDeErrorClon("Host key verification failed.")).toBe("host_no_verificado");
    expect(codigoDeErrorClon("ssh: Could not resolve hostname github.com")).toBe("sin_red_github");
  });

  test("lo desconocido cae en un código genérico y el error de 'comando no encontrado' no se confunde", () => {
    expect(codigoDeErrorClon("algo inesperado")).toBe("clonado_fallo");
    expect(codigoDeErrorClon("sh: ssh: not found")).toBe("clonado_fallo");
  });
});

describe("rutas de clonado", () => {
  test("una URL que no es de GitHub se rechaza antes de crear nada", async () => {
    const res = await projects.request("/projects/desde-github", json({ url: "https://example.com/a/b" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_github_url" });
  });

  test("sin clave de cifrado en el servidor, no queda carpeta ni proyecto a medias", async () => {
    const original = process.env.TELO_CLAVE_CIFRADO;
    delete process.env.TELO_CLAVE_CIFRADO;
    try {
      const res = await projects.request(
        "/projects/desde-github",
        json({ url: "https://github.com/acme/repo-sin-clave" }),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "clave_sin_cifrado" });
      expect(existsSync(join(RAIZ_PRUEBAS, "proyectos", "repo-sin-clave"))).toBe(false);
      expect(db.query("SELECT id FROM projects WHERE name = ?").get("repo-sin-clave")).toBeNull();
    } finally {
      if (original === undefined) delete process.env.TELO_CLAVE_CIFRADO;
      else process.env.TELO_CLAVE_CIFRADO = original;
    }
  });

  test("clonar un proyecto que no viene de GitHub o no existe responde con su código", async () => {
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run(
      "proy-sin-origen",
      "Sin origen",
      join(RAIZ_PRUEBAS, "proyectos", "sin-origen"),
    );
    const sinOrigen = await projects.request("/projects/proy-sin-origen/clonar", { method: "POST" });
    expect(sinOrigen.status).toBe(400);
    expect(await sinOrigen.json()).toEqual({ error: "project_sin_origen" });

    const noExiste = await projects.request("/projects/no-existe/clonar", { method: "POST" });
    expect(noExiste.status).toBe(404);
  });
});

describe("clonarRepositorio", () => {
  test("una URL fuera de GitHub no llega ni a Git", async () => {
    const carpeta = join(RAIZ_PRUEBAS, "proyectos", "destino-url");
    await expect(clonarRepositorio("proy-url", carpeta, "https://example.com/a/b")).rejects.toMatchObject({
      code: "url_no_valida",
      status: 400,
    });
    expect(existsSync(carpeta)).toBe(false);
  });

  test("un proyecto sin clave no clona: pide crearla primero", async () => {
    const original = process.env.TELO_CLAVE_CIFRADO;
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = "proy-sin-clave";
    const carpeta = join(RAIZ_PRUEBAS, "proyectos", "sin-clave");
    try {
      mkdirSync(carpeta, { recursive: true });
      db.query("INSERT INTO projects (id, name, repo_path, origen_url) VALUES (?, ?, ?, ?)").run(
        id,
        "Sin clave",
        carpeta,
        "https://github.com/acme/sin-clave",
      );
      const error = await clonarRepositorio(id, carpeta, "https://github.com/acme/sin-clave").catch((e) => e);
      expect(error).toBeInstanceOf(ErrorClonado);
      expect(error).toMatchObject({ code: "clave_no_encontrada", status: 409 });
    } finally {
      if (original === undefined) delete process.env.TELO_CLAVE_CIFRADO;
      else process.env.TELO_CLAVE_CIFRADO = original;
    }
  });
});
