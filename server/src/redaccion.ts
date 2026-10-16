import { config } from "./config";

// Redacción de todo lo que sale del servidor: salida del agente, eventos en vivo, resultados,
// errores, mensajes de Git y diffs. Oculta valores de secretos conocidos (los del proyecto y los de
// TELO_CLAVE y TELO_CLAVE_CIFRADO) y patrones de credenciales con formato fijo.

const MINIMO_VALOR = 6;
const MARCA = "***";

// Credenciales con formato reconocible. Sin bandera "g": se usan para probar o, con new RegExp, para reemplazar.
const PATRONES_CREDENCIAL: RegExp[] = [
  /AKIA[0-9A-Z]{16}/, // claves de acceso de AWS
  /ghp_[A-Za-z0-9]{20,}/, // tokens personales de GitHub (clásicos)
  /github_pat_[A-Za-z0-9_]{20,}/, // tokens de GitHub de grano fino
  /gh[ousr]_[A-Za-z0-9]{20,}/, // tokens de OAuth, de usuario, de servidor y de refresco de GitHub
  /sk-[A-Za-z0-9_-]{20,}/, // claves de API de estilo OpenAI
  /AIza[0-9A-Za-z_-]{30,}/, // claves de API de Google
];
// Bloque de clave privada: del encabezado al pie, o hasta el final del texto si se corta.
const BLOQUE_CLAVE_PRIVADA = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/;
const ENCABEZADO_CLAVE_PRIVADA = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

// Valores de TELO_CLAVE y TELO_CLAVE_CIFRADO. Siempre se ocultan, en cualquier texto.
export function valoresDeConfiguracion(): string[] {
  return [config.clave, config.claveCifrado].filter((v): v is string => !!v);
}

// Reemplaza por *** cada valor de `valores` de al menos `minimo` caracteres (más largos primero),
// y cada credencial con formato conocido. Nunca lanza error.
export function redactar(texto: string, valores: string[] = [], minimo = MINIMO_VALOR): string {
  const todos = [...new Set([...valores, ...valoresDeConfiguracion()])].sort((a, b) => b.length - a.length);
  let limpio = texto;
  for (const valor of todos) {
    if (valor.length >= minimo) limpio = limpio.split(valor).join(MARCA);
  }
  for (const patron of PATRONES_CREDENCIAL) {
    limpio = limpio.replace(new RegExp(patron.source, "g"), MARCA);
  }
  return limpio.replace(new RegExp(BLOQUE_CLAVE_PRIVADA.source, "g"), "[clave privada oculta]");
}

function contieneSecreto(linea: string, valores: string[]): boolean {
  if (ENCABEZADO_CLAVE_PRIVADA.test(linea)) return true;
  if (PATRONES_CREDENCIAL.some((patron) => patron.test(linea))) return true;
  return valores.some((valor) => valor.length >= MINIMO_VALOR && linea.includes(valor));
}

// Archivos del diff que añaden una línea con un secreto conocido o con formato de credencial.
// Solo mira las líneas añadidas. Devuelve nombres de archivo, nunca el valor encontrado.
export function archivosConSecretos(diff: string, valores: string[]): string[] {
  const todos = [...valores, ...valoresDeConfiguracion()];
  const hallados = new Set<string>();
  let archivo = "(desconocido)";
  for (const linea of diff.split("\n")) {
    if (linea.startsWith("diff --git ")) {
      const destino = linea.slice(linea.lastIndexOf(" b/") + 3);
      archivo = destino || "(desconocido)";
      continue;
    }
    if (!linea.startsWith("+") || linea.startsWith("+++")) continue;
    if (contieneSecreto(linea.slice(1), todos)) hallados.add(archivo);
  }
  return [...hallados];
}
