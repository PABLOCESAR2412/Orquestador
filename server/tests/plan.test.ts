import { describe, expect, test } from "bun:test";
import {
  extraerJson,
  hashPlan,
  MAX_PLANES,
  promptAnalizador,
  promptObrero,
  promptReparacion,
  requiereAprobacion,
  serializarRespuestaTarea,
  validarPlan,
  validarReporte,
  type Plan,
} from "../src/plan";

const planValido = {
  objetivo: "Ordenar las notas",
  pasos: [{ descripcion: "Listar las notas", archivos: ["notas/"] }, { descripcion: "Moverlas por fecha" }],
  criterios_de_aceptacion: ["Cada nota está en su carpeta"],
};

describe("extraerJson", () => {
  test("lee un objeto JSON directo", () => {
    expect(extraerJson('{"a": 1}')).toEqual({ a: 1 });
  });

  test("lee el último bloque ```json cuando hay varios", () => {
    const texto = 'Primero:\n```json\n{"v": 1}\n```\nLuego:\n```json\n{"v": 2}\n```';
    expect(extraerJson(texto)).toEqual({ v: 2 });
  });

  test("lee el objeto aunque haya texto alrededor", () => {
    expect(extraerJson('Aquí va el plan: {"objetivo": "x"} gracias')).toEqual({ objetivo: "x" });
  });

  test("devuelve undefined si no hay JSON", () => {
    expect(extraerJson("sin llaves ni nada")).toBeUndefined();
    expect(extraerJson("{ roto")).toBeUndefined();
  });
});

