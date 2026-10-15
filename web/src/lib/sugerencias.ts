type Mensaje = { role: string; content: string };

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

// Usa el último intercambio ya cargado: la sugerencia no manda el borrador a otro modelo.
export function sugerenciasChat(mensajes: Mensaje[]): string[] {
  const intercambio = mensajes.filter((m) => m.role === "user" || m.role === "assistant").slice(-6);
  const ultimoAsistente = [...intercambio].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const ultimoUsuario = [...intercambio].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!ultimoAsistente || !ultimoUsuario) return [];

  const respuesta = normalizar(ultimoAsistente);
  const contexto = normalizar(intercambio.map((m) => m.content).join("\n"));
  const archivo = [...intercambio]
    .reverse()
    .flatMap((m) => m.content.match(/\b[\w./-]+\.(?:tsx?|jsx?|py|md|css|sql|json)\b/g) ?? [])[0];
  let principal: string;
  if (/error|fallo|fallida|no paso|failed|exception/.test(respuesta)) {
    principal = archivo
      ? `Corrige el fallo en ${archivo} y confirma la solución con una prueba.`
      : "Investiga el fallo de la respuesta y confirma la corrección con una prueba.";
  } else if (/github|\bgit\b|commit|push|pull request|\bpr\b|rama/.test(contexto)) {
    principal = "Revisa el diff, la rama y el estado de GitHub antes de continuar.";
  } else if (/prueba|test|typecheck|lint|build|verific/.test(contexto)) {
    principal = archivo
      ? `Ejecuta las pruebas relacionadas con ${archivo} y resume el resultado.`
      : "Ejecuta las comprobaciones relacionadas con este cambio y resume el resultado.";
  } else if (/interfaz|diseno|css|componente|pantalla|responsive|movil/.test(contexto)) {
    principal = "Comprueba esta interfaz en móvil y escritorio y ajusta lo que aún no encaje.";
  } else if (archivo) {
    principal = `Revisa ${archivo} y comprueba que el cambio cubre lo que pedí.`;
  } else if (/\?|como |por que |que significa|explica/.test(normalizar(ultimoUsuario))) {
    principal = "Aclara el punto principal de la respuesta con un ejemplo aplicado a este chat.";
  } else {
    principal = "Comprueba el resultado y señala qué queda pendiente en este chat.";
  }

  const siguientes = archivo
    ? [`Resume los cambios en ${archivo} y cómo probarlos.`, "Comprueba si queda algún pendiente de esta petición."]
    : [
        "Resume qué cambió y cómo puedo verificarlo.",
        "Comprueba si queda algún pendiente de esta petición.",
      ];
  return [...new Set([principal, ...siguientes])];
}
