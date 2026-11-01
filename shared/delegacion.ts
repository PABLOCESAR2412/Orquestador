// Solo la petición actual autoriza delegar; mencionar agentes o preguntar por ellos no basta.
const OBJETO = "(?:subagentes?|auxiliares?|agentes?)";
const NEGACION = new RegExp(`\\b(?:sin\\s+(?:(?:que\\s+)?(?:usar|uses|utilizar|utilices)\\s+)?(?:(?:los|las|varios|dos)\\s+)?${OBJETO}|no\\s+(?:(?:quiero|necesito|debes|puedes|usar|uses?|utilizar|utilices?|crees?|lances?|actives?|emplees?|delegues?)\\s+)(?:[^.!?;\\n]{0,60}\\s)?${OBJETO})\\b`, "i");
const PETICION = /\b(?:(?:usa(?:r|s)?|us(?:e|es|en)|utili(?:z(?:a|ar|as|an|ando)|c(?:e|es|en))|lanz(?:a|ar|as|an)|lance|lances|lancen|activ(?:a|ar|as|an|e|es|en)|emple(?:a|ar|as|an|e|es|en)|llama|llamar)\s+(?:a\s+)?(?:(?:tus?|los|las|el|la|un|una|varios?|varias?|dos|tres|cuatro|m[uú]ltiples?)\s+)?(?:agentes?|subagentes?|auxiliares?)|(?:crea|crear|crees|inicia|iniciar)\s+(?:(?:un|dos|tres|varios)\s+)?subagentes?|(?:quiero|necesito)\s+(?:(?:un|dos|tres|varios|varias|m[uú]ltiples)\s+)?(?:subagentes?|auxiliares?|agentes?\s+en\s+paralelo)|(?:quiero|necesito)\s+(?:dos|tres|varios|varias|m[uú]ltiples)\s+agentes?|delega(?:r)?\s+(?:la|el|esta|este|en|a)|(?:haz|realiza|revisa|analiza|trabaja)\b[^.!?;\n]{0,100}\bcon\s+(?:(?:varios|dos|tres)\s+)?(?:subagentes?|agentes?))\b/i;

export function pideSubagentes(prompt: string): boolean {
  const texto = prompt.replace(/```[\s\S]*?```|`[^`]*`|^[ \t]*>.*$/gm, "");
  if (NEGACION.test(texto)) return false;
  if (/^\s*[¿]?(?:explica(?:me)?|dime|c[oó]mo|cu[aá]ndo|por\s+qu[eé])\b/i.test(texto)) return false;
  // Conserva el caso de dictado «dos urgentes, uno se encarga…».
  return PETICION.test(texto) || /\b(?:usa|utiliza)\s+(?:dos|tres|varios)\s+urgentes\b[\s\S]{0,240}\buno\s+se\s+encarga\b/i.test(texto);
}
