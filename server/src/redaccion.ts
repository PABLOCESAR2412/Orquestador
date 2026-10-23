import { config } from "./config";
import { entornoProveedores, valorClaveJev } from "./claves-proveedor";
import { valoresTokensMcp } from "./conexiones-mcp";

// Redacción de todo lo que sale del servidor: salida del agente, eventos en vivo, resultados,
// errores, mensajes de Git y diffs. Oculta valores de secretos conocidos (los del proyecto y los de
// TELO_CLAVE y TELO_CLAVE_CIFRADO) y patrones de credenciales con formato fijo.

const MINIMO_VALOR = 6;
const MARCA = "***";

// Credenciales con formato reconocible. Sin bandera "g": se usan para probar o, con new RegExp, para reemplazar.
const PATRONES_CREDENCIAL: RegExp[] = [
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])/, // claves de acceso de AWS
  /(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])/, // tokens personales de GitHub (clásicos)
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])/, // tokens de GitHub de grano fino
  /(?<![A-Za-z0-9_])gh[ousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])/, // tokens de OAuth, de usuario, de servidor y de refresco de GitHub
  /(?<![A-Za-z0-9_-])apikey_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/, // claves API de TypeSafe / Jev
  /(?<![A-Za-z0-9_-])gsk_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/, // claves API de Groq
  /(?<![A-Za-z0-9_-])nvapi-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/, // claves API de NVIDIA
  /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/, // claves API de Anthropic
  /(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/, // claves de API modernas de OpenAI (proyecto)
  /(?<![A-Za-z0-9_-])sk-svcacct-[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/, // claves de servicio de OpenAI
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20,48}(?![A-Za-z0-9_-])/, // claves de API tradicionales de OpenAI (alfanuméricas sin guiones)
  /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{30,}(?![A-Za-z0-9_-])/, // claves de API de Google
];
// Bloque de clave privada: del encabezado al pie, o hasta el final del texto si se corta.
const BLOQUE_CLAVE_PRIVADA = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/;
const ENCABEZADO_CLAVE_PRIVADA = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

// Palabras comunes en configuración de desarrollo que no deben considerarse secretos en el diff.
const VALORES_IGNORADOS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "development",
  "production",
  "testing",
  "staging",
  "postgres",
  "postgresql",
  "mongodb",
  "sqlite",
  "sqlite3",
  "default",
  "public",
  "bearer",
  "apikey",
  "verbose",
  "password",
  "admin",
]);

// Conserva la redacción del secreto OAuth antiguo mientras pueda seguir en el entorno del VM.
export function valoresDeConfiguracion(): string[] {
  return [config.clave, config.claveCifrado, process.env.TELO_GOOGLE_CLIENT_SECRET?.trim() || null].filter(
    (v): v is string => !!v && !VALORES_IGNORADOS.has(v.toLowerCase().trim()),
  );
}

// Secretos que el servidor conoce más allá del proyecto: claves de proveedor guardadas (Groq,
// NVIDIA, Google…), la clave de la integración interna y los tokens de las conexiones MCP. Entran
// en el mismo filtro que los secretos del proyecto —salida, diffs y escaneo de commits— aunque el
// proyecto no los declare. Un valor que no se pueda descifrar se omite; nunca lanza error.
export function valoresSecretosServidor(): string[] {
  try {
    const jev = valorClaveJev();
    return [...Object.values(entornoProveedores()), ...valoresTokensMcp(), ...(jev ? [jev] : [])];
  } catch {
    return [];
  }
}

// Reemplaza por *** cada valor de `valores` de al menos `minimo` caracteres (más largos primero),
// y cada credencial con formato conocido. Nunca lanza error.
export function redactar(texto: string, valores: string[] = [], minimo = MINIMO_VALOR): string {
  const todos = [...new Set([...valores, ...valoresDeConfiguracion(), ...valoresSecretosServidor()])]
    .filter((v) => !VALORES_IGNORADOS.has(v.toLowerCase().trim()))
    .sort((a, b) => b.length - a.length);
  let limpio = texto;
  for (const valor of todos) {
    if (valor.length >= minimo) limpio = limpio.split(valor).join(MARCA);
  }
  for (const patron of PATRONES_CREDENCIAL) {
    limpio = limpio.replace(new RegExp(patron.source, "g"), MARCA);
  }
  return limpio.replace(new RegExp(BLOQUE_CLAVE_PRIVADA.source, "g"), "[clave privada oculta]");
}

function esSecretoReal(valor: string): boolean {
  const normalizado = valor.trim().toLowerCase();
  if (normalizado.length < 8) return false;
  if (VALORES_IGNORADOS.has(normalizado)) return false;
  return true;
}

// Marcas que delatan un valor de prueba dentro del propio formato de credencial (fixtures de
// auditoría, ejemplos de documentación, tokens canónicos de manual). Solo se aplican al
// formato: un secreto guardado por el dueño del proyecto es real por definición y nunca pasa
// por aquí. Insértar la marca rompe la credencial, así que no abre la puerta a valores reales.
const MARCAS_DE_PRUEBA = [
  "fictici",
  "prueba",
  "pru3ba",
  "ejemplo",
  "example",
  "dummy",
  "fake",
  "falso",
  "placeholder",
  "redacted",
  "ocult",
  "sample",
  "test",
  "abcdefghijklmnop",
];

function esFormatoDePrueba(hallada: string | undefined): boolean {
  if (!hallada) return false;
  const minusculas = hallada.toLowerCase();
  return MARCAS_DE_PRUEBA.some((marca) => minusculas.includes(marca));
}

function contieneSecreto(linea: string, valores: string[]): boolean {
  if (ENCABEZADO_CLAVE_PRIVADA.test(linea)) return true;
  for (const patron of PATRONES_CREDENCIAL) {
    // Un valor con formato de credencial cuenta, salvo que sea un ejemplo marcado como tal.
    const hallada = patron.exec(linea)?.[0];
    if (hallada && !esFormatoDePrueba(hallada)) return true;
  }
  return valores.some((valor) => esSecretoReal(valor) && linea.includes(valor));
}

// Archivos del diff que añaden una línea con un secreto conocido o con formato de credencial.
// Solo mira las líneas añadidas. Devuelve nombres de archivo, nunca el valor encontrado.
export function archivosConSecretos(diff: string, valores: string[]): string[] {
  const todos = [...valores, ...valoresDeConfiguracion(), ...valoresSecretosServidor()];
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

// Igual que archivosConSecretos, pero sobre el contenido íntegro de los blobs del índice
// (etiquetados por el llamador con "\0ruta\0" al empezar). Cubre los secretos que el diff
// no muestra, por ejemplo un archivo marcado binario con `.gitattributes`. Devuelve
// rutas, nunca el valor del secreto.
export function archivosConSecretosEnBlobs(blobs: string, valores: string[]): string[] {
  const todos = [...valores, ...valoresDeConfiguracion(), ...valoresSecretosServidor()];
  const hallados = new Set<string>();
  let archivo = "(desconocido)";
  for (const linea of blobs.split("\n")) {
    if (linea.startsWith("\0")) {
      archivo = linea.slice(1, linea.indexOf("\0", 1));
      continue;
    }
    if (contieneSecreto(linea, todos)) hallados.add(archivo);
  }
  return [...hallados];
}
