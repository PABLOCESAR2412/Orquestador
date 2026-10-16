import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";

// Solo fixtures locales: estas pruebas nunca llaman a proveedores ni a repositorios reales.
const root = resolve("dist");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const path = resolve(root, "." + new URL(req.url).pathname);
  const file = Bun.file(path);
  return new Response(path.startsWith(root) && extname(path) && await file.exists() ? file : Bun.file(resolve(root, "index.html")));
} });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
mkdirSync("scratch/capturas-ci", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    const now = new Date().toISOString();
    const task = { id: "t1", title: "Prueba", model: "google/prueba", status: "done", created_at: now, started_at: now, finished_at: now, plan: null, reporte: null };
    const messages = [
      { id: "u1", role: "user", content: "git commit y push", created_at: now },
      { id: "a1", role: "assistant", content: '{"estado":"fallo","resumen":"Faltan dependencias","desviacion":"Instala antes de probar","pendientes":["x".replace("x","y")]}<telo-memoria>MEMORIA_INTERNA</telo-memoria>', created_at: now },
      { id: "u2", role: "user", content: "prepara de nuevo el git commit y push", created_at: now },
    ];
    const actions = ["u1", "u2"].map((id, i) => ({ id: `git${i}`, action: "push", task_id: "t1", message_id: id, state: i ? "pending" : "superseded", result: null, payload: JSON.stringify({ remote: "https://github.com/ejemplo/pruebas", rama: "telo/prueba", messageId: id }) }));
    let authenticated = false;
    let approvals = 0;
    let sinDatos = false;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === "/api/sesion") return route.fulfill({ status: authenticated ? 200 : 401, json: { ok: authenticated } });
      if (path === "/api/login") { authenticated = true; data = { ok: true }; }
      else if (path === "/api/conversations") data = [{ id: "c1", title: "Prueba de flujo", model: "google/prueba", project_id: "p1", project_name: "Pruebas", created_at: now }];
      else if (path === "/api/conversations/c1/messages") {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          messages.push({ id: "u3", role: "user", content: body.content, created_at: now }, { id: "a3", role: "assistant", content: "Mensaje recibido", created_at: now });
          data = { messages: messages.slice(-2) };
        } else data = messages;
      }
      else if (path === "/api/conversations/c1/acciones") data = actions;
      else if (path === "/api/conversations/c1/tasks" || path === "/api/tasks") data = [task];
      else if (path === "/api/tasks/t1/diff") data = { estado: "sin_cambios", archivos: [], hash: null, diff: "", remoto: true, aprobaciones: { commit: null, push: null } };
      else if (path.endsWith("/decidir")) { approvals++; actions[1].state = "approved"; actions[1].result = JSON.stringify({ sha: "abcdef012345" }); data = { ok: true }; }
      else if (path === "/api/models") data = { models: [] };
      else if (path === "/api/preferences") data = { defaultModel: null, defaultEffort: null, monthlyBudgetUsd: null, budgetAlertPercent: 80 };
      else if (path === "/api/providers") data = [{ id: "codex", name: "Codex", configured: false, variable: null, enAgente: false, guardable: false, sesion: false }];
      else if (path === "/api/providers/codex/login") data = { estado: "esperando", conectada: false, url: "https://auth.openai.com/codex/device", codigo: "ABCD-EFGH", salida: "Salida de prueba\n" + "x".repeat(300) };
      else if (path === "/api/servidor") data = null;
      else if (path === "/api/cuotas") data = { proveedores: [] };
      else if (path === "/api/skills") data = { skills: [] };
      else if (path.includes("/herramientas/")) data = { instalada: true, estado: "inactivo" };
      else if (path.includes("github/app")) data = { configurado: false, faltantes: [], instalaciones: [] };
      else if (path.includes("github/cuenta") || path.includes("google")) data = { conectado: false, configurado: false, faltantes: [] };
      else if (path === "/api/runner") data = { opencode: true, bwrap: true, aislamiento: true };
      else if (path === "/api/projects") data = [{ id: "p1", name: "Pruebas" }];
      else if (path === "/api/analytics") data = {
        days: 30, filtros: { proyecto: null, modelo: null }, proyectos: [], modelos: [], budget: null,
        totals: { calls: 1, inputTokens: sinDatos ? 0 : 8, outputTokens: sinDatos ? 0 : 2, cost: 0 }, byDay: [], byModel: [],
        byType: ["chat", "tarea", "otro"].map(tipo => ({ tipo, calls: tipo === "tarea" ? 1 : 0, tokens: tipo === "tarea" && !sinDatos ? 10 : 0, cost: 0, sinTokens: tipo === "tarea" && sinDatos ? 1 : 0, sinCoste: tipo === "tarea" && sinDatos ? 1 : 0 })),
        tasks: { done: 1 }, calidad: { tokensMedidos: sinDatos ? 0 : 1, costesEstimados: sinDatos ? 0 : 1, sinTokens: sinDatos ? 1 : 0, sinCoste: sinDatos ? 1 : 0, historicos: 0 },
        byTask: [{ taskId: "t1", calls: 1, tokens: sinDatos ? 0 : 10, cost: 0, tokensMedidos: sinDatos ? 0 : 1, costesEstimados: sinDatos ? 0 : 1, sinTokens: sinDatos ? 1 : 0, sinCoste: sinDatos ? 1 : 0, historicos: 0 }],
      };
      else if (path.includes("eventos-vivos")) return route.fulfill({ contentType: "text/event-stream", body: ": alive\n\n" });
      return route.fulfill({ json: data });
    });
    await page.goto(`${base}/entrar`);
    await page.getByLabel("Clave de acceso").fill("clave-ficticia-de-prueba");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/chat");
    console.log(`${width}px: sesión local de prueba iniciada`);
    await page.getByText("Faltan dependencias", { exact: true }).waitFor();
    assert.equal(await page.getByRole("article", { name: "Acción de Git" }).count(), 2);
    assert.equal(await page.locator(".tl-detalles-reporte pre").isVisible(), false);
    assert.equal((await page.locator("body").textContent()).includes("MEMORIA_INTERNA"), false);
    await page.getByRole("button", { name: "Autorizar commit y push", exact: true }).click();
    await page.getByText("Completada", { exact: true }).waitFor();
    assert.equal(approvals, 1);
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Prueba de mensaje");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page.getByText("Mensaje recibido", { exact: true }).waitFor();
    console.log(`${width}px: mensajes y aprobación comprobados`);
    assert.equal(await page.getByText("Historial de Git", { exact: true }).count(), 0);
    await page.screenshot({ path: `scratch/capturas-ci/chat-${width}.png` });
    await page.goto(`${base}/ajustes`);
    await page.getByRole("button", { name: "Copiar código", exact: true }).click();
    await page.getByText("Código copiado.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "ABCD-EFGH");
    assert.equal(await page.locator(".login-codex-enlace").getAttribute("href"), "https://auth.openai.com/codex/device");
    await page.getByText("Ver salida del terminal", { exact: true }).click();
    await page.locator(".login-codex-paso").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/login-${width}.png` });
    console.log(`${width}px: código de acceso comprobado`);
    await page.goto(`${base}/analiticas`);
    await page.getByRole("heading", { name: "Precisión de las métricas", exact: true }).waitFor();
    await page.getByRole("cell", { name: /10\s+medidos/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/analiticas-${width}.png` });
    sinDatos = true;
    await page.reload();
    await page.getByText("No disponible", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("No disponible", { exact: true }).count(), 2);
    const origenTarea = page.getByRole("table", { name: "Uso de IA por origen" }).getByRole("row").filter({ hasText: "Tareas del agente" });
    assert.equal(await origenTarea.getByRole("cell").nth(1).textContent(), "—");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: login, mensajes, aprobación Git, código copiable y métricas.`);
  }
} finally { await browser.close(); server.stop(); }
