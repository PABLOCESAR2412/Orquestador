import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Task, TaskStatus } from "../api";
import { useEventosVivos } from "./eventos-vivos";

// El permiso se solicita solo desde Ajustes, tras una acción explícita del usuario.
const CLAVE = "telo:notificaciones";
const CLAVE_SONIDO = "telo:sonido-notificaciones";
let contextoAudio: AudioContext | null = null;

// Avisos por estado terminal o de espera. Los demás estados no molestan.
const AVISOS: Partial<Record<TaskStatus, { titulo: string; cuerpo: string }>> = {
  done: { titulo: "Tarea terminada", cuerpo: "Lista para revisar los cambios." },
  failed: { titulo: "Tarea fallida", cuerpo: "Revisa el error antes de reintentar." },
  interrupted: { titulo: "Necesita tu decisión", cuerpo: "Se interrumpió. Reanúdala o cancélala." },
  sin_cuota: { titulo: "Se acabó la cuota", cuerpo: "Cambia de modelo y pulsa Seguir para continuar." },
  waiting_approval: { titulo: "Plan listo para aprobar", cuerpo: "Revisa el plan y decide si el obrero lo ejecuta." },
};

export function notificacionesActivas(): boolean {
  try {
    return localStorage.getItem(CLAVE) === "si";
  } catch {
    return false;
  }
}

export function guardarNotificacionesActivas(activas: boolean): void {
  try {
    localStorage.setItem(CLAVE, activas ? "si" : "no");
  } catch {
    // Sin almacenamiento disponible, la preferencia dura lo que la pestaña.
  }
}

export function sonidoNotificacionesActivo(): boolean {
  try {
    return localStorage.getItem(CLAVE_SONIDO) !== "no";
  } catch {
    return true;
  }
}

export function guardarSonidoNotificacionesActivo(activo: boolean): void {
  try {
    localStorage.setItem(CLAVE_SONIDO, activo ? "si" : "no");
  } catch {
    // Sin almacenamiento disponible, la preferencia dura lo que la pestaña.
  }
}

export function notificacionesSoportadas(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

// Pide permiso al navegador. Conviene llamarla tras un gesto del usuario (clic o tecla), o algunos navegadores la bloquean.
export async function pedirPermisoNotificaciones(): Promise<NotificationPermission | "no_soportado"> {
  if (!notificacionesSoportadas()) return "no_soportado";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function obtenerAudio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  try {
    contextoAudio ??= new AudioContext();
  } catch {
    return null;
  }
  return contextoAudio;
}

/** Desbloquea el audio en respuesta al clic explícito de Ajustes, sin reproducir sonido. */
export async function prepararSonidoNotificaciones(): Promise<boolean> {
  const audio = obtenerAudio();
  if (!audio) return false;
  try {
    if (audio.state !== "running") await audio.resume();
    return audio.state === "running";
  } catch {
    return false;
  }
}

/** Timbre corto sintetizado, sin descargar audio ni depender de archivos externos. */
export async function probarSonidoNotificaciones(): Promise<boolean> {
  const audio = obtenerAudio();
  if (!audio || !(await prepararSonidoNotificaciones())) return false;
  const ahora = audio.currentTime;
  for (const [frecuencia, demora] of [[660, 0], [880, 0.14]] as const) {
    const oscilador = audio.createOscillator();
    const volumen = audio.createGain();
    const inicio = ahora + demora;
    oscilador.type = "sine";
    oscilador.frequency.setValueAtTime(frecuencia, inicio);
    volumen.gain.setValueAtTime(0.0001, inicio);
    volumen.gain.exponentialRampToValueAtTime(0.12, inicio + 0.025);
    volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.24);
    oscilador.connect(volumen);
    volumen.connect(audio.destination);
    oscilador.start(inicio);
    oscilador.stop(inicio + 0.25);
  }
  return true;
}

// La API Notification entrega el aviso al sistema operativo incluso con Telo en primer plano.
async function mostrar(titulo: string, cuerpo: string, etiqueta: string): Promise<void> {
  if (!notificacionesActivas() || !notificacionesSoportadas() || Notification.permission !== "granted") return;
  const opciones: NotificationOptions = { body: cuerpo, tag: etiqueta, icon: "/icon.svg" };
  // En el teléfono, las notificaciones salen por el service worker de la PWA.
  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) {
      await registro.showNotification(titulo, opciones);
      return;
    }
  } catch {
    // Sin service worker disponible, se usa la API directa.
  }
  try {
    new Notification(titulo, opciones);
  } catch {
    // Algunos navegadores móviles solo muestran avisos desde el service worker.
  }
}

// Avisa cuando una tarea termina, falla o pide una decisión. Sin permiso, no hace nada.
export function useNotificacionesDeTareas(): void {
  const qc = useQueryClient();
  const avisadas = useRef(new Set<string>());

  useEventosVivos({}, (evento) => {
    if (evento.tipo !== "tarea") return;
    const aviso = AVISOS[evento.status];
    if (!aviso) return;
    // Un estado se avisa una sola vez, aunque el canal lo repita al reconectar.
    const clave = `${evento.id}:${evento.status}`;
    if (avisadas.current.has(clave)) return;
    avisadas.current.add(clave);
    const tarea = qc.getQueryData<Task[]>(["tasks"])?.find((t) => t.id === evento.id);
    void mostrar(aviso.titulo, `${tarea?.title ?? "Tarea"}. ${aviso.cuerpo}`, `tarea-${evento.id}`);
    if (sonidoNotificacionesActivo()) void probarSonidoNotificaciones();
  });
}
