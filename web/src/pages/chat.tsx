import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Conversation, type Documento, type FormatoDocumento, type Message, type ModelInfo, type PasoActividad } from "../api";
import { useEventosVivos } from "../lib/eventos-vivos";
import { ModelPicker } from "../components/model-picker";
import { UsoPanel } from "../components/uso-panel";
import { IndicadorPensando, MensajeAgente, MensajeUsuario } from "../components/chat-mensajes";
import { copiarTexto } from "../components/chat-contenido";
import { ChatConfiguracion } from "../components/chat-configuracion";
import { AvisoCuota } from "../components/cuota-aviso";
import { VistaDocumento } from "../components/documentos";
import { HistorialPrompts, type PromptEnviado } from "../components/chat-historial";
import { MenuComandosChat, type ComandoChat } from "../components/chat-comandos";
import { PlanRevision } from "../components/plan-revision";
import { AccionesRepositorioChat } from "../components/repository-approval";
import { sugerenciasChat } from "../lib/sugerencias";
import { effortLabel, errorText, formatWhen, tierBars } from "../lib/model";
import {
  componerMensaje,
  etiquetaBytes,
  leerArchivo,
  partirMensaje,
  TOPE_ADJUNTO_CARACTERES,
  type ArchivoLeido,
} from "../lib/adjuntos";
import { useShell } from "../components/shell-context";
import "../styles-chat.css";
import "../styles-flujo.css";

type Patch = { model?: string | null; effort?: string | null; title?: string; pinned?: boolean };

// Un archivo adjunto en el compositor, antes de enviar el mensaje.
type Pendiente = { key: string; lectura: ArchivoLeido };

// Lo que había en el compositor al enviar: vuelve si el envío no se guarda en el servidor.
type Restaurar = { texto: string; pendientes: Pendiente[] };

// Borrador por chat, guardado en este navegador: sobrevive a cambiar de pantalla o a una señal caída.
// Si el navegador no deja guardar, el borrador solo vive en la pantalla.
const claveBorrador = (id: string) => `telo:borrador:${id}`;
function leerBorrador(id: string): string {
  try {
    return localStorage.getItem(claveBorrador(id)) ?? "";
  } catch {
    return "";
  }
}
function guardarBorrador(id: string, texto: string) {
  try {
    if (texto) localStorage.setItem(claveBorrador(id), texto);
    else localStorage.removeItem(claveBorrador(id));
  } catch {
    // Sin almacenamiento disponible: se ignora.
  }
}

