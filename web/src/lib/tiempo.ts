// Texto relativo para mensajes y chats: "ahora", "hace 3 min", "hace 2 h", "hace 4 d".
// Las fechas de la base llegan en UTC sin zona ("2026-10-12 10:21:00"), igual que en model.ts.

function aFecha(sql: string): Date | null {
  if (!sql) return null;
  const tieneZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(sql);
  const iso = tieneZona ? sql : `${sql.replace(" ", "T")}Z`;
  const fecha = new Date(iso);
  return isNaN(fecha.getTime()) ? null : fecha;
}

function textoDuracion(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  if (total < 60) return `${total} s`;
  const minutos = Math.floor(total / 60);
  const segundosRestantes = total % 60;
  if (minutos < 60) return `${minutos} min${segundosRestantes ? ` ${segundosRestantes} s` : ""}`;
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  return `${horas} h${minutosRestantes ? ` ${minutosRestantes} min` : ""}`;
}

// Tiempo entre el mensaje enviado y la respuesta guardada, o desde un inicio mientras sigue trabajando.
export function duracionEntre(inicio: string | null, fin: string | null): string | null {
  if (!inicio || !fin) return null;
  const desde = aFecha(inicio)?.getTime();
  const hasta = aFecha(fin)?.getTime();
  if (desde === undefined || hasta === undefined || hasta < desde) return null;
  return textoDuracion((hasta - desde) / 1000);
}

export function tiempoTranscurrido(inicio: string | null, ahora = Date.now()): string | null {
  if (!inicio) return null;
  const desde = aFecha(inicio)?.getTime();
  if (desde === undefined || ahora < desde) return null;
  return textoDuracion((ahora - desde) / 1000);
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
