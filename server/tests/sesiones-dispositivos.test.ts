import { describe, expect, test } from "bun:test";
import {
  crearSesionDispositivo,
  sesionValida,
  listarSesiones,
  revocarSesion,
  revocarOtrasSesiones,
  cerrarSesionPorToken,
} from "../src/auth";
import {
  guardarMemoria,
  guardarPropuestaMemoria,
  aprobarMemoriaPropuesta,
  descartarMemoriaPropuesta,
  memoriaDelProyecto,
} from "../src/memoria";
import { db } from "../src/db";
import { config } from "../src/config";
import { auth } from "../src/routes/auth";

describe("sesiones dinámicas por dispositivo", () => {
  test("login devuelve 503 sin cookie si SQLite no guarda la sesión", async () => {
    const { clave, sinClave } = config;
    config.clave = "clave-ficticia-de-prueba";
    config.sinClave = false;
    db.exec("CREATE TEMP TRIGGER impedir_alta_sesion BEFORE INSERT ON auth_sessions BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;");
    try {
      const respuesta = await auth.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave: config.clave }),
      });
      expect(respuesta.status).toBe(503);
      expect(respuesta.headers.get("set-cookie")).toBeNull();
      expect(await respuesta.json()).toEqual({ error: "sesion_no_disponible" });
    } finally {
      db.exec("DROP TRIGGER impedir_alta_sesion");
      config.clave = clave;
      config.sinClave = sinClave;
    }
  });

  test("rechaza una sesión vencida antes de renovar su actividad sin depender del reinicio", () => {
    const sinClaveAnterior = config.sinClave;
    config.sinClave = false;
    const vencida = crearSesionDispositivo({});
    const reciente = crearSesionDispositivo({});
    try {
      db.query("UPDATE auth_sessions SET last_seen_at = datetime('now', '-61 days') WHERE id = ?").run(vencida.id);
      expect(sesionValida(vencida.token)).toBe(false);
      expect(db.query("SELECT id FROM auth_sessions WHERE id = ?").get(vencida.id)).toBeNull();
      expect(sesionValida(reciente.token)).toBe(true);
    } finally {
      cerrarSesionPorToken(vencida.token);
      cerrarSesionPorToken(reciente.token);
      config.sinClave = sinClaveAnterior;
    }
  });

  test("crea, valida y lista sesiones en auth_sessions", () => {
    const sesion1 = crearSesionDispositivo({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ip: "127.0.0.1" });
    expect(sesion1.token.length).toBeGreaterThan(20);
    expect(sesionValida(sesion1.token)).toBe(true);

    const sesion2 = crearSesionDispositivo({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", ip: "192.168.1.50" });
    expect(sesionValida(sesion2.token)).toBe(true);

    const lista = listarSesiones(sesion1.token);
    expect(lista.length).toBeGreaterThanOrEqual(2);

    const actual = lista.find((s) => s.id === sesion1.id);
    expect(actual).toBeDefined();
    expect(actual?.actual).toBe(true);
    expect(actual?.ip).toBe("127.0.0.1");

    const otra = lista.find((s) => s.id === sesion2.id);
    expect(otra?.actual).toBe(false);

    // Revocar sesión individual
    revocarSesion(sesion2.id);
    expect(sesionValida(sesion2.token)).toBe(false);
    expect(sesionValida(sesion1.token)).toBe(true);

    // Cerrar sesión actual por token
    cerrarSesionPorToken(sesion1.token);
    expect(sesionValida(sesion1.token)).toBe(false);
  });

  test("revocar otras sesiones conserva solo la actual", () => {
    const s1 = crearSesionDispositivo({ userAgent: "Browser 1", ip: "10.0.0.1" });
    const s2 = crearSesionDispositivo({ userAgent: "Browser 2", ip: "10.0.0.2" });
    const s3 = crearSesionDispositivo({ userAgent: "Browser 3", ip: "10.0.0.3" });

    revocarOtrasSesiones(s1.token);

    expect(sesionValida(s1.token)).toBe(true);
    expect(sesionValida(s2.token)).toBe(false);
    expect(sesionValida(s3.token)).toBe(false);

    cerrarSesionPorToken(s1.token);
  });
});

describe("propuestas de memoria de proyecto (fallback sin Jev)", () => {
  test("guarda propuesta sin sobreescribir memoria permanente, y permite aprobar o descartar", () => {
    const pid = crypto.randomUUID();
    const tid1 = crypto.randomUUID();
    const tid2 = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Test Memoria', 'test-mem')").run(pid);
    db.query("INSERT INTO tasks (id, title, prompt, model, status, project_id) VALUES (?, 't1', 'p1', 'm', 'done', ?)").run(tid1, pid);
    db.query("INSERT INTO tasks (id, title, prompt, model, status, project_id) VALUES (?, 't2', 'p2', 'm', 'done', ?)").run(tid2, pid);

    try {
      // 1. Establecer memoria inicial permanente
      guardarMemoria(pid, "Memoria inicial aprobada");
      let m = memoriaDelProyecto(pid);
      expect(m.texto).toBe("Memoria inicial aprobada");
      expect(m.propuesta).toBeUndefined();

      // 2. Guardar propuesta de memoria (fallback del obrero cuando Jev no está)
      guardarPropuestaMemoria(pid, "Propuesta nueva del obrero", tid1);
      m = memoriaDelProyecto(pid);
      expect(m.texto).toBe("Memoria inicial aprobada"); // NO se sobreescribe automáticamente
      expect(m.propuesta).toBe("Propuesta nueva del obrero");
      expect(m.propuesta_tarea_id).toBe(tid1);

      // 3. Descartar propuesta
      descartarMemoriaPropuesta(pid);
      m = memoriaDelProyecto(pid);
      expect(m.texto).toBe("Memoria inicial aprobada");
      expect(m.propuesta).toBeUndefined();

      // 4. Guardar otra propuesta y aprobarla
      guardarPropuestaMemoria(pid, "Propuesta aceptada por usuario", tid2);
      const aprobada = aprobarMemoriaPropuesta(pid);
      expect(aprobada.texto).toBe("Propuesta aceptada por usuario");
      expect(aprobada.propuesta).toBeUndefined();

      m = memoriaDelProyecto(pid);
      expect(m.texto).toBe("Propuesta aceptada por usuario");
    } finally {
      db.query("DELETE FROM tasks WHERE project_id = ?").run(pid);
      db.query("DELETE FROM projects WHERE id = ?").run(pid);
    }
  });
});
