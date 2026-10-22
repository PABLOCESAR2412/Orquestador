import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// Base temporal: nunca se toca server/data. Misma convención que secretos.test.ts: una raíz por
// ejecución, compartida por todos los archivos de prueba.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { ErrorClaveSsh, HOST_GITHUB_ED25519, borrarClaveProyecto, clavePublicaDe, conClaveSsh, generarClaveProyecto, huellaDe, urlSshDeGithub } =
  await import("../src/clave-ssh");
const { claveSshRoute } = await import("../src/routes/clave-ssh");
const { config } = await import("../src/config");
const { db } = await import("../src/db");

const CLAVE_VALIDA = randomBytes(32).toString("base64");
const CLAVE_ORIGINAL = process.env.TELO_CLAVE_CIFRADO;
// OpenSSH de Windows difiere de la POSIX en lo que estos ejercicios verifican (comandos
// envueltos en shell y validación de rutas); la función se comprueba en el VM con Linux.
const SSH_KEYGEN = Bun.which("ssh-keygen") !== null && process.platform !== "win32";

afterEach(() => {
  if (CLAVE_ORIGINAL === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = CLAVE_ORIGINAL;
});

// Proyecto registrado con su carpeta, como lo deja el alta de proyectos.
function proyectoDePrueba(id: string): string {
  const carpeta = join(RAIZ_PRUEBAS, "proyectos", id);
  mkdirSync(carpeta, { recursive: true });
  db.query("INSERT OR IGNORE INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run(id, id, carpeta);
  return id;
}

// Extrae la ruta de la clave privada del GIT_SSH_COMMAND que recibe fn.
function rutaClaveDe(entorno: Record<string, string>): string {
  const m = /-i '([^']+)'/.exec(entorno.GIT_SSH_COMMAND ?? "");
  if (!m) throw new Error("GIT_SSH_COMMAND sin -i");
  return m[1];
}

describe("URL de GitHub por SSH", () => {
  test("convierte la URL normalizada de GitHub y rechaza cualquier otro destino", () => {
    expect(urlSshDeGithub("https://github.com/dueno/repo")).toBe("git@github.com:dueno/repo.git");
    expect(urlSshDeGithub("https://gitlab.com/dueno/repo")).toBeNull();
    expect(urlSshDeGithub("https://github.com/dueno/repo/extra")).toBeNull();
    expect(urlSshDeGithub("git@github.com:dueno/repo.git")).toBeNull();
    expect(urlSshDeGithub("https://github.com/dueno/repo;rm -rf /")).toBeNull();
  });
});

describe("clave de host de GitHub fijada", () => {
  test("su huella es la que publica GitHub", () => {
    expect(HOST_GITHUB_ED25519.startsWith("github.com ssh-ed25519 ")).toBe(true);
    // Quita el host de la línea de known_hosts: huellaDe espera "tipo clave" (igual que una clave pública).
    expect(huellaDe(HOST_GITHUB_ED25519.replace(/^\S+ /, ""))).toBe("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU");
  });
});

