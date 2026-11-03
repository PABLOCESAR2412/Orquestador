import { createServer, request as requestHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, connect, isIP, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../config";
import { endpointCloudflare } from "../cloudflare";

const PUENTE = "http://127.0.0.1:18081";
const MAX_BODY = 32 * 1024 * 1024;
const privadas = new BlockList();
for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) privadas.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [["2001::", 23], ["2002::", 16], ["3fff::", 20]] as const) privadas.addSubnet(ip, bits, "ipv6");
const global6 = new BlockList(); global6.addSubnet("2000::", 3, "ipv6");

export function direccionPublica(ip: string): boolean {
  return isIP(ip) === 4 ? !privadas.check(ip, "ipv4")
    : isIP(ip) === 6 && global6.check(ip, "ipv6") && !privadas.check(ip, "ipv6");
}

export async function destinoPublico(host: string): Promise<string> {
  const nombre = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!nombre || nombre.endsWith(".localhost") || nombre === "localhost" || nombre.endsWith(".local")) throw new Error("Destino local bloqueado");
  const direcciones = isIP(nombre) ? [{ address: nombre }] : await lookup(nombre, { all: true });
  if (!direcciones.length || direcciones.some(({ address }) => !direccionPublica(address))) throw new Error("Destino de red no público bloqueado");
  // Se conecta a esta IP, no se vuelve a resolver el nombre después de validarlo.
  return direcciones[0]!.address;
}

const PROVEEDORES: Record<string, { base: string; variables: string[]; auth?: "google" | "anthropic" }> = {
  opencode: { base: "https://opencode.ai/zen/v1", variables: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"] },
  google: { base: "https://generativelanguage.googleapis.com/v1beta", variables: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"], auth: "google" },
  groq: { base: "https://api.groq.com/openai/v1", variables: ["GROQ_API_KEY"] },
  nvidia: { base: "https://integrate.api.nvidia.com/v1", variables: ["NVIDIA_API_KEY"] },
  openrouter: { base: "https://openrouter.ai/api/v1", variables: ["OPENROUTER_API_KEY"] },
  openai: { base: "https://api.openai.com/v1", variables: ["OPENAI_API_KEY"] },
  deepseek: { base: "https://api.deepseek.com/v1", variables: ["DEEPSEEK_API_KEY"] },
  xai: { base: "https://api.x.ai/v1", variables: ["XAI_API_KEY"] },
  anthropic: { base: "https://api.anthropic.com/v1", variables: ["ANTHROPIC_API_KEY"], auth: "anthropic" },
  "cloudflare-workers-ai": { base: "", variables: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_API_TOKEN"] },
  ollama: { base: "https://ollama.com/v1", variables: ["OLLAMA_API_KEY"] },
};

function baseProveedor(proveedor: string, entorno: Record<string, string>): string | null {
  return proveedor === "cloudflare-workers-ai"
    ? endpointCloudflare(entorno.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID)
    : PROVEEDORES[proveedor]?.base ?? null;
}

function credencialOpenCode(proveedor: string): string | null {
  const home = process.env.HOME;
  if (!home) return null;
  const rutas = [join(home, ".local/share/opencode/auth.json"), ...(process.env.XDG_DATA_HOME ? [join(process.env.XDG_DATA_HOME, "opencode/auth.json")] : []), join(home, ".config/opencode/auth.json"), join(home, ".opencode/auth.json")];
  for (const ruta of rutas) {
    try {
      const stat = lstatSync(ruta);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) continue;
      const auth = JSON.parse(readFileSync(ruta, "utf8"))[proveedor];
      if (auth?.type === "api" && typeof auth.key === "string") return auth.key;
      if (auth?.type === "oauth") throw new Error("broker_oauth_no_soportado");
    } catch (error) {
      if (error instanceof Error && error.message === "broker_oauth_no_soportado") throw new Error(`La sesión OAuth de ${proveedor} necesita un broker específico; usa su integración de sesión o una API key.`);
    }
  }
  return null;
}

// El catálogo y el runner comparten la misma capacidad. OAuth de OpenCode sin broker
// específico queda fuera; la integración nativa Codex mantiene su propio flujo de sesión.
export function proveedorCompatibleConBroker(proveedor: string, extraEnv: Record<string, string> = {}): boolean {
  const especificacion = PROVEEDORES[proveedor];
  if (!especificacion || !baseProveedor(proveedor, extraEnv)) return false;
  if (especificacion.variables.some(v => extraEnv[v] || process.env[v])) return true;
  try { credencialOpenCode(proveedor); return true; }
  catch { return false; }
}

type RutaInferencia = { proveedor: string; base: URL; baseVisible: string; modelos: Set<string>; credencial: string; auth?: "google" | "anthropic" };
export type RedAgente = { directorio: string; configuracion: Record<string, unknown>; entorno: Record<string, string>; cerrar: () => Promise<void> };

function cabeceras(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && !["host", "connection", "proxy-authorization", "proxy-connection", "transfer-encoding", "content-length"].includes(key)) headers[key] = value;
  }
  return headers;
}

