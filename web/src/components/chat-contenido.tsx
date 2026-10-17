import { Children, isValidElement, useEffect, useId, useState, type ReactNode } from "react";
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
  const soloLectura = ["text", "plaintext", "txt", "mermaid"].includes(etiqueta.toLowerCase());

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
          {!soloLectura && (
            <button
              type="button"
              className="tl-accion tl-accion-principal"
              disabled
              title="Aplicar cambios al repositorio todavía no está disponible desde el chat"
            >
              Aplicar
            </button>
          )}
        </div>
      </div>
      <pre className="tl-codigo-cuerpo">
        <code>{codigo}</code>
      </pre>
    </div>
  );
}

const LIMITE_DIAGRAMA = 12_000;

function valorTema(nombre: string, respaldo: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || respaldo;
}

function Diagrama({ codigo }: { codigo: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [revisionTema, setRevisionTema] = useState(0);
  const [svg, setSvg] = useState("");
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const actualizar = () => setRevisionTema(revision => revision + 1);
    const observer = new MutationObserver(actualizar);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const sistema = window.matchMedia("(prefers-color-scheme: light)");
    sistema.addEventListener("change", actualizar);
    return () => {
      observer.disconnect();
      sistema.removeEventListener("change", actualizar);
    };
  }, []);

  useEffect(() => {
    let vigente = true;
    setSvg("");
    setFallo(codigo.length > LIMITE_DIAGRAMA);
    if (codigo.length <= LIMITE_DIAGRAMA) {
      void (async () => {
        try {
          const { default: mermaid } = await import("mermaid");
          const oscuro = getComputedStyle(document.documentElement).colorScheme !== "light";
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "htmlLabels", "suppressErrorRendering", "flowchart", "theme", "themeVariables"],
            suppressErrorRendering: true,
            maxTextSize: LIMITE_DIAGRAMA,
            maxEdges: 150,
            htmlLabels: false,
            theme: "base",
            flowchart: { useMaxWidth: false, htmlLabels: false, curve: "linear" },
            themeVariables: {
              darkMode: oscuro,
              nodeShadow: false,
              dropShadow: "none",
              background: valorTema("--surface", "#121316"),
              primaryColor: valorTema("--surface-2", "#1b1b1f"),
              primaryTextColor: valorTema("--ink", "#f5f5f7"),
              primaryBorderColor: valorTema("--line-strong", "#44474a"),
              secondaryColor: valorTema("--surface", "#121316"),
              secondaryTextColor: valorTema("--ink", "#f5f5f7"),
              secondaryBorderColor: valorTema("--line", "#292a2d"),
              tertiaryColor: valorTema("--surface-lowest", "#0d0e11"),
              tertiaryTextColor: valorTema("--ink", "#f5f5f7"),
              tertiaryBorderColor: valorTema("--line", "#292a2d"),
              lineColor: valorTema("--ink-2", "#9ca3af"),
              edgeLabelBackground: valorTema("--surface", "#121316"),
              mainBkg: valorTema("--surface-2", "#1b1b1f"),
              nodeBorder: valorTema("--line-strong", "#44474a"),
              clusterBkg: valorTema("--surface", "#121316"),
              clusterBorder: valorTema("--line", "#292a2d"),
              titleColor: valorTema("--ink", "#f5f5f7"),
              textColor: valorTema("--ink", "#f5f5f7"),
              fontFamily: valorTema("--font", "Geist, sans-serif"),
            },
          });
          const resultado = await mermaid.render(`tl-diagrama-${id}`, codigo);
          if (vigente) setSvg(resultado.svg);
        } catch {
          if (vigente) setFallo(true);
        }
      })();
    }
    return () => { vigente = false; };
  }, [codigo, id, revisionTema]);

  return (
    <figure className="tl-diagrama">
      <figcaption className="tl-diagrama-titulo">Diagrama</figcaption>
      {svg ? (
        <div className="tl-diagrama-visual" role="img" aria-label="Diagrama generado desde la respuesta del chat" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="tl-diagrama-estado" role={fallo ? "alert" : "status"}>
          {fallo ? "No se pudo dibujar este diagrama. Puedes revisar o copiar su código." : "Generando diagrama…"}
        </p>
      )}
      <details className="tl-diagrama-fuente">
        <summary>Ver código Mermaid</summary>
        <BloqueCodigo etiqueta="mermaid" codigo={codigo} />
      </details>
    </figure>
  );
}

const EXTENSIONES_CODIGO = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "css", "scss", "html", "htm",
  "md", "markdown", "py", "sql", "sh", "bash",
  "yaml", "yml", "toml", "lock", "svg", "png", "jpg", "jpeg",
  "env", "dockerfile", "gitignore", "txt", "conf", "ini"
]);

const PREFIJOS_CARPETAS = /^(web|server|src|components|lib|pages|styles|routes|runners|tests|\.opencode|\.config|\.github|skills|data|dist|public)\//i;

