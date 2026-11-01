import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Message } from "../api";
import { useDialogo } from "./controls";

type CampoAgente = {
  id: string;
  etiqueta: string;
  ayuda?: string;
  aliases?: string[];
  requerido?: boolean;
};

type AgentePredefinido = {
  id: string;
  nombre: string;
  descripcion: string;
  integracion?: string;
  campos: CampoAgente[];
};

const CATALOGO: AgentePredefinido[] = [
  {
    id: "hyperframes-video",
    nombre: "Generar video",
    descripcion: "Convierte una composición HTML en video o animación y comprueba el render.",
    integracion: "Se intenta con HyperFrames vía npx cuando Node 22+, FFmpeg y al menos 4 GiB libres estén disponibles. Ese es un umbral mínimo, no una garantía: algunos renders requieren más espacio. No instala paquetes globales ni usa un servicio de pago.",
    campos: [
      { id: "objetivo", etiqueta: "Qué quieres mostrar", aliases: ["objetivo", "tema", "idea", "contenido"], requerido: true },
      { id: "duracion", etiqueta: "Duración aproximada", aliases: ["duración", "duracion", "segundos", "minutos"] },
      { id: "formato", etiqueta: "Formato y proporción", aliases: ["formato", "proporción", "proporcion", "relación de aspecto", "aspect ratio"] },
      { id: "estilo", etiqueta: "Estilo visual", aliases: ["estilo", "estética", "estetica", "colores"] },
      { id: "audio", etiqueta: "Voz, música o recursos", aliases: ["voz", "audio", "música", "musica", "recursos"] },
    ],
  },
  {
    id: "instagram-agent",
    nombre: "Agente de Instagram",
    descripcion: "Prepara publicaciones, Reels, Stories y un calendario de contenido.",
    integracion: "Puede preparar contenido aquí. Publicar o programar requiere conectar Meta OAuth y una cuenta profesional de Instagram con permisos vigentes.",
    campos: [
      { id: "objetivo", etiqueta: "Objetivo de la publicación", aliases: ["objetivo", "campaña", "tema"], requerido: true },
      { id: "marca", etiqueta: "Marca o cuenta", aliases: ["marca", "cuenta", "instagram"] },
      { id: "audiencia", etiqueta: "Audiencia", aliases: ["audiencia", "público", "publico", "clientes"] },
      { id: "formato", etiqueta: "Formato", aliases: ["formato", "reel", "story", "stories", "publicación", "publicacion"] },
      { id: "tono", etiqueta: "Tono y llamada a la acción", aliases: ["tono", "cta", "llamada a la acción", "llamada a la accion"] },
    ],
  },
  {
    id: "obsidian-vault",
    nombre: "Conectar con Obsidian",
    descripcion: "Organiza el resultado como notas Markdown con enlaces y etiquetas de Obsidian.",
    integracion: "Sin una conexión autenticada puede preparar la nota para copiar. Para escribir directamente hace falta Obsidian Local REST API o MCP, URL del vault y token guardado como secreto.",
    campos: [
      { id: "objetivo", etiqueta: "Qué quieres guardar u organizar", aliases: ["objetivo", "nota", "tema", "contenido"], requerido: true },
      { id: "vault", etiqueta: "Nombre del vault", aliases: ["vault", "bóveda", "boveda"] },
      { id: "ruta", etiqueta: "Carpeta o ruta de destino", aliases: ["carpeta", "ruta", "destino"] },
      { id: "enlaces", etiqueta: "Notas o etiquetas relacionadas", aliases: ["enlaces", "notas relacionadas", "etiquetas", "tags"] },
    ],
  },
  {
    id: "superpowers",
    nombre: "Superpowers · ingeniería",
    descripcion: "Aplica pasos pequeños, depuración sistemática y revisión según el tipo de trabajo.",
    integracion: "El flujo de trabajo está disponible como skill local. No instala hooks ni modifica la configuración global.",
    campos: [
      { id: "objetivo", etiqueta: "Tarea de ingeniería", aliases: ["objetivo", "tarea", "bug", "cambio"], requerido: true },
      { id: "repositorio", etiqueta: "Proyecto o repositorio", aliases: ["proyecto", "repositorio", "repo", "workspace"] },
      { id: "restricciones", etiqueta: "Restricciones", aliases: ["restricciones", "límite", "limite", "no hacer"] },
      { id: "verificacion", etiqueta: "Cómo verificarlo", aliases: ["verificación", "verificacion", "pruebas", "comprobación", "comprobacion"] },
    ],
  },
  {
    id: "ecc-workflows",
    nombre: "ECC · flujos de ingeniería",
    descripcion: "Elige prácticas de contexto, revisión y organización inspiradas en Everything Claude Code.",
    integracion: "La guía local selectiva ya está disponible. No instala el conjunto completo de ECC, hooks ni agentes externos.",
    campos: [
      { id: "objetivo", etiqueta: "Qué quieres resolver", aliases: ["objetivo", "tarea", "problema"], requerido: true },
      { id: "enfoque", etiqueta: "Enfoque: contexto, revisión o agentes", aliases: ["enfoque", "revisión", "revision", "agentes", "contexto"] },
      { id: "salida", etiqueta: "Resultado esperado", aliases: ["salida", "entregable", "resultado esperado"] },
    ],
  },
  {
    id: "harvey-legal",
    nombre: "Harvey · flujo legal",
    descripcion: "Estructura una pregunta o revisión legal, separando hechos, inferencias y asuntos pendientes.",
    integracion: "Esta skill prepara el trabajo legal; no conecta al servicio Harvey. Para usar Harvey hace falta una cuenta e integración autorizada por la organización.",
    campos: [
      { id: "objetivo", etiqueta: "Pregunta o documento que revisar", aliases: ["pregunta", "documento", "objetivo", "consulta"], requerido: true },
      { id: "jurisdiccion", etiqueta: "Jurisdicción", aliases: ["jurisdicción", "jurisdiccion", "país", "pais", "estado"] },
      { id: "fecha", etiqueta: "Fecha relevante", aliases: ["fecha", "vigencia", "fecha relevante"] },
      { id: "hechos", etiqueta: "Hechos y salida esperada", aliases: ["hechos", "formato de salida", "resultado esperado"] },
    ],
  },
  {
    id: "orca-agent-builder",
    nombre: "Orca · crear un agente",
    descripcion: "Diseña el propósito, entradas, herramientas, permisos y criterios de éxito de un agente.",
    integracion: "Hay varios productos llamados Orca. Indica cuál usas y comparte su documentación; mientras tanto solo se prepara una especificación local, sin asumir APIs ni publicar nada.",
    campos: [
      { id: "objetivo", etiqueta: "Propósito del agente", aliases: ["propósito", "proposito", "objetivo", "agente"] , requerido: true },
      { id: "producto", etiqueta: "Producto o plataforma Orca", aliases: ["orca", "plataforma", "producto"] },
      { id: "documentacion", etiqueta: "URL de documentación oficial", aliases: ["documentación", "documentacion", "docs", "url"] },
      { id: "entradas", etiqueta: "Entradas y salida", aliases: ["entradas", "input", "salida", "output"] },
      { id: "herramientas", etiqueta: "Modelo, herramientas y permisos", aliases: ["herramientas", "permisos", "modelo"] },
      { id: "exito", etiqueta: "Criterios de éxito", aliases: ["criterios de éxito", "criterios de exito", "éxito", "exito"] },
    ],
  },
  {
    id: "ai-job-search",
    nombre: "Buscar trabajo",
    descripcion: "Busca vacantes vigentes y ayuda a adaptar el CV y la carta con experiencia real.",
    integracion: "La búsqueda actual usa las herramientas de búsqueda disponibles en Telo. No envía postulaciones ni crea cuentas.",
    campos: [
      { id: "objetivo", etiqueta: "Cargo o tipo de oportunidad", aliases: ["cargo", "puesto", "objetivo", "vacante", "trabajo"] , requerido: true },
      { id: "ubicacion", etiqueta: "Ubicación y modalidad", aliases: ["ubicación", "ubicacion", "ciudad", "país", "pais", "modalidad", "remoto"] },
      { id: "experiencia", etiqueta: "Experiencia y habilidades", aliases: ["experiencia", "habilidades", "perfil"] },
      { id: "salario", etiqueta: "Salario esperado", aliases: ["salario", "sueldo", "remuneración", "remuneracion"] },
    ],
  },
  {
    id: "find-clients",
    nombre: "Encontrar clientes",
    descripcion: "Identifica prospectos con señales públicas y prepara propuestas de servicio personalizadas.",
    integracion: "La búsqueda de prospectos requiere búsqueda web habilitada. Enviar mensajes o guardar contactos requiere integración autenticada y aprobación.",
    campos: [
      { id: "objetivo", etiqueta: "Servicio que ofreces", aliases: ["servicio", "oferta", "objetivo", "producto"] , requerido: true },
      { id: "sector", etiqueta: "Sector o tipo de cliente", aliases: ["sector", "industria", "cliente ideal", "tipo de cliente"] },
      { id: "ubicacion", etiqueta: "Territorio o mercado", aliases: ["territorio", "mercado", "ubicación", "ubicacion", "ciudad", "país", "pais"] },
      { id: "senales", etiqueta: "Señales de necesidad", aliases: ["señales", "senales", "necesidad", "problema"] },
    ],
  },
];

