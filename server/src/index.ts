import { Hono } from "hono";
import { estadoDespliegue, puertaDespliegue } from "./despliegue";
import { iniciarMantenimientoDisco } from "./mantenimiento-disco";
import { join, resolve, sep, extname } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { chat, avisarTurnosInterrumpidos, previewHtmlAutorizada } from "./routes/chat";
import { documentos } from "./routes/documentos";
import { modelsRoute } from "./routes/models";
import { settings } from "./routes/settings";
import { tasks } from "./routes/tasks";
import { preferences } from "./routes/preferences";
import { analytics } from "./routes/analytics";
import { projects } from "./routes/projects";
import { providers } from "./routes/providers";
import { runner } from "./routes/runner";
import { stream } from "./routes/stream";
import { secretosRoute } from "./routes/secretos";
import { clavesProveedor } from "./routes/claves-proveedor";
import { claveSshRoute } from "./routes/clave-ssh";
import { programadasRoute } from "./routes/programadas";
import { servidor } from "./routes/servidor";
import { herramientas } from "./routes/herramientas";
import { proyectoConfig } from "./routes/proyecto-config";
import { repositoryActions } from "./routes/repository-actions";
import { skillsRoute } from "./routes/skills";
import { asegurarRutaInstalada } from "./instalacion";
import { prepararCarpetaGlobal } from "./skills";
import { github } from "./routes/github";
import { uso } from "./routes/uso";
import { media, reanudarGeneracionesMedios } from "./routes/media";
import { googleDriveOAuth } from "./routes/google-drive-oauth";
import { googleDriveArchives, iniciarGoogleDriveArchives } from "./routes/google-drive-archives";
import { jevRoute } from "./routes/jev";
import { conexiones } from "./routes/conexiones";
import { push } from "./routes/push";
import { iniciarColaPush } from "./push";
import { entornoConexion } from "./conexion";
import { startScheduler } from "./programadas";
import { startWorker } from "./worker";
import { auth } from "./routes/auth";
import { COOKIE_SESION, MIN_CARACTERES_CLAVE, sesionValida, limpiarSesionesAntiguas } from "./auth";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { MAX_IMAGEN_BYTES } from "./chat-adjuntos";

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
    imgSrc: [
      "'self'",
      "data:",
      "https://avatars.githubusercontent.com",
      "https://*.githubusercontent.com",
      "https://github.com",
    ],
    // El chat encarga video y audio como blob: del propio origen; sin media-src, el
    // default-src lo bloqueaba y el reproductor quedaba mudo en el VM.
    mediaSrc: ["'self'", "blob:"],
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
// Estas vistas se embeben en marcos del mismo origen y ponen sus propias cabeceras.
// Hono sobrescribe las cabeceras después de la ruta, así que se saltan aquí.
app.use("*", (c, next) =>
  /^\/api\/documentos\/[^/]+\/vista$/.test(c.req.path) ||
  /^\/api\/conversations\/[^/]+\/archivo-(?:pdf|html)$/.test(c.req.path)
    || /^\/api\/conversations\/[^/]+\/preview-html\/[a-f0-9]{64}\//.test(c.req.path)
    ? next()
    : cabecerasSeguras(c, next),
);

// Los prompts siguen limitados a 64 KB; las imágenes usan un límite separado y se validan por firma.
const limitarApi = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: "body_too_large" }, 413),
});
const limitarImagen = bodyLimit({
  maxSize: MAX_IMAGEN_BYTES + 64 * 1024,
  onError: (c) => c.json({ error: "image_size_invalid" }, 413),
});
app.use("/api/*", (c, next) =>
  c.req.method === "POST" && /^\/api\/conversations\/[^/]+\/adjuntos$/.test(c.req.path)
    ? limitarImagen(c, next)
    : limitarApi(c, next),
);

app.get("/api/health", (c) => {
  const row = db.query<{ ok: number }, []>("SELECT 1 AS ok").get();
  return c.json({ ok: row?.ok === 1, time: new Date().toISOString(), despliegue: estadoDespliegue() });
});

// Todo /api exige sesión, salvo el estado del servidor y las rutas de entrada y salida.
const PUBLICAS = new Set([
  "/api/health",
  "/api/login",
  "/api/logout",
  "/api/sesion",
  // Google solo puede volver desde la pantalla de consentimiento; el callback valida
  // estado de un solo uso y la cookie Lax emitida por el endpoint autenticado de inicio.
  "/api/google-drive/oauth/callback",
]);
app.use("/api/*", async (c, next) => {
  if (PUBLICAS.has(c.req.path)) return next();
  if (previewHtmlAutorizada(c.req.raw)) return next();
  if (!sesionValida(getCookie(c, COOKIE_SESION))) return c.json({ error: "login_required" }, 401);
  return next();
});

app.use("/api/*", puertaDespliegue);
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
app.route("/api", runner);
app.route("/api", stream);
app.route("/api", secretosRoute);
app.route("/api", clavesProveedor);
app.route("/api", claveSshRoute);
app.route("/api", programadasRoute);
app.route("/api", servidor);
app.route("/api", herramientas);
app.route("/api", skillsRoute);
app.route("/api", proyectoConfig);
app.route("/api", repositoryActions);
app.route("/api", uso);
app.route("/api", jevRoute);
app.route("/api", conexiones);
app.route("/api", push);
app.route("/api", github);
app.route("/api", media);
app.route("/api", googleDriveOAuth);
app.route("/api", googleDriveArchives);
app.get("/api/*", (c) => c.json({ error: "not_found" }, 404));

// El CLI de OpenCode instalado desde la app vuelve a estar en PATH tras un reinicio.
asegurarRutaInstalada();
// Carpeta de skills globales: existe siempre, para que el agente la vea en solo lectura.
prepararCarpetaGlobal();

// Un turno del chat que quedó sin respuesta por un reinicio se avisa antes de atender a nadie.
avisarTurnosInterrumpidos();
// Tope de arranque: el primer acceso a la base dispara migraciones y respaldo al vuelo; si el
// arranque cuelga ahí, el proceso sale con un diagnóstico claro en vez de quedarse mudo.
const TOPE_ARRANQUE_MS = Number(process.env.TELO_TOPE_ARRANQUE_MS ?? 120_000);
let arranqueColgado: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  console.error(`[arranque] El proceso no terminó de arrancar en ${Math.round(TOPE_ARRANQUE_MS / 1000)} s (migraciones, respaldo o tareas iniciales atascadas). La base puede tomarlo desde TELO_TOPE_ARRANQUE_MS; se corta con código 2.`);
  process.exit(2);
}, TOPE_ARRANQUE_MS);
startWorker();
startScheduler();
iniciarMantenimientoDisco();
iniciarColaPush();
iniciarGoogleDriveArchives();
reanudarGeneracionesMedios();
limpiarSesionesAntiguas();
// El arranque llegó a la escucha: el tope ya no aplica.
if (arranqueColgado) {
  clearTimeout(arranqueColgado);
  arranqueColgado = null;
}

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
  fetch(request: Request, server: Bun.Server<unknown>) {
    return app.fetch(request, entornoConexion(request, server));
  },
};
