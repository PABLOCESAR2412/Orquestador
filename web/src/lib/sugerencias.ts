type Mensaje = { role: string; content: string };
// Usa únicamente el historial ya cargado: no envía el borrador a otro modelo.
export function sugerenciasChat(mensajes: Mensaje[]): string[] {
  const ultimo = mensajes.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
  if (!ultimo) return [];
  const archivo = ultimo.match(/\b[\w/-]+\.(?:tsx?|jsx?|py|md|css|sql)\b/)?.[0];
  const candidatos = [
    /error|fall[oó]|fallida|no pas/i.test(ultimo)
      ? "Investiga la causa del error y propón una corrección con pruebas."
      : "Comprueba los cambios y ejecuta las pruebas relacionadas.",
    archivo
      ? `Revisa ${archivo} y explica qué falta por resolver.`
      : "Continúa con el siguiente paso pendiente del plan.",
    /prueba|verific|valid/i.test(ultimo)
      ? "Resume los resultados de las pruebas y los pendientes."
      : "Explica cómo puedo verificar el resultado.",
  ];
  return [...new Set(candidatos)];
}
