import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as esperar } from "node:timers/promises";
import { hallarEjecutable, matarGrupo } from "./ejecutable";
import { carpetaHome } from "./hogar";

export type ResultadoApiOpenCodeLocal =
  | { ok: true; datos: unknown }
  | { ok: false; motivo: "sin_cli" | "proceso" | "http" | "tiempo"; status?: number };

async function puertoDisponible(): Promise<number> {
  const servidor = createServer();
  return await new Promise<number>((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      const direccion = servidor.address();
      if (!direccion || typeof direccion === "string") {
        servidor.close();
        reject(new Error("No se pudo reservar un puerto loopback."));
        return;
      }
      servidor.close((error) => error ? reject(error) : resolve(direccion.port));
    });
  });
}

// Consulta una ruta local de OpenCode sin publicar el servicio ni mostrar credenciales.
export async function consultarApiOpenCodeLocal(
  ruta: string,
  opciones: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<ResultadoApiOpenCodeLocal> {
  const cli = hallarEjecutable("opencode");
  if (!cli) return { ok: false, motivo: "sin_cli" };

  let proceso: Bun.Subprocess<"ignore", "ignore", "ignore"> | null = null;
  try {
    const port = await puertoDisponible();
    const password = randomBytes(32).toString("base64url");
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: carpetaHome(),
      ...(process.env.XDG_DATA_HOME ? { XDG_DATA_HOME: process.env.XDG_DATA_HOME } : {}),
      ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
      ...(process.env.OPENCODE_CONFIG_DIR ? { OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR } : {}),
      ...(process.env.OPENCODE_API_KEY ? { OPENCODE_API_KEY: process.env.OPENCODE_API_KEY } : {}),
      ...opciones.env,
    };
    env.PATH = opciones.env?.PATH ?? process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
    env.HOME = carpetaHome();
    env.OPENCODE_SERVER_USERNAME = "opencode";
    env.OPENCODE_SERVER_PASSWORD = password;
    env.NO_COLOR = "1";

    const comando = [cli, "serve", "--hostname", "127.0.0.1", "--port", String(port)];
    const setsid = hallarEjecutable("setsid");
    proceso = Bun.spawn(setsid ? [setsid, ...comando] : comando, {
      cwd: carpetaHome(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env,
    }) as Bun.Subprocess<"ignore", "ignore", "ignore">;

    const url = `http://127.0.0.1:${port}${ruta}`;
    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const limite = Date.now() + (opciones.timeoutMs ?? 12_000);
    let ultimoStatus: number | undefined;

    while (Date.now() < limite) {
      if (proceso.exitCode !== null) return { ok: false, motivo: "proceso" };
      try {
        const respuesta = await fetch(url, {
          headers: { Authorization: authorization, Accept: "application/json" },
          signal: AbortSignal.timeout(1_000),
        });
        if (respuesta.status === 200) return { ok: true, datos: await respuesta.json() };
        ultimoStatus = respuesta.status;
        if ([401, 403, 404].includes(respuesta.status)) return { ok: false, motivo: "http", status: respuesta.status };
      } catch {
        // La primera conexión puede llegar antes de que OpenCode abra el puerto loopback.
      }
      await esperar(120);
    }
    return { ok: false, motivo: "tiempo", ...(ultimoStatus ? { status: ultimoStatus } : {}) };
  } catch {
    return { ok: false, motivo: "proceso" };
  } finally {
    if (proceso) {
      try {
        if (hallarEjecutable("setsid")) matarGrupo(proceso);
        else proceso.kill(9);
      } catch { /* El servidor pudo terminar por su cuenta. */ }
      await proceso.exited.catch(() => {});
    }
  }
}
