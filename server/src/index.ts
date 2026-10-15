import { Hono } from "hono";
import { join, resolve, sep, extname } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { chat, avisarTurnosInterrumpidos } from "./routes/chat";
import { documentos } from "./routes/documentos";
import { modelsRoute } from "./routes/models";
import { settings } from "./routes/settings";
import { tasks } from "./routes/tasks";
import { preferences } from "./routes/preferences";
import { analytics } from "./routes/analytics";
import { projects } from "./routes/projects";
import { providers } from "./routes/providers";
import { cuotas } from "./routes/cuotas";
import { runner } from "./routes/runner";
import { stream } from "./routes/stream";
import { secretosRoute } from "./routes/secretos";
import { clavesProveedor } from "./routes/claves-proveedor";
import { claveSshRoute } from "./routes/clave-ssh";
import { programadasRoute } from "./routes/programadas";
import { servidor } from "./routes/servidor";
import { herramientas } from "./routes/herramientas";
import { skillsRoute } from "./routes/skills";
import { asegurarRutaInstalada } from "./instalacion";
import { prepararCarpetaGlobal } from "./skills";
import { googleRoute } from "./routes/google";
import { github } from "./routes/github";
import { uso } from "./routes/uso";
import { startScheduler } from "./programadas";
import { startWorker } from "./worker";
import { auth } from "./routes/auth";
import { COOKIE_SESION, MIN_CARACTERES_CLAVE, sesionValida } from "./auth";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

// Sin clave, la API quedaría abierta a quien tenga la URL. Por eso el servidor no arranca sin ella.
if (!config.clave && !config.sinClave) {
  console.error(`Falta TELO_CLAVE en el entorno del servidor (mínimo ${MIN_CARACTERES_CLAVE} caracteres).`);
  process.exit(1);
}
if (config.clave && config.clave.length < MIN_CARACTERES_CLAVE) {
  console.error(`TELO_CLAVE debe tener al menos ${MIN_CARACTERES_CLAVE} caracteres.`);
  process.exit(1);
}
if (config.sinClave) {
  console.warn("TELO_SIN_CLAVE=1: la API no pide clave. Úsalo solo en desarrollo local.");
}

const webDist = resolve(import.meta.dir, "../../web/dist");
const indexFile = join(webDist, "index.html");

const app = new Hono();

// Cabeceras de seguridad. La política solo permite lo que usa la app: scripts y estilos del mismo origen,
// conexiones al mismo origen (API y SSE) y nada embebido. Sin inline scripts.
const cabecerasSeguras = secureHeaders({
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "no-referrer",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
  },
});
// La vista previa de un documento se embebe en un marco del mismo origen y pone sus propias cabeceras
// (ver routes/documentos.ts). Hono sobrescribe las cabeceras después de la ruta, así que se salta aquí.
app.use("*", (c, next) =>
  /^\/api\/documentos\/[^/]+\/vista$/.test(c.req.path) ? next() : cabecerasSeguras(c, next),
);

// Ninguna petición de la API necesita más de 64 KB (el prompt más largo es de 10 000 caracteres).
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: "body_too_large" }, 413),
  }),
);

app.get("/api/health", (c) => {
  const row = db.query<{ ok: number }, []>("SELECT 1 AS ok").get();
  return c.json({ ok: row?.ok === 1, time: new Date().toISOString() });
});

// Todo /api exige sesión, salvo el estado del servidor, las rutas de entrada y salida y el regreso de Google
// (Google llama desde otro sitio, así que la cookie de sesión no viaja; el estado de un solo uso lo protege).
const PUBLICAS = new Set([
  "/api/health",
  "/api/login",
  "/api/logout",
  "/api/sesion",
  "/api/google/callback",
]);
app.use("/api/*", async (c, next) => {
  if (PUBLICAS.has(c.req.path)) return next();
  if (!sesionValida(getCookie(c, COOKIE_SESION))) return c.json({ error: "login_required" }, 401);
  return next();
});

app.route("/api", auth);
app.route("/api", chat);
app.route("/api", documentos);
app.route("/api", modelsRoute);
app.route("/api", settings);
app.route("/api", tasks);
app.route("/api", preferences);
app.route("/api", analytics);
app.route("/api", projects);
app.route("/api", providers);
app.route("/api", cuotas);
app.route("/api", runner);
app.route("/api", stream);
app.route("/api", secretosRoute);
app.route("/api", clavesProveedor);
app.route("/api", claveSshRoute);
app.route("/api", programadasRoute);
app.route("/api", servidor);
app.route("/api", herramientas);
app.route("/api", skillsRoute);
app.route("/api", uso);
app.route("/api", googleRoute);
app.route("/api", github);
app.get("/api/*", (c) => c.json({ error: "not_found" }, 404));

// El CLI de OpenCode instalado desde la app vuelve a estar en PATH tras un reinicio.
asegurarRutaInstalada();
// Carpeta de skills globales: existe siempre, para que el agente la vea en solo lectura.
prepararCarpetaGlobal();

// Un turno del chat que quedó sin respuesta por un reinicio se avisa antes de atender a nadie.
avisarTurnosInterrumpidos();
startWorker();
startScheduler();

app.get("*", async (c) => {
  const path = c.req.path === "/" ? "/index.html" : c.req.path;
  const file = resolve(webDist, "." + path);

  if (!file.startsWith(webDist + sep)) return c.text("Forbidden", 403);

  // index.html y version.json nunca se guardan en caché: la app los usa para detectar versiones nuevas.
  const sinCache = { "Cache-Control": "no-cache" };

  if (extname(file) && (await Bun.file(file).exists())) {
    return new Response(Bun.file(file), { headers: path === "/version.json" ? sinCache : undefined });
  }

  return new Response(Bun.file(indexFile), {
    headers: { "Content-Type": "text/html; charset=utf-8", ...sinCache },
  });
});

console.log(`Orquestador escuchando en http://localhost:${config.port}`);

export default {
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch,
};
