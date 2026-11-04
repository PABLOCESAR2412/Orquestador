import {
  closeSync,
  constants as fc,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { carpetaHome } from "./hogar";
import { redactar, valoresDeConfiguracion } from "./redaccion";

// Skills globales y por proyecto. En ejecuciones aisladas, la carpeta global de OpenCode también se expone
// a Codex como ~/.agents/skills. Las skills seleccionadas se incluyen en el prompt común para cada runner.
//  - global:   ~/.config/opencode/skills/<nombre>/SKILL.md (OpenCode la lee siempre)
//  - proyecto: <carpeta del proyecto>/.opencode/skills/<nombre>/SKILL.md (OpenCode la lee desde el directorio de trabajo)
// Cada escritura va por tramos comprobados (ningún tramo puede ser enlace) y termina con un renombrado atómico.

export const LIMITE_SKILL = 64 * 1024;
export const LIMITE_RECURSO_SKILL = 8 * 1024 * 1024;
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

// Guarda un recurso auxiliar dentro de la carpeta de una skill. Solo acepta rutas relativas
// sencillas y crea cada carpeta sin seguir enlaces simbólicos.
export function guardarRecursoSkill(ambito: AmbitoSkills, nombre: string, rutaRelativa: string, contenido: string): void {
  validarNombre(nombre);
  const partes = rutaRelativa.split("/");
  if (
    rutaRelativa.length > 240 || partes.length < 2 ||
    partes.some((parte) => !/^[A-Za-z0-9._-]+$/.test(parte) || parte === "." || parte === "..")
  ) throw new SkillError("skill_ruta_no_permitida", 400);
  const bytes = Buffer.from(contenido, "utf8");
  if (bytes.byteLength > LIMITE_RECURSO_SKILL) throw new SkillError("skill_demasiado_grande", 413);
  if (redactar(contenido, valoresDeConfiguracion()) !== contenido) throw new SkillError("skill_contiene_secreto", 400);

  const { ancla, tramos } = anclaDe(ambito);
  const base = carpetaSegura(ancla, tramos, false);
  const skillDir = base ? join(base, nombre) : null;
  const statSkill = skillDir ? lstatORNull(skillDir) : null;
  if (!skillDir || !statSkill?.isDirectory() || statSkill.isSymbolicLink()) {
    throw new SkillError("skill_no_encontrada", 404);
  }

  let directorio = skillDir;
  for (const parte of partes.slice(0, -1)) {
    directorio = join(directorio, parte);
    const stat = lstatORNull(directorio);
    if (!stat) mkdirSync(directorio);
    else if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillError("skill_ruta_no_permitida", 400);
  }
  const destino = join(directorio, partes.at(-1)!);
  const statDestino = lstatORNull(destino);
  if (statDestino && (!statDestino.isFile() || statDestino.isSymbolicLink())) {
    throw new SkillError("skill_ruta_no_permitida", 400);
  }
  const temporal = join(directorio, `.recurso-${randomUUID()}.tmp`);
  const fd = openSync(temporal, fc.O_WRONLY | fc.O_CREAT | fc.O_EXCL | fc.O_NOFOLLOW, 0o644);
  try {
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

export const SKILL_IMAGE_DESIGN_CONTENIDO = `---
name: image-design
description: Crea y revisa imágenes, infografías, pósteres y gráficos con composición clara, texto legible y datos fieles.
---

# Creación de imágenes y gráficos

- Antes de crear, identifica el propósito, el público, el formato y la proporción. Organiza título, contenido principal, apoyos y fuentes en una retícula con márgenes amplios y espacio suficiente entre bloques.
- Si la imagen contiene datos, fechas, etiquetas o texto exacto, dibuja esos elementos con SVG, HTML, Canvas u otra herramienta programática disponible. Usa el modelo de imagen para la ilustración, textura o fondo; no dependas de texto rasterizado para reproducir cifras o rótulos con precisión.
- Para mantener el flujo sin cargos por petición, no invoques APIs externas facturables de imagen. Usa primero herramientas locales y el modelo seleccionado solo para las tareas que soporte. Si el usuario pide una imagen fotorrealista y no hay un generador local gratuito disponible, explica el límite y ofrece una composición vectorial; no afirmes que creaste una imagen raster fotorrealista.
- Ajusta la composición al contenido: si no cabe, cambia la distribución o el lienzo antes de reducir la tipografía. En líneas de tiempo alterna los rótulos o sepáralos en filas; en gráficos mantén las cifras, escalas y etiquetas coherentes y sin cruces.
- Mantén pocos niveles tipográficos, contraste suficiente y texto secundario que pueda leerse al tamaño de uso. Evita perspectiva extrema, texto extruido, adornos o paneles que compitan con la información. Si se pide 3D, aplica profundidad a la escena y los elementos decorativos; conserva planos y legibles los textos y datos.
- No inventes ni cambies hechos, cifras, nombres o fechas. Si las fuentes discrepan, expresa el rango o la incertidumbre y cita las fuentes disponibles sin saturar el diseño.
- Renderiza el archivo final y revísalo en conjunto y al tamaño previsto: busca solapamientos, cortes, etiquetas pequeñas, inconsistencias y desequilibrio. Corrige los defectos y vuelve a renderizar. Si no puedes inspeccionar el resultado, indícalo sin afirmar que pasó una revisión visual.
- Entrega la ruta del archivo, el formato y sus dimensiones; resume cualquier limitación que afecte a la fidelidad visual o a los datos.
`;

export const SKILL_MOTION_DESIGN_CONTENIDO = `---
name: motion-design
description: Diseña y verifica animaciones, videos y piezas audiovisuales con escenas limpias, texto correcto y formatos compatibles.
---

# Diseño de movimiento y video

- Comprueba las herramientas disponibles en el entorno real antes de afirmar que no puedes renderizar: usa npx hyperframes doctor --json. npx hyperframes usage --json solo refleja cuota de la cuenta del proveedor de IA; un estado unknown no bloquea por sí mismo la composición o el render.
- Para HyperFrames local, verifica Node.js 22+, Chromium y FFmpeg. No exijas Blender para animaciones HTML; TTS es opcional salvo que el pedido requiera narración. Si la voz no está disponible, termina el video sin voz cuando el usuario no la haya pedido como requisito.

- Antes de producir, define el público, el formato, la proporción, la duración y una secuencia breve de escenas. Ajusta la composición a las zonas seguras del formato social solicitado.
- Si el contenido contiene títulos, fechas, nombres o datos, dibújalos como texto vectorial con cadenas revisadas en español. Usa fuentes con glifos latinos y tildes; no agregues pseudoescritura, caracteres asiáticos ni adornos que parezcan letras.
- Construye cada fotograma desde una escena completa sobre un fondo opaco. No dibujes sobre el fotograma anterior ni conserves capas de escenas que ya terminaron; limita los fundidos a la transición y deja desaparecer por completo la escena saliente.
- Usa movimiento de cámara o de elementos con intención, ritmo y jerarquía. Si se pide una pieza temática, combina composición, color, tipografía y recursos visuales pertinentes; no sustituyas la dirección artística por texto que solo enumere la petición.
- Revisa una hoja de contacto con fotogramas del inicio, mitad, final y cada transición. Comprueba texto, residuos, solapamientos, safe areas y que el primer plano no quede negro durante más tiempo del previsto; corrige y vuelve a revisar los defectos.
- Para MP4 de distribución, prioriza H.264, píxeles yuv420p y la opción faststart; añade audio AAC solo si hay una pista intencional. Mantén GIF y WebP animado como formatos auxiliares, y explica cuando una aplicación de escritorio no admita WebP animado.
- Verifica el archivo final y reporta su ruta, códec, dimensiones, duración, frecuencia de fotogramas y pista de audio solo cuando una herramienta disponible lo confirme. No afirmes que el reproductor o el formato se validaron si no pudiste abrirlos.
- Si se solicita narración, prepara un guion breve en español; antes de prometerla, verifica que una herramienta de voz esté disponible y responda; si no existe, dilo en la primera respuesta y entrega el video sin fingir que tiene audio.
- Prioriza un TTS local ya instalado o un servidor MCP local, como VoiceStudio (herramienta generate_speech). No llames servicios externos de voz que puedan cobrar. Si no hay TTS configurado o accesible desde el agente, entrega el video sin audio y deja clara esa limitación.
- Si el usuario menciona una plataforma como Instagram Stories, TikTok o Facebook, adapta directamente proporción, resolución y zonas seguras a ese destino. Si pide cámara lenta, aplícala al render final y comprueba la duración resultante.
`;

export const SKILL_AUTORIA_CONTENIDO = `---
name: skill-authoring
description: Crea, deriva, revisa y mejora skills para agentes a partir de tareas repetidas, resultados verificados y correcciones del usuario. Úsala cuando se pida crear o perfeccionar una skill, convertir una experiencia en un flujo reutilizable o evaluar si una skill se activa y funciona bien.
---

# Crear y mejorar skills

Convierte procedimientos repetidos en instrucciones reutilizables, específicas y comprobables. Usa el historial relevante de la conversación: solicitud inicial, resultado, errores observados y correcciones del usuario.

## Método

1. Revisa las skills disponibles y edita una existente si ya cubre el mismo objetivo. No dupliques habilidades.
2. Extrae solo el patrón que se pueda reutilizar. Mantén fuera de una skill global los nombres, rutas, datos y decisiones exclusivos de un proyecto, salvo que la persona pida una skill de proyecto.
3. Define una sola responsabilidad, sus casos de uso y cuándo no debe activarse. La descripción debe indicar qué hace y qué peticiones la disparan.
4. Escribe un \`SKILL.md\` breve con el procedimiento, entradas necesarias, criterios observables de éxito, límites y qué hacer si falta o se contradice información.
5. Mantén los detalles condicionales fuera del cuerpo principal cuando haya archivos de referencia disponibles. Enlaza solo recursos que existan junto a la skill; no dejes rutas pendientes. Añade scripts únicamente para pasos deterministas y seguros.
6. Incluye casos para comprobar la selección y la ejecución: una petición que sí debe activarla, una parecida que no, un caso normal y un caso límite. Indica qué modelos se probaron realmente y qué queda pendiente; no presentes ejemplos hipotéticos como pruebas ejecutadas.
7. Entrega el contenido como borrador editable, explica qué experiencia lo motivó y espera la revisión de la persona. Nunca guardes ni reemplaces una skill global por iniciativa propia.

## Criterio de calidad

Una skill lista tiene un disparador claro, un objetivo único, pasos accionables, criterios de éxito verificables, manejo de límites y casos de prueba. Si una sección solo repite conocimiento general del modelo, elimínala.
`;

const SKILLS_UPSTREAM = [
  "brainstorming", "code-review", "context7-mcp", "documentation-lookup", "hyperframes",
  "hyperframes-cli", "hyperframes-registry", "ig-caption", "ig-carousel", "ig-human",
  "ig-plan", "ig-reel", "ig-story", "job-application-assistant", "media-use", "obsidian-cli",
  "obsidian-markdown", "orca-cli", "orchestration", "prospecting", "strategic-compact",
  "subagent-driven-development", "systematic-debugging", "test-driven-development", "writing-plans",
  "using-superpowers", "verification-before-completion",
] as const;

const SKILLS_LEGADAS_SHA256: Record<string, string> = {
  context7: "37ed6cc55ac1d5b42fc90869215d202724f1e147586b5fd7073454f4c57453c6",
  "hyperframes-video": "ead8d5260a849b3263d823194160c48d949df95bc29d5384bf87a4fdba7905c3",
  "instagram-agent": "20cff84f68e51ee224517dc5fd9bc5fe0846772707960d7e23d69a4fe419addc",
  "obsidian-vault": "1f3bb2dfb45d071af52a5252410cb76ed840f80f6c4ba224591bc4d33140f666",
  superpowers: "87cd7a61eee862cf6105ade3cf043bf6ae6d0c630d35bcb15b2ba993664f74bf",
  "ecc-workflows": "4aa355a4dcb246b91d04743ba49489ab649f24232855a144c009f694e78d57f4",
  "harvey-legal": "8701e0bb48a49cf9ca3a12a903baa1a7b6ead06774987452269e35bdca38b516",
  "orca-agent-builder": "98c3aae8c3b952f03931d70a861176b5cca5e1134ce8fb775d8299433f9d160c",
  "ai-job-search": "a3a7003364f1038ddc0fa08e6d8b7af2f6158fc2055799faf9b8b2e610e835d9",
  "find-clients": "e69344fb58eb62d4a296c4c719c9ace323d47bc7a0eddc03e28f033626ec65bf",
};

const HARVEY_FALSA_SHA256 = "71a7c466c2f14b3a8110393afb6b167cb88a842b6935d462cb97f3c42aaf0a80";

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
    ["image-design", SKILL_IMAGE_DESIGN_CONTENIDO],
    ["motion-design", SKILL_MOTION_DESIGN_CONTENIDO],
    ["skill-authoring", SKILL_AUTORIA_CONTENIDO],
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

  // Las skills upstream se copian byte por byte y solo si no hay una skill local con ese nombre.
  // Así no se sobrescriben personalizaciones existentes y la fuente original sigue disponible en el repo.
  for (const nombre of SKILLS_UPSTREAM) {
    try {
      const dir = carpetaSegura(ancla, tramos, false);
      const carpeta = dir ? join(dir, nombre) : null;
      if (!carpeta || lstatORNull(carpeta) || lstatORNull(join(carpeta, ARCHIVO))) continue;
      const origen = join(import.meta.dir, "..", "skills-upstream", nombre, ARCHIVO);
      const contenido = readFileSync(origen, "utf8");
      guardarSkill({ ambito: "global" }, nombre, contenido);
    } catch { /* la skill incorrecta o ausente se muestra como no disponible, sin romper el arranque */ }
  }

  // Harvey Specterbot no es una skill oficial de Harvey. Retira únicamente la copia
  // exacta que Telo incluía; conserva cualquier carpeta o archivo personalizado.
  try {
    const dir = carpetaSegura(ancla, tramos, false);
    const archivo = dir ? join(dir, "harvey", ARCHIVO) : null;
    const stat = archivo ? lstatORNull(archivo) : null;
    if (archivo && stat?.isFile() && !stat.isSymbolicLink()) {
      const contenido = readFileSync(archivo);
      const hash = createHash("sha256").update(contenido).digest("hex");
      if (hash === HARVEY_FALSA_SHA256) {
        unlinkSync(archivo);
        const carpeta = join(dir!, "harvey");
        if (readdirSync(carpeta).length === 0) rmdirSync(carpeta);
      }
    }
  } catch { /* una copia editada o inaccesible se conserva */ }

  // Retira únicamente el contenido exacto sembrado originalmente por Telo; conserva copias editadas.
  for (const [nombre, hashEsperado] of Object.entries(SKILLS_LEGADAS_SHA256)) {
    try {
      const dir = carpetaSegura(ancla, tramos, false);
      const archivo = dir ? join(dir, nombre, ARCHIVO) : null;
      if (!archivo) continue;
      const stat = lstatORNull(archivo);
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      const hash = createHash("sha256").update(readFileSync(archivo)).digest("hex");
      if (hash !== hashEsperado) continue;
      unlinkSync(archivo);
      const carpeta = join(dir!, nombre);
      if (readdirSync(carpeta).length === 0) rmdirSync(carpeta);
    } catch { /* solo se limpia una skill antigua idéntica; no se afecta una personalizada */ }
  }
}
