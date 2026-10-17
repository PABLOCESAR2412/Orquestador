import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

// Base temporal compartida por todos los archivos de prueba (ver proyectos.test.ts).
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
process.env.PATH = `${join(import.meta.dir, "fixtures", "bin")}:${process.env.PATH ?? ""}`;

const { db } = await import("../src/db");
const { ErrorCuota, esErrorDeCuota, esErrorDeProveedor } = await import("../src/ejecutar");
const { ErrorAgente, detalleDelProveedor, explicarErrorProveedor } = await import("../src/runners/opencode");
const { tasks } = await import("../src/routes/tasks");
const { chat } = await import("../src/routes/chat");

const app = new Hono();
app.route("/api", tasks);
app.route("/api", chat);

function tarea(status: string, extra: { model?: string; modeloAgotado?: string | null; sesion?: string | null } = {}) {
  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO tasks (id, title, prompt, model, effort, status, modelo_agotado, provider_session_id) VALUES (?, 'Prueba', 'Haz algo', ?, NULL, ?, ?, ?)",
  ).run(id, extra.model ?? "opencode/a", status, extra.modeloAgotado ?? null, extra.sesion ?? null);
  return id;
}

function conversacion(model: string | null, cuotaModelo: string | null) {
  const id = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, title, model, cuota_modelo) VALUES (?, 'Chat', ?, ?)").run(
    id,
    model,
    cuotaModelo,
  );
  return id;
}

const post = (ruta: string, cuerpo: unknown = {}) =>
  app.request(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

describe("diff de una tarea activa", () => {
  test("devuelve un estado transitorio mientras el workspace está ocupado", async () => {
    for (const status of ["queued", "analyzing", "waiting_approval", "running"]) {
      const id = tarea(status);
      try {
        const response = await app.request(`/api/tasks/${id}/diff`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ estado: "en_curso" });
      } finally {
        db.query("DELETE FROM tasks WHERE id=?").run(id);
      }
    }
  });
});

describe("clasificación de cuota agotada", () => {
  test("un 429, un límite de uso o un saldo agotado cuentan como cuota", () => {
    expect(esErrorDeCuota(new Error('opencode salió con código 1: {"error":{"message":"Rate limit exceeded (429)"}}'))).toBe(true);
    expect(esErrorDeCuota(new Error("Insufficient account funds"))).toBe(true);
    expect(esErrorDeCuota(new Error("usage limit reached for this model"))).toBe(true);
  });

  test("una ruta con una palabra como «cuota» no cuenta: solo el detalle del proveedor", () => {
    // Sin evento de error, la cola de la salida se mira sin rutas: una carpeta «cuota-app» no cuenta.
    const sinEvento = detalleDelProveedor("", "TypeError at /home/x/cuota-app/bin/opencode:21", []);
    expect(esErrorDeCuota(new ErrorAgente("opencode salió con código 1", sinEvento))).toBe(false);
    // Con evento de error, lo que dice el proveedor sí cuenta.
    const evento = { type: "error", error: { data: { message: "Rate limit exceeded" } } } as const;
    const conEvento = detalleDelProveedor("", "", [evento as never]);
    expect(esErrorDeCuota(new ErrorAgente("opencode salió con código 1", conEvento))).toBe(true);
  });

  test("el respaldo se activa por saturación del proveedor, nunca por una ruta con «429» o «quota»", () => {
    const ruta = new ErrorAgente("opencode salió con código 1: fallo en /home/x/quota-429/bin/opencode", "");
    expect(esErrorDeProveedor(ruta)).toBe(false);
    const saturado = new ErrorAgente(
      "opencode salió con código 1",
      '{"type":"error","error":{"message":"429 Too Many Requests"}}',
    );
    expect(esErrorDeProveedor(saturado)).toBe(true);

    const errorServidor = new ErrorAgente(
      "opencode salió con código 1",
      '{"type":"error","error":{"message":"Unexpected server error. Check server logs for details."}}',
    );
    expect(esErrorDeProveedor(errorServidor)).toBe(true);
  });

  test("un error del servidor o una salida vacía no cuentan como cuota", () => {
    expect(esErrorDeCuota(new Error("opencode salió con código 1: 500 Internal Server Error"))).toBe(false);
    expect(esErrorDeCuota(new Error("opencode no devolvió texto: sin salida"))).toBe(false);
  });

  test("explica el presupuesto insuficiente de OpenRouter sin exponer el evento interno ni llamarlo cuota agotada", () => {
    const evento = {
      type: "error",
      sessionID: "sesion-interna",
      error: {
        name: "APIError",
        data: {
          statusCode: 402,
          message: "This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 10533.",
          responseHeaders: { "cf-ray": "dato-interno" },
        },
      },
    };
    const mensaje = explicarErrorProveedor(evento);
    expect(mensaje).toContain("presupuesto insuficiente");
    expect(mensaje).toContain("10533 tokens");
    expect(mensaje).toContain("32000");
    expect(mensaje).toContain("Telo no permite ajustar max_tokens directamente");
    expect(mensaje).not.toContain("sesion-interna");
    expect(mensaje).not.toContain("cf-ray");
    const detalle = detalleDelProveedor("", "", [evento as never]);
    expect(esErrorDeCuota(new ErrorAgente(mensaje, detalle))).toBe(false);
  });

  test("explica un error temporal de servidor del proveedor con sugerencia clara", () => {
    const evento = {
      type: "error",
      error: {
        message: "Unexpected server error. Check server logs for details.",
      },
    };
    const mensaje = explicarErrorProveedor(evento);
    expect(mensaje).toContain("error temporal en sus servidores");
    expect(mensaje).toContain("Unexpected server error");
    expect(mensaje).toContain("selecciona otro modelo");
  });

  test("ErrorCuota nombra el modelo y ya es cuota", () => {
    const err = new ErrorCuota("opencode/big-pickle", "s-1");
    expect(err.message).toBe("Se acabó la cuota del modelo opencode/big-pickle.");
    expect(err.modelo).toBe("opencode/big-pickle");
    expect(err.sessionId).toBe("s-1");
    expect(esErrorDeCuota(err)).toBe(true);
  });
});

