# DESIGN.md: sistema de diseño de Orquestador

Fuente de verdad visual. Stitch lo importa para generar pantallas y los agentes lo leen antes de tocar la interfaz. Los valores vienen de `web/src/styles.css`. Si cambian allí, cambian aquí.

## Principio

Pizarra, papel y ámbar como señal. Oscuro, sobrio, denso pero con aire. El ámbar solo marca estado activo, alerta o la acción principal. Nunca decora.

## Voz

Español neutro y directo. Frases cortas, sin signos de exclamación ni jerga técnica. Los errores dicen qué pasó y qué hacer: "Algo salió mal. Intenta de nuevo." En lugar de códigos.

## Color

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#111419` | fondo de página |
| `--surface` | `#181c22` | paneles y tarjetas |
| `--surface-2` | `#20252d` | superficies elevadas, hover, burbuja del usuario |
| `--surface-lowest` | `#0d0e11` | fondo profundo del sidebar y bloques de código Stitch |
| `--line` | `#2a3039` | bordes sutiles |
| `--line-strong` | `#3a414c` | hover de bordes, divisiones fuertes |
| `--ink` | `#e7e9ec` | texto principal |
| `--ink-2` | `#8c94a0` | texto secundario y etiquetas |
| `--signal` | `#d9a441` | estado activo, alerta, acción principal |
| `--danger` | `#e06b52` | errores |
| `--bar` | `#7b8390` | barras de gráficas (un solo tono neutro) |

**Contraste:** el texto principal debe cumplir 4.5:1 sobre `--bg`. `--ink-2` es para información secundaria, nunca para algo crítico. El ámbar nunca es texto de cuerpo.

## Tipografía

- **Familia:** Instrument Sans Variable, con `system-ui` de respaldo.
- **Cuerpo:** 15 px, interlineado 1.5.
- **Título de página (h1):** 24 px, peso 600, interlineado 1.2.
- **Título de panel (h2):** 18 px, peso 600.
- **Etiquetas y metadatos:** 12 a 14 px, en `--ink-2`.
- **Números:** tabulares (`font-variant-numeric: tabular-nums`). Los KPI son grandes y legibles de un vistazo.

## Espaciado y forma

- **Margen lateral:** 16 px en móvil.
- **Ancho de contenido:** 720 px centrados en escritorio (`--col`).
- **Escala de espaciado:** 4, 8, 12, 16, 24 y 32 px.
- **Radio:** 10 px en paneles y tarjetas. Píldora (999 px) en chips y selectores.
- **Riel lateral del chat:** 264 px (`--rail-w`) en escritorio. En móvil (≤ 760 px) es un cajón que se abre desde un botón de menú.

## Componentes existentes

Reutilizar estos componentes. No crear equivalentes nuevos.

- **AppNav:** navegación entre Tareas, Analíticas, Ajustes y Estado. Los chats no tienen enlace propio: se listan en la barra lateral, por fecha, y los de un proyecto muestran su nombre debajo del título. El enlace activo lleva subrayado en `--signal` y `aria-current="page"`.
- **Panel:** contenedor con borde `--line`, radio 10 px y título h2.
- **KPI:** etiqueta, valor grande y pista opcional.
- **Periodo (pills):** selector de periodos. El activo usa `--surface-2`.
- **Segmented:** grupo de opciones excluyentes, como esfuerzo o porcentaje de aviso.
- **Model chip y ModelPicker:** selector de modelo con medidor de costo de 5 barras.
- **Savebar:** barra de guardado al pie. El botón primario se deshabilita sin cambios.
- **Gráficas:** barras con esquina superior redondeada de 4 px, separación de 6 px, tooltip al pasar el cursor, navegación con flechas y tabla alternativa.
- **Estado (badges):** En cola, Corriendo, Lista, Falló, Cancelada.

## Estados

Cada control interactivo define:

- **Reposo.**
- **Hover:** borde en `--line-strong`.
- **Foco:** anillo visible de 2 px en `--signal`. Nunca se quita.
- **Activo.**
- **Deshabilitado:** opacidad 0.4.
- **Cargando:** texto o indicador, sin saltos de diseño.
- **Error:** texto en `--danger` con un texto explicativo. Nunca solo color.

## Movimiento

Transiciones de 150 a 220 ms. Respeta `prefers-reduced-motion`.

## Accesibilidad

- Todo control funciona con teclado.
- El foco siempre es visible.
- Las gráficas tienen tabla alternativa y etiquetas de texto. No dependen solo del color.
- Los objetivos táctiles miden al menos 40 px en móvil.

## Responsive

- Revisar a 390 px y 1440 px.
- Sin scroll horizontal a 390 px.
- En móvil, las tablas se vuelven listas o tienen scroll interno. Nunca desbordan la página.

## Prohibido

- Colores fuera de los tokens.
- Degradados, sombras pesadas y emojis como decoración.
- Texto en mayúsculas sostenidas.
- Ámbar en fondos grandes.
- Tailwind u otro framework de estilos en el código actual.
