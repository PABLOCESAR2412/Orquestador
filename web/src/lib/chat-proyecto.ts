import { api, type Conversation } from "../api";

// Obtiene el último chat del proyecto o crea uno si no existe todavía.
export async function chatDelProyecto(proyectoId: string): Promise<Conversation> {
  const chats = await api.listConversations();
  const proyectoChats = chats.filter((c) => c.project_id === proyectoId);
  return proyectoChats[0] ?? api.createConversation(proyectoId);
}

// Crea un nuevo chat independiente dentro del contexto del proyecto.
export async function nuevoChatDelProyecto(proyectoId: string, title?: string): Promise<Conversation> {
  return api.createConversation(proyectoId, title);
}

// Lista todas las conversaciones que pertenecen a este proyecto.
export async function chatsDelProyecto(proyectoId: string): Promise<Conversation[]> {
  const chats = await api.listConversations();
  return chats.filter((c) => c.project_id === proyectoId);
}
