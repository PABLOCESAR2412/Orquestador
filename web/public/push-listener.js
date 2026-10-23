// Receptor de Web Push en el service worker: el servidor empuja el aviso cifrado y
// aquí se traduce a una notificación del sistema. Vale con la app cerrada: por eso
// hace falta un receptor en el worker, no en la página. El clic lo atiende
// notification-events.js, que abre la URL que trae la carga (por defecto /tasks).
self.addEventListener("push", (event) => {
  let carga = {};
  try {
    carga = event.data ? event.data.json() : {};
  } catch (error) {
    carga = { titulo: "Telo", cuerpo: "" };
  }
  event.waitUntil(
    (async () => {
      // Con la app visible, la página avisa por su cuenta (notificaciones locales) y mostrar
      // aquí de nuevo duplicaría el aviso; pero si las notificaciones locales están bloqueadas,
      // esa página nunca avisará y el push quedaría mudo. Solo se calla el worker cuando hay
      // ventana visible y el permiso permite que la página entera tome la notificación.
      const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const ventanaAvisara = abiertas.some(
        (cliente) =>
          cliente.visibilityState === "visible" &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted",
      );
      if (ventanaAvisara) return;
      await self.registration.showNotification(carga.titulo || "Telo", {
        body: carga.cuerpo || "",
        tag: "telo-push",
        data: { url: carga.url || "/tasks" },
        badge: "/notification-badge.png",
        icon: "/notification-badge.png",
      });
    })(),
  );
});
