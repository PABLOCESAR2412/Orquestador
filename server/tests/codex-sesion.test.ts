import { expect, spyOn, test } from "bun:test";
import { sesionCodexConectada } from "../src/login-cli";

test("la sesión se comprueba con login status sin leer archivos ni exponer su salida", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  const spawn = spyOn(Bun, "spawn").mockImplementation(((args: string[], opts: any) => {
    expect(args).toEqual(["codex-falso", "login", "status"]);
    expect(opts.stdout).toBe("ignore");
    expect(opts.stderr).toBe("ignore");
    expect(opts.env.TELO_CLAVE).toBeUndefined();
    return { exited: Promise.resolve(0), kill() {} };
  }) as typeof Bun.spawn);
  try {
    expect(await sesionCodexConectada(true)).toBe(true);
    expect(await sesionCodexConectada()).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally { spawn.mockRestore(); which.mockRestore(); }
});

test("un CLI que no confirma la sesión nunca aparece como conectado", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({ exited: Promise.resolve(1), kill() {} })) as unknown as typeof Bun.spawn);
  try { expect(await sesionCodexConectada(true)).toBe(false); }
  finally { spawn.mockRestore(); which.mockRestore(); }
});

test("sin Codex instalado no hay sesión confirmada", async () => {
  const which = spyOn(Bun, "which").mockReturnValue(null);
  try { expect(await sesionCodexConectada(true)).toBe(false); }
  finally { which.mockRestore(); }
});

test("una comprobación forzada después del login no reutiliza una consulta anterior pendiente", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  let terminar!: (codigo: number) => void;
  let n = 0;
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({ exited: ++n === 1 ? new Promise<number>(resolve => { terminar = resolve; }) : Promise.resolve(0), kill() {} })) as unknown as typeof Bun.spawn);
  try {
    const anterior = sesionCodexConectada(true);
    const nueva = sesionCodexConectada(true);
    terminar(1);
    expect(await anterior).toBe(false);
    expect(await nueva).toBe(true);
    expect(n).toBe(2);
  } finally { spawn.mockRestore(); which.mockRestore(); }
});
