import { Children, isValidElement, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Contenido de un mensaje: Markdown (títulos, listas, negritas, citas, tablas y enlaces) con bloques de código
// que tienen su pestaña y copiar. react-markdown no ejecuta HTML del texto: todo se muestra como texto.

// Copia al portapapeles. Devuelve false si el navegador no deja (contexto no seguro, permisos).
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
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

// Texto plano de un nodo de React (react-markdown entrega el código como hijos anidados).
function textoDe(nodo: ReactNode): string {
  if (nodo == null || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join("");
  if (isValidElement<{ children?: ReactNode }>(nodo)) return textoDe(nodo.props.children);
  return "";
}

const COMPONENTES: Components = {
  // Los bloques ``` llegan como <pre><code class="language-x">: se muestran con su pestaña y copiar.
  pre({ children }) {
    const hijo = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(hijo)) {
      const etiqueta = /language-(\S+)/.exec(hijo.props.className ?? "")?.[1] ?? "";
      return <BloqueCodigo etiqueta={etiqueta} codigo={textoDe(hijo.props.children).replace(/\n$/, "")} />;
    }
    return <pre>{children}</pre>;
  },
  // Enlaces en pestaña nueva, sin pasar la referencia de la conversación.
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // Las tablas anchas se desplazan dentro de su bloque, no en toda la página.
  table({ children }) {
    return (
      <div className="tl-tabla-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export function Contenido({ texto }: { texto: string }) {
  return (
    <div className="tl-md">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTES}>
        {texto}
      </Markdown>
    </div>
  );
}
