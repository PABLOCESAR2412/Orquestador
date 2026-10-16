import { useState } from "react";
import {
  guardarNotificacionesActivas,
  notificacionesActivas,
  notificacionesSoportadas,
  pedirPermisoNotificaciones,
} from "../../lib/notificaciones";

export function NotificacionesPanel() {
  const [activas, setActivas] = useState(() => notificacionesActivas());
  const [permiso, setPermiso] = useState<NotificationPermission | "no_soportado">(() =>
    notificacionesSoportadas() ? Notification.permission : "no_soportado",
  );

  const alCambiar = async (valor: boolean) => {
    setActivas(valor);
    guardarNotificacionesActivas(valor);
    if (valor) setPermiso(await pedirPermisoNotificaciones());
  };

  const nota =
    permiso === "no_soportado"
      ? "Este navegador no admite notificaciones del sistema."
      : permiso === "denied"
        ? "El navegador las tiene bloqueadas. Permítelas en la configuración del sitio y vuelve a activarlas aquí."
        : "Avisan cuando una tarea termina, falla o necesita tu decisión. Llegan mientras Telo esté abierta.";

  return (
    <article className="aj-tarjeta" aria-labelledby="ajustes-notificaciones">
      <div className="aj-interruptor">
        <h3 id="ajustes-notificaciones" className="aj-tarjeta-titulo-simple">
          Notificaciones del sistema
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={activas && permiso !== "no_soportado"}
          aria-label="Notificaciones del sistema"
          className="aj-switch"
          disabled={permiso === "no_soportado"}
          onClick={() => void alCambiar(!activas)}
        />
      </div>
      <p className="aj-nota">{nota}</p>
    </article>
  );
}
