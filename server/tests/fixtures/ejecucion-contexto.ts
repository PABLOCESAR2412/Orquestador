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
const modelosOriginales = await import("../../src/models");
let supportsImages: boolean | undefined;
mock.module("../../src/models", () => ({ ...modelosOriginales, getModels: async () => [{id:"opencode/prueba", supportsImages}] }));
const llamadas: any[] = [];
let fallo = false;
const erroresPendientes: Error[] = [];
let cancelar: AbortController | null = null;
const runner = async (opts: any) => {
  llamadas.push(opts);
  if (erroresPendientes.length) throw erroresPendientes.shift();
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
  db.query("INSERT INTO conversations(id,title,project_id) VALUES('00000000-0000-4000-8000-111111111111','Prueba','proyecto-flujo')").run();
  guardarSecreto("proyecto-flujo", "PROJECT_SECRET", "secreto-ficticio-proyecto");
  guardarSecreto("proyecto-flujo", "GROQ_API_KEY", "clave-ficticia-inferencia");
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES('hist-flujo','00000000-0000-4000-8000-111111111111','user','Antes usa $pasada')").run();
  const base = { cwd, projectId: "proyecto-flujo", conversationId: "00000000-0000-4000-8000-111111111111", turnId: "turno-flujo", prompt: "Indica el estado actual.", model: "opencode/prueba" };
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
  fallo = false;
  await ejecutarAgente({...base, workMode:"plan", aprender:true});
  const plan = llamadas.at(-1);
  assert.equal(plan.soloLectura,true);
  assert.equal(plan.extraEnv.PROJECT_SECRET,undefined);
  assert(plan.prompt.includes("Modo Planear: solo lectura"));
  assert(plan.prompt.includes("Caveman lite/Ponytail"));
  const {guardarImagenAdjunta} = await import("../../src/chat-adjuntos");
  const imagen = guardarImagenAdjunta("00000000-0000-4000-8000-111111111111","captura.png",Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0ioAAAAASUVORK5CYII=","base64"));
  const prompt = `Arregla esto <<telo-imagen id="${imagen.id}" nombre="captura.png">>`;
  supportsImages = false;
  const antes = llamadas.length;
  await assert.rejects(ejecutarAgente({...base,prompt}), /no admite imágenes/);
  assert.equal(llamadas.length,antes,"No se debe consumir otra llamada ni sustituir el modelo");
  supportsImages = true;
  await ejecutarAgente({...base,prompt});
  assert.equal(llamadas.at(-1).imagenes.length,1);
  assert(llamadas.at(-1).prompt.includes("defecto observable"));
  process.env.TELO_REINTENTO_ESPERAS_MS = "0,0";
  erroresPendientes.push(new originales.ErrorAgente("Google HTTP 429",JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED",message:"Quota exceeded for GenerateRequestsPerMinutePerProjectPerModel-FreeTier. Please check plan and billing details."}})));
  const inicioRetry = llamadas.length;
  await ejecutarAgente(base);
  assert.equal(llamadas.length - inicioRetry,2,"RPM se debe reintentar en el mismo modelo");
  assert(llamadas.slice(inicioRetry).every(c=>c.model === base.model));
  const {modeloSinCuota}=await import("../../src/respaldos-cuota");
  assert.equal(modeloSinCuota(base.model,base.projectId),false);
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}
