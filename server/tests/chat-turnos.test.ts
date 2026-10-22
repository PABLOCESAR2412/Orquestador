import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
const { config } = await import("../src/config");
const { chat, avisarTurnosInterrumpidos } = await import("../src/routes/chat");
const { guardarImagenAdjunta, imagenesDelPrompt } = await import("../src/chat-adjuntos");

const app = new Hono();
app.route("/api", chat);

type Mensaje = { id: string; role: string; content: string; model: string | null; effort: string | null };

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
  if [ "$anterior" = "--file" ]; then imagen="$a"; fi
  case "$a" in *HISTORIA-ANTERIOR*) historial="si" ;; esac
  anterior="$a"
  ultimo="$a"
done
case "$ultimo" in *LENTO*) sleep 1.5 ;; esac
case "$ultimo" in *FALLO*) echo "error interno del agente" >&2; exit 1 ;; esac
case "$ultimo" in *CAMBIO-MODELO*) printf '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"modelo=%s;sesion=%s;variante=%s;historial=%s"}}\\n' "$modelo" "\${sesion:-nueva}" "\${variante:-auto}" "\${historial:-no}"; exit 0 ;; esac
case "$ultimo" in *ANALIZA-ADJUNTO*) if [ -n "$imagen" ] && [ -s "$imagen" ]; then echo '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"La imagen llegó al agente como archivo."}}'; else echo '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"No llegó ningún archivo de imagen."}}'; fi; exit 0 ;; esac
case "$ultimo" in *CONCURRENTE*) id=$(printf '%s' "$ultimo" | sed -n 's/.*CONCURRENTE-\\([0-9][0-9]*\\) LENTO.*/\\1/p'); printf '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"%s: %s"}}\\n' "$modelo" "$id"; exit 0 ;; esac
case "$ultimo" in *"Termina la respuesta que quedó a medias"*) if [ -z "$sesion" ]; then sesion="ses_turno01"; fi; printf '{"type":"text","sessionID":"%s","part":{"type":"text","text":"continuacion;sesion=%s"}}\\n' "$sesion" "$sesion"; exit 0 ;; esac
case "$ultimo" in *CONTRATO-EJECUCION-PRUEBA*) case "$ultimo" in *"Contrato de ejecución común de Telo"*) resultado="Contrato común presente." ;; *) resultado="Contrato común ausente." ;; esac; printf '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"%s"}}\\n' "$resultado"; exit 0 ;; esac
echo '{"type":"text","sessionID":"ses_turno01","part":{"type":"text","text":"Respuesta lista."}}'
`,
  );
  chmodSync(join(bin, "opencode"), 0o755);
  process.env.PATH = `${bin}${delimiter}${RESTAURAR.PATH ?? ""}`;
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
    .query<Mensaje, [string]>("SELECT id, role, content, model, effort FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC")
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

function enviarReintento(id: string, content: string, retryOf: string) {
  return app.request(`/api/conversations/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, retryOf }),
  });
}

describe("lista de conversaciones", () => {
  test("usa el estado de la tarea más reciente sin hacer una consulta por chat", async () => {
    const id = conversacion();
    db.query(`INSERT INTO tasks (id, title, prompt, model, status, conversation_id, created_at, finished_at, plan_hash)
      VALUES (?, 'Tarea anterior', 'p', 'opencode/prueba', 'done', ?, '2026-10-18 10:00:00', '2026-10-18 10:01:00', 'hash-anterior')`)
      .run(crypto.randomUUID(), id);
    const ultima = crypto.randomUUID();
    db.query(`INSERT INTO tasks (id, title, prompt, model, status, conversation_id, created_at, plan_hash)
      VALUES (?, 'Tarea reciente', 'p', 'opencode/prueba', 'running', ?, '2026-10-18 11:00:00', 'hash-reciente')`)
      .run(ultima, id);

    const response = await app.request("/api/conversations");
    const lista = await response.json() as {
      id: string;
      estado_tarea: string | null;
      estado_tarea_id: string | null;
      estado_tarea_version: string | null;
      pendiente_aprobacion: boolean;
    }[];
    expect(response.status).toBe(200);
    expect(lista.find((conversation) => conversation.id === id)).toMatchObject({
      estado_tarea: "en_proceso",
      estado_tarea_id: ultima,
      estado_tarea_version: "hash-reciente",
      pendiente_aprobacion: false,
    });
  });
});

