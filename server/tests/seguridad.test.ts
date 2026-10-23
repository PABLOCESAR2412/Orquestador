import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base y carpetas temporales: nunca se toca server/data. Se fijan antes de importar los módulos.
// Una raíz por ejecución, compartida por todos los archivos (ver proyectos.test.ts).
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { redactar, archivosConSecretos } = await import("../src/redaccion");
const { esVariableReservada, nombreSecretoValido } = await import("../src/secretos");
const { sesionValida } = await import("../src/runners/opencode");
const { gitSeguro, prepararRepoSeguro, sanearConfiguracionRepo, tieneGitReal } = await import("../src/git");
const { ArchivoError, leerArchivo } = await import("../src/archivos-proyecto");
const { ejecutarVencidas, ultimaTareaActiva } = await import("../src/programadas");
const { db } = await import("../src/db");
const { crearConexionMcp, borrarConexionMcp } = await import("../src/conexiones-mcp");
const { guardarClaveProveedor, borrarClaveProveedor } = await import("../src/claves-proveedor");

describe("redacción de salida", () => {
  test("oculta valores de al menos 6 caracteres y deja los más cortos", () => {
    expect(redactar("clave=ABCDEFGH", ["ABCDEFGH"])).toBe("clave=***");
    expect(redactar("x=abc", ["abc"])).toBe("x=abc");
  });

  test("sigue ocultando el secreto OAuth antiguo si continúa en el entorno", () => {
    const anterior = process.env.TELO_GOOGLE_CLIENT_SECRET;
    const secreto = `cliente-${"x".repeat(24)}`;
    process.env.TELO_GOOGLE_CLIENT_SECRET = secreto;
    try {
      expect(redactar(`valor=${secreto}`)).toBe("valor=***");
    } finally {
      if (anterior === undefined) delete process.env.TELO_GOOGLE_CLIENT_SECRET;
      else process.env.TELO_GOOGLE_CLIENT_SECRET = anterior;
    }
  });

  test("oculta credenciales con formato conocido", () => {
    expect(redactar("token ghp_" + "a".repeat(36) + " fin")).toBe("token *** fin");
    // Clave falsa armada en tiempo de ejecución: el archivo no contiene la forma completa.
    expect(redactar("AKIA" + "Z".repeat(16))).toBe("***");
    expect(redactar("sk-" + "b".repeat(30))).toBe("***");
    expect(redactar("AIza" + "c".repeat(35))).toBe("***");
    expect(redactar("github_pat_" + "d".repeat(40))).toBe("***");
    expect(redactar("sk-ant-api03-" + "e".repeat(40))).toBe("***");
  });

  test("no redacta nombres de clases CSS que contienen sk-", () => {
    const texto = ".ask-user-question-panel-header .task-manager-running-state-value";
    expect(redactar(texto)).toBe(texto);
  });

  test("oculta bloques de clave privada completos", () => {
    const pem = "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nMIIabc\n-----END " + "OPENSSH PRIVATE KEY-----";
    expect(redactar(pem)).toBe("[clave privada oculta]");
  });
});

describe("escaneo antes de commit", () => {
  test("encuentra valores y credenciales en líneas añadidas y devuelve solo nombres de archivo", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-const x = 'viejo';",
      "+const token = 'SUPERSECRETO-123';",
      "diff --git a/notas.md b/notas.md",
      "+sin nada raro",
      "diff --git a/config.txt b/config.txt",
      "+clave ghp_" + "e".repeat(36),
    ].join("\n");
    const hallados = archivosConSecretos(diff, ["SUPERSECRETO-123"]);
    expect(hallados).toEqual(["src/app.ts", "config.txt"]);
    expect(hallados.join(" ")).not.toContain("SUPERSECRETO");
  });

  test("ignora líneas quitadas y de contexto", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "-ghp_" + "f".repeat(36),
      " contexto ghp_" + "g".repeat(36),
    ].join("\n");
    expect(archivosConSecretos(diff, [])).toEqual([]);
  });

  test("no bloquea archivos por nombres de clases CSS que contienen sk-", () => {
    const diff = [
      "diff --git a/src/app.css b/src/app.css",
      "+.ask-user-question-panel-header { color: inherit; }",
      "+.task-manager-running-state-value { display: block; }",
    ].join("\n");
    expect(archivosConSecretos(diff, [])).toEqual([]);
  });

  test("los tokens MCP guardados quedan fuera de la redacción y del escaneo", () => {
    const anterior = process.env.TELO_CLAVE_CIFRADO;
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    let creada: string | null = null;
    try {
      const token = "mcp-" + "s".repeat(30);
      const conexion = crearConexionMcp("Auditoría MCP", "https://mcp.ejemplo.test/mcp", token);
      expect(conexion).not.toBeNull();
      creada = conexion!.id;
      expect(redactar(`autoriza ${token} ya`)).toBe("autoriza *** ya");
      const diff = [
        "diff --git a/mcp.env b/mcp.env",
        "--- a/mcp.env",
        "+++ b/mcp.env",
        "+MCP_TOKEN=" + token,
      ].join("\n");
      // El valor ajeno no delata nada; el token MCP guardado sí, aunque el proyecto no lo declare.
      expect(archivosConSecretos(diff, ["valor-ajeno-123456"])).toEqual(["mcp.env"]);
    } finally {
      if (creada) borrarConexionMcp(creada);
      if (anterior === undefined) delete process.env.TELO_CLAVE_CIFRADO;
      else process.env.TELO_CLAVE_CIFRADO = anterior;
    }
  });

  test("las claves de proveedor guardadas entran al filtro aunque el proyecto no las declare", () => {
    const anterior = process.env.TELO_CLAVE_CIFRADO;
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    try {
      const clave = "llaveproveedor9012345678";
      expect(guardarClaveProveedor("nvidia", clave)).toBeTruthy();
      expect(redactar(`usa ${clave} al hablar`)).toBe("usa *** al hablar");
      const diff = [
        "diff --git a/config.json b/config.json",
        "--- a/config.json",
        "+++ b/config.json",
        '+{"token": "' + clave + '"}',
      ].join("\n");
      expect(archivosConSecretos(diff, [])).toEqual(["config.json"]);
    } finally {
      borrarClaveProveedor("nvidia");
      if (anterior === undefined) delete process.env.TELO_CLAVE_CIFRADO;
      else process.env.TELO_CLAVE_CIFRADO = anterior;
    }
  });
});