export async function prepararRedAgente(
  opts: { modelos: string[]; extraEnv?: Record<string, string>; brokerOpenCode: boolean },
  transporte = { resolver: destinoPublico, https: requestHttps },
): Promise<RedAgente> {
  const raiz = resolve(config.dataDir, "perfiles-red");
  mkdirSync(raiz, { recursive: true, mode: 0o700 });
  if (lstatSync(raiz).isSymbolicLink()) throw new Error("La carpeta del broker no es segura.");
  const directorio = mkdtempSync(join(raiz, "run-"));
  const rutas = new Map<string, RutaInferencia>();
  const proveedorConfig: Record<string, unknown> = {};
  const authPublica: Record<string, unknown> = {};
  const sockets = new Set<Socket>();
  const seguir = <T extends Socket>(socket: T): T => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); return socket; };
  let server: ReturnType<typeof createServer> | null = null;
  try {
    if (opts.brokerOpenCode) for (const modelo of opts.modelos) {
      const corte = modelo.indexOf("/");
      const proveedor = modelo.slice(0, corte), nombre = modelo.slice(corte + 1);
      const especificacion = PROVEEDORES[proveedor];
      if (corte < 1 || !especificacion) throw new Error(`La integración ${proveedor || modelo} aún no tiene ruta segura en el broker de Telo.`);
      let ruta = rutas.get(proveedor);
      if (!ruta) {
        const credencial = especificacion.variables.map((v) => opts.extraEnv?.[v] ?? process.env[v]).find(Boolean)
          ?? credencialOpenCode(proveedor) ?? (proveedor === "opencode" ? "public" : null);
        if (!credencial) throw new Error(`Configura la clave de ${proveedor} en Ajustes para usar su broker.`);
        const base = baseProveedor(proveedor, opts.extraEnv ?? {});
        if (!base) throw new Error("Configura un identificador de cuenta Cloudflare válido en Ajustes.");
        const urlBase = new URL(base);
        ruta = { proveedor, base: urlBase, baseVisible: proveedor === "cloudflare-workers-ai" ? "/ai/v1" : urlBase.pathname, modelos: new Set(), credencial, auth: especificacion.auth };
        rutas.set(proveedor, ruta);
        proveedorConfig[proveedor] = proveedor === "ollama"
          ? { npm: "@ai-sdk/openai-compatible", name: "Ollama Cloud", options: { baseURL: `${PUENTE}/telo-inference/${proveedor}${ruta.baseVisible}`, apiKey: "telo-broker-scoped" }, models: {} }
          : { options: { baseURL: `${PUENTE}/telo-inference/${proveedor}${ruta.baseVisible}`, apiKey: "telo-broker-scoped" } };
        authPublica[proveedor] = { type: "api", key: "telo-broker-scoped" };
      }
      ruta.modelos.add(nombre);
      if (proveedor === "ollama") {
        const definicion = proveedorConfig.ollama as { models: Record<string, { name: string }> };
        definicion.models[nombre] = { name: nombre };
      }
    }
    copyFileSync(join(import.meta.dir, "puente-red.py"), join(directorio, "bridge.py"));
    writeFileSync(join(directorio, "auth.json"), JSON.stringify(authPublica), { mode: 0o600, flag: "wx" });

    const fallo = (res: ServerResponse, code = 403) => { if (!res.headersSent) res.writeHead(code, { "content-type": "application/json" }); res.end('{"error":"Destino u operación no permitido por el broker de Telo"}'); };
    server = createServer({ maxHeaderSize: 32 * 1024 }, (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", PUENTE);
        const inferencia = /^\/telo-inference\/([a-z0-9-]+)(\/.*)$/.exec(url.pathname);
        let destino: URL, body: Buffer | undefined;
        const headers = cabeceras(req);
        if (inferencia) {
          const ruta = rutas.get(inferencia[1]!);
          if (!ruta || req.method !== "POST") { fallo(res); return; }
          const chunks: Buffer[] = []; let length = 0;
          for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) { fallo(res, 413); return; } chunks.push(Buffer.from(chunk)); }
          body = Buffer.concat(chunks);
          const path = inferencia[2]!;
          const base = ruta.baseVisible;
          const formatoGoogle = ruta.auth === "google" || (ruta.proveedor === "opencode" && path.startsWith(`${base}/models/`));
          if (formatoGoogle) {
            const model = path.startsWith(`${base}/models/`) ? path.slice(`${base}/models/`.length).split(":")[0]! : "";
            if (!ruta.modelos.has(decodeURIComponent(model)) || !/:(?:streamGenerateContent|generateContent|countTokens)$/.test(path)) { fallo(res); return; }
          } else {
            if (![`${base}/chat/completions`, `${base}/responses`, `${base}/messages`, `${base}/messages/count_tokens`].includes(path)) { fallo(res); return; }
            let model: unknown; try { model = JSON.parse(body.toString("utf8")).model; } catch { fallo(res, 400); return; }
            if (typeof model !== "string" || !ruta.modelos.has(model)) { fallo(res); return; }
          }
          destino = new URL(ruta.base.origin + ruta.base.pathname + path.slice(base.length) + url.search);
          destino.searchParams.delete("key");
          for (const name of ["authorization", "x-api-key", "x-goog-api-key", "cookie"]) delete headers[name];
          headers[formatoGoogle ? "x-goog-api-key" : ruta.auth === "anthropic" ? "x-api-key" : "authorization"] = formatoGoogle || ruta.auth === "anthropic" ? ruta.credencial : `Bearer ${ruta.credencial}`;
          headers["accept-encoding"] = "identity";
          headers["content-length"] = String(body.length);
        } else {
          if (!req.url?.startsWith("http://")) { fallo(res); return; }
          destino = new URL(req.url);
          if (destino.port && destino.port !== "80") { fallo(res); return; }
        }
        if (destino.username || destino.password || !["http:", "https:"].includes(destino.protocol)) { fallo(res); return; }
        const ip = await transporte.resolver(destino.hostname);
        headers.host = destino.host;
        const peticion = (destino.protocol === "https:" ? transporte.https : requestHttp)({ hostname: ip, servername: destino.hostname, port: destino.port || (destino.protocol === "https:" ? 443 : 80), method: req.method, path: destino.pathname + destino.search, headers, rejectUnauthorized: true }, (respuesta) => {
          if (inferencia && (respuesta.statusCode ?? 500) >= 400) {
            const chunks: Buffer[] = []; let length = 0;
            respuesta.on("data", (chunk) => { length += chunk.length; if (length <= 1024 * 1024) chunks.push(Buffer.from(chunk)); });
            respuesta.on("end", () => {
              let texto = length > 1024 * 1024 ? '{"error":"Respuesta de error demasiado grande"}' : Buffer.concat(chunks).toString("utf8");
              for (const ruta of rutas.values()) texto = texto.replaceAll(ruta.credencial, "[credencial oculta]");
              res.writeHead(respuesta.statusCode!, { "content-type": "application/json" }); res.end(texto);
            });
            return;
          }
          const salida = { ...respuesta.headers }; delete salida["set-cookie"];
          res.writeHead(respuesta.statusCode ?? 502, salida);
          respuesta.pipe(res);
        });
        peticion.on("socket", seguir);
        peticion.on("error", () => fallo(res, 502));
        // La inferencia puede razonar sin bytes; la vigilan y cancelan los runners.
        peticion.setTimeout(inferencia ? 0 : 120_000, () => peticion.destroy());
        res.on("close", () => peticion.destroy());
        if (body) peticion.end(body); else req.pipe(peticion);
      })().catch(() => fallo(res));
    });
    server.on("connection", (socket) => { if (sockets.size >= 128) socket.destroy(); else seguir(socket); });
    server.on("connect", (req, socket, head) => {
      void (async () => {
        const destino = new URL(`https://${req.url}`);
        if (destino.username || destino.password || destino.pathname !== "/" || destino.search || destino.hash || (destino.port && destino.port !== "443")) throw new Error("CONNECT inválido");
        const ip = await destinoPublico(destino.hostname);
        const remoto = seguir(connect({ host: ip, port: 443 }));
        remoto.once("connect", () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) remoto.write(head); socket.pipe(remoto); remoto.pipe(socket); });
        remoto.on("error", () => socket.destroy()); socket.on("error", () => remoto.destroy()); socket.on("close", () => remoto.destroy());
      })().catch(() => socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
    });
    const socket = join(directorio, "broker.sock");
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(socket, resolve); });
    chmodSync(socket, 0o600);
    server.unref();
    const entorno: Record<string, string> = { HTTP_PROXY: PUENTE, HTTPS_PROXY: PUENTE, ALL_PROXY: PUENTE, http_proxy: PUENTE, https_proxy: PUENTE, all_proxy: PUENTE, NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1" };
    if (opts.brokerOpenCode) for (const variable of Object.values(PROVEEDORES).flatMap((p) => p.variables)) entorno[variable] = "";
    if (opts.brokerOpenCode) entorno.CLOUDFLARE_ACCOUNT_ID = rutas.has("cloudflare-workers-ai") ? "0".repeat(32) : "";
    return {
      directorio, entorno,
      configuracion: opts.brokerOpenCode ? { enabled_providers: [...rutas.keys()], provider: proveedorConfig } : {},
      cerrar: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server!.close(() => resolve())); rmSync(directorio, { recursive: true, force: true }); },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy(); server?.close(); rmSync(directorio, { recursive: true, force: true }); throw error;
  }
}
