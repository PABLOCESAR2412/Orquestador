import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA_PRUEBA = join(tmpdir(), `telo-medios-${crypto.randomUUID()}`);
process.env.DATA_DIR = DATA_PRUEBA;
const { db } = await import("../src/db");
const { crearSolicitudMedio, detectarSolicitudMedio, media } = await import("../src/routes/media");

afterAll(() => {
  db.close();
  rmSync(DATA_PRUEBA, { recursive: true, force: true });
});

describe("rutas de generaciones multimedia", () => {
  test("crea una solicitud pendiente persistida y permite cancelarla antes de llamar al proveedor", async () => {
    const conversationId = `conv-${crypto.randomUUID()}`;
    const turnoId = crypto.randomUUID();
    db.query("INSERT INTO conversations (id,title) VALUES (?,?)").run(conversationId, "Medios");
    db.query("INSERT INTO messages (id,conversation_id,role,content) VALUES (?,?,'user',?)").run(turnoId, conversationId, "Haz una imagen de un colibrí");
    const solicitud = detectarSolicitudMedio("Haz una imagen de un colibrí")!;
    const creada = crearSolicitudMedio(conversationId, turnoId, solicitud);

    const obtener = await media.request(`/media/${creada.id}`);
    expect(obtener.status).toBe(200);
    expect(await obtener.json()).toMatchObject({ id: creada.id, estado: "pendiente", tipo: "imagen", costo_estimado_usd: 0.0336 });

    const cancelar = await media.request(`/media/${creada.id}/cancelar`, { method: "POST" });
    expect(cancelar.status).toBe(200);
    const estado = await media.request(`/media/${creada.id}`);
    expect(await estado.json()).toMatchObject({ estado: "cancelada" });

    db.query("UPDATE media_jobs SET estado='completada',mime='image/jpeg',nombre_archivo='Haz una imagen de un colibrí.jpg',bytes=3,contenido=? WHERE id=?")
      .run(new Uint8Array([1, 2, 3]), creada.id);
    const archivo = await media.request(`/media/${creada.id}/archivo?descargar=1`);
    expect(archivo.status).toBe(200);
    expect(archivo.headers.get("content-type")).toBe("image/jpeg");
    expect(archivo.headers.get("content-disposition")).toContain('attachment; filename="Haz una imagen de un colibri.jpg"');
    expect(archivo.headers.get("content-disposition")).toContain("filename*=UTF-8''Haz%20una%20imagen%20de%20un%20colibr%C3%AD.jpg");
    expect([...new Uint8Array(await archivo.arrayBuffer())]).toEqual([1, 2, 3]);
    const rango = await media.request(`/media/${creada.id}/archivo`, { headers: { range: "bytes=1-2" } });
    expect(rango.status).toBe(206);
    expect([...new Uint8Array(await rango.arrayBuffer())]).toEqual([2, 3]);

    const capacidades = await media.request("/media/capacidades");
    expect(await capacidades.json()).toMatchObject({
      imagen: { modelo: "gemini-nano-banana-2.1", gratis: false },
      video: { modeloEconomico: "gemini-omni-1.1-flash", modelo4k: "gemini-omni-1.1-flash", gratis: false, costoEstimadoUsdPorSegundo: 0.1 },
    });
  });
});
