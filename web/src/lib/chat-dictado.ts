// Soporte de dictado por voz mediante la API de SpeechRecognition del navegador.
// El motor corta el reconocimiento tras un silencio o cada ~60 s: el dictador reanuda
// mientras el usuario sigue dictando, compone el borrador con los tramos ya confirmados
// más lo que se dice en el momento y no repite texto al pasar un tramo de interino a final.

export type SegmentoVoz = { transcript: string };

// Un resultado confirma (isFinal) o trae lo que se dice en el momento; cada uno expone
// alternativas por índice y se usa la primera.
export type ResultadoVoz = ArrayLike<SegmentoVoz> & { isFinal: boolean };

export type EventoVoz = {
  resultIndex: number;
  results: ArrayLike<ResultadoVoz>;
};

export type ReconocimientoVoz = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function ctorVoz(): (new () => ReconocimientoVoz) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => ReconocimientoVoz;
    webkitSpeechRecognition?: new () => ReconocimientoVoz;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Chrome pide un contexto seguro (https) para el dictado: en http la API existe pero el
// motor falla al arrancar. Si falta algo, el botón igual responde y explica qué pasa.
export function vozDisponible(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext === false) return false;
  return ctorVoz() !== null;
}

export function mensajeSinDictado(): string {
  return "El dictado necesita Chrome o Edge sobre una página https (Telo Serve lo da). Firefox y navegadores sin SpeechRecognition no lo traen.";
}

export function mensajeVoz(codigo: string): string {
  if (codigo === "not-allowed" || codigo === "service-not-allowed") {
    return "Permite el micrófono en el navegador para dictar.";
  }
  if (codigo === "no-speech") return "No se escuchó nada. Intenta de nuevo.";
  if (codigo === "network") return "El dictado necesita conexión y una dirección https.";
  // Abortado es la pausa del motor al renovar el oyente o al detener: no amerita aviso.
  if (codigo === "aborted") return "";
  return "No se pudo dictar el mensaje.";
}

export type Dictador = {
  activo(): boolean;
  alternar(borrador: string): void;
  detener(): void;
};

export function crearDictador(opciones: {
  construir: () => ReconocimientoVoz | null;
  lenguaje: string;
  componer: (texto: string) => void;
  avisar: (mensaje: string) => void;
  alCambiar: (activo: boolean) => void;
}): Dictador {
  const { construir, componer, avisar, alCambiar } = opciones;
  let instancia: ReconocimientoVoz | null = null;
  let activo = false;
  // El borrador tal como estaba al arrancar; el dictado se añade después de él.
  let base = "";
  // Tramos ya confirmados por el motor y el tramo en curso (se reescribe con cada evento).
  let terminado = "";
  let enCurso = "";

  const separador = (texto: string) => (texto && !/\s$/.test(texto) ? " " : "");
  const junta = (izquierda: string, derecha: string) => {
    if (!izquierda) return derecha;
    if (!derecha) return izquierda;
    return `${izquierda} ${derecha}`;
  };

  const pintar = () => {
    const voz = junta(terminado, enCurso);
    componer(voz ? `${base}${separador(base)}${voz}` : base);
  };

  const cortar = () => {
    activo = false;
    instancia = null;
    alCambiar(false);
  };

  const detener = () => {
    if (!activo) {
      cortar();
      return;
    }
    activo = false;
    const rec = instancia;
    instancia = null;
    // Sin oyente: los resultados tardíos no vuelven a llenar el compositor.
    if (rec) rec.onresult = null;
    try {
      rec?.stop();
    } catch {
      // Ya estaba parado: nada que hacer.
    }
    alCambiar(false);
  };

  return {
    activo: () => activo,
    alternar: (borrador: string) => {
      if (activo) {
        detener();
        return;
      }
      const rec = construir();
      if (!rec) {
        avisar(mensajeSinDictado());
        return;
      }
      base = borrador;
      terminado = "";
      enCurso = "";
      instancia = rec;
      activo = true;
      alCambiar(true);
      rec.lang = opciones.lenguaje || "es-ES";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        // Resultados de una instancia reemplazada o de un dictado ya cortado: fuera.
        if (!activo || instancia !== rec) return;
        // Solo los tramos nuevos (desde resultIndex): los confirmados que el motor
        // renueva con el mismo índice no deben escribirse dos veces.
        for (let i = Math.max(0, e.resultIndex); i < e.results.length; i++) {
          const segmento = e.results[i];
          const texto = segmento?.[0]?.transcript;
          if (!texto) continue;
          if (segmento.isFinal) {
            const limpio = texto.trim();
            if (limpio) terminado = junta(terminado, limpio);
            enCurso = "";
          } else {
            enCurso = texto.trim();
          }
        }
        pintar();
      };
      rec.onerror = (e) => {
        if (instancia !== rec) return;
        const mensaje = mensajeVoz(e.error);
        if (mensaje) avisar(mensaje);
        if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "network") cortar();
      };
      rec.onend = () => {
        if (instancia !== rec) return;
        if (!activo) {
          cortar();
          return;
        }
        // El motor corta solo (silencio o un minuto): mientras el usuario siga dictando,
        // se vuelve a arrancar con el mismo texto acumulado.
        try {
          rec.start();
        } catch {
          cortar();
        }
      };
      try {
        rec.start();
      } catch {
        // Motor indisponible en el arranque (permiso o contexto): aviso y señal clara.
        avisar(mensajeSinDictado());
        cortar();
      }
    },
    detener,
  };
}
