# Prompts para Stitch: rediseño de Orquestador

Usar en stitch.withgoogle.com. Es un rediseño de una app que ya existe: no cambies funciones ni nombres de secciones.

## Flujo

1. Crear un proyecto en Stitch con medio **web**, pensado primero para móvil.
2. Importar `DESIGN.md` (raíz del repo). Si la importación no funciona, pega el contenido de la sección **Color** y **Tipografía**.
3. Pegar el **prompt global** de abajo.
4. Para cada pantalla, pegar su prompt. Stitch recuerda la conversación: usa los prompts de seguimiento para ajustar.
5. Exportar en HTML. Stitch exporta HTML y Tailwind: **pide CSS plano con variables** (`--bg`, `--surface`, etc.) y descarta Tailwind.
6. Traer el resultado al repo en una rama `design/…` y adaptarlo a los componentes existentes. No copiar el HTML tal cual.

## Prompt global (zoom out)

```text
Orquestador es una app personal de uso individual para lanzar tareas a agentes de IA (OpenCode, Codex y Google). Las tareas corren en un servidor propio y siguen aunque el dispositivo esté apagado. El usuario es un desarrollador independiente que la usa desde el teléfono y desde la computadora. Se instala como PWA.

Interfaz en español. Tema oscuro sobrio: fondo #111419, superficies #181c22 y #20252d, bordes #2a3039, texto #e7e9ec, texto secundario #8c94a0, acento ámbar #d9a441 usado solo para estado activo, alertas y la acción principal. Tipografía Instrument Sans. Estilo minimalista: sin degradados, sin sombras pesadas, sin emojis, sin ilustraciones.

Diseño móvil primero: 390 px de ancho, margen lateral de 16 px, sin scroll horizontal. En escritorio de 1440 px, el contenido va centrado con 720 px de ancho. En la pantalla de chat hay un riel lateral de 264 px con la lista de conversaciones; en móvil ese riel es un cajón que se abre desde un botón de menú.

Este es un rediseño de una app existente. Reutiliza estos componentes: barra de navegación (Chat, Tareas, Analíticas, Ajustes, Estado), panel con título, tarjeta de KPI, selector de periodo en píldoras, selector segmentado, chip de modelo con medidor de costo de cinco barras, y barra de guardado al pie. Propón variaciones dentro de esos componentes; no inventes componentes nuevos sin justificarlo.
```

## Pantalla 1: Chat (zoom in)

```text
Pantalla de chat. Riel lateral de 264 px en escritorio con la lista de conversaciones, el título de cada una y un botón "Nueva conversación" arriba. Debajo del riel, la barra de navegación. Área central con los mensajes: los del usuario alineados a la derecha en una burbuja de #20252d; las respuestas del modelo en texto plano, a ancho de columna de 720 px, con espacio generoso entre mensajes. Composer fijo abajo: textarea de varias líneas, y en una fila debajo, el chip del modelo con su medidor de costo, un selector de esfuerzo segmentado (sus opciones cambian según el modelo) que se deshabilita si no hay modelo, y el botón de enviar. Estado "pensando": un texto sutil en #8c94a0 con un indicador discreto. Móvil: el riel es un cajón; el encabezado tiene un botón de menú a la izquierda y el nombre de la conversación al centro.
```

## Pantalla 2: Tareas (zoom in)

```text
Pantalla de tareas. Arriba, el título "Tareas" y la barra de navegación. Luego un formulario de nueva tarea: textarea con contador de caracteres (máximo 10 000), selector de modelo y de esfuerzo que por defecto toma el valor de Ajustes, y el botón primario "Lanzar tarea". Debajo, la lista de tareas: cada fila muestra el texto de la tarea truncado a una línea, una etiqueta de estado (En cola, Corriendo, Lista, Falló o Cancelada) con color discreto y texto, la hora, el modelo usado y el costo. El botón "Cancelar" solo aparece en tareas en cola o corriendo. Estado vacío: "Todavía no hay tareas. Escribe lo que quieres que haga un agente." Móvil: las filas se apilan sin scroll horizontal.
```

## Pantalla 3: Analíticas (zoom in)

```text
Pantalla de analíticas, en una columna de 720 px. Arriba, el título y la barra de navegación. Un selector de periodo en píldoras: 7 días, 30 días y 90 días. Cuatro tarjetas KPI en cuadrícula: Costo, Llamadas, Tokens (con la pista "entrada · salida") y Tareas hechas (con la pista "fallidas · activas"). Panel "Presupuesto del mes" con el texto "US$ gastado de US$ límite", una barra de progreso fina y el estado en texto: En rango, Cerca del límite o Excedido. Solo el estado de alerta usa ámbar. Panel "Costo por día": barras de un solo tono gris (#7b8390), con la barra bajo el cursor en ámbar; ejes con etiquetas de texto. Panel "Costo por modelo": barras horizontales de un solo tono, con el nombre del modelo a la izquierda y el valor a la derecha. Al final, un desplegable "Ver datos en tabla". Móvil: las cuatro KPI quedan en dos columnas.
```

## Pantalla 4: Ajustes (zoom in)

```text
Pantalla de ajustes, en una columna de 720 px. Arriba, el título y la barra de navegación. Tres paneles apilados. "Modelo por defecto": chip del modelo y selector de esfuerzo en una fila con su etiqueta. "Presupuesto mensual": campo de texto para el límite en USD con el placeholder "Sin límite", y un selector segmentado para el aviso con las opciones 50 %, 60 %, 70 %, 80 %, 90 % y 100 %. "Instalar la app": un botón primario "Instalar Orquestador" cuando el navegador lo permite, o una instrucción corta según el dispositivo. Barra de guardado al pie, alineada a la derecha: texto "Cambios guardados." en #8c94a0 cuando corresponde, y el botón primario "Guardar cambios", deshabilitado sin cambios. Móvil: los campos de etiqueta y control se apilan.
```

## Pantalla 5: Estado (zoom in)

```text
Pantalla de estado del sistema, en una columna de 720 px. Arriba, el título y la barra de navegación. Una tarjeta por dato: estado del servidor, estado de la base de datos y la última tarea ejecutada con su estado. Mantén los mismos datos que muestra hoy la pantalla de estado; revisa su código antes de cambiar el contenido. Estilo sobrio, sin gráficas.
```

## Prompt de revisión (zoom in, al final)

```text
Revisa todas las pantallas contra estas reglas y corrige lo que no las cumpla: contraste de texto de al menos 4.5:1 sobre #111419; foco visible en todos los controles; sin scroll horizontal a 390 px; el ámbar solo como señal de estado o acción principal; todos los textos en español; ningún color fuera de la paleta indicada; ningún elemento decorativo sin función.
```

## Prompts de seguimiento

- "Haz las tarjetas de KPI más compactas, con el valor y la etiqueta en una sola línea en escritorio."
- "Mantén la paleta, pero baja el contraste de los bordes para que los paneles se separen menos del fondo."
- "Muestra el composer con una sola fila en escritorio y dos filas en móvil."
- "Quita cualquier elemento que no tenga función."
- "Muestra la versión móvil de la pantalla de chat con el cajón de conversaciones abierto."
