import { Hono } from "hono";
import { aislamientoActivo } from "../runners/aislamiento";

export const runner = new Hono();

// GET /api/runner -> si el CLI del agente y bubblewrap están disponibles en el servidor.
// Sin bwrap, ningún chat ni tarea puede correr (falla cerrado), así que es lo primero que conviene ver.
runner.get("/runner", (c) =>
  c.json({
    opencode: Bun.which("opencode") !== null,
    bwrap: Bun.which("bwrap") !== null,
    aislamiento: aislamientoActivo(),
  }),
);
