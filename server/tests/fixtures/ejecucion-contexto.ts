import { mock } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-flujo-contexto-"));
process.env.DATA_DIR = join(raiz, "data");
process.env.HOME = join(raiz, "home");
process.env.TELO_AISLAMIENTO = "activado";
process.env.TELO_REINTENTO_ESPERAS_MS = "5000";
const originales = await import("../../src/runners/opencode");
const llamadas: any[] = [];
let fallo = false;
let cancelar: AbortController | null = null;
const runner = async (opts: any) => {
  llamadas.push(opts);
  if (fallo) {
    setTimeout(() => cancelar?.abort(), 25);
    throw new originales.ErrorAgente("Error temporal HTTP 503", '{"statusCode":503,"message":"service unavailable"}');
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  opts.onUso?.({ input: 10, output: 2, reasoning: 0, cacheRead: 0, cost: 0, tokensMedidos: true, costeDisponible: true });
  return { text: "Respuesta", textoFinal: "Respuesta", sessionId: null, usage: null };
};
mock.module("../../src/runners/opencode", () => ({ ...originales, runOpenCode: runner }));
mock.module("../../src/runners/codex", () => ({ runCodex: runner }));
const { db } = await import("../../src/db");
const { ejecutarAgente } = await import("../../src/ejecutar");
const { guardarSecreto } = await import("../../src/secretos");
try {
  const cwd = join(raiz, "workspace");
  mkdirSync(cwd);
  const skill = join(process.env.HOME!, ".config", "opencode", "skills", "pasada");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: pasada\ndescription: Solo una tarea anterior.\n---\nGUIA-ANTIGUA-NO-ACTIVAR");
  process.env.TELO_CLAVE_CIFRADO = Buffer.alloc(32, 1).toString("base64");
  db.query("INSERT INTO projects(id,name,repo_path) VALUES('proyecto-flujo','Prueba',?)").run(cwd);
  db.query("INSERT INTO conversations(id,title,project_id) VALUES('chat-flujo','Prueba','proyecto-flujo')").run();
  guardarSecreto("proyecto-flujo", "PROJECT_SECRET", "secreto-ficticio-proyecto");
  guardarSecreto("proyecto-flujo", "GROQ_API_KEY", "clave-ficticia-inferencia");
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES('hist-flujo','chat-flujo','user','Antes usa $pasada')").run();
  const base = { cwd, projectId: "proyecto-flujo", conversationId: "chat-flujo", turnId: "turno-flujo", prompt: "Indica el estado actual.", model: "opencode/prueba" };
  await ejecutarAgente(base);
  assert(llamadas[0].prompt.includes("Antes usa $pasada"));
  assert(!llamadas[0].prompt.includes("GUIA-ANTIGUA-NO-ACTIVAR"));

  await Promise.all(["seguridad", "arquitectura"].map((rol) => ejecutarAgente({ ...base, soloLectura: true, usageRole: `reviewer:${rol}` })));
  assert.notEqual(llamadas[1].perfilOpenCodeDir, llamadas[2].perfilOpenCodeDir);
  for (const llamada of llamadas.slice(1)) {
    assert(!llamada.prompt.includes("Antes usa $pasada"));
    assert(!existsSync(llamada.perfilOpenCodeDir));
    assert.equal(llamada.extraEnv.PROJECT_SECRET, undefined);
    assert.equal(llamada.extraEnv.GROQ_API_KEY, "clave-ficticia-inferencia");
  }
  assert.equal(llamadas[0].extraEnv.PROJECT_SECRET, "secreto-ficticio-proyecto");
  assert(existsSync(llamadas[0].perfilOpenCodeDir));
  await ejecutarAgente({ ...base, model: "codex/prueba", soloLectura: true, usageRole: "reviewer:verificacion" });
  assert(llamadas[3].perfilCodexDir);
  assert(!existsSync(llamadas[3].perfilCodexDir));
  const usos = db.query<{ usage_role: string; turn_id: string }, []>("SELECT usage_role,turn_id FROM usage ORDER BY rowid").all();
  assert.equal(usos.length, 4);
  assert.deepEqual(new Set(usos.slice(1).map((u) => u.usage_role)), new Set(["reviewer:seguridad", "reviewer:arquitectura", "reviewer:verificacion"]));
  assert(usos.every((u) => u.turn_id === "turno-flujo"));

  fallo = true;
  cancelar = new AbortController();
  const inicio = Date.now();
  await assert.rejects(ejecutarAgente({ ...base, signal: cancelar.signal }));
  assert(Date.now() - inicio < 1500, "Cancelar no debe esperar los cinco segundos del reintento");
  assert.equal(llamadas.length, 5, "No se debe volver a lanzar el runner tras cancelar");
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}
