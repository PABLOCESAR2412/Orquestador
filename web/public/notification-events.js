self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/tareas', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(clients.openWindow(url.href));
});
