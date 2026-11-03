import { afterAll, expect, spyOn, test } from "bun:test";
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporal = mkdtempSync(join(tmpdir(), "telo-agy-"));
const anteriorData = process.env.DATA_DIR;
process.env.DATA_DIR = join(temporal, "data");
const { archivosSesionAntigravity, TOKEN_ANTIGRAVITY } = await import("../src/antigravity");
const { extraerUrlAutorizacionAntigravity } = await import("../src/login-antigravity");
const { configuracionAntigravityAislada, prepararPerfilAntigravity, prefijoAislamiento } = await import("../src/runners/aislamiento");
const { runAntigravity, usoAntigravity } = await import("../src/runners/antigravity");
const { db } = await import("../src/db");
afterAll(() => { db.close(); rmSync(temporal, { recursive: true, force: true }); if (anteriorData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = anteriorData; });

test("el login solo muestra URLs HTTPS del host oficial de cuentas Google", () => {
  expect(extraerUrlAutorizacionAntigravity("Open this link: https://accounts.google.com/o/oauth2/auth?client_id=example.")).toBe("https://accounts.google.com/o/oauth2/auth?client_id=example");
  expect(extraerUrlAutorizacionAntigravity("https://attacker.example/login")).toBeNull();
  expect(extraerUrlAutorizacionAntigravity("http://accounts.google.com/login")).toBeNull();
});

test("la política nativa oculta credenciales y no concede comandos fuera del sandbox", () => {
  const politica = configuracionAntigravityAislada("/home/orquestador", "/workspace", true);
  expect(politica.enableTerminalSandbox).toBe(true);
  expect(politica.toolPermission).toBe("proceed-in-sandbox");
  expect(politica.allowNonWorkspaceAccess).toBe(false);
  expect(politica.permissions.deny).toContain("write_file(*)");
  expect(politica.permissions.deny).toContain(`read_file(${join("/home/orquestador", ".gemini")})`);
  expect(politica.permissions.allow.some(regla => regla.startsWith("command("))).toBe(false);
});

test("el perfil de AGY monta solo archivos de sesión en lectura sin copiar el token", () => {
  const home = join(temporal, "home");
  const token = join(home, ".gemini", TOKEN_ANTIGRAVITY);
  mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
  writeFileSync(token, "TOKEN-FALSO-SOLO-FIXTURE", { mode: 0o600 });
  writeFileSync(join(home, ".gemini", "antigravity-cli", "historial-secreto.json"), "NO-MONTAR");
  expect(archivosSesionAntigravity(home)).toEqual([{ relativa: TOKEN_ANTIGRAVITY, ruta: token }]);
  const anteriorHome = process.env.HOME;
  const anteriorAislamiento = process.env.TELO_AISLAMIENTO;
  const which = spyOn(Bun, "which").mockReturnValue("binario-falso");
  try {
    process.env.HOME = home;
    delete process.env.TELO_AISLAMIENTO;
    const cwd = join(process.env.DATA_DIR!, "chat-workspace", "prueba");
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    writeFileSync(join(cwd, ".agents", "hooks.json"), "{\"hooks\":\"no ejecutar\"}");
    const perfil = prepararPerfilAntigravity("prueba", cwd, true);
    const args = prefijoAislamiento(cwd, true, [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, perfil);
    const indice = args.indexOf(token);
    expect(args[indice - 1]).toBe("--ro-bind");
    expect(args[indice + 1]).toBe(token);
    expect(readFileSync(join(perfil, TOKEN_ANTIGRAVITY), "utf8")).toBe("");
    expect(args).toContain(join(cwd, ".agents"));
    const configuracion = JSON.parse(readFileSync(join(perfil, "antigravity-cli", "settings.json"), "utf8"));
    expect(configuracion.permissions.deny).toContain(`read_file(${join(home, ".gemini")})`);
  } finally {
    which.mockRestore();
    if (anteriorHome === undefined) delete process.env.HOME; else process.env.HOME = anteriorHome;
    if (anteriorAislamiento === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anteriorAislamiento;
  }
});

test.skipIf(process.platform === "win32")("la sesión de AGY rechaza hardlinks", () => {
  const home = join(temporal, "home-enlaces");
  const carpeta = join(home, ".gemini", "antigravity-cli");
  mkdirSync(carpeta, { recursive: true });
  const fuente = join(temporal, "token-falso");
  writeFileSync(fuente, "fixture", { mode: 0o600 });
  linkSync(fuente, join(home, ".gemini", TOKEN_ANTIGRAVITY));
  expect(archivosSesionAntigravity(home)).toHaveLength(0);
});
test.skipIf(process.platform === "win32")("AGY rechaza un directorio de credenciales simbólico", () => {
  const home = join(temporal, "home-symlink");
  const exterior = join(temporal, "externo");
  mkdirSync(home); mkdirSync(join(exterior, "antigravity-cli"), { recursive: true });
  writeFileSync(join(exterior, TOKEN_ANTIGRAVITY), "fixture", { mode: 0o600 });
  symlinkSync(exterior, join(home, ".gemini"), "dir");
  expect(archivosSesionAntigravity(home)).toHaveLength(0);
});

const flujo = (eventos: unknown[]) => new ReadableStream<Uint8Array>({ start(c) { for (const e of eventos) c.enqueue(new TextEncoder().encode(JSON.stringify(e) + "\n")); c.close(); } });
function proceso(eventos: unknown[], codigo = 0, diagnostico = ""): never {
  return { stdout: flujo(eventos), stderr: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(diagnostico)); c.close(); } }), exited: Promise.resolve(codigo), kill() {}, pid: 999999999 } as never;
}
async function conCliFalso(eventos: unknown[], ejecutar: (capturas: any[]) => Promise<void>, codigo = 0, diagnostico = "") {
  const anterior = process.env.TELO_AISLAMIENTO;
  process.env.TELO_AISLAMIENTO = "desactivado";
  const which = spyOn(Bun, "which").mockReturnValue("agy-falso");
  const capturas: any[] = [];
  const spawn = spyOn(Bun, "spawn").mockImplementation(((args: string[], opts: any) => { capturas.push({ args, env: opts.env }); return proceso(eventos, codigo, diagnostico); }) as unknown as typeof Bun.spawn);
  try { await ejecutar(capturas); }
  finally { which.mockRestore(); spawn.mockRestore(); if (anterior === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anterior; }
}

test("AGY conserva modelo/sesión, separa reasoning y cuenta cada paso una vez", async () => {
  const sesion = "11111111-aaaa-bbbb-cccc-111111111111";
  const paso = { event: "step_update", step_update: { conversation_id: sesion, step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "Lista", usage: { input_tokens: 80, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 10 } } };
  const usos: any[] = [];
  await conCliFalso([{ event: "init", conversation_id: sesion }, paso, paso, { event: "result", result: { conversation_id: sesion, status: "SUCCESS", response: "Lista", usage: { input_tokens: 100, output_tokens: 30, thinking_tokens: 10, cache_read_tokens: 15 } } }], async capturas => {
    const resultado = await runAntigravity({ cwd: temporal, prompt: "revisa", model: "antigravity/gemini-test", onUso: u => usos.push(u) });
    expect(resultado.text).toBe("Lista");
    expect(resultado.usage).toMatchObject({ input: 100, output: 20, reasoning: 10, tokensMedidos: true });
    expect(usos).toHaveLength(2);
    expect(usos[0]).toMatchObject({ input: 80, output: 15, reasoning: 5 });
    expect(usos[1]).toMatchObject({ input: 20, output: 5, reasoning: 5 });
    expect(capturas[0].args).toContain("--sandbox");
    expect(capturas[0].args).toContain("accept-edits");
    expect(capturas[0].args).not.toContain("--dangerously-skip-permissions");
  });
  await conCliFalso([{ event: "result", result: { conversation_id: sesion, status: "SUCCESS", response: "Continuado", usage: { input_tokens: 120, output_tokens: 40, thinking_tokens: 12, cache_read_tokens: 18 } } }], async capturas => {
    const siguientes: any[] = [];
    await runAntigravity({ cwd: temporal, prompt: "sigue", model: "antigravity/gemini-test", sessionId: sesion, soloLectura: true, onUso: u => siguientes.push(u) });
    expect(capturas[0].args).toContain(sesion);
    expect(capturas[0].args).toContain("plan");
    expect(siguientes).toHaveLength(1);
    expect(siguientes[0]).toMatchObject({ input: 20, output: 8, reasoning: 2 });
  });
});

test("AGY no convierte un uso ausente en tokens estimados y conserva los errores del proveedor", async () => {
  expect(usoAntigravity({ input_tokens: -1, output_tokens: 3 })).toBeNull();
  await conCliFalso([{ event: "result", result: { status: "SUCCESS", response: "Sin contadores" } }], async () => {
    const usos: unknown[] = [];
    const resultado = await runAntigravity({ cwd: temporal, prompt: "revisa", model: "antigravity/gemini-test", onUso: u => usos.push(u) });
    expect(resultado.usage).toBeNull();
    expect(usos).toHaveLength(0);
  });
  await conCliFalso([{ event: "result", result: { status: "ERROR", error: "RESOURCE_EXHAUSTED daily quota" } }], async () => {
    await expect(runAntigravity({ cwd: temporal, prompt: "revisa", model: "antigravity/gemini-test" })).rejects.toThrow("RESOURCE_EXHAUSTED");
  }, 3);
});

test("un resume antiguo sin base explica la ausencia y prepara el siguiente delta", async () => {
  const sesion = "22222222-aaaa-bbbb-cccc-222222222222";
  const evento = (input: number) => ({ event: "result", result: { conversation_id: sesion, status: "SUCCESS", response: "Continuado", usage: { input_tokens: input, output_tokens: 10, thinking_tokens: 2 } } });
  await conCliFalso([evento(1000)], async () => {
    const usos: unknown[] = []; const actividad: string[] = [];
    await runAntigravity({ cwd: temporal, prompt: "sigue", model: "antigravity/gemini-test", sessionId: sesion, onUso: u => usos.push(u), onLinea: l => actividad.push(l) });
    expect(usos).toHaveLength(0);
    expect(actividad.join("\n")).toContain("sin una base verificable");
  });
  await conCliFalso([evento(1020)], async () => {
    const usos: any[] = [];
    await runAntigravity({ cwd: temporal, prompt: "sigue", model: "antigravity/gemini-test", sessionId: sesion, onUso: u => usos.push(u) });
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatchObject({ input: 20, output: 0, reasoning: 0 });
  });
});

test("una renovación de OAuth bloqueada pide renovar la sesión por SSH", async () => {
  await conCliFalso([{ event: "result", result: { status: "ERROR", error: "OAuth token refresh: permission denied, read-only file system" } }], async () => {
    await expect(runAntigravity({ cwd: temporal, prompt: "revisa", model: "antigravity/gemini-test" })).rejects.toThrow("necesita renovarse por SSH");
  }, 1);
});

test("SUCCESS con acciones denegadas queda incompleto y conserva sesión/uso sin exponer los argumentos", async () => {
  const sid = "44444444-aaaa-bbbb-cccc-444444444444";
  const usos: any[] = []; const sesiones: string[] = [];
  await conCliFalso([{ event: "result", result: { conversation_id: sid, status: "SUCCESS", response: "Todo terminado", denied_actions: [{ tool: "run_command", command: "ARGUMENTO-SENSIBLE-FICTICIO" }], usage: { input_tokens: 13, output_tokens: 4, thinking_tokens: 1 } } }], async () => {
    let fallo: unknown;
    try { await runAntigravity({ cwd: temporal, prompt: "construye", model: "antigravity/gemini-test", onSesion: s => sesiones.push(s), onUso: u => usos.push(u) }); }
    catch (error) { fallo = error; }
    expect(String(fallo)).toContain("tarea incompleta");
    expect(String(fallo)).not.toContain("ARGUMENTO-SENSIBLE-FICTICIO");
    expect(sesiones).toEqual([sid]);
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatchObject({ input: 13, output: 3, reasoning: 1, tokensMedidos: true, costeDisponible: false });
  });
});

test("un aviso de sandbox nativo no disponible impide declarar SUCCESS", async () => {
  await conCliFalso([{ event: "result", result: { status: "SUCCESS", response: "Terminado", denied_actions: [] } }], async () => {
    await expect(runAntigravity({ cwd: temporal, prompt: "construye", model: "antigravity/gemini-test" })).rejects.toThrow("no pudo activar su sandbox nativo");
  }, 0, "Warning: sandbox not available; falling back to request-review");
});

test("el punto de ejecución compartido envía el modelo Antigravity a agy y registra su integración real", async () => {
  const { ejecutarAgente } = await import("../src/ejecutar");
  const sid = "33333333-aaaa-bbbb-cccc-333333333333";
  await conCliFalso([{ event: "result", result: { conversation_id: sid, status: "SUCCESS", response: "Nativo", usage: { input_tokens: 7, output_tokens: 2, thinking_tokens: 1 } } }], async capturas => {
    const resultado = await ejecutarAgente({ cwd: temporal, prompt: "responde", model: "antigravity/gemini-dispatch" });
    expect(resultado.modelo).toBe("antigravity/gemini-dispatch");
    expect(resultado.textoFinal).toBe("Nativo");
    expect(capturas.some(c => c.args.includes("--model") && c.args.includes("gemini-dispatch") && c.args.includes("--output-format"))).toBe(true);
    expect(capturas.some(c => c.args.includes("run") && c.args.includes("opencode"))).toBe(false);
    const uso = db.query("SELECT provider,model,input_tokens,output_tokens,reasoning_tokens FROM usage WHERE model='antigravity/gemini-dispatch'").all();
    expect(uso).toEqual([{ provider: "antigravity", model: "antigravity/gemini-dispatch", input_tokens: 7, output_tokens: 1, reasoning_tokens: 1 }]);
  });
});
