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
    const task = { id: "t1", title: "Prueba", model: "google/prueba", modelo_agotado: null, status: "done", created_at: now, started_at: now, finished_at: now, plan: null, reporte: null };
    const messages = [
      { id: "u1", role: "user", content: "git commit y push", created_at: now },
      { id: "a1", role: "assistant", content: '{"estado":"fallo","resumen":"Faltan dependencias","desviacion":"Instala antes de probar","pendientes":["x".replace("x","y")]}<telo-memoria>MEMORIA_INTERNA</telo-memoria>', created_at: now },
      { id: "u2", role: "user", content: "prepara de nuevo el git commit y push", created_at: now },
      { id: "a2", role: "assistant", content: "El segundo intento está listo para revisar.\n\n```mermaid\nflowchart TD\n  Chat --> API\n  API --> DB\n```\n\n| Capa | Uso |\n| --- | --- |\n| API | Datos |\n\n```text\nproyecto/\n└── src/\n```", created_at: now },
    ];
    const actions = [
      { id: "git-old", action: "push", task_id: "t1", message_id: "u2", state: "failed", result: JSON.stringify({ mensaje: "Falló el intento anterior" }), payload: JSON.stringify({ remote: "https://github.com/ejemplo/pruebas", rama: "telo/prueba", messageId: "u2" }) },
      { id: "git1", action: "push", task_id: "t1", message_id: "u2", state: "pending", result: null, payload: JSON.stringify({ remote: "https://github.com/ejemplo/pruebas", rama: "telo/prueba", messageId: "u2", autenticacion: { tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "PABLOCESAR2412", instalacion_id: 1 } }) },
    ];
    let authenticated = false;
    let codexSesionEnPicker = false;
    let jevConfigurada = false;
    let approvals = 0;
    let skillInstallRequests = 0;
    let diffRequests = 0;
    let sinDatos = false;
    let anunciarEnvioA;
    let liberarEnvioA;
    const envioAIniciado = new Promise(resolve => { anunciarEnvioA = resolve; });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === "/api/sesion") return route.fulfill({ status: authenticated ? 200 : 401, json: { ok: authenticated } });
      if (path === "/api/login") { authenticated = true; data = { ok: true }; }
      else if (path === "/api/conversations") data = [
        { id: "c1", title: "Prueba de flujo", model: "google/prueba", project_id: "p1", project_name: "Pruebas", created_at: now },
        { id: "c2", title: "Chat paralelo", model: "nvidia/nemotron-test", project_id: null, project_name: null, created_at: now },
        { id: "c3", title: "Chat de esta semana", model: "google/prueba", project_id: null, project_name: null, created_at: new Date(Date.now() - 4 * 86_400_000).toISOString() },
        { id: "c4", title: "Chat anterior", model: "google/prueba", project_id: null, project_name: null, created_at: new Date(Date.now() - 10 * 86_400_000).toISOString() },
      ];
      else if (path === "/api/conversations/c1/messages") {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          if (body.content === "Envío del chat A") {
            anunciarEnvioA();
            await new Promise(resolve => { liberarEnvioA = resolve; });
            messages.push({ id: "u-paralelo", role: "user", content: body.content, created_at: now }, { id: "a-paralelo", role: "assistant", content: "Respuesta del chat A", created_at: now });
            return route.fulfill({ json: { messages: messages.slice(-2) } });
          }
          messages.push({ id: "u3", role: "user", content: body.content, created_at: now }, { id: "a3", role: "assistant", content: "Mensaje recibido", created_at: now });
          data = { messages: messages.slice(-2) };
        } else data = messages;
      }
      else if (path === "/api/conversations/c2/messages") data = [];
      else if (path === "/api/conversations/c1/acciones") data = actions;
      else if (path === "/api/conversations/c1/tasks" || path === "/api/tasks") data = [task];
      else if (path === "/api/tasks/t1/diff") {
        diffRequests++;
        data = diffRequests === 1
          ? { estado: "en_curso" }
          : { estado: "con_cambios", rama: "telo/prueba", base_commit: null, commit: "abcdef012345", archivos: [{ ruta: "src/app.ts", estado: "modificado", adiciones: 2, eliminaciones: 1, binario: false, sensible: false }], hash: "0123456789abcdef", diff: "diff de prueba", truncado: false, remoto: true, aprobaciones: { commit: null, push: null } };
      }
      else if (path.endsWith("/decidir")) { approvals++; actions[1].state = "approved"; actions[1].result = JSON.stringify({ sha: "abcdef012345" }); return route.fulfill({ status: 409, json: { error: "action_already_decided" } }); }
      else if (path === "/api/models") data = { models: [
        { id: "opencode/claude-fable-5", provider: "opencode", name: "Claude Fable 5", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Claude", recommended: true },
        { id: "nvidia/nemotron-test", provider: "nvidia", name: "Nemotron Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Nemotron", recommended: true },
        { id: "groq/llama-test", provider: "groq", name: "Llama Test", inputUsd: 0, outputUsd: 0, context: 1000, variants: [], free: true, costTier: "gratis", costWarning: null, group: "Llama", recommended: true },
      ] };
      else if (path === "/api/preferences") data = { defaultModel: null, defaultEffort: null, monthlyBudgetUsd: null, budgetAlertPercent: 80 };
      else if (path === "/api/providers") data = [{ id: "codex", name: "Codex", configured: codexSesionEnPicker, variable: null, enAgente: false, guardable: false, sesion: codexSesionEnPicker }];
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
      else if (path === "/api/servidor") data = null;
      else if (path === "/api/cuotas") data = { proveedores: [] };
      else if (path === "/api/skills") data = { skills: [] };
      else if (path.includes("/herramientas/")) data = { instalada: true, estado: "inactivo" };
      else if (path.includes("github/app")) data = { configurado: true, faltantes: [], seleccionada: 1, instalaciones: [
        { id: 1, name: "PABLOCESAR2412", login: "PABLOCESAR2412", avatar_url: "", repository_selection: "all" },
      ] };
      else if (path.includes("github/cuenta") || path.includes("google")) data = { conectado: true, metodo: "app", login: "PABLOCESAR2412", sesion_anterior: false };
      else if (path.includes("/projects/") && path.includes("/git/comprobar")) data = { ok: true, repo: "ejemplo/pruebas", push: true, verificacion: "confirmada", autenticacion: { tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "PABLOCESAR2412", instalacion_id: 1 } };
      else if (path.includes("/projects/") && path.endsWith("/git")) data = { remote: "https://github.com/ejemplo/pruebas", repository: "ejemplo/pruebas", author_name: "Telo", base_branch: "main", inicializado: true, ocupado: false, token: false, tokenProyecto: false, tokenGlobal: false, prToken: false, ssh: false, github: { conectado: true, metodo: "app", login: "PABLOCESAR2412" } };
      else if (path === "/api/runner") data = { opencode: true, bwrap: true, aislamiento: true };
      else if (path === "/api/projects") data = [{ id: "p1", name: "Pruebas" }];
      else if (path === "/api/uso") data = { generado: now, proveedores: [{
        id: "google", nombre: "Google (Gemini)",
        ultimas5h: { costoUsd: 0.5, tokens: 1200, llamadas: 2 },
        ultimos7d: { costoUsd: 1, tokens: 4000, llamadas: 6 },
        cuotaRestanteUsd: 4, precision: "medida_telo",
      }] };
      else if (path === "/api/analytics") data = {
        days: 30, filtros: { proyecto: null, modelo: null }, proyectos: [], modelos: [], budget: null, usoJev: [],
        totals: { calls: 1, inputTokens: sinDatos ? 0 : 8, outputTokens: sinDatos ? 0 : 2, cost: 0 }, byDay: [], byModel: [],
        byType: ["chat", "tarea", "otro"].map(tipo => ({ tipo, calls: tipo === "tarea" ? 1 : 0, tokens: tipo === "tarea" && !sinDatos ? 10 : 0, cost: 0, sinTokens: tipo === "tarea" && sinDatos ? 1 : 0, sinCoste: tipo === "tarea" && sinDatos ? 1 : 0 })),
        tasks: { done: 1 }, calidad: { tokensMedidos: sinDatos ? 0 : 1, costesEstimados: sinDatos ? 0 : 1, sinTokens: sinDatos ? 1 : 0, sinCoste: sinDatos ? 1 : 0, historicos: 0 },
        byTask: [{ taskId: "t1", calls: 1, tokens: sinDatos ? 0 : 10, cost: 0, tokensMedidos: sinDatos ? 0 : 1, costesEstimados: sinDatos ? 0 : 1, sinTokens: sinDatos ? 1 : 0, sinCoste: sinDatos ? 1 : 0, historicos: 0 }],
      };
      else if (path.includes("eventos-vivos")) return route.fulfill({ contentType: "text/event-stream", body: ": alive\n\n" });
      return route.fulfill({ json: data });
    });
    const respuestaDiffTransitoria = page.waitForResponse(response => response.url().endsWith("/api/tasks/t1/diff"));
    await page.goto(`${base}/entrar`);
    await page.getByLabel("Clave de acceso").fill("clave-ficticia-de-prueba");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/chat");
    console.log(`${width}px: sesión local de prueba iniciada`);
    await page.getByText("ANTERIORES", { exact: true }).waitFor();
    assert.equal((await (await respuestaDiffTransitoria).json()).estado, "en_curso");
    await page.locator(".tl-diagrama-visual svg").waitFor();
    const comprobarTemaDiagrama = async tema => {
      await page.evaluate(valor => { document.documentElement.dataset.theme = valor; }, tema);
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
    };
    await comprobarTemaDiagrama("oscuro");
    await comprobarTemaDiagrama("claro");
    await comprobarTemaDiagrama("oscuro");
    assert.equal(await page.locator(".tl-diagrama-visual svg .node").count(), 3);
    assert.equal(await page.locator(".tl-diagrama-fuente summary").textContent(), "Ver código Mermaid");
    assert.equal(await page.locator(".tl-tabla-wrap table tbody tr").count(), 1);
    assert.ok((await page.locator(".tl-md pre code").allTextContents()).some(codigo => codigo.includes("└── src/")));
    const arbolArchivos = page.locator(".tl-codigo").filter({ hasText: "└── src/" });
    assert.equal(await arbolArchivos.getByRole("button", { name: "Aplicar", exact: true }).count(), 0);
    assert.deepEqual(await page.locator(".tl-grupo-titulo").allTextContents(), ["RECIENTES", "ÚLTIMOS 7 DÍAS", "ANTERIORES"]);
    assert.equal(await page.getByText("HOY", { exact: true }).count(), 0);
    assert.equal(await page.getByText("AYER", { exact: true }).count(), 0);
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    const versionButton = page.getByRole("button", { name: /Ver historial de cambios de la versión/ });
    await versionButton.click();
    const historialCambios = page.getByRole("dialog", { name: "Historial de cambios" });
    await historialCambios.waitFor();
    assert.ok(await historialCambios.locator(".tl-cambio").count() > 0);
    assert.equal(await historialCambios.getAttribute("aria-modal"), "true");
    await page.screenshot({ path: `scratch/capturas-ci/cambios-${width}.png` });
    await page.keyboard.press("Escape");
    await historialCambios.waitFor({ state: "detached" });
    assert.equal(await versionButton.evaluate(el => el === document.activeElement), true);
    if (width === 390) await page.getByRole("button", { name: "Cerrar barra lateral", exact: true }).click();
    const contrasteGrupo = await page.locator(".tl-grupo-titulo").first().evaluate(el => getComputedStyle(el).color);
    const contrasteChat = await page.locator(".sidebar-conv-title").first().evaluate(el => getComputedStyle(el).color);
    assert.notEqual(contrasteGrupo, contrasteChat);
    await page.getByText("Faltan dependencias", { exact: true }).waitFor();
    assert.equal(await page.getByRole("article", { name: "Acción de Git" }).count(), 1);
    await page.getByText("Ver 1 intento anterior", { exact: true }).waitFor();
    await page.locator(".tl-resumen-cambios").waitFor();
    const cambiosAntesDeAccion = await page.locator(".tl-hilo-columna").evaluate(root => {
      const cambios = root.querySelector(".tl-resumen-cambios");
      const accion = root.querySelector('article[aria-label="Acción de Git"]');
      return Boolean(cambios && accion && (cambios.compareDocumentPosition(accion) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(cambiosAntesDeAccion, true);
    assert.equal(await page.locator(".tl-detalles-reporte pre").isVisible(), false);
    assert.equal((await page.locator("body").textContent()).includes("MEMORIA_INTERNA"), false);
    await page.getByRole("button", { name: "Autorizar commit y push", exact: true }).click();
    await page.getByText("Completada", { exact: true }).waitFor();
    assert.equal(await page.locator(".tl-resumen-cambios").evaluate(cambios => {
      const accion = document.querySelector('article[aria-label="Acción de Git"]');
      return Boolean(accion && (cambios.compareDocumentPosition(accion) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true);
    assert.equal(approvals, 1);
    assert.equal(await page.locator('article[aria-label="Acción de Git"] [role="alert"]').count(), 0);
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Envío del chat A");
    const requestChatA = page.waitForRequest(request => request.url().endsWith("/api/conversations/c1/messages") && request.method() === "POST" && request.postDataJSON().content === "Envío del chat A");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await Promise.all([requestChatA, envioAIniciado]);
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Chat paralelo", exact: true }).click();
    await page.getByRole("heading", { name: "Chat paralelo", exact: true }).waitFor();
    assert.equal(await page.locator(".tl-pensando").count(), 0);
    assert.equal((await page.locator(".tl-hilo-columna").textContent()).includes("Envío del chat A"), false);
    liberarEnvioA();
    if (width === 390) await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page.getByRole("button", { name: "Prueba de flujo", exact: true }).click();
    await page.getByText("Respuesta del chat A", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("Prueba de mensaje");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page.getByText("Mensaje recibido", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Uso", exact: true }).click();
    const panelUso = page.getByRole("dialog", { name: "Uso del proveedor" });
    await panelUso.waitFor();
    const medidoresUso = panelUso.locator('[role="meter"]');
    await medidoresUso.nth(1).waitFor({ state: "visible" });
    assert.equal(await medidoresUso.count(), 2);
    assert.equal(await medidoresUso.nth(0).getAttribute("aria-valuenow"), "80");
    assert.equal(await medidoresUso.nth(1).getAttribute("aria-valuenow"), "88.9");
    assert.equal((await panelUso.textContent()).includes("US$ 0.50 · 11,1 %"), true);
    assert.equal((await panelUso.textContent()).includes("US$ 4.00 · 88,9 %"), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/uso-${width}.png` });
    await page.keyboard.press("Escape");
    task.status = "sin_cuota";
    task.modelo_agotado = "google/prueba";
    await page.locator(".cuota-aviso").waitFor();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("No se debe aceptar mientras falte cuota");
    assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled(), true);
    assert.equal((await page.locator(".cuota-aviso").textContent()).includes("Se acabó la cuota de google/prueba"), true);
    await page.screenshot({ path: `scratch/capturas-ci/cuota-chat-${width}.png` });
    await page.getByRole("button", { name: "Cambiar modelo", exact: true }).click();
    await page.locator(".picker").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill("");
    console.log(`${width}px: mensajes y aprobación comprobados`);
    assert.equal(await page.getByText("Historial de Git", { exact: true }).count(), 0);
    await page.screenshot({ path: `scratch/capturas-ci/chat-${width}.png` });
    if (width === 1440) {
      await page.getByRole("button", { name: "Eliminar Prueba de flujo" }).click();
      const confirmarEliminar = page.locator(".conv-confirm");
      await confirmarEliminar.waitFor();
      assert.equal(await confirmarEliminar.getByText("Se eliminarán «Prueba de flujo» y todos sus mensajes. No se puede deshacer.", { exact: true }).isVisible(), true);
      assert.equal(await confirmarEliminar.getByRole("button", { name: "Cancelar", exact: true }).evaluate(el => el === document.activeElement), true);
      await page.screenshot({ path: "scratch/capturas-ci/chat-delete-1440.png" });
      await page.keyboard.press("Escape");
      await confirmarEliminar.waitFor({ state: "detached" });
    }
    await page.goto(`${base}/ajustes`);
    await page.getByRole("heading", { name: "Ajustes y Servidor", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Cuenta de Google", exact: true }).count(), 0);
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
    await tarjetaJev.getByRole("button", { name: "Mostrar", exact: true }).click();
    assert.equal(await campoJev.getAttribute("type"), "text");
    await tarjetaJev.getByRole("button", { name: "Ocultar", exact: true }).click();
    assert.equal(await campoJev.getAttribute("type"), "password");
    await campoJev.fill("apikey_prueba_de_interfaz_123456789012");
    await tarjetaJev.getByRole("button", { name: "Guardar clave", exact: true }).click();
    await tarjetaJev.getByText("Clave guardada cifrada; Telo no vuelve a mostrar su valor.", { exact: true }).waitFor();
    assert.equal(await campoJev.inputValue(), "");
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
    codexSesionEnPicker = true;
    await page.reload();
    await page.locator(".model-chip").click();
    await page.getByRole("heading", { name: "OpenCode", exact: true }).waitFor();
    await page.getByRole("heading", { name: "NVIDIA API", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Groq API", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Cuenta Codex", exact: true }).waitFor();
    await page.locator(".picker").evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    assert.equal(await page.getByRole("button", { name: /GPT-5 Codex/ }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `scratch/capturas-ci/modelos-${width}.png` });
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
