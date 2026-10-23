import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// API y sesión reales sobre una base temporal; ningún proveedor ni servidor remoto.
await import("../../server/tests/preload.ts");
const { Hono } = await import("../../server/node_modules/hono/dist/index.js");
const { db } = await import("../../server/src/db/index.ts");
const { config } = await import("../../server/src/config.ts");
const { chat, previewHtmlAutorizada } = await import("../../server/src/routes/chat.ts");
const { COOKIE_SESION, crearSesionDispositivo, sesionValida, cerrarSesionPorToken } = await import("../../server/src/auth.ts");
config.sinClave = false;
const id = crypto.randomUUID();
db.query("INSERT INTO conversations(id,title) VALUES (?,?)").run(id, "Preview local");
const carpeta = join(config.dataDir, "chat-workspace", id, "demo");
mkdirSync(carpeta, { recursive: true });
writeFileSync(join(carpeta, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script></head><body><h1>Preview funcional</h1><img src="imagen.svg"><img src="https://externo.invalid/fuera.png"></body></html>');
writeFileSync(join(carpeta, "style.css"), '@import "./interior.css"; body{margin:16px}');
writeFileSync(join(carpeta, "interior.css"), "h1{color:rgb(30,90,140)}");
writeFileSync(join(carpeta, "app.js"), 'import {valor} from "./modulo.js"; document.body.dataset.modulo=valor; try{parent.document.body.dataset.escapado="si"}catch{document.body.dataset.aislado="si"} fetch("/api/datos-privados").catch(()=>document.body.dataset.bloqueado="si");');
writeFileSync(join(carpeta, "modulo.js"), 'export const valor="cargado";');
writeFileSync(join(carpeta, "imagen.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="navy"/></svg>');
const sesion = crearSesionDispositivo({});
const api = new Hono();
api.use("/api/*", async (c, next) => {
  const cookie = c.req.header("Cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE_SESION}=`))?.slice(COOKIE_SESION.length + 1);
  return sesionValida(cookie) || previewHtmlAutorizada(c.req.raw) ? next() : c.json({ error: "login_required" }, 401);
});
api.route("/api", chat);
const servidor = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  if (new URL(request.url).pathname === "/") return new Response(`<iframe title="Reporte HTML" sandbox="allow-scripts" src="/api/conversations/${id}/archivo-html?ruta=demo/index.html" style="width:100%;height:500px;border:0"></iframe>`, { headers: { "Content-Type": "text/html", "Set-Cookie": `${COOKIE_SESION}=${sesion.token}; SameSite=Strict; HttpOnly; Path=/` } });
  return api.fetch(request);
} });
const navegador = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  for (const ancho of [390, 1440]) {
    const pagina = await navegador.newPage({ viewport: { width: ancho, height: 850 } });
    const peticiones = [];
    pagina.on("request", request => peticiones.push(request.url()));
    await pagina.goto(`http://127.0.0.1:${servidor.port}/`);
    const marco = pagina.frameLocator('iframe[title="Reporte HTML"]');
    await marco.locator('body[data-modulo="cargado"][data-aislado="si"][data-bloqueado="si"]').waitFor();
    assert.equal(await marco.locator("h1").evaluate(el => getComputedStyle(el).color), "rgb(30, 90, 140)");
    assert.equal(await marco.locator('img[src="imagen.svg"]').evaluate(el => el.complete && el.naturalWidth > 0), true);
    assert.equal(await pagina.locator("body").getAttribute("data-escapado"), null);
    assert.equal(peticiones.some(url => url.endsWith("/api/datos-privados")), false);
    await pagina.screenshot({ path: `scratch/capturas-ci/html-preview-${ancho}.png` });
    await pagina.close();
    console.log(`PASS HTML ${ancho}px: cookie Strict, CSS importado, módulos JS, imagen y origen opaco.`);
  }
} finally {
  cerrarSesionPorToken(sesion.token);
  await navegador.close(); servidor.stop();
  db.query("DELETE FROM conversations WHERE id=?").run(id);
}