describe("generar, usar y borrar la clave de un proyecto", () => {
  test.skipIf(!SSH_KEYGEN)("genera un par ed25519 cuya huella coincide con ssh-keygen y guarda la privada cifrada", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-generar");
    borrarClaveProyecto(id);

    const creada = await generarClaveProyecto(id);
    expect(creada.publica.startsWith("ssh-ed25519 ")).toBe(true);
    expect(creada.huella.startsWith("SHA256:")).toBe(true);

    // La huella que Telo guarda es la que calcula ssh-keygen sobre la misma clave pública.
    const pub = Bun.spawnSync(["sh", "-c", `printf '%s\n' '${creada.publica}' > ${join(RAIZ_PRUEBAS, "pub-check.pub")} && ssh-keygen -lf ${join(RAIZ_PRUEBAS, "pub-check.pub")}`]);
    expect(pub.stdout.toString()).toContain(creada.huella);

    // La fila no contiene la clave privada en claro.
    const fila = db.query<{ value_enc: string }, [string]>("SELECT value_enc FROM project_ssh_keys WHERE project_id = ?").get(id);
    expect(fila?.value_enc ?? "").not.toContain("PRIVATE KEY");
    expect(JSON.stringify(db.query("SELECT * FROM project_ssh_keys WHERE project_id = ?").get(id))).not.toContain("PRIVATE KEY");

    borrarClaveProyecto(id);
  });

  test.skipIf(!SSH_KEYGEN)("conClaveSsh entrega una clave 0600, usable por ssh, y la borra al terminar", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-usar");
    borrarClaveProyecto(id);
    const creada = await generarClaveProyecto(id);

    let ruta = "";
    await conClaveSsh(id, async (entorno) => {
      ruta = rutaClaveDe(entorno);
      // Dentro de DATA_DIR, que el aislamiento de los agentes oculta; nunca en /tmp.
      expect(ruta.startsWith(config.dataDir + "/")).toBe(true);
      expect(ruta.startsWith(join(tmpdir(), "telo-ssh-"))).toBe(false);
      expect(statSync(ruta).mode & 0o777).toBe(0o600);
      // La clave que Git recibe corresponde a la pública guardada.
      const extraida = Bun.spawnSync(["ssh-keygen", "-y", "-f", ruta]).stdout.toString().trim();
      expect(extraida.split(" ").slice(0, 2).join(" ")).toBe(creada.publica.split(" ").slice(0, 2).join(" "));
    });
    expect(existsSync(ruta)).toBe(false);

    borrarClaveProyecto(id);
  });

  test.skipIf(!SSH_KEYGEN)("el comando SSH usa solo esa clave, verifica el host y no conecta sin huella fijada", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-opciones");
    borrarClaveProyecto(id);
    await generarClaveProyecto(id);

    await conClaveSsh(id, async (entorno) => {
      // ssh -G solo imprime la configuración efectiva: no conecta a GitHub.
      const r = Bun.spawnSync(["sh", "-c", `${entorno.GIT_SSH_COMMAND} -G git@github.com`]);
      const salida = r.stdout.toString();
      expect(r.exitCode).toBe(0);
      expect(salida).toContain("identitiesonly yes");
      // ssh -G escribe "true" para la opción que el comando fija como "yes".
      expect(salida).toMatch(/stricthostkeychecking (yes|true)\n/);
      expect(salida).toContain("identityagent none");
      expect(salida).toContain("batchmode yes");
    });

    borrarClaveProyecto(id);
  });

  test("no genera una segunda clave para el mismo proyecto", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-duplicada");
    borrarClaveProyecto(id);
    if (!SSH_KEYGEN) return;
    await generarClaveProyecto(id);
    await expect(generarClaveProyecto(id)).rejects.toMatchObject({ code: "clave_existente" });
    borrarClaveProyecto(id);
  });

  test("sin clave de cifrado no genera ni usa nada", async () => {
    delete process.env.TELO_CLAVE_CIFRADO;
    const id = proyectoDePrueba("clave-sin-cifrado");
    borrarClaveProyecto(id);
    await expect(generarClaveProyecto(id)).rejects.toBeInstanceOf(ErrorClaveSsh);
    await expect(generarClaveProyecto(id)).rejects.toMatchObject({ code: "clave_sin_cifrado" });
    expect(clavePublicaDe(id)).toBeNull();
  });

  test("sin clave guardada, conClaveSsh no entrega nada", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-ausente");
    borrarClaveProyecto(id);
    await expect(conClaveSsh(id, async () => "no debería ocurrir")).rejects.toMatchObject({ code: "clave_no_encontrada" });
  });

  test.skipIf(!SSH_KEYGEN)("borrar la clave la quita de Telo", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-borrar");
    borrarClaveProyecto(id);
    await generarClaveProyecto(id);
    expect(borrarClaveProyecto(id)).toBe(true);
    expect(clavePublicaDe(id)).toBeNull();
    expect(borrarClaveProyecto(id)).toBe(false);
  });
});