describe("reintentos de mensajes fallidos", () => {
  test("reutiliza el prompt original y elimina el aviso anterior", async () => {
    const projectId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name) VALUES (?, 'Proyecto de reintento')").run(projectId);
    db.query("INSERT INTO conversations (id, title, model, project_id) VALUES (?, 'Chat de reintento', 'opencode/prueba', ?)")
      .run(conversationId, projectId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'Genera la segunda versión')")
      .run(messageId, conversationId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'system', 'El agente se detuvo')")
      .run(crypto.randomUUID(), conversationId);

    const response = await enviarReintento(conversationId, "Genera la segunda versión", messageId);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { messages: Mensaje[]; taskId: string };
    expect(body.messages[0]).toMatchObject({ id: messageId, role: "user", content: "Genera la segunda versión" });
    expect(mensajes(conversationId).filter((mensaje) => mensaje.role === "user")).toHaveLength(1);
    expect(mensajes(conversationId).some((mensaje) => mensaje.role === "system")).toBe(false);
    expect(db.query<{ prompt: string }, [string]>("SELECT prompt FROM tasks WHERE id=?").get(body.taskId)?.prompt)
      .toBe("Genera la segunda versión");
  });

  test("rechaza reintentar un aviso antiguo cuando ya se envió otro prompt", async () => {
    const projectId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name) VALUES (?, 'Proyecto con aviso antiguo')").run(projectId);
    db.query("INSERT INTO conversations (id, title, model, project_id) VALUES (?, 'Chat con aviso antiguo', 'opencode/prueba', ?)")
      .run(conversationId, projectId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'Prompt fallido')")
      .run(messageId, conversationId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'system', 'Fallo antiguo')")
      .run(crypto.randomUUID(), conversationId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'Prompt más reciente')")
      .run(crypto.randomUUID(), conversationId);

    const response = await enviarReintento(conversationId, "Prompt fallido", messageId);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "message_not_retryable" });
    expect(mensajes(conversationId).filter((mensaje) => mensaje.role === "user")).toHaveLength(2);
    expect(mensajes(conversationId).some((mensaje) => mensaje.role === "system" && mensaje.content === "Fallo antiguo")).toBe(true);
  });
});

