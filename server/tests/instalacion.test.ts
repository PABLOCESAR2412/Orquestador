import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// Instalación de OpenCode desde la app. Un npm falso al frente del PATH deja un ejecutable en HOME/.opencode/bin.
// Se comprueba: el comando es fijo, hace falta confirmación, la salida se redacta y no se puede instalar dos veces.
const RAIZ = mkdtempSync(join(tmpdir(), "telo-instalacion-"));
const HOME_PRUEBA = join(RAIZ, "home");
const BIN_FALSO = join(RAIZ, "bin-npm");
const SIN_NPM = join(RAIZ, "bin-vacio");
mkdirSync(HOME_PRUEBA, { recursive: true });
mkdirSync(BIN_FALSO, { recursive: true });
mkdirSync(SIN_NPM, { recursive: true });
process.env.HOME = HOME_PRUEBA;
process.env.DATA_DIR = join(RAIZ, "data");
const PATH_ORIGINAL = process.env.PATH;
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

// npm falso: toma el valor de --prefix, crea <prefijo>/bin/opencode y escribe una línea con un token.
writeFileSync(
  join(BIN_FALSO, "npm"),
  `#!/bin/sh
prefijo=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then prefijo="$2"; shift; fi
  shift
done
mkdir -p "$prefijo/bin"
printf '#!/bin/sh\\necho opencode-falso\\n' > "$prefijo/bin/opencode"
chmod +x "$prefijo/bin/opencode"
echo "instalado; registro con ${TOKEN}"
`,
);
chmodSync(join(BIN_FALSO, "npm"), 0o755);

const { herramientas } = await import("../src/routes/herramientas");

async function post(cuerpo: unknown) {
  return herramientas.request("/herramientas/opencode/instalacion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

async function esperarEstado(estado: string, ms = 8000): Promise<{ estado: string; motivo: string | null; instalada: boolean; salida: string }> {
  const limite = Date.now() + ms;
  for (;;) {
    const res = await herramientas.request("/herramientas/opencode/instalacion");
    const cuerpo = (await res.json()) as { estado: string; motivo: string | null; instalada: boolean; salida: string };
    if (cuerpo.estado === estado || Date.now() > limite) return cuerpo;
    await Bun.sleep(50);
  }
}

beforeAll(() => {
  process.env.PATH = [SIN_NPM, "/usr/bin", "/bin"].join(delimiter);
});

afterAll(() => {
  process.env.PATH = PATH_ORIGINAL;
  rmSync(RAIZ, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("instalación de OpenCode", () => {
  test("solo instala identificadores de la lista; cualquier otro da 404", async () => {
    for (const id of ["rm", "bash", "opencode;rm", "..%2Fetc"]) {
      const res = await herramientas.request(`/herramientas/${encodeURIComponent(id)}/instalacion`);
      expect(res.status).toBe(404);
    }
  });

  test("sin confirmación explícita no instala nada", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("confirmacion_requerida");
    const res2 = await post({ confirmar: "sí" });
    expect(res2.status).toBe(400);
  });

  test("muestra el comando fijo que va a ejecutar", async () => {
    const cuerpo = (await (await herramientas.request("/herramientas/opencode/instalacion")).json()) as {
      comando: string;
      estado: string;
      instalada: boolean;
    };
    expect(cuerpo.comando).toBe("npm install -g --prefix ~/.opencode opencode-ai");
    expect(cuerpo.estado).toBe("inactiva");
    expect(cuerpo.instalada).toBe(false);
  });

  test("sin npm en el servidor responde 503 con un código legible", async () => {
    const res = await post({ confirmar: true });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("npm_no_disponible");
  });

  test("con confirmación instala, redacta la salida y deja el CLI en PATH", async () => {
    process.env.PATH = [BIN_FALSO, SIN_NPM, "/usr/bin", "/bin"].join(delimiter);
    const res = await post({ confirmar: true });
    expect(res.status).toBe(202);

    const final = await esperarEstado("lista");
    expect(final.estado).toBe("lista");
    expect(final.motivo).toBeNull();
    expect(final.instalada).toBe(true);
    expect(final.salida).not.toContain(TOKEN);
    expect(final.salida).toContain("***");
    expect(existsSync(join(HOME_PRUEBA, ".opencode", "bin", "opencode"))).toBe(true);
    expect(process.env.PATH?.split(delimiter)[0]).toBe(join(HOME_PRUEBA, ".opencode", "bin"));
  });

  test("una segunda instalación se rechaza: el CLI ya está", async () => {
    const res = await post({ confirmar: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("ya_instalada");
  });

  test("Codex se consulta por la misma ruta y con su comando fijo", async () => {
    const res = await herramientas.request("/herramientas/codex/instalacion");
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { comando: string };
    expect(cuerpo.comando).toBe("npm install -g --prefix ~/.opencode @openai/codex");
  });

  test("el ejecutable instalado queda dentro de ~/.opencode, que el agente ve en solo lectura", () => {
    expect(readFileSync(join(HOME_PRUEBA, ".opencode", "bin", "opencode"), "utf8")).toContain("opencode-falso");
  });
});

describe("integración Hermes", () => {
  test("publica solo el instalador oficial y no lo marca como runner de tareas", async () => {
    const res = await herramientas.request("/herramientas/hermes/instalacion");
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { herramienta: string; comando: string; estado: string };
    expect(cuerpo.herramienta).toBe("hermes");
    expect(cuerpo.comando).toBe(
      "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive --skip-browser --skip-computer-use",
    );
    expect(cuerpo.estado).toBe("inactiva");
  });
});
