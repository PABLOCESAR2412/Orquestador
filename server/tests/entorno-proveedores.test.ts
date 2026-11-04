import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// Prueba de punto a punto: una clave de proveedor guardada llega al agente y a `opencode models`,
// y ninguna variable TELO_* llega a ninguno de los dos. Usa un `opencode` falso al frente del PATH
// (como analizador.test.ts) con TELO_AISLAMIENTO=desactivado, porque bubblewrap no es parte de esta prueba.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { guardarClaveProveedor } = await import("../src/claves-proveedor");
const { ejecutarAgente } = await import("../src/ejecutar");
const { entornoDelAgente } = await import("../src/runners/opencode");
const { getModels } = await import("../src/models");

const VALOR_GROQ = "gsk_clave_de_prueba_e2e_987";
const CLAVE_MAESTRA = randomBytes(32).toString("base64");

const RESTAURAR = {
  PATH: process.env.PATH,
  TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO,
  TELO_CLAVE_CIFRADO: process.env.TELO_CLAVE_CIFRADO,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  TELO_PRUEBA_SECRETA: process.env.TELO_PRUEBA_SECRETA,
};

let carpeta = "";
let volcadoAgente = "";
let volcadoCli = "";
let marcaEspera = "";

beforeAll(() => {
  carpeta = mkdtempSync(join(tmpdir(), "telo-entorno-"));
  const bin = join(carpeta, "bin");
  mkdirSync(bin);
  volcadoAgente = join(carpeta, "entorno-agente.txt");
  volcadoCli = join(carpeta, "entorno-cli.txt");
  marcaEspera = join(carpeta, "espera-completada.txt");

  // Cada llamada guarda su entorno en un archivo distinto: `models` es el CLI, lo demás es el agente.
  // El agente repite la clave en su respuesta para comprobar que sale oculta.
  writeFileSync(
    join(bin, "opencode"),
    `#!/bin/sh
if [ "$1" = "models" ]; then
  env > '${volcadoCli}'
  echo "opencode/big-pickle"
  echo '{"name":"Big Pickle","cost":{"input":0,"output":0},"limit":{"context":200000},"variants":{}}'
  echo "groq/llama-prueba"
  echo '{"name":"Llama prueba","cost":{"input":0.5,"output":0.8},"limit":{"context":131072},"variants":{}}'
  echo "nvidia/nemo-prueba"
  echo '{"name":"Nemo prueba","cost":{"input":1,"output":2},"limit":{"context":128000},"variants":{}}'
  exit 0
fi
env > '${volcadoAgente}'
for arg in "$@"; do
  case "$arg" in
    *ESPERA-LARGA*) sleep 0.2; : > '${marcaEspera}';;
  esac
done
echo '{"type":"text","sessionID":"ses_entorno01","part":{"type":"text","text":"Clave usada: '"$GROQ_API_KEY"'"}}'
`,
  );
  chmodSync(join(bin, "opencode"), 0o755);

  process.env.PATH = `${bin}${delimiter}${RESTAURAR.PATH ?? ""}`;
  process.env.TELO_AISLAMIENTO = "desactivado";
  process.env.TELO_CLAVE_CIFRADO = CLAVE_MAESTRA;
  process.env.TELO_PRUEBA_SECRETA = "no-debe-llegar-a-ningun-agente";
  delete process.env.GROQ_API_KEY;
  db.query("DELETE FROM provider_keys").run();
  guardarClaveProveedor("groq", VALOR_GROQ);
});

afterAll(() => {
  for (const [clave, valor] of Object.entries(RESTAURAR)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  rmSync(carpeta, { recursive: true, force: true });
});

// Variables de un volcado de `env`: una por línea, "NOMBRE=valor".
function variables(ruta: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    const corte = linea.indexOf("=");
    if (corte > 0) mapa.set(linea.slice(0, corte), linea.slice(corte + 1));
  }
  return mapa;
}

