import { useState } from "react";
import {
  guardarNotificacionesActivas,
  guardarSonidoNotificacionesActivo,
  notificacionesActivas,
  notificacionesSoportadas,
  pedirPermisoNotificaciones,
  probarSonidoNotificaciones,
  sonidoNotificacionesActivo,
} from "../../lib/notificaciones";

export function NotificacionesPanel() {
  const [activas, setActivas] = useState(() => notificacionesActivas());
  const [sonido, setSonido] = useState(() => sonidoNotificacionesActivo());
  const [permiso, setPermiso] = useState<NotificationPermission | "no_soportado">(() =>
    notificacionesSoportadas() ? Notification.permission : "no_soportado",
  );
  const [sonidoProbado, setSonidoProbado] = useState<string | null>(null);

  const alCambiar = async (valor: boolean) => {
    if (valor) {
      const siguientePermiso = await pedirPermisoNotificaciones();
      setPermiso(siguientePermiso);
      if (siguientePermiso !== "granted") return;
    }
    setActivas(valor);
    guardarNotificacionesActivas(valor);
  };

  const alProbarSonido = async () => {
    setSonidoProbado((await probarSonidoNotificaciones()) ? "Sonido activado." : "El navegador no pudo reproducir el sonido.");
  };

  const nota =
    permiso === "no_soportado"
      ? "Este navegador no admite notificaciones del sistema."
      : permiso === "denied"
        ? "El navegador las bloqueó. Permite las notificaciones de este sitio en Chrome o Edge y vuelve a activarlas aquí."
        : permiso === "granted"
          ? "Chrome o Edge enviarán los avisos al centro de notificaciones de Windows. Telo debe seguir abierta, aunque puede estar en segundo plano."
          : "Actívalas para recibir avisos de tareas terminadas, fallidas o pendientes de tu decisión.";

  return (
    <article className="aj-tarjeta" aria-labelledby="ajustes-notificaciones">
      <div className="aj-interruptor">
        <h3 id="ajustes-notificaciones" className="aj-tarjeta-titulo-simple">
          Notificaciones de escritorio
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={activas && permiso !== "no_soportado"}
          aria-label="Notificaciones de escritorio"
          className="aj-switch"
          disabled={permiso === "no_soportado"}
          onClick={() => void alCambiar(!activas)}
        />
      </div>
      <p className="aj-nota">{nota}</p>
      {activas && permiso === "granted" && (
        <div className="aj-notificaciones-sonido">
          <div className="aj-interruptor">
            <span className="aj-tarjeta-titulo-simple">Sonido al terminar</span>
            <button
              type="button"
              role="switch"
              aria-checked={sonido}
              aria-label="Sonido al terminar una tarea"
              className="aj-switch"
              onClick={() => {
                setSonido(!sonido);
                guardarSonidoNotificacionesActivo(!sonido);
              }}
            />
          </div>
          <div className="aj-notificaciones-sonido-acciones">
            <button type="button" className="aj-btn" onClick={() => void alProbarSonido()}>
              Probar sonido
            </button>
            {sonidoProbado && <span className="aj-nota" role="status">{sonidoProbado}</span>}
          </div>
        </div>
      )}
    </article>
  );
}
