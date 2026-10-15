import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

// Turnos del chat en segundo plano: el POST guarda el mensaje y responde 202; la respuesta llega después,
// y un fallo queda como aviso del sistema. `opencode` falso al frente del PATH, con TELO_AISLAMIENTO=desactivado.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { chat, avisarTurnosInterrumpidos } = await import("../src/routes/chat");

const app = new Hono();
app.route("/api", chat);

type Mensaje = { id: string; role: string; content: string };

const RESTAURAR = { PATH: process.env.PATH, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO };
let carpeta = "";

beforeAll(() => {
  carpeta = mkdtempSync(join(tmpdir(), "telo-turnos-"));
  const bin = join(carpeta, "bin");
  mkdirSync(bin);
  // Con LENTO tarda 1,5 s; con FALLO sale con error; en otro caso responde al instante.
  writeFileSync(
    join(bin, "opencode"),
    `#!/bin/sh
for a in "$@"; do ultimo="$a"; done
case "$ultimo" in *LENTO*) sleep 1.5 ;; esac
case "$ultimo" in *FALLO*) echo "error interno del agente" >&2; exit 1 ;; esac
echo '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"Respuesta lista."}}'
`,
  );
  chmodSync(join(bin, "opencode"), 0o755);
  process.env.PATH = `${bin}:${RESTAURAR.PATH ?? ""}`;
  process.env.TELO_AISLAMIENTO = "desactivado";
});

afterAll(() => {
  for (const [clave, valor] of Object.entries(RESTAURAR)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  rmSync(carpeta, { recursive: true, force: true });
});

function conversacion(): string {
  const id = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, title, model) VALUES (?, 'Chat de prueba', 'opencode/prueba')").run(id);
  return id;
}

function mensajes(id: string): Mensaje[] {
  return db
    .query<Mensaje, [string]>("SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(id);
}

// Espera a que `cumple` sea verdadero; si no llega a tiempo, la prueba falla con el motivo.
async function esperar(cumple: () => boolean, ms = 10_000): Promise<void> {
  const inicio = Date.now();
  while (!cumple()) {
    if (Date.now() - inicio > ms) throw new Error("La condición no se cumplió a tiempo");
    await Bun.sleep(40);
  }
}

function enviar(id: string, content: string) {
  return app.request(`/api/conversations/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

describe("turno del chat en segundo plano", () => {
  test("el POST responde 202 antes de que el agente termine, y la respuesta llega después", async () => {
    const id = conversacion();
    const inicio = Date.now();
    const res = await enviar(id, "Revisa el catálogo LENTO");
    const tardo = Date.now() - inicio;

    expect(res.status).toBe(202);
    expect(tardo).toBeLessThan(1000);
    const cuerpo = (await res.json()) as { messages: Mensaje[] };
    expect(cuerpo.messages[0]).toMatchObject({ role: "user", content: "Revisa el catálogo LENTO" });

    // Mientras corre, la lista de chats dice que está ocupado: así lo ven también los demás dispositivos.
    const lista = (await (await app.request("/api/conversations")).json()) as { id: string; ocupada: boolean }[];
    expect(lista.find((c) => c.id === id)?.ocupada).toBe(true);

    // Sin cliente conectado de por medio, la respuesta queda guardada cuando el agente termina.
    await esperar(() => mensajes(id).some((m) => m.role === "assistant"));
    expect(mensajes(id).find((m) => m.role === "assistant")?.content).toBe("Respuesta lista.");
    const despues = (await (await app.request("/api/conversations")).json()) as { id: string; ocupada: boolean }[];
    expect(despues.find((c) => c.id === id)?.ocupada).toBe(false);
  });

  test("un segundo mensaje mientras responde se rechaza con conversation_busy", async () => {
    const id = conversacion();
    expect((await enviar(id, "Primera pregunta LENTO")).status).toBe(202);
    const segundo = await enviar(id, "Segunda pregunta");
    expect(segundo.status).toBe(409);
    expect(await segundo.json()).toEqual({ error: "conversation_busy" });
    await esperar(() => mensajes(id).some((m) => m.role === "assistant"));
    // El segundo no quedó guardado: el rechazo ocurre antes de guardar nada.
    expect(mensajes(id).filter((m) => m.role === "user")).toHaveLength(1);
  });

  test("un fallo del agente queda como aviso del sistema en el chat", async () => {
    const id = conversacion();
    expect((await enviar(id, "Haz algo FALLO")).status).toBe(202);
    await esperar(() => mensajes(id).some((m) => m.role === "system"));
    const aviso = mensajes(id).find((m) => m.role === "system");
    expect(aviso?.content.startsWith("No se pudo responder.")).toBe(true);
    expect(mensajes(id).some((m) => m.role === "assistant")).toBe(false);
  });
});

describe("reinicio del servidor", () => {
  test("un chat cuyo último mensaje es del usuario recibe un aviso; los demás no", () => {
    const sinRespuesta = conversacion();
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'pregunta perdida')").run(
      crypto.randomUUID(),
      sinRespuesta,
    );
    const completa = conversacion();
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'pregunta')").run(
      crypto.randomUUID(),
      completa,
    );
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', 'respuesta')").run(
      crypto.randomUUID(),
      completa,
    );

    expect(avisarTurnosInterrumpidos()).toBeGreaterThanOrEqual(1);
    const ultimo = mensajes(sinRespuesta).at(-1);
    expect(ultimo?.role).toBe("system");
    expect(ultimo?.content).toContain("se reinició");
    expect(mensajes(completa).at(-1)?.role).toBe("assistant");

    // Un segundo arranque no repite el aviso: ya no es el último mensaje.
    const antes = mensajes(sinRespuesta).length;
    avisarTurnosInterrumpidos();
    expect(mensajes(sinRespuesta).length).toBe(antes);
  });
});