test("cada integración recibe solo sus claves y las de sus subagentes declarados", () => {
  const propias = { GROQ_API_KEY: "groq-ficticia", NVIDIA_API_KEY: "nvidia-ficticia", OPENROUTER_API_KEY: "router-ficticia", OPENAI_API_KEY: "openai-ficticia", DEEPSEEK_API_KEY: "deepseek-ficticia", XAI_API_KEY: "xai-ficticia", PROYECTO_TOKEN: "local-ficticio" };
  expect(entornoDelAgente(propias, ["groq/modelo"])).toMatchObject({ GROQ_API_KEY: propias.GROQ_API_KEY, PROYECTO_TOKEN: propias.PROYECTO_TOKEN });
  for (const variable of ["NVIDIA_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY"]) expect(entornoDelAgente(propias, ["groq/modelo"])[variable]).toBeUndefined();
  expect(entornoDelAgente(propias, ["deepseek/modelo"])).toMatchObject({ DEEPSEEK_API_KEY: propias.DEEPSEEK_API_KEY });
  expect(entornoDelAgente(propias, ["deepseek/modelo"]).XAI_API_KEY).toBeUndefined();
  expect(entornoDelAgente(propias, ["xai/modelo"])).toMatchObject({ XAI_API_KEY: propias.XAI_API_KEY });
  expect(entornoDelAgente(propias, ["opencode/modelo", "nvidia/auxiliar"]).NVIDIA_API_KEY).toBe(propias.NVIDIA_API_KEY);
  expect(entornoDelAgente(propias, ["codex/modelo"]).OPENAI_API_KEY).toBeUndefined();
  const anthropic = { ANTHROPIC_API_KEY: "clave-anthropic-ficticia" };
  expect(entornoDelAgente(anthropic, ["anthropic/modelo"]).ANTHROPIC_API_KEY).toBe(anthropic.ANTHROPIC_API_KEY);
  expect(entornoDelAgente(anthropic, ["groq/modelo"]).ANTHROPIC_API_KEY).toBeUndefined();
  const cloudflare = { CLOUDFLARE_API_KEY: "clave-cloudflare-ficticia", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) };
  expect(entornoDelAgente(cloudflare, ["cloudflare-workers-ai/@cf/prueba"])).toMatchObject(cloudflare);
  expect(entornoDelAgente(cloudflare, ["groq/modelo"]).CLOUDFLARE_API_KEY).toBeUndefined();
  expect(entornoDelAgente(cloudflare, ["groq/modelo"]).CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
});

describe.skipIf(!Bun.which("setsid"))("entorno de los proveedores en el agente y en el CLI", () => {
  test("una ejecución sin timeout automático termina y el límite explícito sigue activo", async () => {
    const inicio = Date.now();
    rmSync(marcaEspera, { force: true });
    const resultado = await ejecutarAgente({
      prompt: "ESPERA-LARGA",
      model: "opencode/big-pickle",
      cwd: carpeta,
      timeoutMs: null,
    });

    expect(resultado.text).toContain("Clave usada:");
    expect(existsSync(marcaEspera)).toBe(true);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(150);
    rmSync(marcaEspera, { force: true });
    await expect(ejecutarAgente({
      prompt: "ESPERA-LARGA",
      model: "opencode/big-pickle",
      cwd: carpeta,
      timeoutMs: 10,
    })).rejects.toThrow();
    expect(existsSync(marcaEspera)).toBe(false);
  });

  test("el agente recibe GROQ_API_KEY y nunca una variable TELO_*", async () => {
    const resultado = await ejecutarAgente({
      prompt: "Hola",
      model: "groq/llama-prueba",
      cwd: carpeta,
      timeoutMs: 20_000,
    });

    expect(existsSync(volcadoAgente)).toBe(true);
    const env = variables(volcadoAgente);
    expect(env.get("GROQ_API_KEY")).toBe(VALOR_GROQ);
    expect([...env.keys()].filter((k) => k.startsWith("TELO_"))).toEqual([]);
    expect(env.has("DATA_DIR")).toBe(false);
    expect(env.has("TELO_PRUEBA_SECRETA")).toBe(false);

    // La clave que el agente imprime no sale del servidor: va oculta en la respuesta.
    expect(resultado.text).not.toContain(VALOR_GROQ);
    expect(resultado.text).toContain("Clave usada:");
  });

  test("`opencode models` recibe la clave y ninguna variable TELO_*", async () => {
    const modelos = await getModels(true);
    expect(modelos.map((m) => m.id)).toEqual(["opencode/big-pickle", "groq/llama-prueba", "nvidia/nemo-prueba"]);

    const env = variables(volcadoCli);
    expect(env.get("GROQ_API_KEY")).toBe(VALOR_GROQ);
    expect([...env.keys()].filter((k) => k.startsWith("TELO_"))).toEqual([]);
  });

  test("con clave guardada, los modelos de ese proveedor se recomiendan y van en su grupo", async () => {
    const modelos = await getModels(true);
    const groq = modelos.find((m) => m.id === "groq/llama-prueba");
    expect(groq).toMatchObject({ recommended: true, group: "Groq" });
    // NVIDIA no tiene clave guardada: su modelo de pago no se recomienda.
    expect(modelos.find((m) => m.id === "nvidia/nemo-prueba")).toMatchObject({ recommended: false, group: "Otros" });
  });

  test("sin clave guardada, el agente no recibe GROQ_API_KEY y el modelo de Groq no se recomienda", async () => {
    db.query("DELETE FROM provider_keys").run();
    await ejecutarAgente({ prompt: "Hola", model: "opencode/big-pickle", cwd: carpeta, timeoutMs: 20_000 });
    expect(variables(volcadoAgente).has("GROQ_API_KEY")).toBe(false);

    const modelos = await getModels(true);
    expect(modelos.find((m) => m.id === "groq/llama-prueba")?.recommended).toBe(false);
    guardarClaveProveedor("groq", VALOR_GROQ);
    await getModels(true);
  });
});
