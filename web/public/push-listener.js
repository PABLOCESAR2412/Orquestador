// Receptor de Web Push en el service worker: el servidor empuja el aviso cifrado y
// aquí se traduce a una notificación del sistema. Vale con la app cerrada: por eso
// hace falta un receptor en el worker, no en la página. El clic lo atiende
// notification-events.js, que abre la URL que trae la carga (por defecto /tareas).
self.addEventListener("push", (event) => {
  let carga = {};
  try {
    carga = event.data ? event.data.json() : {};
  } catch (error) {
    carga = { titulo: "Telo", cuerpo: "" };
  }
  event.waitUntil(
    (async () => {
      // El permiso del navegador no dice si la página tiene avisos locales activados.
      // Solo se delega si confirma que realmente mostró esta notificación.
      const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = abiertas.find((cliente) => cliente.visibilityState === "visible");
      if (visible) {
        const mostrada = await new Promise((resolve) => {
          const canal = new MessageChannel();
          const cerrar = (valor) => { clearTimeout(reloj); canal.port1.close(); resolve(valor); };
          const reloj = setTimeout(() => cerrar(false), 2500);
          canal.port1.onmessage = (respuesta) => cerrar(respuesta.data?.mostrada === true);
          try { visible.postMessage({ tipo: "telo-push", carga }, [canal.port2]); }
          catch { cerrar(false); }
        });
        if (mostrada) return;
      }
      await self.registration.showNotification(carga.titulo || "Telo", {
        body: carga.cuerpo || "",
        tag: carga.etiqueta || "telo-push",
        renotify: false,
        data: { url: carga.url || "/tareas", evento: carga.evento },
        badge: "/notification-badge.png",
        icon: "/notification-icon.png",
      });
    })(),
  );
});
