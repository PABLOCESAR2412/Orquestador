import { Hono } from "hono";
import { aislamientoActivo } from "../runners/aislamiento";
import { hallarEjecutable } from "../ejecutable";


export const runner = new Hono();

// GET /api/runner -> si el CLI del agente y bubblewrap están disponibles en el servidor.
// Sin bwrap, ningún chat ni tarea puede correr (falla cerrado), así que es lo primero que conviene ver.
runner.get("/runner", (c) =>
  c.json({
    opencode: hallarEjecutable("opencode") !== null,
    bwrap: hallarEjecutable("bwrap") !== null,
    aislamiento: aislamientoActivo(),
  }),
);
