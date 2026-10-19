import {
  closeSync,
  constants as fc,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { carpetaHome } from "./hogar";
import { redactar, valoresDeConfiguracion } from "./redaccion";

// Skills globales y por proyecto. En ejecuciones aisladas, la carpeta global de OpenCode también se expone
// a Codex como ~/.agents/skills. Las skills seleccionadas se incluyen en el prompt común para cada runner.
//  - global:   ~/.config/opencode/skills/<nombre>/SKILL.md (OpenCode la lee siempre)
//  - proyecto: <carpeta del proyecto>/.opencode/skills/<nombre>/SKILL.md (OpenCode la lee desde el directorio de trabajo)
// Cada escritura va por tramos comprobados (ningún tramo puede ser enlace) y termina con un renombrado atómico.

export const LIMITE_SKILL = 64 * 1024;
const NOMBRE_MAX = 64;
const DESCRIPCION_MAX = 1024;
// Mismo patrón que exige OpenCode: minúsculas, dígitos y guiones simples entre segmentos.
const NOMBRE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ARCHIVO = "SKILL.md";

export class SkillError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 413,
  ) {
    super(code);
  }
}

export type AmbitoSkills = { ambito: "global" } | { ambito: "proyecto"; carpeta: string };

export type SkillResumen = {
  nombre: string;
  descripcion: string | null;
  // false si el archivo no tiene un frontmatter válido. OpenCode no la cargará hasta corregirla.
  valida: boolean;
  bytes: number;
  modificada: string;
};

export type SkillDetalle = SkillResumen & { contenido: string };

// Carpeta base y tramos que cuelgan de ella. El ámbito global cuelga del HOME del servidor, que es el del agente.
function anclaDe(ambito: AmbitoSkills): { ancla: string; tramos: string[] } {
  if (ambito.ambito === "global") return { ancla: carpetaHome(), tramos: [".config", "opencode", "skills"] };
  return { ancla: ambito.carpeta, tramos: [".opencode", "skills"] };
}

export function validarNombre(nombre: string): void {
  if (nombre.length > NOMBRE_MAX || !NOMBRE.test(nombre)) throw new SkillError("skill_nombre_invalido", 400);
}

// Recorre los tramos desde la base. Cualquier tramo que sea enlace o archivo se rechaza.
// Con `crear`, los tramos que falten se crean; sin él, devuelve null si la carpeta no existe.
function carpetaSegura(ancla: string, tramos: string[], crear: boolean): string | null {
  let actual = ancla;
  for (const tramo of tramos) {
    actual = join(actual, tramo);
    let existe = true;
    try {
      lstatSync(actual);
    } catch {
      existe = false;
    }
    if (!existe) {
      if (!crear) return null;
      mkdirSync(actual);
      continue;
    }
    if (!lstatSync(actual).isDirectory()) throw new SkillError("skill_ruta_no_permitida", 400);
  }
  return actual;
}

