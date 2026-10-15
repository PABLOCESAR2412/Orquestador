import { api, type Conversation } from "../api";

// Un proyecto tiene un solo chat: se reutiliza el que ya existe y solo se crea si todavía no hay ninguno.
export async function chatDelProyecto(proyectoId: string): Promise<Conversation> {
  const chats = await api.listConversations();
  return chats.find((c) => c.project_id === proyectoId) ?? api.createConversation(proyectoId);
}
