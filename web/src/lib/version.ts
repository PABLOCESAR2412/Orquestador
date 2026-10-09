// Evento que pide mostrar el aviso de "Hay cambios nuevos en Telo".
export const EVENTO_VERSION_NUEVA = "telo:version-nueva";

// Revisa si el servidor publicó un build distinto al que corre esta pestaña.
// Devuelve true si hay versión nueva. Lanza error si no hay conexión.
export async function hayVersionNueva(): Promise<boolean> {
  const res = await fetch("/version.json", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo consultar la versión.");
  const datos = (await res.json()) as { id?: string };
  if (!datos.id || datos.id === __BUILD_ID__) return false;
  // Pide el service worker nuevo. Si cambió, queda esperando y el aviso lo activa.
  const registro = await navigator.serviceWorker?.getRegistration();
  void registro?.update();
  return true;
}
