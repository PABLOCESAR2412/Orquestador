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
