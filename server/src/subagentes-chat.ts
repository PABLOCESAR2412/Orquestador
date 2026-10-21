import { db } from "./db";
import { itemDeLinea, registrarActividad } from "./actividad";

type Captura = {
  parentConversationId: string;
  parentTurnId: string;
  workspace: string;
  configDir: string;
  model: string;
  eventLine: string;
};

type EventoSubagente = {
  kind?: unknown;
  sessionId?: unknown;
  title?: unknown;
  agent?: unknown;
  model?: unknown;
  prompt?: unknown;
  line?: unknown;
  status?: unknown;
  result?: unknown;
};

const texto = (valor: unknown, max: number): string =>
  typeof valor === "string" ? valor.trim().slice(0, max) : "";

function conversacionHija(parentId: string, sessionId: string) {
  return db.query<{
    id: string;
    subagent_turn_id: string;
    subagent_status: string | null;
  }, [string, string]>(
    "SELECT id, subagent_turn_id, subagent_status FROM conversations WHERE parent_conversation_id=? AND subagent_session_id=?",
  ).get(parentId, sessionId);
}

function crearSubchat(captura: Captura, evento: EventoSubagente, sessionId: string): string | null {
  const padre = db.query<{
    model: string | null;
    effort: string | null;
    project_id: string | null;
  }, [string]>("SELECT model,effort,project_id FROM conversations WHERE id=?").get(captura.parentConversationId);
  if (!padre) return null;

  const total = db.query<{ total: number }, [string, string]>(
    "SELECT COUNT(*) AS total FROM conversations WHERE parent_conversation_id=? AND parent_turn_id=?",
  ).get(captura.parentConversationId, captura.parentTurnId)?.total ?? 0;
  if (total >= 100) return null;

  const id = crypto.randomUUID();
  const turnoId = crypto.randomUUID();
  const prompt = texto(evento.prompt, 20_000) || texto(evento.title, 300) || "Tarea delegada por el agente principal.";
  const title = texto(evento.title, 80) || prompt.replace(/\s+/g, " ").slice(0, 80) || "Subagente";
  const modeloEvento = texto(evento.model, 200);
  const modelo = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:/-]+$/.test(modeloEvento) ? modeloEvento : captura.model || padre.model;
  const agente = texto(evento.agent, 100) || "Subagente";

  db.transaction(() => {
    db.query(`
      INSERT INTO conversations (
        id, project_id, title, model, effort, runner_session_id, runner_session_model,
        parent_conversation_id, parent_turn_id, subagent_turn_id, subagent_session_id,
        subagent_agent, subagent_prompt, subagent_status, subagent_workspace, subagent_config_dir
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      id,
      padre.project_id,
      title,
      modelo,
      padre.effort,
      sessionId,
      modelo,
      captura.parentConversationId,
      captura.parentTurnId,
      turnoId,
      sessionId,
      agente,
      prompt,
      captura.workspace,
      captura.configDir,
    );
    db.query("INSERT INTO messages (id,conversation_id,role,content,model,effort) VALUES (?,?, 'user', ?, ?, ?)")
      .run(turnoId, id, prompt, modelo, padre.effort);
  })();
  return id;
}

// Convierte los eventos del plugin temporal de OpenCode en chats y acciones normales de Telo.
export function registrarEventoSubagente(captura: Captura): void {
  if (captura.eventLine.length > 100_000) return;
  let evento: EventoSubagente;
  try {
    evento = JSON.parse(captura.eventLine) as EventoSubagente;
  } catch {
    return;
  }
  const sessionId = texto(evento.sessionId, 128);
  if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) return;

  let hija = conversacionHija(captura.parentConversationId, sessionId);
  if (evento.kind === "created" && !hija) {
    const id = crearSubchat(captura, evento, sessionId);
    if (!id) return;
    hija = conversacionHija(captura.parentConversationId, sessionId);
  }
  if (!hija) return;

  if (evento.kind === "activity") {
    const linea = texto(evento.line, 80_000);
    const item = linea ? itemDeLinea(linea) : null;
    if (item) registrarActividad(hija.id, hija.subagent_turn_id, item);
    return;
  }

  if (evento.kind === "status") {
    const estado = evento.status === "failed" || evento.status === "cancelled" || evento.status === "interrupted"
      ? evento.status
      : "done";
    db.query("UPDATE conversations SET subagent_status=? WHERE id=? AND subagent_status='running'").run(estado, hija.id);
    return;
  }

  if (evento.kind === "result") {
    const estado = evento.status === "failed" ? "failed" : evento.status === "cancelled" ? "cancelled" : "done";
    const resultado = texto(evento.result, 30_000);
    db.transaction(() => {
      db.query("UPDATE conversations SET subagent_status=?, subagent_result=? WHERE id=?")
        .run(estado, resultado || null, hija.id);
      if (resultado) {
        const asistente = db.query<{ id: string }, [string]>(
          "SELECT id FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1",
        ).get(hija.id);
        if (asistente) db.query("UPDATE messages SET content=? WHERE id=?").run(resultado, asistente.id);
        else db.query("INSERT INTO messages (id,conversation_id,role,content,model,effort) SELECT ?,id,'assistant',?,model,effort FROM conversations WHERE id=?")
          .run(crypto.randomUUID(), resultado, hija.id);
      }
    })();
  }
}

export function cerrarSubagentesDelTurno(
  parentConversationId: string,
  parentTurnId: string,
  estado: "done" | "failed" | "cancelled" | "interrupted",
): void {
  // Si el proceso principal terminó pero no llegó un evento de resultado del hijo,
  // no afirmamos que el trabajo terminó: su estado queda como interrumpido.
  const estadoFinal = estado === "done" ? "interrupted" : estado;
  db.query("UPDATE conversations SET subagent_status=? WHERE parent_conversation_id=? AND parent_turn_id=? AND subagent_status='running'")
    .run(estadoFinal, parentConversationId, parentTurnId);
}
