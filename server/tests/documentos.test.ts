import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import {
  generarArchivo,
  limpiarHtml,
  nombreArchivo,
  tablaMarkdown,
  tituloDesdeTexto,
  vistaHtml,
} from "../src/documentos";

const TEXTO = `# Informe

Texto **negrita** y \`codigo\`.

- uno
- dos

| Producto | Precio |
|---|---|
| Café | 3.5 |
| Té | 2 |

> cita
`;

const decodificar = (b: Uint8Array) => new TextDecoder().decode(b);

describe("documentos: generación", () => {
  test("txt y md conservan el texto tal cual", async () => {
    expect(decodificar(await generarArchivo("txt", "t", TEXTO))).toBe(TEXTO);
    expect(decodificar(await generarArchivo("md", "t", TEXTO))).toBe(TEXTO);
  });

  test("html envuelve el Markdown y quita scripts y atributos on*", async () => {
    const html = decodificar(
      await generarArchivo("html", "Página", "Hola <script>alert(1)</script> <img src=x onerror=alert(2)>"),
    );
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  test("html ya completo se respeta, pero sin scripts", () => {
    const limpio = limpiarHtml('<html><body><a href="javascript:alert(1)">x</a><script>1</script></body></html>');
    expect(limpio).not.toContain("<script");
    expect(limpio).not.toContain("javascript:");
  });

  test("docx es un archivo ZIP (PK) y su vista conserva el texto", async () => {
    const docx = await generarArchivo("docx", "Informe", TEXTO);
    expect(decodificar(docx.slice(0, 2))).toBe("PK");
    expect((await vistaHtml("docx", docx)).toLowerCase()).toContain("negrita");
  });

  test("xlsx toma la primera tabla del Markdown y se puede leer de vuelta", async () => {
    const xlsx = await generarArchivo("xlsx", "Tabla", TEXTO);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(xlsx));
    const hoja = libro.worksheets[0];
    expect(hoja.getRow(1).getCell(1).text).toBe("Producto");
    expect(hoja.getRow(2).getCell(1).text).toBe("Café");
    expect(hoja.getRow(2).getCell(2).value).toBe(3.5);
  });

  test("xlsx sin tabla pone cada línea en una fila", async () => {
    const xlsx = await generarArchivo("xlsx", "Lista", "primera\nsegunda");
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(xlsx));
    expect(libro.worksheets[0].getRow(2).getCell(1).text).toBe("segunda");
  });
});

describe("documentos: vista previa", () => {
  test("txt se escapa y no interpreta HTML", async () => {
    const vista = await vistaHtml("txt", new TextEncoder().encode("<b>hola</b>"));
    expect(vista).toContain("&lt;b&gt;hola&lt;/b&gt;");
  });

  test("xlsx muestra la cabecera de la tabla y escapa las celdas", async () => {
    const xlsx = await generarArchivo("xlsx", "t", "| A | B |\n|---|---|\n| <x> | 1 |");
    const vista = await vistaHtml("xlsx", xlsx);
    expect(vista).toContain("<th>A</th>");
    expect(vista).toContain("&lt;x&gt;");
    expect((vista.match(/<td>/g) ?? []).length).toBe(2);
  });
});

describe("documentos: utilidades", () => {
  test("tablaMarkdown devuelve null sin tabla", () => {
    expect(tablaMarkdown("solo texto")).toBeNull();
  });

  test("nombreArchivo quita separadores de ruta y añade la extensión", () => {
    expect(nombreArchivo("../../etc/passwd", "txt")).toBe(".. .. etc passwd.txt");
    expect(nombreArchivo("../../etc/passwd", "txt")).not.toContain("/");
    expect(nombreArchivo("", "docx")).toBe("documento.docx");
  });

  test("tituloDesdeTexto usa la primera línea sin marcas", () => {
    expect(tituloDesdeTexto("## **Plan** de trabajo\nmás")).toBe("Plan de trabajo");
  });
});
