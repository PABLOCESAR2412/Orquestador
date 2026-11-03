import { existsSync } from "node:fs";
import { join } from "node:path";

// systemd no crea un bus de sesión gráfica. Cuando el servicio corre con lingering
// habilitado, Secret Service vive en el bus persistente del usuario del servicio.
export function entornoSecretServiceAntigravity(): Record<string, string> {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const runtime = process.env.XDG_RUNTIME_DIR || (uid === null ? null : `/run/user/${uid}`);
  const bus = process.env.DBUS_SESSION_BUS_ADDRESS || (runtime && existsSync(join(runtime, "bus"))
    ? `unix:path=${join(runtime, "bus")}`
    : null);

  return {
    ...(runtime ? { XDG_RUNTIME_DIR: runtime } : {}),
    ...(bus ? { DBUS_SESSION_BUS_ADDRESS: bus } : {}),
  };
}
