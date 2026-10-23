import type { Message, PaginaMensajes } from "../api";

export const LIMITE_MENSAJES_RESIDENTES = 120;

export function actualizarVentanaMensajes(previos: Message[], pagina: PaginaMensajes): Message[] {
  const vigentes = new Map(pagina.vigentes.map((mensaje) => [mensaje.id, mensaje.sesion_compactada]));
  const anteriores = previos.filter((mensaje) => vigentes.has(mensaje.id)).map((mensaje) => ({
    ...mensaje,
    sesion_compactada: vigentes.get(mensaje.id) ?? 0,
  }));
  const ids = new Set(pagina.messages.map((mensaje) => mensaje.id));
  return [...anteriores.filter((mensaje) => !ids.has(mensaje.id)), ...pagina.messages].slice(-LIMITE_MENSAJES_RESIDENTES);
}
