import { isIP } from "node:net";

export type LimitesLogin = { ip: boolean; global: boolean };

export class LimitadorLogin {
  private readonly porIp = new Map<string, number[]>();
  private fallosGlobales: number[] = [];

  constructor(
    private readonly ventanaMs = 15 * 60_000,
    private readonly maxPorIp = 10,
    private readonly maxGlobal = 50,
  ) {}

  limites(ip: string, ahora = Date.now()): LimitesLogin {
    const desde = ahora - this.ventanaMs;
    this.fallosGlobales = this.fallosGlobales.filter((t) => t >= desde);
    for (const [direccion, intentos] of this.porIp) {
      const validos = intentos.filter((t) => t >= desde);
      if (validos.length) this.porIp.set(direccion, validos);
      else this.porIp.delete(direccion);
    }
    return {
      ip: (this.porIp.get(ip)?.length ?? 0) >= this.maxPorIp,
      global: this.fallosGlobales.length >= this.maxGlobal,
    };
  }

  registrarFallo(ip: string, ahora = Date.now()): void {
    this.fallosGlobales.push(ahora);
    const intentos = this.porIp.get(ip) ?? [];
    intentos.push(ahora);
    this.porIp.set(ip, intentos);
  }

  limpiar(ip: string): void {
    this.porIp.delete(ip);
  }
}

export function validarIp(candidato: string | undefined): string | null {
  if (!candidato) return null;
  const limpio = candidato.trim();
  return isIP(limpio) === 0 ? null : limpio;
}

// El límite global frena intentos incorrectos distribuidos, pero no bloquea al dueño que conoce la clave.
export function bloquearIntento(limites: LimitesLogin, claveValida: boolean): boolean {
  return !claveValida && (limites.ip || limites.global);
}
