// Tema antes del primer pintado. Va en un archivo propio porque la CSP no admite scripts en línea.
// Mismo criterio que src/lib/tema.ts: sin preferencia guardada, "oscuro"; "sistema" no pone atributo.
(function () {
  var tema = "oscuro";
  try {
    var guardado = localStorage.getItem("telo:tema");
    if (guardado === "sistema" || guardado === "claro" || guardado === "oscuro") tema = guardado;
  } catch (e) {
    // Sin almacenamiento disponible: se usa el valor por defecto.
  }
  if (tema === "sistema") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", tema);
})();