// Datos del frontmatter YAML: solo claves de primer nivel con valor de una línea, o bloque > / | para la descripción.
export function leerFrontmatter(texto: string): Record<string, string> | null {
  const cabecera = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(texto);
  if (!cabecera) return null;
  const lineas = cabecera[1]!.split(/\r?\n/);
  const campos: Record<string, string> = {};
  for (let i = 0; i < lineas.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lineas[i]!);
    if (!m) continue;
    const clave = m[1]!;
    let valor = m[2]!.trim();
    if (valor === ">" || valor === "|" || valor === ">-" || valor === "|-") {
      const bloque: string[] = [];
      while (i + 1 < lineas.length && /^\s+\S/.test(lineas[i + 1]!)) bloque.push(lineas[++i]!.trim());
      valor = bloque.join(valor.startsWith(">") ? " " : "\n");
    } else if (/^(["']).*\1$/.test(valor)) {
      valor = valor.slice(1, -1);
    }
    campos[clave] = valor;
  }
  return campos;
}

// Valida el contenido: frontmatter, nombre igual a la carpeta y descripción de 1 a 1024 caracteres.
export function validarContenido(texto: string, nombre: string): { descripcion: string } {
  const campos = leerFrontmatter(texto);
  if (!campos) throw new SkillError("skill_sin_frontmatter", 400);
  if (campos.name !== nombre) throw new SkillError("skill_nombre_no_coincide", 400);
  const descripcion = (campos.description ?? "").trim();
  if (descripcion.length === 0) throw new SkillError("skill_sin_descripcion", 400);
  if (descripcion.length > DESCRIPCION_MAX) throw new SkillError("skill_descripcion_larga", 400);
  return { descripcion };
}

function leerArchivo(ruta: string): { texto: string; bytes: number; modificada: string } {
  const stLink = lstatORNull(ruta);
  if (!stLink) throw new SkillError("skill_no_encontrada", 404);
  if (stLink.isSymbolicLink()) throw new SkillError("skill_ruta_no_permitida", 400);
  let fd: number;
  try {
    fd = openSync(ruta, fc.O_RDONLY | fc.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new SkillError("skill_no_encontrada", 404);
    throw new SkillError("skill_ruta_no_permitida", 400);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new SkillError("skill_ruta_no_permitida", 400);
    if (st.size > LIMITE_SKILL) throw new SkillError("skill_demasiado_grande", 413);
    const buffer = Buffer.alloc(st.size);
    let leido = 0;
    while (leido < st.size) {
      const n = readSync(fd, buffer, leido, st.size - leido, leido);
      if (n === 0) break;
      leido += n;
    }
    return { texto: buffer.subarray(0, leido).toString("utf8"), bytes: leido, modificada: st.mtime.toISOString() };
  } finally {
    closeSync(fd);
  }
}

// lstat sin seguir enlaces: un enlace roto cuenta como existente (y se rechaza más adelante).
function lstatORNull(ruta: string) {
  try {
    return lstatSync(ruta);
  } catch {
    return null;
  }
}

function resumenDe(nombre: string, texto: string, bytes: number, modificada: string): SkillResumen {
  let descripcion: string | null = null;
  let valida = false;
  try {
    descripcion = validarContenido(texto, nombre).descripcion;
    valida = true;
  } catch {
    valida = false;
  }
  return { nombre, descripcion, valida, bytes, modificada };
}

// Lista las carpetas con SKILL.md. Las que no tienen nombre válido o no tienen el archivo se ignoran.
export function listarSkills(ambito: AmbitoSkills): SkillResumen[] {
  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, false);
  if (!dir) return [];
  const resultado: SkillResumen[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (!entrada.isDirectory() || entrada.name.length > NOMBRE_MAX || !NOMBRE.test(entrada.name)) continue;
    const ruta = join(dir, entrada.name, ARCHIVO);
    try {
      const archivo = leerArchivo(ruta);
      resultado.push(resumenDe(entrada.name, archivo.texto, archivo.bytes, archivo.modificada));
    } catch (err) {
      // Sin archivo, o que no es un archivo regular (enlace, carpeta): no es una skill. Un archivo demasiado
      // grande sí aparece, marcado como no válido, para que la persona vea por qué no carga.
      if (!(err instanceof SkillError)) throw err;
      if (err.code === "skill_demasiado_grande") {
        const st = lstatORNull(ruta);
        resultado.push({
          nombre: entrada.name,
          descripcion: null,
          valida: false,
          bytes: st?.size ?? 0,
          modificada: st?.mtime.toISOString() ?? "",
        });
      }
    }
  }
  return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function leerSkill(ambito: AmbitoSkills, nombre: string): SkillDetalle {
  validarNombre(nombre);
  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, false);
  if (!dir) throw new SkillError("skill_no_encontrada", 404);
  const archivo = leerArchivo(join(dir, nombre, ARCHIVO));
  return { ...resumenDe(nombre, archivo.texto, archivo.bytes, archivo.modificada), contenido: archivo.texto };
}

function escribirSkillEn(ancla: string, tramos: string[], nombre: string, contenido: string): boolean {
  const dir = carpetaSegura(ancla, tramos, true)!;
  const carpeta = join(dir, nombre);
  const datosCarpeta = lstatORNull(carpeta);
  if (!datosCarpeta) mkdirSync(carpeta);
  else if (!datosCarpeta.isDirectory() || datosCarpeta.isSymbolicLink()) throw new SkillError("skill_ruta_no_permitida", 400);

  const destino = join(carpeta, ARCHIVO);
  const datosDestino = lstatORNull(destino);
  if (datosDestino && (!datosDestino.isFile() || datosDestino.isSymbolicLink())) throw new SkillError("skill_ruta_no_permitida", 400);
  const temporal = join(carpeta, `.${ARCHIVO}.${randomUUID()}.tmp`);
  const fd = openSync(temporal, fc.O_WRONLY | fc.O_CREAT | fc.O_EXCL | fc.O_NOFOLLOW, 0o644);
  try {
    const bytes = Buffer.from(contenido, "utf8");
    let escrito = 0;
    while (escrito < bytes.length) escrito += writeSync(fd, bytes, escrito, bytes.length - escrito);
    fsyncSync(fd);
  } catch {
    closeSync(fd);
    unlinkSync(temporal);
    throw new SkillError("skill_no_guardada", 400);
  }
  closeSync(fd);
  try {
    renameSync(temporal, destino);
  } catch {
    unlinkSync(temporal);
    throw new SkillError("skill_no_guardada", 400);
  }
  return datosDestino === null;
}

// Guarda la skill. Rechaza lo que OpenCode no cargaría y cualquier texto con un secreto conocido:
// esa versión se rechaza en vez de guardarse redactada, para no pisar al editar.
export function guardarSkill(ambito: AmbitoSkills, nombre: string, contenido: string): { creada: boolean } {
  validarNombre(nombre);
  if (Buffer.byteLength(contenido, "utf8") > LIMITE_SKILL) throw new SkillError("skill_demasiado_grande", 413);
  validarContenido(contenido, nombre);
  if (redactar(contenido, valoresDeConfiguracion()) !== contenido) {
    throw new SkillError("skill_contiene_secreto", 400);
  }

  const { ancla, tramos } = anclaDe(ambito);
  const creada = escribirSkillEn(ancla, tramos, nombre, contenido);
  if (ambito.ambito === "proyecto") {
    for (const tramosEspejo of [["skills"]]) {
      try {
        escribirSkillEn(ambito.carpeta, tramosEspejo, nombre, contenido);
      } catch {
        // La carpeta visible `skills` conserva compatibilidad con repositorios instalados anteriormente.
      }
    }
  }
  return { creada };
}

// Borra SKILL.md y su carpeta. Si hay otros archivos dentro, no toca nada: esos los quita la persona en su equipo.
export function borrarSkill(ambito: AmbitoSkills, nombre: string): void {
  validarNombre(nombre);
  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, false);
  if (!dir) throw new SkillError("skill_no_encontrada", 404);
  const carpeta = join(dir, nombre);
  let st;
  try {
    st = lstatSync(carpeta);
  } catch {
    throw new SkillError("skill_no_encontrada", 404);
  }
  if (!st.isDirectory()) throw new SkillError("skill_ruta_no_permitida", 400);
  const entradas = readdirSync(carpeta);
  if (entradas.some((e) => e !== ARCHIVO)) throw new SkillError("skill_con_archivos", 409);
  if (entradas.length === 1) unlinkSync(join(carpeta, ARCHIVO));
  rmdirSync(carpeta);

  if (ambito.ambito === "proyecto") {
    for (const tramosEspejo of [["skills"]]) {
      try {
        const dirVis = carpetaSegura(ambito.carpeta, tramosEspejo, false);
        if (dirVis) {
          const subVis = join(dirVis, nombre);
          if (lstatORNull(subVis)?.isDirectory()) {
            const destVis = join(subVis, ARCHIVO);
            if (lstatORNull(destVis)?.isFile()) unlinkSync(destVis);
            rmdirSync(subVis);
          }
        }
      } catch {
        // Ignorar fallo secundario de las rutas de compatibilidad.
      }
    }
  }
}

