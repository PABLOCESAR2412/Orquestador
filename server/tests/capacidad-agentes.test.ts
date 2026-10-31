import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reservarAgente } from "../src/capacidad-agentes";
import { limiteProveedor } from "../src/limites";

const anterior = process.env.TELO_CONCURRENCIA_PROVEEDORES;
afterEach(() => { if (anterior === undefined) delete process.env.TELO_CONCURRENCIA_PROVEEDORES; else process.env.TELO_CONCURRENCIA_PROVEEDORES = anterior; });

test("los límites por proveedor son conservadores, configurables y validados", () => {
  delete process.env.TELO_CONCURRENCIA_PROVEEDORES;
  expect(limiteProveedor("opencode/glm-free")).toBe(1);
  expect(limiteProveedor("google/gemini")).toBe(2);
  for (const valor of ["no-json", "null", '{"opencode":0}', '{"opencode":11}', '{"opencode":1.5}']) {
    process.env.TELO_CONCURRENCIA_PROVEEDORES = valor;
    expect(limiteProveedor("opencode/glm-free")).toBe(1);
  }
  process.env.TELO_CONCURRENCIA_PROVEEDORES = '{"opencode":3}';
  expect(limiteProveedor("opencode/glm-free")).toBe(3);
});

test("una cola saturada no bloquea otro proveedor y cancelar la espera no libera al agente activo", async () => {
  process.env.TELO_CONCURRENCIA_PROVEEDORES = '{"opencode":1}';
  const liberar = await reservarAgente("opencode/uno");
  const control = new AbortController();
  const estados: string[] = [];
  const espera = reservarAgente("opencode/dos", control.signal, e => estados.push(e));
  const otro = await reservarAgente("google/uno");
  let tercero: (() => void) | undefined;
  const turno = reservarAgente("opencode/tres", undefined, e => estados.push(`tercero:${e}`)).then(soltar => { tercero = soltar; });
  try {
    expect(estados).toEqual(["waiting", "tercero:waiting"]);
    control.abort();
    await expect(espera).rejects.toThrow("cancelada");
    expect(estados).toContain("cancelled");
    expect(tercero).toBeUndefined();
    liberar(); liberar();
    await turno;
    expect(estados).toContain("tercero:ready");
  } finally { liberar(); otro(); tercero?.(); }
});

test("respeta diez puestos globales y salta una cabecera cuyo proveedor sigue ocupado", async () => {
  delete process.env.TELO_CONCURRENCIA_PROVEEDORES;
  const liberar: (() => void)[] = [];
  for (let i = 0; i < 10; i++) liberar.push(await reservarAgente(`p${Math.floor(i / 2)}/modelo`));
  const control = new AbortController();
  const bloqueada = reservarAgente("p1/otra", control.signal);
  let disponible = false;
  const otra = reservarAgente("nuevo/modelo").then(soltar => { liberar.push(soltar); disponible = true; });
  try {
    expect(disponible).toBe(false);
    liberar[0]();
    await otra;
    expect(disponible).toBe(true);
    control.abort();
    await expect(bloqueada).rejects.toThrow("cancelada");
  } finally { for (const soltar of liberar) soltar(); }
});

test("cancelar justo al admitir devuelve el puesto sin lanzar otra ejecución", async () => {
  process.env.TELO_CONCURRENCIA_PROVEEDORES = '{"opencode":1}';
  const primero = await reservarAgente("opencode/uno");
  const control = new AbortController();
  const espera = reservarAgente("opencode/dos", control.signal, estado => { if (estado === "ready") control.abort(); });
  primero();
  await expect(espera).rejects.toThrow("cancelada");
  const siguiente = await reservarAgente("opencode/tres");
  siguiente();
});

test("doce tareas del mismo proveedor no impiden que el worker atienda otro", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "telo-worker-capacidad-"));
  try {
    const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "fixtures/worker-proveedores.ts")], {
      env: { ...process.env, DATA_DIR: join(carpeta, "data"), TELO_CONCURRENCIA_PROVEEDORES: '{"opencode":1,"google":1}' }, stdout: "pipe", stderr: "pipe",
    });
    const [salida, error, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(codigo, `${salida}\n${error}`).toBe(0);
    expect(salida).toContain("proveedores independientes verificados");
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
}, 15_000);
