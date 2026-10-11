// Formatos compartidos por Tareas, Proyectos y Servidor.

// Fecha corta en hora local. Acepta ISO (con o sin zona) y el formato SQL en UTC ("2026-10-09 04:50:16").
export function cuando(valor: string | null | undefined): string {
  if (!valor) return "";
  const conZona = /[Tt].*(Z|[+-]\d\d:?\d\d)$/.test(valor);
  const iso = conZona ? valor : `${valor.replace(" ", "T")}Z`;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return valor;
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(fecha);
}

// Hora sola, para las líneas de tiempo.
export function hora(valor: string | null | undefined): string {
  if (!valor) return "";
  const conZona = /[Tt].*(Z|[+-]\d\d:?\d\d)$/.test(valor);
  const fecha = new Date(conZona ? valor : `${valor.replace(" ", "T")}Z`);
  if (Number.isNaN(fecha.getTime())) return valor;
  return fecha.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Sin dato";
  if (bytes < 1024) return `${bytes} bytes`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const decimales = valor < 10 ? 1 : 0;
  return `${valor.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: decimales })} ${unidades[i]}`;
}

// "3 días, 4 h": tiempo activo en texto legible.
export function duracion(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const dias = Math.floor(total / 86_400);
  const horas = Math.floor((total % 86_400) / 3_600);
  const minutos = Math.floor((total % 3_600) / 60);
  if (dias > 0) return `${dias} ${dias === 1 ? "día" : "días"}, ${horas} h`;
  if (horas > 0) return `${horas} h ${minutos} min`;
  return `${minutos} min`;
}

// Quita secuencias ANSI (color, cursor, títulos) para mostrar texto plano.
export function quitarAnsi(texto: string): string {
  return texto
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "");
}

// Porcentaje entero de uso, sin dividir entre cero.
export function porcentaje(usado: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((usado / total) * 100));
}

// Quita usuario y contraseña de una URL de remoto antes de mostrarla.
export function sinCredenciales(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1");
}
