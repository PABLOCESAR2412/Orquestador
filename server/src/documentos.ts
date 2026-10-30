import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { marked } from "marked";

// Documentos que el usuario guarda desde un mensaje del chat. Cada formato se genera aquí en el servidor
// a partir del texto ya redactado del mensaje; el agente nunca escribe estos archivos.

export const FORMATOS = ["docx", "xlsx", "html", "txt", "md"] as const;
export type Formato = (typeof FORMATOS)[number];

export const ETIQUETA_FORMATO: Record<Formato, string> = {
  docx: "Word",
  xlsx: "Excel",
  html: "HTML",
  txt: "Bloc de notas",
  md: "Markdown",
};

const MIME: Record<Formato, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export const TAMANO_MAX_DOCUMENTO = 5 * 1024 * 1024;

export const mimeDeFormato = (formato: Formato) => MIME[formato];

export function esFormato(valor: unknown): valor is Formato {
  return typeof valor === "string" && (FORMATOS as readonly string[]).includes(valor);
}

// Nombre seguro para descargar: sin separadores de ruta ni caracteres de control.
export function nombreArchivo(titulo: string, formato: Formato): string {
  const base =
    titulo
      .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "documento";
  return `${base}.${formato}`;
}

// Título por defecto: la primera línea con texto, sin marcas de Markdown.
export function tituloDesdeTexto(texto: string): string {
  const linea = texto
    .split("\n")
    .map((l) => l.replace(/^[#>\-*\s]+/, "").replace(/[*_`]/g, "").trim())
    .find((l) => l !== "");
  return (linea ?? "Documento").slice(0, 80);
}

const escapar = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// El parser reconoce también atributos compactos (<svg/onload=...>) que una regex omite.
export function limpiarHtml(html: string): string {
  return new HTMLRewriter().on("*", {
    element(elemento) {
      if (["script", "iframe", "object", "embed", "base"].includes(elemento.tagName)
        || (elemento.tagName === "meta" && elemento.hasAttribute("http-equiv"))) {
        elemento.remove();
        return;
      }
      for (const [nombre, valor] of [...elemento.attributes]) {
        if (nombre.startsWith("on") || nombre === "srcdoc") elemento.removeAttribute(nombre);
        if (["href", "src", "xlink:href", "action", "formaction"].includes(nombre)) {
          const url = valor.replace(/[\u0000-\u0020\u007f]/g, "");
          const relativa = !/[:&\\]/.test(url) && !url.startsWith("//");
          const segura = /^(?:https?:\/\/|mailto:|#)/i.test(url)
            || (nombre === "src" && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url));
          if (!relativa && !segura) elemento.removeAttribute(nombre);
        }
      }
    },
  }).transform(html);
}

// La política viaja dentro de la descarga, donde ya no existen las cabeceras del servidor.
function htmlDocumento(html: string): string {
  const politica = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">';
  // Debe preceder a todo el HTML recibido, incluso a un doctype malformado.
  return `<!doctype html>\n${politica}\n${html}`;
}

// Filas de una tabla GFM del Markdown, o null si el texto no tiene ninguna.
export function tablaMarkdown(texto: string): string[][] | null {
  const lineas = texto.split("\n");
  const inicio = lineas.findIndex(
    (l, i) => /^\s*\|/.test(l) && i + 1 < lineas.length && /^\s*\|?\s*:?-{3,}/.test(lineas[i + 1]),
  );
  if (inicio < 0) return null;
  const filas = [celdas(lineas[inicio])];
  for (let j = inicio + 2; j < lineas.length && /^\s*\|/.test(lineas[j]); j++) {
    filas.push(celdas(lineas[j]));
  }
  return filas;
}

function celdas(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim().replace(/\*\*(.+?)\*\*/g, "$1"));
}

// ---------- Word ----------

function trozosDeLinea(linea: string): TextRun[] {
  const partes = linea.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).filter((p) => p !== "");
  return partes.map((p) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return new TextRun({ text: p.slice(2, -2), bold: true });
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return new TextRun({ text: p.slice(1, -1), font: "Consolas" });
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return new TextRun({ text: p.slice(1, -1), italics: true });
    return new TextRun({ text: p });
  });
}

const NIVELES = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function parrafosDeMarkdown(texto: string): Paragraph[] {
  const parrafos: Paragraph[] = [];
  let enCodigo = false;
  for (const linea of texto.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(linea)) {
      enCodigo = !enCodigo;
      continue;
    }
    if (enCodigo) {
      parrafos.push(new Paragraph({ children: [new TextRun({ text: linea, font: "Consolas", size: 20 })] }));
      continue;
    }
    if (linea.trim() === "") {
      parrafos.push(new Paragraph({}));
      continue;
    }
    const titulo = /^(#{1,6})\s+(.*)$/.exec(linea);
    if (titulo) {
      parrafos.push(new Paragraph({ heading: NIVELES[titulo[1].length - 1], children: trozosDeLinea(titulo[2]) }));
      continue;
    }
    const vineta = /^\s*[-*+]\s+(.*)$/.exec(linea);
    if (vineta) {
      parrafos.push(new Paragraph({ bullet: { level: 0 }, children: trozosDeLinea(vineta[1]) }));
      continue;
    }
    const numerada = /^\s*(\d+)[.)]\s+(.*)$/.exec(linea);
    if (numerada) {
      parrafos.push(
        new Paragraph({ indent: { left: 360 }, children: [new TextRun(`${numerada[1]}. `), ...trozosDeLinea(numerada[2])] }),
      );
      continue;
    }
    const cita = /^>\s?(.*)$/.exec(linea);
    if (cita) {
      parrafos.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: cita[1], italics: true })] }));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(linea)) {
      if (/^\s*\|?\s*:?-{3,}/.test(linea)) continue;
      parrafos.push(new Paragraph({ children: [new TextRun({ text: celdas(linea).join("  |  ") })] }));
      continue;
    }
    parrafos.push(new Paragraph({ children: trozosDeLinea(linea) }));
  }
  return parrafos;
}

