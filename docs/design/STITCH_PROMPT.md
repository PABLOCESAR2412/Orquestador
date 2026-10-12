# Prompts para Stitch: rediseño de Orquestador

Usar en stitch.withgoogle.com. Es un rediseño de una app que ya existe: no cambies funciones ni nombres de secciones.

## Flujo

1. Crear un proyecto en Stitch con medio **web**, pensado primero para móvil.
2. Importar `DESIGN.md` (raíz del repo). Si la importación no funciona, pega el contenido de la sección **Color** y **Tipografía**.
3. Pegar el **prompt global** de abajo.
4. Para cada pantalla, pegar su prompt. Stitch recuerda la conversación: usa los prompts de seguimiento para ajustar.
5. Exportar en HTML. Stitch exporta HTML y Tailwind: **pide CSS plano con variables** (`--bg`, `--surface`, etc.) y descarta Tailwind. Las pantallas nuevas van en el prompt de la sección «Pantallas nuevas», que pide CSS plano desde el inicio.
6. Traer el resultado al repo en una rama `design/…` y adaptarlo a los componentes existentes. No copiar el HTML tal cual.

## Prompt global (zoom out)

```text
Orquestador es una app personal de uso individual para lanzar tareas a agentes de IA (OpenCode, Codex y Google). Las tareas corren en un servidor propio y siguen aunque el dispositivo esté apagado. El usuario es un desarrollador independiente que la usa desde el teléfono y desde la computadora. Se instala como PWA.

Interfaz en español. Tema oscuro sobrio: fondo #111419, superficies #181c22 y #20252d, bordes #2a3039, texto #e7e9ec, texto secundario #8c94a0, acento ámbar #d9a441 usado solo para estado activo, alertas y la acción principal. Tipografía Instrument Sans. Estilo minimalista: sin degradados, sin sombras pesadas, sin emojis, sin ilustraciones.

Diseño móvil primero: 390 px de ancho, margen lateral de 16 px, sin scroll horizontal. En escritorio de 1440 px, el contenido va centrado con 720 px de ancho. En la pantalla de chat hay un riel lateral de 260 px con la lista de conversaciones; en móvil ese riel es un cajón que se abre desde un botón de menú.

Este es un rediseño de una app existente. Reutiliza estos componentes: barra de navegación (Chat, Tareas, Proyectos, Analíticas, Ajustes, Servidor), botón de tema (luna o sol) en la cabecera, panel con título, tarjeta de KPI, selector de periodo en píldoras, selector segmentado, chip de modelo con medidor de costo de cinco barras, y barra de guardado al pie. Propón variaciones dentro de esos componentes; no inventes componentes nuevos sin justificarlo.
```

## Pantalla 1: Chat (zoom in)

```text
Pantalla de chat. Riel lateral de 260 px en escritorio con la lista de conversaciones, el título de cada una y un botón "Nueva conversación" arriba. Debajo del riel, la barra de navegación. Área central con los mensajes: los del usuario alineados a la derecha en una burbuja de #20252d; las respuestas del modelo en texto plano, a ancho de columna de 720 px, con espacio generoso entre mensajes. Composer fijo abajo: textarea de varias líneas, y en una fila debajo, el chip del modelo con su medidor de costo, un selector de esfuerzo segmentado (sus opciones cambian según el modelo) que se deshabilita si no hay modelo, y el botón de enviar. Estado "pensando": un texto sutil en #8c94a0 con un indicador discreto. Móvil: el riel es un cajón; el encabezado tiene un botón de menú a la izquierda y el nombre de la conversación al centro.
```

## Pantalla 2: Tareas (zoom in)

```text
Pantalla de tareas. Arriba, el título "Tareas" y la barra de navegación. Luego un formulario de nueva tarea: textarea con contador de caracteres (máximo 10 000), selector de modelo y de esfuerzo que por defecto toma el valor de Ajustes, y el botón primario "Lanzar tarea". Debajo, la lista de tareas: cada fila muestra el texto de la tarea truncado a una línea, una etiqueta de estado (En cola, Corriendo, Lista, Falló o Cancelada) con color discreto y texto, la hora, el modelo usado y el costo. El botón "Cancelar" solo aparece en tareas en cola o corriendo. Estado vacío: "Todavía no hay tareas. Escribe lo que quieres que haga un agente." Móvil: las filas se apilan sin scroll horizontal.
```

## Pantalla 3: Analíticas (zoom in)

```text
Pantalla de analíticas, en una columna de 720 px. Arriba, el título y la barra de navegación. Un selector de periodo en píldoras: 7 días, 30 días y 90 días. Cuatro tarjetas KPI en cuadrícula: Costo, Llamadas, Tokens (con la pista "entrada · salida") y Tareas hechas (con la pista "fallidas · activas"). Panel "Presupuesto del mes" con el texto "US$ gastado de US$ límite", una barra de progreso fina y el estado en texto: En rango, Cerca del límite o Excedido. Solo el estado de alerta usa ámbar. Panel "Costo por día": barras de un solo tono gris (#7b8390), con la barra bajo el cursor en ámbar; ejes con etiquetas de texto. Panel "Costo por modelo": barras horizontales de un solo tono, con el nombre del modelo a la izquierda y el valor a la derecha. Al final, un desplegable "Ver datos en tabla" con los días más recientes primero y paginación de 10 filas. Móvil: las cuatro KPI quedan en dos columnas.
```

