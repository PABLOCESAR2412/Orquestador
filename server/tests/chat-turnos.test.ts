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
  // Con LENTO tarda 1,5 s; las pruebas concurrentes incluyen modelo y prompt en la respuesta.
  writeFileSync(
    join(bin, "opencode"),
    `#!/bin/sh
anterior=""
for a in "$@"; do
  if [ "$anterior" = "-m" ]; then modelo="$a"; fi
  if [ "$anterior" = "-s" ]; then sesion="$a"; fi
  if [ "$anterior" = "--variant" ]; then variante="$a"; fi
  case "$a" in *HISTORIA-ANTERIOR*) historial="si" ;; esac
  anterior="$a"
  ultimo="$a"
done
case "$ultimo" in *LENTO*) sleep 1.5 ;; esac
case "$ultimo" in *FALLO*) echo "error interno del agente" >&2; exit 1 ;; esac
case "$ultimo" in *CAMBIO-MODELO*) printf '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"modelo=%s;sesion=%s;variante=%s;historial=%s"}}\\n' "$modelo" "\${sesion:-nueva}" "\${variante:-auto}" "\${historial:-no}"; exit 0 ;; esac
case "$ultimo" in *CONCURRENTE*) id=$(printf '%s' "$ultimo" | sed -n 's/.*CONCURRENTE-\\([0-9][0-9]*\\) LENTO.*/\\1/p'); printf '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"%s: %s"}}\\n' "$modelo" "$id"; exit 0 ;; esac
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

function conversacion(model = "opencode/prueba"): string {
  const id = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, title, model) VALUES (?, 'Chat de prueba', ?)").run(id, model);
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

// Estas pruebas lanzan grupos de procesos con `setsid`, igual que el servidor Linux.
describe.skipIf(!Bun.which("setsid"))("turno del chat en segundo plano", () => {
  test("diez conversaciones responden en paralelo y cada una conserva su modelo y su mensaje", async () => {
    const lote = Array.from({ length: 10 }, (_, i) => ({
      id: conversacion(`opencode/modelo-${i % 3}`),
      prompt: `CONCURRENTE-${i} LENTO`,
    }));
    const inicio = Date.now();
    const respuestas = await Promise.all(lote.map(({ id, prompt }) => enviar(id, prompt)));
    expect(respuestas.map((respuesta) => respuesta.status)).toEqual(Array(10).fill(202));

    await esperar(() => lote.every(({ id }) => mensajes(id).some((mensaje) => mensaje.role === "assistant")));
    expect(Date.now() - inicio).toBeLessThan(8_000);
    for (let i = 0; i < lote.length; i++) {
      const { id, prompt } = lote[i]!;
      const respuesta = mensajes(id).find((mensaje) => mensaje.role === "assistant");
      expect(respuesta?.content).toBe(`opencode/modelo-${i % 3}: ${i}`);
    }
  }, 15_000);

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

  test("al cambiar de modelo no reutiliza la sesión anterior y recupera el historial; cambiar esfuerzo conserva la sesión", async () => {
    const id = conversacion("opencode/modelo-a");
    db.query("UPDATE conversations SET runner_session_id='ses_turno01', runner_session_model='opencode/modelo-a' WHERE id=?").run(id);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','Pregunta anterior')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'assistant','HISTORIA-ANTERIOR')")
      .run(crypto.randomUUID(), id);

    db.query("UPDATE conversations SET model='opencode/modelo-b', effort='high' WHERE id=?").run(id);
    expect((await enviar(id, "CAMBIO-MODELO")).status).toBe(202);
    await esperar(() => mensajes(id).some((m) => m.role === "assistant"));
    expect(mensajes(id).find((m) => m.role === "assistant")?.content).toContain(
      "modelo=opencode/modelo-b;sesion=nueva;variante=high;historial=si",
    );
    expect(db.query<{ runner_session_model: string }, [string]>(
      "SELECT runner_session_model FROM conversations WHERE id=?",
    ).get(id)?.runner_session_model).toBe("opencode/modelo-b");

    db.query("UPDATE conversations SET effort='low' WHERE id=?").run(id);
    expect((await enviar(id, "CAMBIO-MODELO")).status).toBe(202);
    await esperar(() => mensajes(id).filter((m) => m.role === "assistant").length === 2);
    expect(mensajes(id).filter((m) => m.role === "assistant")[1]?.content).toContain(
      "modelo=opencode/modelo-b;sesion=ses_turno01;variante=low;historial=no",
    );
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

describe("cuota agotada en chats de proyecto", () => {
  test("muestra la tarea detenida y rechaza mensajes nuevos hasta cambiar de modelo", async () => {
    const projectId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const modeloAgotado = "openai/gpt-6-luna";
    db.query("INSERT INTO projects (id, name) VALUES (?, 'Proyecto con cuota agotada')").run(projectId);
    db.query("INSERT INTO conversations (id, title, model, project_id) VALUES (?, 'Chat con cuota agotada', ?, ?)")
      .run(conversationId, modeloAgotado, projectId);
    db.query("INSERT INTO tasks (id, title, prompt, model, status, project_id, conversation_id, modelo_agotado) VALUES (?, 'Tarea detenida', 'pregunta original', ?, 'sin_cuota', ?, ?, ?)")
      .run(taskId, "openai/gpt-6-luna", projectId, conversationId, modeloAgotado);

    const tareas = await app.request(`/api/conversations/${conversationId}/tasks`);
    expect((await tareas.json() as { modelo_agotado: string }[])[0]?.modelo_agotado).toBe(modeloAgotado);

    const segundo = await enviar(conversationId, "otra pregunta");
    expect(segundo.status).toBe(409);
    expect(await segundo.json()).toEqual({ error: "chat_quota_pending" });
    expect(mensajes(conversationId)).toHaveLength(0);

    const mismoModelo = await app.request(`/api/conversations/${conversationId}/seguir`, { method: "POST" });
    expect(mismoModelo.status).toBe(409);
    expect(await mismoModelo.json()).toEqual({ error: "modelo_sin_cambio" });

    const otroModelo = "google/gemini-test";
    db.query("UPDATE conversations SET model = ? WHERE id = ?").run(otroModelo, conversationId);
    const continuar = await app.request(`/api/conversations/${conversationId}/seguir`, { method: "POST" });
    expect(continuar.status).toBe(202);
    expect(await continuar.json()).toMatchObject({ taskId });
    expect(db.query<{ status: string; model: string; continuar: number }, [string]>(
      "SELECT status,model,continuar FROM tasks WHERE id = ?",
    ).get(taskId)).toEqual({ status: "queued", model: otroModelo, continuar: 1 });
    expect(db.query<{ cuota_modelo: string | null }, [string]>("SELECT cuota_modelo FROM conversations WHERE id = ?")
      .get(conversationId)?.cuota_modelo).toBeNull();
  });
});
