import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA_PRUEBA = join(tmpdir(), `telo-medios-${crypto.randomUUID()}`);
process.env.DATA_DIR = DATA_PRUEBA;
const { db } = await import("../src/db");
const { media, reanudarGeneracionesMedios } = await import("../src/routes/media");

afterAll(() => {
  rmSync(DATA_PRUEBA, { recursive: true, force: true });
});

describe("rutas de generaciones multimedia", () => {
  test("mantiene los medios anteriores, bloquea nuevas llamadas de pago y conserva la descarga", async () => {
    const conversationId = `conv-${crypto.randomUUID()}`;
    const turnoId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title) VALUES (?,?)").run(conversationId, "Medios");
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user',?)").run(turnoId, conversationId, "Haz una imagen de un colibrí");
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'assistant',?)").run(messageId, conversationId, `[[telo-media:${mediaId}]]`);
    db.query(`INSERT INTO media_jobs (id,conversation_id,turno_id,message_id,tipo,prompt,modelo,resolucion,relacion,costo_estimado_usd,estado,nombre_archivo)
      VALUES (?,?,?,?,'imagen','Haz una imagen de un colibrí','gemini-nano-banana-2.1','1K','1:1',0.0336,'pendiente','colibri.jpg')`)
      .run(mediaId, conversationId, turnoId, messageId);

    const obtener = await media.request(`/media/${mediaId}`);
    expect(obtener.status).toBe(200);
    expect(await obtener.json()).toMatchObject({ id: mediaId, estado: "pendiente", tipo: "imagen", costo_estimado_usd: 0.0336, api_google_configurada: false });

    const confirmar = await media.request(`/media/${mediaId}/confirmar`, { method: "POST" });
    expect(confirmar.status).toBe(410);
    expect(await confirmar.json()).toEqual({ error: "generacion_multimedia_externa_deshabilitada" });
    expect((await media.request(`/media/${mediaId}`)).status).toBe(200);

    const cancelar = await media.request(`/media/${mediaId}/cancelar`, { method: "POST" });
    expect(cancelar.status).toBe(200);
    const estado = await media.request(`/media/${mediaId}`);
    expect(await estado.json()).toMatchObject({ estado: "cancelada" });

    db.query("UPDATE media_jobs SET estado='completada',mime='image/jpeg',nombre_archivo='Haz una imagen de un colibrí.jpg',bytes=3,contenido=? WHERE id=?")
      .run(new Uint8Array([1, 2, 3]), mediaId);
    const archivo = await media.request(`/media/${mediaId}/archivo?descargar=1`);
    expect(archivo.status).toBe(200);
    expect(archivo.headers.get("content-type")).toBe("image/jpeg");
    expect(archivo.headers.get("content-disposition")).toContain('attachment; filename="Haz una imagen de un colibri.jpg"');
    expect(archivo.headers.get("content-disposition")).toContain("filename*=UTF-8''Haz%20una%20imagen%20de%20un%20colibr%C3%AD.jpg");
    expect([...new Uint8Array(await archivo.arrayBuffer())]).toEqual([1, 2, 3]);
    const rango = await media.request(`/media/${mediaId}/archivo`, { headers: { range: "bytes=1-2" } });
    expect(rango.status).toBe(206);
    expect([...new Uint8Array(await rango.arrayBuffer())]).toEqual([2, 3]);

    const capacidades = await media.request("/media/capacidades");
    expect(await capacidades.json()).toMatchObject({
      politica: "sin_generacion_multimedia_externa_facturable",
      imagen: { ruta: "modelo_seleccionado_y_herramientas_locales" },
      video: { ruta: "modelo_seleccionado_y_herramientas_locales" },
      voz: { ruta: "herramienta_local_o_servidor_mcp_configurado" },
    });
  });

  test("cierra solicitudes externas antiguas al iniciar, sin retomarlas", async () => {
    const conversationId = `conv-${crypto.randomUUID()}`;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title) VALUES (?,?)").run(conversationId, "Medios pendientes");
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user','Crea un video')").run(userId, conversationId);
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'assistant','antiguo')").run(assistantId, conversationId);
    db.query(`INSERT INTO media_jobs (id,conversation_id,turno_id,message_id,tipo,prompt,modelo,resolucion,relacion,costo_estimado_usd,estado)
      VALUES (?,?,?,?,'video','Crea un video','gemini-omni-1.1-flash','720p','9:16',1.2,'generando')`)
      .run(mediaId, conversationId, userId, assistantId);

    reanudarGeneracionesMedios();

    const estado = await media.request(`/media/${mediaId}`);
    expect(await estado.json()).toMatchObject({ estado: "error", error: "Generación externa desactivada para evitar cargos. Vuelve a pedir el archivo al agente con herramientas locales." });
  });
});
