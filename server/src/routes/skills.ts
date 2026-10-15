import { Hono, type Context } from "hono";
import { db } from "../db";
import {
  borrarSkill,
  guardarSkill,
  leerSkill,
  listarSkills,
  SkillError,
  type AmbitoSkills,
} from "../skills";

// Skills de OpenCode desde la app: globales (Ajustes) y por proyecto (pestaña del proyecto).
// Ninguna ruta recibe ni devuelve rutas del disco: el ámbito sale del id del proyecto o del HOME del servidor.
export const skillsRoute = new Hono();

function ambitoDeProyecto(id: string): AmbitoSkills | null {
  const fila = db.query<{ repo_path: string }, [string]>("SELECT repo_path FROM projects WHERE id = ?").get(id);
  return fila?.repo_path ? { ambito: "proyecto", carpeta: fila.repo_path } : null;
}

// Ejecuta la operación y traduce SkillError a su código de error. Cualquier otro error sigue hacia el 500 genérico.
function responder(c: Context, operacion: () => unknown) {
  try {
    return c.json(operacion());
  } catch (err) {
    if (err instanceof SkillError) return c.json({ error: err.code }, err.status);
    throw err;
  }
}

async function contenidoDe(c: Context): Promise<string | null> {
  const cuerpo = (await c.req.json().catch(() => null)) as { contenido?: unknown } | null;
  return typeof cuerpo?.contenido === "string" ? cuerpo.contenido : null;
}

// Global
skillsRoute.get("/skills", (c) => responder(c, () => ({ skills: listarSkills({ ambito: "global" }) })));
skillsRoute.get("/skills/:nombre", (c) =>
  responder(c, () => leerSkill({ ambito: "global" }, c.req.param("nombre"))),
);
skillsRoute.put("/skills/:nombre", async (c) => {
  const contenido = await contenidoDe(c);
  if (contenido === null) return c.json({ error: "skill_contenido_invalido" }, 400);
  return responder(c, () => guardarSkill({ ambito: "global" }, c.req.param("nombre"), contenido));
});
skillsRoute.delete("/skills/:nombre", (c) =>
  responder(c, () => {
    borrarSkill({ ambito: "global" }, c.req.param("nombre"));
    return { ok: true };
  }),
);

// Por proyecto: <carpeta del proyecto>/.opencode/skills
skillsRoute.get("/projects/:id/skills", (c) => {
  const ambito = ambitoDeProyecto(c.req.param("id"));
  if (!ambito) return c.json({ error: "project_not_found" }, 404);
  return responder(c, () => ({ skills: listarSkills(ambito) }));
});
skillsRoute.get("/projects/:id/skills/:nombre", (c) => {
  const ambito = ambitoDeProyecto(c.req.param("id"));
  if (!ambito) return c.json({ error: "project_not_found" }, 404);
  return responder(c, () => leerSkill(ambito, c.req.param("nombre")));
});
skillsRoute.put("/projects/:id/skills/:nombre", async (c) => {
  const ambito = ambitoDeProyecto(c.req.param("id"));
  if (!ambito) return c.json({ error: "project_not_found" }, 404);
  const contenido = await contenidoDe(c);
  if (contenido === null) return c.json({ error: "skill_contenido_invalido" }, 400);
  return responder(c, () => guardarSkill(ambito, c.req.param("nombre"), contenido));
});
skillsRoute.delete("/projects/:id/skills/:nombre", (c) => {
  const ambito = ambitoDeProyecto(c.req.param("id"));
  if (!ambito) return c.json({ error: "project_not_found" }, 404);
  return responder(c, () => {
    borrarSkill(ambito, c.req.param("nombre"));
    return { ok: true };
  });
});
