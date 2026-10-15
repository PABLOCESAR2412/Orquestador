import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Registros y estado del servicio: comandos falsos al frente del PATH. La salida del diario pasa por la
// redacción, y un usuario sin permiso para leer el diario recibe un error claro, no un 500.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { servidor } = await import("../src/routes/servidor");

const RESTAURAR = { PATH: process.env.PATH };
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
let carpeta = "";

function comando(nombre: string, cuerpo: string) {
  const ruta = join(carpeta, "bin", nombre);
  writeFileSync(ruta, `#!/bin/sh\n${cuerpo}\n`);
  chmodSync(ruta, 0o755);
}

beforeAll(() => {
  carpeta = mkdtempSync(join(tmpdir(), "telo-servicio-"));
  mkdirSync(join(carpeta, "bin"));
  comando("journalctl", `echo "ARGS: $*"\necho "2026-10-14T10:00:00 arranque con token ${TOKEN}"`);
  comando("systemctl", `echo "ActiveState=active"\necho "SubState=running"\necho "ActiveEnterTimestamp=Mon 2026-10-12 08:00:00 UTC"\necho "MainPID=1234"`);
  process.env.PATH = `${join(carpeta, "bin")}:${RESTAURAR.PATH ?? ""}`;
});

afterAll(() => {
  process.env.PATH = RESTAURAR.PATH;
  rmSync(carpeta, { recursive: true, force: true });
});

describe("registros del servicio", () => {
  test("devuelve las últimas líneas, con el número de líneas acotado a 300 y sin credenciales", async () => {
    const res = await servidor.request("/servidor/logs?lineas=9999");
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { lineas: number; texto: string };
    expect(cuerpo.lineas).toBe(300);
    expect(cuerpo.texto).toContain("-u orquestador -n 300");
    expect(cuerpo.texto).toContain("arranque con token");
    expect(cuerpo.texto).not.toContain(TOKEN);
  });

  test("sin parámetro usa 100 líneas", async () => {
    const cuerpo = (await (await servidor.request("/servidor/logs")).json()) as { lineas: number };
    expect(cuerpo.lineas).toBe(100);
  });

  test("un usuario sin permiso para el diario recibe sin_permiso_diario", async () => {
    const original = join(carpeta, "bin", "journalctl");
    writeFileSync(original, "#!/bin/sh\necho 'No journal files were opened due to insufficient permissions.' >&2\nexit 1\n");
    chmodSync(original, 0o755);
    const res = await servidor.request("/servidor/logs");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "sin_permiso_diario" });
    comando("journalctl", `echo "ARGS: $*"\necho "2026-10-14T10:00:00 arranque con token ${TOKEN}"`);
  });

  test("sin journalctl (desarrollo fuera de systemd) recibe registros_no_disponibles", async () => {
    const vacio = mkdtempSync(join(tmpdir(), "telo-sin-bin-"));
    process.env.PATH = vacio;
    try {
      const res = await servidor.request("/servidor/logs");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "registros_no_disponibles" });
    } finally {
      process.env.PATH = `${join(carpeta, "bin")}:${RESTAURAR.PATH ?? ""}`;
      rmSync(vacio, { recursive: true, force: true });
    }
  });
});

describe("estado del servicio", () => {
  test("lee activo, subestado, desde y PID de systemd", async () => {
    const cuerpo = (await (await servidor.request("/servidor/servicio")).json()) as Record<string, unknown>;
    expect(cuerpo).toEqual({
      disponible: true,
      activo: "active",
      subestado: "running",
      desde: "Mon 2026-10-12 08:00:00 UTC",
      pid: 1234,
    });
  });
});
