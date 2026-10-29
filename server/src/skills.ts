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

export const SKILL_CONTEXT7_CONTENIDO = `---
name: context7
description: Consulta documentación actual y ejemplos de bibliotecas, frameworks, SDK, APIs y herramientas de línea de comandos al implementarlos, configurarlos, migrarlos o depurarlos.
---

# Documentación técnica actual

Usa Context7 cuando la tarea dependa de la API, configuración, versión o comportamiento actual de una biblioteca o servicio. No lo uses para responder preguntas que el código del repositorio ya resuelve por sí mismo.

## Consulta

1. Llama a \`resolve-library-id\` con el nombre exacto de la biblioteca y la pregunta concreta. Elige el resultado oficial o el que coincida con la versión indicada.
2. Llama a \`query-docs\` con el ID elegido y una sola pregunta específica. Separa conceptos diferentes en consultas distintas.
3. Contrasta la documentación con las versiones y los patrones presentes en el repositorio antes de cambiar código.

Envía solo el nombre de la tecnología y preguntas conceptuales. No envíes código privado del proyecto, credenciales, datos de usuarios ni contenido de archivos. Si Context7 no está disponible o limita la consulta, continúa con fuentes oficiales accesibles y deja claro qué verificaste.
`;

const SKILLS_PERSONALES = {
  "hyperframes-video": `---
name: hyperframes-video
description: Crea y verifica animaciones y videos basados en HTML con HyperFrames cuando se pide un video, motion graphic, captions o animación.
---

# Videos con HyperFrames

Usa HyperFrames para convertir composiciones HTML en video cuando la solicitud pida una animación o video. Revisa primero el proyecto y los archivos existentes; no empieces de cero si ya hay una composición.

## Flujo

1. Comprueba el espacio libre del disco antes de descargar o renderizar (en Linux, \`df -Pk <espacio-de-trabajo>\`). Usa como umbral conservador 4 GiB libres para la descarga, Chromium, archivos temporales y el render; por debajo, no ejecutes npx ni inicies el render en esa VM porque Telo puede quedarse sin disco. En ese caso prepara la composición HTML y avisa que falta espacio para producir el MP4; ofrece liberar espacio o renderizar en un equipo con más espacio.
2. Comprueba \`node --version\` y ejecuta \`npx --yes hyperframes doctor\` solo después de pasar la comprobación de disco. Requiere Node.js 22 o posterior y FFmpeg; el diagnóstico también comprueba FFprobe y Chromium empaquetado. FFprobe se usa para verificar el archivo final. npx descarga HyperFrames bajo demanda y evita una instalación global.
3. Revisa y reutiliza primero la composición HTML existente. Para un proyecto nuevo crea una carpeta propia dentro del espacio de trabajo con \`npx --yes hyperframes init <nombre> --example blank --skip-skills\`; el ejemplo es obligatorio en modo automático y \`--skip-skills\` evita cambiar la configuración global de otras herramientas.
4. Ejecuta \`npx --yes hyperframes lint\` y revisa fotogramas representativos con \`npx --yes hyperframes snapshot <directorio> --at <segundos-separados-por-comas>\` antes del render.
5. Cuando se pidió el archivo final, renderiza en el entorno con espacio suficiente con \`npx --yes hyperframes render --output <archivo.mp4>\`; verifica que exista, tenga tamaño mayor que cero y duración correcta con \`ffprobe\`. No borres archivos del usuario ni cachés compartidas para recuperar espacio.

## Límites

- Prioriza render local. No publiques, subas a servicios cloud ni consumas servicios pagados sin petición explícita. Si el entorno de ejecución de Telo no tiene Node 22+ y FFmpeg, el render local no está disponible hasta que se preparen esos requisitos; Chromium viene empaquetado y Docker solo se necesita para el modo Docker.
- No afirmes que se generó audio, voz o material visual si no se ejecutó y verificó la herramienta correspondiente.
- Evita instalar dependencias globales. Si HyperFrames no está disponible, explica el requisito exacto y ofrece continuar con herramientas presentes.
`,
  "instagram-agent": `---
name: instagram-agent
description: Planifica y prepara contenido para Instagram, incluyendo publicaciones, Reels, Stories, calendario y métricas.
---

# Agente de contenido para Instagram

Aclara objetivo, cuenta o marca, audiencia, formato, tono y llamada a la acción. Reutiliza el brief y el contexto del chat; pregunta solo por los datos que sigan faltando.

Prepara copies, guiones, ideas visuales, calendario y variantes con proporciones y zonas seguras adecuadas al formato. Distingue recomendaciones de datos verificados y no inventes métricas, tendencias ni resultados.

No publiques, envíes mensajes ni programes contenido. La publicación requiere que el usuario conecte una cuenta Meta/Instagram con permisos adecuados y confirme cada acción.
`,
  "obsidian-vault": `---
name: obsidian-vault
description: Organiza ideas, notas y conocimiento en un vault de Obsidian con enlaces y Markdown.
---

# Trabajo con Obsidian

Usa Markdown compatible con Obsidian, títulos claros, enlaces internos [[nota]] y etiquetas solo cuando aporten navegación. Antes de crear o modificar una nota, identifica el vault, la carpeta destino y si debe enlazarse con notas existentes.

Si no existe conexión configurada, entrega el contenido como Markdown y señala que no se escribió en el vault. Para acceso directo, el usuario debe configurar una integración segura, por ejemplo Obsidian Local REST API mediante un servidor MCP, con URL local y token guardado como secreto.

No leas ni escribas el vault ni sigas enlaces externos sin autorización. Nunca incluyas el token en prompts, logs o notas.
`,
  "superpowers": `---
name: superpowers
description: Aplica prácticas de desarrollo guiado por pruebas, diseño incremental, depuración sistemática y revisión de código cuando se solicite trabajo de ingeniería.
---

# Prácticas de ingeniería

Para cambios de software, entiende el flujo existente, formula el comportamiento esperado, separa el trabajo en pasos pequeños y verifica cada paso. En bugs, reproduce o identifica la causa antes de editar; en cambios grandes, acuerda primero un plan concreto. Conserva cambios ajenos y evita añadir abstracciones o dependencias innecesarias.

Sigue las instrucciones del repositorio y las herramientas disponibles. No afirmes haber ejecutado pruebas que no ejecutaste ni instales hooks o automatizaciones de terceros por iniciativa propia.
`,
  "ecc-workflows": `---
name: ecc-workflows
description: Aplica de forma selectiva buenas prácticas de Everything Claude Code para contexto, agentes, revisión y flujos de ingeniería.
---

# Flujos inspirados en ECC

Usa solo la práctica pertinente: instrucciones breves por proyecto, planes verificables, revisión independiente cuando haya capacidad real de delegación, y documentación de decisiones repetibles. Adapta todo a las herramientas y políticas de Telo.

No descargues el repositorio ECC, sus hooks, comandos o agentes, no cambies la configuración global y no ejecutes scripts de terceros sin petición explícita y revisión de su contenido. Explica cuándo una capacidad no existe en Telo.
`,
  "harvey-legal": `---
name: harvey-legal
description: Ayuda a estructurar investigación, revisión y borradores legales con fuentes, jurisdicción y límites explícitos.
---

# Flujo legal

Identifica jurisdicción, fecha, tipo de documento y pregunta concreta. Separa hechos proporcionados, inferencias y cuestiones por confirmar. Cita fuentes primarias actuales cuando se requiera precisión legal y marca riesgos y términos ambiguos.

Esta skill no conecta Harvey ni reemplaza asesoría de un abogado. Si se solicita usar el servicio Harvey, se necesita acceso y conexión autorizada de la organización. No envíes documentos confidenciales a un servicio externo sin aprobación.
`,
  "orca-agent-builder": `---
name: orca-agent-builder
description: Diseña una especificación local de agente para el producto Orca que el usuario identifique.
---

# Diseño de agentes Orca

Antes de diseñar una integración, confirma qué producto llamado Orca usa el usuario y pide su URL o documentación oficial. No asumas nombres de API, formatos, registry, workspace, permisos ni mecanismo de despliegue. Mientras no se identifique el producto, prepara solo una especificación local con objetivo, entradas, salida, modelo, herramientas, memoria, permisos y criterios de éxito.

Distingue el diseño local de un agente realmente creado en el servicio. No publiques ni envíes datos sin autorización y una integración verificada.
`,
  "ai-job-search": `---
name: ai-job-search
description: Busca oportunidades laborales y adapta materiales de postulación con información verificable y consentimiento.
---

# Búsqueda de empleo

Usa ubicación, modalidad, cargos, experiencia, salario y restricciones del usuario. Busca vacantes vigentes en fuentes identificables; resume fecha, requisitos, ubicación y enlace directo, y separa requisitos imprescindibles de deseables.

Adapta CV y carta solo con experiencia real proporcionada; no inventes títulos, habilidades ni logros. No envíes postulaciones, crees cuentas o compartas datos personales sin autorización explícita.
`,
  "find-clients": `---
name: find-clients
description: Identifica clientes potenciales y prepara propuestas de servicio y mensajes de acercamiento personalizados.
---

# Prospección de clientes

Define servicio, sector, territorio, tamaño de cliente y señales de necesidad. Investiga fuentes públicas, entrega una lista con evidencia y enlaces, y explica por qué cada candidato encaja. Distingue hechos de hipótesis.

Prepara mensajes breves y personalizados, sin afirmar una relación previa inexistente. No contactes, envíes correos ni cargues datos personales a CRM sin autorización e integración configurada.
`,
} as const;

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
    ["context7", SKILL_CONTEXT7_CONTENIDO],
    ...Object.entries(SKILLS_PERSONALES),
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
