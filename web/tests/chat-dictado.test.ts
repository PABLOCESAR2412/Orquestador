import { expect, test } from "bun:test";
import {
  crearDictador,
  mensajeSinDictado,
  mensajeVoz,
  type EventoVoz,
  type ReconocimientoVoz,
} from "../src/lib/chat-dictado";

// Un reconocimiento falso con memoria de cuántas veces arrancó y paró.
type Falsa = ReconocimientoVoz & { arrancadas: number; parada: boolean };

function arnes() {
  const creadas: Falsa[] = [];
  const construir = (): ReconocimientoVoz => {
    const falsa: Falsa = {
      lang: "",
      continuous: false,
      interimResults: false,
      arrancadas: 0,
      parada: false,
      start() {
        falsa.arrancadas += 1;
      },
      stop() {
        falsa.parada = true;
      },
      onresult: null,
      onerror: null,
      onend: null,
    };
    creadas.push(falsa);
    return falsa;
  };
  return { creadas, construir };
}

// Evento del motor: el arreglo COMPLETO de resultados —como lo manda el navegador— y el
// índice donde empiezan los tramos nuevos ([texto, final], en orden de llegada).
function eventoVoz(tramos: Array<[string, boolean]>, desde: number): EventoVoz {
  const results = tramos.map(([texto, final]) => ({
    isFinal: final,
    length: 1,
    0: { transcript: texto },
  })) as unknown as EventoVoz["results"];
  return { resultIndex: desde, results };
}

test("compone el borrador con lo dicho y no duplica al confirmar un tramo", () => {
  const { creadas, construir } = arnes();
  const textos: string[] = [];
  const dictador = crearDictador({
    construir,
    lenguaje: "es-419",
    componer: (t) => textos.push(t),
    avisar: () => {},
    alCambiar: () => {},
  });
  dictador.alternar("base ");
  const rec = creadas[0]!;
  expect(rec.lang).toBe("es-419");
  expect(rec.continuous).toBe(true);
  expect(rec.interimResults).toBe(true);
  // Tramo en curso: se muestra mientras se habla.
  rec.onresult!(eventoVoz([["hola", false]], 0));
  expect(textos.at(-1)).toBe("base hola");
  // El mismo tramo confirmado en su índice no se escribe dos veces.
  rec.onresult!(eventoVoz([["hola", true]], 0));
  expect(textos.at(-1)).toBe("base hola");
  // Tramos nuevos se acumulan; el interino de atrás ya no vuelve a pintarse.
  rec.onresult!(eventoVoz([["hola", true], ["mundo", false]], 1));
  expect(textos.at(-1)).toBe("base hola mundo");
  rec.onresult!(eventoVoz([["hola", true], ["mundo", true]], 1));
  expect(textos.at(-1)).toBe("base hola mundo");
  expect(dictador.activo()).toBe(true);
});

test("reanuda el reconocimiento cuando el motor corta mientras se dicta", () => {
  const { creadas, construir } = arnes();
  let activo = false;
  const dictador = crearDictador({
    construir,
    lenguaje: "es",
    componer: () => {},
    avisar: () => {},
    alCambiar: (a) => (activo = a),
  });
  dictador.alternar("");
  const rec = creadas[0]!;
  expect(rec.arrancadas).toBe(1);
  rec.onend!();
  // El corte del motor (silencio o ~1 min) reanuda con lo acumulado.
  expect(rec.arrancadas).toBe(2);
  expect(activo).toBe(true);
  expect(dictador.activo()).toBe(true);
  // Detener de verdad cierra sin reanudar y los tramos tardíos no vuelven a escribir.
  dictador.detener();
  expect(rec.parada).toBe(true);
  expect(rec.onresult).toBe(null);
  expect(activo).toBe(false);
});

test("Android puede repetir y corregir finales desde cero sin acumular versiones", () => {
  const { creadas, construir } = arnes();
  let texto = "";
  const dictador = crearDictador({ construir, lenguaje: "es", componer: (t) => texto = t, avisar() {}, alCambiar() {} });
  dictador.alternar("Base");
  const rec = creadas[0]!;
  for (const frase of ["necesito", "necesito", "necesito en video", "necesito en video el resultado"]) {
    rec.onresult!(eventoVoz([[frase, true]], 0));
    expect(texto).toBe(`Base ${frase}`);
  }
  rec.onend!();
  rec.onresult!(eventoVoz([["con voz", true]], 0));
  rec.onresult!(eventoVoz([["con voz", true]], 0));
  expect(texto).toBe("Base necesito en video el resultado con voz");
});

test("retira interinos descartados y conserva repeticiones realmente dictadas", () => {
  const { creadas, construir } = arnes();
  let texto = "";
  const dictador = crearDictador({ construir, lenguaje: "es", componer: (t) => texto = t, avisar() {}, alCambiar() {} });
  dictador.alternar("");
  const rec = creadas[0]!;
  rec.onresult!(eventoVoz([["sí", true], ["borrador", false]], 0));
  rec.onresult!(eventoVoz([["sí", true]], 1));
  expect(texto).toBe("sí");
  rec.onresult!(eventoVoz([["sí", true], ["sí", true]], 1));
  expect(texto).toBe("sí sí");
});

test("un dictado nuevo no lo matan los cortes de la instancia vieja", () => {
  const { creadas, construir } = arnes();
  let activo = false;
  const dictador = crearDictador({
    construir,
    lenguaje: "es",
    componer: () => {},
    avisar: () => {},
    alCambiar: (a) => (activo = a),
  });
  dictador.alternar("");
  const vieja = creadas[0]!;
  dictador.detener();
  dictador.alternar("");
  const nueva = creadas[1]!;
  expect(activo).toBe(true);
  // El onend tardío de la instancia vieja no corta el dictado nuevo.
  vieja.onend!();
  expect(activo).toBe(true);
  expect(dictador.activo()).toBe(true);
  // La nueva reanuda sola tras su propio corte.
  nueva.onend!();
  expect(nueva.arrancadas).toBe(2);
});

test("avisa los errores de permiso, corta con red rota y calla al abortar", () => {
  const { creadas, construir } = arnes();
  const avisos: string[] = [];
  let activo = false;
  const dictador = crearDictador({
    construir,
    lenguaje: "es",
    componer: () => {},
    avisar: (m) => avisos.push(m),
    alCambiar: (a) => (activo = a),
  });
  dictador.alternar("");
  const rec = creadas[0]!;
  // Abortado es la pausa del motor al renovar el oyente: sin aviso y sigue dictando.
  rec.onerror!({ error: "aborted" });
  expect(avisos).toEqual([]);
  expect(activo).toBe(true);
  rec.onerror!({ error: "not-allowed" });
  expect(avisos).toEqual(["Permite el micrófono en el navegador para dictar."]);
  expect(activo).toBe(false);
});

test("sin motor disponible explica por qué y no queda dictando", () => {
  let activo = false;
  const avisos: string[] = [];
  const dictador = crearDictador({
    construir: () => null,
    lenguaje: "es",
    componer: () => {},
    avisar: (m) => avisos.push(m),
    alCambiar: (a) => (activo = a),
  });
  dictador.alternar("");
  expect(avisos).toEqual([mensajeSinDictado()]);
  expect(activo).toBe(false);
  expect(dictador.activo()).toBe(false);
});

test("los mensajes de voz traducen los códigos del motor", () => {
  expect(mensajeVoz("no-speech")).toContain("No se escuchó nada");
  expect(mensajeVoz("network")).toContain("https");
  expect(mensajeVoz("aborted")).toBe("");
});
