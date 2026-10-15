import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base y carpeta de proyectos temporales: nunca se toca server/data. Se fijan antes de importar.
// Una raíz por ejecución, compartida por todos los archivos: config y base se cargan una vez por
// proceso. La primera prueba limpia los restos de la ejecución anterior.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { slugProyecto, projects } = await import("../src/routes/projects");
const { normalizarRuta, resolverEnProyecto, leerArchivo, listarCarpeta, medirCarpeta, ArchivoError } = await import(
  "../src/archivos-proyecto"
);

// Código de error de ArchivoError, o null si la función no lanza.
function codigoDe(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ArchivoError ? err.code : `otro:${String(err)}`;
  }
}

describe("slug del proyecto", () => {
  test("quita acentos, pasa a minúsculas y separa con guiones", () => {
    expect(slugProyecto("Mi Proyecto Ñandú!")).toBe("mi-proyecto-nandu");
    expect(slugProyecto("Proyecto 2026")).toBe("proyecto-2026");
  });

  test("no deja guiones al inicio ni al final", () => {
    expect(slugProyecto("  --Hola__Mundo--  ")).toBe("hola-mundo");
  });

  test("vacío si no queda ningún carácter válido", () => {
    expect(slugProyecto("🚀🚀")).toBe("");
  });

  test("máximo 60 caracteres", () => {
    expect(slugProyecto("a".repeat(100)).length).toBe(60);
  });
});

describe("normalizarRuta", () => {
  test("acepta rutas relativas y limpia separadores", () => {
    expect(normalizarRuta("")).toEqual([]);
    expect(normalizarRuta("a/b/")).toEqual(["a", "b"]);
    expect(normalizarRuta("./a/./b")).toEqual(["a", "b"]);
  });

  test("rechaza traversal, absolutas, NUL y .git en cualquier mayúscula", () => {
    for (const mala of ["../x", "a/../b", "/etc/passwd", "\\x", "C:/x", "a\0b", "a/.git/config", "a/.GIT", ".git"]) {
      expect(codigoDe(() => normalizarRuta(mala))).toBe("invalid_project_path");
    }
  });
});

// Proyecto de prueba con archivos normales, binarios, un .git, un enlace hacia fuera y uno hacia dentro.
const PROYECTO = join(RAIZ_PRUEBAS, "archivos-proyecto");
const FUERA = join(RAIZ_PRUEBAS, "fuera-del-proyecto.txt");
mkdirSync(join(PROYECTO, "sub"), { recursive: true });
mkdirSync(join(PROYECTO, ".git"), { recursive: true });
writeFileSync(join(PROYECTO, "a.txt"), "hola");
writeFileSync(join(PROYECTO, "sub", "b.md"), "texto");
writeFileSync(join(PROYECTO, ".git", "config"), "secreto de git");
writeFileSync(join(PROYECTO, "binario.bin"), Buffer.from([0x61, 0x00, 0x62]));
writeFileSync(join(PROYECTO, "invalido.txt"), Buffer.from([0xff, 0xfe, 0x41]));
writeFileSync(join(PROYECTO, "grande.txt"), "a".repeat(300 * 1024));
writeFileSync(FUERA, "fuera");
symlinkSync(FUERA, join(PROYECTO, "fuera"));
symlinkSync(join(PROYECTO, "sub"), join(PROYECTO, "dentro-link"));

