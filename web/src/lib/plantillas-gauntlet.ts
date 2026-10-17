export type CategoriaPlantilla = "universal" | "web" | "sistema" | "datos" | "visual";

export type PlantillaGauntlet = {
  id: string;
  titulo: string;
  subtitulo: string;
  categoria: CategoriaPlantilla;
  badge: string;
  icono: string;
  prompt: string;
  descripcionCorta: string;
  puntosListon: string[];
};

export const PLANTILLAS_GAUNTLET: PlantillaGauntlet[] = [
  {
    id: "gauntlet-universal",
    titulo: "Gauntlet Universal (4 Cajas)",
    subtitulo: "Para cualquier desarrollo, refactor o feature con máxima rigurosidad",
    categoria: "universal",
    badge: "Estándar 4 Cajas",
    icono: "⚡",
    descripcionCorta: "Estructura estándar de Tarea, Método en bucle de 2 rondas, Listón comprobable y Entregable.",
    puntosListon: [
      "Compilación y tipado estricto sin errores",
      "Pruebas automatizadas pasando al 100%",
      "Cero placeholders ni código incompleto",
    ],
    prompt: `TAREA:
[Escribe aquí qué quieres que haga, en una o dos frases. Para quién es y qué archivos o módulos abarca].

MÉTODO (Gauntlet Loop):
Trabaja de forma autónoma en loop: planifica, construye, prueba, revisa, corrige y repite. No me entregues la primera versión ni te conformes con un prototipo superficial.
Usa un árbitro que emplee técnicas adversariales para auditar y criticar el trabajo hecho: que busque fallos a propósito, como si quisiera tumbar la solución. Prohibido elogiar y prohibido críticas vagas. Sigue mejorando hasta que lo dé por bueno.

LISTÓN:
El árbitro no puede dar el trabajo por terminado hasta comprobar uno por uno estos puntos:
- El código compila sin errores ni advertencias de tipos (clean code y tipado estricto).
- Se ejecutan las pruebas pertinentes y pasan en verde al 100%.
- No queda ningún hueco de relleno (placeholder), mock temporal ni función vacía.
- Cada cambio respeta la arquitectura existente y convenciones del proyecto.

ENTREGABLE:
Código definitivo probado y limpio, diff listo para revisión del usuario, y al final un resumen de la auditoría del árbitro: cuántas rondas se hicieron, qué fallos detectó y cómo se solucionaron.`,
  },
  {
    id: "gauntlet-web",
    titulo: "Web & Frontend de Alta Fidelidad",
    subtitulo: "Estilo Awwwards, animaciones cuidadas, responsive y sin placeholders",
    categoria: "web",
    badge: "Frontend & Diseño",
    icono: "🌐",
    descripcionCorta: "Inspirada en el prompt de FridgeFlow: interacciones cuidadas, diseño responsive y copy profesional.",
    puntosListon: [
      "La web se abre y funciona sin dependencias rotas",
      "Sin placeholders ni texto falso (lorem ipsum)",
      "Interacciones fluidas, microanimaciones y responsive",
    ],
    prompt: `TAREA:
Diseña y desarrolla de forma autónoma una página o aplicación web completa para [nombre de tu proyecto o idea]. Crea las vistas y componentes necesarios.

MÉTODO (Gauntlet Loop):
Trabaja en loop: planifica, construye, prueba el diseño y la funcionalidad, revisa, corrige y repite hasta conseguir una experiencia pulida, original y de nivel profesional.
Usa un árbitro que emplee técnicas adversariales para auditar y criticar el trabajo hecho: compara diseño, contrastes, accesibilidad y usabilidad. Prohibido elogiar y prohibido críticas superficiales.

LISTÓN:
El diseño debe ser completamente funcional, con textos persuasivos y profesionales (nada de texto simulado tipo lorem ipsum).
El árbitro no puede dar el trabajo por terminado hasta comprobar, uno por uno:
- La web se abre y funciona correctamente en cualquier navegador sin configuraciones complejas.
- No queda ningún hueco de relleno (placeholder), imagen rota ni enlace sin destino.
- El diseño es totalmente responsive (móvil y escritorio) con paleta armónica y tipografía cuidada.
- Cada botón, formulario o menú responde con interacción visual coherente.

ENTREGABLE:
Entrega todos los archivos (HTML, CSS/Tailwind, JavaScript/TypeScript, componentes y assets) listos para usar, y al final resume la auditoría del árbitro: rondas realizadas, qué detalles visuales o funcionales rechazó y cómo se corrigieron.`,
  },
  {
    id: "gauntlet-sistema",
    titulo: "Sistema, Backend & APIs Robustas",
    subtitulo: "Arquitectura limpia, contratos OpenAPI/REST, tipado estricto y tests",
    categoria: "sistema",
    badge: "Backend & Arquitectura",
    icono: "⚙️",
    descripcionCorta: "Módulos de backend, microservicios, bases de datos y endpoints con validación exhaustiva y suite de tests.",
    puntosListon: [
      "Validación de esquemas y parámetros en todas las entradas",
      "Manejo de errores resiliente con códigos HTTP semánticos",
      "Suite de pruebas de integración y unitarias al 100%",
    ],
    prompt: `TAREA:
Diseña e implementa la arquitectura, modelos y endpoints de backend para [módulo, servicio o API a desarrollar].

MÉTODO (Gauntlet Loop):
Proceso de 2 rondas con roles especializados:
1. Constructor: implementa los esquemas de base de datos, lógica de negocio, endpoints y suite de tests.
2. Árbitro Adversarial: busca activamente vulnerabilidades, condiciones de carrera (race conditions), inyecciones, fallos en validación de entradas, tipos 'any' o fugas de memoria. Prohibido elogiar.
Ronda 2: el Constructor corrige de inmediato todas las observaciones del árbitro antes de presentar el código.

LISTÓN:
El árbitro no puede dar el trabajo por terminado hasta verificar punto por punto:
- Cada endpoint valida estrictamente su payload de entrada y sanitiza los datos.
- Manejo estructurado de errores con códigos de estado HTTP precisos (400, 401, 404, 409, 500).
- No hay stubs, mocks en código de producción ni variables de depuración sueltas.
- Las pruebas automatizadas cubren casos felices y casos extremos (edge cases).

ENTREGABLE:
Código completo y modular, migraciones o esquemas necesarios, tests pasando al 100% y un reporte técnico con los hallazgos del árbitro adversarial y cómo fueron mitigados.`,
  },
  {
    id: "gauntlet-datos",
    titulo: "Cuadro de Mando, Datos & Tablas",
    subtitulo: "Auditoría exhaustiva, fórmulas reproducibles y reporte ejecutivo",
    categoria: "datos",
    badge: "Datos & Reportes",
    icono: "📊",
    descripcionCorta: "Inspirada en el caso Cabo Norte: análisis exhaustivo de documentos, tablas con fórmulas reales y detección de incoherencias.",
    puntosListon: [
      "Todos los documentos analizados sin omisiones",
      "Cifras calculadas con fórmulas reproducibles (no escritas a mano)",
      "Identificación activa de contradicciones e incoherencias",
    ],
    prompt: `TAREA:
Analiza los archivos, registros o fuentes de datos del proyecto para generar un análisis completo y un cuadro de mando estructurado con tablas.

MÉTODO (Gauntlet Loop):
Abre e inspecciona cada documento o archivo sin omitir ninguno. No te fíes de nombres genéricos; lee el contenido real.
Trabaja con un árbitro adversarial: verifica que cada cifra y fecha coincida con la fuente original, sin inventar ni redondear sin justificación.
Busca activamente contradicciones e incoherencias entre documentos y cuantifica su impacto en costos o días de retraso.

LISTÓN:
El árbitro no puede dar el trabajo por terminado hasta comprobar uno por uno:
- Se han procesado todos los archivos de la carpeta sin dejar ninguno fuera.
- Las tablas incluyen fórmulas o cálculos automáticos reproducibles, no números planos puestos a mano.
- Cada discrepancia o riesgo encontrado cita la fuente exacta y su impacto medible.
- El informe tiene estructura ejecutiva clara, legible para personas y orientado a decisiones.

ENTREGABLE:
El cuadro de mando con las tablas estructuradas, el informe analítico en Markdown con hallazgos clave, y el resumen de validación del árbitro confirmando qué datos fueron auditados y corregidos.`,
  },
  {
    id: "gauntlet-visual",
    titulo: "Componente Visual 3D & Gráficos",
    subtitulo: "Three.js, SVG interactivo o Canvas con verificación geométrica",
    categoria: "visual",
    badge: "Visual & 3D",
    icono: "🎨",
    descripcionCorta: "Inspirada en el modelo 3D de la grapadora: creación geométrica en código con crítica adversarial de proporciones y materiales.",
    puntosListon: [
      "Geometría generada 100% con código (sin depender de assets externos caídos)",
      "Proporciones, curvaturas y materiales validados pieza por pieza",
      "Interactividad fluida con OrbitControls o eventos de ratón",
    ],
    prompt: `TAREA:
Crea un modelo o componente visual interactivo fiel de [objeto, diagrama o elemento visual] en Three.js o SVG, en un archivo ejecutable directamente en el navegador.

MÉTODO (Gauntlet Loop):
Proceso de 2 rondas con dos roles:
1. Constructor: describe las piezas, geometría, materiales, colores e iluminación, y genera la versión 1.
2. Crítico Adversarial: compara la geometría pieza a pieza contra la especificación o fotos de referencia. Prohibido elogiar y prohibido críticas vagas como 'podría ser más realista'. Lista entre 3 y 6 errores concretos y medibles (proporciones, posición de piezas, colores, acabados).
Ronda 2: el Constructor corrige todos los fallos señalados, explica qué cambió y entrega la versión definitiva.

LISTÓN:
El árbitro no puede dar el trabajo por terminado hasta verificar:
- Geometría limpia generada con código sin errores de consola.
- Controles de interacción fluidos (rotación, zoom o hover) con iluminación y materiales acordes.
- Proporciones armoniosas y colores coincidentes con la referencia.

ENTREGABLE:
El archivo final ejecutable listo para abrir en el navegador, un resumen breve de las correcciones realizadas entre la versión 1 y la 2, y la lista de comprobaciones superadas.`,
  },
];
