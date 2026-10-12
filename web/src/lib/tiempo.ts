// Texto relativo para mensajes y chats: "ahora", "hace 3 min", "hace 2 h", "hace 4 d".
// Las fechas de la base llegan en UTC sin zona ("2026-10-12 10:21:00"), igual que en model.ts.

function aFecha(sql: string): Date | null {
  if (!sql) return null;
  const iso = sql.includes("T") ? (sql.endsWith("Z") ? sql : sql + "Z") : sql.replace(" ", "T") + "Z";
  const fecha = new Date(iso);
  return isNaN(fecha.getTime()) ? null : fecha;
}

// null significa un mensaje que todavía se está enviando.
export function haceTexto(sql: string | null, ahora = Date.now()): string {
  if (sql === null) return "ahora";
  const fecha = aFecha(sql);
  if (!fecha) return "";
  const segundos = Math.round((ahora - fecha.getTime()) / 1000);
  if (segundos < 60) return "ahora";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `hace ${dias} d`;
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(fecha);
}