describe("validarPlan", () => {
  test("acepta un plan mínimo y completa las listas que faltan", () => {
    const v = validarPlan(planValido);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.valor.pasos.map((p) => p.id)).toEqual([1, 2]);
    expect(v.valor.pasos[0].archivos).toEqual(["notas/"]);
    expect(v.valor.requiere_aprobacion).toEqual([]);
    expect(v.valor.preguntas).toEqual([]);
  });

  test("descarta aprobaciones que no son commit, push ni pr", () => {
    const v = validarPlan({ ...planValido, requiere_aprobacion: ["commit", "borrar_todo", "commit", "push"] });
    expect(v.ok && v.valor.requiere_aprobacion).toEqual(["commit", "push"]);
  });

  test("rechaza lo que no es un objeto, el objetivo vacío, los pasos y los criterios", () => {
    expect(validarPlan([]).ok).toBe(false);
    expect(validarPlan({ ...planValido, objetivo: "  " }).ok).toBe(false);
    expect(validarPlan({ ...planValido, pasos: [] }).ok).toBe(false);
    expect(validarPlan({ ...planValido, pasos: [{ archivos: [] }] }).ok).toBe(false);
    expect(validarPlan({ ...planValido, criterios_de_aceptacion: [] }).ok).toBe(false);
  });

  test("rechaza más de 12 pasos con un motivo que el analizador entiende", () => {
    const pasos = Array.from({ length: 13 }, (_, i) => ({ descripcion: `Paso ${i + 1}` }));
    const v = validarPlan({ ...planValido, pasos });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("más de 12 pasos");
  });

  test("limita las preguntas bloqueantes a tres por turno", () => {
    const v = validarPlan({ ...planValido, preguntas: ["Una", "Dos", "Tres", "Cuatro"] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("más de 3 preguntas");
  });

  test("rechaza rutas fuera del workspace y cualquier segmento .git antes de aprobar", () => {
    for (const ruta of ["/etc/passwd","\\\\servidor\\archivo","C:/repo/archivo","C:archivo","../otro","src/../../otro",".git/","src/.git/hooks/pre-commit","src\\.GIT\\config","./","src\u0000archivo"]) {
      const valor = { ...planValido, pasos: [{ descripcion: "Revisar archivos", archivos: [ruta] }] };
      const validacion = validarPlan(valor);
      expect(validacion.ok, ruta).toBe(false);
    }
  });
});

describe("requiereAprobacion", () => {
  const base = { ...(validarPlan(planValido) as { valor: Plan }).valor };

  test("pide aprobación con commit, push, pr o preguntas", () => {
    expect(requiereAprobacion({ ...base, requiere_aprobacion: ["pr"] })).toBe(true);
    expect(requiereAprobacion({ ...base, preguntas: ["¿Qué carpeta?"] })).toBe(true);
  });

  test("no pide aprobación si el plan es solo de lectura y trabajo en el espacio de la tarea", () => {
    expect(requiereAprobacion(base)).toBe(false);
  });
});

describe("validarReporte", () => {
  test("sin JSON estructurado, el texto libre no confirma que el plan se completó", () => {
    const r = validarReporte(undefined, "Listo, ordené las notas.");
    expect(r.estado).toBe("fallo");
    expect(r.resumen).toContain("reporte estructurado obligatorio");
    expect(r.desviacion).toBeNull();
  });

  test("una respuesta vacía no se presenta como una tarea completada", () => {
    const r = validarReporte(undefined, "");
    expect(r.estado).toBe("fallo");
    expect(r.resumen).toContain("No se puede confirmar");
  });

  test("un reporte sin resumen ni resultados verificables tampoco pasa como éxito", () => {
    const r = validarReporte({ estado: "completado", resumen: "", cambios: [], pruebas: [], pendientes: [] }, "");
    expect(r.estado).toBe("fallo");
    expect(r.resumen).toContain("No se puede confirmar el resultado");
  });

  test("conserva el tipo de cambio para redactar commits desde el resultado real", () => {
    const r = validarReporte({ estado: "completado", resumen: "Se corrigió la sincronización.", tipo_cambio: "fix" }, "");
    expect(r.tipo_cambio).toBe("fix");
    expect(JSON.parse(serializarRespuestaTarea(r)).tipo_cambio).toBe("fix");
    expect(validarReporte({ estado: "completado", resumen: "Actualizado.", tipo_cambio: "inventado" }, "").tipo_cambio).toBeUndefined();
  });

  test("un reporte que solo enumera pendientes no confirma que la tarea se completó", () => {
    const r = validarReporte({ estado: "completado", resumen: "", cambios: [], pruebas: [], pendientes: ["Revisar el resultado"] }, "");
    expect(r.estado).toBe("fallo");
    expect(r.pendientes).toEqual(["Revisar el resultado"]);
  });

  test("si hay resultados pero falta el resumen, explica lo que sí quedó registrado", () => {
    const r = validarReporte({ estado: "completado", resumen: "", cambios: [{ archivo: "src/app.ts", tipo: "editar" }], pruebas: [{ comando: "bun test", resultado: "ok" }] }, "");
    expect(r.estado).toBe("completado");
    expect(r.resumen).toContain("registró 1 cambio(s), 1 prueba(s)");
  });

  test("una desviación con motivo cambia el estado aunque venga como 'completado'", () => {
    const r = validarReporte({ estado: "completado", resumen: "", desviacion: "Falta permiso" }, "");
    expect(r.estado).toBe("desviacion");
    expect(r.desviacion).toBe("Falta permiso");
  });

  test("estado 'desviacion' sin motivo se marca con un texto por defecto", () => {
    const r = validarReporte({ estado: "desviacion", desviacion: null }, "");
    expect(r.estado).toBe("desviacion");
    expect(r.desviacion).toBe("Sin motivo indicado.");
  });

  test("un fallo se conserva y las listas inválidas se descartan", () => {
    const r = validarReporte(
      {
        estado: "fallo",
        resumen: "No se pudo.",
        cambios: [{ archivo: "a.ts", tipo: "editar" }, { tipo: "crear" }, "x"],
        pruebas: [{ comando: "bun test", resultado: "fallo" }, {}],
        pendientes: ["Revisar", 3],
      },
      "",
    );
    expect(r.estado).toBe("fallo");
    expect(r.cambios).toEqual([{ archivo: "a.ts", tipo: "editar" }]);
    expect(r.pruebas).toEqual([{ comando: "bun test", resultado: "fallo" }]);
    expect(r.pendientes).toEqual(["Revisar"]);
  });

  test("un reporte exitoso con una prueba en fallo termina como fallo", () => {
    const r = validarReporte(
      {
        estado: "completado",
        resumen: "Todo listo.",
        cambios: [{ archivo: "src/app.ts", tipo: "editar" }],
        pruebas: [{ comando: "bun test", resultado: "ok" }, { comando: "bun run build", resultado: "fallo" }],
        pendientes: [],
      },
      "",
    );
    expect(r.estado).toBe("fallo");
    expect(r.resumen).toContain("Todo listo.");
    expect(r.resumen).toContain("Marcado como fallo por el servidor");
  });

  test("una prueba en fallo no toca una desviación ya declarada", () => {
    const r = validarReporte(
      { estado: "completado", resumen: "Me faltó permiso.", desviacion: "Falta la API key", pruebas: [{ comando: "bun test", resultado: "fallo" }] },
      "",
    );
    expect(r.estado).toBe("desviacion");
    expect(r.resumen).not.toContain("Marcado como fallo");
  });

  test("marca faltantes de workspace y credenciales como bloqueantes externos", () => {
    const r = validarReporte({
      estado: "fallo",
      resumen: "El workspace sigue sin package.json, lockfile, fuentes ni dist/; CLOUDFLARE_API_TOKEN no está disponible.",
      cambios: [],
      pruebas: [],
      pendientes: ["Configurar Cloudflare y preparar el proyecto"],
    }, "");
    expect(r.estado).toBe("fallo");
    expect(r.bloqueante_externo).toContain("CLOUDFLARE_API_TOKEN");
    expect(r.bloqueante_externo).toContain("workspace");
    expect(r.desviacion).toBeNull();
  });
});

describe("serializarRespuestaTarea", () => {
  test("conserva estado, pruebas y rutas para que el chat muestre el informe completo", () => {
    const respuesta = JSON.parse(serializarRespuestaTarea({
      estado: "fallo",
      resumen: "Falló la prueba de auditoría.",
      cambios: [{ archivo: "tests/auditoria.test.ts", tipo: "editar" }],
      pruebas: [{ comando: "bun test tests/auditoria.test.ts", resultado: "fallo" }],
      pendientes: ["Corregir la expectativa"],
      diff_disponible: true,
      desviacion: "La prueba esperaba otro estado.",
      bloqueante_externo: "Falta una credencial.",
    }));
    expect(respuesta).toMatchObject({
      tipo: "telo_reporte_tarea",
      version: 1,
      estado: "fallo",
      resumen: "Falló la prueba de auditoría.",
      desviacion: "La prueba esperaba otro estado.",
      cambios: [{ archivo: "tests/auditoria.test.ts", tipo: "editar" }],
      pruebas: [{ comando: "bun test tests/auditoria.test.ts", resultado: "fallo" }],
      pendientes: ["Corregir la expectativa"],
      bloqueante_externo: "Falta una credencial.",
    });
  });
});

describe("prompts", () => {
  test("el analizador y su reparación omiten .git y rutas externas", () => {
    expect(promptAnalizador("Prepara un cambio")).toContain(".git no es un archivo del plan");
    const reparacion = promptReparacion("el paso 1 incluye una ruta dentro de .git");
    expect(reparacion).toContain("no incluyas rutas absolutas");
    expect(reparacion).toContain("segmento .git");
  });

  test("el analizador no convierte una tarea normal en una aprobación de plan", () => {
    const prompt = promptAnalizador("Investiga el error y agrega una prueba");
    expect(prompt).toContain("La revisión del plan no es un paso obligatorio");
    expect(prompt).toContain("no requieren aprobación previa por sí solos");
  });

  test("el analizador detiene los despliegues para confirmar destino, plataforma y repositorio", () => {
    const prompt = promptAnalizador("Publica el sitio");
    expect(prompt).toContain("incluye una confirmación final");
    expect(prompt).toContain("Vercel, Cloudflare Workers o Cloudflare Pages");
    expect(prompt).toContain("conexión del repositorio");
    expect(prompt).toContain("Respeta el máximo de 3 preguntas");
  });

  test("el analizador expone pasos y preguntas bloqueantes, no razonamiento interno", () => {
    const prompt = promptAnalizador("Corrige el error y compruébalo");
    expect(prompt).toContain("identifica la intención, las restricciones, las precondiciones");
    expect(prompt).toContain("preguntas que bloqueen el trabajo");
    expect(prompt).toContain("no incluyas razonamiento interno detallado");
    expect(prompt).toContain("agrupa hasta 3 preguntas concretas por turno");
    expect(prompt).toContain("recomienda una opción");
  });

  test("el obrero clasifica el cambio y resume el resultado, no el prompt", () => {
    const plan = (validarPlan(planValido) as { valor: Plan }).valor;
    const prompt = promptObrero(plan);
    expect(prompt).toContain("Resume el resultado observado, no copies el prompt ni el título");
    expect(prompt).toContain("tipo_cambio");
    expect(prompt).toContain("feat para capacidad nueva, fix para fallo corregido");
    expect(prompt).toContain("bloqueante_externo");
  });

  test("el obrero recibe el plan y las notas del usuario", () => {
    const plan = { ...(validarPlan(planValido) as { valor: Plan }).valor, notas: "Usa la rama principal" };
    const texto = promptObrero(plan);
    expect(texto).toContain("Ordenar las notas");
    expect(texto).toContain("Usa la rama principal");
    expect(texto).toContain("No hagas commit, push ni PR");
    expect(texto).toContain("Telo ejecutará esas operaciones");
    expect(texto).toContain("Telo conserva el remoto fuera del workspace");
    expect(texto).toContain("evita solapamientos, recortes y etiquetas ilegibles");
    expect(promptAnalizador("Commit y push")).toContain("No incluyas su ejecución como pasos del obrero");
  });

  test("sin notas, el obrero no recibe la sección de notas", () => {
    const plan = (validarPlan(planValido) as { valor: Plan }).valor;
    expect(promptObrero(plan)).not.toContain("Notas y respuestas del usuario");
  });

  test("una replanificación incluye el motivo y el plan anterior", () => {
    const plan = (validarPlan(planValido) as { valor: Plan }).valor;
    const texto = promptAnalizador("Ordena las notas", { planAnterior: plan, motivo: "Falta la base de datos" });
    expect(texto).toContain("Falta la base de datos");
    expect(texto).toContain("Plan anterior:");
    expect(texto).toContain("Ordenar las notas");
  });

  test("el tope de planes es el plan inicial más una replanificación", () => {
    expect(MAX_PLANES).toBe(2);
  });
});

describe("hashPlan", () => {
  test("produce un sha256 hexadecimal consistente sensible a cambios del plan e ignora notas", () => {
    const plan = (validarPlan(planValido) as { valor: Plan }).valor;
    const hash1 = hashPlan(plan);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    const hashConNotas = hashPlan({ ...plan, notas: "nota del usuario al aprobar" });
    expect(hashConNotas).toBe(hash1);
    const hashModificado = hashPlan({ ...plan, objetivo: "Otro objetivo" });
    expect(hashModificado).not.toBe(hash1);
  });
});
