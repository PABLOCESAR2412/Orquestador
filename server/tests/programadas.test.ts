import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal: nunca se toca server/data. Se fija antes de importar los módulos con base.
// Una raíz por ejecución, compartida por todos los archivos: config y base se cargan una vez por
// proceso. La primera prueba limpia los restos de la ejecución anterior.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { siguienteEjecucion, ejecutarVencidas, prepararProgramada, cambiarActiva, leerProgramada } = await import(
  "../src/programadas"
);
const { db } = await import("../src/db");

describe("siguiente ejecución", () => {
  test("cada_horas suma N horas en UTC", () => {
    const desde = new Date("2026-10-11T10:00:00.000Z");
    expect(siguienteEjecucion({ frecuencia: "cada_horas", cadaHoras: 3, hora: null }, desde)).toBe(
      "2026-10-11T13:00:00.000Z",
    );
    expect(siguienteEjecucion({ frecuencia: "cada_horas", cadaHoras: 168, hora: null }, desde)).toBe(
      "2026-10-18T10:00:00.000Z",
    );
  });

  test("diaria usa la hora local del servidor y es estrictamente posterior a ahora", () => {
    // Las fechas se construyen en hora local, así que la prueba vale en cualquier zona horaria.
    const desde = new Date(2026, 9, 11, 10, 30, 15);
    const diaria = (hora: string) => siguienteEjecucion({ frecuencia: "diaria", cadaHoras: null, hora }, desde);

    expect(diaria("10:31")).toBe(new Date(2026, 9, 11, 10, 31).toISOString());
    expect(diaria("09:00")).toBe(new Date(2026, 9, 12, 9, 0).toISOString());
    // 10:30:00 ya pasó (son las 10:30:15): la siguiente es mañana.
    expect(diaria("10:30")).toBe(new Date(2026, 9, 12, 10, 30).toISOString());
  });

  test("diaria con el mismo instante exacto pasa al día siguiente", () => {
    const exacto = new Date(2026, 9, 11, 9, 0, 0, 0);
    expect(siguienteEjecucion({ frecuencia: "diaria", cadaHoras: null, hora: "09:00" }, exacto)).toBe(
      new Date(2026, 9, 12, 9, 0).toISOString(),
    );
  });
});

describe("validación de programadas", () => {
  const base = { prompt: "Revisa los logs", frecuencia: "cada_horas" as const, cada_horas: 2 };

  test("horario inválido, prompt vacío y cadencia fuera de rango", async () => {
    expect(await prepararProgramada({ ...base, frecuencia: "semanal" })).toMatchObject({ error: "invalid_schedule" });
    expect(await prepararProgramada({ ...base, cada_horas: 169 })).toMatchObject({ error: "invalid_schedule" });
    expect(await prepararProgramada({ ...base, cada_horas: 1.5 })).toMatchObject({ error: "invalid_schedule" });
    expect(await prepararProgramada({ prompt: "x", frecuencia: "diaria", hora: "25:00" })).toMatchObject({
      error: "invalid_schedule",
    });
    expect(await prepararProgramada({ ...base, prompt: "   " })).toMatchObject({ error: "invalid_prompt" });
    expect(await prepararProgramada({ ...base, prompt: "x".repeat(10_001) })).toMatchObject({
      error: "invalid_prompt",
    });
  });

  test("proyecto inexistente", async () => {
    expect(await prepararProgramada({ ...base, projectId: "no-existe" })).toMatchObject({
      error: "project_not_found",
    });
  });
});

// Inserta una programada directamente para probar el planificador sin depender de opencode.
function insertar(datos: { id: string; proxima: string; activa: number; frecuencia?: "cada_horas" | "diaria" }) {
  db.query(
    `INSERT INTO programadas (id, titulo, prompt, model, effort, project_id, frecuencia, cada_horas, hora, activa, proxima_en)
     VALUES (?, ?, ?, 'opencode/big-pickle', NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    datos.id,
    `Titulo ${datos.id}`,
    `Prompt ${datos.id}`,
    datos.frecuencia ?? "cada_horas",
    datos.frecuencia === "diaria" ? null : 6,
    datos.frecuencia === "diaria" ? "07:00" : null,
    datos.activa,
    datos.proxima,
  );
}

describe("planificador", () => {
  test("una programada vencida crea una sola tarea y avanza su próxima ejecución", () => {
    insertar({ id: "vencida-1", proxima: "2000-01-01T00:00:00.000Z", activa: 1 });
    const llamadas: { prompt: string; origen?: string }[] = [];
    const fingir = (opts: { prompt: string; origen?: string }) => {
      llamadas.push(opts);
      return "tarea-fingida-1";
    };

    const ahora = new Date("2026-10-11T12:00:00.000Z");
    ejecutarVencidas(ahora, fingir as never);

    const propias = llamadas.filter((l) => l.prompt === "Prompt vencida-1");
    expect(propias.length).toBe(1);
    expect(propias[0].origen).toBe("programada");

    const fila = leerProgramada("vencida-1")!;
    expect(fila.proxima_en).toBe("2026-10-11T18:00:00.000Z");
    expect(fila.ultima_ejecucion).toBe("2026-10-11T12:00:00.000Z");
    expect(fila.ultima_tarea_id).toBe("tarea-fingida-1");

    // Una segunda revisión en el mismo instante no vuelve a lanzarla.
    const antes = llamadas.length;
    ejecutarVencidas(ahora, fingir as never);
    expect(llamadas.filter((l) => l.prompt === "Prompt vencida-1").length).toBe(1);
    expect(llamadas.length).toBe(antes);
  });

  test("una programada inactiva no se lanza aunque esté vencida", () => {
    insertar({ id: "inactiva-1", proxima: "2000-01-01T00:00:00.000Z", activa: 0 });
    const llamadas: string[] = [];
    ejecutarVencidas(new Date(), ((opts: { prompt: string }) => {
      llamadas.push(opts.prompt);
      return "x";
    }) as never);
    expect(llamadas).not.toContain("Prompt inactiva-1");
  });

  test("al reactivar, la próxima ejecución se calcula desde ahora (no se dispara de golpe)", () => {
    insertar({ id: "pausada-1", proxima: "2000-01-01T00:00:00.000Z", activa: 0, frecuencia: "diaria" });
    // Diaria a las 07:00; son las 10:00 locales, así que la próxima es mañana a las 07:00.
    const ahora = new Date(2026, 9, 11, 10, 0, 0);
    expect(cambiarActiva("pausada-1", true, ahora)).toBe(true);
    const fila = leerProgramada("pausada-1")!;
    expect(fila.activa).toBe(true);
    expect(fila.proxima_en).toBe(new Date(2026, 9, 12, 7, 0).toISOString());
  });

  test("un fallo al crear la tarea no detiene a las demás", () => {
    insertar({ id: "fallo-1", proxima: "2000-01-01T00:00:00.000Z", activa: 1 });
    insertar({ id: "ok-2", proxima: "2000-01-01T00:00:00.001Z", activa: 1 });
    const creadas: string[] = [];
    ejecutarVencidas(new Date(), ((opts: { prompt: string }) => {
      if (opts.prompt === "Prompt fallo-1") throw new Error("sin motor");
      creadas.push(opts.prompt);
      return "t";
    }) as never);
    expect(creadas).toContain("Prompt ok-2");
  });
});
