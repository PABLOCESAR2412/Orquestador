// Protecciones que comparten los runners de agente (OpenCode y Codex): el vigilante de
// inactividad corta un proceso que lleva minutos sin emitir nada, y la lectura con tope
// evita que la salida del agente crezca en RAM sin límite.
import { actividadDelGrupo } from "./actividad-grupo";

const DESCANSO_VIGILANTE_MS = 15_000;
const MINIMO_VIGILANTE_MS = 10_000;

export type VigilanteActividad = {
  // El reloj se reinicia con cada línea que emite el agente.
  patada: () => void;
  // Se deja de mirar cuando el proceso terminó.
  detener: () => void;
  // ¿Se cerró el proceso por falta de actividad?
  silenciado: () => boolean;
};

export function iniciarVigilante(opciones: {
  pid: number | undefined;
  tiempoSinActividadMs?: number | null;
  cortar: () => void;
}): VigilanteActividad {
  const { pid, cortar } = opciones;
  const tope = opciones.tiempoSinActividadMs ?? 0;
  let ultimaActividad = Date.now();
  let muertoPorSilencio = false;
  let actividadAnterior = actividadDelGrupo(pid ?? -1);
  const reloj =
    tope > MINIMO_VIGILANTE_MS
      ? setInterval(() => {
          const actividad = actividadDelGrupo(pid ?? -1);
          if (actividad !== null && actividad !== actividadAnterior) ultimaActividad = Date.now();
          actividadAnterior = actividad;
          if (Date.now() - ultimaActividad < tope) return;
          muertoPorSilencio = true;
          cortar();
        }, DESCANSO_VIGILANTE_MS)
      : null;
  return {
    patada: () => {
      ultimaActividad = Date.now();
    },
    detener: () => {
      if (reloj) clearInterval(reloj);
    },
    silenciado: () => muertoPorSilencio,
  };
}

// Lee un flujo de bytes completo y lo devuelve como texto con tope: si pasa el tope conserva
// el arranque y la cola con un marcador en medio (en el arranque viven eventos de sesión y en
// la cola el detalle del fallo; el medio es la paja de trabajo del agente).
export async function leerConTope(flujo: ReadableStream<Uint8Array>, tope: number, signal?: AbortSignal): Promise<string> {
  const lector = flujo.getReader();
  const cancelar = () => { void lector.cancel().catch(() => {}); };
  if (signal?.aborted) cancelar();
  else signal?.addEventListener("abort", cancelar, { once: true });
  const decodificador = new TextDecoder();
  let todo = "";
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      todo += decodificador.decode(value, { stream: true });
      if (todo.length > tope) {
        const cola = Math.floor(tope * 0.95);
        const cabeza = Math.max(0, tope - cola);
        todo = `${todo.slice(0, cabeza)}\n[… salida recortada para no crecer en RAM — se conserva arranque y cola …]\n${todo.slice(-cola)}`;
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelar);
    lector.releaseLock();
  }
  return `${todo}${decodificador.decode()}`;
}

// El límite se comprueba antes de concatenar o publicar: una línea NDJSON hostil nunca
// llega a JSON.parse ni al canal de actividad. El siguiente evento válido sigue disponible.
export async function leerLineasAcotadas(
  flujo: ReadableStream<Uint8Array>,
  tope: number,
  alLeer: (linea: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const lector = flujo.getReader();
  const cancelar = () => { void lector.cancel().catch(() => {}); };
  if (signal?.aborted) cancelar();
  else signal?.addEventListener("abort", cancelar, { once: true });
  const decoder = new TextDecoder();
  let pendiente = "";
  let excedida = false;
  const consumir = (trozo: string) => {
    let inicio = 0;
    while (inicio < trozo.length) {
      const fin = trozo.indexOf("\n", inicio);
      const fragmento = trozo.slice(inicio, fin < 0 ? undefined : fin);
      if (!excedida && pendiente.length + fragmento.length > tope) {
        pendiente = "";
        excedida = true;
      }
      if (!excedida) pendiente += fragmento;
      if (fin < 0) break;
      if (!excedida && pendiente.trim()) alLeer(pendiente.trim());
      pendiente = "";
      excedida = false;
      inicio = fin + 1;
    }
  };
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      consumir(decoder.decode(value, { stream: true }));
    }
    consumir(decoder.decode());
    if (!excedida && pendiente.trim()) alLeer(pendiente.trim());
  } finally {
    signal?.removeEventListener("abort", cancelar);
    lector.releaseLock();
  }
}