describe("archivos del proyecto", () => {
  test("un enlace que sale de la raíz se rechaza", () => {
    expect(codigoDe(() => resolverEnProyecto(PROYECTO, ["fuera"]))).toBe("project_path_outside_root");
    expect(codigoDe(() => leerArchivo(PROYECTO, ["fuera"]))).toBe("project_path_outside_root");
  });

  test("lee un archivo de texto", () => {
    const r = leerArchivo(PROYECTO, ["a.txt"]);
    expect(r.texto).toBe("hola");
    expect(r.truncado).toBe(false);
    expect(r.tamano).toBe(4);
  });

  test("un archivo binario o no UTF-8 da archivo_binario", () => {
    expect(codigoDe(() => leerArchivo(PROYECTO, ["binario.bin"]))).toBe("archivo_binario");
    expect(codigoDe(() => leerArchivo(PROYECTO, ["invalido.txt"]))).toBe("archivo_binario");
  });

  test("un archivo de más de 256 KB se trunca", () => {
    const r = leerArchivo(PROYECTO, ["grande.txt"]);
    expect(r.truncado).toBe(true);
    expect(r.texto.length).toBe(256 * 1024);
    expect(r.tamano).toBe(300 * 1024);
  });

  test("al truncar, un carácter de varios bytes cortado al final no hace fallar la lectura", () => {
    // "€" ocupa 3 bytes; 256 KB no es múltiplo de 3, así que el corte parte un carácter.
    writeFileSync(join(PROYECTO, "euros.txt"), "€".repeat(100_000));
    const r = leerArchivo(PROYECTO, ["euros.txt"]);
    expect(r.truncado).toBe(true);
    expect(r.texto).toBe("€".repeat(Math.floor((256 * 1024) / 3)));
  });

  test("el listado oculta .git y pone las carpetas primero", () => {
    const entradas = listarCarpeta(PROYECTO, []);
    const nombres = entradas.map((e) => e.nombre);
    expect(nombres).not.toContain(".git");
    expect(entradas[0].tipo).toBe("carpeta");
    expect(nombres.indexOf("sub")).toBeLessThan(nombres.indexOf("a.txt"));
    expect(entradas.find((e) => e.nombre === "dentro-link")?.tipo).toBe("carpeta");
    const fuera = entradas.find((e) => e.nombre === "fuera");
    expect(fuera?.tipo).toBe("archivo");
    expect(fuera?.tamano).toBeNull();
  });

  test("no se puede leer .git aunque se pida directamente", () => {
    expect(codigoDe(() => normalizarRuta(".git/config"))).toBe("invalid_project_path");
  });

  test("un FIFO no se lee (bloquearía la petición)", () => {
    Bun.spawnSync(["mkfifo", join(PROYECTO, "tuberia")]);
    expect(codigoDe(() => leerArchivo(PROYECTO, ["tuberia"]))).toBe("project_path_not_file");
  });

  test("carpeta y archivo: errores de tipo y de ruta inexistente", () => {
    expect(codigoDe(() => leerArchivo(PROYECTO, ["sub"]))).toBe("project_path_not_file");
    expect(codigoDe(() => listarCarpeta(PROYECTO, ["a.txt"]))).toBe("project_path_not_directory");
    expect(codigoDe(() => leerArchivo(PROYECTO, ["no-existe.txt"]))).toBe("project_path_not_found");
  });

  test("medirCarpeta suma bytes y archivos sin seguir enlaces", async () => {
    const medida = await medirCarpeta(PROYECTO);
    expect(medida.archivos).toBeGreaterThan(3);
    expect(medida.bytes).toBeGreaterThan(300 * 1024);
  });
});

