import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Task, TaskStatus } from "../api";
import { useEventosVivos } from "./eventos-vivos";

// El permiso se solicita solo desde Ajustes, tras una acción explícita del usuario.
const CLAVE = "telo:notificaciones";
const CLAVE_SONIDO = "telo:sonido-notificaciones";
const CLAVE_TIPO_SONIDO = "telo:sonido-notificacion-tipo";
let contextoAudio: AudioContext | null = null;
export const sonidoGestionadoPorAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export const SONIDOS_NOTIFICACION = [
  { id: "telo", nombre: "Telo" },
  { id: "campana", nombre: "Campana" },
  { id: "doble", nombre: "Doble" },
  { id: "ascendente", nombre: "Ascendente" },
  { id: "suave", nombre: "Suave" },
] as const;
export type SonidoNotificacion = (typeof SONIDOS_NOTIFICACION)[number]["id"];

const TONOS: Record<SonidoNotificacion, { tipo: OscillatorType; notas: readonly [number, number, number][] }> = {
  telo: { tipo: "sine", notas: [[660, 0, 0.24], [880, 0.14, 0.24]] },
  campana: { tipo: "sine", notas: [[1046, 0, 0.42]] },
  doble: { tipo: "triangle", notas: [[784, 0, 0.16], [784, 0.22, 0.16], [1046, 0.46, 0.25]] },
  ascendente: { tipo: "sine", notas: [[523, 0, 0.14], [659, 0.16, 0.14], [784, 0.32, 0.14], [1046, 0.48, 0.25]] },
  suave: { tipo: "triangle", notas: [[587, 0, 0.34], [740, 0.2, 0.34]] },
};

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

export function sonidoNotificacionSeleccionado(): SonidoNotificacion {
  try {
    const id = localStorage.getItem(CLAVE_TIPO_SONIDO);
    return SONIDOS_NOTIFICACION.find((sonido) => sonido.id === id)?.id ?? "telo";
  } catch {
    return "telo";
  }
}

export function guardarSonidoNotificacionSeleccionado(id: SonidoNotificacion): void {
  try {
    localStorage.setItem(CLAVE_TIPO_SONIDO, id);
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

/** Sonido corto sintetizado, sin descargar audio ni depender de archivos externos. */
export async function probarSonidoNotificaciones(id = sonidoNotificacionSeleccionado()): Promise<boolean> {
  if (sonidoGestionadoPorAndroid()) return false;
  const audio = obtenerAudio();
  if (!audio || !(await prepararSonidoNotificaciones())) return false;
  const ahora = audio.currentTime;
  const sonido = TONOS[id] ?? TONOS.telo;
  for (const [frecuencia, demora, duracion] of sonido.notas) {
    const oscilador = audio.createOscillator();
    const volumen = audio.createGain();
    const inicio = ahora + demora;
    oscilador.type = sonido.tipo;
    oscilador.frequency.setValueAtTime(frecuencia, inicio);
    volumen.gain.setValueAtTime(0.0001, inicio);
    volumen.gain.exponentialRampToValueAtTime(0.1, inicio + 0.025);
    volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    oscilador.connect(volumen);
    volumen.connect(audio.destination);
    oscilador.start(inicio);
    oscilador.stop(inicio + duracion + 0.01);
  }
  return true;
}

// La API Notification entrega el aviso al sistema operativo incluso con Telo en primer plano.
async function mostrar(titulo: string, cuerpo: string, etiqueta: string, conversationId?: string): Promise<void> {
  if (!notificacionesActivas() || !notificacionesSoportadas() || Notification.permission !== "granted") return;
  const url = conversationId ? `/chat?conversacion=${encodeURIComponent(conversationId)}` : "/tareas";
  const opciones: NotificationOptions = { body: cuerpo, tag: etiqueta, icon: "/notification-icon.png", badge: "/notification-badge.png", silent: !sonidoGestionadoPorAndroid() || !sonidoNotificacionesActivo(), data: { url } };
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
    const aviso = new Notification(titulo, opciones);
    aviso.onclick = () => { window.focus(); window.location.assign(url); aviso.close(); };
  } catch {
    // Algunos navegadores móviles solo muestran avisos desde el service worker.
  }
}

// Avisa cuando una tarea termina, falla o pide una decisión. Sin permiso, no hace nada.
export function useNotificacionesDeTareas(): void {
  const qc = useQueryClient();
  const avisadas = useRef(new Set<string>());
  const anteriores = useRef(new Map<string, string>());
  const chats = useQuery({ queryKey: ["conversations"], queryFn: api.listConversations, refetchInterval: 5000 });
  const git = useQuery({ queryKey: ["avisos-git"], queryFn: api.avisosGit, refetchInterval: 5000 });
  useEffect(() => {
    const emitir = (id: string, estado: string, titulo: string, cuerpo: string, chatId: string) => {
      const previo = anteriores.current.get(id);
      anteriores.current.set(id, estado);
      if ((previo === undefined && !anteriores.current.has(id.startsWith("git-") ? "__git" : "__chats")) || previo === estado || !estado) return;
      void mostrar(titulo, cuerpo, id, chatId);
      if (notificacionesActivas() && sonidoNotificacionesActivo()) void probarSonidoNotificaciones();
    };
    for (const chat of chats.data ?? []) emitir(`chat-${chat.id}`, chat.requiere_continuar || chat.ultimo_rol === "system" ? `atencion-${chat.last_message_at}` : "", "Telo necesita tu acción", `${chat.title}. Revisa el error o continúa donde quedó.`, chat.id);
    for (const accion of git.data ?? []) emitir(`git-${accion.id}`, accion.state, accion.state === "pending" ? "Acción Git pendiente" : accion.state === "failed" ? "La acción Git falló" : "Acción Git completada", `${accion.action}. Abre el chat para revisar el resultado.`, accion.conversation_id);
    if (chats.data) anteriores.current.set("__chats", "1");
    if (git.data) anteriores.current.set("__git", "1");
  }, [chats.data, git.data]);

  useEventosVivos({}, (evento) => {
    if (evento.tipo !== "tarea") return;
    const aviso = AVISOS[evento.status];
    if (!aviso) return;
    // Un estado se avisa una sola vez, aunque el canal lo repita al reconectar.
    const clave = `${evento.id}:${evento.status}`;
    if (avisadas.current.has(clave)) return;
    avisadas.current.add(clave);
    if (!notificacionesActivas()) return;
    const tarea = qc.getQueryData<Task[]>(["tasks"])?.find((t) => t.id === evento.id);
    void mostrar(aviso.titulo, `${tarea?.title ?? "Tarea"}. ${aviso.cuerpo}`, `tarea-${evento.id}`, tarea?.conversation_id ?? undefined);
    if (sonidoNotificacionesActivo()) void probarSonidoNotificaciones();
  });
}