describe("variables reservadas", () => {
  test("nombres de sistema, de Telo y de bibliotecas no se aceptan como secretos", () => {
    const malos = [
      "TERM", "LANG", "TZ", "TMPDIR", "SSL_CERT_FILE", "HTTPS_PROXY", "NO_PROXY",
      "LC_ALL", "OPENCODE_CONFIG", "XDG_CONFIG_HOME", "LOCPATH", "NODE_EXTRA_CA_CERTS",
    ];
    for (const malo of malos) expect(nombreSecretoValido(malo)).toBe(false);
  });

  test("GITHUB_TOKEN sigue siendo un nombre válido: solo se excluye del entorno del agente", () => {
    expect(nombreSecretoValido("GITHUB_TOKEN")).toBe(true);
    expect(esVariableReservada("GITHUB_TOKEN")).toBe(false);
  });
});

describe("id de sesión de OpenCode", () => {
  test("acepta ids con formato válido y rechaza los que podrían leerse como opción", () => {
    expect(sesionValida("ses_2f8a9B0c")).toBe(true);
    for (const malo of ["", "-x", "--help", "a b", "../x", "a;rm", "x".repeat(129), null, 7]) {
      expect(sesionValida(malo)).toBe(false);
    }
  });
});

describe("repos que el agente pudo escribir", () => {
  const REPO = join(RAIZ_PRUEBAS, "seguridad-git");

  test.skipIf(process.platform === "win32")("prepararRepoSeguro quita filtros, fsmonitor y config.worktree", async () => {
    rmSync(REPO, { recursive: true, force: true });
    mkdirSync(REPO, { recursive: true });
    Bun.spawnSync(["git", "init", "-q", "-b", "main", REPO]);
    writeFileSync(join(REPO, ".git", "config.worktree"), '[filter "x"]\n\tclean = echo\n');
    Bun.spawnSync(["git", "-C", REPO, "config", "filter.x.clean", "cat"]);
    Bun.spawnSync(["git", "-C", REPO, "config", "core.fsmonitor", "/bin/false"]);

    expect(await prepararRepoSeguro(REPO)).toBe(true);
    const lista = Bun.spawnSync(["git", "-C", REPO, "config", "--local", "--list"]).stdout.toString();
    expect(lista).not.toContain("filter.x.clean");
    expect(lista).not.toContain("core.fsmonitor");
    expect(existsSync(join(REPO, ".git", "config.worktree"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("gitSeguro no ejecuta el filtro que el agente dejó en .git/config (git sin sanear sí lo ejecuta)", async () => {
    const R = join(RAIZ_PRUEBAS, "seguridad-filtro");
    rmSync(R, { recursive: true, force: true });
    mkdirSync(R, { recursive: true });
    const marca = join(R, "marca.txt");
    Bun.spawnSync(["git", "init", "-q", "-b", "main", R]);
    writeFileSync(join(R, "a.txt"), "hola");
    writeFileSync(join(R, ".gitattributes"), "*.txt filter=x\n");
    Bun.spawnSync(["git", "-C", R, "add", "."]);
    Bun.spawnSync(["git", "-C", R, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"]);
    // El agente escribe el filtro y cambia el archivo sin cambiar su tamaño, para forzar que Git lo procese.
    Bun.spawnSync(["git", "-C", R, "config", "filter.x.clean", `sh -c 'echo EJECUTADO > ${marca}; cat'`]);
    writeFileSync(join(R, "a.txt"), "HOLA");

    // Control: git sin sanear ejecuta el filtro.
    Bun.spawnSync(["git", "-C", R, "status", "--porcelain"]);
    expect(existsSync(marca)).toBe(true);
    rmSync(marca);

    // Con gitSeguro, el filtro se quita antes y no se ejecuta.
    writeFileSync(join(R, "a.txt"), "hOLa");
    const r = await gitSeguro(["status", "--porcelain"], { cwd: R });
    expect(r.stdout).toContain("a.txt");
    expect(existsSync(marca)).toBe(false);
  });

  test.skipIf(process.platform === "win32")("un .git que es archivo o enlace no cuenta como repo propio", () => {
    const carpeta = join(RAIZ_PRUEBAS, "git-archivo");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, ".git"), "gitdir: /otro/lugar\n");
    expect(tieneGitReal(carpeta)).toBe(false);
  });

  test("sanear una carpeta que no es repo no toca un repo ajeno", async () => {
    const carpeta = join(RAIZ_PRUEBAS, "sin-repo");
    mkdirSync(carpeta, { recursive: true });
    expect(await sanearConfiguracionRepo(carpeta)).toEqual([]);
  });
});

describe("archivos del proyecto", () => {
  const PROYECTO = join(RAIZ_PRUEBAS, "seguridad-proyecto");
  mkdirSync(join(PROYECTO, ".git"), { recursive: true });
  writeFileSync(join(PROYECTO, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/a/b\n');
  writeFileSync(join(PROYECTO, "ok.txt"), "hola");
  writeFileSync(join(PROYECTO, "tras-8k.dat"), Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])]));

  function codigoDe(fn: () => unknown): string | null {
    try {
      fn();
      return null;
    } catch (err) {
      return err instanceof ArchivoError ? err.code : `otro:${String(err)}`;
    }
  }

  test("un enlace dentro del proyecto que apunta a .git no se lee", () => {
    symlinkSync(join(PROYECTO, ".git", "config"), join(PROYECTO, "enlace-config"));
    expect(codigoDe(() => leerArchivo(PROYECTO, ["enlace-config"]))).toBe("invalid_project_path");
  });

  test("un NUL más allá de los primeros 8 KB también cuenta como binario", () => {
    expect(codigoDe(() => leerArchivo(PROYECTO, ["tras-8k.dat"]))).toBe("archivo_binario");
  });

  test("un archivo de texto normal sigue leyéndose", () => {
    expect(leerArchivo(PROYECTO, ["ok.txt"]).texto).toBe("hola");
  });
});

describe("planificador: sin solapes y sin ráfagas", () => {
  afterAll(() => {
    db.query("DELETE FROM programadas WHERE id LIKE 'seg-%'").run();
    db.query("DELETE FROM tasks WHERE id LIKE 'seg-%'").run();
  });

  const insertarProgramada = (id: string, proxima: string, ultimaTarea: string | null) =>
    db
      .query(
        `INSERT INTO programadas (id, titulo, prompt, model, effort, project_id, frecuencia, cada_horas, hora, activa, proxima_en, ultima_tarea_id)
         VALUES (?, ?, ?, 'opencode/big-pickle', NULL, NULL, 'cada_horas', 1, NULL, 1, ?, ?)`,
      )
      .run(id, `Titulo ${id}`, `Prompt ${id}`, proxima, ultimaTarea);

  test("no lanza otra tarea mientras la anterior sigue en cola", () => {
    db.query("INSERT INTO tasks (id, title, prompt, model, status) VALUES ('seg-tarea-cola', 't', 'p', 'm', 'queued')").run();
    insertarProgramada("seg-solapa", "1999-01-01T00:00:00.000Z", "seg-tarea-cola");
    expect(ultimaTareaActiva("seg-solapa")).toBe(true);

    const prompts: string[] = [];
    ejecutarVencidas(new Date("2026-10-11T12:00:00.000Z"), ((o: { prompt: string }) => {
      prompts.push(o.prompt);
      return "x";
    }) as never);
    expect(prompts).not.toContain("Prompt seg-solapa");
  });

  test("no vuelve a lanzar mientras la última espera análisis, aprobación o reanudación", () => {
    for (const estado of ["analyzing", "waiting_approval", "interrupted", "sin_cuota"] as const) {
      const tarea = `seg-tarea-${estado}`;
      const programada = `seg-solapa-${estado}`;
      db.query("INSERT INTO tasks (id, title, prompt, model, status) VALUES (?, 't', 'p', 'm', ?)").run(tarea, estado);
      insertarProgramada(programada, "1999-01-01T00:00:00.000Z", tarea);
      expect(ultimaTareaActiva(programada)).toBe(true);
    }
  });

  test("como mucho 3 tareas por revisión: el resto sigue vencida para la siguiente", () => {
    for (let i = 1; i <= 5; i++) insertarProgramada(`seg-cap-${i}`, `1999-02-0${i}T00:00:00.000Z`, null);
    const creadas: string[] = [];
    ejecutarVencidas(new Date("2026-10-11T12:00:00.000Z"), ((o: { prompt: string }) => {
      creadas.push(o.prompt);
      return `seg-t-${creadas.length}`;
    }) as never);
    expect(creadas.length).toBe(3);

    const pendientes = db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM programadas WHERE id LIKE 'seg-cap-%' AND proxima_en <= '2026-10-11T12:00:00.000Z'",
      )
      .get()!.n;
    expect(pendientes).toBe(2);
  });
});
