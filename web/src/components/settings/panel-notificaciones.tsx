import { useEffect, useState } from "react";
import {
  cancelarWebPush,
  guardarNotificacionesActivas,
  guardarSonidoNotificacionSeleccionado,
  guardarSonidoNotificacionesActivo,
  notificacionesActivas,
  notificacionesSoportadas,
  pedirPermisoNotificaciones,
  prepararSonidoNotificaciones,
  probarSonidoNotificaciones,
  SONIDOS_NOTIFICACION,
  sonidoNotificacionSeleccionado,
  sonidoNotificacionesActivo,
  sonidoGestionadoPorAndroid,
  suscribirWebPush,
  webpushActivo,
  webpushSoportado,
  type SonidoNotificacion,
} from "../../lib/notificaciones";

export function NotificacionesPanel() {
  const android = sonidoGestionadoPorAndroid();
  const [activas, setActivas] = useState(() => notificacionesActivas());
  const [sonido, setSonido] = useState(() => sonidoNotificacionesActivo());
  const [tipoSonido, setTipoSonido] = useState<SonidoNotificacion>(() => sonidoNotificacionSeleccionado());
  const [permiso, setPermiso] = useState<NotificationPermission | "no_soportado">(() =>
    notificacionesSoportadas() ? Notification.permission : "no_soportado",
  );
  const [sonidoProbado, setSonidoProbado] = useState<string | null>(null);

  // Avisos empujados (Web Push): estado por dispositivo.
  const [push, setPush] = useState<"cargando" | "activa" | "inactiva">(() => (webpushSoportado() ? "cargando" : "inactiva"));
  const [notaPush, setNotaPush] = useState<string>(() =>
    webpushSoportado()
      ? "El servidor envía el aviso directo al dispositivo, aunque la app esté cerrada."
      : "Este navegador no admite Web Push.",
  );
  useEffect(() => {
    if (!webpushSoportado()) return;
    void webpushActivo().then((activa) => setPush(activa ? "activa" : "inactiva"));
  }, []);

  const alCambiarPush = async (activar: boolean) => {
    const resultado = activar ? await suscribirWebPush() : await cancelarWebPush();
    setPush(resultado.activa ? "activa" : "inactiva");
    setNotaPush(resultado.mensaje);
  };

  const alCambiar = async (valor: boolean) => {
    if (valor) {
      if (sonido) void prepararSonidoNotificaciones();
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
          ? "El navegador enviará los avisos al centro de notificaciones del dispositivo. Telo debe seguir abierta, aunque puede estar en segundo plano."
          : "Actívalas para recibir avisos de tareas terminadas, fallidas o pendientes de tu decisión.";

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
          {android ? <p className="aj-nota">Android controla el tono y el volumen desde los ajustes de notificaciones de Telo o del navegador. Los cinco sonidos personalizados están disponibles en escritorio.</p> : <div className="aj-notificaciones-sonido-acciones">
            <label className="aj-notificaciones-selector">
              <span>Sonido de notificación</span>
              <select
                aria-label="Sonido de notificación"
                value={tipoSonido}
                onChange={(evento) => {
                  const siguiente = evento.currentTarget.value as SonidoNotificacion;
                  setTipoSonido(siguiente);
                  guardarSonidoNotificacionSeleccionado(siguiente);
                }}
              >
                {SONIDOS_NOTIFICACION.map(({ id, nombre }) => <option key={id} value={id}>{nombre}</option>)}
              </select>
            </label>
            <button type="button" className="aj-btn" onClick={() => void alProbarSonido()}>
              Probar sonido
            </button>
            {sonidoProbado && <span className="aj-nota" role="status">{sonidoProbado}</span>}
          </div>}
        </div>
      )}
      <div className="aj-interruptor" style={{ marginTop: "0.6rem" }}>
        <span className="aj-tarjeta-titulo-simple">Avisos empujados en este dispositivo</span>
        <button
          type="button"
          role="switch"
          aria-checked={push === "activa"}
          aria-label="Avisos empujados en este dispositivo"
          className="aj-switch"
          disabled={!webpushSoportado() || push === "cargando"}
          onClick={() => void alCambiarPush(push !== "activa")}
        />
      </div>
      <p className="aj-nota">{notaPush}</p>
    </article>
  );
}
