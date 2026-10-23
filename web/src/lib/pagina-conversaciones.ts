import type { Conversation, PaginaConversaciones } from "../api";

// Respuesta de GET /api/conversations?limite=: el historial paginado entrega
// { conversations, siguiente }; un servidor anterior al historial paginado ignora
// ?limite= y contesta el array plano. Mientras conviven versiones (el despliegue
// renueva la interfaz y el servidor en momentos distintos), ambas formas deben
// estar bien vistas para que el shell no rompa con «Cannot read properties of
// undefined (reading 'find')».
export function normalizaPaginaConversaciones(
  respuesta: PaginaConversaciones | Conversation[],
): PaginaConversaciones {
  if (Array.isArray(respuesta)) return { conversations: respuesta, siguiente: null };
  return respuesta;
}