## Pantalla 4: Ajustes (zoom in)

```text
Pantalla de ajustes, en una columna de 720 px. Arriba, el título y la barra de navegación. Tres paneles apilados. "Modelo por defecto": chip del modelo y selector de esfuerzo en una fila con su etiqueta. "Presupuesto mensual": campo de texto para el límite en USD con el placeholder "Sin límite", y un selector segmentado para el aviso con las opciones 50 %, 60 %, 70 %, 80 %, 90 % y 100 %. "Instalar la app": un botón primario "Instalar Orquestador" cuando el navegador lo permite, o una instrucción corta según el dispositivo. Barra de guardado al pie, alineada a la derecha: texto "Cambios guardados." en #8c94a0 cuando corresponde, y el botón primario "Guardar cambios", deshabilitado sin cambios. Móvil: los campos de etiqueta y control se apilan.
```

## Pantalla 5: Estado (obsoleta)

La sección Estado ahora se llama **Servidor** y tiene su propio prompt en «Pantallas nuevas». No uses este bloque: la pantalla de estado antigua ya no existe en la app.

## Pantallas nuevas: un solo prompt, CSS plano

Este prompt va aparte porque pide CSS plano con variables y no Tailwind. No lo mezcles con los prompts de las pantallas 1 a 4. Las pantallas nuevas viven en las PR 1 y 2 (`feat/ajustes-ui-proyectos` y `feat/proyectos-instrucciones-memoria`), todavía sin merge; los textos salen de ese código.

