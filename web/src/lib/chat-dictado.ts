// Soporte de dictado por voz mediante la API de SpeechRecognition del navegador.

export type ReconocimientoVoz = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function ctorVoz(): (new () => ReconocimientoVoz) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => ReconocimientoVoz;
    webkitSpeechRecognition?: new () => ReconocimientoVoz;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function mensajeVoz(codigo: string): string {
  if (codigo === "not-allowed" || codigo === "service-not-allowed") {
    return "Permite el micrófono en el navegador para dictar.";
  }
  if (codigo === "no-speech") return "No se escuchó nada. Intenta de nuevo.";
  if (codigo === "network") return "El dictado necesita conexión y una dirección https.";
  return "No se pudo dictar el mensaje.";
}
