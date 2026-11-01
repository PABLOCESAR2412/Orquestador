// La CLI JSON solo publica herramientas terminadas. Este plugin local recoge los estados
// que faltan, sin copiar texto parcial ni razonamiento y sin hacer peticiones al proveedor.
import { comandoConRtk } from "../rtk";

export function pluginSeguimientoOpenCode(salida: string, sesion: string | null, rtk: string | null = null): string {
  return `import { appendFileSync } from "node:fs";
const salida = ${JSON.stringify(salida)};
const rtk = ${JSON.stringify(rtk)};
const comandoConRtk = ${comandoConRtk.toString()};
let raiz = ${JSON.stringify(sesion)};
let eventos = 0, bytes = 0, actividad = 0, ultimaEmision = 0;
const herramientas = new Set();
const emitir = (dato) => {
  if (eventos >= 5000) return;
  try {
    const linea = JSON.stringify(dato) + "\\n";
    const longitud = Buffer.byteLength(linea);
    if (longitud > 32768 || bytes + longitud > 8 * 1024 * 1024) return;
    appendFileSync(salida, linea);
    eventos++; bytes += longitud;
  } catch {}
};
const estado = (status, extra = {}) => emitir({ type: "telo.provider", sessionID: raiz, status, actividad, ...extra });
export const TeloSeguimiento = async () => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "bash" && typeof output.args?.command === "string") {
      output.args.command = comandoConRtk(output.args.command, rtk);
    }
  },
  event: async ({ event }) => {
    if (eventos >= 5000) return;
    const props = event?.properties || {};
    if (event?.type === "session.created" && !props.info?.parentID && !raiz) raiz = props.info?.id;
    if (!raiz && event?.type === "session.status" && props.status?.type === "busy") raiz = props.sessionID;
    const parte = props.part;
    const id = props.sessionID || parte?.sessionID;
    if (!raiz || id !== raiz) return;
    if (event.type === "session.status") {
      const s = props.status;
      if (s?.type === "retry") estado("retry", { attempt: s.attempt, next: s.next, message: String(s.message || "Error temporal").slice(0, 1000) });
      else if (s?.type === "busy" || s?.type === "idle") estado(s.type);
    }
    if (event.type === "message.part.delta" && typeof props.delta === "string" && props.delta.length) {
      // Solo se registra que llegaron bytes: el contenido, incluido el razonamiento, no sale del motor.
      actividad++;
      const ahora = Date.now();
      if (ahora - ultimaEmision >= 10000) { ultimaEmision = ahora; estado("generating"); }
    }
    if (event.type === "message.part.updated" && parte?.type === "tool" && parte.state?.status === "running" && !herramientas.has(parte.callID)) {
      herramientas.add(parte.callID);
      const input = Object.fromEntries(Object.entries(parte.state.input || {})
        .filter(([clave, valor]) => ["filePath", "path", "command", "description", "pattern", "query", "url", "subagent_type"].includes(clave) && typeof valor === "string")
        .map(([clave, valor]) => [clave, valor.slice(0, 1200)]));
      emitir({ type: "tool_use", sessionID: raiz, part: { type: "tool", tool: parte.tool, callID: parte.callID, state: { status: "running", input } } });
    }
  },
});
`;
}
