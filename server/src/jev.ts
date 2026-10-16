import { db } from "./db";
import { entornoProveedores, valorClaveJev } from "./claves-proveedor";
import { redactar } from "./redaccion";
import { valoresDeProyecto } from "./secretos";

export type UsoJev = "recomendaciones_chat" | "memoria_proyecto" | "clasificacion_tarea" | "prueba_conexion";
type PreguntaJev =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };
type RespuestaJev = { model: string; answers: Record<string, unknown> };

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODELO = "jev-latest";
const TIEMPO_MAXIMO_MS = 8_000;
export const UMBRAL_MEMORIA_JEV = 2;

export function conservarMemoriaSegunJev(puntuacion: number | null): boolean | null {
  if (puntuacion === null || !Number.isFinite(puntuacion) || puntuacion < 0 || puntuacion > 3) return null;
  return puntuacion >= UMBRAL_MEMORIA_JEV;
}

export class ErrorJev extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return !!valor && typeof valor === "object" && !Array.isArray(valor);
}

function enteroNoNegativo(valor: unknown): number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : 0;
}

function limpiarEstado(valor: unknown, secretos: string[]): unknown {
  if (typeof valor === "string") return redactar(valor, secretos);
  if (Array.isArray(valor)) return valor.map((parte) => limpiarEstado(parte, secretos));
  if (esObjeto(valor)) {
    return Object.fromEntries(Object.entries(valor).map(([clave, parte]) => [clave, limpiarEstado(parte, secretos)]));
  }
  return valor;
}

function secretosDelEntorno(): string[] {
  const sensibles = Object.entries(process.env)
    .filter(([nombre, valor]) => Boolean(valor) && /(?:API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIAL|PRIVATE_KEY)$/i.test(nombre))
    .map(([, valor]) => valor!);
  const permitidas = (process.env.TELO_AGENTE_VARIABLES ?? "")
    .split(",")
    .map((nombre) => process.env[nombre.trim()])
    .filter((valor): valor is string => Boolean(valor));
  return [...sensibles, ...permitidas];
}

