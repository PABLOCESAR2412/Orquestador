import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA_PRUEBA = mkdtempSync(join(tmpdir(), "telo-subchats-"));
process.env.DATA_DIR = DATA_PRUEBA;
const { db } = await import("../src/db");
const { registrarEventoSubagente, cerrarSubagentesDelTurno } = await import("../src/subagentes-chat");
const { chat } = await import("../src/routes/chat");

afterAll(() => {
  db.close();
  rmSync(DATA_PRUEBA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("subchats de subagentes", () => {
  test("guarda una sola conversación, la actividad y el resultado real del hijo", async () => {
    const padre = crypto.randomUUID();
    const turno = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title,model) VALUES (?, 'Revisión', 'openai/gpt-4.1-mini')").run(padre);
    const captura = {
      parentConversationId: padre,
      parentTurnId: turno,
      workspace: join(DATA_PRUEBA, "workspace"),
      configDir: join(DATA_PRUEBA, "perfiles-subagente", "run"),
      model: "openai/gpt-4.1-mini",
    };
    const evento = (kind: string, extra: Record<string, unknown> = {}) => registrarEventoSubagente({
      ...captura,
      eventLine: JSON.stringify({ kind, sessionId: "ses_hijo-1", ...extra }),
    });

    evento("created", { title: "Revisar API", agent: "telo-gpt-1", prompt: "Revisa las rutas y reporta riesgos" });
    evento("created", { title: "Actualización repetida" });
    const hija = db.query<{ id: string; subagent_turn_id: string; subagent_status: string; subagent_prompt: string }, [string]>(
      "SELECT id,subagent_turn_id,subagent_status,subagent_prompt FROM conversations WHERE parent_conversation_id=?",
    ).get(padre)!;
    expect(hija.subagent_status).toBe("running");
    expect(hija.subagent_prompt).toBe("Revisa las rutas y reporta riesgos");
    expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM conversations WHERE parent_conversation_id=?").get(padre)?.n).toBe(1);

    evento("activity", {
      line: JSON.stringify({
        type: "tool",
        sessionID: "ses_hijo-1",
        part: { type: "tool", tool: "read", callID: "call-1", state: { status: "running", input: { filePath: "src/routes.ts" } } },
      }),
    });
    expect(db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM chat_actividad WHERE conversation_id=? AND turno_id=?").get(hija.id, hija.subagent_turn_id)?.n).toBe(1);

    evento("result", { status: "done", result: "Revisé las rutas y no encontré problemas." });
    const terminado = db.query<{ subagent_status: string; subagent_result: string }, [string]>(
      "SELECT subagent_status,subagent_result FROM conversations WHERE id=?",
    ).get(hija.id)!;
    expect(terminado.subagent_status).toBe("done");
    expect(terminado.subagent_result).toBe("Revisé las rutas y no encontré problemas.");
    expect(db.query<{ content: string }, [string]>("SELECT content FROM messages WHERE conversation_id=? AND role='assistant'").get(hija.id)?.content)
      .toBe(terminado.subagent_result);

    const conversaciones = await chat.request("/conversations");
    const filas = await conversaciones.json() as { id: string; subchats?: { id: string; subagent_status: string }[] }[];
    expect(filas.find((fila) => fila.id === padre)?.subchats?.[0]).toMatchObject({ id: hija.id, subagent_status: "done" });

    const endpoint = await chat.request(`/conversations/${padre}/turnos/${turno}/subagentes`);
    expect(endpoint.status).toBe(200);
    expect(await endpoint.json()).toMatchObject([{ id: hija.id, subagent_result: terminado.subagent_result }]);
  });

  test("marca como interrumpidos solo los subchats que siguen en curso", () => {
    const padre = crypto.randomUUID();
    const turno = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title,model) VALUES (?, 'Tarea cancelada', 'openai/gpt-4.1-mini')").run(padre);
    const captura = {
      parentConversationId: padre,
      parentTurnId: turno,
      workspace: DATA_PRUEBA,
      configDir: DATA_PRUEBA,
      model: "openai/gpt-4.1-mini",
      eventLine: JSON.stringify({ kind: "created", sessionId: "ses_hijo-2", prompt: "Inspección" }),
    };
    registrarEventoSubagente(captura);
    cerrarSubagentesDelTurno(padre, turno, "interrupted");
    expect(db.query<{ subagent_status: string }, [string]>(
      "SELECT subagent_status FROM conversations WHERE parent_conversation_id=?",
    ).get(padre)?.subagent_status).toBe("interrupted");
  });

  test("no declara completado un subagente sin evento de resultado al terminar el agente principal", () => {
    const padre = crypto.randomUUID();
    const turno = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title,model) VALUES (?, 'Supervisor terminado', 'openai/gpt-4.1-mini')").run(padre);
    registrarEventoSubagente({
      parentConversationId: padre,
      parentTurnId: turno,
      workspace: DATA_PRUEBA,
      configDir: DATA_PRUEBA,
      model: "openai/gpt-4.1-mini",
      eventLine: JSON.stringify({ kind: "created", sessionId: "ses_hijo-pendiente", prompt: "Verificar trabajo" }),
    });
    cerrarSubagentesDelTurno(padre, turno, "done");
    expect(db.query<{ subagent_status: string }, [string]>(
      "SELECT subagent_status FROM conversations WHERE parent_conversation_id=?",
    ).get(padre)?.subagent_status).toBe("interrupted");
  });

  test("mantiene los subchats en modo de seguimiento y rechaza nuevos envíos", async () => {
    const padre = crypto.randomUUID();
    const hija = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title,model) VALUES (?, 'Supervisor', 'openai/gpt-4.1-mini')").run(padre);
    db.query("INSERT INTO conversations (id,title,model,parent_conversation_id,parent_turn_id,subagent_status) VALUES (?, 'Subagente', 'openai/gpt-4.1-mini', ?, ?, 'done')")
      .run(hija, padre, crypto.randomUUID());

    const mensaje = await chat.request(`/conversations/${hija}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continúa desde aquí" }),
    });
    expect(mensaje.status).toBe(409);
    expect(await mensaje.json()).toEqual({ error: "subagent_read_only" });

    const adjunto = await chat.request(`/conversations/${hija}/adjuntos`, { method: "POST", body: new FormData() });
    expect(adjunto.status).toBe(409);
    expect(await adjunto.json()).toEqual({ error: "subagent_read_only" });

    const seguir = await chat.request(`/conversations/${hija}/seguir`, { method: "POST", body: "{}" });
    expect(seguir.status).toBe(409);
    expect(await seguir.json()).toEqual({ error: "subagent_read_only" });
  });
});
