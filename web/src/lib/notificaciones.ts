import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Task, TaskStatus } from "../api";
import { useEventosVivos } from "./eventos-vivos";

// Notificaciones del sistema. Vienen activadas por defecto en cada navegador; el usuario las apaga en Ajustes.
// Llegan por el canal en vivo, así que solo avisan mientras Telo está abierta (en la PWA, aunque esté en segundo plano).
const CLAVE = "telo:notificaciones";

// Avisos por estado terminal o de espera. Los demás estados no molestan.
const AVISOS: Partial<Record<TaskStatus, { titulo: string; cuerpo: string }>> = {
  done: { titulo: "Tarea terminada", cuerpo: "Lista para revisar los cambios." },
  failed: { titulo: "Tarea fallida", cuerpo: "Revisa el error antes de reintentar." },
  interrupted: { titulo: "Necesita tu decisión", cuerpo: "Se interrumpió. Reanúdala o cancélala." },
};

export function notificacionesActivas(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== "no";
  } catch {
    return true;
  }
}

export function guardarNotificacionesActivas(activas: boolean): void {
  try {
    localStorage.setItem(CLAVE, activas ? "si" : "no");
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

// Muestra el aviso si el usuario lo quiere, el navegador lo permite y Telo no está a la vista.
async function mostrar(titulo: string, cuerpo: string, etiqueta: string): Promise<void> {
  if (!notificacionesActivas() || !notificacionesSoportadas() || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
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

  // Primer gesto del usuario: pide el permiso del navegador si todavía no se decidió.
  useEffect(() => {
    const pedir = () => {
      if (notificacionesActivas()) void pedirPermisoNotificaciones();
    };
    window.addEventListener("pointerdown", pedir);
    window.addEventListener("keydown", pedir);
    return () => {
      window.removeEventListener("pointerdown", pedir);
      window.removeEventListener("keydown", pedir);
    };
  }, []);

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
  });
}
