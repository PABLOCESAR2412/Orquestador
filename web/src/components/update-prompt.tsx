import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { EVENTO_VERSION_NUEVA, hayVersionNueva } from "../lib/version";
import { cerrarEventosVivos } from "../lib/eventos-vivos";

// Cada cuánto se revisa si hay una versión nueva.
const REVISION_CADA_MS = 5 * 60_000;

// Avisa cuando hay cambios nuevos. Nunca recarga sola: decide el usuario.
export function UpdatePrompt() {
  const [hayNuevaVersion, setHayNuevaVersion] = useState(false);
  const {
    needRefresh: [esperaActivacion, setEsperaActivacion],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      if (registro) setInterval(() => void registro.update(), REVISION_CADA_MS);
    },
  });

  useEffect(() => {
    let activo = true;

    async function revisar() {
      try {
        if ((await hayVersionNueva()) && activo) setHayNuevaVersion(true);
      } catch {
        // Sin conexión, o sin version.json en desarrollo: se vuelve a intentar.
      }
    }

    // El botón Actualizar de Tareas también puede pedir el aviso.
    const alPedirAviso = () => setHayNuevaVersion(true);
    window.addEventListener(EVENTO_VERSION_NUEVA, alPedirAviso);

    // Detecta versiones publicadas al abrir Telo, sin esperar al primer intervalo.
    void revisar();
    const timer = window.setInterval(revisar, REVISION_CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void revisar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      activo = false;
      window.clearInterval(timer);
      window.removeEventListener(EVENTO_VERSION_NUEVA, alPedirAviso);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  const visible = esperaActivacion || hayNuevaVersion;

  useEffect(() => {
    if (!visible) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === "Escape") despues();
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [visible]);

  if (!visible) return null;

  function despues() {
    setEsperaActivacion(false);
    setHayNuevaVersion(false);
  }

  async function recargar() {
    // Cerramos el canal en vivo antes de recargar para no dejar conexiones HTTP/2 colgadas
    // que provoquen net::ERR_HTTP2_PROTOCOL_ERROR en el navegador.
    cerrarEventosVivos();
    // Con service worker en espera, se pide que se active: su cambio de control recarga la página.
    // Si no hay worker en espera, esa señal nunca llega y el botón no hacía nada. Por eso se espera un
    // momento y, si la página sigue aquí, se continúa con la limpieza y la recarga de abajo.
    if (esperaActivacion) {
      void updateServiceWorker(true).catch(() => undefined);
      await new Promise((resolver) => window.setTimeout(resolver, 1500));
    }
    // Si el service worker nuevo aún no está listo, se limpia la caché para que
    // la recarga no vuelva a mostrar la versión anterior. Sin acceso a service
    // worker o caché (http por IP, no localhost) la limpieza no existe: igual se recarga.
    try {
      const registros = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(registros.map((r) => r.unregister()));
      if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch {
      // Sin acceso al service worker o a la caché: se recarga de todas formas.
    }
    window.location.reload();
  }

  return (
    <>
      <div className="scrim dim update-capa" aria-hidden="true" />
      <div className="panel update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-titulo">
        <h2 id="update-titulo">Hay cambios nuevos en Telo</h2>
        <p className="muted-note">
          Recarga para usar la versión más reciente. Tus conversaciones y tareas siguen guardadas en el servidor.
        </p>
        <div className="update-actions">
          <button type="button" className="ghost" onClick={despues}>
            Después
          </button>
          <button type="button" className="primary" autoFocus onClick={() => void recargar()}>
            Recargar ahora
          </button>
        </div>
      </div>
    </>
  );
}