export const SKILL_GAUNTLET_CONTENIDO = `---
name: gauntlet
description: Metodología Gauntlet para Telo. Bucle de trabajo autónomo con roles de Constructor y Árbitro Adversarial, listón comprobable y verificación estricta para elevar el resultado al máximo nivel.
---

# Metodología Gauntlet para Telo

Esta skill aplica los principios del **Gauntlet Prompt** (Matt Shumer / Xavier Mitjana) para que la inteligencia artificial no se conforme con su primera versión (un 5) y alcance un resultado profesional riguroso (un 10).

## Los 2 Principios Fundamentales
1. **La IA no se cansa**: A diferencia del humano, la IA tiene resistencia y paciencia ilimitada para iterar, auditar y corregir tantas veces como sea necesario.
2. **La IA es mala jueza de su propio trabajo**: Quien construye no debe autoevaluarse con complacencia. Se requiere separar al Constructor del Árbitro, dotando a este último de hostilidad constructiva.

## Las 4 Cajas del Gauntlet en Telo

### 1. TAREA (¿Qué quieres?)
- Define el encargo con máxima precisión: qué es, para qué sirve, contexto del proyecto y archivos afectados.
- Identifica las dependencias, librerías y estándares del proyecto antes de tocar código.

### 2. MÉTODO (¿Cómo trabaja?)
- **De forma autónoma**: No te detengas a hacer preguntas triviales a cada paso; toma decisiones técnicas fundadas, aplícalas y anótalas en el reporte.
- **Bucle Constructor - Árbitro Adversarial (2 Rondas)**:
  - **Constructor**: Escribe el código, implementa la solución completa sin placeholders y ejecuta las pruebas del proyecto.
  - **Árbitro Adversarial**: Su único objetivo es encontrar fallos. **Prohibido elogiar y prohibido críticas vagas**. Compara la solución contra los requisitos y el listón. Lista entre 2 y 5 defectos concretos y medibles (tipos incorrectos, variables sin usar, funciones vacías, edge cases no probados, desajustes de diseño o inconsistencias).
  - **Ronda 2 de Corrección**: El Constructor corrige cada defecto señalado por el Árbitro antes de finalizar la tarea.

### 3. LISTÓN COMPROBABLE (¿Cuándo está terminado?)
- No uses adjetivos subjetivos ("que quede bonito" o "que funcione bien").
- Define y verifica un listón comprobable punto por punto:
  - Compilación y verificación de tipos limpia (sin errores ni advertencias).
  - Pruebas automatizadas del proyecto pasando al 100%.
  - Cero placeholders (sin mocks en producción, textos simulados ni funciones pendientes).
  - Fidelidad visual y responsive si abarca frontend.

### 4. ENTREGABLE (¿Qué recibo?)
- Código definitivo y limpio, sin restos de depuración ni archivos basura.
- Diff listo para revisión del usuario (el usuario aprueba commit/push en Telo).
- Resumen transparente de la auditoría: rondas efectuadas, qué puntos débiles detectó el árbitro y cómo se resolvieron.
`;