// Quita tildes y pasa a minúsculas para buscar comandos: "analiticas" encuentra "Analíticas".
const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Ventana de contexto en tokens, abreviada: 128000 es "128k".
function etiquetaContexto(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}k`;
}

// Dictado: la API de voz del navegador (Chrome y Edge; necesita contexto seguro).
type ReconocimientoVoz = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
function ctorVoz(): (new () => ReconocimientoVoz) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => ReconocimientoVoz;
    webkitSpeechRecognition?: new () => ReconocimientoVoz;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
function mensajeVoz(codigo: string): string {
  if (codigo === "not-allowed" || codigo === "service-not-allowed") return "Permite el micrófono en el navegador para dictar.";
  if (codigo === "no-speech") return "No se escuchó nada. Intenta de nuevo.";
  if (codigo === "network") return "El dictado necesita conexión y una dirección https.";
  return "No se pudo dictar el mensaje.";
}

const ICONO_ARCHIVO = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const ICONO_IMAGEN = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

let contadorPendientes = 0;
const nuevaClave = () => String(++contadorPendientes);

export function ChatPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { selectedConversationId, setSelectedConversationId, triggerPalette, configAbierta, setConfigAbierta } =
    useShell();
  const selectedId = selectedConversationId;
  const setSelectedId = setSelectedConversationId;

  const [draft, setDraft] = useState("");
  // Al cambiar de chat, carga el borrador de ese chat (no se guarda en un efecto para no mezclar chats).
  useEffect(() => {
    if (selectedId) setDraft(leerBorrador(selectedId));
  }, [selectedId]);
  const cambiarBorrador = (texto: string) => {
    setDraft(texto);
    setSugerenciaOculta(false);
    setSlashActivo(0);
    setSlashOculto(false);
    if (selectedId) guardarBorrador(selectedId, texto);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [usoAbierto, setUsoAbierto] = useState(false);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [dictando, setDictando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vistaDoc, setVistaDoc] = useState<Documento | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [resaltadoId, setResaltadoId] = useState<string | null>(null);
  // Menú de "/": activo es la fila marcada; oculto lo cierra con Escape hasta que el texto cambie.
  const [slashActivo, setSlashActivo] = useState(0);
  const [slashOculto, setSlashOculto] = useState(false);
  const [sugerenciaOculta, setSugerenciaOculta] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<ReconocimientoVoz | null>(null);
  // Botones que abren el selector y el panel de uso: reciben el foco al cerrar.
  const chipRef = useRef<HTMLButtonElement>(null);
  const usoRef = useRef<HTMLButtonElement>(null);

  // Los adjuntos son del chat en el que se escribieron.
  useEffect(() => {
    setPendientes([]);
  }, [selectedId]);

  // Al salir del chat se corta el dictado.
  useEffect(() => () => recRef.current?.stop(), []);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
    refetchInterval: 4_000,
  });

  // Abre el chat más reciente al cargar si no hay uno seleccionado
  useEffect(() => {
    if (!selectedId && conversations.data?.length) {
      setSelectedId(conversations.data[0].id);
    }
  }, [selectedId, conversations.data, setSelectedId]);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: api.listModels,
    staleTime: 5 * 60_000,
  });

  // Cada 4 s mientras la pestaña está visible: los mensajes que llegan desde otro dispositivo aparecen solos.
  const messages = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => api.listMessages(selectedId!),
    enabled: !!selectedId,
    refetchInterval: 4_000,
  });

  const current: Conversation | null =
    conversations.data?.find((c) => c.id === selectedId) ?? null;
  const tareasChat = useQuery({
    queryKey: ["conversation-tasks", selectedId],
    queryFn: () => api.conversationTasks(selectedId!),
    enabled: !!selectedId && !!current?.project_id,
    refetchInterval: 3_000,
  });
  const tareaChat = current?.project_id ? tareasChat.data?.[0] : undefined;
  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === current?.model) ?? null;
  const lista = messages.data ?? [];

  const configure = useMutation({
    mutationFn: (patch: Patch) => api.updateConversation(selectedId!, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      const previous = qc.getQueryData<Conversation[]>(["conversations"]);
      qc.setQueryData<Conversation[]>(["conversations"], (list) =>
        list?.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                model: patch.model !== undefined ? patch.model : c.model,
                effort: patch.effort !== undefined ? patch.effort : c.effort,
                title: patch.title !== undefined ? patch.title : c.title,
              }
            : c,
        ),
      );
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(["conversations"], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  // Anclar desde el comando "/": el mismo cambio que el icono de la barra lateral.
  const anclar = useMutation({
    mutationFn: (pinned: boolean) => api.updateConversation(selectedId!, { pinned }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  // Pasos del agente en vivo, por chat. Llegan por el canal (evento "actividad") mientras el agente corre.
  const [vivos, setVivos] = useState<Record<string, { turnoId: string; pasos: PasoActividad[] }>>({});
  useEventosVivos({}, (evento) => {
    if (evento.tipo === "tarea" || evento.tipo === "evento") {
      void qc.invalidateQueries({ queryKey: ["conversation-tasks", selectedId] });
      void qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      return;
    }
    // Un turno empezó o terminó, aquí o en otro dispositivo: la lista y los mensajes se piden de nuevo.
    if (evento.tipo === "chat") {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["messages", evento.conversacion_id] });
      void qc.invalidateQueries({ queryKey: ["conversation-tasks", evento.conversacion_id] });
      void qc.invalidateQueries({ queryKey: ["repository-actions", evento.conversacion_id] });
      return;
    }
    if (evento.tipo !== "actividad") return;
    setVivos((prev) => {
      const previo = prev[evento.conversacion_id];
      const pasos = previo && previo.turnoId === evento.turno_id ? previo.pasos : [];
      // El canal puede repetir un paso al reconectar: se ignora si ya está.
      if (pasos.some((p) => p.seq === evento.paso.seq)) return prev;
      return { ...prev, [evento.conversacion_id]: { turnoId: evento.turno_id, pasos: [...pasos, evento.paso] } };
    });
  });

  // Cuántos mensajes del usuario con este texto hay en la lista: sirve para saber si un envío llegó al servidor.
  const contarEnvios = (lista: Message[] | undefined, texto: string) =>
    (lista ?? []).filter((m) => m.role === "user" && m.content.trim() === texto.trim()).length;

  // El compositor se vacía al enviar: el agente puede tardar, y el texto no debe quedarse esperando.
  // Un ApiError es una respuesta del servidor: el mensaje no se guardó y lo escrito vuelve al compositor.
  // Sin respuesta (red caída, móvil dormido) el servidor puede haberlo guardado igual: se mira la lista
  // y, si el mensaje ya está, el envío se da por bueno. Así no se duplica ni se pierde.
  const send = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string; restaurar?: Restaurar }) => {
      const previos = contarEnvios(qc.getQueryData<Message[]>(["messages", id]), content);
      try {
        return await api.sendMessage(id, content);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const ahora = await api.listMessages(id).catch(() => null);
        if (ahora && contarEnvios(ahora, content) > previos) return { messages: [] };
        throw err;
      }
    },
    onError: (_err, { id, restaurar }) => {
      if (!restaurar) return;
      if (id === selectedId) {
        const nuevo = restaurar.texto && draft.trim() ? `${restaurar.texto}\n${draft}` : restaurar.texto || draft;
        cambiarBorrador(nuevo);
        setPendientes((prev) => [...restaurar.pendientes, ...prev]);
      } else {
        const previo = leerBorrador(id);
        guardarBorrador(id, restaurar.texto && previo.trim() ? `${restaurar.texto}\n${previo}` : restaurar.texto || previo);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-tasks", selectedId] });
      qc.invalidateQueries({ queryKey: ["repository-actions", selectedId] });
    },
  });

  // Tras una cuota agotada: el chat retoma su sesión con el modelo elegido (ver /seguir en el servidor).
  const seguirChat = useMutation({
    mutationFn: () => api.continueChat(selectedId!),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const crearDoc = useMutation({
    mutationFn: ({ mensajeId, formato }: { mensajeId: string; formato: FormatoDocumento }) =>
      api.crearDocumento({ mensaje_id: mensajeId, formato }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documentos", doc.conversation_id] });
      setVistaDoc(doc);
    },
  });

  // Un solo control: el modelo y su nivel de esfuerzo se eligen juntos. null en esfuerzo es "Auto".
  const elegirModelo = (m: ModelInfo | null, esfuerzo: string | null = null) => {
    setPickerOpen(false);
    if (!m) {
      configure.mutate({ model: null, effort: null });
      return;
    }
    configure.mutate({ model: m.id, effort: esfuerzo });
  };

  // Adjuntos listos: solo los de texto viajan al agente.
  const adjuntosListos = pendientes.flatMap((p) => (p.lectura.tipo === "texto" ? [p.lectura.adjunto] : []));
  const puedeEnviar =
    !!selectedId && !send.isPending && !current?.ocupada && (draft.trim() !== "" || adjuntosListos.length > 0);

  const submit = () => {
    if (!puedeEnviar || !selectedId) return;
    const content = componerMensaje(draft, adjuntosListos);
    if (!content) return;
    const restaurar: Restaurar = { texto: draft, pendientes };
    // El dictado se corta del todo: sus resultados tardíos no deben volver a llenar el compositor.
    const rec = recRef.current;
    if (rec) {
      rec.onresult = null;
      rec.stop();
      recRef.current = null;
      setDictando(false);
    }
    cambiarBorrador("");
    setPendientes([]);
    send.mutate({ id: selectedId, content, restaurar });
  };

  // Vuelve a enviar el mensaje del usuario que precede a una respuesta.
  const reintentar = (mensajeId: string) => {
    const i = lista.findIndex((m) => m.id === mensajeId);
    const previo = lista.slice(0, i).reverse().find((m) => m.role === "user");
    if (previo && selectedId && !send.isPending && !current?.ocupada) {
      send.mutate({ id: selectedId, content: previo.content });
    }
  };

  const avisar = (texto: string) => {
    setAviso(texto);
    window.setTimeout(() => setAviso(null), 2400);
  };

  // Lee archivos y los añade al compositor. Un mensaje no puede pasar del tope de texto de adjuntos.
  const agregarArchivos = async (archivos: File[]) => {
    if (archivos.length === 0) return;
    const leidos = await Promise.all(archivos.map(leerArchivo));
    setPendientes((prev) => {
      let usados = prev.reduce(
        (n, p) => n + (p.lectura.tipo === "texto" ? p.lectura.adjunto.contenido.length : 0),
        0,
      );
      const nuevos = leidos.map((lectura): Pendiente => {
        if (lectura.tipo !== "texto") return { key: nuevaClave(), lectura };
        const largo = lectura.adjunto.contenido.length;
        if (usados + largo > TOPE_ADJUNTO_CARACTERES) {
          return {
            key: nuevaClave(),
            lectura: {
              tipo: "error",
              nombre: lectura.adjunto.nombre,
              motivo: `Supera el límite de ${TOPE_ADJUNTO_CARACTERES.toLocaleString("es")} caracteres por mensaje.`,
              tamano: lectura.tamano,
            },
          };
        }
        usados += largo;
        return { key: nuevaClave(), lectura };
      });
      return [...prev, ...nuevos];
    });
  };

  // Pegar: si el portapapeles trae texto, se pega el texto; si solo trae archivos o imágenes, se adjuntan.
  const alPegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const archivos = Array.from(e.clipboardData.files);
    if (archivos.length === 0 || e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    void agregarArchivos(archivos);
  };

  const alArrastrar = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setArrastrando(true);
  };

  const alSoltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastrando(false);
    void agregarArchivos(Array.from(e.dataTransfer.files));
  };

  const dictar = () => {
    if (dictando) {
      recRef.current?.stop();
      return;
    }
    const Ctor = ctorVoz();
    if (!Ctor) return;
    const base = draft;
    const rec = new Ctor();
    rec.lang = navigator.language || "es";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let dicho = "";
      for (let i = 0; i < e.results.length; i++) dicho += e.results[i][0].transcript;
      const sep = base && !/\s$/.test(base) ? " " : "";
      cambiarBorrador(`${base}${sep}${dicho.trim()}`);
    };
    rec.onerror = (e) => avisar(mensajeVoz(e.error));
    rec.onend = () => {
      recRef.current = null;
      setDictando(false);
    };
    recRef.current = rec;
    setDictando(true);
    rec.start();
  };

  // El campo crece con el texto hasta un máximo.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  // Mantiene visible el último mensaje, incluido el de "pensando".
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length, send.isPending, selectedId, tareaChat?.status, tareaChat?.plan_hash]);

  // Solo llega aquí un fallo que no se guardó (409 si el chat ya responde, 4xx o 5xx del servidor).
  const sendError = send.isError ? errorText(send.error) : null;
  const settingsError = configure.isError ? errorText(configure.error) : null;
  const docError = crearDoc.isError ? errorText(crearDoc.error) : null;
  const anclarError = anclar.isError ? errorText(anclar.error) : null;
  const error = sendError ?? settingsError ?? docError ?? anclarError;

  // El mensaje que se envió desde este dispositivo ya puede estar en la lista (el sondeo lo trae antes de terminar).
  const ultimoMensaje = lista.at(-1);
  const yaGuardado = send.isPending && ultimoMensaje?.role === "user" && ultimoMensaje.content === send.variables?.content;
  // Pensando: se envió aquí o el chat está ocupado (otro dispositivo lo envió).
  const tareaActiva = !!tareaChat && ["queued", "analyzing", "running"].includes(tareaChat.status);
  const pensando = send.isPending || seguirChat.isPending || (tareaChat ? tareaActiva : !!current?.ocupada);
  const sugerencia = !sugerenciaOculta && !pensando && !draft.startsWith("/")
    ? sugerenciasChat(lista).find((s) => !draft || (s.toLocaleLowerCase().startsWith(draft.toLocaleLowerCase()) && s.length > draft.length))
    : undefined;
  useEffect(() => setSugerenciaOculta(false), [selectedId, lista.length]);

  // Cuando el chat deja de estar ocupado, sus pasos ya están guardados en el servidor: se vacían los en vivo.
  useEffect(() => {
    if (!selectedId || pensando) return;
    setVivos((prev) => {
      if (!prev[selectedId]) return prev;
      const { [selectedId]: _terminado, ...resto } = prev;
      return resto;
    });
  }, [pensando, selectedId]);

  // Turno de una respuesta: el mensaje del usuario que la precede. Sus pasos se piden al abrir "Ver proceso".
  const turnoDeRespuesta = (indice: number): string | null => {
    for (let j = indice - 1; j >= 0; j--) if (lista[j].role === "user") return lista[j].id;
    return null;
  };

  // Nombres reales: el modelo del chat o "Agente" si el servidor todavía no ha elegido uno.
  const efectoActual = current?.effort ?? null;
  const nombreAgente = modelInfo?.name ?? current?.model ?? "Agente";
  const nombreChip = current?.model ? nombreAgente : "Predeterminado";
  const contexto = etiquetaContexto(modelInfo?.context);
  // Etiqueta del selector del compositor: "Nombre del modelo · Esfuerzo", o "Predeterminado" si el servidor elige.
  const nombreModelo = current?.model ? (modelInfo?.name ?? current.model) : null;
  const etiquetaChip =
    nombreModelo === null
      ? "Predeterminado"
      : efectoActual
        ? `${nombreModelo} · ${effortLabel(efectoActual)}`
        : (modelInfo?.variants.length ?? 0) > 0
          ? `${nombreModelo} · Auto`
          : nombreModelo;
  const nivelCosto = tierBars(modelInfo?.costTier ?? "medio");
  const hayMensajes = lista.length > 0;

  // Conversación completa en Markdown: para compartir o exportar.
  const transcripcion = () => {
    const titulo = current?.title ?? "Chat";
    const partes = lista.map((m) => {
      const autor = m.role === "user" ? "Tú" : nombreAgente;
      const { texto, adjuntos } = partirMensaje(m.content);
      const anexos = adjuntos.map((a) => `\n\n**Adjunto: ${a.nombre}**\n\n~~~~\n${a.contenido}\n~~~~`).join("");
      return `## ${autor} · ${formatWhen(m.created_at)}\n\n${texto}${anexos}`;
    });
    return `# ${titulo}\n\n${partes.join("\n\n---\n\n")}\n`;
  };

  const compartir = async () => {
    const texto = transcripcion();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: current?.title ?? "Chat", text: texto });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    const ok = await copiarTexto(texto);
    avisar(ok ? "Conversación copiada al portapapeles" : "No se pudo copiar la conversación");
  };

  const exportar = () => {
    const url = URL.createObjectURL(new Blob([transcripcion()], { type: "text/markdown;charset=utf-8" }));
    const enlace = document.createElement("a");
    const base = (current?.title ?? "chat").replace(/[\\/:*?"<>|\r\n]/g, " ").trim().slice(0, 60) || "chat";
    enlace.href = url;
    enlace.download = `${base}.md`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisar("Chat exportado en Markdown");
  };

  const dictadoDisponible = ctorVoz() !== null;

  // Prompts enviados en este chat, del más reciente al más antiguo: alimentan el historial.
  const prompts: PromptEnviado[] = lista
    .filter((m) => m.role === "user")
    .map((m) => ({
      id: m.id,
      texto: partirMensaje(m.content).texto.replace(/\s+/g, " ").trim() || "Mensaje con adjuntos",
      cuando: m.created_at,
    }))
    .reverse();

  // Salta al mensaje del historial y lo resalta un momento.
  const irAPrompt = (id: string) => {
    setHistorialAbierto(false);
    setResaltadoId(id);
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`mensaje-${id}`)?.scrollIntoView({ block: "center", behavior: suave ? "smooth" : "auto" });
    window.setTimeout(() => setResaltadoId((actual) => (actual === id ? null : actual)), 1800);
  };

  const nuevoChat = () => {
    api.createConversation(null).then(
      (conv) => {
        void qc.invalidateQueries({ queryKey: ["conversations"] });
        setSelectedId(conv.id);
      },
      () => avisar("No se pudo crear el chat"),
    );
  };

  // Comandos que se ven al escribir "/" en el compositor.
  const anclado = Boolean(current?.pinned_at);
  const comandosChat: ComandoChat[] = [
    { id: "nuevo", etiqueta: "Nuevo chat", descripcion: "Abre un chat vacío", ejecutar: nuevoChat },
    {
      id: "historial",
      etiqueta: "Historial de prompts",
      descripcion: "Salta a un prompt que ya enviaste",
      ejecutar: () => setHistorialAbierto(true),
    },
    {
      id: "adjuntar",
      etiqueta: "Adjuntar archivo",
      descripcion: "Archivos de texto, código o documentos",
      ejecutar: () => fileRef.current?.click(),
    },
    ...(dictadoDisponible
      ? [
          {
            id: "dictar",
            etiqueta: "Dictar mensaje",
            descripcion: "La voz se convierte en texto",
            ejecutar: dictar,
          },
        ]
      : []),
    {
      id: "modelo",
      etiqueta: "Cambiar modelo",
      descripcion: "Modelo y nivel de esfuerzo de este chat",
      ejecutar: () => {
        setUsoAbierto(false);
        setPickerOpen(true);
      },
    },
    {
      id: "uso",
      etiqueta: "Uso y límites",
      descripcion: "Cuota y consumo de los agentes",
      ejecutar: () => {
        setPickerOpen(false);
        setUsoAbierto(true);
      },
    },
    {
      id: "configuracion",
      etiqueta: "Configuración del chat",
      descripcion: "Proyecto, modelo, esfuerzo y documentos",
      ejecutar: () => setConfigAbierta(true),
    },
    {
      id: "anclar",
      etiqueta: anclado ? "Quitar del ancla" : "Anclar chat arriba",
      descripcion: "Mantiene el chat al inicio de la lista",
      ejecutar: () => anclar.mutate(!anclado),
    },
    ...(hayMensajes
      ? [
          {
            id: "compartir",
            etiqueta: "Compartir conversación",
            descripcion: "Envía o copia el texto del chat",
            ejecutar: () => void compartir(),
          },
          {
            id: "exportar",
            etiqueta: "Exportar en Markdown",
            descripcion: "Descarga el chat como archivo .md",
            ejecutar: exportar,
          },
        ]
      : []),
  ];

  // El menú aparece solo si el mensaje empieza por "/" y hay comandos que coinciden.
  const slashVisible = draft.startsWith("/") && !draft.includes("\n") && !slashOculto;
  const palabrasSlash = sinTildes(draft.slice(1).trim()).split(/\s+/).filter(Boolean);
  const comandosFiltrados = slashVisible
    ? comandosChat.filter((c) => {
        const texto = sinTildes(`${c.etiqueta} ${c.descripcion}`);
        return palabrasSlash.every((p) => texto.includes(p));
      })
    : [];
  const menuAbierto = comandosFiltrados.length > 0;
  const indiceSlash = Math.min(slashActivo, Math.max(comandosFiltrados.length - 1, 0));

  useEffect(() => {
    if (menuAbierto) {
      document.getElementById(`comando-chat-${comandosFiltrados[indiceSlash]?.id}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [indiceSlash, menuAbierto]);

  // Ejecuta un comando: quita el "/..." del compositor antes de correrlo.
  const elegirComando = (c: ComandoChat) => {
    cambiarBorrador("");
    c.ejecutar();
  };

  return (
    <section className="tl-chat" aria-label="Chat">
      {!selectedId ? (
        <div className="tl-vacio">
          <div className="tl-vacio-caja">
            {conversations.isPending ? (
              <p>Cargando chats…</p>
            ) : conversations.isError ? (
              <>
                <h2>No se pudieron cargar los chats</h2>
                <p>Revisa la conexión e intenta de nuevo.</p>
                <button type="button" className="tl-boton" onClick={() => void conversations.refetch()}>
                  Reintentar
                </button>
              </>
            ) : (
              <>
                <h2>Sin conversación activa</h2>
                <p>Elige un chat de la lista o crea un proyecto para agrupar tus chats y tareas.</p>
                <button
                  type="button"
                  className="tl-boton tl-boton-principal"
                  onClick={() => void navigate({ to: "/proyectos" })}
                >
                  Nuevo proyecto
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <header className="tl-chat-cabecera">
            <div className="tl-chat-cabecera-izq">
              <span className="tl-chip tl-chip-modelo" title="Modelo de este chat">
                <span className="tl-chip-nombre">{nombreChip}</span>
                {contexto && <span className="tl-chip-dato">{contexto}</span>}
              </span>
              <h1 className="tl-chat-titulo">{current?.title ?? "Chat"}</h1>
              {current?.project_name && (
                <span className="tl-chip tl-chip-proyecto" title={`Proyecto: ${current.project_name}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  <span className="tl-chip-texto">{current.project_name}</span>
                </span>
              )}
            </div>
            <div className="tl-chat-cabecera-der">
              <button
                type="button"
                className="tl-boton"
                aria-label="Compartir conversación"
                title="Compartir la conversación"
                disabled={!hayMensajes}
                onClick={() => void compartir()}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                  <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
                <span className="tl-boton-texto">Compartir</span>
              </button>
              <button
                type="button"
                className="tl-boton"
                aria-label="Exportar conversación"
                title="Exportar la conversación en Markdown"
                disabled={!hayMensajes}
                onClick={exportar}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="tl-boton-texto">Exportar</span>
              </button>
              <div className="tl-historial-wrap">
                <button
                  type="button"
                  className="tl-boton"
                  aria-label="Historial de prompts"
                  aria-haspopup="dialog"
                  aria-expanded={historialAbierto}
                  title="Prompts que enviaste en este chat"
                  onClick={() => setHistorialAbierto((o) => !o)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
                  </svg>
                  <span className="tl-boton-texto">Historial</span>
                </button>
                {historialAbierto && (
                  <HistorialPrompts prompts={prompts} onElegir={irAPrompt} onCerrar={() => setHistorialAbierto(false)} />
                )}
              </div>
            </div>
          </header>

          <div className="tl-hilo">
            <div className="tl-hilo-columna">
              {messages.isPending && <p className="tl-nota">Cargando mensajes…</p>}
              {messages.isError && (
                <div className="tl-estado-linea">
                  <p className="tl-alerta" role="alert">
                    No se pudieron cargar los mensajes.
                  </p>
                  <button type="button" className="tl-boton" onClick={() => void messages.refetch()}>
                    Reintentar
                  </button>
                </div>
              )}
              {messages.data?.length === 0 && !send.isPending && (
                <p className="tl-nota">Aún no hay mensajes. Escribe una instrucción para el agente o pulsa Ctrl+K para comandos.</p>
              )}
              {lista.map((m, i) =>
                m.role === "system" ? (
                  <p key={m.id} className="tl-alerta" role="status">
                    {m.content}
                  </p>
                ) : m.role === "user" ? (
                  <MensajeUsuario
                    key={m.id}
                    id={`mensaje-${m.id}`}
                    texto={m.content}
                    cuando={m.created_at}
                    resaltado={resaltadoId === m.id}
                  />
                ) : (
                  <MensajeAgente
                    key={m.id}
                    texto={m.content}
                    cuando={m.created_at}
                    modelo={nombreAgente}
                    proceso={
                      selectedId && turnoDeRespuesta(i)
                        ? { conversacionId: selectedId, turnoId: turnoDeRespuesta(i)! }
                        : undefined
                    }
                    onReintentar={
                      lista.slice(0, i).some((p) => p.role === "user") && !send.isPending
                        ? () => reintentar(m.id)
                        : undefined
                    }
                    onGuardar={(formato) => crearDoc.mutate({ mensajeId: m.id, formato })}
                    guardando={crearDoc.isPending && crearDoc.variables?.mensajeId === m.id}
                  />
                ),
              )}
              {send.isPending && !yaGuardado && (
                <MensajeUsuario texto={send.variables?.content ?? ""} cuando={null} />
              )}
              {pensando && (
                <IndicadorPensando modelo={nombreAgente} vivo={(selectedId && vivos[selectedId]?.pasos) || []} />
              )}
              {tareaChat && <PlanRevision key={`${tareaChat.id}:${tareaChat.plan_hash}`} tarea={tareaChat} />}
              {selectedId && current?.project_id && (
                <AccionesRepositorioChat
                  key={selectedId}
                  conversationId={selectedId}
                  projectId={current.project_id}
                  taskId={tareaChat?.id}
                  terminada={!!tareaChat && ["done", "failed", "cancelled", "interrupted"].includes(tareaChat.status)}
                />
              )}
              {tareasChat.isError && current?.project_id && <p className="tl-alerta" role="alert">{errorText(tareasChat.error)}</p>}
              {current?.cuota_modelo && !pensando && (
                <AvisoCuota
                  modeloAgotado={modelList.find((m) => m.id === current.cuota_modelo)?.name ?? current.cuota_modelo}
                  puedeSeguir={!!current.model && current.model !== current.cuota_modelo}
                  seguirPendiente={seguirChat.isPending}
                  onCambiarModelo={() => setPickerOpen(true)}
                  onSeguir={() => seguirChat.mutate()}
                  error={seguirChat.isError ? errorText(seguirChat.error) : null}
                />
              )}
              <div ref={endRef} />
            </div>
          </div>

          <form
            className="tl-composer"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              submit();
            }}
          >
            {error && (
              <p className="tl-alerta" role="alert">
                {error}
              </p>
            )}
            {aviso && (
              <p className="tl-aviso" role="status">
                {aviso}
              </p>
            )}
            {modelInfo?.costWarning && <p className="tl-aviso">{modelInfo.costWarning}</p>}

            <div
              className={`tl-composer-caja${arrastrando ? " is-arrastrando" : ""}`}
              onDragOver={alArrastrar}
              onDragLeave={() => setArrastrando(false)}
              onDrop={alSoltar}
            >
              {arrastrando && (
                <div className="tl-soltar" aria-hidden="true">
                  <span className="tl-soltar-texto">Suelta los archivos aquí para adjuntarlos al chat</span>
                </div>
              )}

              {pickerOpen && (
                <ModelPicker
                  models={modelList}
                  currentId={current?.model ?? null}
                  conEsfuerzo
                  currentEffort={efectoActual}
                  onSelect={elegirModelo}
                  onClose={() => setPickerOpen(false)}
                  disparador={chipRef}
                  cargando={models.isPending}
                  error={models.isError ? errorText(models.error) : null}
                  onReintentar={() => void models.refetch()}
                />
              )}

              {usoAbierto && (
                <UsoPanel
                  modelo={current?.model ?? null}
                  onCerrar={() => setUsoAbierto(false)}
                  disparador={usoRef}
                />
              )}

              {pendientes.length > 0 && (
                <ul className="tl-adjuntos-pendientes" aria-label="Archivos del mensaje">
                  {pendientes.map((p) => {
                    const { lectura } = p;
                    const nombre = lectura.tipo === "texto" ? lectura.adjunto.nombre : lectura.nombre;
                    const motivo = lectura.tipo === "texto" ? "Se envía con el mensaje" : lectura.motivo;
                    const estado =
                      lectura.tipo === "texto"
                        ? `${etiquetaBytes(lectura.tamano)}${lectura.recortado ? " · recortado" : ""}`
                        : lectura.tipo === "solo_vista"
                          ? `${etiquetaBytes(lectura.tamano)} · no se envía · solo texto`
                          : "No se añadió";
                    const imagen = lectura.tipo === "solo_vista" && lectura.imagen;
                    return (
                      <li key={p.key} className={`tl-adjunto-chip is-${lectura.tipo}`} title={motivo}>
                        <span className="tl-adjunto-icono" aria-hidden="true">
                          {imagen ? ICONO_IMAGEN : ICONO_ARCHIVO}
                        </span>
                        <span className="tl-adjunto-chip-nombre">{nombre}</span>
                        <span className="tl-adjunto-chip-estado">{estado}</span>
                        <button
                          type="button"
                          className="tl-accion-icono"
                          aria-label={`Quitar ${nombre}`}
                          onClick={() => setPendientes((prev) => prev.filter((x) => x.key !== p.key))}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {dictando && (
                <p className="tl-dictado-estado" role="status">
                  <span className="tl-dictado-punto" aria-hidden="true" />
                  <span>Escuchando…</span>
                  <span className="tl-dictado-ayuda">Pulsa de nuevo para detener</span>
                </p>
              )}

              {menuAbierto && (
                <MenuComandosChat comandos={comandosFiltrados} activo={indiceSlash} onElegir={elegirComando} />
              )}

              <textarea
                ref={inputRef}
                className="tl-composer-input"
                rows={2}
                value={draft}
                placeholder="Escribe un mensaje, pega o arrastra archivos, o usa / para comandos"
                aria-label="Mensaje"
                aria-autocomplete={menuAbierto ? "list" : sugerencia ? "inline" : undefined}
                aria-activedescendant={menuAbierto ? `comando-chat-${comandosFiltrados[indiceSlash]?.id}` : undefined}
                onChange={(e) => cambiarBorrador(e.target.value)}
                onPaste={alPegar}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.nativeEvent.isComposing) return;
                  if (menuAbierto) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const paso = e.key === "ArrowDown" ? 1 : -1;
                      setSlashActivo((indiceSlash + paso + comandosFiltrados.length) % comandosFiltrados.length);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSlashOculto(true);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      elegirComando(comandosFiltrados[indiceSlash]);
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    setSugerenciaOculta(true);
                    return;
                  }
                  if (e.key === "Tab" && !e.shiftKey && !menuAbierto && sugerencia) {
                    e.preventDefault();
                    cambiarBorrador(sugerencia);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {sugerencia && (
                <button type="button" className="composer-suggestion" onClick={() => { cambiarBorrador(sugerencia); inputRef.current?.focus(); }} aria-label={`Completar sugerencia: ${sugerencia}`}>
                  <span>{sugerencia}</span><kbd>Tab</kbd>
                </button>
              )}

              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void agregarArchivos(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />

              {/* Herramientas, selector conjunto de modelo y esfuerzo, y envío. */}
              <div className="tl-composer-barra">
                <div className="tl-composer-izq">
                  <button
                    type="button"
                    className="tl-accion-icono"
                    aria-label="Adjuntar archivo"
                    title="Adjuntar archivos de texto"
                    onClick={() => fileRef.current?.click()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="tl-accion-icono"
                    aria-label="Herramientas y comandos"
                    title="Herramientas y comandos (Ctrl+K)"
                    onClick={triggerPalette}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                  </button>
                  {dictadoDisponible && (
                    <button
                      type="button"
                      className={`tl-accion-icono${dictando ? " is-activo" : ""}`}
                      aria-label={dictando ? "Terminar dictado" : "Dictar mensaje"}
                      aria-pressed={dictando}
                      title={dictando ? "Terminar dictado" : "Dictar: la voz se convierte en texto"}
                      onClick={dictar}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M19 10a7 7 0 0 1-14 0" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    </button>
                  )}

                  <button
                    ref={chipRef}
                    type="button"
                    className="tl-modelo-boton"
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    onClick={() => {
                      setUsoAbierto(false);
                      setPickerOpen((o) => !o);
                    }}
                  >
                    <span className="tl-modelo-nombre">{etiquetaChip}</span>
                    <span className="cost-meter" title={`Costo: ${nivelCosto} de 5`} aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className={`cost-bar${i < nivelCosto ? " filled" : ""}`} />
                      ))}
                    </span>
                  </button>
                </div>

                <div className="tl-composer-der">
                  <button
                    type="submit"
                    className="tl-enviar"
                    aria-label="Enviar"
                    disabled={!puedeEnviar}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="tl-composer-pie">
                <button
                  ref={usoRef}
                  type="button"
                  className="tl-boton tl-boton-compacto tl-uso"
                  aria-haspopup="dialog"
                  aria-expanded={usoAbierto}
                  onClick={() => {
                    setPickerOpen(false);
                    setUsoAbierto((o) => !o);
                  }}
                >
                  Uso
                </button>
              </div>
            </div>
            <p className="tl-composer-nota">
              Los agentes trabajan en el servidor de forma persistente. Revisa sus cambios antes de aplicarlos.
            </p>
          </form>

          {configAbierta && current && (
            <ChatConfiguracion
              conversacion={current}
              modelo={modelInfo}
              onCerrar={() => setConfigAbierta(false)}
              onCambiar={(patch) => configure.mutate(patch)}
              onVerDocumento={(doc) => {
                setConfigAbierta(false);
                setVistaDoc(doc);
              }}
              error={settingsError}
            />
          )}

          {vistaDoc && <VistaDocumento documento={vistaDoc} onCerrar={() => setVistaDoc(null)} />}
        </>
      )}
    </section>
  );
}