// Rutas HTTP del módulo de proyectos, con Git real.
describe("API de proyectos", () => {
  const json = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  let id = "";

  test("crea la carpeta con git init, README y commit inicial", async () => {
    const res = await projects.request("/projects", json({ name: "Prueba Creación" }));
    expect(res.status).toBe(201);
    const p = (await res.json()) as { id: string; repo_path: string; carpeta: string; name: string; instrucciones: null };
    id = p.id;
    expect(p.repo_path).toBe("prueba-creacion");
    expect(p.carpeta).toBe("prueba-creacion");
    expect(p.name).toBe("Prueba Creación");
    expect(p.instrucciones).toBeNull();

    const carpeta = join(process.env.TELO_PROYECTOS_DIR!, "prueba-creacion");
    expect(await Bun.file(join(carpeta, "README.md")).text()).toBe("# Prueba Creación\n");
    const log = Bun.spawnSync(["git", "log", "--format=%s"], { cwd: carpeta });
    expect(log.stdout.toString().trim()).toBe("Proyecto creado");
  });

  test("una carpeta que ya existe da 409", async () => {
    const res = await projects.request("/projects", json({ name: "Prueba Creación" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_folder_exists" });
  });

  test("un nombre sin caracteres válidos da 400", async () => {
    const res = await projects.request("/projects", json({ name: "🚀" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_project_name" });
  });

  test("un cuerpo que no es un objeto JSON da 400 invalid_body", async () => {
    const res = await projects.request("/projects", json("[1,2"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  test("el detalle trae Git y tamaño, y no muestra rutas absolutas", async () => {
    const res = await projects.request(`/projects/${id}`);
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain(RAIZ_PRUEBAS);
    const d = JSON.parse(texto) as {
      git: { rama: string; commits: number; sucio: boolean; ultimo_commit: { asunto: string } };
      tamano_bytes: number;
      chats: number;
      tareas: { total: number };
      ultima_tarea: null;
    };
    expect(d.git.rama).toBe("main");
    expect(d.git.commits).toBe(1);
    expect(d.git.sucio).toBe(false);
    expect(d.git.ultimo_commit.asunto).toBe("Proyecto creado");
    expect(d.tamano_bytes).toBeGreaterThan(0);
    expect(d.chats).toBe(0);
    expect(d.tareas.total).toBe(0);
    expect(d.ultima_tarea).toBeNull();
  });

  test("instrucciones: más de 8000 caracteres da 400; \"\" la borra", async () => {
    const mal = await projects.request(`/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instrucciones: "x".repeat(8001) }),
    });
    expect(mal.status).toBe(400);
    expect(await mal.json()).toEqual({ error: "invalid_instrucciones" });

    const ok = await projects.request(`/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instrucciones: "Usa español" }),
    });
    expect((await ok.json() as { instrucciones: string }).instrucciones).toBe("Usa español");

    const borrada = await projects.request(`/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instrucciones: "" }),
    });
    expect((await borrada.json() as { instrucciones: string | null }).instrucciones).toBeNull();
  });

  test("archivos: el listado y la lectura usan la raíz del proyecto", async () => {
    const lista = await projects.request(`/projects/${id}/archivos`);
    expect(lista.status).toBe(200);
    const entradas = (await lista.json() as { entradas: { nombre: string }[] }).entradas;
    expect(entradas.map((e) => e.nombre)).toContain("README.md");

    const trampa = await projects.request(`/projects/${id}/archivos?ruta=${encodeURIComponent("../etc")}`);
    expect(trampa.status).toBe(400);
    expect(await trampa.json()).toEqual({ error: "invalid_project_path" });

    const leido = await projects.request(`/projects/${id}/archivo?ruta=README.md`);
    expect(await leido.json()).toMatchObject({ ruta: "README.md", texto: "# Prueba Creación\n", truncado: false });
  });

  test("proyecto inexistente da 404", async () => {
    const res = await projects.request("/projects/no-existe/archivos");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });
});

describe("métricas de la lista de proyectos", () => {
  test("cuenta chats y tareas, y toma la última actividad del mensaje o de la tarea más reciente", async () => {
    const { db } = await import("../src/db");
    const proyecto = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Con actividad', ?)").run(
      proyecto,
      join(process.env.TELO_PROYECTOS_DIR!, "con-actividad"),
    );
    const chat = crypto.randomUUID();
    db.query("INSERT INTO conversations (id, title, project_id) VALUES (?, 'Chat del proyecto', ?)").run(chat, proyecto);
    db.query("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', 'hola', '2026-10-05 10:00:00')").run(
      crypto.randomUUID(),
      chat,
    );
    db.query(
      "INSERT INTO tasks (id, title, prompt, model, status, project_id, created_at) VALUES (?, 'Tarea', 'hacer algo', 'opencode/x', 'done', ?, '2026-10-09 08:00:00')",
    ).run(crypto.randomUUID(), proyecto);

    const lista = (await (await projects.request("/projects")).json()) as {
      id: string;
      chats: number;
      tareas: number;
      ultima_actividad: string | null;
    }[];
    expect(lista.find((p) => p.id === proyecto)).toMatchObject({
      chats: 1,
      tareas: 1,
      ultima_actividad: "2026-10-09 08:00:00",
    });
  });

  test("un proyecto sin chats ni tareas tiene ceros y actividad nula", async () => {
    const { db } = await import("../src/db");
    const vacio = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Vacío', ?)").run(
      vacio,
      join(process.env.TELO_PROYECTOS_DIR!, "vacio"),
    );
    const lista = (await (await projects.request("/projects")).json()) as {
      id: string;
      chats: number;
      tareas: number;
      ultima_actividad: string | null;
    }[];
    expect(lista.find((p) => p.id === vacio)).toMatchObject({ chats: 0, tareas: 0, ultima_actividad: null });
  });
});

describe("memoria editada a mano", () => {
  const json = (cuerpo: unknown) => ({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

  async function proyectoNuevo(): Promise<string> {
    const { db } = await import("../src/db");
    const id = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Memoria', ?)").run(
      id,
      join(process.env.TELO_PROYECTOS_DIR!, `memoria-${id.slice(0, 8)}`),
    );
    return id;
  }

  test("un proyecto que no existe responde 404", async () => {
    const res = await projects.request("/projects/no-existe/memoria", json({ texto: "algo" }));
    expect(res.status).toBe(404);
  });

  test("guarda el texto y lo oculta en las credenciales que contenga", async () => {
    const id = await proyectoNuevo();
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const res = await projects.request(`/projects/${id}/memoria`, json({ texto: `Usar el repo. Token: ${token}` }));
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { texto: string; actualizada_en: string };
    expect(cuerpo.texto).toContain("Usar el repo.");
    expect(cuerpo.texto).not.toContain(token);
    expect(cuerpo.actualizada_en).not.toBeNull();
  });

  test("un texto vacío borra la memoria", async () => {
    const id = await proyectoNuevo();
    await projects.request(`/projects/${id}/memoria`, json({ texto: "algo que recordar" }));
    const res = await projects.request(`/projects/${id}/memoria`, json({ texto: "   " }));
    expect(await res.json()).toEqual({ texto: null, actualizada_en: null });
  });

  test("más de 4 000 caracteres se rechaza con un código claro", async () => {
    const id = await proyectoNuevo();
    const res = await projects.request(`/projects/${id}/memoria`, json({ texto: "x".repeat(4_001) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "memoria_demasiado_larga" });
  });

  test("un cuerpo sin texto se rechaza", async () => {
    const id = await proyectoNuevo();
    const res = await projects.request(`/projects/${id}/memoria`, json({ otra: 1 }));
    expect(res.status).toBe(400);
  });
});
