import { expect, spyOn, test } from "bun:test";
import { parsearModelosAntigravity } from "../src/modelos-antigravity";
import { listarModelosAntigravity as listarCatalogoTelo } from "../src/antigravity";

test("parsea el catálogo JSON de Antigravity con nombres, contextos y esfuerzos admitidos", () => {
  expect(parsearModelosAntigravity(JSON.stringify({ models: [
    { id: "gemini-pro", display_name: "Gemini Pro", context_window: 128000, variants: { low: {}, high: {}, xhigh: {} } },
    { id: "gemini-pro", display_name: "duplicado" },
  ] }))).toEqual([
    { id: "gemini-pro", name: "Gemini Pro", context: 128000, variants: ["low", "high"] },
  ]);
});

test("mantiene modelos del catálogo de texto de versiones sin salida JSON", () => {
  expect(parsearModelosAntigravity([
    "gemini-4-argon-high       Gemini 4 Argon (High)",
    "grok-4-fast                Grok 4 Fast",
    "texto sin identificador",
  ].join("\n"))).toEqual([
    { id: "gemini-4-argon", name: "Gemini 4 Argon", context: 0, variants: ["high"] },
    { id: "grok-4-fast", name: "Grok 4 Fast", context: 0, variants: [] },
  ]);
});

test("consulta el catálogo con el bus de Secret Service y formato JSON del CLI", async () => {
  const variables = ["HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"] as const;
  const anteriores = variables.map(nombre => process.env[nombre]);
  process.env.HOME = "/home/orquestador";
  process.env.XDG_RUNTIME_DIR = "/run/user/1001";
  process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/1001/bus";

  const stdout = new ReadableStream<Uint8Array>({ start(control) {
    control.enqueue(new TextEncoder().encode(JSON.stringify({ models: [{ id: "gemini-pro", display_name: "Gemini Pro", variants: ["high"] }] })));
    control.close();
  } });
  const stderr = new ReadableStream<Uint8Array>({ start(control) { control.close(); } });
  const proceso = { stdout, stderr, exited: Promise.resolve(0), kill() {} } as unknown as Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">;
  let llamada: { args: string[]; env: Record<string, string> } | null = null;
  const which = spyOn(Bun, "which").mockReturnValue("/home/orquestador/.local/bin/agy");
  const spawn = spyOn(Bun, "spawn").mockImplementation(((args: string[], opciones: { env: Record<string, string> }) => {
    llamada = { args, env: opciones.env };
    return proceso;
  }) as unknown as typeof Bun.spawn);

  try {
    const respuesta = await listarCatalogoTelo(true);
    expect(respuesta.models).toEqual([{ id: "gemini-pro", name: "Gemini Pro", variants: ["high"], context: 0 }]);
    expect(respuesta.generado).toBeTruthy();
    expect(llamada).toMatchObject({
      args: ["/home/orquestador/.local/bin/agy", "models", "--output-format", "json"],
      env: { HOME: "/home/orquestador", XDG_RUNTIME_DIR: "/run/user/1001", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1001/bus" },
    });
  } finally {
    which.mockRestore();
    spawn.mockRestore();
    for (const [indice, nombre] of variables.entries()) {
      if (anteriores[indice] === undefined) delete process.env[nombre];
      else process.env[nombre] = anteriores[indice];
    }
  }
});

test("explica un fallo del bus sin exponer la salida del CLI", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("/home/orquestador/.local/bin/agy");
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => {
    const flujo = (texto: string) => new ReadableStream<Uint8Array>({ start(control) { if (texto) control.enqueue(new TextEncoder().encode(texto)); control.close(); } });
    return { stdout: flujo(""), stderr: flujo("org.freedesktop.secrets is unavailable; token=private-value"), exited: Promise.resolve(1), kill() {} };
  }) as unknown as typeof Bun.spawn);
  try {
    let error = "";
    try { await listarCatalogoTelo(true); } catch (fallo) { error = (fallo as Error).message; }
    expect(error).toBe("antigravity_secret_service_unavailable");
    expect(error).not.toContain("private-value");
  } finally { which.mockRestore(); spawn.mockRestore(); }
});
