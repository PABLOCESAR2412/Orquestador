import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { redactar } from "./redaccion";
import { valoresDeProyecto } from "./secretos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPE_SALIDA_LOG = 5 * 1024 * 1024;
const VENTANA_SALIDA = 512 * 1024;
const AVISO_LLENO =
  "[Telo] Registro lleno: a partir de aquí no se guarda más salida (tope de 5 MB).";

function carpetaTarea(taskId: string): string {
  if (!UUID.test(taskId)) throw new Error("task_not_found");
  return join(resolve(config.dataDir), "tasks", taskId);
}

function valoresDe(projectId: string | null): string[] {
  return projectId ? valoresDeProyecto(projectId) : [];
}

// Registro de la salida del agente: DATA_DIR/tasks/<id>/salida.log, con tope de 5 MB.
export type RegistroSalida = { linea: (texto: string) => void; cerrar: () => void };

export function abrirRegistroSalida(taskId: string): RegistroSalida {
  const carpeta = carpetaTarea(taskId);
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, "salida.log");

  // En una tarea sin repo el agente escribe en esta misma carpeta: un enlace no debe redirigir el registro.
  try {
    if (!lstatSync(ruta).isFile()) rmSync(ruta, { recursive: true, force: true });
  } catch {
    // no existe todavía
  }

  let fd: number | null = null;
  try {
    fd = openSync(
      ruta,
      fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    fd = null;
  }
  let tamano = fd !== null ? statSync(ruta).size : 0;
  let lleno = tamano >= TOPE_SALIDA_LOG;
  const codificador = new TextEncoder();

  return {
    linea(texto: string) {
      if (fd === null || lleno) return;
      const bytes = codificador.encode(texto + "\n").length;
      try {
        if (tamano + bytes > TOPE_SALIDA_LOG) {
          lleno = true;
          writeSync(fd, AVISO_LLENO + "\n");
          return;
        }
        writeSync(fd, texto + "\n");
        tamano += bytes;
      } catch {
        lleno = true;
      }
    },
    cerrar() {
      if (fd === null) return;
      try {
        closeSync(fd);
      } catch {
        // ya cerrado
      }
      fd = null;
    },
  };
}

// Últimas 512 KB del registro. Si se recortó, la primera línea parcial se descarta.
export async function leerSalida(taskId: string): Promise<{ texto: string; truncado: boolean }> {
  const ruta = join(carpetaTarea(taskId), "salida.log");
  try {
    if (!lstatSync(ruta).isFile()) return { texto: "", truncado: false };
  } catch {
    return { texto: "", truncado: false };
  }
  const archivo = Bun.file(ruta);
  const total = archivo.size;
  const inicio = Math.max(0, total - VENTANA_SALIDA);
  let texto = await archivo.slice(inicio, total).text();
  const truncado = inicio > 0;
  if (truncado) {
    const corte = texto.indexOf("\n");
    if (corte >= 0) texto = texto.slice(corte + 1);
  }
  // La salida pasa por la redacción también al leerla: cubre lo que se guardó antes de ampliar las reglas.
  const fila = db
    .query<{ project_id: string | null }, [string]>("SELECT project_id FROM tasks WHERE id = ?")
    .get(taskId);
  return { texto: redactar(texto, valoresDe(fila?.project_id ?? null)), truncado };
}