function escaparRegExp(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function valorExplicito(textos: string[], aliases: string[] = []): string {
  for (const texto of textos) {
    for (const alias of aliases) {
      const patron = new RegExp(`(?:^|[\n;])\\s*(?:${escaparRegExp(alias)})\\s*[:=]\\s*([^\n;]{1,500})`, "i");
      const valor = texto.match(patron)?.[1]?.trim();
      if (valor) return valor;
    }
  }
  return "";
}

export function AgentesPredefinidosChat({
  messages,
  draft,
  onClose,
  onApply,
  onConfigureSupervisor,
  disparador,
}: {
  messages: Message[];
  draft: string;
  onClose: () => void;
  onApply: (draft: string) => void;
  onConfigureSupervisor: (draft: string) => void;
  disparador: RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previo = useRef(document.activeElement as HTMLElement | null);
  const tituloId = useId();
  const textos = messages.filter((message) => message.role === "user").slice(-24).reverse().map((message) => message.content);
  const ultimoMensajeUsuario = textos.find((texto) => !/^(?:sigue|contin[uú]a(?: donde qued[oó])?|dale|adelante|ok|s[ií]|va)[.!…\s]*$/i.test(texto.trim())) ?? textos[0] ?? "";
  const [seleccionado, setSeleccionado] = useState(CATALOGO[0]!.id);
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(
    CATALOGO.flatMap((agente) => agente.campos.map((campo) => [
      `${agente.id}:${campo.id}`,
      campo.id === "objetivo" ? draft.trim() || ultimoMensajeUsuario : valorExplicito(textos, campo.aliases),
    ])),
  ));
  const [estadoAutocompletado, setEstadoAutocompletado] = useState("");
  const cerrar = () => {
    (disparador.current ?? previo.current)?.focus();
    onClose();
  };
  useDialogo(ref, cerrar);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button[aria-pressed='true'], textarea, input")?.focus();
  }, []);

  const agente = CATALOGO.find((item) => item.id === seleccionado) ?? CATALOGO[0]!;
  const guardarCampo = (campo: CampoAgente, valor: string) => {
    setValores((actual) => ({ ...actual, [`${agente.id}:${campo.id}`]: valor }));
    setEstadoAutocompletado("");
  };
  const completarDesdeChat = () => {
    const nuevos = Object.fromEntries(agente.campos.map((campo) => {
      const existente = valores[`${agente.id}:${campo.id}`]?.trim();
      const encontrado = campo.id === "objetivo"
        ? draft.trim() || ultimoMensajeUsuario
        : valorExplicito(textos, campo.aliases);
      return [`${agente.id}:${campo.id}`, existente || encontrado];
    }));
    const cantidad = agente.campos.filter((campo) =>
      !valores[`${agente.id}:${campo.id}`]?.trim() && Boolean(nuevos[`${agente.id}:${campo.id}`]?.trim()),
    ).length;
    setValores((actual) => ({ ...actual, ...nuevos }));
    setEstadoAutocompletado(cantidad
      ? `${cantidad} campo${cantidad === 1 ? "" : "s"} completado${cantidad === 1 ? "" : "s"}; conservé los valores que ya habías escrito.`
      : "No encontré otros datos claros. Añádelos manualmente; no voy a adivinarlos.");
  };
  const prepararBorrador = () => {
    const campos = agente.campos.flatMap((campo) => {
      const valor = valores[`${agente.id}:${campo.id}`]?.trim();
      return valor ? [`${campo.etiqueta}: ${valor}`] : [];
    });
    return `$${agente.id}\n\n${campos.join("\n")}`.trim();
  };

  return (
    <>
      <div className="scrim dim" onClick={cerrar} />
      <section className="tl-dialogo tl-dialogo-documento tl-agentes-dialog" role="dialog" aria-modal="true" aria-labelledby={tituloId} ref={ref}>
        <header className="tl-dialogo-cabecera">
          <div className="tl-dialogo-titulo"><h2 className="tl-dialogo-h2" id={tituloId}>Agentes y skills</h2></div>
          <button type="button" className="tl-boton" onClick={cerrar} aria-label="Cerrar agentes">Cerrar</button>
        </header>
        <div className="tl-agentes-layout">
          <nav className="tl-agentes-lista" aria-label="Agentes predefinidos">
            {CATALOGO.map((item) => (
              <button key={item.id} type="button" className="tl-agentes-opcion" aria-pressed={seleccionado === item.id} onClick={() => setSeleccionado(item.id)}>
                <strong>{item.nombre}</strong><span>{item.descripcion}</span>
              </button>
            ))}
          </nav>
          <div className="tl-dialogo-cuerpo tl-agentes-detalle">
            <div>
              <h3>{agente.nombre}</h3>
              <p className="tl-orquestacion-nota">El objetivo toma el borrador actual o la última petición del chat. Los demás campos solo se rellenan cuando aparecen escritos con una etiqueta clara, por ejemplo «Audiencia: …».</p>
            </div>
            <div className="tl-agentes-autocompletar">
              <button type="button" className="tl-boton" onClick={completarDesdeChat}>Completar campos vacíos desde el chat</button>
              {estadoAutocompletado && <span role="status" aria-live="polite">{estadoAutocompletado}</span>}
            </div>
            {agente.integracion && <p className="tl-agentes-integracion" role="note">{agente.integracion}</p>}
            {agente.campos.map((campo) => {
              const id = `${tituloId}-${campo.id}`;
              return (
                <label className="tl-campo" key={campo.id} htmlFor={id}>
                  <span className="tl-campo-etiqueta">{campo.etiqueta}{campo.requerido ? " · requerido" : " · opcional"}</span>
                  <textarea id={id} className="tl-campo-texto tl-agentes-textarea" rows={campo.id === "objetivo" ? 3 : 2} maxLength={campo.id === "objetivo" ? 4000 : 1000}
                    value={valores[`${agente.id}:${campo.id}`] ?? ""} onChange={(event) => guardarCampo(campo, event.target.value)} />
                  {campo.ayuda && <span className="tl-campo-ayuda">{campo.ayuda}</span>}
                </label>
              );
            })}
            <div className="tl-agentes-pie">
              <p className="tl-orquestacion-nota">Usar en el chat aplica esta especialidad al agente principal. La opción de Supervisor añade al borrador una petición explícita de auxiliares; guardar modelos por sí solo no los activa. Usarán las conexiones guardadas en Configuración → Proveedores IA, sin credenciales separadas por agente. Revisa y envía el mensaje manualmente.</p>
              <div className="tl-dialogo-acciones">
                <button type="button" className="primary" onClick={() => onConfigureSupervisor(`${prepararBorrador()}\n\nUsa los auxiliares configurados para esta petición.`)} disabled={agente.campos.some((campo) => campo.requerido && !valores[`${agente.id}:${campo.id}`]?.trim())}>Configurar Supervisor y auxiliares</button>
                <button type="button" className="tl-boton" onClick={() => onApply(prepararBorrador())} disabled={agente.campos.some((campo) => campo.requerido && !valores[`${agente.id}:${campo.id}`]?.trim())}>Usar en el chat</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