export function esRutaArchivo(texto: string): boolean {
  if (!texto || texto.length < 3 || texto.length > 200) return false;
  if (/[\s;{}()="'<>`$*?!]/.test(texto)) return false;
  const tieneBarras = texto.includes("/") || texto.includes("\\");
  const partes = texto.split(/[/\\]/);
  const ultimoSegmento = partes[partes.length - 1];
  const puntoIdx = ultimoSegmento.lastIndexOf(".");
  if (puntoIdx > 0 && puntoIdx < ultimoSegmento.length - 1) {
    const ext = ultimoSegmento.slice(puntoIdx + 1).toLowerCase();
    if (EXTENSIONES_CODIGO.has(ext)) return true;
  }
  if (tieneBarras && PREFIJOS_CARPETAS.test(texto)) return true;
  return false;
}

function IconoArchivo({ extension }: { extension: string }) {
  const ext = extension.toLowerCase();
  if (ext === "tsx" || ext === "jsx") {
    return (
      <svg width="13" height="13" viewBox="-11.5 -10.23174 23 20.46348" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <circle cx="0" cy="0" r="2.05" fill="#00d8ff" />
        <g stroke="#00d8ff">
          <ellipse rx="11" ry="4.2" />
          <ellipse rx="11" ry="4.2" transform="rotate(60)" />
          <ellipse rx="11" ry="4.2" transform="rotate(120)" />
        </g>
      </svg>
    );
  }
  if (ext === "ts") {
    return (
      <span style={{ fontSize: 9, fontWeight: 800, background: "#3178c6", color: "#fff", padding: "1px 3px", borderRadius: 2, lineHeight: 1 }}>
        TS
      </span>
    );
  }
  if (ext === "js" || ext === "mjs" || ext === "cjs") {
    return (
      <span style={{ fontSize: 9, fontWeight: 800, background: "#f7df1e", color: "#000", padding: "1px 3px", borderRadius: 2, lineHeight: 1 }}>
        JS
      </span>
    );
  }
  if (ext === "css" || ext === "scss") {
    return (
      <span style={{ fontSize: 11, fontWeight: 800, color: "#38bdf8", lineHeight: 1 }}>
        #
      </span>
    );
  }
  if (ext === "json") {
    return (
      <span style={{ fontSize: 10, fontWeight: 800, color: "#f59e0b", lineHeight: 1 }}>
        {"{}"}
      </span>
    );
  }
  if (ext === "md" || ext === "markdown") {
    return (
      <span style={{ fontSize: 9, fontWeight: 800, background: "#475569", color: "#f8fafc", padding: "1px 3px", borderRadius: 2, lineHeight: 1 }}>
        MD
      </span>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function PastillaArchivo({ ruta }: { ruta: string }) {
  const [copiado, setCopiado] = useState(false);
  const partes = ruta.split(/[/\\]/);
  const nombreArchivo = partes[partes.length - 1];
  const puntoIdx = nombreArchivo.lastIndexOf(".");
  const ext = puntoIdx > 0 ? nombreArchivo.slice(puntoIdx + 1).toLowerCase() : "";

  const copiar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copiarTexto(ruta);
    if (ok) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    }
  };

  return (
    <span
      className={`tl-archivo-chip${copiado ? " is-copiado" : ""}`}
      title={copiado ? "¡Ruta copiada al portapapeles!" : `${ruta} (Clic para copiar)`}
      onClick={copiar}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") void copiar(e as any);
      }}
    >
      <span className="tl-archivo-chip-icono" aria-hidden="true">
        <IconoArchivo extension={ext} />
      </span>
      <span className="tl-archivo-chip-ruta">{ruta}</span>
      <span className="tl-archivo-chip-accion" aria-hidden="true">
        {copiado ? "✓" : "📋"}
      </span>
    </span>
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
  pre({ children }: { children?: ReactNode }) {
    const hijo = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(hijo)) {
      const etiqueta = /language-(\S+)/.exec(hijo.props.className ?? "")?.[1] ?? "";
      const codigo = textoDe(hijo.props.children).replace(/\n$/, "");
      if (etiqueta.toLowerCase() === "mermaid") return <Diagrama codigo={codigo} />;
      return <BloqueCodigo etiqueta={etiqueta} codigo={codigo} />;
    }
    return <pre>{children}</pre>;
  },
  // Código inline: si parece una ruta de archivo, renderiza como pastilla interactiva
  code({ className, children, ...props }) {
    const texto = textoDe(children).trim();
    if (esRutaArchivo(texto)) {
      return <PastillaArchivo ruta={texto} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
  // Enlaces en pestaña nueva, y enlaces a archivos locales como pastilla
  a({ href, children }: { href?: string; children?: ReactNode }) {
    const textoHref = href ?? "";
    const textoHijo = textoDe(children).trim();
    if (textoHref.startsWith("file://") || esRutaArchivo(textoHref) || esRutaArchivo(textoHijo)) {
      const rutaReal = textoHref.startsWith("file://")
        ? textoHref.replace(/^file:\/\/\/?/, "")
        : (esRutaArchivo(textoHijo) ? textoHijo : textoHref);
      return <PastillaArchivo ruta={rutaReal} />;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // Las tablas anchas se desplazan dentro de su bloque, no en toda la página.
  table({ children }: { children?: ReactNode }) {
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