export const SKILL_FRONTEND_DESIGN_CONTENIDO = `---
name: frontend-design
description: Diseña y ajusta interfaces frontend con jerarquía visual clara, estilo coherente con el producto y comportamiento responsive. Úsala en tareas de UI, CSS, componentes y accesibilidad.
---

# Diseño frontend

- Inspecciona primero los patrones, tokens y componentes existentes. Conserva el lenguaje visual del producto y evita introducir otra librería o sistema de estilos sin necesidad.
- Define la jerarquía de la pantalla antes de ajustar detalles: propósito, acción principal, agrupación, espaciado y tipografía.
- Diseña desde móvil y revisa después una ventana amplia. Evita desbordes, controles pequeños, scroll anidado accidental y contenido oculto.
- Usa estados visibles y accesibles para foco, carga, error, vacío y éxito. Respeta teclado, etiquetas, contraste y movimiento reducido.
- Si el proyecto usa Vite o Bun, conserva sus herramientas. No migres a Vite+ salvo que el proyecto ya lo use o la persona lo pida. Usa Void solo si el proyecto apunta a Void o Cloudflare.
- Revisa el resultado en el navegador con la herramienta disponible cuando sea posible; corrige los problemas que observes antes de cerrar.
`;

export const SKILL_PLAYWRIGHT_CONTENIDO = `---
name: playwright
description: Verifica interfaces web con Playwright, incluyendo recorridos de usuario, consola, errores de red, responsive y capturas visuales.
---

# Playwright

- Revisa primero cómo el proyecto ya ejecuta pruebas y si Playwright está instalado. Usa la configuración y los fixtures existentes.
- Para cambios visuales revisa al menos 390 px y 1440 px cuando el entorno permita ambas medidas. Comprueba consola, fallos de red y desbordes horizontales.
- Prueba el comportamiento que cambió con selectores accesibles y espera estados observables; evita pausas fijas y selectores frágiles.
- No instales dependencias ni generes capturas de éxito ficticias. Si no hay navegador o Playwright disponible, informa con precisión qué parte no se pudo comprobar.
`;

