import { useEffect, useState } from "react";

// Latencia medida desde este navegador (ida y vuelta a /api/health). El servidor no la mide.
// "buena" hasta 150 ms, "lenta" por encima, "sin_conexion" si la petición falla.
export type EstadoLatencia = "midiendo" | "buena" | "lenta" | "sin_conexion";
export type Latencia = { ms: number | null; estado: EstadoLatencia };

const UMBRAL_LENTA_MS = 150;
const INTERVALO_MS = 30_000;

export async function medirLatencia(): Promise<{ ms: number | null }> {
  const inicio = performance.now();
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return { ms: null };
    return { ms: Math.round(performance.now() - inicio) };
  } catch {
    return { ms: null };
  }
}

export function clasificarLatencia(ms: number | null): EstadoLatencia {
  if (ms === null) return "sin_conexion";
  return ms <= UMBRAL_LENTA_MS ? "buena" : "lenta";
}

// Mide al montar y cada 30 s. Solo mide mientras la pestaña está visible.
export function useLatencia(): Latencia {
  const [ms, setMs] = useState<number | null>(null);
  const [estado, setEstado] = useState<EstadoLatencia>("midiendo");

  useEffect(() => {
    let vivo = true;
    const correr = async () => {
      if (document.visibilityState === "hidden") return;
      const r = await medirLatencia();
      if (!vivo) return;
      setMs(r.ms);
      setEstado(clasificarLatencia(r.ms));
    };
    void correr();
    const id = window.setInterval(() => void correr(), INTERVALO_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, []);

  return { ms, estado };
}