describe("ruta de la clave pública", () => {
  test.skipIf(!SSH_KEYGEN)("GET devuelve la parte pública y nunca la privada", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const id = proyectoDePrueba("clave-ruta");
    borrarClaveProyecto(id);
    await generarClaveProyecto(id);

    const r = await claveSshRoute.request(`/projects/${id}/clave-ssh`);
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(cuerpo).toContain("ssh-ed25519 ");
    expect(cuerpo).not.toContain("PRIVATE KEY");

    borrarClaveProyecto(id);
  });

  test("un proyecto desconocido responde 404", async () => {
    const r = await claveSshRoute.request("/projects/no-existe/clave-ssh");
    expect(r.status).toBe(404);
  });
});

describe("push con la clave del proyecto", () => {
  // Imita ssh: exige la opción -i, toma el último argumento (el comando remoto de Git) y lo
  // ejecuta contra un repositorio local. Así se prueba el cableado de GIT_SSH_COMMAND, no GitHub.
  const SSH_FALSO = `#!/bin/sh
tiene_clave=0
for a in "$@"; do
  if [ "$a" = "-i" ]; then tiene_clave=1; fi
  last="$a"
done
[ "$tiene_clave" = 1 ] || { echo "falta -i" >&2; exit 1; }
ruta=$(printf '%s' "$last" | sed -e "s/^git-receive-pack '//" -e "s/'\\$//")
case "$last" in
  git-receive-pack*) exec git receive-pack "$FAKE_SSH_BASE/$ruta" ;;
  *) echo "comando no esperado: $last" >&2; exit 1 ;;
esac
`;

  test.skipIf(!SSH_KEYGEN)("la rama llega al remoto usando solo la clave del proyecto", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    const { gitOkSeguro } = await import("../src/git");

    const base = join(RAIZ_PRUEBAS, "remotos-ssh");
    mkdirSync(join(base, "dueno", "repo.git"), { recursive: true });
    Bun.spawnSync(["git", "init", "-q", "--bare", join(base, "dueno", "repo.git")]);

    const bin = join(RAIZ_PRUEBAS, "bin-ssh");
    mkdirSync(bin, { recursive: true });
    // git() pasa a su proceso solo un entorno mínimo: la ruta base se incrusta en el script falso.
    writeFileSync(join(bin, "ssh"), SSH_FALSO.replace("$FAKE_SSH_BASE", base), { mode: 0o755 });

    const trabajo = join(RAIZ_PRUEBAS, "trabajo-ssh");
    rmSync(trabajo, { recursive: true, force: true });
    mkdirSync(trabajo, { recursive: true });
    const gitLocal = (args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.name=Prueba", "-c", "user.email=prueba@local", ...args], { cwd: trabajo });
    gitLocal(["init", "-q"]);
    writeFileSync(join(trabajo, "archivo.txt"), "hola\n");
    gitLocal(["add", "archivo.txt"]);
    gitLocal(["commit", "-q", "-m", "inicial"]);

    const id = proyectoDePrueba("clave-push");
    borrarClaveProyecto(id);
    await generarClaveProyecto(id);

    const pathOriginal = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${pathOriginal}`;
    try {
      const destino = urlSshDeGithub("https://github.com/dueno/repo");
      expect(destino).toBe("git@github.com:dueno/repo.git");
      await conClaveSsh(id, (entorno) =>
        gitOkSeguro(["push", destino!, "HEAD:refs/heads/telo/prueba"], { cwd: trabajo, env: entorno }),
      );
    } finally {
      process.env.PATH = pathOriginal;
    }

    const ref = Bun.spawnSync(["git", "--git-dir", join(base, "dueno", "repo.git"), "rev-parse", "refs/heads/telo/prueba"])
      .stdout.toString()
      .trim();
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
    borrarClaveProyecto(id);
  });
});
