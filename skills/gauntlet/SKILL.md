---
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