describe("migración 020", () => {
  test("tasks acepta el estado sin_cuota y guarda el modelo agotado", () => {
    const id = tarea("sin_cuota", { modeloAgotado: "opencode/a" });
    const fila = db.query<{ status: string; modelo_agotado: string }, [string]>(
      "SELECT status, modelo_agotado FROM tasks WHERE id = ?",
    ).get(id);
    expect(fila).toEqual({ status: "sin_cuota", modelo_agotado: "opencode/a" });
  });

  test("un chat nuevo no tiene cuota agotada", () => {
    const id = crypto.randomUUID();
    db.query("INSERT INTO conversations (id, title) VALUES (?, 'Nuevo')").run(id);
    const fila = db.query<{ cuota_modelo: string | null }, [string]>("SELECT cuota_modelo FROM conversations WHERE id = ?").get(id);
    expect(fila?.cuota_modelo).toBeNull();
  });
});

describe("seguir una tarea sin cuota", () => {
  test("una tarea que no está sin cuota no se puede seguir", async () => {
    const id = tarea("done", { sesion: "s-1" });
    const res = await post(`/api/tasks/${id}/seguir`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "task_not_continuable" });
  });

  test("elegir el mismo modelo que se quedó sin cuota se rechaza", async () => {
    const id = tarea("sin_cuota", { model: "opencode/a", modeloAgotado: "opencode/a", sesion: "s-1" });
    const res = await post(`/api/tasks/${id}/seguir`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "modelo_sin_cambio" });
    const estado = db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id);
    expect(estado?.status).toBe("sin_cuota");
  });

  test("si el modelo no se puede validar, la tarea sigue detenida", async () => {
    const id = tarea("sin_cuota", { model: "opencode/a", modeloAgotado: "opencode/a", sesion: "s-1" });
    const res = await post(`/api/tasks/${id}/seguir`, { model: "opencode/b" });
    expect(res.status).not.toBe(200);
    const estado = db.query<{ status: string; model: string }, [string]>("SELECT status, model FROM tasks WHERE id = ?").get(id);
    expect(estado).toEqual({ status: "sin_cuota", model: "opencode/a" });
  });
});

describe("seguir un chat sin cuota", () => {
  test("un chat sin cuota agotada no tiene nada que seguir", async () => {
    const id = conversacion("opencode/a", null);
    const res = await post(`/api/conversations/${id}/seguir`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "chat_sin_cuota" });
  });

  test("elegir el mismo modelo que se quedó sin cuota se rechaza", async () => {
    const id = conversacion("opencode/a", "opencode/a");
    const res = await post(`/api/conversations/${id}/seguir`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "modelo_sin_cambio" });
  });

  test("la lista de chats informa la cuota agotada", async () => {
    const id = conversacion("opencode/c", "opencode/a");
    const lista = (await (await app.request("/api/conversations")).json()) as { id: string; cuota_modelo: string | null }[];
    expect(lista.find((c) => c.id === id)?.cuota_modelo).toBe("opencode/a");
  });
});