export const SKILL_PONYTAIL_CONTENIDO = `---
name: ponytail
description: Guía de ingeniería para correcciones y cambios de código acotados: mínimo alcance, reutilización del diseño existente y verificación pertinente.
---

# Cambios de código acotados

- Busca la causa y el dueño correcto del comportamiento antes de editar. Haz el menor cambio que resuelva el caso completo y conserve contratos existentes.
- Reutiliza dependencias, componentes, patrones y pruebas del proyecto. No añadas capas de abstracción, dependencias o migraciones de herramientas sin una necesidad demostrada.
- Mantén separados los cambios no relacionados. Añade o ajusta una prueba solo cuando compruebe un comportamiento importante que pueda volver a fallar.
- Ejecuta las comprobaciones pertinentes y reporta su resultado. Si una comprobación no está disponible, dilo en vez de asumir que pasó.
- No cambies Vite/Bun a Vite+ automáticamente. Usa Void solo cuando la meta sea Void/Cloudflare; antes de desplegar exige CLI, credenciales y aprobación explícita.
`;

// Crea la carpeta de skills globales si falta. Se llama al arrancar: así bubblewrap siempre puede montarla en
// solo lectura (si no existiera, el agente podría crearla dentro de ~/.config/opencode, que sí es escribible).
export function prepararCarpetaGlobal(): void {
  const { ancla, tramos } = anclaDe({ ambito: "global" });
  carpetaSegura(ancla, tramos, true);
  const predeterminadas = [
    ["gauntlet", SKILL_GAUNTLET_CONTENIDO],
    ["frontend-design", SKILL_FRONTEND_DESIGN_CONTENIDO],
    ["playwright", SKILL_PLAYWRIGHT_CONTENIDO],
    ["ponytail", SKILL_PONYTAIL_CONTENIDO],
  ] as const;
  for (const [nombre, contenido] of predeterminadas) {
    try {
      const dir = carpetaSegura(ancla, tramos, false);
      const carpeta = dir ? join(dir, nombre) : null;
      const datosCarpeta = carpeta ? lstatORNull(carpeta) : null;
      if (datosCarpeta?.isDirectory() && !datosCarpeta.isSymbolicLink() && lstatORNull(join(carpeta!, ARCHIVO))) continue;
      if (datosCarpeta && (!datosCarpeta.isDirectory() || datosCarpeta.isSymbolicLink())) continue;
      guardarSkill({ ambito: "global" }, nombre, contenido);
    } catch { /* no bloquea el arranque ni reemplaza una skill existente que no pueda leerse */ }
  }
}