describe("errores de acciones Git en el chat", () => {
  test("conserva el mensaje y explica errores de GitHub no clasificados", async () => {
    const projectId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const cwd = join(config.projectsDir!, `accion-chat-${projectId}`);
    mkdirSync(cwd, { recursive: true });
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Proyecto sin credencial GitHub', ?)")
      .run(projectId, cwd);
    db.query("INSERT INTO conversations (id, title, model, project_id) VALUES (?, 'Chat Git', 'opencode/prueba', ?)")
      .run(conversationId, projectId);

    try {
      const response = await enviar(conversationId, "Fusiona el PR #4");
      expect(response.status).toBe(202);
      const body = await response.json() as { messages: Mensaje[]; actionError: string };
      expect(body.actionError).toBe("credenciales_git_faltantes");
      expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(body.messages[1]?.content).toContain("Tu mensaje quedó guardado");
      expect(mensajes(conversationId).filter((message) => message.role === "user")).toHaveLength(1);
    } finally {
      db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
      db.query("DELETE FROM projects WHERE id=?").run(projectId);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("archivos PDF de una conversación", () => {
  test("prepara la vista, sirve rangos y descarga con el nombre del archivo", async () => {
    const id = conversacion();
    const nombre = "informe ñ.pdf";
    const carpetaChat = join(process.env.DATA_DIR!, "chat-workspace", id);
    mkdirSync(carpetaChat, { recursive: true });
    const bytes = Buffer.from("%PDF-1.7\ncontenido de prueba\n%%EOF\n", "utf8");
    writeFileSync(join(carpetaChat, nombre), bytes);
    const ruta = `/api/conversations/${id}/archivo-pdf?ruta=${encodeURIComponent(nombre)}`;

    const meta = await app.request(`${ruta}&meta=1`);
    expect(meta.status).toBe(200);
    expect(meta.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(meta.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(await meta.json()).toEqual({ ruta: nombre, nombre, tamano: bytes.byteLength });

    const vista = await app.request(ruta);
    expect(vista.status).toBe(200);
    expect(vista.headers.get("content-type")).toBe("application/pdf");
    expect(vista.headers.get("content-disposition")).toStartWith("inline;");
    expect(vista.headers.get("accept-ranges")).toBe("bytes");
    expect(vista.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(Buffer.from(await vista.arrayBuffer())).toEqual(bytes);

    const rango = await app.request(ruta, { headers: { range: "bytes=0-4" } });
    expect(rango.status).toBe(206);
    expect(rango.headers.get("content-range")).toBe(`bytes 0-4/${bytes.byteLength}`);
    expect(Buffer.from(await rango.arrayBuffer())).toEqual(bytes.subarray(0, 5));

    const descarga = await app.request(`${ruta}&descargar=1`);
    expect(descarga.status).toBe(200);
    expect(descarga.headers.get("content-disposition")).toStartWith("attachment;");
    expect(Buffer.from(await descarga.arrayBuffer())).toEqual(bytes);
  });

  test("rechaza referencias que salen del workspace y archivos que no son PDF", async () => {
    const id = conversacion();
    const carpetaChat = join(process.env.DATA_DIR!, "chat-workspace", id);
    mkdirSync(carpetaChat, { recursive: true });
    writeFileSync(join(carpetaChat, "dañado.pdf"), "esto no es un PDF");
    writeFileSync(join(carpetaChat, "nota.txt"), "texto");

    const traversal = await app.request(`/api/conversations/${id}/archivo-pdf?ruta=${encodeURIComponent("../nota.pdf")}`);
    expect(traversal.status).toBe(400);
    expect(await traversal.json()).toEqual({ error: "invalid_project_path" });

    const dañado = await app.request(`/api/conversations/${id}/archivo-pdf?ruta=${encodeURIComponent("dañado.pdf")}`);
    expect(dañado.status).toBe(415);
    expect(await dañado.json()).toEqual({ error: "formato_pdf_invalido" });

    const otroFormato = await app.request(`/api/conversations/${id}/archivo-pdf?ruta=nota.txt`);
    expect(otroFormato.status).toBe(415);
    expect(await otroFormato.json()).toEqual({ error: "formato_pdf_invalido" });

    const noExiste = await app.request(`/api/conversations/${id}/archivo-pdf?ruta=no-existe.pdf`);
    expect(noExiste.status).toBe(404);
    expect(await noExiste.json()).toEqual({ error: "archivo_chat_no_encontrado" });
  });
});

describe("archivos de texto de chats sin proyecto", () => {
  test("sirve la vista previa desde el workspace aislado y conserva los límites de ruta", async () => {
    const id = conversacion();
    const carpetaChat = join(process.env.DATA_DIR!, "chat-workspace", id);
    mkdirSync(carpetaChat, { recursive: true });
    writeFileSync(join(carpetaChat, "informe.md"), "# Informe\nContenido del chat.", "utf8");

    const vista = await app.request(`/api/conversations/${id}/archivo?ruta=informe.md`);
    expect(vista.status).toBe(200);
    expect(await vista.json()).toEqual({ ruta: "informe.md", tamano: 29, texto: "# Informe\nContenido del chat.", truncado: false });

    const traversal = await app.request(`/api/conversations/${id}/archivo?ruta=${encodeURIComponent("../secreto.txt")}`);
    expect(traversal.status).toBe(400);
    expect(await traversal.json()).toEqual({ error: "invalid_project_path" });
  });
});

// Estas pruebas lanzan grupos de procesos con `setsid`, igual que el servidor Linux.
describe.skipIf(!Bun.which("setsid"))("turno del chat en segundo plano", () => {
  test("envía las solicitudes de imagen y video al modelo seleccionado sin crear trabajos multimedia de pago", async () => {
    for (const prompt of ["Genera una imagen de un colibrí", "Crea un video vertical de un colibrí"]) {
      const id = conversacion("opencode/big-pickle");
      const respuesta = await enviar(id, prompt);
      expect(respuesta.status).toBe(202);
      await esperar(() => mensajes(id).some((mensaje) => mensaje.role === "assistant"));
      expect(mensajes(id).find((mensaje) => mensaje.role === "assistant")?.content).toBe("Respuesta lista.");
      expect(db.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM media_jobs WHERE conversation_id=?").get(id)?.total).toBe(0);
    }
  });

  test("inyecta el contrato común aunque el chat use un runner de OpenCode", async () => {
    const id = conversacion();
    const response = await enviar(id, "CONTRATO-EJECUCION-PRUEBA");
    expect(response.status).toBe(202);
    await esperar(() => mensajes(id).some((mensaje) => mensaje.role === "assistant"));
    expect(mensajes(id).find((mensaje) => mensaje.role === "assistant")?.content).toBe("Contrato común presente.");
  });

  test("el runner recibe el archivo de imagen adjuntado al mensaje", async () => {
    const id = conversacion();
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0ioAAAAASUVORK5CYII=", "base64");
    const form = new FormData();
    form.append("archivo", new File([bytes], "captura.png", { type: "image/png" }));
    const subida = await app.request(`/api/conversations/${id}/adjuntos`, { method: "POST", body: form });
    expect(subida.status).toBe(201);
    const adjunto = await subida.json() as { id: string };

    const respuesta = await enviar(id, `ANALIZA-ADJUNTO <<telo-imagen id="${adjunto.id}" nombre="captura.png">>`);
    expect(respuesta.status).toBe(202);
    await esperar(() => mensajes(id).some((mensaje) => mensaje.role === "assistant"));
    expect(mensajes(id).find((mensaje) => mensaje.role === "assistant")?.content).toBe("La imagen llegó al agente como archivo.");
  });

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

  test("reintentar un turno agotado continúa la sesión guardada y no vuelve a enviar el prompt original", async () => {
    const id = conversacion();
    const messageId = crypto.randomUUID();
    db.query("UPDATE conversations SET runner_session_id=?, runner_session_model=? WHERE id=?")
      .run("ses_turno01", "opencode/prueba", id);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'Prepara una investigación extensa')")
      .run(messageId, id);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'system', 'El agente superó el límite de 15 minutos y se detuvo. La sesión quedó guardada; reintenta para continuar donde se quedó.')")
      .run(crypto.randomUUID(), id);

    expect((await enviarReintento(id, "Prepara una investigación extensa", messageId)).status).toBe(202);
    await esperar(() => mensajes(id).some((mensaje) => mensaje.role === "assistant"));
    expect(mensajes(id).find((mensaje) => mensaje.role === "assistant")?.content).toBe("continuacion;sesion=ses_turno01");
    expect(mensajes(id).some((mensaje) => mensaje.role === "system")).toBe(false);
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
    await esperar(() => mensajes(id).filter((m) => m.role === "assistant").length === 2);
    expect(mensajes(id).filter((m) => m.role === "assistant").at(-1)?.content).toContain(
      "modelo=opencode/modelo-b;sesion=nueva;variante=high;historial=si",
    );
    expect(mensajes(id).filter((m) => m.role === "assistant").at(-1)).toMatchObject({
      model: "opencode/modelo-b",
      effort: "high",
    });
    expect(db.query<{ runner_session_model: string }, [string]>(
      "SELECT runner_session_model FROM conversations WHERE id=?",
    ).get(id)?.runner_session_model).toBe("opencode/modelo-b");

    db.query("UPDATE conversations SET effort='low' WHERE id=?").run(id);
    expect((await enviar(id, "CAMBIO-MODELO")).status).toBe(202);
    await esperar(() => mensajes(id).filter((m) => m.role === "assistant").length === 3);
    expect(mensajes(id).filter((m) => m.role === "assistant").at(-1)?.content).toContain(
      "modelo=opencode/modelo-b;sesion=ses_turno01;variante=low;historial=no",
    );
    expect(mensajes(id).filter((m) => m.role === "assistant").at(-1)).toMatchObject({
      model: "opencode/modelo-b",
      effort: "low",
    });
  });
});

describe("imágenes de una conversación", () => {
  test("adjunta las cuatro imágenes más recientes del historial", () => {
    const id = conversacion();
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0ioAAAAASUVORK5CYII=", "base64");
    const ids = Array.from({ length: 5 }, (_, indice) => guardarImagenAdjunta(id, `captura-${indice}.png`, bytes).id);
    const prompt = ids.map((adjuntoId, indice) => `<<telo-imagen id="${adjuntoId}" nombre="captura-${indice}.png">>`).join("\n");

    const preparado = imagenesDelPrompt(id, prompt);
    expect(preparado.imagenes).toHaveLength(4);
    expect(preparado.imagenes.map((imagen) => imagen.ruta).join(" ")).not.toContain(ids[0]!);
    for (const reciente of ids.slice(1)) {
      expect(preparado.imagenes.some((imagen) => imagen.ruta.includes(reciente))).toBe(true);
    }
    expect(preparado.prompt).toContain("Imagen anterior no adjunta al turno actual");
  });

  test("sube la imagen del compositor y la muestra desde el chat", async () => {
    const id = conversacion();
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0ioAAAAASUVORK5CYII=", "base64");
    const form = new FormData();
    form.append("archivo", new File([bytes], "captura.png", { type: "image/png" }));
    const subida = await app.request(`/api/conversations/${id}/adjuntos`, { method: "POST", body: form });
    expect(subida.status).toBe(201);
    const adjunto = await subida.json() as { id: string; mime: string; bytes: number };
    expect(adjunto).toMatchObject({ mime: "image/png", bytes: bytes.byteLength });

    const vista = await app.request(`/api/conversations/${id}/adjuntos/${adjunto.id}`);
    expect(vista.status).toBe(200);
    expect(vista.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await vista.arrayBuffer())).toEqual(bytes);
  });

  test("rechaza un archivo que no contiene una imagen raster válida", async () => {
    const id = conversacion();
    const form = new FormData();
    form.append("archivo", new File(["no es una imagen"], "captura.png", { type: "image/png" }));
    const respuesta = await app.request(`/api/conversations/${id}/adjuntos`, { method: "POST", body: form });
    expect(respuesta.status).toBe(415);
    expect(await respuesta.json()).toEqual({ error: "image_type_unsupported" });
  });

  test("abre y descarga imágenes del chat libre con su nombre original", async () => {
    const id = conversacion();
    const nombre = "infografía de prueba.png";
    const carpetaChat = join(process.env.DATA_DIR!, "chat-workspace", id);
    mkdirSync(carpetaChat, { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    writeFileSync(join(carpetaChat, nombre), bytes);
    const ruta = `/api/conversations/${id}/archivo-imagen?ruta=${encodeURIComponent(nombre)}`;

    const meta = await app.request(`${ruta}&meta=1`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toEqual({ ruta: nombre, nombre, mime: "image/png", tamano: bytes.byteLength });

    const vista = await app.request(ruta);
    expect(vista.status).toBe(200);
    expect(vista.headers.get("content-type")).toBe("image/png");
    expect(vista.headers.get("content-disposition")).toStartWith("inline;");
    expect(vista.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await vista.arrayBuffer())).toEqual(bytes);

    const descarga = await app.request(`${ruta}&descargar=1`);
    expect(descarga.headers.get("content-disposition")).toStartWith("attachment;");
    expect(descarga.headers.get("content-disposition")).toContain("filename*=UTF-8''infograf%C3%ADa%20de%20prueba.png");
  });

  test("previsualiza, descarga y sirve rangos de videos MP4 del chat", async () => {
    const id = conversacion();
    const nombre = "resumen de guerra.mp4";
    const carpetaChat = join(process.env.DATA_DIR!, "chat-workspace", id);
    mkdirSync(carpetaChat, { recursive: true });
    const bytes = Buffer.from("000000146674797069736f6d000000006d703432", "hex");
    writeFileSync(join(carpetaChat, nombre), bytes);
    const ruta = `/api/conversations/${id}/archivo-video?ruta=${encodeURIComponent(nombre)}`;

    const meta = await app.request(`${ruta}&meta=1`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toEqual({ ruta: nombre, nombre, mime: "video/mp4", tamano: bytes.byteLength });

    const vista = await app.request(ruta);
    expect(vista.status).toBe(200);
    expect(vista.headers.get("content-type")).toBe("video/mp4");
    expect(vista.headers.get("content-disposition")).toStartWith("inline;");
    expect(vista.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await vista.arrayBuffer())).toEqual(bytes);

    const rango = await app.request(ruta, { headers: { range: "bytes=4-11" } });
    expect(rango.status).toBe(206);
    expect(rango.headers.get("content-range")).toBe(`bytes 4-11/${bytes.byteLength}`);
    expect(Buffer.from(await rango.arrayBuffer())).toEqual(bytes.subarray(4, 12));

    const descarga = await app.request(`${ruta}&descargar=1`);
    expect(descarga.headers.get("content-disposition")).toStartWith("attachment;");
    expect(descarga.headers.get("content-disposition")).toContain("filename*=UTF-8''resumen%20de%20guerra.mp4");

    writeFileSync(join(carpetaChat, "falso.mp4"), "no es un MP4");
    const invalido = await app.request(`/api/conversations/${id}/archivo-video?ruta=falso.mp4`);
    expect(invalido.status).toBe(415);
    expect(await invalido.json()).toEqual({ error: "formato_video_invalido" });
  });

  test("sirve archivos del proyecto y rechaza rutas o firmas no permitidas", async () => {
    const proyectoId = crypto.randomUUID();
    const conversacionId = crypto.randomUUID();
    const raizProyecto = join(carpeta, "proyecto-imagen");
    const workspaceTarea = join(carpeta, "workspace-imagen");
    mkdirSync(raizProyecto, { recursive: true });
    mkdirSync(workspaceTarea, { recursive: true });
    db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,?,?)").run(proyectoId, proyectoId, raizProyecto);
    db.query("INSERT INTO conversations(id,title,project_id) VALUES (?, 'Chat con imagen', ?)").run(conversacionId, proyectoId);
    db.query("INSERT INTO tasks(id,title,prompt,model,status,workspace,project_id,conversation_id) VALUES (?,?,?,'modelo','done',?,?,?)")
      .run(crypto.randomUUID(), "Tarea de imagen", "Abrir imagen generada", workspaceTarea, proyectoId, conversacionId);
    writeFileSync(join(workspaceTarea, "captura.webp"), Buffer.from("RIFF0000WEBPdatos", "ascii"));
    writeFileSync(join(workspaceTarea, "falso.png"), "no es una imagen");

    const imagen = await app.request(`/api/conversations/${conversacionId}/archivo-imagen?ruta=captura.webp`);
    expect(imagen.status).toBe(200);
    expect(imagen.headers.get("content-type")).toBe("image/webp");

    const traversal = await app.request(`/api/conversations/${conversacionId}/archivo-imagen?ruta=${encodeURIComponent("../captura.png")}`);
    expect(traversal.status).toBe(400);
    const firmaInvalida = await app.request(`/api/conversations/${conversacionId}/archivo-imagen?ruta=falso.png`);
    expect(firmaInvalida.status).toBe(415);
    expect(await firmaInvalida.json()).toEqual({ error: "formato_imagen_invalido" });
  });

  test("recupera archivos de workspaces anteriores y del repositorio del proyecto", async () => {
    const proyectoId = crypto.randomUUID();
    const conversacionId = crypto.randomUUID();
    const raizProyecto = join(carpeta, "proyecto-historico");
    const workspaceAnterior = join(carpeta, "workspace-anterior");
    const workspaceActual = join(carpeta, "workspace-actual");
    mkdirSync(raizProyecto, { recursive: true });
    mkdirSync(join(workspaceAnterior, "preview"), { recursive: true });
    mkdirSync(workspaceActual, { recursive: true });
    db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,?,?)").run(proyectoId, proyectoId, raizProyecto);
    db.query("INSERT INTO conversations(id,title,project_id) VALUES (?, 'Chat con historial', ?)").run(conversacionId, proyectoId);
    const insertarTarea = db.query(
      "INSERT INTO tasks(id,title,prompt,model,status,workspace,project_id,conversation_id,created_at) VALUES (?,?,?,'modelo','done',?,?,?,?)",
    );
    insertarTarea.run(crypto.randomUUID(), "Tarea anterior", "Crear documentos", workspaceAnterior, proyectoId, conversacionId, "2026-10-18 00:00:00");
    insertarTarea.run(crypto.randomUUID(), "Tarea actual", "Seguir trabajo", workspaceActual, proyectoId, conversacionId, "2026-10-19 00:00:00");
    writeFileSync(join(workspaceAnterior, "content.js"), "export const informe = true;");
    writeFileSync(join(workspaceAnterior, "preview", "informe.pdf"), "%PDF-1.4\ncontenido\n%%EOF\n");
    writeFileSync(join(workspaceAnterior, "preview", "p01-12.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
    mkdirSync(join(workspaceAnterior, "renders"), { recursive: true });
    const videoBytes = Buffer.from("000000146674797069736f6d000000006d703432", "hex");
    writeFileSync(join(workspaceAnterior, "renders", "mapa-mental.mp4"), videoBytes);
    writeFileSync(join(raizProyecto, "README.md"), "Archivo del repositorio base");

    const texto = await app.request(`/api/conversations/${conversacionId}/archivo?ruta=content.js`);
    expect(texto.status).toBe(200);
    expect(await texto.json()).toMatchObject({ ruta: "content.js", texto: "export const informe = true;" });

    const pdf = await app.request(`/api/conversations/${conversacionId}/archivo-pdf?ruta=preview%2Finforme.pdf&meta=1`);
    expect(pdf.status).toBe(200);
    expect(await pdf.json()).toMatchObject({ ruta: "preview/informe.pdf", nombre: "informe.pdf" });

    const imagen = await app.request(`/api/conversations/${conversacionId}/archivo-imagen?ruta=preview%2Fp01-12.png&meta=1`);
    expect(imagen.status).toBe(200);
    expect(await imagen.json()).toMatchObject({ ruta: "preview/p01-12.png", mime: "image/png" });

    const video = await app.request(`/api/conversations/${conversacionId}/archivo-video?ruta=mapa-mental.mp4&meta=1`);
    expect(video.status).toBe(200);
    expect(await video.json()).toMatchObject({ ruta: "renders/mapa-mental.mp4", mime: "video/mp4", tamano: videoBytes.byteLength });
    const videoContenido = await app.request(`/api/conversations/${conversacionId}/archivo-video?ruta=renders%2Fmapa-mental.mp4`);
    expect(videoContenido.status).toBe(200);
    expect(Buffer.from(await videoContenido.arrayBuffer())).toEqual(videoBytes);

    const base = await app.request(`/api/conversations/${conversacionId}/archivo?ruta=README.md`);
    expect(base.status).toBe(200);
    expect(await base.json()).toMatchObject({ ruta: "README.md", texto: "Archivo del repositorio base" });

    const ausente = await app.request(`/api/conversations/${conversacionId}/archivo?ruta=Gone.tsx`);
    expect(ausente.status).toBe(404);
    expect(await ausente.json()).toEqual({ error: "project_path_not_found" });
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

describe("metadatos del historial de chat", () => {
  test("la API devuelve el modelo y el esfuerzo guardados en cada respuesta", async () => {
    const id = conversacion("openai/modelo-actual");
    db.query("INSERT INTO messages (id, conversation_id, role, content, model, effort) VALUES (?, ?, 'assistant', 'Respuesta anterior', ?, ?)")
      .run(crypto.randomUUID(), id, "groq/modelo-anterior", "medium");
    db.query("UPDATE conversations SET model = ?, effort = ? WHERE id = ?").run("google/modelo-actual", "high", id);

    const respuesta = await app.request(`/api/conversations/${id}/messages`);
    const cuerpo = await respuesta.json() as { role: string; model: string | null; effort: string | null }[];
    expect(respuesta.status).toBe(200);
    expect(cuerpo).toContainEqual(expect.objectContaining({
      role: "assistant",
      model: "groq/modelo-anterior",
      effort: "medium",
    }));
  });
});

describe("contexto por conversación", () => {
  test("resume mensajes, sesión, acciones y uso medido sin mezclar otros chats", async () => {
    const id = conversacion("opencode/modelo-contexto");
    db.query("UPDATE conversations SET runner_session_id='sesion-contexto', runner_session_model='opencode/modelo-contexto' WHERE id=?").run(id);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'pregunta')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', 'respuesta')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cost, tokens_precision, created_at) VALUES (?, ?, 'opencode', 'opencode/modelo-contexto', 100, 20, 5, 40, 0.01, 'medida', '2026-10-18 10:00:00')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cost, tokens_precision, created_at) VALUES (?, ?, 'opencode', 'opencode/modelo-contexto', 120, 25, 7, 50, 0.02, 'estimado', '2026-10-18 10:05:00')")
      .run(crypto.randomUUID(), id);
    db.query("INSERT INTO chat_actividad (conversation_id, turno_id, seq, tipo, herramienta, titulo, estado) VALUES (?, 'turno-contexto', 1, 'accion', 'read', 'Leyó un archivo', 'hecha')")
      .run(id);

    const respuesta = await app.request(`/api/conversations/${id}/contexto`);
    const datos = await respuesta.json() as any;
    expect(respuesta.status).toBe(200);
    expect(datos.conversation.sessionId).toBe("sesion-contexto");
    expect(datos.messages).toMatchObject({ total: 2, user: 1, assistant: 1, system: 0 });
    expect(datos.actions).toBe(1);
    expect(datos.usage).toMatchObject({ calls: 2, chatCalls: 2, inputTokens: 220, outputTokens: 45, reasoningTokens: 12, cacheReadTokens: 90, measured: 1, estimated: 1 });
    expect(datos.lastInput).toMatchObject({ inputTokens: 120, tokensPrecision: "estimado" });
    expect(datos.byModel).toHaveLength(1);

    const inexistente = await app.request("/api/conversations/no-existe/contexto");
    expect(inexistente.status).toBe(404);
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
