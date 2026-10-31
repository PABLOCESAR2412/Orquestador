import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

// Solo fixtures locales: estas pruebas nunca llaman a proveedores ni a repositorios reales.
const root = existsSync("web/dist") ? resolve("web/dist") : resolve("dist");
function crearPdfPrueba() {
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objetos.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objetos.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const pdfPrueba = crearPdfPrueba();
const pngPrueba = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const videoPathPrueba = process.env.TELO_UI_VIDEO_FIXTURE;
const nombreVideoPrueba = videoPathPrueba ? basename(videoPathPrueba) : "video-prueba.webm";
const nombreHojaPrueba = `Fotogramas de ${nombreVideoPrueba.replace(/\.[^.]+$/, "")}.jpg`;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const path = resolve(root, "." + new URL(req.url).pathname);
  const file = Bun.file(path);
  return new Response(path.startsWith(root) && extname(path) && await file.exists() ? file : Bun.file(resolve(root, "index.html")));
} });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
mkdirSync("scratch/capturas-ci", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390, reducedMotion: "reduce", serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write", "notifications"] });
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (window.top !== window) return;
      if ("Notification" in window) {
        Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
        Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => "granted" });
      }
      localStorage.setItem("telo:cola:c1", JSON.stringify([
        { id: "q1", texto: "Primer mensaje reservado", creado: Date.now() },
        { id: "q2", texto: "Segundo mensaje reservado", creado: Date.now() + 1 },
        { id: "q3", texto: "Tercer mensaje reservado", creado: Date.now() + 2 },
      ]));
      localStorage.setItem("telo:cola-activa:c1", "false");
      window.SpeechRecognition = class {
        constructor() { window.__reconocimientoPrueba = this; }
        start() {}
        stop() { window.__dictadosDetenidos = (window.__dictadosDetenidos ?? 0) + 1; }
      };
    });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    const now = new Date().toISOString();
    const task = { id: "t1", title: "Prueba", model: "google/prueba", modelo_agotado: null, status: "done", created_at: now, started_at: now, finished_at: now, plan: null, reporte: null };
    const resumenCompactacion = "## Objective\n- COMPACTACION-INTERNA-PRUEBA\n## Important Details\n- Conservar el contexto.\n## Work State\n### Completed\n- Lectura.\n### Active\n- Verificación.\n### Blocked\n- (none)\n## Next Move\n1. Continuar.\n## Relevant Files\n- src/app.ts";
    const messages = [
      { id: "u1", role: "user", content: "git commit y push", created_at: now },
      { id: "a1", role: "assistant", content: '{"estado":"fallo","resumen":"Faltan dependencias","desviacion":"Instala antes de probar","pendientes":["x".replace("x","y")]}<telo-memoria>MEMORIA_INTERNA</telo-memoria>', model: "groq/llama-test", effort: "low", created_at: now },
      { id: "u2", role: "user", content: "prepara de nuevo el git commit y push", created_at: now },
      { id: "a2", role: "assistant", content: "El segundo intento está listo para revisar.\n\nAbre `server/src/ejecutar.ts:3-20` para ver el ejemplo. También revisa `Chat.tsx` y `Gone.tsx`.\n\nPDF generado: `informe revisión.pdf`.\n\n```mermaid\nflowchart TD\n  Chat --> API\n  API --> DB\n```\n\n```chart\n{\"type\":\"bar\",\"title\":\"Uso por área\",\"unit\":\"tokens\",\"data\":[{\"label\":\"Chat\",\"value\":120},{\"label\":\"Tareas\",\"value\":80}]}\n```\n\n```chart\n{\"type\":\"line\",\"title\":\"Uso diario\",\"data\":[{\"label\":\"Lun\",\"value\":20},{\"label\":\"Mar\",\"value\":35}]}\n```\n\n```chart\n{\"type\":\"pie\",\"title\":\"Distribución\",\"data\":[{\"label\":\"A\",\"value\":3},{\"label\":\"B\",\"value\":2}]}\n```\n\n```chart\n{\"type\":\"donut\",\"title\":\"Resultados\",\"data\":[{\"label\":\"Correcto\",\"value\":9},{\"label\":\"Pendiente\",\"value\":1}]}\n```\n\n```chart\n{\"type\":\"stats\",\"title\":\"Resumen\",\"unit\":\"pruebas\",\"data\":[{\"label\":\"Correctas\",\"value\":11,\"detail\":\"En verde\"}]}\n```\n\n```chart\nesto no es JSON\n```\n\n```chart\n{\"type\":\"bar\",\"title\":\"Balance\",\"data\":[{\"label\":\"Ingresos\",\"value\":5},{\"label\":\"Ajustes\",\"value\":-2}]}\n```\n\n| Capa | Uso |\n| --- | --- |\n| API | Datos |\n\n```text\nproyecto/\n└── src/\n```", model: "nvidia/nemotron-test", effort: "high", created_at: now },
      { id: "u-compact-old", role: "user", content: "Continúa el trabajo anterior", created_at: now },
      { id: "a-compact-old", role: "assistant", content: resumenCompactacion, created_at: now },
      { id: "u-compact-new", role: "user", content: "Termina después de resumir el contexto", created_at: now },
      { id: "a-compact-new", role: "assistant", content: "Resultado visible después de compactar.", sesion_compactada: 1, created_at: now },
      { id: "u-stale", role: "user", content: "Solicitud fallida anterior", created_at: now },
      { id: "s-stale", role: "system", content: "La solicitud anterior falló.", created_at: now },
      { id: "u-retry", role: "user", content: "Quiero una segunda versión de este PDF", created_at: now },
      { id: "s-retry", role: "system", content: "El agente superó el límite de 15 minutos y se detuvo. La sesión quedó guardada; reintenta para continuar donde se quedó.", created_at: now },
    ];
    messages[3].content += '\n\nFuente: [Precios de Workers](https://developers.cloudflare.com/workers/platform/pricing/ "Tarifas de CPU y memoria")';
    const cursoresMensajes = new Map();
    let ultimoCursorMensaje = 0;
    const actions = [
      { id: "git-old", action: "push", task_id: "t1", message_id: "u2", state: "failed", result: JSON.stringify({ mensaje: "Falló el intento anterior" }), payload: JSON.stringify({ remote: "https://github.com/ejemplo/pruebas", rama: "telo/prueba", messageId: "u2" }) },
      { id: "git-conflict-antiguo", action: "merge", task_id: "t1", message_id: "u2", state: "failed", result: JSON.stringify({ codigo: "merge_conflicts", mensaje: JSON.stringify({ codigo: "merge_conflicts", mensaje: "GitHub detectó conflictos entre telo/prueba y main.", pr_number: 9, pr_url: "https://github.com/ejemplo/pruebas/pull/9", rama_fuente: "telo/prueba", rama_base: "main", archivos: ["src/app.ts"], archivos_exactos: true, task_id: "t1", resoluble: true }) }), payload: JSON.stringify({ remote: "https://github.com/ejemplo/pruebas", rama: "telo/prueba", messageId: "u2" }) },
      { id: "git1", action: "push", task_id: "t1", message_id: "u-retry", state: "pending", result: null, payload: JSON.stringify({ remote: "https://github.com/ejemplo/pruebas", rama: "telo/prueba", messageId: "u-retry", autenticacion: { tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "PABLOCESAR2412", instalacion_id: 1 } }) },
    ];
    let authenticated = false;
    let chatDetenido = false;
    let conversacionesDisponibles = false;
    let modeloC1 = "google/prueba";
    let esfuerzoC1 = null;
    let orquestacionC1 = false;
    let seleccionAutomaticaC1 = true;
    let trabajadoresC1 = [];
    let configuracionesOrquestacion = [];
    let codexSesionEnPicker = false;
    let jevConfigurada = false;
    let approvals = 0;
    let reanudaciones = 0;
    let reintentos = [];
    let skillInstallRequests = 0;
    let skillSaveRequests = 0;
    let politicaDisco = { automatica: false, umbral: 85, intervaloHoras: 24, antiguedadDias: 7 };
    let ultimoDisco = null;
    let escriturasPreferencias = 0;
    let skillsGuardadas = [];
    let adjuntosChatSubidos = 0;
    let diffRequests = 0;
    let diffSinRepo = false;
    let probarColaProveedor = false;
    let lecturasColaProveedor = 0;
    let taskListRequests = 0;
    const esperasPollUsadas = [];
    let resolverEsperaPollLarga;
    const pollLargoObservado = new Promise(resolve => { resolverEsperaPollLarga = resolve; });
    let sinDatos = false;
    let anunciarEnvioA;
    let liberarEnvioA;
    let esperarAdjunto = null;
    let esperarPlan = null;
    let mostrarHistorialExtenso = false;
    const historialExtenso = Array.from({ length: 165 }, (_, n) => ({ id: `historial-${n + 1}`, role: n % 2 === 0 ? "user" : "assistant", content: `Historial numerado ${n + 1}`, created_at: now }));
    const envioAIniciado = new Promise(resolve => { anunciarEnvioA = resolve; });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const params = new URL(route.request().url()).searchParams;
      if (path === "/api/conversations/c1/detener") {
        chatDetenido = true;
        return route.fulfill({ status: 202, json: { outcome: "cancelling" } });
      }
      if (path === "/api/preferences" && route.request().method() === "PUT") escriturasPreferencias++;
      if (path === "/api/servidor/limpieza") {
        const metodo = route.request().method();
        if (metodo === "PUT") politicaDisco = route.request().postDataJSON();
        if (metodo === "POST") {
          const body = route.request().postDataJSON();
          assert.equal(body.confirmar, body.modo === "limpiar");
          ultimoDisco = { fecha: now, modo: body.modo, carpetas: 2, ocupadas: 1, errores: 0, libreAntes: 16e9, libreDespues: 16e9 };
          return route.fulfill({ json: ultimoDisco });
        }
        return route.fulfill({ json: { politica: politicaDisco, ultimo: ultimoDisco, enCurso: false } });
      }
      if (path === "/api/google-drive/archives") {
        return route.fulfill({ json: {
          configurado: false, callback_uri: null, conectado: false, cuenta: null, cifrado_disponible: false,
          candidatos: [], archivos: [], trabajos: [],
        } });
      }
      let data = [];
      if (path === "/api/sesion") return route.fulfill({ status: authenticated ? 200 : 401, json: { ok: authenticated } });
      if (path === "/api/login") { authenticated = true; data = { ok: true }; }
      else if (path === "/api/media/capacidades") data = {};
      else if (path === "/api/conversations") {
        const lista = conversacionesDisponibles ? [
        { id: "c1", title: "Prueba de flujo", model: modeloC1, effort: esfuerzoC1, orquestacion_habilitada: orquestacionC1, orquestacion_seleccion_automatica: seleccionAutomaticaC1, orquestacion_trabajadores: trabajadoresC1, project_id: "p1", project_name: "Pruebas", en_proceso: true, tiene_sesion: true, created_at: now, subchats: [{ id: "c-child", title: "Auditar API", model: "google/prueba", effort: "high", project_id: "p1", project_name: "Pruebas", parent_conversation_id: "c1", parent_turn_id: "u1", subagent_turn_id: "child-u1", subagent_agent: "telo-google-prueba-1", subagent_prompt: "Revisa las rutas y reporta riesgos", subagent_status: "running", subagent_result: null, created_at: now, last_message_at: now, ocupada: true, en_proceso: true }] },
        { id: "c2", title: "Chat paralelo", model: "nvidia/nemotron-test", project_id: null, project_name: null, created_at: now },
        { id: "c3", title: "Chat de esta semana", model: "google/prueba", project_id: null, project_name: null, pendiente_aprobacion: true, estado_tarea: "pendiente_aprobacion", estado_tarea_id: "review-c3", estado_tarea_version: "hash-c3", created_at: new Date(Date.now() - 4 * 86_400_000).toISOString() },
        { id: "c4", title: "Chat anterior", model: "google/prueba", project_id: null, project_name: null, created_at: new Date(Date.now() - 10 * 86_400_000).toISOString() },
        { id: "c5", title: "Chat libre", model: "google/prueba", project_id: null, project_name: null, created_at: now },
        ...(mostrarHistorialExtenso ? [{ id: "c6", title: "Historial extenso", model: "google/prueba", project_id: null, created_at: now }] : []),
      ] : [];
        // Con paginación por servidor, la primera tanda (?limite=) es un objeto; sin limite sigue siendo array.
        data = new URL(route.request().url()).searchParams.has("limite") ? { conversations: lista, siguiente: null } : lista;
      }
      else if (path === "/api/conversations/c1/turnos/u1/subagentes") data = [
        { id: "c-child", title: "Auditar API", model: "google/prueba", effort: "high", project_id: "p1", project_name: "Pruebas", parent_conversation_id: "c1", parent_turn_id: "u1", subagent_turn_id: "child-u1", subagent_agent: "telo-google-prueba-1", subagent_prompt: "Revisa las rutas y reporta riesgos", subagent_status: "running", subagent_result: null, created_at: now, last_message_at: now, ocupada: true, en_proceso: true },
      ];
      else if (path === "/api/conversations/c1/turnos/u-capacidad/actividad") {
        lecturasColaProveedor++;
        data = lecturasColaProveedor === 1
          ? [{ seq: 1, tipo: "accion", herramienta: "capacity", titulo: "En cola: esperando capacidad de opencode", detalle: null, estado: "en_curso" }]
          : [{ seq: 1, tipo: "accion", herramienta: "capacity", titulo: "Capacidad disponible en opencode", detalle: null, estado: "hecha" },
              { seq: 2, tipo: "accion", herramienta: "bash", titulo: "Ejecutó comprobación tras la espera", detalle: "$ bun test", estado: "en_curso" }];
      }
      else if (path === "/api/conversations/c1/turnos/u-compact-new/actividad") data = [
        { seq: 1, tipo: "accion", herramienta: "compaction", titulo: "Contexto compactado automáticamente", detalle: resumenCompactacion, estado: "hecha" },
      ];
      else if (path === "/api/conversations/c-child/messages") data = [
        { id: "child-u1", role: "user", content: "Revisa las rutas y reporta riesgos", created_at: now },
        { id: "child-a1", role: "assistant", content: "Revisé las rutas y preparé el reporte.", model: "google/prueba", created_at: now },
      ];
      else if (path === "/api/conversations/c-child/turnos/child-u1/actividad") data = [
        { seq: 1, tipo: "accion", herramienta: "bash", titulo: "Ejecutando git status", detalle: "git status --short", estado: "en_curso" },
      ];
      else if (path === "/api/conversations/c5/messages") data = [
        { id: "c2a", role: "assistant", content: "Informe adjunto: `libre.md`", model: "nvidia/nemotron-test", created_at: now },
      ];
      else if (path === "/api/conversations/c1/contexto") data = {
        conversation: { id: "c1", title: "Prueba de flujo", provider: "google", model: "google/prueba", effort: "high", sessionId: "sesion-prueba", sessionModel: "google/prueba", createdAt: now, lastActivity: now },
        messages: { total: 4, user: 2, assistant: 2, system: 0 }, actions: 3,
        usage: { calls: 2, chatCalls: 2, taskCalls: 0, inputTokens: 500, outputTokens: 120, reasoningTokens: 40, cacheReadTokens: 80, costUsd: 0.01, measured: 2, estimated: 0, unavailable: 0, unknown: 0 },
        byModel: [{ provider: "google", model: "google/prueba", calls: 2, inputTokens: 500, outputTokens: 120, costUsd: 0.01 }],
        lastInput: { provider: "google", model: "google/prueba", inputTokens: 250, tokensPrecision: "medida", createdAt: now },
      };
      else if (path === "/api/conversations/c5/archivo") data = { ruta: "libre.md", tamano: 24, texto: "# Chat libre\nVista previa disponible", truncado: false };
      else if (path === "/api/conversations/c1/archivo") {
        const ruta = new URL(route.request().url()).searchParams.get("ruta");
        if (ruta === "Chat.tsx") {
          return route.fulfill({ status: 409, json: { error: "project_path_ambiguous", matches: ["src/components/Chat.tsx", "src/pages/Chat.tsx"] } });
        }
        if (ruta === "Gone.tsx") return route.fulfill({ status: 404, json: { error: "project_path_not_found" } });
        data = { ruta, tamano: 42, texto: "export function responder() {\n  return 'ok';\n}\n", truncado: false };
      }
      else if (path === "/api/conversations/c1/messages") {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          if (body.retryOf === "u-retry") {
            reintentos.push(body);
            const aviso = messages.findIndex(mensaje => mensaje.id === "s-retry");
            if (aviso >= 0) messages.splice(aviso, 1);
            messages.push({ id: "a-retry", role: "assistant", content: "La segunda versión está lista.", created_at: now });
            return route.fulfill({ status: 202, json: { messages: [messages.find(mensaje => mensaje.id === "u-retry")] } });
          }
          if (body.content === "Envío del chat A") {
            anunciarEnvioA();
            await new Promise(resolve => { liberarEnvioA = resolve; });
            messages.push({ id: "u-paralelo", role: "user", content: body.content, created_at: now }, { id: "a-paralelo", role: "assistant", content: "Respuesta del chat A", created_at: now });
            return route.fulfill({ json: { messages: messages.slice(-2) } });
          }
          if (body.content === "Haz una imagen de un colibrí") {
            messages.push(
              { id: "u-media", role: "user", content: body.content, created_at: now },
              { id: "a-media", role: "assistant", content: "La petición de imagen se envió al agente con el modelo seleccionado y las herramientas locales disponibles.", model: "google/prueba", created_at: now },
            );
            return route.fulfill({ json: { messages: messages.slice(-2) } });
          }
          messages.push({ id: "u3", role: "user", content: body.content, created_at: now }, { id: "a3", role: "assistant", content: "Mensaje recibido", created_at: now });
          data = { messages: messages.slice(-2) };
        } else data = messages;
      }
      else if (path === "/api/conversations/c1/adjuntos" && route.request().method() === "POST") {
        if (esperarAdjunto) await esperarAdjunto;
        adjuntosChatSubidos += 1;
        return route.fulfill({
          status: 201,
          json: {
            id: `00000000-0000-4000-8000-${String(adjuntosChatSubidos).padStart(12, "0")}`,
            nombre: nombreHojaPrueba,
            mime: "image/jpeg",
            bytes: 2048,
          },
        });
      }
      else if (path === "/api/conversations/c1/archivo-pdf" || path === "/api/conversations/c2/archivo-pdf") {
        const params = new URL(route.request().url()).searchParams;
        const nombre = path.includes("/c2/") ? "libre.pdf" : "informe revisión.pdf";
        if (params.get("ruta") !== nombre) return route.fulfill({ status: 404, json: { error: "project_path_not_found" } });
        if (params.get("meta") === "1") return route.fulfill({ status: 200, json: { ruta: nombre, nombre, tamano: pdfPrueba.byteLength } });
        return route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: {
            "Content-Disposition": `${params.get("descargar") === "1" ? "attachment" : "inline"}; filename="${nombre}"`,
            "Accept-Ranges": "bytes",
          },
          body: pdfPrueba,
        });
      }
      else if (path === "/api/conversations/c2/archivo-imagen") {
        const params = new URL(route.request().url()).searchParams;
        const nombre = "infografía final.png";
        if (params.get("ruta") !== nombre) return route.fulfill({ status: 404, json: { error: "archivo_chat_no_encontrado" } });
        if (params.get("meta") === "1") return route.fulfill({ status: 200, json: { ruta: nombre, nombre, mime: "image/png", tamano: pngPrueba.byteLength } });
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "Content-Disposition": `${params.get("descargar") === "1" ? "attachment" : "inline"}; filename="${nombre}"` },
          body: pngPrueba,
        });
      }
      else if (path === "/api/conversations/c1" && route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        configuracionesOrquestacion.push(body);
        if ("model" in body) modeloC1 = body.model;
        if ("effort" in body) esfuerzoC1 = body.effort;
        if ("orquestacion_habilitada" in body) orquestacionC1 = body.orquestacion_habilitada;
        if ("orquestacion_seleccion_automatica" in body) seleccionAutomaticaC1 = body.orquestacion_seleccion_automatica;
        if ("orquestacion_trabajadores" in body) trabajadoresC1 = body.orquestacion_trabajadores;
        data = { id: "c1", title: "Prueba de flujo", model: modeloC1, effort: esfuerzoC1, orquestacion_habilitada: orquestacionC1, orquestacion_seleccion_automatica: seleccionAutomaticaC1, orquestacion_trabajadores: trabajadoresC1, pinned_at: null, costTier: null, costWarning: null };
      }
      else if (path === "/api/conversations/c2/messages") data = [
        { id: "a-c2-pdf", role: "assistant", content: "PDF libre generado: `libre.pdf`. Imagen lista: `infografía final.png`.", model: "nvidia/nemotron-test", created_at: now },
      ];
      else if (path === "/api/conversations/c6/messages") data = historialExtenso;
      else if (path === "/api/conversations/c1/acciones") data = actions;
      else if (path === "/api/conversations/c1/tasks" || path === "/api/tasks") data = [task];
      else if (path === "/api/tasks/t1/plan" && route.request().method() === "POST") {
        if (esperarPlan) await esperarPlan;
        task.status = "done";
        data = task;
      }
      else if (path === "/api/tasks/t1/reanudar" && route.request().method() === "POST") {
        reanudaciones++;
        task.status = "queued";
        data = task;
      }
      else if (path === "/api/tasks/t1/diff") {
        diffRequests++;
        data = diffSinRepo
          ? { estado: "sin_repo", rama: null, base_commit: null, commit: null, archivos: [], diff: "", truncado: false, hash: null, remoto: false, aprobaciones: { commit: null, push: null } }
          : diffRequests === 1
          ? { estado: "en_curso" }
          : { estado: "con_cambios", rama: "telo/prueba", base_commit: null, commit: "abcdef012345", archivos: [{ ruta: "src/app.ts", estado: "modificado", adiciones: 2, eliminaciones: 1, binario: false, sensible: false }], hash: "0123456789abcdef", diff: "diff de prueba", truncado: false, remoto: true, aprobaciones: { commit: null, push: null } };
      }
      else if (path.endsWith("/decidir")) { approvals++; const action = actions.find(item => item.id === "git1"); action.state = "approved"; action.result = JSON.stringify({ sha: "abcdef012345" }); return route.fulfill({ status: 409, json: { error: "action_already_decided" } }); }
      else if (path === "/api/models/intelligence") data = { configurado: true, disponible: true, version: 4.3, modelos: [{ slug: "prueba", name: "Google Test", creador: "Google", score: 42.5 }] };
      else if (path === "/api/models/usage") data = { counts: { "groq/llama-test": 12, "google/prueba": 5, "nvidia/nemotron-test": 3 } };
      else if (path === "/api/models") data = { models: [
        { id: "opencode/claude-fable-5", provider: "opencode", name: "Claude Fable 5", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Claude", recommended: true },
        { id: "google/prueba", provider: "google", name: "Google Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Gemini", recommended: true },
        { id: "nvidia/nemotron-test", provider: "nvidia", name: "Nemotron Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Nemotron", recommended: true },
        { id: "nvidia/llama-test", provider: "nvidia", name: "NVIDIA Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Llama", recommended: true },
        { id: "groq/llama-test", provider: "groq", name: "Llama Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Llama", recommended: true },
        { id: "groq/other-test", provider: "groq", name: "Other Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Other", recommended: true },
      ] };
      else if (path === "/api/preferences") data = { defaultModel: null, defaultEffort: null, monthlyBudgetUsd: null, budgetAlertPercent: 80 };
      else if (path === "/api/providers") data = [
        { id: "opencode", name: "OpenCode", configured: true, implemented: true, hint: "CLI instalado.", variable: null, enAgente: true, guardable: false, guardada: false, sesion: false },
        { id: "codex", name: "Codex", configured: codexSesionEnPicker, implemented: true, hint: "Sesión de Codex.", variable: "OPENAI_API_KEY", enAgente: false, guardable: false, guardada: false, sesion: codexSesionEnPicker },
        { id: "google", name: "Google (Gemini)", configured: true, implemented: true, hint: "Clave de prueba.", variable: "GOOGLE_GENERATIVE_AI_API_KEY", enAgente: true, guardable: true, guardada: true, sesion: false },
        { id: "groq", name: "Groq", configured: false, implemented: true, hint: "Clave de prueba.", variable: "GROQ_API_KEY", enAgente: false, guardable: true, guardada: false, sesion: false },
        { id: "nvidia", name: "NVIDIA", configured: true, implemented: true, hint: "Clave de prueba.", variable: "NVIDIA_API_KEY", enAgente: false, guardable: true, guardada: false, sesion: false },
        { id: "openrouter", name: "OpenRouter", configured: false, implemented: true, hint: "Clave de prueba.", variable: "OPENROUTER_API_KEY", enAgente: false, guardable: true, guardada: false, sesion: false },
      ];
      else if (/^\/api\/providers\/[^/]+\/probar$/.test(path)) data = { ok: true, modelos: 7 };
      else if (path === "/api/providers/codex/models") data = { generado: now, models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", context: 100000, variants: ["high"] }] };
      else if (path === "/api/providers/codex/login") data = { estado: "esperando", conectada: false, url: "https://auth.openai.com/codex/device", codigo: "ABCD-EFGH", salida: "Salida de prueba\n" + "x".repeat(300) };
      else if (path === "/api/jev" && route.request().method() === "GET") data = { disponible: true, configurada: jevConfigurada, actualizada_en: jevConfigurada ? now : null };
      else if (path === "/api/jev" && route.request().method() === "PUT") {
        jevConfigurada = true;
        data = { configurada: true, actualizada_en: now };
      }
      else if (path === "/api/jev" && route.request().method() === "DELETE") { jevConfigurada = false; data = { ok: true }; }
      else if (path === "/api/jev/probar") data = { ok: true };
      else if (path === "/api/jev/recomendaciones") data = { recomendaciones: route.request().postDataJSON().candidatas, ordenadas_con_jev: false };
      else if (path === "/api/skills/instalar") {
        skillInstallRequests++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return route.fulfill({ status: 409, json: { error: "skill_command_ambiguous" } });
      }
      else if (path === "/api/skills") data = { skills: skillsGuardadas.map(({ contenido, ...skill }) => skill) };
      else if (path.startsWith("/api/skills/") && route.request().method() === "GET") {
        const nombre = decodeURIComponent(path.slice("/api/skills/".length));
        const skill = skillsGuardadas.find(item => item.nombre === nombre);
        if (!skill) return route.fulfill({ status: 404, json: { error: "skill_no_encontrada" } });
        data = skill;
      }
      else if (path.startsWith("/api/skills/") && route.request().method() === "PUT") {
        const nombre = decodeURIComponent(path.slice("/api/skills/".length));
        const contenido = route.request().postDataJSON().contenido;
        skillsGuardadas = skillsGuardadas.filter(item => item.nombre !== nombre);
        skillsGuardadas.push({ nombre, descripcion: "Skill preparada desde una experiencia", valida: true, bytes: Buffer.byteLength(contenido), modificada: now, contenido });
        skillSaveRequests++;
        data = { creada: true };
      }
      else if (path === "/api/servidor") data = null;
      else if (path === "/api/skills") data = { skills: [] };
      else if (path.includes("/herramientas/")) data = { instalada: true, estado: "inactivo" };
      else if (path.includes("github/app")) data = { configurado: true, faltantes: [], seleccionada: 1, instalaciones: [
        { id: 1, name: "PABLOCESAR2412", login: "PABLOCESAR2412", avatar_url: "", repository_selection: "all" },
      ] };
      else if (path.includes("github/cuenta") || path.includes("google")) data = { conectado: true, metodo: "app", login: "PABLOCESAR2412", sesion_anterior: false };
      else if (path.includes("/projects/") && path.includes("/git/comprobar")) data = { ok: true, repo: "ejemplo/pruebas", push: true, verificacion: "confirmada", autenticacion: { tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "PABLOCESAR2412", instalacion_id: 1 } };
      else if (path.includes("/projects/") && path.endsWith("/git")) data = { remote: "https://github.com/ejemplo/pruebas", repository: "ejemplo/pruebas", author_name: "Telo", base_branch: "main", inicializado: true, ocupado: false, token: false, tokenProyecto: false, tokenGlobal: false, prToken: false, ssh: false, github: { conectado: true, metodo: "app", login: "PABLOCESAR2412" } };
      else if (path === "/api/runner") data = { opencode: true, bwrap: true, aislamiento: true };
      else if (path === "/api/health") data = { ok: true, time: now };
      else if (path === "/api/tasks") { taskListRequests++; data = [{ id: "regular-1", title: "Prompt ordinario del chat", model: "google/prueba", status: "done", created_at: now }]; }
      else if (path === "/api/programadas") data = [{ id: "schedule-1", titulo: "Resumen diario", prompt: "Preparar resumen", model: "google/prueba", effort: null, project_id: null, project_name: null, frecuencia: "diaria", cada_horas: null, hora: "08:00", activa: true, proxima_en: now, ultima_ejecucion: null, ultima_tarea_id: null, created_at: now }];
      else if (path === "/api/projects") data = [{ id: "p1", name: "Pruebas", en_proceso: true }];
      else if (path === "/api/documentos" && route.request().method() === "POST") data = { id: "doc1", conversation_id: "c1", titulo: "Documento de prueba", formato: "md", bytes: 123, created_at: now };
      else if (path === "/api/documentos/doc1/vista") {
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body><p>Vista previa de prueba</p></body></html>" });
      }
      else if (path.startsWith("/api/documentos")) data = [];
      else if (path === "/api/projects/p1/archivo") {
        const ruta = new URL(route.request().url()).searchParams.get("ruta");
        if (ruta === "Chat.tsx") {
          return route.fulfill({ status: 409, json: { error: "project_path_ambiguous", matches: ["src/components/Chat.tsx", "src/pages/Chat.tsx"] } });
        }
        if (ruta === "Gone.tsx") return route.fulfill({ status: 404, json: { error: "project_path_not_found" } });
        data = { ruta, tamano: 42, texto: "export function responder() {\n  return 'ok';\n}\n", truncado: false };
      }
      else if (path === "/api/uso") data = { generado: now, proveedores: [{
        id: "google", nombre: "Google (Gemini)",
        ultimas5h: { costoUsd: 0.5, costoEstimadoUsd: 0.5, costesEstimados: 2, costesNoDisponibles: 0, costesDesconocidos: 0, tokens: 1200, tokensMedidos: 1200, tokensEstimados: 0, tokensNoDisponibles: 0, tokensDesconocidos: 0, llamadasSinTokens: 0, llamadas: 2 },
        ultimos7d: { costoUsd: 1, costoEstimadoUsd: 1, costesEstimados: 6, costesNoDisponibles: 0, costesDesconocidos: 0, tokens: 4000, tokensMedidos: 4000, tokensEstimados: 0, tokensNoDisponibles: 0, tokensDesconocidos: 0, llamadasSinTokens: 0, llamadas: 6 },
        mesActual: { costoUsd: 1, costoEstimadoUsd: 1, costesEstimados: 6, costesNoDisponibles: 0, costesDesconocidos: 0, tokens: 4000, tokensMedidos: 4000, tokensEstimados: 0, tokensNoDisponibles: 0, tokensDesconocidos: 0, llamadasSinTokens: 0, llamadas: 6 },
        precision: "registro_telo",
      }], googleLive: { conectado: true, estado: "activo", mensaje: "Clave válida", ultimaComprobacion: now } };
      else if (path === "/api/analytics") data = {
        days: 30, filtros: { proyecto: null, modelo: null }, proyectos: [], modelos: [], budget: null, usoJev: [],
        totals: { calls: 1, inputTokens: sinDatos ? 0 : 8, outputTokens: sinDatos ? 0 : 2, cost: 0 }, byDay: [{ day: now.slice(0, 10), calls: 1, cost: 0, tokens: sinDatos ? 0 : 10, tokensEstimados: 0, modelos: [{ model: "google/prueba", provider: "google", calls: 1, tokens: sinDatos ? 0 : 10, estimados: 0 }] }], byModel: [{ model: "opencode/muse-spark-1.3-contributor-free-con-nombre-extenso", tareas: 0, tokens: 3100000, duracionMediaSeg: 591, cost: 0, calls: 2 }],
        byType: ["chat", "tarea", "otro"].map(tipo => ({ tipo, calls: tipo === "tarea" ? 1 : 0, tokens: tipo === "tarea" && !sinDatos ? 10 : 0, cost: 0, tokensEstimados: 0, sinTokens: tipo === "tarea" && sinDatos ? 1 : 0, sinCoste: tipo === "tarea" && sinDatos ? 1 : 0 })),
        tasks: { done: 1 }, calidad: { tokensMedidos: sinDatos ? 0 : 1, tokensEstimados: 0, costesEstimados: sinDatos ? 0 : 1, sinTokens: sinDatos ? 1 : 0, sinCoste: sinDatos ? 1 : 0, historicos: 0 },
        byTask: [{ taskId: "t1", calls: 1, tokens: sinDatos ? 0 : 10, cost: 0, tokensMedidos: sinDatos ? 0 : 1, costesEstimados: sinDatos ? 0 : 1, sinTokens: sinDatos ? 1 : 0, sinCoste: sinDatos ? 1 : 0, historicos: 0 }],
      };
      else if (path.includes("eventos-vivos/poll")) {
        if (probarColaProveedor) return route.fulfill({ status: 503, json: { error: "canal_no_disponible_fixture" } });
        const esperaPollUsada = Number(new URL(route.request().url()).searchParams.get("espera"));
        esperasPollUsadas.push(esperaPollUsada);
        if (esperaPollUsada >= 4000) resolverEsperaPollLarga();
        data = { cursor: 0, eventos: [] };
      }
      else if (path.includes("eventos-vivos")) return route.fulfill({ contentType: "text/event-stream", body: ": alive\n\n" });
      if (/\/conversations\/[^/]+\/messages$/.test(path) && route.request().method() === "GET" && params.get("pagina") === "1" && Array.isArray(data)) {
        let turnoPrevio = null;
        const todas = data.map((mensaje) => {
          if (!cursoresMensajes.has(mensaje.id)) cursoresMensajes.set(mensaje.id, ++ultimoCursorMensaje);
          if (mensaje.role === "user") turnoPrevio = mensaje;
          return { ...mensaje, cursor: cursoresMensajes.get(mensaje.id), turno_id: mensaje.role === "user" ? null : turnoPrevio?.id ?? null, turno_created_at: mensaje.role === "user" ? null : turnoPrevio?.created_at ?? null };
        });
        const despues = Number(params.get("despues") ?? 0);
        const antes = Number(params.get("antes") ?? Number.MAX_SAFE_INTEGER);
        const pagina = despues ? todas.filter(m => m.cursor >= despues).slice(0, 40) : todas.filter(m => m.cursor < antes).slice(-40);
        const ultimo = pagina.at(-1)?.cursor ?? despues;
        data = { messages: pagina, anterior: todas.some(m => m.cursor < (pagina[0]?.cursor ?? 0)) ? pagina[0].cursor : null, ultimo, mas: todas.some(m => m.cursor > ultimo), reiniciar: false,
          vigentes: todas.filter(m => m.cursor >= Number(params.get("desde") ?? Number.MAX_SAFE_INTEGER) && m.cursor <= ultimo).map(m => ({ id: m.id, sesion_compactada: m.sesion_compactada ?? 0 })) };
      }
      return route.fulfill({ json: data });
    });
    const respuestaDiffTransitoria = page.waitForResponse(response => response.url().endsWith("/api/tasks/t1/diff"));
    await page.goto(`${base}/entrar`);
    await page.getByLabel("Clave de acceso").fill("clave-ficticia-de-prueba");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/chat");
    console.log(`${width}px: sesión local de prueba iniciada`);
    await page.getByText("Conversaciones", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Bienvenido a Telo", exact: true }).waitFor();
    await page.getByRole("button", { name: "Nuevo chat", exact: true }).waitFor();
    const marcaChatNuevo = page.locator(".tl-vacio-emblema");
    assert.equal(await marcaChatNuevo.locator("svg").count(), 1, "el chat nuevo reutiliza el símbolo de Telo");
    assert.equal(await marcaChatNuevo.locator(".tl-vacio-orbita").count(), 2, "el símbolo tiene dos líneas orbitales");
    assert.equal(await page.locator(".tl-vacio-reticula").count(), 0, "el fondo usa la marca y no una cuadrícula genérica");
    assert.equal(await marcaChatNuevo.locator(".tl-vacio-orbita").first().evaluate(el => getComputedStyle(el).animationName), "none", "la animación se detiene con movimiento reducido");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await marcaChatNuevo.locator(".tl-vacio-orbita").first().evaluate(el => getComputedStyle(el).animationName), "tl-vacio-orbita", "las líneas orbitan cuando el usuario permite movimiento");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `scratch/capturas-ci/chat-vacio-animado-${width}.png` });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "la pantalla de chat nuevo cabe en móvil y escritorio");
    await page.screenshot({ path: `scratch/capturas-ci/chat-vacio-${width}.png` });
    conversacionesDisponibles = true;
    await page.reload();
    await page.locator(".tl-inicio-recientes").getByRole("button").filter({ hasText: "Prueba de flujo" }).click();
    await page.getByText("Conversaciones", { exact: true }).waitFor();
    let timeoutPollLargo;
    await Promise.race([
      pollLargoObservado,
      new Promise((_, reject) => { timeoutPollLargo = setTimeout(() => reject(new Error("no se observó el sondeo de 4 s de eventos")), 10_000); }),
    ]).finally(() => clearTimeout(timeoutPollLargo));
    assert.ok(esperasPollUsadas.includes(4000), "el sondeo vivo usa 4 s para dejar margen frente al proxy HTTP/2");
    const mensajeSupervisor = page.locator(".tl-msg-agente").filter({ hasText: "Faltan dependencias" }).first();
    await mensajeSupervisor.getByText("Se creó 1 subagente", { exact: true }).waitFor();
    await mensajeSupervisor.getByText("1 trabajando", { exact: true }).waitFor();
    await mensajeSupervisor.getByText("Encargo del Supervisor:", { exact: false }).waitFor();
    await mensajeSupervisor.locator(".tl-subagente-encargo").filter({ hasText: "Revisa las rutas y reporta riesgos" }).waitFor();
    await mensajeSupervisor.locator(".tl-proceso-boton").click();
    await mensajeSupervisor.getByText("Ejecutando git status", { exact: true }).first().waitFor();
    await mensajeSupervisor.getByRole("button", { name: "Abrir subchat", exact: true }).click();
    await page.getByRole("heading", { name: "Auditar API", exact: true }).waitFor();
    await page.locator(".tl-subchat-solo-lectura").getByText("No se pueden enviar mensajes a esta sesión.").waitFor();
    assert.equal(await page.locator(".tl-composer").count(), 0, "un subchat no muestra compositor para nuevos prompts");
    const mensajeSubagente = page.locator(".tl-msg-agente").filter({ hasText: "Revisé las rutas y preparé el reporte." }).last();
    await mensajeSubagente.getByText("Ejecutando git status", { exact: true }).waitFor();
    if (width === 390) {
      const cajaTituloSubchat = await page.getByRole("heading", { name: "Auditar API", exact: true }).boundingBox();
      const cajaBotonVolver = await page.locator(".tl-subchat-padre").boundingBox();
      const cajaAccionesChat = await page.locator(".tl-chat-cabecera-der").boundingBox();
      assert.ok(cajaTituloSubchat && cajaBotonVolver && cajaAccionesChat, "el encabezado del subchat conserva título, padre y acciones en móvil");
      assert.ok(cajaTituloSubchat.width > 40, "el título del subchat tiene espacio visible en móvil");
      assert.ok(cajaAccionesChat.y >= cajaBotonVolver.y + cajaBotonVolver.height, "las acciones quedan debajo de la identidad y el enlace al supervisor en móvil");
    }
    await page.getByRole("button", { name: "Volver al chat principal: Prueba de flujo", exact: true }).click();
    await page.getByRole("heading", { name: "Prueba de flujo", exact: true }).waitFor();
    console.log(`${width}px: actividad en vivo y navegación entre supervisor y subchat comprobadas`);
    const compactaciones = page.locator(".tl-compactacion");
    assert.equal(await compactaciones.count(), 2, "el resumen antiguo y la compactación nueva tienen controles independientes");
    assert.equal(await compactaciones.locator("pre").count(), 0, "ninguna compactación se muestra abierta al entrar");
    await compactaciones.first().locator("summary").click();
    await compactaciones.first().locator("pre").waitFor();
    assert.equal(await compactaciones.first().locator("pre").textContent(), resumenCompactacion, "el resumen histórico se conserva íntegro al expandir");
    await compactaciones.first().locator("summary").click();
    await compactaciones.last().locator("summary").click();
    await compactaciones.last().locator("pre").waitFor();
    assert.equal(await compactaciones.last().locator("pre").textContent(), resumenCompactacion, "el nuevo resumen se carga desde la actividad del turno");
    assert.equal(await page.getByText("Resultado visible después de compactar.", { exact: true }).isVisible(), true, "la respuesta final permanece separada");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/compactacion-${width}.png` });
    await compactaciones.last().locator("summary").click();
    await page.getByText("Resultado visible después de compactar.", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scratch/capturas-ci/compactacion-plegada-${width}.png` });
    if (width === 390) {
      await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
      const filaChatAnterior = page.locator('.sidebar-conv[aria-label="Chat anterior"]').locator("..");
      const tiempoChat = filaChatAnterior.locator(".sidebar-conv-tiempo");
      const opcionesChat = filaChatAnterior.getByRole("button", { name: "Más opciones para Chat anterior", exact: true });
      const [cajaTiempo, cajaOpciones] = await Promise.all([tiempoChat.boundingBox(), opcionesChat.boundingBox()]);
      assert.ok(cajaTiempo && cajaOpciones, "la fecha y el menú del chat son visibles en el cajón móvil");
      assert.equal(await opcionesChat.evaluate(elemento => getComputedStyle(elemento).opacity), "1", "las opciones aparecen en pantallas táctiles");
      assert.ok(cajaTiempo.x + cajaTiempo.width <= cajaOpciones.x || cajaOpciones.x + cajaOpciones.width <= cajaTiempo.x,
        "el menú de opciones no se superpone con la última actividad del chat en móvil");
      assert.ok(cajaOpciones.width >= 36, "el botón de opciones conserva un objetivo táctil cómodo");
    }
    await page.screenshot({ path: `scratch/capturas-ci/barra-lateral-${width}.png` });
    if (width === 390) await page.getByRole("button", { name: "Cerrar barra lateral", exact: true }).click();
    assert.equal(await page.locator('.sidebar-conv[aria-label^="Chat paralelo"] .sidebar-conv-chat-icon').count(), 1, "cada chat libre muestra su icono");
    assert.equal((await (await respuestaDiffTransitoria).json()).estado, "en_curso");
    await page.locator(".tl-diagrama-visual svg").waitFor();
    await page.locator(".tl-grafico-chat").first().waitFor();
    const comprobarTemaDiagrama = async tema => {
      await page.evaluate(valor => {
        const root = document.documentElement;
        root.removeAttribute("data-palette");
        root.removeAttribute("style");
        root.dataset.theme = valor;
      }, tema);
      await page.waitForFunction(valor => {
        const root = document.documentElement;
        const figura = document.querySelector(".tl-diagrama-visual svg .node rect");
        const muestra = document.createElement("span");
        muestra.style.color = "var(--surface-2)";
        document.body.append(muestra);
        const colorEsperado = getComputedStyle(muestra).color;
        muestra.remove();
        return figura && getComputedStyle(root).colorScheme === (valor === "claro" ? "light" : "dark")
          && getComputedStyle(figura).fill === colorEsperado;
      }, tema);
      await page.waitForFunction(() => document.querySelectorAll(".tl-diagrama-visual svg .node").length === 3);
    };
    await comprobarTemaDiagrama("oscuro");
    await comprobarTemaDiagrama("claro");
    await comprobarTemaDiagrama("oscuro");
    assert.equal(await page.locator(".tl-diagrama-visual svg .node").count(), 3);
    if (width === 1440) {
      await page.locator(".tl-diagrama-visual svg").waitFor();
      const diagramaInicial = await page.locator(".tl-diagrama").first().elementHandle();
      assert.ok(diagramaInicial);
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/conversations") && response.request().method() === "GET"),
        page.waitForResponse(response => response.url().includes("/api/conversations/c1/messages") && response.request().method() === "GET"),
      ]);
      assert.equal(await diagramaInicial.evaluate(elemento => elemento.isConnected), true,
        "actualizar el chat por sondeo no debe desmontar y volver a generar el diagrama");
      await diagramaInicial.dispose();
    }
    assert.equal(await page.locator(".tl-diagrama-fuente summary").textContent(), "Ver código Mermaid");
    assert.equal(await page.locator(".tl-grafico-chat").count(), 6);
    assert.equal(await page.locator(".tl-grafico-chat").nth(0).locator(".tl-grafico-barras li").count(), 2);
    assert.equal(await page.locator(".tl-grafico-chat").nth(1).locator(".tl-grafico-linea").count(), 1);
    assert.equal(await page.locator(".tl-grafico-chat").nth(2).locator(".tl-grafico-segmento").count(), 2);
    assert.equal(await page.locator(".tl-grafico-chat").nth(3).locator(".tl-grafico-total").textContent(), "10");
    assert.equal(await page.locator(".tl-grafico-chat").nth(4).locator(".tl-grafico-estadisticas li").count(), 1);
    assert.equal(await page.locator(".tl-grafico-chat").nth(5).locator(".tl-grafico-barras li").count(), 2);
    assert.ok(parseFloat(await page.locator(".tl-grafico-chat").nth(5).locator(".tl-grafico-barra").nth(1).evaluate(el => el.style.left)) < 1, "una barra negativa parte a la izquierda del cero");
    await page.locator(".tl-grafico-chat").first().locator(".tl-grafico-datos summary").click();
    assert.equal(await page.locator(".tl-grafico-chat").first().locator(".tl-grafico-datos tbody tr").count(), 2);
    assert.equal(await page.locator(".tl-codigo-pestana").filter({ hasText: "chart" }).count(), 1, "JSON inválido se conserva como código");
    const mensajeUsuario = page.locator(".tl-msg-usuario").filter({ hasText: "git commit y push" }).first();
    const mensajeAgente = page.locator(".tl-msg-agente").filter({ hasText: "Faltan dependencias" }).first();
    await mensajeAgente.getByRole("button", { name: "Derivar una skill global de esta experiencia", exact: true }).click();
    const borradorChat = page.locator(".tl-composer-input");
    assert.match(await borradorChat.inputValue(), /^\$skill-authoring\n\n/);
    await borradorChat.fill("");
    for (const mensaje of [mensajeUsuario, mensajeAgente]) {
      const [meta, acciones] = await Promise.all([
        mensaje.locator(".tl-msg-meta").boundingBox(),
        mensaje.locator(".tl-msg-acciones").boundingBox(),
      ]);
      assert.ok(meta && acciones);
      if (width === 390) assert.ok(acciones.y >= meta.y + meta.height - 1, "en móvil, las acciones del mensaje van debajo de sus metadatos");
      else assert.ok(acciones.y < meta.y + meta.height && meta.y < acciones.y + acciones.height, "en escritorio, las acciones conservan la fila de metadatos");
    }
    await page.locator(".tl-grafico-chat").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scratch/capturas-ci/chat-graficos-${width}.png` });
    const mensajeConGraficos = page.locator(".tl-msg-agente").filter({ hasText: "El segundo intento está listo para revisar." });
    await mensajeConGraficos.getByRole("button", { name: "Guardar como documento" }).click();
    await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
    const vistaDocumento = page.getByRole("dialog", { name: "Vista previa de Documento de prueba" });
    await vistaDocumento.waitFor();
    const imprimirPdf = vistaDocumento.getByRole("link", { name: "PDF / Imprimir" });
    assert.equal(await imprimirPdf.getAttribute("href"), "/api/documentos/doc1/vista");
    assert.equal(await imprimirPdf.getAttribute("target"), "_blank");
    const descargarDocumento = vistaDocumento.getByRole("link", { name: "Descargar", exact: true });
    assert.equal(await descargarDocumento.getAttribute("href"), "/api/documentos/doc1/archivo");
    assert.ok(await descargarDocumento.getAttribute("download") !== null, "la vista permite bajar el archivo generado");
    await vistaDocumento.getByRole("button", { name: "Cerrar", exact: true }).click();
    assert.equal(await page.locator(".tl-tabla-wrap table tbody tr").count(), 1);
    assert.ok((await page.locator(".tl-md pre code").allTextContents()).some(codigo => codigo.includes("└── src/")));
    const enlaceFuente = page.locator(".tl-enlace-preview-trigger").filter({ hasText: "Precios de Workers" }).first();
    assert.equal(await enlaceFuente.getAttribute("href"), "https://developers.cloudflare.com/workers/platform/pricing/");
    await enlaceFuente.hover();
    const vistaPreviaEnlace = page.locator(".tl-enlace-preview-card").filter({ hasText: "Precios de Workers" }).first();
    await vistaPreviaEnlace.waitFor({ state: "visible" });
    assert.match(await vistaPreviaEnlace.textContent(), /developers\.cloudflare\.com/);
    assert.match(await vistaPreviaEnlace.textContent(), /Tarifas de CPU y memoria/);
    assert.equal(await vistaPreviaEnlace.getByRole("link", { name: "Abrir" }).getAttribute("target"), "_blank");
    await enlaceFuente.focus();
    await vistaPreviaEnlace.waitFor({ state: "visible" });
    assert.equal(await page.locator(".tl-msg-meta").filter({ hasText: "Llama Test" }).count(), 1);
    assert.equal(await page.locator(".tl-msg-meta").filter({ hasText: "Nemotron Test" }).count(), 1);
    assert.equal(await page.locator(".tl-msg-esfuerzo").filter({ hasText: "Bajo" }).count(), 1);
    assert.equal(await page.locator(".tl-msg-esfuerzo").filter({ hasText: "Alto" }).count(), 1);
    await page.locator(".tl-modelo-boton").click();
    const selectorModelo = page.getByRole("dialog", { name: "Elegir modelo" });
    assert.match(await selectorModelo.locator(".picker-tus-modelos").innerText(), /Llama Test/);
    assert.match(await selectorModelo.locator(".picker-tus-modelos").innerText(), /Google Test/);
    assert.equal(await selectorModelo.locator(".picker-intelligence").filter({ hasText: "AA 42,5" }).count(), 1);
    // El buscador filtra el catálogo en vivo, esconde "Tus modelos" y marca el proveedor en cada fila.
    const campoBusca = selectorModelo.locator(".picker-search");
    await campoBusca.fill("other");
    await selectorModelo.locator(".picker-item").filter({ hasText: "Other Test" }).waitFor();
    assert.match(await selectorModelo.locator(".picker-conteo").innerText(), /1 modelo/);
    assert.equal(await selectorModelo.locator(".picker-item").filter({ hasText: "Llama Test" }).count(), 0);
    assert.equal(await selectorModelo.locator(".picker-proveedor-chip").filter({ hasText: "Groq API" }).count(), 1);
    await campoBusca.fill("inexistente");
    assert.equal(await selectorModelo.locator(".picker-item").count(), 0);
    assert.match(await selectorModelo.locator(".muted-note").innerText(), /Sin resultados/);
    await selectorModelo.locator(".picker-limpiar").click();
    await selectorModelo.locator(".picker-tus-modelos").waitFor();
    const anclarGoogle = selectorModelo.getByRole("button", { name: "Anclar Google Test en favoritos", exact: true });
    await anclarGoogle.click();
    assert.equal(await selectorModelo.getByRole("button", { name: "Quitar Google Test de favoritos", exact: true }).getAttribute("aria-pressed"), "true");
    await selectorModelo.locator(".picker-item").filter({ hasText: "Other Test" }).click();
    await page.locator(".tl-modelo-boton .tl-modelo-nombre").filter({ hasText: "Other Test" }).waitFor();
    assert.equal(await page.locator(".tl-msg-meta").filter({ hasText: "Llama Test" }).count(), 1);
    assert.equal(await page.locator(".tl-msg-meta").filter({ hasText: "Nemotron Test" }).count(), 1);
    assert.equal(await page.locator(".tl-msg-esfuerzo").filter({ hasText: "Bajo" }).count(), 1);
    assert.equal(await page.locator(".tl-msg-esfuerzo").filter({ hasText: "Alto" }).count(), 1);
    await page.locator(".tl-modelo-boton").click();
    await selectorModelo.locator(".picker-item").filter({ hasText: "Google Test" }).click();
    await page.locator(".tl-modelo-boton .tl-modelo-nombre").filter({ hasText: "Google Test" }).waitFor();
    const botonReintento = page.getByRole("button", { name: "Continuar donde quedó", exact: true });
    assert.equal(await botonReintento.count(), 1, "solo se puede reintentar el último aviso; los avisos antiguos no muestran la acción");
    const solicitudReintento = page.waitForRequest(request => request.url().endsWith("/api/conversations/c1/messages") && request.method() === "POST" && request.postDataJSON().retryOf === "u-retry");
    await botonReintento.click();
    await solicitudReintento;
    await page.getByText("La segunda versión está lista.", { exact: true }).waitFor();
    await botonReintento.waitFor({ state: "detached" });
    assert.equal(reintentos.length, 1);
    assert.equal(await page.locator("#mensaje-u-retry").count(), 1, "el reintento no añade una segunda copia del prompt");
    assert.equal(await page.locator(".tl-msg-usuario").filter({ hasText: "Quiero una segunda versión de este PDF" }).count(), 1);
    console.log(`${width}px: selector de modelos y puntuación comprobados`);
    assert.equal(await page.locator(".tl-atajos-barra").count(), 0);
    const inputChat = page.getByRole("textbox", { name: "Mensaje", exact: true });
    const hiloChat = page.locator(".tl-hilo");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), "hidden", "el body no debe mostrar un segundo scroll junto al hilo");
    assert.equal(await hiloChat.evaluate(el => getComputedStyle(el).overflowX), "hidden", "el hilo no debe permitir desplazamiento horizontal");
    assert.equal(await hiloChat.evaluate(el => getComputedStyle(el).overflowY), "auto", "el hilo conserva su desplazamiento vertical");
    assert.ok(await hiloChat.evaluate(el => el.scrollHeight > el.clientHeight), "el hilo debe poder desplazarse cuando hay muchos mensajes");
    const recomendacion = await inputChat.getAttribute("placeholder");
    assert.ok(recomendacion && recomendacion.length > 20);
    assert.doesNotMatch(recomendacion, /Usa \/ para ver comandos|para comandos/);
    assert.equal(await page.locator(".tl-composer-sugerencia").count(), 0);
    await inputChat.focus();
    await inputChat.press("Tab");
    assert.equal(await inputChat.inputValue(), recomendacion, "Tab inserta la recomendación del placeholder");
    await inputChat.fill("");
    console.log(`${width}px: recomendaciones del compositor comprobadas`);
    if (width === 390) {
      await hiloChat.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
      const irAlUltimo = page.getByRole("button", { name: "Ir al último mensaje", exact: true });
      await irAlUltimo.waitFor();
      await irAlUltimo.click();
      await page.waitForFunction(() => {
        const hilo = document.querySelector(".tl-hilo");
        return hilo && hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight <= 2;
      });
    }
    await inputChat.evaluate(el => el.blur());
    const bordeSinFoco = await page.locator(".tl-composer-caja").evaluate(el => getComputedStyle(el).borderColor);
    await inputChat.focus();
    const estiloFoco = await page.locator(".tl-composer-caja").evaluate(el => ({
      borde: getComputedStyle(el).borderColor,
      sombra: getComputedStyle(el).boxShadow,
    }));
    assert.notEqual(estiloFoco.borde, bordeSinFoco, "el foco debe resaltar sutilmente el compositor");
    assert.equal(estiloFoco.sombra, "none", "el compositor no debe mostrar un halo fuerte al enfocar");
    assert.equal(await inputChat.evaluate(el => getComputedStyle(el).outlineStyle), "none", "el input no debe mostrar un contorno nativo grueso");
    console.log(`${width}px: inicia navegación del hilo`);
    const irAlInicio = page.getByRole("button", { name: "Ir al primer mensaje", exact: true });
    await irAlInicio.waitFor();
    await hiloChat.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
    await page.waitForFunction(() => !document.querySelector('.tl-chat-navegacion button[aria-label="Ir al primer mensaje"]')?.disabled);
    await irAlInicio.click();
    await page.waitForFunction(() => document.querySelector(".tl-hilo")?.scrollTop <= 2);
    const irAlUltimoMensaje = page.getByRole("button", { name: "Ir al último mensaje", exact: true });
    await page.waitForFunction(() => !document.querySelector('.tl-chat-navegacion button[aria-label="Ir al último mensaje"]')?.disabled);
    await irAlUltimoMensaje.click();
    await page.waitForFunction(() => { const hilo = document.querySelector(".tl-hilo"); return hilo && hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight <= 2; });
    console.log(`${width}px: navegación al inicio y al final comprobada`);
    if (width === 390) {
      const ultimo = messages.at(-1);
      assert.ok(ultimo);
      const textoInicial = "CRECIMIENTO PROGRESIVO DEL ÚLTIMO MENSAJE";
      const respuestaInicial = page.waitForResponse(response => response.url().includes("/api/conversations/c1/messages") && response.request().method() === "GET");
      ultimo.content += `\n\n${textoInicial} ${"contenido nuevo. ".repeat(100)}`;
      await respuestaInicial;
      await page.getByText(textoInicial, { exact: false }).waitFor();
      await page.waitForFunction(() => { const hilo = document.querySelector(".tl-hilo"); return hilo && hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight <= 48; });

      const cajaHilo = await hiloChat.boundingBox();
      assert.ok(cajaHilo);
      await page.mouse.move(cajaHilo.x + cajaHilo.width / 2, cajaHilo.y + cajaHilo.height / 2);
      await page.mouse.wheel(0, -260);
      await page.waitForFunction(() => { const hilo = document.querySelector(".tl-hilo"); return hilo && hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight > 48; });
      const scrollManual = await hiloChat.evaluate(el => el.scrollTop);

      const textoPosterior = "ACTUALIZACIÓN TRAS EL SCROLL MANUAL";
      const respuestaPosterior = page.waitForResponse(response => response.url().includes("/api/conversations/c1/messages") && response.request().method() === "GET");
      ultimo.content += `\n\n${textoPosterior} ${"más contenido. ".repeat(80)}`;
      await respuestaPosterior;
      await page.getByText(textoPosterior, { exact: false }).waitFor();
      assert.ok(Math.abs(await hiloChat.evaluate(el => el.scrollTop) - scrollManual) <= 2, "el crecimiento del mensaje no debe devolver al usuario al final si ya se desplazó hacia arriba");

      await hiloChat.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const textoAlReanudar = "ACTUALIZACIÓN MIENTRAS TELO ESTABA MINIMIZADO";
      const respuestaAlReanudar = page.waitForResponse(response => response.url().includes("/api/conversations/c1/messages") && response.request().method() === "GET");
      ultimo.content += `\n\n${textoAlReanudar} ${"actividad nueva en segundo plano. ".repeat(80)}`;
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.visibilityState;
      });
      await respuestaAlReanudar;
      await page.getByText(textoAlReanudar, { exact: false }).waitFor();
      await page.waitForFunction(() => {
        const hilo = document.querySelector(".tl-hilo");
        return hilo && hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight <= 48;
      });
      console.log("390px: seguimiento progresivo, scroll manual y regreso desde segundo plano comprobados");
    }
    const primerPrompt = page.getByRole("button", { name: "Ir al prompt 1: git commit y push", exact: true });
    await primerPrompt.click();
    await page.waitForFunction(() => document.querySelector(".tl-hilo-hito[aria-current='location']")?.getAttribute("aria-label")?.startsWith("Ir al prompt 1:"));
    const mensajeMarcado = page.locator("#mensaje-u2");
    await mensajeMarcado.hover();
    const marcarImportante = mensajeMarcado.getByRole("button", { name: "Marcar mensaje como importante", exact: true });
    await marcarImportante.click();
    assert.equal(await mensajeMarcado.getByRole("button", { name: "Quitar marca de importante", exact: true }).getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("telo:hitos:c1") ?? "[]")), ["u2"]);
    await page.screenshot({ path: `scratch/capturas-ci/chat-timeline-${width}.png` });
    const referenciaArchivo = page.locator(".tl-archivo-chip-abrir").filter({ hasText: "server/src/ejecutar.ts:3-20" });
    assert.equal(await referenciaArchivo.locator(".tl-archivo-chip-tipo").textContent(), "TS");
    await referenciaArchivo.hover();
    const ayudaArchivo = page.getByRole("tooltip");
    await ayudaArchivo.waitFor();
    assert.equal(await ayudaArchivo.isVisible(), true);
    assert.match(await ayudaArchivo.textContent(), /ejecutar\.ts/);
    assert.match(await ayudaArchivo.textContent(), /TypeScript/);
    assert.match(await ayudaArchivo.textContent(), /server\/src/);
    assert.match(await ayudaArchivo.textContent(), /Línea 3/);
    if (width === 390) {
      const objetivoReferencia = await referenciaArchivo.boundingBox();
      assert.ok(objetivoReferencia && objetivoReferencia.width >= 44 && objetivoReferencia.height >= 44);
    }
    await referenciaArchivo.click();
    const vistaArchivo = page.getByRole("complementary", { name: "Vista del archivo server/src/ejecutar.ts" });
    await vistaArchivo.waitFor();
    const cerrarVistaArchivo = vistaArchivo.getByRole("button", { name: "Cerrar vista de archivo", exact: true });
    assert.equal(await cerrarVistaArchivo.evaluate(el => el === document.activeElement), true);
    assert.equal(await vistaArchivo.locator(".tl-chat-archivo-tipo").textContent(), "TS");
    const colaVisible = page.locator(".tl-cola");
    await colaVisible.locator(".tl-cola-texto").first().waitFor();
    const cajaCola = await colaVisible.boundingBox();
    const cajaVisor = await vistaArchivo.boundingBox();
    assert.ok(cajaCola && cajaVisor);
    if (width === 390) assert.ok(cajaCola.y + cajaCola.height <= cajaVisor.y, "la cola debe quedar visible antes del visor móvil");
    else assert.ok(cajaCola.x + cajaCola.width <= cajaVisor.x, "la cola debe quedar en la columna del chat, junto al visor");
    const separadorArchivo = page.getByRole("separator", { name: "Ajustar el espacio entre el chat y el archivo" });
    const tamanoInicial = await vistaArchivo.boundingBox();
    assert.ok(tamanoInicial);
    await separadorArchivo.focus();
    await page.keyboard.press(width === 390 ? "ArrowUp" : "ArrowLeft");
    await page.waitForFunction(({ mobile, anterior }) => {
      const visor = document.querySelector(".tl-chat-archivo-panel");
      if (!visor) return false;
      const actual = visor.getBoundingClientRect();
      return mobile ? actual.height > anterior.height : actual.width > anterior.width;
    }, { mobile: width === 390, anterior: tamanoInicial });
    const antesDeArrastrar = await vistaArchivo.boundingBox();
    assert.ok(antesDeArrastrar);
    const puntoSeparador = await separadorArchivo.boundingBox();
    assert.ok(puntoSeparador);
    const centroX = puntoSeparador.x + puntoSeparador.width / 2;
    const centroY = puntoSeparador.y + puntoSeparador.height / 2;
    await page.mouse.move(centroX, centroY);
    await page.mouse.down();
    await page.mouse.move(centroX + (width === 390 ? 0 : -32), centroY + (width === 390 ? -32 : 0));
    await page.mouse.up();
    await page.waitForFunction(({ mobile, anterior }) => {
      const visor = document.querySelector(".tl-chat-archivo-panel");
      if (!visor) return false;
      const actual = visor.getBoundingClientRect();
      return mobile ? actual.height > anterior.height + 20 : actual.width > anterior.width + 20;
    }, { mobile: width === 390, anterior: antesDeArrastrar });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("telo:cola:c1") ?? "[]").length), 3, "la cola pausada debe conservar los mensajes");
    if (width === 390) {
      const objetivoCerrar = await cerrarVistaArchivo.boundingBox();
      assert.ok(objetivoCerrar && objetivoCerrar.width >= 44 && objetivoCerrar.height >= 44);
    }
    await vistaArchivo.locator('[data-linea="3"].is-activa').waitFor();
    assert.equal((await vistaArchivo.locator(".tl-chat-archivo-titulo p").textContent()).includes("línea 3"), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/archivo-chat-${width}.png` });
    await vistaArchivo.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    await vistaArchivo.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.classList.contains("tl-archivo-chip-abrir"));
    assert.equal(await page.locator(".tl-archivo-chip-abrir").filter({ hasText: "server/src/ejecutar.ts:3-20" }).evaluate(el => el === document.activeElement), true);
    const referenciaChat = page.locator(".tl-archivo-chip-abrir").filter({ hasText: "Chat.tsx" }).first();
    await referenciaChat.click();
    const vistaAmbigua = page.getByRole("complementary", { name: "Vista del archivo Chat.tsx" });
    await vistaAmbigua.getByRole("button", { name: "src/pages/Chat.tsx", exact: true }).waitFor();
    await vistaAmbigua.getByRole("button", { name: "src/pages/Chat.tsx", exact: true }).click();
    const vistaChatResuelta = page.getByRole("complementary", { name: "Vista del archivo src/pages/Chat.tsx" });
    await vistaChatResuelta.locator(".tl-chat-archivo-cuerpo").waitFor();
    await vistaChatResuelta.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    await vistaChatResuelta.waitFor({ state: "detached" });
    const referenciaBorrada = page.locator(".tl-archivo-chip-abrir").filter({ hasText: "Gone.tsx" }).first();
    await referenciaBorrada.click();
    const vistaBorrada = page.getByRole("complementary", { name: "Vista del archivo Gone.tsx" });
    await vistaBorrada.getByText(/movido, cambiado de nombre o eliminado/).waitFor();
    assert.equal(await vistaBorrada.getByRole("button", { name: "Reintentar", exact: true }).count(), 0);
    await vistaBorrada.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    await vistaBorrada.waitFor({ state: "detached" });
    const referenciaPdf = page.locator(".tl-archivo-chip-abrir").filter({ hasText: "informe revisión.pdf" }).first();
    await referenciaPdf.hover();
    const ayudaPdf = referenciaPdf.locator("xpath=..").getByRole("tooltip");
    await ayudaPdf.waitFor();
    assert.match(await ayudaPdf.textContent(), /Documento PDF/);
    await referenciaPdf.click();
    const vistaPdf = page.getByRole("complementary", { name: "Vista del archivo informe revisión.pdf" });
    await vistaPdf.waitFor();
    const paginaPdf = vistaPdf.getByRole("img", { name: "Página 1 de 1 del PDF", exact: true });
    await paginaPdf.waitFor();
    assert.ok(await paginaPdf.evaluate(canvas => canvas.width > 0 && canvas.height > 0 && Number.parseFloat(canvas.style.width) > 300), "PDF.js redimensiona el canvas al área de vista previa");
    assert.equal(await page.locator(".tl-archivo-chip-copiar").count(), 0, "las referencias abren el archivo y no muestran un botón de copiar inútil");
    assert.equal(await vistaPdf.locator(".tl-chat-archivo-tipo").textContent(), "PDF");
    const enlacePdf = vistaPdf.getByRole("link", { name: "Descargar PDF", exact: true });
    assert.match(await enlacePdf.getAttribute("href"), /archivo-pdf.*descargar=1/);
    assert.equal(await enlacePdf.getAttribute("download"), "informe revisión.pdf");
    const [descargaPdf] = await Promise.all([page.waitForEvent("download"), enlacePdf.click()]);
    assert.equal(descargaPdf.suggestedFilename(), "informe revisión.pdf");
    await page.screenshot({ path: `scratch/capturas-ci/archivo-pdf-chat-${width}.png` });
    await vistaPdf.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    await vistaPdf.waitFor({ state: "detached" });
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByText("Chat libre", { exact: true }).click();
    const referenciaChatLibre = page.locator(".tl-archivo-chip-abrir").filter({ hasText: "libre.md" }).first();
    await referenciaChatLibre.click();
    const vistaChatLibre = page.getByRole("complementary", { name: "Vista del archivo libre.md" });
    await vistaChatLibre.getByText("Vista previa disponible", { exact: true }).waitFor();
    await vistaChatLibre.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByText("Prueba de flujo", { exact: true }).click();
    await page.getByRole("button", { name: "Contexto del chat", exact: true }).click();
    const contextoChat = page.getByRole("dialog", { name: "Contexto del chat" });
    await contextoChat.getByText("250 tokens de entrada (medida)", { exact: true }).waitFor();
    assert.equal(await contextoChat.locator(".tl-chat-contexto-porcentaje").textContent(), "25%");
    assert.equal(await contextoChat.getByText("Tokens de entrada", { exact: true }).count(), 1);
    assert.equal(await contextoChat.getByText("Sesión persistente", { exact: true }).count(), 1);
    await page.screenshot({ path: `scratch/capturas-ci/contexto-chat-${width}.png` });
    const [descargaContexto] = await Promise.all([page.waitForEvent("download"), contextoChat.getByRole("button", { name: "Exportar sesión" }).click()]);
    assert.equal(descargaContexto.suggestedFilename(), "Prueba-de-flujo-contexto.json");
    await page.keyboard.press("Escape");
    await contextoChat.waitFor({ state: "detached" });
    await colaVisible.getByRole("button", { name: "Arrastrar mensaje 2 para reordenar", exact: true }).dragTo(colaVisible.locator(".tl-cola-item").nth(0));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("telo:cola:c1") ?? "[]").map(({ id }) => id)), ["q2", "q1", "q3"]);
    await colaVisible.getByRole("button", { name: "Más opciones para mensaje 2", exact: true }).click();
    const bajarEnCola = page.getByRole("menuitem", { name: "Bajar en la cola", exact: true });
    await bajarEnCola.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("telo:cola:c1") ?? "[]").map(({ id }) => id)), ["q2", "q3", "q1"]);
    await colaVisible.getByRole("button", { name: "Más opciones para mensaje 1", exact: true }).click();
    await page.getByRole("menuitem", { name: "Bajar en la cola", exact: true }).waitFor();
    await inputChat.click();
    await page.getByRole("menuitem", { name: "Bajar en la cola", exact: true }).waitFor({ state: "detached" });
    await colaVisible.getByRole("button", { name: "Más opciones para mensaje 1", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Bajar en la cola", exact: true }).waitFor({ state: "detached" });
    await colaVisible.getByRole("button", { name: "Más opciones para mensaje 1", exact: true }).click();
    await page.getByRole("menuitem", { name: "Editar mensaje", exact: true }).click();
    await colaVisible.getByRole("textbox", { name: "Editar mensaje en cola", exact: true }).fill("Segundo mensaje corregido");
    await colaVisible.getByRole("button", { name: "Guardar", exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("telo:cola:c1") ?? "[]")[0].texto), "Segundo mensaje corregido");
    await colaVisible.getByRole("button", { name: "Redirigir mensaje 1 al compositor", exact: true }).click();
    assert.equal(await inputChat.inputValue(), "Segundo mensaje corregido");
    await inputChat.fill("");
    await colaVisible.getByRole("button", { name: "Quitar mensaje 1 de la cola", exact: true }).click();
    await colaVisible.getByRole("button", { name: "Quitar mensaje 1 de la cola", exact: true }).click();
    await colaVisible.waitFor({ state: "detached" });
    const arbolArchivos = page.locator(".tl-codigo").filter({ hasText: "└── src/" });
    assert.equal(await arbolArchivos.getByRole("button", { name: "Aplicar", exact: true }).count(), 0);
    assert.deepEqual(await page.locator(".tl-rail-seccion-titulo").allTextContents(), ["Proyectos", "Conversaciones"]);
    if (width === 1440) {
      const carpetaPruebas = page.locator(".tl-proyecto-carpeta");
      assert.equal(await page.locator(".tl-proyecto-hijos .sidebar-conv-meta .tl-indicador-spinner").count(), 1);
      assert.equal(await page.locator(".tl-proyecto-meta .tl-indicador-spinner").count(), 0, "la actividad vive en el chat cuando la carpeta está abierta");
      await carpetaPruebas.click();
      assert.equal(await page.locator(".tl-proyecto-meta .tl-indicador-spinner").count(), 1, "la carpeta cerrada conserva un indicador agregado");
      await carpetaPruebas.click();
      const chatEnProceso = page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]');
      assert.equal(await chatEnProceso.locator(".sidebar-conv-chat-icon").count(), 1, "cada chat de proyecto muestra su icono");
      await chatEnProceso.hover();
      await chatEnProceso.locator("..").getByRole("button", { name: "Más opciones para Prueba de flujo", exact: true }).click();
      const menuChat = page.getByRole("group", { name: "Acciones de Prueba de flujo" });
      await menuChat.getByRole("button", { name: "Renombrar", exact: true }).waitFor();
      await menuChat.getByRole("button", { name: "Anclar arriba", exact: true }).waitFor();
      await menuChat.getByRole("button", { name: "Eliminar", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await chatEnProceso.hover();
      await chatEnProceso.locator("..").getByRole("button", { name: "Más opciones para Prueba de flujo", exact: true }).click();
      await chatEnProceso.click();
      assert.equal(await menuChat.count(), 0, "el menú se cierra al abrir el chat");
      const chatPendiente = page.locator('.sidebar-conv[aria-label^="Chat de esta semana"]');
      assert.equal(await chatPendiente.locator(".tl-indicador-dot.is-pendiente").count(), 1);
      await chatPendiente.click();
      await page.waitForFunction(() => localStorage.getItem("telo_aprobacion_vista:c3") === "review-c3:hash-c3");
      await chatPendiente.locator(".tl-indicador-dot.is-pendiente").waitFor({ state: "detached" });
      assert.equal(await chatPendiente.locator(".tl-indicador-dot.is-pendiente").count(), 0, "el aviso visual desaparece tras revisar ese chat");
      await page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]').click();
    }
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    const versionButton = page.getByRole("button", { name: /Ver historial de cambios de la versión/ });
    await versionButton.click();
    const historialCambios = page.getByRole("dialog", { name: "Historial de cambios" });
    await historialCambios.waitFor();
    assert.ok(await historialCambios.locator(".tl-cambio").count() > 0);
    assert.equal(await historialCambios.getAttribute("aria-modal"), "true");
    const tabVersiones = historialCambios.getByRole("tab", { name: "Versiones destacadas", exact: true });
    const tabRegistro = historialCambios.getByRole("tab", { name: /Registro detallado/ });
    const tabPrs = historialCambios.getByRole("tab", { name: /PRs/ });
    assert.equal(await tabVersiones.getAttribute("aria-selected"), "true");
    assert.equal(await historialCambios.locator(".tl-cambios-prs").count(), 0, "los PR tienen pestaña propia");
    await tabPrs.click();
    await historialCambios.locator("#panel-pull-requests .tl-cambios-prs").waitFor();
    assert.equal(await tabPrs.getAttribute("aria-selected"), "true");
    await page.screenshot({ path: `scratch/capturas-ci/cambios-pr-${width}.png` });
    await tabRegistro.click();
    await historialCambios.locator("#panel-registro-detallado .tl-cambios-detallados-wrap").waitFor();
    await page.screenshot({ path: `scratch/capturas-ci/cambios-${width}.png` });
    await page.keyboard.press("Escape");
    await historialCambios.waitFor({ state: "detached" });
    assert.equal(await versionButton.evaluate(el => el === document.activeElement), true);
    if (width === 390) await page.getByRole("button", { name: "Cerrar barra lateral", exact: true }).click();
    const contrasteGrupo = await page.locator(".tl-rail-seccion-titulo").first().evaluate(el => getComputedStyle(el).color);
    const contrasteChat = await page.locator(".sidebar-conv-title").first().evaluate(el => getComputedStyle(el).color);
    assert.notEqual(contrasteGrupo, contrasteChat);
    await page.getByText("Faltan dependencias", { exact: true }).waitFor();
    assert.equal(await page.getByRole("region", { name: "Acción actual del repositorio" }).count(), 1);
    assert.equal(await page.locator(".tl-git-intentos").count(), 0, "el historial Git antiguo no ocupa el hilo del chat");
    assert.equal(await page.getByRole("region", { name: "Resolución del PR #9" }).count(), 0, "un conflicto de un turno anterior no reaparece como acción actual");
    await page.locator(".tl-resumen-cambios").waitFor();
    const accionTrasSuRespuesta = await page.locator(".tl-hilo-columna").evaluate(root => {
      const respuesta = [...root.querySelectorAll(".tl-msg-agente")].find(mensaje => mensaje.textContent?.includes("El segundo intento está listo para revisar."));
      const accion = root.querySelector('section.tl-accion-git-actual');
      return Boolean(respuesta && accion && (respuesta.compareDocumentPosition(accion) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(accionTrasSuRespuesta, true, "la tarjeta Git aparece después de la respuesta que la originó");
    assert.equal(await page.locator(".tl-detalles-reporte pre").isVisible(), false);
    assert.equal((await page.locator("body").textContent()).includes("MEMORIA_INTERNA"), false);
    await page.getByRole("button", { name: "Subir a telo/prueba y abrir PR", exact: true }).click();
    await page.getByText("Completada", { exact: true }).waitFor();
    assert.equal(await page.locator('section.tl-accion-git-actual').count(), 1, "la decisión actualiza la misma tarjeta dentro de su turno");
    assert.equal(approvals, 1);
    assert.equal(await page.locator('section.tl-accion-git-actual [role="alert"]').count(), 0);
    task.status = "failed";
    task.reanudable = true;
    const continuarTarea = page.getByRole("button", { name: "Continuar donde quedó", exact: true });
    await continuarTarea.waitFor();
    assert.equal(await page.getByRole("button", { name: "Commit y subir (elige destino)", exact: true }).count(), 0, "no se permite publicar el diff de una tarea fallida");
    const reanudacion = page.waitForRequest(request => request.url().endsWith("/api/tasks/t1/reanudar") && request.method() === "POST");
    await continuarTarea.click();
    await reanudacion;
    assert.equal(reanudaciones, 1, "el botón retoma la misma tarea guardada");
    task.status = "done";
    task.reanudable = false;
    await page.getByRole("button", { name: "Commit y subir (elige destino)", exact: true }).waitFor();
    actions.push({
      id: "git-pr-fallido",
      action: "pr",
      task_id: "t1",
      message_id: "u2",
      state: "failed",
      result: JSON.stringify({ codigo: "git_action", mensaje: "Validation Failed: A pull request already exists for PABLOCESAR2412:telo/prueba" }),
      payload: JSON.stringify({
        remote: "https://github.com/ejemplo/pruebas",
        rama: "telo/prueba",
        base: "main",
        title: "Cambios revisados en Telo",
        pr_url: "https://github.com/ejemplo/pruebas/pull/",
        pr_number: null,
        messageId: "u2",
        autenticacion: { tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "PABLOCESAR2412", instalacion_id: 1 },
      }),
    });
    await page.waitForFunction(() => document.querySelector(".tl-accion-git-actual .approval-panel h2")?.textContent === "Commit y push");
    assert.equal(await page.locator(".tl-accion-git-actual .approval-panel").count(), 1, "un PR fallido de un turno anterior no sustituye la acción vigente");
    assert.equal(await page.locator(".tl-git-intentos").count(), 0, "los resultados Git antiguos no se repiten bajo los mensajes");
    await page.screenshot({ path: `scratch/capturas-ci/git-pr-fallido-${width}.png` });
    actions.pop();
    await page.waitForFunction(() => document.querySelector(".tl-accion-git-actual .approval-panel h2")?.textContent === "Commit y push");
    await hiloChat.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Envío del chat A");
    const requestChatA = page.waitForRequest(request => request.url().endsWith("/api/conversations/c1/messages") && request.method() === "POST" && request.postDataJSON().content === "Envío del chat A");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await Promise.all([requestChatA, envioAIniciado]);
    await page.waitForFunction(() => {
      const hilo = document.querySelector(".tl-hilo");
      return hilo && hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight <= 2;
    });
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Chat paralelo", exact: true }).click();
    await page.getByRole("heading", { name: "Chat paralelo", exact: true }).waitFor();
    assert.equal(await page.locator(".tl-pensando").count(), 0);
    assert.equal((await page.locator(".tl-hilo-columna").textContent()).includes("Envío del chat A"), false);
    liberarEnvioA();
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]').click();
    await page.getByText("Respuesta del chat A", { exact: true }).waitFor();
    assert.equal(await page.locator('section.tl-accion-git-actual').count(), 0, "la acción aprobada deja de ocupar el chat al empezar un turno nuevo");
    assert.equal(await page.locator(".tl-git-intentos").count(), 0, "el historial Git permanece fuera del hilo");
    // La subida pertenece a A aunque B esté abierto cuando termine.
    let liberarAdjunto;
    esperarAdjunto = new Promise(resolve => { liberarAdjunto = resolve; });
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Adjunto del chat A");
    await page.locator('input[type="file"]').setInputFiles({ name: "muestra.png", mimeType: "image/png", buffer: pngPrueba });
    await page.locator('.tl-adjuntos-pendientes').waitFor();
    const subidaA = page.waitForRequest(request => request.url().endsWith("/api/conversations/c1/adjuntos"));
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await subidaA;
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Chat paralelo", exact: true }).click();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Borrador nuevo de B");
    const envioAdjunto = page.waitForResponse(response => response.url().endsWith("/api/conversations/c1/messages") && response.request().method() === "POST");
    liberarAdjunto(); esperarAdjunto = null;
    await envioAdjunto;
    assert.equal(await page.getByRole("textbox", { name: "Mensaje", exact: true }).inputValue(), "Borrador nuevo de B");
    assert.equal(await page.locator('.tl-adjuntos-pendientes').count(), 0);
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]').click();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Base A");
    await page.getByRole("button", { name: "Dictar mensaje", exact: true }).click();
    await page.evaluate(() => window.__reconocimientoPrueba.onresult({ resultIndex: 0, results: [{ 0: { transcript: "dictado A" }, isFinal: true, length: 1 }] }));
    await page.waitForFunction(() => localStorage.getItem("telo:borrador:c1") === "Base A dictado A"
      && document.querySelector('textarea[aria-label="Mensaje"]')?.value === "Base A dictado A");
    assert.equal(await page.getByRole("textbox", { name: "Mensaje", exact: true }).inputValue(), "Base A dictado A");
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Chat paralelo", exact: true }).click();
    await page.waitForFunction(() => window.__reconocimientoPrueba.onresult === null);
    assert.equal(await page.evaluate(() => window.__reconocimientoPrueba.onresult), null);
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Base B");
    await page.getByRole("button", { name: "Dictar mensaje", exact: true }).click();
    await page.evaluate(() => window.__reconocimientoPrueba.onresult({ resultIndex: 0, results: [{ 0: { transcript: "dictado B" }, isFinal: true, length: 1 }] }));
    await page.waitForFunction(() => localStorage.getItem("telo:borrador:c2") === "Base B dictado B"
      && document.querySelector('textarea[aria-label="Mensaje"]')?.value === "Base B dictado B");
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) window.__reconocimientoPrueba.onresult({ resultIndex: 0, results: [{ 0: { transcript: "dictado B" }, isFinal: true, length: 1 }] });
    });
    assert.equal(await page.getByRole("textbox", { name: "Mensaje", exact: true }).inputValue(), "Base B dictado B", "reenviar finales móviles no duplica la transcripción");
    assert.equal(await page.evaluate(() => localStorage.getItem("telo:borrador:c2")), "Base B dictado B");
    assert.equal(await page.evaluate(() => localStorage.getItem("telo:borrador:c1")), "Base A dictado A");
    mostrarHistorialExtenso = true;
    await page.getByRole("button", { name: "Terminar dictado", exact: true }).click();
    await page.getByRole("button", { name: "Historial extenso", exact: true }).waitFor({ state: "attached" });
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Historial extenso", exact: true }).click();
    await page.getByText("Historial numerado 165", { exact: true }).waitFor();
    assert.equal(await page.locator('.tl-hilo-evento').count(), 40, "solo se representa una página del historial extenso");
    await page.getByRole("button", { name: "Ver mensajes anteriores", exact: true }).click();
    await page.getByText("Historial numerado 125", { exact: true }).waitFor();
    assert.equal(await page.getByText("Historial numerado 165", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Volver a recientes", exact: true }).click();
    await page.getByText("Historial numerado 165", { exact: true }).waitFor();
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]').click();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Prueba de mensaje");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    // El fixture acumula en el historial dos respuestas idénticas («Mensaje recibido»). La espera
    // solo necesita ver que existe la primera; sin first(), el modo estricto revienta al segundo.
    await page.getByText("Mensaje recibido", { exact: true }).first().waitFor();
    assert.equal(await page.locator('section.tl-accion-git-actual').count(), 0, "las acciones de turnos previos quedan en el historial plegado");
    if (videoPathPrueba) {
      await page.locator('input[type="file"]').setInputFiles(videoPathPrueba);
      await page.getByText("4 fotogramas · sin audio", { exact: false }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled(), false, "un video válido debe habilitar el envío aunque el borrador esté vacío");
      const subidaVideo = page.waitForRequest(request =>
        request.url().endsWith("/api/conversations/c1/adjuntos") && request.method() === "POST",
      );
      const solicitudVideo = page.waitForRequest(request =>
        request.url().endsWith("/api/conversations/c1/messages") &&
        request.method() === "POST" &&
        request.postDataJSON().content.includes(nombreHojaPrueba),
      );
      await page.getByRole("button", { name: "Enviar", exact: true }).click();
      try {
        await subidaVideo;
      } catch {
        const errorVideo = await page.locator(".tl-composer .tl-alerta").textContent().catch(() => "sin mensaje de error visible");
        throw new Error(`el video no llegó al endpoint de adjuntos: ${errorVideo}`);
      }
      await solicitudVideo;
      assert.equal(adjuntosChatSubidos, 2, "la hoja de fotogramas se sube antes de enviar el mensaje");
      const hojaEnviada = page.locator(".tl-msg-usuario img[alt]").last();
      await hojaEnviada.waitFor({ state: "attached" });
      assert.equal(await hojaEnviada.getAttribute("alt"), nombreHojaPrueba);
    } else {
      console.log("SKIP video: define TELO_UI_VIDEO_FIXTURE con un MP4 o WebM local para probar la decodificación real.");
    }
    assert.equal(await page.getByRole("button", { name: "Herramientas y comandos", exact: true }).count(), 1, "herramientas y comandos están en la barra superior");
    assert.equal(await page.getByRole("button", { name: "Capacidades multimedia", exact: true }).count(), 0, "el compositor ya no muestra el panel antiguo de capacidades");
    await page.getByRole("button", { name: "Configurar supervisor y modelos auxiliares", exact: true }).click();
    const dialogoOrquestacion = page.getByRole("dialog", { name: "Supervisor del chat" });
    await dialogoOrquestacion.waitFor();
    await dialogoOrquestacion.getByLabel("Preparar auxiliares para peticiones explícitas").check();
    assert.equal(await dialogoOrquestacion.getByRole("radio").count(), 0);
    assert.equal(await dialogoOrquestacion.locator(".tl-orquestacion-auxiliar").count(), 3, "el supervisor propone una lista dinámica de hasta tres modelos candidatos");
    await dialogoOrquestacion.getByLabel("Función auxiliar 2").selectOption("arquitectura");
    await dialogoOrquestacion.getByRole("button", { name: "Quitar auxiliar 3", exact: true }).click();
    assert.equal(await dialogoOrquestacion.getByLabel("Modelo auxiliar 3").count(), 0, "se puede reducir la lista de modelos auxiliares");
    await dialogoOrquestacion.getByRole("button", { name: "Añadir modelo", exact: true }).click();
    const guardarOrquestacion = page.waitForRequest(request => request.url().endsWith("/api/conversations/c1") && request.method() === "PATCH");
    await dialogoOrquestacion.getByRole("button", { name: "Guardar configuración", exact: true }).click();
    const peticionOrquestacion = await guardarOrquestacion;
    const configuracionGuardada = peticionOrquestacion.postDataJSON();
    assert.equal(configuracionGuardada.orquestacion_habilitada, true);
    assert.equal(configuracionGuardada.orquestacion_seleccion_automatica, false);
    assert.equal(configuracionGuardada.orquestacion_trabajadores.length, 3, "se guarda la cantidad dinámica de modelos candidatos");
    assert.equal(configuracionGuardada.orquestacion_trabajadores[0].model === configuracionGuardada.model, false, "el modelo supervisor no se duplica como auxiliar");
    assert.equal(configuracionGuardada.orquestacion_trabajadores[0].rol, configuracionGuardada.orquestacion_trabajadores[1].rol, "se permiten varios candidatos con la misma función");
    assert.equal(configuracionesOrquestacion.length > 0, true);

    const mensaje = page.getByRole("textbox", { name: "Mensaje", exact: true });
    await mensaje.fill("Haz un video de una ciudad al atardecer");
    await page.locator(".tl-aviso-generacion-media").filter({ hasText: "Telo no tiene conectado un generador externo de video" }).waitFor();
    assert.equal(await page.locator(".tl-aviso-generacion-media").filter({ hasText: "herramientas locales disponibles" }).count(), 1, "el aviso aclara que el agente puede usar herramientas locales");
    await mensaje.fill("¿Podrías explicarme cómo hacer un video?");
    assert.equal(await page.locator(".tl-aviso-generacion-media").count(), 0, "una pregunta informativa sobre video no activa el aviso de generación");
    await mensaje.fill("Haz una imagen de un colibrí");
    await page.locator(".tl-aviso-generacion-media").filter({ hasText: "Telo no tiene conectado un generador externo de imagen" }).waitFor();
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page.locator(".tl-aviso-generacion-media").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Uso", exact: true }).click();
    const panelUso = page.getByRole("dialog", { name: "Uso del proveedor" });
    await panelUso.waitFor();
    await panelUso.getByText("Últimos 7 días", { exact: true }).waitFor();
    const textoUso = await panelUso.textContent();
    assert.equal(await panelUso.locator('[role="meter"]').count(), 0, "no se presentan porcentajes/cuotas ficticios");
    assert.equal(textoUso.includes("Últimos 7 días"), true);
    assert.equal(textoUso.includes("Últimas 5 horas"), true);
    assert.equal(textoUso.includes("Mes actual (UTC)"), true);
    assert.equal(textoUso.includes("Estimación de coste"), true);
    assert.equal(textoUso.includes("saldo ni los límites efectivos"), true);
    assert.equal(/\b(?:restantes|RPD|RPM|cuota restante)\b/i.test(textoUso), false);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/chat-uso-${width}.png` });
    task.status = "running";
    task.started_at = new Date(Date.now() - 12_000).toISOString();
    const pensando = page.locator(".tl-pensando");
    await pensando.waitFor();
    const modeloEnCurso = page.locator(".tl-msg-procesando .tl-msg-modelo").last();
    const duracionEnCurso = page.locator(".tl-msg-procesando .tl-msg-duracion").last();
    await duracionEnCurso.waitFor();
    if (width === 390) {
      const [modeloCaja, duracionCaja] = await Promise.all([modeloEnCurso.boundingBox(), duracionEnCurso.boundingBox()]);
      assert.ok(modeloCaja && duracionCaja && duracionCaja.y >= modeloCaja.y + modeloCaja.height, "en móvil, el tiempo de proceso va debajo del modelo");
      assert.match(await duracionEnCurso.textContent(), /^Procesando desde hace .+$/);
    }
    await page.screenshot({ path: `scratch/capturas-ci/chat-procesando-${width}.png` });
    task.status = "waiting_approval";
    task.plan_hash = "hash-de-prueba";
    task.plan = {
      objetivo: "Revisar la respuesta del agente en el compositor móvil.", supuestos: [],
      pasos: [{ id: 1, descripcion: "Responder desde el compositor.", archivos: [] }],
      criterios_de_aceptacion: ["El compositor conserva su distribución."], requiere_aprobacion: [], riesgos: [], preguntas: ["¿Qué respuesta quieres dar?"]
    };
    const respuestaPlan = page.getByRole("textbox", { name: "Aclaraciones o cambios al plan", exact: true });
    await respuestaPlan.waitFor();
    await respuestaPlan.fill("1. Respuesta de prueba");
    const decisionesPlan = page.locator(".tl-composer-decisiones");
    const cajaComposer = page.locator(".tl-composer-caja");
    await decisionesPlan.waitFor();
    assert.equal(await decisionesPlan.evaluate(el => getComputedStyle(el).display), width === 390 ? "grid" : "flex");
    const [decisionesCaja, composerCaja, inputCaja] = await Promise.all([
      decisionesPlan.boundingBox(), cajaComposer.boundingBox(), respuestaPlan.boundingBox(),
    ]);
    assert.ok(decisionesCaja && composerCaja && inputCaja);
    assert.ok(inputCaja.height <= 180, "responder al plan no debe estirar el textarea fuera de su límite");
    assert.ok(decisionesCaja.x >= composerCaja.x && decisionesCaja.x + decisionesCaja.width <= composerCaja.x + composerCaja.width + 1, "los botones de plan deben quedar dentro del compositor");
    assert.ok(await page.locator(".tl-composer-barra").evaluate(el => el.scrollWidth <= el.clientWidth + 1), "la barra del compositor no debe desbordarse");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/chat-respuesta-plan-${width}.png` });
    let liberarPlan;
    esperarPlan = new Promise(resolve => { liberarPlan = resolve; });
    const solicitudPlan = page.waitForRequest(request => request.url().endsWith("/api/tasks/t1/plan") && request.method() === "POST");
    await page.getByRole("button", { name: "Re-analizar plan", exact: true }).click();
    await solicitudPlan;
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Chat paralelo", exact: true }).click();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Borrador B mientras se aprueba A");
    const respuestaAprobada = page.waitForResponse(response => response.url().endsWith("/api/tasks/t1/plan"));
    liberarPlan(); esperarPlan = null;
    await respuestaAprobada;
    assert.equal(await page.getByRole("textbox", { name: "Mensaje", exact: true }).inputValue(), "Borrador B mientras se aprueba A");
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]').click();
    task.plan = null;
    task.plan_hash = null;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/uso-${width}.png` });
    await page.keyboard.press("Escape");
    await page.getByText("La petición de imagen se envió al agente con el modelo seleccionado y las herramientas locales disponibles.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("region", { name: "Generar imagen" }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/medio-enrutado-${width}.png` });
    task.status = "sin_cuota";
    task.modelo_agotado = "google/prueba";
    await page.locator(".cuota-aviso").waitFor();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("No se debe aceptar mientras falte cuota");
    assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled(), true);
    assert.equal((await page.locator(".cuota-aviso").textContent()).includes("Se acabó la cuota de Google Test"), true);
    assert.equal((await page.locator(".cuota-aviso").textContent()).includes("ChatGPT Plus se administra por separado"), true);
    await page.screenshot({ path: `scratch/capturas-ci/cuota-chat-${width}.png` });
    await page.getByRole("button", { name: "Cambiar modelo", exact: true }).click();
    await page.locator(".picker").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("");
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.locator('.sidebar-conv').filter({ hasText: "Chat paralelo" }).click();
    const pdfLibre = page.locator(".tl-msg-agente").filter({ hasText: "PDF libre generado" }).locator(".tl-archivo-chip-abrir").filter({ hasText: "libre.pdf" });
    await pdfLibre.waitFor();
    await pdfLibre.click();
    const visorPdfLibre = page.getByRole("complementary", { name: "Vista del archivo libre.pdf" });
    await visorPdfLibre.getByRole("img", { name: "Página 1 de 1 del PDF", exact: true }).waitFor();
    const descargarPdfLibre = visorPdfLibre.getByRole("link", { name: "Descargar PDF", exact: true });
    assert.match(await descargarPdfLibre.getAttribute("href"), /\/conversations\/c2\/archivo-pdf/);
    const [archivoPdfLibre] = await Promise.all([page.waitForEvent("download"), descargarPdfLibre.click()]);
    assert.equal(archivoPdfLibre.suggestedFilename(), "libre.pdf");
    await visorPdfLibre.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    const imagenLibre = page.locator(".tl-msg-agente").filter({ hasText: "Imagen lista" }).locator(".tl-archivo-chip-abrir").filter({ hasText: "infografía final.png" });
    await imagenLibre.waitFor();
    assert.match(await imagenLibre.getAttribute("aria-label"), /^Abrir infografía final\.png, Imagen PNG/);
    assert.equal(await imagenLibre.locator("xpath=..").locator(".tl-archivo-chip-copiar").count(), 0);
    await imagenLibre.click();
    const visorImagenLibre = page.getByRole("complementary", { name: "Vista del archivo infografía final.png" });
    const previewImagen = visorImagenLibre.getByRole("img", { name: "infografía final.png" });
    await previewImagen.waitFor();
    await page.waitForFunction(() => {
      const imagen = document.querySelector(".tl-chat-archivo-imagen");
      return Boolean(imagen?.complete && imagen.naturalWidth > 0);
    });
    const descargarImagenLibre = visorImagenLibre.getByRole("link", { name: "Descargar imagen", exact: true });
    assert.match(await descargarImagenLibre.getAttribute("href"), /\/conversations\/c2\/archivo-imagen/);
    const [archivoImagenLibre] = await Promise.all([page.waitForEvent("download"), descargarImagenLibre.click()]);
    assert.equal(archivoImagenLibre.suggestedFilename(), "infografía final.png");
    await visorImagenLibre.getByRole("button", { name: "Cerrar vista de archivo", exact: true }).click();
    console.log(`${width}px: mensajes y aprobación comprobados`);
    assert.equal(await page.getByText("Historial de Git", { exact: true }).count(), 0);
    await page.screenshot({ path: `scratch/capturas-ci/chat-${width}.png` });
    if (width === 1440) {
      const chatFila = page.locator('.sidebar-conv[aria-label^="Prueba de flujo"]').locator("..");
      await chatFila.hover();
      await chatFila.getByRole("button", { name: "Más opciones para Prueba de flujo", exact: true }).click();
      await page.getByRole("group", { name: "Acciones de Prueba de flujo" }).getByRole("button", { name: "Eliminar", exact: true }).click();
      const confirmarEliminar = page.locator(".conv-confirm");
      await confirmarEliminar.waitFor();
      assert.equal(await confirmarEliminar.getByText("Se eliminarán «Prueba de flujo», sus subchats y todos sus mensajes. No se puede deshacer.", { exact: true }).isVisible(), true);
      assert.equal(await confirmarEliminar.getByRole("button", { name: "Cancelar", exact: true }).evaluate(el => el === document.activeElement), true);
      await page.screenshot({ path: "scratch/capturas-ci/chat-delete-1440.png" });
      await page.keyboard.press("Escape");
      await confirmarEliminar.waitFor({ state: "detached" });
    }
    await page.goto(`${base}/ajustes`);
    await page.getByRole("heading", { name: "Ajustes y Servidor", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Cuenta de Google", exact: true }).count(), 0);
    const proveedoresInferencia = page.getByRole("tablist", { name: "Proveedores de inferencia" });
    await proveedoresInferencia.getByRole("tab", { name: "Google Gemini" }).waitFor();
    assert.equal(await proveedoresInferencia.getByRole("tab").count(), 5);
    const panelGemini = page.getByRole("tabpanel", { name: "Google Gemini" });
    await panelGemini.getByRole("button", { name: "Mostrar ajustes", exact: true }).click();
    await panelGemini.getByRole("button", { name: "Editar", exact: true }).click();
    assert.equal(await panelGemini.locator("input[type=password]").count(), 1, "la clave solo aparece al editarla");
    await panelGemini.getByRole("button", { name: "Cancelar", exact: true }).click();
    await panelGemini.locator(".aj-probar-proveedor").getByRole("button", { name: "Probar conexión", exact: true }).click();
    await panelGemini.getByText("Catálogo consultado. No se generó texto ni se consumieron tokens.", { exact: true }).waitFor();
    await proveedoresInferencia.getByRole("tab", { name: "OpenRouter" }).click();
    await page.getByRole("tabpanel", { name: "OpenRouter" }).waitFor();
    await page.screenshot({ path: `scratch/capturas-ci/proveedores-${width}.png` });
    await page.goto(`${base}/ajustes?pestana=personalizacion`);
    const tarjetaApariencia = page.locator('article[aria-labelledby="ajustes-apariencia"]');
    await tarjetaApariencia.waitFor();
    assert.equal(await tarjetaApariencia.getByRole("radio").count(), 20);
    const fuenteInterfaz = tarjetaApariencia.getByLabel("Tipografía");
    await fuenteInterfaz.selectOption("instrument");
    assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font")), /Instrument Sans/);
    await tarjetaApariencia.getByRole("radio", { name: "GitHub Dark", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), "github-dark");
    const escalaTexto = tarjetaApariencia.getByLabel("Tamaño del texto");
    await escalaTexto.focus();
    await escalaTexto.press("ArrowRight");
    await escalaTexto.press("ArrowRight");
    await escalaTexto.press("ArrowRight");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#root")).zoom), "1.15");
    await page.screenshot({ path: `scratch/capturas-ci/personalizacion-${width}.png` });
    await page.reload();
    await page.getByRole("heading", { name: "Ajustes y Servidor", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), "github-dark");
    assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font")), /Instrument Sans/);
    assert.equal(await page.locator("#root").evaluate((root) => getComputedStyle(root).zoom), "1.15");
    const aparienciaRecargada = page.locator('article[aria-labelledby="ajustes-apariencia"]');
    await aparienciaRecargada.getByRole("radio", { name: "Telo Obsidiana", exact: true }).click();
    await aparienciaRecargada.getByLabel("Tipografía").selectOption("geist");
    const escalaRestablecer = aparienciaRecargada.getByLabel("Tamaño del texto");
    await escalaRestablecer.focus();
    await escalaRestablecer.press("ArrowLeft");
    await escalaRestablecer.press("ArrowLeft");
    await escalaRestablecer.press("ArrowLeft");
    await page.goto(`${base}/ajustes`);
    const tarjetaNotificaciones = page.locator('article[aria-labelledby="ajustes-notificaciones"]');
    await tarjetaNotificaciones.scrollIntoViewIfNeeded();
    const interruptorNotificaciones = tarjetaNotificaciones.getByRole("switch", { name: "Notificaciones del sistema" });
    await interruptorNotificaciones.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Notificaciones del sistema"]')?.getAttribute("aria-checked") === "true");
    const selectorSonido = tarjetaNotificaciones.getByLabel("Sonido de notificación");
    assert.equal(await selectorSonido.locator("option").count(), 5);
    await selectorSonido.selectOption("ascendente");
    assert.equal(await page.evaluate(() => localStorage.getItem("telo:sonido-notificacion-tipo")), "ascendente");
    await tarjetaNotificaciones.getByRole("button", { name: "Probar sonido", exact: true }).click();
    await tarjetaNotificaciones.getByRole("status").filter({ hasText: "Sonido activado." }).waitFor();
    await interruptorNotificaciones.click();
    const tarjetaGithub = page.locator('.aj-tarjeta[aria-labelledby="ajustes-github"]');
    await tarjetaGithub.scrollIntoViewIfNeeded();
    await tarjetaGithub.getByText("Conectada", { exact: true }).waitFor();
    assert.equal(await tarjetaGithub.locator(".aj-github-usada").textContent(), "Usada por Telo");
    assert.equal(await tarjetaGithub.getByText("Todos los repositorios", { exact: true }).count(), 1);
    assert.equal(await tarjetaGithub.getByRole("link", { name: "GitHub", exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/github-ajustes-${width}.png` });
    const tarjetaJev = page.locator('article[aria-labelledby="aj-jev-titulo"]');
    await tarjetaJev.scrollIntoViewIfNeeded();
    await tarjetaJev.getByText("TypeSafe Jev", { exact: true }).waitFor();
    const campoJev = tarjetaJev.getByLabel("Clave API");
    assert.equal(await campoJev.getAttribute("type"), "password");
    await tarjetaJev.getByRole("button", { name: "Mostrar clave escrita", exact: true }).click();
    assert.equal(await campoJev.getAttribute("type"), "text");
    await tarjetaJev.getByRole("button", { name: "Ocultar clave escrita", exact: true }).click();
    assert.equal(await campoJev.getAttribute("type"), "password");
    await campoJev.fill("apikey_prueba_de_interfaz_123456789012");
    await tarjetaJev.getByRole("button", { name: "Guardar clave", exact: true }).click();
    await tarjetaJev.getByText("Clave guardada cifrada en el servidor. Jev se activará en las próximas evaluaciones.", { exact: true }).waitFor();
    assert.equal(await campoJev.count(), 0, "la configuración se pliega después de guardar la clave");
    await tarjetaJev.getByRole("button", { name: "Editar configuración", exact: true }).click();
    assert.equal(await campoJev.inputValue(), "");
    assert.equal(await campoJev.getAttribute("type"), "password");
    assert.equal((await tarjetaJev.textContent()).includes("apikey_prueba_de_interfaz_123456789012"), false);
    assert.equal((await tarjetaJev.textContent()).includes("Telo decide qué guardar"), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/jev-ajustes-${width}.png` });
    await page.getByRole("button", { name: "Copiar código", exact: true }).click();
    await page.getByText("Código copiado.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "ABCD-EFGH");
    assert.equal(await page.locator(".login-codex-enlace").getAttribute("href"), "https://auth.openai.com/codex/device");
    await page.getByText("Ver salida del terminal", { exact: true }).click();
    await page.locator(".login-codex-paso").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/login-${width}.png` });
    const nuevaSkill = page.getByRole("button", { name: "Nueva skill", exact: true });
    await nuevaSkill.scrollIntoViewIfNeeded();
    await nuevaSkill.click();
    const comandoSkill = page.getByLabel("Comando de instalación");
    await comandoSkill.fill("npx skills add example/repo --skill example");
    await comandoSkill.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
    await comandoSkill.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
    await page.getByText("El repositorio tiene más de una skill con ese nombre. Elige un repositorio que contenga una sola.", { exact: true }).waitFor();
    assert.equal(skillInstallRequests, 1);
    await page.getByRole("button", { name: "Crear desde propuesta", exact: true }).click();
    const borradorSkill = page.getByLabel("Borrador de SKILL.md");
    await borradorSkill.fill("---\nname: resumen-experiencia\ndescription: Úsala para convertir un flujo repetido en instrucciones comprobables.\n---\n\n# Objetivo\n\nReutilizar el procedimiento y verificar el resultado.\n");
    assert.equal(await page.getByRole("button", { name: "Guardar skill revisada", exact: true }).isDisabled(), false);
    await page.screenshot({ path: `scratch/capturas-ci/skills-borrador-${width}.png` });
    const respuestaGuardado = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/skills/resumen-experiencia"));
    await page.getByRole("button", { name: "Guardar skill revisada", exact: true }).click();
    assert.equal((await respuestaGuardado).status(), 200);
    await page.locator("#skills-contenido").waitFor();
    assert.equal(skillSaveRequests, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    codexSesionEnPicker = true;
    await page.reload();
    await page.locator(".model-chip").click();
    const selectorModelos = page.getByRole("dialog", { name: "Elegir modelo" });
    await selectorModelos.getByRole("heading", { name: "OpenCode", exact: true }).waitFor();
    await selectorModelos.getByRole("heading", { name: "NVIDIA API", exact: true }).waitFor();
    await selectorModelos.getByRole("heading", { name: "Groq API", exact: true }).waitFor();
    await selectorModelos.getByRole("heading", { name: "Cuenta Codex", exact: true }).waitFor();
    await selectorModelos.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    assert.equal(await selectorModelos.getByRole("button", { name: /GPT-5 Codex/ }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/modelos-${width}.png` });
    console.log(`${width}px: código de acceso comprobado`);
    await page.goto(`${base}/tareas`);
    await page.getByRole("heading", { name: "Tareas programadas", exact: true }).waitFor();
    await page.getByText("Resumen diario", { exact: true }).waitFor();
    assert.equal(await page.getByText("Prompt ordinario del chat", { exact: true }).count(), 0);
    assert.equal(taskListRequests, 0, "la vista de tareas no consulta ni lista ejecuciones normales");
    await page.goto(`${base}/analiticas`);
    await page.getByRole("heading", { name: "Precisión de las métricas", exact: true }).waitFor();
    const barraDia = page.locator(".an-barra-grupo[tabindex='0']").first();
    await barraDia.focus();
    const detalleDia = page.getByRole("tooltip");
    await detalleDia.getByText("Tokens procesados", { exact: true }).waitFor();
    await detalleDia.getByText(/google · google\/prueba/).waitFor();
    await page.getByText(/registros con tokens medidos/).waitFor();
    const tablaModelos = page.locator(".an-tabla-modelos");
    await tablaModelos.scrollIntoViewIfNeeded();
    assert.equal(await tablaModelos.evaluate(el => el.scrollWidth > el.parentElement.clientWidth + 1), false, "los nombres largos no desbordan el panel de ejecuciones");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/ejecuciones-${width}.png` });
    await page.getByRole("tab", { name: /Consumo interno de Telo/ }).click();
    const tablaInterna = page.locator(".an-consumo-tabla");
    await tablaInterna.waitFor();
    assert.equal(await tablaInterna.evaluate(el => el.scrollWidth > el.parentElement.clientWidth), false, "la tabla de consumo cabe en el ancho del panel");
    await page.screenshot({ path: `scratch/capturas-ci/analiticas-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/analiticas-${width}.png` });
    sinDatos = true;
    await page.reload();
    await page.getByText("No disponible", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("No disponible", { exact: true }).count(), 2);
    const origenTarea = page.getByRole("table", { name: /Uso de IA por origen/ }).getByRole("row").filter({ hasText: "Tareas del agente" });
    assert.equal(await origenTarea.getByRole("cell").nth(1).textContent(), "—");
    conversacionesDisponibles = true; sinDatos = false;
    await page.goto(`${base}/chat?conversacion=c1`);
    const botonDetener = page.getByRole("button", { name: "Detener", exact: true });
    await botonDetener.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/detener-${width}.png` });
    await botonDetener.click();
    assert.equal(chatDetenido, true);
    assert.equal(await page.evaluate(() => localStorage.getItem("telo:cola-activa:c1")), "false");

    diffSinRepo = true; task.status = "failed";
    const respuestaSinRepo = page.waitForResponse(r => r.url().endsWith("/api/tasks/t1/diff"));
    await page.goto(`${base}/chat?conversacion=c1`);
    assert.equal((await (await respuestaSinRepo).json()).estado, "sin_repo");
    const consultasSinRepo = diffRequests;
    await page.waitForTimeout(4500);
    assert.equal(diffRequests, consultasSinRepo, "una copia Git inexistente no se vuelve a consultar cada cuatro segundos");
    assert.equal(await page.getByText("Esta tarea no tiene copia de Git, así que no hay cambios que revisar.", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/diff-sin-repo-${width}.png` });

    probarColaProveedor = true; task.status = "analyzing";
    messages.push({ id: "u-capacidad", role: "user", content: "Revisar con proveedor ocupado", created_at: now });
    await page.goto(`${base}/chat?conversacion=c1`);
    await page.locator(".tl-actividad-live").getByText("En cola: esperando capacidad de opencode", { exact: true }).first().waitFor();
    await page.locator(".tl-actividad-live").getByText("Capacidad disponible en opencode", { exact: true }).waitFor();
    await page.locator(".tl-actividad-live").getByText("Ejecutó comprobación tras la espera", { exact: true }).waitFor();
    assert.ok(lecturasColaProveedor >= 2, "el sondeo continúa actualizando el mismo turno cuando el canal de eventos falla");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/cola-proveedor-${width}.png` });
    probarColaProveedor = false;

    await page.goto(`${base}/ajustes?pestana=almacenamiento`);
    const disco = page.locator('section[aria-labelledby="disco-mantenimiento"]');
    const preferenciasAntesDisco = escriturasPreferencias;
    await disco.getByRole("button", { name: "Analizar sin borrar" }).click();
    await disco.getByText("2 carpetas candidatas. 1 tareas ocupadas omitidas. 0 incidencias.", { exact: true }).waitFor();
    await disco.getByLabel("Habilitar limpieza automática").check();
    await disco.getByLabel("Uso del disco que activa la limpieza (%)").fill("90");
    await disco.getByRole("button", { name: "Guardar configuración" }).click();
    await disco.getByText("Configuración guardada en el servidor.", { exact: true }).waitFor();
    assert.equal(politicaDisco.umbral, 90);
    assert.equal(politicaDisco.automatica, true);
    await disco.getByLabel("Conservar dependencias recientes (días)").fill("8");
    await disco.getByLabel("Conservar dependencias recientes (días)").press("Enter");
    await disco.getByText("Configuración guardada en el servidor.", { exact: true }).waitFor();
    assert.equal(politicaDisco.antiguedadDias, 8);
    await disco.getByRole("button", { name: "Limpiar dependencias ahora" }).click();
    await disco.getByText("2 carpetas retiradas. 1 tareas ocupadas omitidas. 0 incidencias.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await disco.scrollIntoViewIfNeeded();
    assert.equal(escriturasPreferencias, preferenciasAntesDisco);
    assert.equal(await page.locator(".aj-barra-guardado").count(), 0);
    await page.screenshot({ path: `scratch/capturas-ci/disco-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: login, mensajes, aprobación Git, código copiable y métricas.`);
  }
} finally { await browser.close(); server.stop(); }
