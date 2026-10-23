// Deduplica retransmisiones y define el punto de partida: la PRIMERA vez que se ve un id
// (primer sondeo al arrancar la app, primer paquete del sondeo de eventos al conectar) solo
// siembra el estado conocido y NO avisa, porque ese estado es del pasado, no una novedad.
// Los cambios posteriores con la app abierta sí avisan, incluido el que va de un estado
// visible a otro (por ejemplo running → failed), que vuelve a avisar.
export function registrarTransicion(estados: Map<string, string>, id: string, estado: string): boolean {
  const previo = estados.get(id);
  estados.set(id, estado);
  return !!estado && previo !== undefined && previo !== estado;
}