```text
Orquestador es una app personal, de un solo usuario, para lanzar tareas a agentes de IA. Las tareas corren en un servidor propio y siguen aunque el dispositivo esté apagado. Se usa desde el teléfono y la computadora, y se instala como PWA. Interfaz en español.

Estas son pantallas nuevas o rediseñadas de una app que ya existe. Usa exactamente los nombres de secciones, botones y textos que aparecen aquí.

ENTREGA DEL CÓDIGO (obligatoria)
- CSS plano, escrito a mano, en un bloque <style> dentro del HTML.
- No uses Tailwind, clases de utilidades, CDN ni ningún framework.
- Define cada color y medida como variable en :root y úsala con var(--nombre). No pongas colores sueltos en las reglas.
- Modo oscuro por defecto. Modo claro bajo [data-theme="claro"], con los mismos nombres de variable.
- Todas las pantallas comparten el mismo bloque de variables.

PALETA Y TIPOGRAFÍA
Oscuro (por defecto): --bg #111419; --surface #181c22; --surface-2 #20252d; --surface-lowest #0d0e11; --line #2a3039; --line-strong #3a414c; --ink #e7e9ec; --ink-2 #8c94a0; --signal #d9a441; --danger #e06b52; --bar #7b8390.
Claro ([data-theme="claro"]): --bg #f6f7f9; --surface #ffffff; --surface-2 #eceff3; --surface-lowest #eef0f3; --line #d5dae1; --line-strong #aeb6c1; --ink #161a21; --ink-2 #5a6170; --signal #8a5a00; --danger #b03a21; --bar #6b7380.
- El ámbar (--signal) solo marca estado activo, alertas y la acción principal. Nunca es texto de cuerpo.
- El rojo (--danger) solo marca errores.
- Sin degradados, sombras pesadas, emojis, ilustraciones ni elementos decorativos.
- Tipografía Instrument Sans, con system-ui de respaldo. Cuerpo de 15 px con interlineado 1.5. Título de página de 24 px, peso 600. Título de panel de 18 px, peso 600. Etiquetas y metadatos de 12 a 14 px, en --ink-2. Números con cifras tabulares.
- Radio de esquinas de 10 px.

MEDIDAS Y ESTRUCTURA
- Móvil de 390 px: margen lateral de 16 px y sin scroll horizontal.
- Escritorio de 1440 px: contenido centrado en una columna de 720 px.
- Barra de navegación con estas secciones, en este orden: Chat, Tareas, Proyectos, Analíticas, Ajustes, Servidor.
- Cabecera de cada pantalla: título a la izquierda y, a la derecha, un botón cuadrado de 36 px (40 px en móvil) con ícono de luna para pasar a modo claro, o de sol para pasar a modo oscuro.
- Paneles: fondo --surface, borde de 1 px en --line, radio de 10 px, título h2 de 18 px.
- Notas de ayuda: texto pequeño en --ink-2.
- Errores: texto en --danger con una frase que diga qué pasó y qué hacer.

PANTALLAS NUEVAS

1. Proyectos
Título "Proyectos" con la barra de navegación. Panel "Nuevo proyecto": campo de nombre (de 1 a 60 caracteres), la carpeta resultante en --ink-2 y el botón primario "Crear proyecto", deshabilitado sin nombre. Debajo del formulario, la nota "La carpeta no cambia: solo el nombre que ves en Telo." Panel "Tus proyectos": cada fila muestra el nombre y la carpeta en --ink-2; si el proyecto está anclado, una etiqueta "· anclado" en --ink-2. Estado vacío: "Todavía no hay proyectos. Crea uno arriba." Si la carga falla, un botón ghost "Reintentar".

2. Proyecto (detalle)
Cabecera: enlace "Volver a proyectos", título con el nombre del proyecto, nota "Carpeta: <ruta>" en --ink-2, botón primario "Tarea nueva en este proyecto" y el botón de tema. No uses pestañas: todo son paneles apilados, en este orden:
- Panel "Siguiente paso". Solo aparece en un proyecto recién creado y se cierra con "Ahora no". Tiene un campo opcional para escribir la primera tarea. Con texto: botón primario "Crear tarea y abrir chat". Sin texto: "Abrir chat del proyecto".
- Resumen del proyecto.
- Panel "Instrucciones": texto que reciben los agentes, con el contador "n / 8.000 caracteres". Botón ghost "Llenar desde el repo" y botón primario "Guardar instrucciones", deshabilitado sin cambios. Tras llenarlo desde el repo, la nota "Añadido desde AGENTS.md, README.md. Revisa el texto y guarda." (con los archivos que correspondan).
- Panel "Memoria": lo que el agente aprendió de tareas anteriores, en bloque de fuente monoespaciada, y el botón ghost "Borrar memoria".
- Panel "Archivos": lista de la carpeta del proyecto con nombre, tamaño y fecha. Al tocar un archivo, su contenido se muestra en texto plano y fuente monoespaciada. Si no es de texto, un aviso en lugar del contenido.
- Panel "Secretos": nombre y valor. El valor guardado nunca se muestra. Si se pega un bloque de varias líneas NOMBRE=valor, aparece la lista de nombres y el botón primario "Guardar N secretos".

3. Programadas (panel dentro de Tareas)
No es una pantalla aparte: es un panel más de Tareas, con el título "Programadas" y el botón "Nueva programada", que cambia a "Cerrar" mientras el formulario está abierto. Cada fila: título, frecuencia ("Cada 6 horas" o "Diaria a las 08:00"), "Próxima: …" si está activa o "En pausa", y una etiqueta "Activa" o "Pausada". Formulario: campo "Proyecto" y un grupo de opciones "Frecuencia" con "Cada cierto número de horas" o la opción diaria. Móvil: campos apilados.

4. Paleta de comandos (Ctrl+K)
Superposición con el velo --scrim. Caja centrada con el campo "Escribe un comando" y el foco al abrir. Grupos de la lista: Nuevo chat; Tareas: Nueva tarea; Ir a: Chat, Tareas, Proyectos, Analíticas, Ajustes, Servidor; Tema: Tema oscuro, Tema claro, Tema del sistema. La fila activa tiene fondo --surface-2 y una línea de 2 px en --signal a la izquierda. Sin coincidencias: "Ningún comando coincide." Se cierra con Escape.

5. Servidor
Título "Servidor" con la barra de navegación y una pastilla de estado (en línea o fuera de línea). Tarjetas de estado en dos columnas en escritorio y una columna por debajo de 680 px, en este orden: Proceso, Latencia, Discos, Carpetas, Herramientas instaladas, Costos, Tareas y Agente. Cada tarjeta muestra su dato principal en grande y el detalle como lista de etiqueta y valor, con la etiqueta en --ink-2. En Latencia, el botón "Medir ahora" (muestra "Midiendo…" mientras corre) y la nota "Medidas con el botón en esta sesión": las medidas no se toman solas.

6. Modelo, esfuerzo y uso (composer del chat)
Una fila: chip del modelo con medidor de costo de cinco barras, selector de esfuerzo segmentado y, a la derecha, el botón pequeño "Uso". Al tocarlo se abre un panel flotante anclado al botón, titulado con el nombre del proveedor, con dos ventanas: "Últimas 5 horas" y "Últimos 7 días", cada una con su uso y su costo. Pie de nota: "Los límites de 5 horas y semanales del proveedor no se leen de su API. Estas cifras son lo que Telo registró." Móvil: el chip y el esfuerzo en una fila; el botón "Uso" nunca desborda el ancho.

7. Revisión de cambios de una tarea
Panel "Revisión de cambios" dentro del detalle de una tarea, con una lista de definición: "Rama" y "Commit base". Diff unificado en fuente monoespaciada: las líneas agregadas llevan + y las quitadas llevan −; el color no es la única señal. El diff tiene su propio contenedor de desplazamiento; la página no tiene scroll horizontal. Acciones, en este orden: botón primario "Aprobar commit"; cuando el commit ya está guardado, botón secundario "Subir rama al remoto". Cada acción tiene debajo una línea que dice qué hace y a dónde va.

REVISIÓN FINAL
Contraste de texto de al menos 4.5:1 sobre --bg en ambos modos; foco visible en todos los controles; sin scroll horizontal a 390 px; ámbar solo para estado activo, alertas y la acción principal; rojo solo para errores; textos en español; ningún color fuera de la paleta.
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
