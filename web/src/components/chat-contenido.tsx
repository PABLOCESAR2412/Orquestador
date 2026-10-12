import { useState } from "react";

// Contenido de un mensaje del agente: párrafos, `código en línea` y bloques ``` con su pestaña.
// Todo se muestra como texto (React escapa el contenido): nada del agente se ejecuta como HTML.

type Bloque = { tipo: "texto"; texto: string } | { tipo: "codigo"; etiqueta: string; codigo: string };

// Separa el texto en trozos de prosa y bloques de código. Un bloque sin cerrar se queda como texto.
export function partirContenido(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) bloques.push({ tipo: "texto", texto: texto.slice(ultimo, m.index) });
    bloques.push({ tipo: "codigo", etiqueta: m[1].trim(), codigo: m[2].replace(/\n$/, "") });
    ultimo = re.lastIndex;
  }
  if (ultimo < texto.length) bloques.push({ tipo: "texto", texto: texto.slice(ultimo) });
  return bloques;
}

// Copia al portapapeles. Devuelve false si el navegador no deja (contexto no seguro, permisos).
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

function enLinea(parrafo: string) {
  // Índices impares son lo que estaba entre backticks.
  return parrafo.split(/`([^`\n]+)`/).map((trozo, i) =>
    i % 2 === 1 ? (
      <code key={i} className="tl-linea-codigo">
        {trozo}
      </code>
    ) : (
      <span key={i}>{trozo}</span>
    ),
  );
}

function Parrafos({ texto }: { texto: string }) {
  const parrafos = texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return (
    <>
      {parrafos.map((p, i) => (
        <p key={i}>{enLinea(p)}</p>
      ))}
    </>
  );
}

export function BloqueCodigo({ etiqueta, codigo }: { etiqueta: string; codigo: string }) {
  const [estado, setEstado] = useState<"reposo" | "copiado" | "fallo">("reposo");

  const copiar = async () => {
    const ok = await copiarTexto(codigo);
    setEstado(ok ? "copiado" : "fallo");
    window.setTimeout(() => setEstado("reposo"), 1600);
  };

  return (
    <div className="tl-codigo">
      <div className="tl-codigo-cabecera">
        <span className="tl-codigo-pestana">{etiqueta || "código"}</span>
        <div className="tl-codigo-acciones">
          <button type="button" className="tl-accion" onClick={() => void copiar()}>
            {estado === "copiado" ? "Copiado" : estado === "fallo" ? "No se pudo copiar" : "Copiar"}
          </button>
          <button
            type="button"
            className="tl-accion tl-accion-principal"
            disabled
            title="Aplicar cambios al repositorio todavía no está disponible desde el chat"
          >
            Aplicar
          </button>
        </div>
      </div>
      <pre className="tl-codigo-cuerpo">
        <code>{codigo}</code>
      </pre>
    </div>
  );
}

export function Contenido({ texto }: { texto: string }) {
  return (
    <>
      {partirContenido(texto).map((bloque, i) =>
        bloque.tipo === "codigo" ? (
          <BloqueCodigo key={i} etiqueta={bloque.etiqueta} codigo={bloque.codigo} />
        ) : (
          <Parrafos key={i} texto={bloque.texto} />
        ),
      )}
    </>
  );
}
