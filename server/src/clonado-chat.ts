import { db } from "./db";
import { describirAccion, registrarActividad, type ItemActividad } from "./actividad";
import {
  ErrorClonado,
  carpetaDisponible,
  clonadoEnCurso,
  clonarRepositorio,
  urlGithubNormalizada,
  type ComandoClonado,
  type ResultadoClonado,
} from "./clonado";
import {
  conversacionEnCurso,
  liberarConversacion,
  ocuparConversacion,
  proyectoOcupado,
  proyectoRevisandose,
} from "./ocupacion";

// El clonado de un proyecto ocurre en su chat: el mensaje del usuario es la instrucción, cada comando
// aparece como paso del agente mientras corre, y el último mensaje dice cómo quedó. Así el chat
// muestra qué se ejecutó, igual que cualquier otro turno.

type ProyectoClon = {
  id: string;
  name: string;
  repo_path: string;
  origen_url: string | null;
  clonado_en: string | null;
};

export type ClonadoIniciado = { conversacion_id: string; turno_id: string };

// Motivos en español para el último mensaje. Los códigos vienen de clonado.ts.
const MOTIVOS: Record<string, string> = {
  url_no_valida: "La dirección no es un repositorio de GitHub.",
  clave_no_encontrada:
    "Parece privado y este proyecto todavía no tiene clave de GitHub. Créala en la sección Clave de GitHub, agrégala al repositorio y vuelve a intentarlo.",
  clave_no_autorizada:
    "GitHub no acepta la clave de este proyecto. Agrégala al repositorio (Settings → Deploy keys) y vuelve a intentarlo.",
  repo_no_encontrado: "GitHub no encuentra ese repositorio, o la clave no tiene acceso a él.",
  host_no_verificado: "La identidad de GitHub no coincide con la que Telo tiene fijada. No se clonó nada.",
  sin_red_github: "El servidor no llega a GitHub. Revisa su conexión e intenta de nuevo.",
  verificacion_fallo: "No pude revisar el repositorio. Intenta de nuevo.",
  clonado_fallo: "Git no pudo clonarlo. Intenta de nuevo.",
  clave_sin_cifrado: "El servidor no tiene configurada la clave de cifrado, así que no puedo usar la clave del proyecto.",
  clave_ilegible: "La clave de este proyecto no se puede leer. Bórrala y crea otra.",
  carpeta_no_vacia: "La carpeta del proyecto ya tiene archivos.",
};

// Un paso del proceso: el comando tal cual, con su salida. Así se ve lo que se ejecutó.
export function itemDeComando(comando: ComandoClonado): ItemActividad {
  const ok = comando.codigo === 0;
  const { titulo, detalle } = describirAccion(
    "bash",
    { command: comando.comando },
    ok ? comando.salida : null,
    ok ? null : comando.salida || "El comando falló",
  );
  return { tipo: "accion", herramienta: "bash", titulo, detalle, estado: ok ? "hecha" : "error" };
}

export function textoDeExito(resultado: ResultadoClonado, repo: string): string {
  const rama = resultado.rama ? `, en la rama ${resultado.rama}` : "";
  const commit = resultado.ultimo_commit ? ` Último commit: ${resultado.ultimo_commit}.` : "";
  const via =
    resultado.visibilidad === "publico"
      ? "Es público, así que lo clonó por HTTPS sin clave."
      : "Es privado, así que lo clonó con la clave SSH del proyecto.";
  return `Listo. ${repo} está clonado en la carpeta del proyecto${rama}.${commit} ${via}\n\nYa puedes pedirme cambios o abrir una tarea sobre este código.`;
}

export function textoDeError(err: unknown): string {
  const codigo = err instanceof ErrorClonado ? err.code : "clonado_fallo";
  return `No pude clonar el repositorio. ${MOTIVOS[codigo] ?? MOTIVOS.clonado_fallo}`;
}

// Chat del proyecto: el mismo que abre «Abrir chat» (el más reciente).
function chatDelProyecto(projectId: string): string | null {
  const fila = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM conversations WHERE project_id = ? ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC, rowid DESC LIMIT 1",
    )
    .get(projectId);
  return fila?.id ?? null;
}

// Empieza el clonado en el chat del proyecto y responde enseguida: el trabajo sigue en segundo plano.
// Las comprobaciones que fallan antes de empezar se devuelven como ErrorClonado; nada queda a medias.
export function iniciarClonadoEnChat(projectId: string): ClonadoIniciado {
  const proyecto = db
    .query<ProyectoClon, [string]>(
      "SELECT id, name, repo_path, origen_url, clonado_en FROM projects WHERE id = ?",
    )
    .get(projectId);
  if (!proyecto) throw new ErrorClonado("project_not_found", 404);
  if (!proyecto.origen_url) throw new ErrorClonado("project_sin_origen", 400);
  if (proyecto.clonado_en) throw new ErrorClonado("project_ya_clonado", 409);
  if (clonadoEnCurso(projectId)) throw new ErrorClonado("clonado_en_curso", 409);
  if (proyectoOcupado(projectId) || proyectoRevisandose(projectId)) throw new ErrorClonado("proyecto_ocupado", 409);
  if (!carpetaDisponible(proyecto.repo_path)) throw new ErrorClonado("carpeta_no_vacia", 409);

  const repo = urlGithubNormalizada(proyecto.origen_url)?.repo ?? proyecto.name;
  const existente = chatDelProyecto(projectId);
  if (existente && conversacionEnCurso(existente)) throw new ErrorClonado("conversation_busy", 409);

  const conversacionId = existente ?? crypto.randomUUID();
  const turnoId = crypto.randomUUID();
  db.transaction(() => {
    if (!existente) {
      db.query("INSERT INTO conversations (id, title, project_id) VALUES (?, ?, ?)").run(
        conversacionId,
        `Clonar ${repo}`,
        projectId,
      );
    }
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)").run(
      turnoId,
      conversacionId,
      `Clonar el repositorio ${proyecto.origen_url}`,
    );
  })();

  // Ocupar antes de responder: otro chat o una tarea no puede empezar en esta carpeta mientras tanto.
  ocuparConversacion(conversacionId);
  void ejecutarClonado(proyecto, repo, conversacionId, turnoId).catch(() => undefined);
  return { conversacion_id: conversacionId, turno_id: turnoId };
}

async function ejecutarClonado(
  proyecto: ProyectoClon,
  repo: string,
  conversacionId: string,
  turnoId: string,
): Promise<void> {
  let texto: string;
  try {
    const resultado = await clonarRepositorio(proyecto.id, proyecto.repo_path, proyecto.origen_url ?? "", (comando) => {
      registrarActividad(conversacionId, turnoId, itemDeComando(comando));
    });
    texto = textoDeExito(resultado, repo);
  } catch (err) {
    texto = textoDeError(err);
  }
  try {
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)").run(
      crypto.randomUUID(),
      conversacionId,
      texto,
    );
  } finally {
    liberarConversacion(conversacionId);
  }
}