export async function evaluarConJev(args: {
  tipo: UsoJev;
  estado: unknown;
  preguntas: Record<string, PreguntaJev>;
  proyectoId?: string | null;
  conversacionId?: string | null;
  tareaId?: string | null;
  signal?: AbortSignal;
}): Promise<RespuestaJev | null> {
  const clave = valorClaveJev();
  if (!clave) return null;

  const secretos = [clave, ...Object.values(entornoProveedores()), ...secretosDelEntorno()];
  if (args.proyectoId) secretos.push(...valoresDeProyecto(args.proyectoId));
  const estado = limpiarEstado(args.estado, secretos);

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TIEMPO_MAXIMO_MS);
  const propagarAborto = () => abort.abort();
  if (args.signal?.aborted) abort.abort();
  else args.signal?.addEventListener("abort", propagarAborto, { once: true });
  try {
    let respuesta: Response;
    try {
      respuesta = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELO, state: estado, questions: args.preguntas }),
        signal: abort.signal,
      });
    } catch {
      throw new ErrorJev(args.signal?.aborted ? "jev_cancelado" : abort.signal.aborted ? "jev_temporalmente_no_disponible" : "jev_sin_conexion");
    }
    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new ErrorJev("jev_clave_invalida");
      if (respuesta.status === 429 || respuesta.status === 529 || respuesta.status >= 500) {
        throw new ErrorJev("jev_temporalmente_no_disponible");
      }
      throw new ErrorJev("jev_error");
    }

    const datos: unknown = await respuesta.json().catch(() => null);
    if (!esObjeto(datos) || !esObjeto(datos.answers)) throw new ErrorJev("jev_respuesta_invalida");
    const model = typeof datos.model === "string" && datos.model.length <= 100 ? datos.model : MODELO;
    const usage = esObjeto(datos.usage) ? datos.usage : {};
    try {
      db.query(
        `INSERT INTO uso_jev (tipo, proyecto_id, conversacion_id, tarea_id, modelo, tokens_entrada, tokens_salida)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        args.tipo,
        args.proyectoId ?? null,
        args.conversacionId ?? null,
        args.tareaId ?? null,
        model,
        enteroNoNegativo(usage.input_tokens),
        enteroNoNegativo(usage.output_tokens),
      );
    } catch {
      // Un fallo de métricas no debe impedir la función auxiliar.
    }
    return { model, answers: datos.answers };
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", propagarAborto);
  }
}

export async function probarClaveJev(): Promise<boolean> {
  const respuesta = await evaluarConJev({
    tipo: "prueba_conexion",
    estado: "Prueba de conexión desde Telo.",
    preguntas: { conectada: { type: "noul", instructions: "¿Este texto es una prueba de conexión?" } },
  });
  const answer = respuesta?.answers.conectada;
  return esObjeto(answer) && answer.type === "noul" && typeof answer.noul === "number" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1;
}

export async function ordenarSugerenciasJev(args: {
  conversacionId: string;
  proyectoId: string | null;
  mensajes: { role: "user" | "assistant"; content: string }[];
  candidatas: string[];
}): Promise<string[] | null> {
  const preguntas = Object.fromEntries(args.candidatas.map((_, indice) => [`sugerencia_${indice}`, {
    type: "score" as const,
    instructions: `Puntúa la utilidad de la sugerencia ${indice + 1} para continuar esta conversación.`,
    criteria: ["Poco relacionada", "Útil", "Muy pertinente"],
  }]));
  const respuesta = await evaluarConJev({
    tipo: "recomendaciones_chat",
    proyectoId: args.proyectoId,
    conversacionId: args.conversacionId,
    estado: { mensajes: args.mensajes, sugerencias: args.candidatas },
    preguntas,
  });
  if (!respuesta) return null;
  const puntuaciones = args.candidatas.map((texto, indice) => {
    const answer = respuesta.answers[`sugerencia_${indice}`];
    const score = esObjeto(answer) && answer.type === "score" && typeof answer.score === "number" && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= 2
      ? answer.score
      : null;
    return { texto, indice, score };
  });
  if (puntuaciones.some((p) => p.score === null)) return null;
  return puntuaciones.sort((a, b) => b.score! - a.score! || a.indice - b.indice).map((p) => p.texto);
}

export async function puntuarMemoriaJev(args: {
  proyectoId: string;
  tareaId?: string;
  estado: { proyecto: string; tarea: string; memoriaAnterior: string | null; propuesta: string };
  signal?: AbortSignal;
}): Promise<number | null> {
  const respuesta = await evaluarConJev({
    tipo: "memoria_proyecto",
    proyectoId: args.proyectoId,
    tareaId: args.tareaId,
    estado: args.estado,
    preguntas: {
      relevancia: {
        type: "score",
        instructions: "Puntúa cuánto aporta esta propuesta como memoria estable y reutilizable para futuras tareas de este proyecto.",
        criteria: [
          "No aporta información reutilizable.",
          "Es temporal, incierta o poco relacionada con el proyecto.",
          "Contiene datos estables y útiles para futuras tareas.",
          "Contiene una convención o dato duradero clave para trabajar en el proyecto.",
        ],
      },
    },
    signal: args.signal,
  });
  if (!respuesta) return null;
  const score = respuesta.answers.relevancia;
  return esObjeto(score) && score.type === "score" && typeof score.score === "number" && Number.isFinite(score.score) && score.score >= 0 && score.score <= 3
    ? score.score
    : null;
}

export async function clasificarTareaJev(args: {
  prompt: string;
  proyectoId: string | null;
  tareaId: string;
  signal?: AbortSignal;
}): Promise<{ categoria: string; confianza: number } | null> {
  const categorias: Record<string, string> = {
    correccion: "Corregir un error o comportamiento roto.",
    funcion: "Añadir o ampliar una capacidad del producto.",
    interfaz: "Cambiar diseño, accesibilidad o interacción de la interfaz.",
    documentacion: "Crear o actualizar documentación.",
    investigacion: "Investigar, revisar o explicar sin modificar código como objetivo principal.",
    mantenimiento: "Actualizar dependencias, limpiar o mejorar estructura y rendimiento.",
    operaciones: "Configurar despliegues, infraestructura, Git o servicios externos.",
  };
  const respuesta = await evaluarConJev({
    tipo: "clasificacion_tarea",
    proyectoId: args.proyectoId,
    tareaId: args.tareaId,
    estado: { tarea: args.prompt.slice(0, 10_000) },
    preguntas: {
      categoria: {
        type: "choice",
        instructions: "Elige la categoría que mejor describe el objetivo principal de la tarea.",
        criteria: categorias,
      },
    },
    signal: args.signal,
  });
  if (!respuesta) return null;
  const answer = respuesta.answers.categoria;
  if (!esObjeto(answer) || answer.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(categorias, answer.choice)) return null;
  const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
    ? Math.max(0, Math.min(1, answer.confidence))
    : 0;
  return { categoria: answer.choice, confianza: confidence };
}