// ---------- Excel ----------

const valorDeCelda = (c: string) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c);

async function libroExcel(texto: string): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Telo";
  libro.created = new Date();
  const hoja = libro.addWorksheet("Hoja 1");
  const tabla = tablaMarkdown(texto);
  const filas = tabla ?? texto.split("\n").filter((l) => l.trim() !== "").map((l) => [l]);
  filas.forEach((fila, i) => {
    const row = hoja.addRow(fila.map(valorDeCelda));
    if (tabla && i === 0) row.font = { bold: true };
  });
  const columnas = Math.max(1, ...filas.map((f) => f.length));
  for (let c = 1; c <= columnas; c++) {
    const largo = Math.max(8, ...filas.map((f) => (f[c - 1] ?? "").length));
    hoja.getColumn(c).width = Math.min(largo + 2, 50);
  }
  return new Uint8Array((await libro.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------- Generación ----------

export async function generarArchivo(
  formato: Formato,
  titulo: string,
  texto: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  switch (formato) {
    case "txt":
    case "md":
      return enc.encode(texto);
    case "html": {
      if (/<html[\s>]|<!doctype html/i.test(texto)) return enc.encode(htmlDocumento(limpiarHtml(texto)));
      const cuerpo = limpiarHtml(String(await marked.parse(texto)));
      const pagina = `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapar(titulo)}</title>${ESTILO_VISTA}</head><body>${cuerpo}</body></html>\n`;
      return enc.encode(htmlDocumento(pagina));
    }
    case "docx": {
      const doc = new Document({
        creator: "Telo",
        title: titulo,
        sections: [{ children: parrafosDeMarkdown(texto) }],
      });
      return new Uint8Array(await Packer.toBuffer(doc));
    }
    case "xlsx":
      return libroExcel(texto);
  }
}

// ---------- Vista previa ----------

const ESTILO_VISTA = `<style>
body{font-family:system-ui,-apple-system,sans-serif;color:#15171a;background:#fff;margin:0;padding:20px;line-height:1.6;font-size:15px;max-width:820px}
h1,h2,h3{line-height:1.25}pre{background:#f4f5f7;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap}
code{font-family:ui-monospace,Menlo,monospace;font-size:13px}blockquote{margin:0;padding-left:12px;border-left:3px solid #c9ccd2;color:#4a4f57}
table{border-collapse:collapse;margin:12px 0;font-size:14px}td,th{border:1px solid #c9ccd2;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#f4f5f7}img{max-width:100%}h2.hoja{font-size:16px;margin:24px 0 8px}
@media print{@page{margin:18mm}body{max-width:none;margin:0;padding:0;color:#111;background:#fff}pre,blockquote,table{break-inside:avoid}h1,h2,h3{break-after:avoid}a{color:inherit;text-decoration:none}}
</style>`;

const TOPE_FILAS_VISTA = 500;
const TOPE_COLUMNAS_VISTA = 40;

export async function vistaHtml(formato: Formato, contenido: Uint8Array): Promise<string> {
  const texto = new TextDecoder().decode(contenido);
  let cuerpo: string;
  switch (formato) {
    case "txt":
      cuerpo = `<pre>${escapar(texto)}</pre>`;
      break;
    case "md":
      cuerpo = limpiarHtml(String(await marked.parse(texto)));
      break;
    case "html":
      return texto;
    case "docx": {
      const r = await mammoth.convertToHtml({ buffer: Buffer.from(contenido) });
      cuerpo = r.value;
      break;
    }
    case "xlsx": {
      const libro = new ExcelJS.Workbook();
      // El Buffer que espera ExcelJS no coincide con el global de @types/node; se usa el tipo exacto del parámetro.
      await libro.xlsx.load(Buffer.from(contenido) as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
      const partes: string[] = [];
      libro.eachSheet((hoja) => {
        partes.push(`<h2 class="hoja">${escapar(hoja.name)}</h2><table>`);
        let filas = 0;
        hoja.eachRow({ includeEmpty: false }, (fila, n) => {
          if (filas >= TOPE_FILAS_VISTA) return;
          filas++;
          const etiqueta = n === 1 ? "th" : "td";
          const celdas: string[] = [];
          // Solo las columnas que tienen datos en la hoja (con un tope).
          const columnas = Math.min(fila.cellCount, TOPE_COLUMNAS_VISTA);
          for (let c = 1; c <= columnas; c++) {
            celdas.push(`<${etiqueta}>${escapar(fila.getCell(c).text ?? "")}</${etiqueta}>`);
          }
          partes.push(`<tr>${celdas.join("")}</tr>`);
        });
        partes.push("</table>");
      });
      cuerpo = partes.join("");
      break;
    }
  }
  return `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ESTILO_VISTA}</head><body>${cuerpo}</body></html>`;
}
