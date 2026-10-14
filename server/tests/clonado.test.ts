import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

const { codigoDeErrorClon, urlGithubNormalizada, clonarRepositorio, verificarRepositorio, visibilidadDe, ErrorClonado } =
  await import("../src/clonado");
const { iniciarClonadoEnChat, itemDeComando, textoDeError, textoDeExito } = await import("../src/clonado-chat");
const { projects } = await import("../src/routes/projects");
const { db } = await import("../src/db");

const CLAVE_VALIDA = randomBytes(32).toString("base64");
// Error lanzado por fn, o undefined si no lanza.
function capturar(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

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
    expect(codigoDeErrorClon("fatal: unable to access: Could not resolve host: github.com")).toBe("sin_red_github");
  });

  test("público o privado se decide por lo que GitHub responde sin credenciales", () => {
    expect(visibilidadDe(0, "abc\trefs/heads/main")).toBe("publico");
    expect(visibilidadDe(128, "fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe(
      "privado",
    );
    expect(visibilidadDe(128, "fatal: Authentication failed for 'https://github.com/a/b/'")).toBe("privado");
    expect(visibilidadDe(128, "fatal: unable to access: Could not resolve host: github.com")).toBeNull();
  });

  test("lo desconocido cae en un código genérico y el error de 'comando no encontrado' no se confunde", () => {
    expect(codigoDeErrorClon("algo inesperado")).toBe("clonado_fallo");
    expect(codigoDeErrorClon("sh: ssh: not found")).toBe("clonado_fallo");
  });
});

describe("rutas de clonado", () => {
  test("crear desde una URL que no es de GitHub se rechaza antes de crear nada", async () => {
    const res = await projects.request("/projects", json({ name: "Ajena", url: "https://example.com/a/b" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_github_url" });
  });

  test("crear desde GitHub deja una carpeta vacía con el origen, sin pedir la clave de cifrado", async () => {
    const original = process.env.TELO_CLAVE_CIFRADO;
    delete process.env.TELO_CLAVE_CIFRADO;
    try {
      const res = await projects.request(
        "/projects",
        json({ name: "Repo Sin Clave", url: "git@github.com:acme/repo-sin-clave.git" }),
      );
      expect(res.status).toBe(201);
      const proyecto = (await res.json()) as { id: string; origen_url: string; clonado_en: string | null };
      expect(proyecto.origen_url).toBe("https://github.com/acme/repo-sin-clave");
      expect(proyecto.clonado_en).toBeNull();
      expect(existsSync(join(RAIZ_PRUEBAS, "proyectos", "repo-sin-clave"))).toBe(true);
      expect(readdirSync(join(RAIZ_PRUEBAS, "proyectos", "repo-sin-clave"))).toEqual([]);
      expect(db.query("SELECT 1 FROM project_ssh_keys WHERE project_id = ?").get(proyecto.id)).toBeNull();
    } finally {
      if (original === undefined) delete process.env.TELO_CLAVE_CIFRADO;
      else process.env.TELO_CLAVE_CIFRADO = original;
    }
  });

  test("sin nombre, el proyecto toma el nombre del repo; una carpeta repetida se rechaza", async () => {
    const res = await projects.request("/projects", json({ url: "https://github.com/acme/nombre-del-repo" }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { name: string }).name).toBe("nombre-del-repo");

    const repetido = await projects.request("/projects", json({ url: "https://github.com/acme/nombre-del-repo" }));
    expect(repetido.status).toBe(409);
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
    expect(await noExiste.json()).toEqual({ error: "project_not_found" });
  });

  test("verificar una URL que no es de GitHub responde antes de tocar la red", async () => {
    await expect(verificarRepositorio("https://example.com/a/b")).rejects.toMatchObject({
      code: "invalid_github_url",
      status: 400,
    });
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

  test("el clonado en el chat no arranca si la carpeta del proyecto ya tiene archivos", () => {
    const carpeta = join(RAIZ_PRUEBAS, "proyectos", "con-archivos");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, "notas.txt"), "ya estaba aquí");
    db.query("INSERT INTO projects (id, name, repo_path, origen_url) VALUES (?, ?, ?, ?)").run(
      "proy-con-archivos",
      "Con archivos",
      carpeta,
      "https://github.com/acme/con-archivos",
    );
    const error = capturar(() => iniciarClonadoEnChat("proy-con-archivos"));
    expect(error).toBeInstanceOf(ErrorClonado);
    expect(error).toMatchObject({ code: "carpeta_no_vacia", status: 409 });
    // Nada se escribió en el chat: ni el mensaje ni la conversación.
    expect(db.query("SELECT 1 FROM conversations WHERE project_id = ?").get("proy-con-archivos")).toBeNull();
  });

  test("el clonado en el chat no repite un proyecto ya clonado ni uno que no existe", () => {
    expect(capturar(() => iniciarClonadoEnChat("no-existe"))).toMatchObject({ code: "project_not_found", status: 404 });
    db.query("INSERT INTO projects (id, name, repo_path, origen_url, clonado_en) VALUES (?, ?, ?, ?, datetime('now'))").run(
      "proy-ya-clonado",
      "Ya clonado",
      join(RAIZ_PRUEBAS, "proyectos", "ya-clonado"),
      "https://github.com/acme/ya-clonado",
    );
    expect(capturar(() => iniciarClonadoEnChat("proy-ya-clonado"))).toMatchObject({
      code: "project_ya_clonado",
      status: 409,
    });
  });
});
