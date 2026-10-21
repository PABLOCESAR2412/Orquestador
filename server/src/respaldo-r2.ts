export type ArchivoRespaldo = {
  nombre: string;
  ruta: string;
  bytes: number;
};

export type ConjuntoRespaldo = {
  sello: string;
  archivos: ArchivoRespaldo[];
};

export type ObjetoRespaldo = {
  bytes?: number;
  etag?: string;
};

export type PaginaObjetos = {
  claves: string[];
  siguienteToken?: string;
};

export interface AlmacenRespaldosR2 {
  subirArchivo(clave: string, ruta: string, bytes: number): Promise<{ etag?: string }>;
  subirTexto(clave: string, contenido: string): Promise<{ etag?: string }>;
  revisar(clave: string): Promise<ObjetoRespaldo>;
  listar(prefijo: string, token?: string): Promise<PaginaObjetos>;
  borrar(claves: string[]): Promise<void>;
}

const SELLO_VALIDO = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const ETIQUETA = (valor?: string) => valor?.replace(/^"|"$/g, "");

async function listarTodo(almacen: AlmacenRespaldosR2, prefijo: string): Promise<string[]> {
  const claves: string[] = [];
  let token: string | undefined;
  do {
    const pagina = await almacen.listar(prefijo, token);
    claves.push(...pagina.claves);
    token = pagina.siguienteToken;
  } while (token);
  return claves;
}

async function validarObjeto(
  almacen: AlmacenRespaldosR2,
  clave: string,
  bytesEsperados: number,
  etagSubido?: string,
): Promise<string> {
  const remoto = await almacen.revisar(clave);
  if (remoto.bytes !== bytesEsperados) {
    throw new Error(`la copia remota de ${clave} tiene ${remoto.bytes ?? "tamaño desconocido"} bytes; se esperaban ${bytesEsperados}`);
  }
  if (!remoto.etag || (etagSubido && ETIQUETA(remoto.etag) !== ETIQUETA(etagSubido))) {
    throw new Error(`no se pudo verificar la etiqueta de integridad de ${clave}`);
  }
  return remoto.etag;
}

/** Sube conjuntos completos, valida cada objeto y solo después elimina respaldos remotos antiguos. */
export async function sincronizarRespaldosR2(
  almacen: AlmacenRespaldosR2,
  opciones: {
    prefijo: string;
    conjuntos: ConjuntoRespaldo[];
    conservar: number;
    creadoEn?: string;
  },
): Promise<{ subidos: number; retirados: number; conjuntosCompletos: number }> {
  if (!Number.isSafeInteger(opciones.conservar) || opciones.conservar < 1) {
    throw new Error("la cantidad de respaldos remotos a conservar debe ser un entero mayor que cero");
  }
  if (!opciones.prefijo || opciones.prefijo.startsWith("/") || opciones.prefijo.split("/").includes("..")) {
    throw new Error("el prefijo de respaldos R2 no es válido");
  }

  let subidos = 0;
  for (const conjunto of [...opciones.conjuntos].sort((a, b) => b.sello.localeCompare(a.sello))) {
    if (!SELLO_VALIDO.test(conjunto.sello) || conjunto.archivos.length === 0) {
      throw new Error("el conjunto de respaldo tiene un sello o contenido no válido");
    }
    const prefijoConjunto = `${opciones.prefijo}${conjunto.sello}/`;
    const archivos = [];
    for (const archivo of conjunto.archivos) {
      if (!archivo.nombre || archivo.nombre.includes("/") || !Number.isSafeInteger(archivo.bytes) || archivo.bytes < 0) {
        throw new Error(`el archivo local ${archivo.nombre || "(sin nombre)"} no es válido`);
      }
      const clave = `${prefijoConjunto}${archivo.nombre}`;
      const resultado = await almacen.subirArchivo(clave, archivo.ruta, archivo.bytes);
      const etag = await validarObjeto(almacen, clave, archivo.bytes, resultado.etag);
      archivos.push({ nombre: archivo.nombre, bytes: archivo.bytes, etag });
      subidos++;
    }

    const manifiesto = JSON.stringify({ version: 1, sello: conjunto.sello, creadoEn: opciones.creadoEn ?? new Date().toISOString(), archivos });
    const claveManifiesto = `${prefijoConjunto}manifest.json`;
    const resultadoManifiesto = await almacen.subirTexto(claveManifiesto, manifiesto);
    await validarObjeto(almacen, claveManifiesto, new TextEncoder().encode(manifiesto).byteLength, resultadoManifiesto.etag);
    subidos++;
  }

  const claves = await listarTodo(almacen, opciones.prefijo);
  const manifiestos = claves
    .filter((clave) => clave.startsWith(opciones.prefijo) && clave.endsWith("/manifest.json"))
    .sort((a, b) => b.localeCompare(a));
  const antiguos = manifiestos.slice(opciones.conservar);
  let retirados = 0;
  for (const manifiesto of antiguos) {
    const prefijoConjunto = manifiesto.slice(0, -"manifest.json".length);
    const objetos = await listarTodo(almacen, prefijoConjunto);
    for (let inicio = 0; inicio < objetos.length; inicio += 1000) {
      await almacen.borrar(objetos.slice(inicio, inicio + 1000));
    }
    retirados++;
  }

  return { subidos, retirados, conjuntosCompletos: Math.min(manifiestos.length, opciones.conservar) };
}
