import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
process.env.PATH = `${join(import.meta.dir, "fixtures", "bin")}${delimiter}${process.env.PATH ?? ""}`;

const { db } = await import("../src/db");
const { ErrorCuota, esErrorDeCuota, esErrorTransitorioDelProveedor } = await import("../src/ejecutar");
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
  test("una tarea terminada sin copia Git devuelve sin_repo, incluso con metadatos antiguos", async () => {
    for (const conMetadatos of [false, true]) {
      const id = tarea("failed");
      if (conMetadatos) db.query("UPDATE tasks SET rama='telo/prueba', base_commit=? WHERE id=?").run("a".repeat(40), id);
      try {
        const response = await app.request(`/api/tasks/${id}/diff`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ estado: "sin_repo", archivos: [], hash: null });
      } finally { db.query("DELETE FROM tasks WHERE id=?").run(id); }
    }
    expect((await app.request(`/api/tasks/${crypto.randomUUID()}/diff`)).status).toBe(404);
  });

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
  test("el rate limit temporal no se confunde con una cuota agotada", () => {
    expect(esErrorDeCuota(new Error('opencode salió con código 1: {"error":{"message":"Rate limit exceeded (429)"}}'))).toBe(false);
    expect(esErrorDeCuota(new Error('opencode salió con código 1: {"error":{"message":"429 Too Many Requests"}}'))).toBe(false);
    expect(esErrorDeCuota(new Error('opencode salió con código 1: {"error":{"message":"Quota exceeded for this model"}}'))).toBe(true);
    expect(esErrorDeCuota(new Error('opencode salió con código 1: {"error":{"code":"insufficient_quota"}}'))).toBe(true);
    expect(esErrorDeCuota(new Error("Insufficient account funds"))).toBe(true);
    expect(esErrorDeCuota(new Error("usage limit reached for this model"))).toBe(true);
  });

  test("una ruta con una palabra como «cuota» no cuenta: solo el detalle del proveedor", () => {
    // Sin evento de error, la cola de la salida se mira sin rutas: una carpeta «cuota-app» no cuenta.
    const sinEvento = detalleDelProveedor("", "TypeError at /home/x/cuota-app/bin/opencode:21", []);
    expect(esErrorDeCuota(new ErrorAgente("opencode salió con código 1", sinEvento))).toBe(false);
    // El rate limit del proveedor es temporal, aunque aparezca como evento de error.
    const evento = { type: "error", error: { data: { message: "Rate limit exceeded" } } } as const;
    const conEvento = detalleDelProveedor("", "", [evento as never]);
    expect(esErrorDeCuota(new ErrorAgente("opencode salió con código 1", conEvento))).toBe(false);
    const cuota = { type: "error", error: { data: { message: "Quota exceeded" } } } as const;
    expect(esErrorDeCuota(new ErrorAgente("opencode salió con código 1", detalleDelProveedor("", "", [cuota as never])))).toBe(true);
  });

  test("solo 429 y 5xx HTTP explícitos habilitan el modelo de respaldo", () => {
    const errorHttp = (statusCode: number) => new ErrorAgente(
      "opencode salió con código 1",
      JSON.stringify({ type: "error", error: { data: { statusCode, message: `Error ${statusCode}` } } }),
    );
    expect(esErrorTransitorioDelProveedor(errorHttp(429))).toBe(true);
    expect(esErrorTransitorioDelProveedor(errorHttp(500))).toBe(true);
    expect(esErrorTransitorioDelProveedor(errorHttp(599))).toBe(true);
    expect(esErrorTransitorioDelProveedor(errorHttp(401))).toBe(false);
    expect(esErrorTransitorioDelProveedor(errorHttp(422))).toBe(false);
    const eventoOpenCodeSinEstado = {
      type: "error",
      error: { name: "APIError", data: { message: "Unexpected server error. Check server logs for details." } },
    };
    const errorOpenCodeSinEstado = new ErrorAgente(
      "opencode salió con código 1",
      detalleDelProveedor("", "", [eventoOpenCodeSinEstado as never]),
    );
    expect(esErrorTransitorioDelProveedor(errorOpenCodeSinEstado)).toBe(true);
    expect(esErrorTransitorioDelProveedor(new ErrorAgente(
      "Fallo",
      JSON.stringify({ type: "error", statusCode: null, message: "Unauthorized" }),
    ))).toBe(false);
    expect(esErrorTransitorioDelProveedor(new ErrorAgente("Fallo", "Unexpected server error"))).toBe(false);
    expect(esErrorTransitorioDelProveedor(new Error("fallo local 503"))).toBe(false);
  });

  test("el mensaje envuelto de reintentos agotados no rompe la clasificación", () => {
    const envuelto = (statusCode: number) => {
      const base = new ErrorAgente(
        "opencode salió con código 1",
        JSON.stringify({ type: "error", error: { data: { statusCode, message: `Error ${statusCode}` } } }),
      );
      return new ErrorAgente(
        `${base.message} Telo lo reintentó automáticamente 3 veces con esperas de hasta 30 s y siguió fallando. Puedes usar «Seguir» (o responder «siga») para retomar la misma sesión.`,
        base.detalleProveedor,
      );
    };
    expect(esErrorTransitorioDelProveedor(envuelto(503))).toBe(true);
    expect(esErrorTransitorioDelProveedor(envuelto(429))).toBe(true);
    expect(esErrorTransitorioDelProveedor(envuelto(401))).toBe(false);
  });

  test("conserva el estado HTTP aunque el evento del proveedor tenga metadatos extensos", () => {
    const evento = {
      type: "error",
      sessionID: "sesion-interna",
      error: {
        name: "APIError",
        data: {
          message: `Unexpected server error ${"x".repeat(1_000)}`,
          statusCode: 503,
          responseHeaders: { "x-debug": "metadatos internos" },
        },
      },
    };
    const detalle = detalleDelProveedor("", "", [evento as never]);
    expect(detalle).toContain('"statusCode":503');
    expect(detalle).not.toContain("sesion-interna");
    expect(detalle).not.toContain("responseHeaders");
    expect(esErrorTransitorioDelProveedor(new ErrorAgente("fallo del proveedor", detalle))).toBe(true);
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

describe("aprobación del plan con hash revisado", () => {
  const hash = "a".repeat(64);
  const plan = JSON.stringify({ objetivo: "Prueba", pasos: [], criterios_de_aceptacion: [] });

  function pendiente() {
    const id = tarea("waiting_approval");
    db.query("UPDATE tasks SET plan=?, plan_hash=? WHERE id=?").run(plan, hash, id);
    return id;
  }

  test("rechaza si falta el hash o no coincide y mantiene el plan en espera", async () => {
    const id = pendiente();
    try {
      const sinHash = await post(`/api/tasks/${id}/aprobar-plan`, { notas: "aprobar" });
      expect(sinHash.status).toBe(400);

      const stale = await post(`/api/tasks/${id}/aprobar-plan`, { plan_hash: "b".repeat(64) });
      expect(stale.status).toBe(409);

      expect(db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id=?").get(id)?.status)
        .toBe("waiting_approval");
    } finally {
      db.query("DELETE FROM tasks WHERE id=?").run(id);
    }
  });

  test("aprueba y registra el mismo hash revisado", async () => {
    const id = pendiente();
    try {
      const response = await post(`/api/tasks/${id}/aprobar-plan`, { plan_hash: hash });
      expect(response.status).toBe(200);
      const fila = db.query<{ status: string; approved_hash: string | null }, [string]>(
        "SELECT status, approved_hash FROM tasks WHERE id=?",
      ).get(id);
      expect(fila).toEqual({ status: "queued", approved_hash: hash });
    } finally {
      db.query("DELETE FROM tasks WHERE id=?").run(id);
    }
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

  test("si el modelo no se puede validar, la tarea sigue detenida", { timeout: 15000 }, async () => {
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
