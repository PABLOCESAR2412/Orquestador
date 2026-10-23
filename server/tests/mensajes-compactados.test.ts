import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Marca de compactación en las respuestas: solo el turno cuyo proceso registró una compactación
// queda marcado en su respuesta; el resto de los mensajes no se toca.
// La base queda abierta al terminar: sin borrado al cierre (mismo criterio que otras pruebas;
// el wasapado inicial borra la carpeta para no arrastrar estado).
const RAIZ = join(tmpdir(), "telo-pruebas-compactacion");
if (!process.env.TELO_PRUEBAS_COMPACTACION_INICIADA) {
  rmSync(RAIZ, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_COMPACTACION_INICIADA = "1";
}
process.env.DATA_DIR = join(RAIZ, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ, "proyectos");

const { db } = await import("../src/db");
const { marcarRespuestaCompactada, registrarActividad } = await import("../src/actividad");
import type { ItemActividad } from "../src/actividad";

const pasoCompactacion: ItemActividad = {
  tipo: "accion",
  herramienta: "compaction",
  titulo: "Contexto compactado automáticamente",
  detalle: null,
  estado: "hecha",
};

function nuevaConversacion(): string {
  const id = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, project_id, title) VALUES (?, NULL, ?)").run(id, "Marcas");
  return id;
}

function respuesta(conversationId: string): string {
  const id = crypto.randomUUID();
  db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', 'respuesta')").run(id, conversationId);
  return id;
}

const estado = (mensajeId: string): number => {
  const fila = db.query<{ sesion_compactada: number }, [string]>("SELECT sesion_compactada FROM messages WHERE id = ?").get(mensajeId)!;
  return fila.sesion_compactada;
};

describe("marca de compactación en respuestas", () => {
  test("sin compactación en el turno el mensaje no queda marcado", () => {
    const conv = nuevaConversacion();
    const turno = crypto.randomUUID();
    const mensaje = respuesta(conv);
    marcarRespuestaCompactada(mensaje, conv, turno);
    expect(estado(mensaje)).toBe(0);
  });

  test("el turno con compactación marca solo su respuesta", () => {
    const conv = nuevaConversacion();
    const turno = crypto.randomUUID();
    const marcada = respuesta(conv);
    const otroTurno = crypto.randomUUID();
    const otra = respuesta(conv);
    expect(registrarActividad(conv, turno, pasoCompactacion)).toBe(1);
    marcarRespuestaCompactada(marcada, conv, turno);
    expect(estado(marcada)).toBe(1);
    expect(estado(otra)).toBe(0);
    marcarRespuestaCompactada(otra, conv, otroTurno);
    expect(estado(otra)).toBe(0);
  });
});
