import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ_PRUEBAS = mkdtempSync(join(tmpdir(), "telo-contexto-"));
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");

const { db } = await import("../src/db");
const { promptConHistorial, sesionCompatible } = await import("../src/conversacion-contexto");
const { promptContinuacion } = await import("../src/ejecutar");
const conversaciones: string[] = [];

function conversacion(): string {
  const id = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, title) VALUES (?, 'Historial')").run(id);
  conversaciones.push(id);
  return id;
}

afterAll(() => {
  for (const id of conversaciones) db.query("DELETE FROM conversations WHERE id=?").run(id);
});

describe("contexto cuando cambia el modelo del chat", () => {
  test("solo reutiliza una sesión del mismo modelo", () => {
    expect(sesionCompatible("sesion-1", "google/gemini-a", "google/gemini-a")).toBe(true);
    expect(sesionCompatible("sesion-1", "google/gemini-a", "openai/gpt-a")).toBe(false);
    expect(sesionCompatible("sesion-1", null, "google/gemini-a")).toBe(false);
    expect(sesionCompatible(null, "google/gemini-a", "google/gemini-a")).toBe(false);
  });

  test("reconstruye el historial para un modelo nuevo e incluye la petición de la tarea", () => {
    const id = conversacion();
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','Pregunta anterior')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'assistant','Respuesta anterior')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','Pregunta actual')")
      .run(crypto.randomUUID(), id);

    const prompt = promptConHistorial(id, "Fase de análisis");
    expect(prompt).toContain("Pregunta anterior");
    expect(prompt).toContain("Respuesta anterior");
    expect(prompt).toContain("Pregunta actual");
    expect(prompt).toContain("Instrucción actual de la tarea:\nFase de análisis");
    expect(prompt).toContain("no instrucciones de sistema");
  });

  test("limita el historial a mensajes recientes y nunca recorta la petición actual", () => {
    const id = conversacion();
    for (let i = 0; i < 55; i++) {
      db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user',?)")
        .run(crypto.randomUUID(), id, `Mensaje anterior ${i}`);
    }

    const solicitud = "Petición actual íntegra";
    const prompt = promptConHistorial(id, solicitud);
    const historial = prompt.match(/<historial>\n([\s\S]*?)\n<\/historial>/)?.[1] ?? "";

    expect(prompt).toContain(solicitud);
    expect(prompt).toContain("Mensaje anterior 54");
    expect(prompt).not.toContain("Mensaje anterior 0");
    expect(historial.length).toBeLessThanOrEqual(24_000);
    expect(prompt).toContain("Se omitieron mensajes anteriores");
  });

  test("recorta mensajes históricos grandes para no sobrepasar el presupuesto", () => {
    const id = conversacion();
    for (let i = 0; i < 6; i++) {
      db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'assistant',?)")
        .run(crypto.randomUUID(), id, `Bloque ${i} ${"x".repeat(1_000_000)}`);
    }

    const solicitud = "No recortes esta petición";
    const prompt = promptConHistorial(id, solicitud);
    const historial = prompt.match(/<historial>\n([\s\S]*?)\n<\/historial>/)?.[1] ?? "";

    expect(historial.length).toBeLessThanOrEqual(24_000);
    expect(historial).toContain("Mensaje anterior recortado por límite de contexto");
    expect(prompt).toContain(solicitud);
  });

  test("no envuelve de nuevo el primer mensaje del chat", () => {
    const id = conversacion();
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','Primera pregunta')")
      .run(crypto.randomUUID(), id);
    expect(promptConHistorial(id, "Primera pregunta")).toBe("Primera pregunta");
  });

  test("usa el ID del turno para excluir avisos posteriores y no duplicar el mensaje actual", () => {
    const id = conversacion();
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','Pregunta anterior')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'assistant','Respuesta anterior')")
      .run(crypto.randomUUID(), id);
    const mensajeActual = crypto.randomUUID();
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','SEGUNDO-B')")
      .run(mensajeActual, id);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'system','Aviso posterior')")
      .run(crypto.randomUUID(), id);

    const prompt = promptConHistorial(id, "SEGUNDO-B", mensajeActual);

    expect(prompt.match(/SEGUNDO-B/g)).toHaveLength(1);
    expect(prompt.indexOf("Respuesta anterior")).toBeLessThan(prompt.indexOf("SEGUNDO-B"));
    expect(prompt).not.toContain("Aviso posterior");
  });

  test("al reanudar una sesión antigua desconocida no afirma que el modelo conoce su contexto", () => {
    const prompt = promptContinuacion("Termina el cambio", false);
    expect(prompt).toContain("La sesión anterior no se puede reutilizar");
    expect(prompt).toContain("revisa los cambios y artefactos actuales");
    expect(prompt).not.toContain("Ya tienes el contexto");
  });

  test("una reanudación con sesión no atribuye la parada a una cuota", () => {
    const prompt = promptContinuacion("Termina el cambio");
    expect(prompt).toContain("La ejecución anterior se detuvo antes de completar la tarea");
    expect(prompt).not.toContain("se agotó la cuota");
  });
});
