import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Conversation, type Documento, type FormatoDocumento, type Message, type ModelInfo, type PasoActividad } from "../api";
import { useEventosVivos } from "../lib/eventos-vivos";
import { ModelPicker } from "../components/model-picker";
import { UsoPanel } from "../components/uso-panel";
import { ChatContexto } from "../components/chat-contexto";
import { CapacidadesMedios } from "../components/capacidades-medios";
import { IndicadorPensando, MensajeAgente, MensajeUsuario } from "../components/chat-mensajes";
import { ProcesoAgente } from "../components/chat-proceso";
import { copiarTexto, type ReferenciaArchivo } from "../components/chat-contenido";
import { ChatArchivoPreview } from "../components/chat-archivo-preview";
import { LoadingSkeleton } from "../components/loading-skeleton";
import { ChatConfiguracion } from "../components/chat-configuracion";
import { AvisoCuota } from "../components/cuota-aviso";
import { VistaDocumento } from "../components/documentos";
import { HistorialPrompts, type PromptEnviado } from "../components/chat-historial";
import { MenuComandosChat, type ComandoChat } from "../components/chat-comandos";
import { MenuSkillsChat, type SkillOpcion } from "../components/chat-skills-picker";
import { PlanRevision } from "../components/plan-revision";
import { AccionesRepositorioChat } from "../components/repository-approval";
import { sugerenciasChat } from "../lib/sugerencias";
import { duracionEntre } from "../lib/tiempo";
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
import {
  type MensajeEnCola,
  leerColas,
  guardarCola,
  colaActivaPara,
  claveColaActiva,
} from "../lib/chat-cola";
import { leerHitos, guardarHitos } from "../lib/chat-hitos";
import { leerBorrador, guardarBorrador } from "../lib/chat-borrador";
import { type ReconocimientoVoz, ctorVoz, mensajeVoz } from "../lib/chat-dictado";
import { PLANTILLAS_GAUNTLET } from "../lib/plantillas-gauntlet";
import "../styles-chat.css";
import "../styles-flujo.css";

type Patch = { model?: string | null; effort?: string | null; title?: string; pinned?: boolean };

// Un archivo adjunto en el compositor, antes de enviar el mensaje.
type Pendiente = { key: string; lectura: ArchivoLeido };

// Lo que había en el compositor al enviar: vuelve si el envío no se guarda en el servidor.
type Restaurar = { texto: string; pendientes: Pendiente[] };

// Quita tildes y pasa a minúsculas para buscar comandos: "analiticas" encuentra "Analíticas".
const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function etiquetaPrompt(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim() || "Mensaje con adjuntos";
  return limpio.length > 120 ? `${limpio.slice(0, 120)}…` : limpio;
}

// Ventana de contexto en tokens, abreviada: 128000 es "128k".
function etiquetaContexto(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}k`;
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
  const {
    selectedConversationId,
    setSelectedConversationId,
    triggerPalette,
    configAbierta,
    setConfigAbierta,
    setActiveProjectId,
    setActiveProjectName,
  } = useShell();
  const selectedId = selectedConversationId;
  const setSelectedId = setSelectedConversationId;

  const [draft, setDraft] = useState("");
  const [creandoChat, setCreandoChat] = useState(false);
  const colasIniciales = useRef<Record<string, MensajeEnCola[]> | null>(null);
  if (colasIniciales.current === null) colasIniciales.current = leerColas();
  const [colasPorChat, setColasPorChat] = useState<Record<string, MensajeEnCola[]>>(colasIniciales.current);
  const colasPorChatRef = useRef(colasPorChat);
  const [colaRevision, setColaRevision] = useState(0);
  const [falloCola, setFalloCola] = useState<{ conversacionId: string; mensajeId: string } | null>(null);
  const enviosPorChatRef = useRef<Record<string, { content: string; colaId?: string; retryOf?: string }>>({});
  const [enviosPorChat, setEnviosPorChat] = useState(enviosPorChatRef.current);
  const [erroresEnvio, setErroresEnvio] = useState<Record<string, string>>({});
  const [menuColaAbierto, setMenuColaAbierto] = useState<string | null>(null);
  const colaRef = useRef<HTMLElement>(null);
  const [editandoColaId, setEditandoColaId] = useState<string | null>(null);
  const [textoEditadoCola, setTextoEditadoCola] = useState("");
  const [mensajeArrastradoColaId, setMensajeArrastradoColaId] = useState<string | null>(null);
  const [destinoArrastreColaId, setDestinoArrastreColaId] = useState<string | null>(null);
  const [hitosPorChat, setHitosPorChat] = useState<Record<string, string[]>>(leerHitos);
  const [promptActivoId, setPromptActivoId] = useState<string | null>(null);
  const colaEsperandoTurnoRef = useRef<Record<string, { vioAgenteOcupado: boolean; texto: string }>>({});
  const cambiarCola = (id: string, transformar: (mensajes: MensajeEnCola[]) => MensajeEnCola[]) => {
    const mensajes = transformar(colasPorChatRef.current[id] ?? []);
    const siguiente = { ...colasPorChatRef.current };
    if (mensajes.length) siguiente[id] = mensajes;
    else delete siguiente[id];
    colasPorChatRef.current = siguiente;
    setColasPorChat(siguiente);
    guardarCola(id, mensajes);
  };
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
  const [contextoAbierto, setContextoAbierto] = useState(false);
  const [mediosAbierto, setMediosAbierto] = useState(false);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [subiendoAdjuntos, setSubiendoAdjuntos] = useState(false);
  const subiendoAdjuntosRef = useRef(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [dictando, setDictando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vistaDoc, setVistaDoc] = useState<Documento | null>(null);
  const [archivoAbierto, setArchivoAbierto] = useState<ReferenciaArchivo | null>(null);
  const [anchoArchivo, setAnchoArchivo] = useState<number | null>(null);
  const [altoArchivo, setAltoArchivo] = useState<number | null>(null);
  const [vistaMovil, setVistaMovil] = useState(false);
  const chatLayoutRef = useRef<HTMLElement>(null);
  const archivoDisparadorRef = useRef<string | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [resaltadoId, setResaltadoId] = useState<string | null>(null);
  // Menú de "/": activo es la fila marcada; oculto lo cierra con Escape hasta que el texto cambie.
  const [slashActivo, setSlashActivo] = useState(0);
  const [slashOculto, setSlashOculto] = useState(false);
  const [sugerenciaOculta, setSugerenciaOculta] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hiloRef = useRef<HTMLDivElement>(null);
  const chatHiloIdRef = useRef<string | null>(null);
  const seguirHiloAlFinalRef = useRef(true);
  const pausarSeguimientoManualRef = useRef(false);
  const hiloToqueYRef = useRef<number | null>(null);
  const [mostrarIrAlInicio, setMostrarIrAlInicio] = useState(false);
  const [mostrarIrAlFinal, setMostrarIrAlFinal] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const actualizar = () => setVistaMovil(media.matches);
    actualizar();
    media.addEventListener("change", actualizar);
    return () => media.removeEventListener("change", actualizar);
  }, []);
  const irAlInicio = useCallback(() => {
    const hilo = hiloRef.current;
    if (!hilo) return;
    seguirHiloAlFinalRef.current = false;
    pausarSeguimientoManualRef.current = true;
    hilo.scrollTo({ top: 0, left: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);
  const irAlFinal = useCallback(() => {
    const hilo = hiloRef.current;
    if (!hilo) return;
    pausarSeguimientoManualRef.current = false;
    seguirHiloAlFinalRef.current = true;
    setMostrarIrAlFinal(false);
    hilo.scrollTo({
      top: hilo.scrollHeight,
      left: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, []);
  const actualizarSeguimientoHilo = useCallback(() => {
    const hilo = hiloRef.current;
    if (!hilo) return;
    const distanciaAlFinal = hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight;
    const cercaDelFinal = distanciaAlFinal <= 48;
    if (!cercaDelFinal) pausarSeguimientoManualRef.current = false;
    if (!pausarSeguimientoManualRef.current) seguirHiloAlFinalRef.current = cercaDelFinal;
    setMostrarIrAlInicio(hilo.scrollTop > 48);
    setMostrarIrAlFinal(!cercaDelFinal);
  }, []);
  const detenerScrollAutomatico = useCallback(() => {
    const hilo = hiloRef.current;
    if (hilo) hilo.scrollTo({ top: hilo.scrollTop, left: 0, behavior: "auto" });
  }, []);
  const alUsarRuedaEnHilo = useCallback((deltaY: number) => {
    if (deltaY < 0) {
      seguirHiloAlFinalRef.current = false;
      pausarSeguimientoManualRef.current = true;
      detenerScrollAutomatico();
    } else if (deltaY > 0) {
      pausarSeguimientoManualRef.current = false;
    }
  }, [detenerScrollAutomatico]);
  const alIniciarToqueEnHilo = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    hiloToqueYRef.current = event.touches[0]?.clientY ?? null;
  }, []);
  const alMoverToqueEnHilo = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const y = event.touches[0]?.clientY;
    const anterior = hiloToqueYRef.current;
    if (y === undefined) return;
    if (anterior !== null && y > anterior) {
      seguirHiloAlFinalRef.current = false;
      pausarSeguimientoManualRef.current = true;
      detenerScrollAutomatico();
    } else if (anterior !== null && y < anterior) {
      pausarSeguimientoManualRef.current = false;
    }
    hiloToqueYRef.current = y;
  }, [detenerScrollAutomatico]);
  const alTerminarToqueEnHilo = useCallback(() => {
    hiloToqueYRef.current = null;
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<ReconocimientoVoz | null>(null);
  // Botones que abren el selector y el panel de uso: reciben el foco al cerrar.
  const chipRef = useRef<HTMLButtonElement>(null);
  const usoRef = useRef<HTMLButtonElement>(null);
  const contextoRef = useRef<HTMLButtonElement>(null);
  const mediosRef = useRef<HTMLButtonElement>(null);
  const abrirArchivo = useCallback((referencia: ReferenciaArchivo, triggerId: string) => {
    archivoDisparadorRef.current = triggerId;
    setArchivoAbierto(referencia);
  }, []);
  const cerrarArchivo = () => setArchivoAbierto(null);
  const limitesSeparadorArchivo = () => {
    const caja = chatLayoutRef.current?.getBoundingClientRect();
    if (vistaMovil) {
      return {
        minimo: 180,
        maximo: Math.max(180, Math.min(700, caja ? caja.height - 200 : 700)),
      };
    }
    return {
      minimo: 260,
      maximo: Math.max(260, Math.min(900, caja ? caja.width - 320 : 900)),
    };
  };
  const moverSeparadorArchivo = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const caja = chatLayoutRef.current?.getBoundingClientRect();
    if (!caja) return;
    const { minimo, maximo } = limitesSeparadorArchivo();
    if (vistaMovil) {
      setAltoArchivo(Math.round(Math.min(maximo, Math.max(minimo, caja.bottom - event.clientY))));
    } else {
      setAnchoArchivo(Math.round(Math.min(maximo, Math.max(minimo, caja.right - event.clientX - 6))));
    }
  };
  const tecladoSeparadorArchivo = (event: KeyboardEvent<HTMLDivElement>) => {
    const { minimo, maximo } = limitesSeparadorArchivo();
    const tecla = vistaMovil ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (tecla.includes(event.key)) {
      event.preventDefault();
      if (vistaMovil) {
        const actual = altoArchivo ?? Math.max(minimo, Math.min(320, window.innerHeight * 0.34));
        setAltoArchivo(Math.max(minimo, Math.min(maximo, actual + (event.key === "ArrowUp" ? 24 : -24))));
      } else {
        const actual = anchoArchivo ?? Math.max(minimo, Math.min(560, window.innerWidth * 0.42));
        setAnchoArchivo(Math.max(minimo, Math.min(maximo, actual + (event.key === "ArrowLeft" ? 24 : -24))));
      }
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (vistaMovil) setAltoArchivo(event.key === "Home" ? minimo : maximo);
      else setAnchoArchivo(event.key === "Home" ? minimo : maximo);
    }
  };

  useEffect(() => {
    if (archivoAbierto || !archivoDisparadorRef.current) return;
    const triggerId = archivoDisparadorRef.current;
    const frame = requestAnimationFrame(() => {
      const disparador = [...document.querySelectorAll<HTMLElement>("[data-archivo-trigger-key]")]
        .find((elemento) => elemento.dataset.archivoTriggerKey === triggerId);
      disparador?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [archivoAbierto]);

  // Los adjuntos son del chat en el que se escribieron.
  useEffect(() => {
    setPendientes([]);
    setArchivoAbierto(null);
    setContextoAbierto(false);
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
  const permitirAbrirArchivoEnChat = useCallback(() => Boolean(current?.id), [current?.id]);

  useEffect(() => {
    setActiveProjectId(current?.project_id ?? null);
    setActiveProjectName(current?.project_name ?? null);
    return () => {
      setActiveProjectId(null);
      setActiveProjectName(null);
    };
  }, [current?.project_id, current?.project_name, setActiveProjectId, setActiveProjectName]);

  const tareasChat = useQuery({
    queryKey: ["conversation-tasks", selectedId],
    queryFn: () => api.conversationTasks(selectedId!),
    enabled: !!selectedId && !!current?.project_id,
    refetchInterval: 3_000,
  });
  const tareaChat = current?.project_id ? tareasChat.data?.at(-1) : undefined;
  const modeloAgotadoChat = current?.cuota_modelo ?? (tareaChat?.status === "sin_cuota"
    ? tareaChat.modelo_agotado ?? tareaChat.model
    : null);
  const esperandoPlan = tareaChat?.status === "waiting_approval";
  const planPendiente = esperandoPlan && Boolean(tareaChat?.plan && tareaChat?.plan_hash);
  const agenteOcupado =
    !!current?.ocupada || ["queued", "analyzing", "running", "waiting_approval"].includes(tareaChat?.status ?? "");
  const cola = selectedId ? colasPorChat[selectedId] ?? [] : [];
  const colaActiva = useMemo(() => colaActivaPara(selectedId), [selectedId, colaRevision]);
  const menuColaItem = cola.find((item) => item.id === menuColaAbierto) ?? null;
  const indiceMenuCola = menuColaItem ? cola.findIndex((item) => item.id === menuColaItem.id) : -1;
  useEffect(() => {
    if (!menuColaAbierto) return;
    const cerrarAlTocarFuera = (event: PointerEvent) => {
      if (!colaRef.current?.contains(event.target as Node)) setMenuColaAbierto(null);
    };
    document.addEventListener("pointerdown", cerrarAlTocarFuera);
    return () => document.removeEventListener("pointerdown", cerrarAlTocarFuera);
  }, [menuColaAbierto]);
  const errorCola = falloCola?.conversacionId === selectedId && cola.some((item) => item.id === falloCola.mensajeId);
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
  const { conectado: canalVivoConectado } = useEventosVivos({}, (evento) => {
    if (evento.tipo === "tarea" || evento.tipo === "evento") {
      const taskId = evento.tipo === "tarea" ? evento.id : evento.task_id;
      if (taskId !== tareaChat?.id) return;
      void qc.invalidateQueries({ queryKey: ["conversation-tasks", selectedId] });
      void qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      if (evento.tipo === "tarea" && !["queued", "analyzing", "waiting_approval", "running"].includes(evento.status)) {
        void qc.invalidateQueries({ queryKey: ["uso"] });
      }
      return;
    }
    // Un turno empezó o terminó, aquí o en otro dispositivo: la lista y los mensajes se piden de nuevo.
    if (evento.tipo === "chat") {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["messages", evento.conversacion_id] });
      void qc.invalidateQueries({ queryKey: ["conversation-tasks", evento.conversacion_id] });
      void qc.invalidateQueries({ queryKey: ["repository-actions", evento.conversacion_id] });
      if (evento.estado === "terminado") void qc.invalidateQueries({ queryKey: ["uso"] });
      return;
    }
    if (evento.tipo !== "actividad") return;
    setVivos((prev) => {
      const previo = prev[evento.conversacion_id];
      const pasos = previo && previo.turnoId === evento.turno_id ? previo.pasos : [];
      // Las transiciones de una herramienta conservan seq; los eventos repetidos sustituyen su estado.
      const indice = pasos.findIndex((p) => p.seq === evento.paso.seq);
      const siguientes = indice < 0
        ? [...pasos, evento.paso]
        : pasos.map((paso, i) => i === indice ? evento.paso : paso);
      return { ...prev, [evento.conversacion_id]: { turnoId: evento.turno_id, pasos: siguientes } };
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
    mutationFn: async ({ id, content, retryOf }: { id: string; content: string; restaurar?: Restaurar; colaId?: string; retryOf?: string }) => {
      const previos = contarEnvios(qc.getQueryData<Message[]>(["messages", id]), content);
      try {
        return await api.sendMessage(id, content, retryOf);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const ahora = await api.listMessages(id).catch(() => null);
        if (retryOf && ahora) {
          const original = ahora.find((mensaje) => mensaje.id === retryOf);
          const avisoPendiente = original && ahora
            .slice(ahora.indexOf(original) + 1)
            .some((mensaje) => mensaje.role === "system");
          if (original && !avisoPendiente) return { messages: [] };
        }
        if (ahora && contarEnvios(ahora, content) > previos) return { messages: [] };
        throw err;
      }
    },
    onSuccess: (_data, { id, content, colaId }) => {
      setErroresEnvio((prev) => {
        const siguiente = { ...prev };
        delete siguiente[id];
        return siguiente;
      });
      if (colaId) {
        cambiarCola(id, (mensajes) => mensajes.filter((item) => item.id !== colaId));
        const ocupada = qc.getQueryData<Conversation[]>(["conversations"])?.find((chat) => chat.id === id)?.ocupada ?? false;
        colaEsperandoTurnoRef.current[id] = { vioAgenteOcupado: ocupada, texto: content };
        setFalloCola((prev) => (prev?.mensajeId === colaId ? null : prev));
      }
    },
    onError: (err, { id, restaurar, colaId }) => {
      if (colaId) setFalloCola({ conversacionId: id, mensajeId: colaId });
      else setErroresEnvio((prev) => ({ ...prev, [id]: errorText(err) }));
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
    onSettled: (_data, _error, { id }) => {
      const siguientes = { ...enviosPorChatRef.current };
      delete siguientes[id];
      enviosPorChatRef.current = siguientes;
      setEnviosPorChat(siguientes);
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-tasks", id] });
      qc.invalidateQueries({ queryKey: ["repository-actions", id] });
    },
  });

  const iniciarEnvio = (variables: { id: string; content: string; restaurar?: Restaurar; colaId?: string; retryOf?: string }) => {
    if (enviosPorChatRef.current[variables.id]) return false;
    if (variables.id === selectedId) {
      seguirHiloAlFinalRef.current = true;
      setMostrarIrAlFinal(false);
    }
    setErroresEnvio((prev) => {
      const siguiente = { ...prev };
      delete siguiente[variables.id];
      return siguiente;
    });
    const siguientes = { ...enviosPorChatRef.current, [variables.id]: { content: variables.content, colaId: variables.colaId, retryOf: variables.retryOf } };
    enviosPorChatRef.current = siguientes;
    setEnviosPorChat(siguientes);
    send.mutate(variables);
    return true;
  };

  // Tras una cuota agotada: el chat retoma su sesión con el modelo elegido (ver /seguir en el servidor).
  const seguirChat = useMutation({
    mutationFn: (id: string) => api.continueChat(id),
    onSettled: (_data, _error, id) => {
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-tasks", id] });
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

  const decidirPlanMutation = useMutation({
    mutationFn: ({ decision, feedback }: { decision: "approve" | "revise"; feedback?: string }) => {
      if (!tareaChat?.id || !tareaChat?.plan_hash) throw new Error("No hay plan pendiente de aprobación");
      return api.decidePlan(tareaChat.id, {
        decision,
        plan_hash: tareaChat.plan_hash,
        feedback: feedback?.trim() || undefined,
      });
    },
    onSuccess: () => {
      cambiarBorrador("");
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["conversation-tasks"] });
      if (tareaChat?.id) void qc.invalidateQueries({ queryKey: ["task", tareaChat.id] });
    },
  });

  const cancelarPlanMutation = useMutation({
    mutationFn: (taskId: string) => api.cancelTask(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["conversation-tasks"] });
      if (tareaChat?.id) void qc.invalidateQueries({ queryKey: ["task", tareaChat.id] });
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

  // Los textos viajan en el mensaje; las imágenes se suben antes para que ambos runners las reciban como entrada visual.
  const adjuntosListos = pendientes.flatMap((p) => (p.lectura.tipo === "texto" ? [p.lectura.adjunto] : []));
  const imagenesPendientes = pendientes.flatMap((p) => (p.lectura.tipo === "imagen" ? [p.lectura] : []));
  const envioActual = selectedId ? enviosPorChat[selectedId] : undefined;
  const enviandoActual = !!envioActual;
  const bloqueoEnvioCola = !!modeloAgotadoChat || (!colaActiva && (agenteOcupado || cola.length > 0));
  const puedeEnviar =
    !!selectedId && !enviandoActual && !subiendoAdjuntos && !bloqueoEnvioCola && (draft.trim() !== "" || adjuntosListos.length > 0 || imagenesPendientes.length > 0);

  const submit = async () => {
    if (planPendiente) {
      const feedback = draft.trim();
      if (feedback) {
        decidirPlanMutation.mutate({ decision: "revise", feedback });
        cambiarBorrador("");
      }
      return;
    }
    if (!puedeEnviar || !selectedId || subiendoAdjuntosRef.current) return;
    if (imagenesPendientes.length > 4) {
      setErroresEnvio((prev) => ({ ...prev, [selectedId]: "Adjunta hasta 4 imágenes por mensaje." }));
      return;
    }
    let imagenesSubidas: { id: string; nombre: string }[] = [];
    if (imagenesPendientes.length > 0) {
      subiendoAdjuntosRef.current = true;
      setSubiendoAdjuntos(true);
      try {
        imagenesSubidas = await Promise.all(imagenesPendientes.map(async (imagen) => {
          const subida = await api.uploadChatImage(selectedId, imagen.archivo);
          return { id: subida.id, nombre: subida.nombre };
        }));
      } catch (err) {
        setErroresEnvio((prev) => ({ ...prev, [selectedId]: errorText(err) }));
        return;
      } finally {
        subiendoAdjuntosRef.current = false;
        setSubiendoAdjuntos(false);
      }
    }
    const content = componerMensaje(draft, adjuntosListos, imagenesSubidas);
    if (!content) return;
    if (agenteOcupado || cola.length > 0) {
      if (!colaActiva) return;
      cambiarCola(selectedId, (mensajes) => [
        ...mensajes,
        {
          id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          texto: content,
          creado: Date.now(),
        },
      ]);
      cambiarBorrador("");
      setPendientes([]);
      seguirHiloAlFinalRef.current = true;
      requestAnimationFrame(irAlFinal);
      return;
    }
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
    seguirHiloAlFinalRef.current = true;
    iniciarEnvio({ id: selectedId, content, restaurar });
  };

  const redirigirMensajeCola = (item: MensajeEnCola) => {
    if (!selectedId) return;
    const borrador = draft.trim() ? `${draft}\n${item.texto}` : item.texto;
    cambiarBorrador(borrador);
    cambiarCola(selectedId, (mensajes) => mensajes.filter((mensaje) => mensaje.id !== item.id));
    setMenuColaAbierto(null);
    setEditandoColaId(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const reordenarCola = (origenId: string, destinoId: string) => {
    if (!selectedId || origenId === destinoId || envioActual?.colaId === origenId || envioActual?.colaId === destinoId) return;
    cambiarCola(selectedId, (mensajes) => {
      const origen = mensajes.findIndex((mensaje) => mensaje.id === origenId);
      const destino = mensajes.findIndex((mensaje) => mensaje.id === destinoId);
      if (origen < 0 || destino < 0) return mensajes;
      const siguientes = [...mensajes];
      const [movido] = siguientes.splice(origen, 1);
      siguientes.splice(destino, 0, movido!);
      return siguientes;
    });
    setMenuColaAbierto(null);
  };

  const moverCola = (mensajeId: string, paso: -1 | 1) => {
    const indice = cola.findIndex((mensaje) => mensaje.id === mensajeId);
    const destino = cola[indice + paso];
    if (destino) reordenarCola(mensajeId, destino.id);
  };

  const iniciarArrastreCola = (event: DragEvent<HTMLButtonElement>, mensajeId: string) => {
    if (envioActual?.colaId === mensajeId) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", mensajeId);
    setMensajeArrastradoColaId(mensajeId);
  };

  const soltarSobreCola = (event: DragEvent<HTMLDivElement>, destinoId: string) => {
    event.preventDefault();
    const origenId = event.dataTransfer.getData("text/plain") || mensajeArrastradoColaId;
    if (origenId) reordenarCola(origenId, destinoId);
    setMensajeArrastradoColaId(null);
    setDestinoArrastreColaId(null);
  };

  const marcarPrompt = (mensajeId: string) => {
    if (!selectedId) return;
    const actuales = hitosPorChat[selectedId] ?? [];
    const siguientes = actuales.includes(mensajeId)
      ? actuales.filter((id) => id !== mensajeId)
      : [...actuales, mensajeId];
    guardarHitos(selectedId, siguientes);
    setHitosPorChat((prev) => ({ ...prev, [selectedId]: siguientes }));
  };

  const cambiarColaActiva = () => {
    if (!selectedId) return;
    try {
      localStorage.setItem(claveColaActiva(selectedId), colaActiva ? "false" : "true");
    } catch {
      // El cambio sigue vigente en esta pantalla.
    }
    setColaRevision((revision) => revision + 1);
    setMenuColaAbierto(null);
  };

  // Envía una sola entrada a la vez. La siguiente espera a que el agente haya ocupado
  // y liberado el chat, aunque la respuesta HTTP se complete antes de actualizar la vista.
  useEffect(() => {
    if (!selectedId) return;
    const esperando = colaEsperandoTurnoRef.current[selectedId];
    if (esperando) {
      if (agenteOcupado) esperando.vioAgenteOcupado = true;
      const ultimoUsuario = [...lista].reverse().find((mensaje) => mensaje.role === "user");
      const respuestaRecibida = lista.at(-1)?.role === "assistant" && ultimoUsuario?.content === esperando.texto;
      if (!agenteOcupado && (esperando.vioAgenteOcupado || respuestaRecibida)) {
        delete colaEsperandoTurnoRef.current[selectedId];
      }
      else return;
    }
    if (!colaActiva || agenteOcupado || enviandoActual || errorCola || cola.length === 0) return;
    iniciarEnvio({ id: selectedId, content: cola[0].texto, colaId: cola[0].id });
  }, [selectedId, colaActiva, agenteOcupado, enviandoActual, errorCola, cola, lista]);

  // Vuelve a enviar el mensaje del usuario que precede a una respuesta.
  const reintentar = (mensajeId: string) => {
    const i = lista.findIndex((m) => m.id === mensajeId);
    const previo = lista.slice(0, i).reverse().find((m) => m.role === "user");
    if (previo && selectedId && !enviandoActual && !current?.ocupada) {
      iniciarEnvio({ id: selectedId, content: previo.content });
    }
  };

  const reintentarAviso = (mensajeId: string) => {
    const i = lista.findIndex((m) => m.id === mensajeId);
    const previo = lista.slice(0, i).reverse().find((m) => m.role === "user");
    if (i === lista.length - 1 && previo && selectedId && !enviandoActual && !current?.ocupada) {
      iniciarEnvio({ id: selectedId, content: previo.content, retryOf: previo.id });
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

  const ultimoMensaje = lista.at(-1);
  const ultimoPasoVivo = selectedId ? vivos[selectedId]?.pasos.at(-1) : undefined;

  // Sigue el contenido que crece solo mientras el usuario permanezca al final del hilo.
  useEffect(() => {
    const hilo = hiloRef.current;
    if (chatHiloIdRef.current !== selectedId) {
      chatHiloIdRef.current = selectedId;
      pausarSeguimientoManualRef.current = false;
      seguirHiloAlFinalRef.current = true;
      setMostrarIrAlInicio(false);
      setMostrarIrAlFinal(false);
    }
    if (!hilo || !seguirHiloAlFinalRef.current) return;
    hilo.scrollTo({ top: hilo.scrollHeight, left: 0, behavior: "auto" });
    setMostrarIrAlInicio(hilo.scrollTop > 48);
    setMostrarIrAlFinal(false);
  }, [messages.data?.length, ultimoMensaje?.content, enviandoActual, selectedId, tareaChat?.status, tareaChat?.plan_hash, current?.ocupada, selectedId ? vivos[selectedId]?.pasos.length : 0, ultimoPasoVivo?.titulo, ultimoPasoVivo?.detalle, ultimoPasoVivo?.estado, ultimoPasoVivo?.herramienta]);

  // Solo llega aquí un fallo que no se guardó (409 si el chat ya responde, 4xx o 5xx del servidor).
  const sendError = selectedId ? erroresEnvio[selectedId] ?? null : null;
  const settingsError = configure.isError ? errorText(configure.error) : null;
  const docError = crearDoc.isError ? errorText(crearDoc.error) : null;
  const anclarError = anclar.isError ? errorText(anclar.error) : null;
  const planError = decidirPlanMutation.isError ? errorText(decidirPlanMutation.error) : null;
  const cancelarPlanError = cancelarPlanMutation.isError ? errorText(cancelarPlanMutation.error) : null;
  const error = sendError ?? settingsError ?? docError ?? anclarError ?? planError ?? cancelarPlanError;

  // El mensaje que se envió desde este dispositivo ya puede estar en la lista (el sondeo lo trae antes de terminar).
  const yaGuardado = enviandoActual && (
    (envioActual?.retryOf ? lista.some((mensaje) => mensaje.id === envioActual.retryOf) : false)
    || (ultimoMensaje?.role === "user" && ultimoMensaje.content === envioActual?.content)
  );
  const tareaActiva = !!tareaChat && ["queued", "analyzing", "running"].includes(tareaChat.status);
  const siguiendoActual = seguirChat.isPending && seguirChat.variables === selectedId;
  const pensando = enviandoActual || siguiendoActual || (tareaChat ? tareaActiva : !!current?.ocupada);
  const turnoEnCurso = pensando ? [...lista].reverse().find((mensaje) => mensaje.role === "user")?.id : undefined;
  const actividadGuardada = useQuery({
    queryKey: ["turno-actividad", selectedId, turnoEnCurso],
    queryFn: () => api.listTurnoActividad(selectedId!, turnoEnCurso!),
    enabled: !!selectedId && !!turnoEnCurso && pensando,
    refetchInterval: pensando && !canalVivoConectado ? 3000 : false,
  });
  useEffect(() => {
    if (!selectedId || !turnoEnCurso || !actividadGuardada.data?.length) return;
    setVivos((prev) => {
      if (prev[selectedId]?.turnoId === turnoEnCurso) return prev;
      return { ...prev, [selectedId]: { turnoId: turnoEnCurso, pasos: actividadGuardada.data! } };
    });
  }, [selectedId, turnoEnCurso, actividadGuardada.data]);
  const candidatasSugerencia = useMemo(() => sugerenciasChat(lista), [lista]);
  const sugerenciasOrdenadas = useQuery({
    queryKey: ["jev-recomendaciones", selectedId, lista.at(-1)?.id, candidatasSugerencia],
    queryFn: () => api.rankChatRecommendations(selectedId!, candidatasSugerencia),
    enabled: !!selectedId && !pensando && !esperandoPlan && !draft.startsWith("/") && candidatasSugerencia.length > 0,
    staleTime: 24 * 60 * 60_000,
  });
  const sugerencia = !sugerenciaOculta && !pensando && !draft.startsWith("/")
    ? (sugerenciasOrdenadas.data?.recomendaciones ?? candidatasSugerencia)
        .find((s) => !draft || (s.toLocaleLowerCase().startsWith(draft.toLocaleLowerCase()) && s.length > draft.length))
    : undefined;
  useEffect(() => setSugerenciaOculta(false), [selectedId, lista.length]);

  // Cuando el chat deja de estar ocupado, sus pasos ya están guardados en el servidor: se vacían los en vivo.
  useEffect(() => {
    if (!selectedId || pensando || esperandoPlan) return;
    setVivos((prev) => {
      if (!prev[selectedId]) return prev;
      const { [selectedId]: _terminado, ...resto } = prev;
      return resto;
    });
  }, [pensando, esperandoPlan, selectedId]);

  // Turno de una respuesta: el mensaje del usuario que la precede. Sus pasos se piden al abrir "Ver proceso".
  const turnoDeRespuesta = (indice: number): string | null => {
    for (let j = indice - 1; j >= 0; j--) if (lista[j].role === "user") return lista[j].id;
    return null;
  };
  const duracionDeRespuesta = (indice: number): string | null => {
    for (let j = indice - 1; j >= 0; j--) {
      if (lista[j].role === "user") return duracionEntre(lista[j].created_at, lista[indice].created_at);
    }
    return null;
  };
  const inicioPensando = tareaActiva
    ? tareaChat?.started_at ?? tareaChat?.created_at ?? null
    : [...lista].reverse().find((m) => m.role === "user")?.created_at ?? null;

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
  const promptsEnOrden = useMemo(() => lista.filter((mensaje) => mensaje.role === "user"), [lista]);
  const indicePrompt = useMemo(
    () => new Map(promptsEnOrden.map((mensaje, indice) => [mensaje.id, indice + 1] as const)),
    [promptsEnOrden],
  );
  const hitos = selectedId ? hitosPorChat[selectedId] ?? [] : [];

  useEffect(() => {
    const hilo = hiloRef.current;
    if (!hilo || promptsEnOrden.length === 0) {
      setPromptActivoId(null);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setPromptActivoId(visible.target.id.replace(/^mensaje-/, ""));
    }, { root: hilo, rootMargin: "-10% 0px -65% 0px", threshold: 0 });
    for (const prompt of promptsEnOrden) {
      const elemento = document.getElementById(`mensaje-${prompt.id}`);
      if (elemento) observer.observe(elemento);
    }
    return () => observer.disconnect();
  }, [promptsEnOrden, selectedId]);

  // Salta al mensaje del historial y lo resalta un momento.
  const irAPrompt = (id: string) => {
    setHistorialAbierto(false);
    setResaltadoId(id);
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hilo = hiloRef.current;
    const mensaje = document.getElementById(`mensaje-${id}`);
    if (hilo && mensaje) {
      const cajaHilo = hilo.getBoundingClientRect();
      const cajaMensaje = mensaje.getBoundingClientRect();
      const destino = Math.max(0, hilo.scrollTop + cajaMensaje.top - cajaHilo.top - (hilo.clientHeight - cajaMensaje.height) / 2);
      const cercaDelFinal = hilo.scrollHeight - destino - hilo.clientHeight <= 48;
      pausarSeguimientoManualRef.current = !cercaDelFinal;
      seguirHiloAlFinalRef.current = cercaDelFinal;
      setMostrarIrAlFinal(!cercaDelFinal);
      hilo.scrollTo({ top: destino, left: 0, behavior: suave ? "smooth" : "auto" });
    }
    window.setTimeout(() => setResaltadoId((actual) => (actual === id ? null : actual)), 1800);
  };

  const nuevoChat = () => {
    if (creandoChat) return;
    setCreandoChat(true);
    api.createConversation(null).then(
      (conv) => {
        void qc.invalidateQueries({ queryKey: ["conversations"] });
        setSelectedId(conv.id);
      },
      () => avisar("No se pudo crear el chat"),
    ).finally(() => setCreandoChat(false));
  };

  // Skills disponibles para el chat (del proyecto y globales)
  const skillsProyecto = useQuery({
    queryKey: ["skills", current?.project_id],
    queryFn: () => (current?.project_id ? api.listSkills(current.project_id) : Promise.resolve({ skills: [] })),
    enabled: Boolean(current?.project_id),
  });
  const skillsGlobales = useQuery({
    queryKey: ["skills", "global"],
    queryFn: () => api.listSkills(),
  });

  const skillsDisponibles: SkillOpcion[] = useMemo(() => {
    const mapa = new Map<string, SkillOpcion>();
    for (const s of skillsProyecto.data?.skills ?? []) {
      mapa.set(s.nombre, { nombre: s.nombre, descripcion: s.descripcion, ambito: "proyecto" });
    }
    for (const s of skillsGlobales.data?.skills ?? []) {
      if (!mapa.has(s.nombre)) {
        mapa.set(s.nombre, { nombre: s.nombre, descripcion: s.descripcion, ambito: "global" });
      }
    }
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [skillsProyecto.data, skillsGlobales.data]);

  const [skillIndex, setSkillIndex] = useState(0);
  const [skillPickerOculto, setSkillPickerOculto] = useState(false);

  // Analiza si el cursor o el final del borrador está redactando un token de skill ($, @ o /)
  const tokenSkill = useMemo(() => {
    if (!draft) return null;
    const cursor = inputRef.current ? inputRef.current.selectionStart : draft.length;
    const antesCursor = draft.slice(0, cursor);
    const m = /(?:^|\s)([@$/])([a-zA-Z0-9-]*)$/.exec(antesCursor);
    if (!m) return null;
    const prefijo = m[1] as "$" | "/" | "@";
    const query = m[2]!.toLowerCase();
    const inicio = antesCursor.length - m[0].length + (m[0].startsWith(" ") ? 1 : 0);
    return { prefijo, query, inicio, fin: cursor };
  }, [draft]);

  const skillsFiltradas = useMemo(() => {
    if (!tokenSkill) return [];
    if (tokenSkill.prefijo === "/" && draft.startsWith("/") && !draft.includes(" ")) {
      return [];
    }
    return skillsDisponibles.filter((s) => s.nombre.toLowerCase().includes(tokenSkill.query));
  }, [tokenSkill, skillsDisponibles, draft]);

  const menuSkillsAbierto = Boolean(tokenSkill && skillsFiltradas.length > 0 && !skillPickerOculto);
  const indiceSkillActivo = Math.min(skillIndex, Math.max(skillsFiltradas.length - 1, 0));

  useEffect(() => {
    if (menuSkillsAbierto) {
      document.getElementById(`skill-opcion-${skillsFiltradas[indiceSkillActivo]?.nombre}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [indiceSkillActivo, menuSkillsAbierto, skillsFiltradas]);

  const elegirSkill = (skill: SkillOpcion) => {
    if (!tokenSkill) return;
    const prefijo = tokenSkill.prefijo;
    const reemplazo = `${prefijo}${skill.nombre} `;
    const nuevoBorrador = draft.slice(0, tokenSkill.inicio) + reemplazo + draft.slice(tokenSkill.fin);
    cambiarBorrador(nuevoBorrador);
    setSkillPickerOculto(false);
    window.setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = tokenSkill.inicio + reemplazo.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // Comandos que se ven al escribir "/" en el compositor.
  const anclado = Boolean(current?.pinned_at);
  const comandosChat: ComandoChat[] = [
    {
      id: "gauntlet",
      etiqueta: "/gauntlet",
      descripcion: "Inserta la plantilla Gauntlet (Constructor + Árbitro Adversarial)",
      ejecutar: () => {
        cambiarBorrador(PLANTILLAS_GAUNTLET[0].prompt);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      },
    },
    {
      id: "plan",
      etiqueta: "/plan",
      descripcion: "Genera un plan de acción estructurado paso a paso",
      ejecutar: () => {
        cambiarBorrador("Analiza el estado del proyecto y genera un plan de acción estructurado paso a paso para: ");
        window.setTimeout(() => inputRef.current?.focus(), 0);
      },
    },
    {
      id: "diff",
      etiqueta: "/diff",
      descripcion: "Muestra el diff detallado frente a la rama base",
      ejecutar: () => {
        cambiarBorrador("Revisa y muestra el diff detallado de los cambios realizados en el workspace frente a la rama base.");
        window.setTimeout(() => inputRef.current?.focus(), 0);
      },
    },
    {
      id: "test",
      etiqueta: "/test",
      descripcion: "Ejecuta las pruebas automatizadas del proyecto",
      ejecutar: () => {
        cambiarBorrador("Ejecuta la suite de pruebas del proyecto, reporta los resultados y corrige cualquier fallo detectado.");
        window.setTimeout(() => inputRef.current?.focus(), 0);
      },
    },
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
    ...skillsDisponibles.map((s) => ({
      id: `skill-${s.nombre}`,
      etiqueta: `/${s.nombre}`,
      descripcion: s.descripcion ? `[Skill ${s.ambito}] ${s.descripcion}` : `Skill ${s.ambito} de ${s.nombre}`,
      ejecutar: () => {
        cambiarBorrador(`/${s.nombre} `);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      },
    })),
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
  const mostrarPanelArchivo = Boolean(
    archivoAbierto && current,
  );

  return (
    <section
      ref={chatLayoutRef}
      style={{
        "--tl-chat-archivo-ancho": anchoArchivo ? `${anchoArchivo}px` : undefined,
        "--tl-chat-archivo-alto": altoArchivo ? `${altoArchivo}px` : undefined,
      } as CSSProperties}
      className={`tl-chat${mostrarPanelArchivo ? " tl-chat-con-archivo" : ""}`}
      aria-label="Chat"
    >
      {!selectedId ? (
        <div className="tl-vacio" aria-busy={conversations.isPending}>
          <svg className="tl-vacio-reticula" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M80 120H1120M80 240H1120M80 360H1120M80 480H1120M80 600H1120M200 40V680M400 40V680M600 40V680M800 40V680M1000 40V680" />
              <path d="M160 620L600 180L1040 620M160 100L600 540L1040 100" strokeDasharray="4 10" />
            </g>
          </svg>
          <div className="tl-vacio-caja">
            <div className="tl-vacio-emblema" aria-hidden="true">
              <span className="tl-vacio-pulso" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <circle cx="19" cy="5" r="2" />
                <circle cx="5" cy="5" r="2" />
                <circle cx="5" cy="19" r="2" />
                <circle cx="19" cy="19" r="2" />
                <line x1="7" y1="6.5" x2="10" y2="10.5" />
                <line x1="17" y1="6.5" x2="14" y2="10.5" />
                <line x1="7" y1="17.5" x2="10" y2="13.5" />
                <line x1="17" y1="17.5" x2="14" y2="13.5" />
              </svg>
            </div>
            {conversations.isPending ? (
              <LoadingSkeleton tipo="lineas" cantidad={3} />
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
                <h2>¿Qué vamos a resolver?</h2>
                <p>Empieza un chat para hacer una pregunta, explorar una idea o trabajar con tus archivos.</p>
                <button
                  type="button"
                  className="tl-boton tl-boton-principal"
                  onClick={nuevoChat}
                  disabled={creandoChat}
                >
                  {creandoChat ? "Creando chat…" : "Nuevo chat"}
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
              {current?.project_name && current?.project_id && (
                <Link
                  to="/proyectos/$id"
                  params={{ id: current.project_id }}
                  className="tl-chip tl-chip-proyecto"
                  title={`Ir al proyecto: ${current.project_name}`}
                  style={{ textDecoration: "none", cursor: "pointer" }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  <span className="tl-chip-texto">{current.project_name}</span>
                </Link>
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
              <button
                type="button"
                className="tl-boton"
                aria-label="Contexto del chat"
                aria-haspopup="dialog"
                aria-expanded={contextoAbierto}
                title="Ver uso, sesión y mensajes guardados de este chat"
                ref={contextoRef}
                onClick={() => setContextoAbierto(true)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5M12 8h.01" />
                </svg>
                <span className="tl-boton-texto">Contexto</span>
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

          <div
            className="tl-hilo"
            ref={hiloRef}
            onScroll={actualizarSeguimientoHilo}
            onWheelCapture={(event) => alUsarRuedaEnHilo(event.deltaY)}
            onTouchStartCapture={alIniciarToqueEnHilo}
            onTouchMoveCapture={alMoverToqueEnHilo}
            onTouchEndCapture={alTerminarToqueEnHilo}
            onTouchCancelCapture={alTerminarToqueEnHilo}
          >
            <div className="tl-hilo-columna">
              {messages.isPending && <LoadingSkeleton tipo="contenido" cantidad={4} className="tl-carga-mensajes" />}
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
              {messages.data?.length === 0 && !enviandoActual && (
                <p className="tl-nota">Aún no hay mensajes. Escribe una instrucción para el agente o pulsa Ctrl+K para comandos.</p>
              )}
              {lista.map((m, i) => (
                <div key={m.id} className={`tl-hilo-evento${m.role === "user" ? " tl-hilo-evento-prompt" : ""}`}>
                  {m.role === "user" && (
                    <button
                      type="button"
                      className={`tl-hilo-hito${promptActivoId === m.id ? " is-activo" : ""}${hitos.includes(m.id) ? " is-marcado" : ""}`}
                      aria-label={`Ir al prompt ${indicePrompt.get(m.id) ?? ""}: ${etiquetaPrompt(m.content)}`}
                      aria-current={promptActivoId === m.id ? "location" : undefined}
                      title={`Prompt ${indicePrompt.get(m.id) ?? ""}${hitos.includes(m.id) ? " · Importante" : ""}`}
                      onClick={() => irAPrompt(m.id)}
                    >
                      <span className="tl-hilo-hito-trazo" aria-hidden="true" />
                      {hitos.includes(m.id) && <span className="tl-hilo-hito-marca" aria-hidden="true" />}
                    </button>
                  )}
                  {m.role === "system" ? (
                    <article className="tl-msg" aria-label="Aviso del sistema">
                      <p className="tl-alerta" role="status">{m.content}</p>
                      {!agenteOcupado && i === lista.length - 1 && lista.slice(0, i).some(p => p.role === "user") && (
                        <button type="button" className="tl-boton" onClick={() => reintentarAviso(m.id)}>Reintentar solicitud</button>
                      )}
                    </article>
                  ) : m.role === "user" ? (
                    <>
                      <MensajeUsuario
                        conversationId={selectedId ?? undefined}
                        id={`mensaje-${m.id}`}
                        texto={m.content}
                        cuando={m.created_at}
                        resaltado={resaltadoId === m.id}
                        marcado={hitos.includes(m.id)}
                        onToggleMarca={() => marcarPrompt(m.id)}
                      />
                    </>
                  ) : (
                    <>
                      <MensajeAgente
                        texto={m.content}
                        cuando={m.created_at}
                        modelo={m.model ? modelList.find((modelo) => modelo.id === m.model)?.name ?? m.model : null}
                        esfuerzo={m.effort}
                        onAbrirArchivo={current ? abrirArchivo : undefined}
                        permitirAbrirArchivo={permitirAbrirArchivoEnChat}
                        duracion={duracionDeRespuesta(i)}
                        proceso={
                          selectedId && turnoDeRespuesta(i)
                            ? { conversacionId: selectedId, turnoId: turnoDeRespuesta(i)! }
                            : undefined
                        }
                        onReintentar={
                          lista.slice(0, i).some((p) => p.role === "user") && !enviandoActual
                            ? () => reintentar(m.id)
                            : undefined
                        }
                        onGuardar={(formato) => crearDoc.mutate({ mensajeId: m.id, formato })}
                        guardando={crearDoc.isPending && crearDoc.variables?.mensajeId === m.id}
                        onCitar={(texto) => {
                          cambiarBorrador(texto);
                          window.setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                      />
                    </>
                  )}
                </div>
              ))}
              {enviandoActual && !yaGuardado && (
                <div className="tl-hilo-evento"><MensajeUsuario conversationId={selectedId ?? undefined} texto={envioActual?.content ?? ""} cuando={null} /></div>
              )}
              {pensando && (
                <IndicadorPensando
                  modelo={nombreAgente}
                  desde={inicioPensando}
                  vivo={(selectedId && vivos[selectedId]?.pasos) || []}
                />
              )}
              {tareaChat && (
                <div className="tl-tarea-seccion">
                  {!pensando && selectedId && (vivos[selectedId]?.pasos.length ?? 0) > 0 && (
                    <details className="tl-proceso-previo" style={{ marginBottom: "0.5rem" }} open>
                      <summary style={{ cursor: "pointer", fontSize: "0.85rem", opacity: 0.85 }}>
                        Consultas y acciones del analizador ({vivos[selectedId]?.pasos.filter((p) => p.tipo === "accion").length} acciones)
                      </summary>
                      <div style={{ marginTop: "0.5rem" }}>
                        <ProcesoAgente pasos={vivos[selectedId].pasos} />
                      </div>
                    </details>
                  )}
                  <PlanRevision key={`${tareaChat.id}:${tareaChat.plan_hash}`} tarea={tareaChat} />
                </div>
              )}
              {selectedId && current?.project_id && (
                <AccionesRepositorioChat
                  key={selectedId}
                  conversationId={selectedId}
                  projectId={current.project_id}
                  taskId={tareaChat?.id}
                  terminada={!!tareaChat && ["done", "failed", "cancelled", "interrupted"].includes(tareaChat.status)}
                  taskStatus={tareaChat?.status}
                />
              )}
              {tareasChat.isError && current?.project_id && <p className="tl-alerta" role="alert">{errorText(tareasChat.error)}</p>}
              {modeloAgotadoChat && !pensando && (
                <AvisoCuota
                  modeloAgotado={modelList.find((m) => m.id === modeloAgotadoChat)?.name ?? modeloAgotadoChat}
                  puedeSeguir={!!current?.model && current.model !== modeloAgotadoChat}
                  seguirPendiente={siguiendoActual}
                  onCambiarModelo={() => setPickerOpen(true)}
                  onSeguir={() => selectedId && seguirChat.mutate(selectedId)}
                  error={seguirChat.isError && seguirChat.variables === selectedId ? errorText(seguirChat.error) : null}
                />
              )}
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

            {cola.length > 0 && (
              <section
                ref={colaRef}
                className="tl-cola"
                aria-label={`${cola.length} ${cola.length === 1 ? "mensaje" : "mensajes"} en cola`}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMenuColaAbierto(null);
                }}
              >
                <div className="tl-cola-cabecera">
                  <span className="tl-cola-titulo">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 7H5a2 2 0 0 0-2 2v10h10v-3" />
                      <path d="M8 3h13v13H8z" />
                      <path d="M12 8h5M12 11h5" />
                    </svg>
                    <span>{cola.length} {cola.length === 1 ? "mensaje en cola" : "mensajes en cola"}</span>
                  </span>
                  <span className="tl-cola-estado" role="status">
                    {errorCola
                      ? "No se pudo enviar"
                      : !colaActiva
                        ? "Cola desactivada"
                        : agenteOcupado
                          ? "Se enviarán al terminar"
                          : "Enviando siguiente mensaje…"}
                  </span>
                </div>

                <div className="tl-cola-lista" aria-label="Mensajes pendientes">
                  {cola.map((item, indice) => (
                    <div
                      className={`tl-cola-item${mensajeArrastradoColaId === item.id ? " is-arrastrado" : ""}${destinoArrastreColaId === item.id ? " is-destino" : ""}`}
                      key={item.id}
                      onDragOver={(event) => {
                        if (!mensajeArrastradoColaId || mensajeArrastradoColaId === item.id || envioActual?.colaId === item.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDestinoArrastreColaId(item.id);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDestinoArrastreColaId(null);
                      }}
                      onDrop={(event) => soltarSobreCola(event, item.id)}
                    >
                      {editandoColaId === item.id ? (
                        <div className="tl-cola-editor">
                          <textarea
                            autoFocus
                            rows={2}
                            aria-label="Editar mensaje en cola"
                            value={textoEditadoCola}
                            onChange={(e) => setTextoEditadoCola(e.target.value)}
                          />
                          <div className="tl-cola-editor-acciones">
                            <button
                              type="button"
                              className="tl-boton tl-boton-compacto"
                              disabled={!textoEditadoCola.trim()}
                              onClick={() => {
                                cambiarCola(selectedId!, (mensajes) => mensajes.map((mensaje) =>
                                  mensaje.id === item.id ? { ...mensaje, texto: textoEditadoCola.trim() } : mensaje,
                                ));
                                setEditandoColaId(null);
                                setMenuColaAbierto(null);
                              }}
                            >
                              Guardar
                            </button>
                            <button type="button" className="tl-boton tl-boton-compacto" onClick={() => setEditandoColaId(null)}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="tl-cola-arrastre"
                            draggable={envioActual?.colaId !== item.id}
                            aria-label={`Arrastrar mensaje ${indice + 1} para reordenar`}
                            title="Arrastra para reordenar"
                            onDragStart={(event) => iniciarArrastreCola(event, item.id)}
                            onDragEnd={() => {
                              setMensajeArrastradoColaId(null);
                              setDestinoArrastreColaId(null);
                            }}
                          >
                            <svg width="14" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
                              <circle cx="3" cy="3" r="1" /><circle cx="9" cy="3" r="1" />
                              <circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" />
                              <circle cx="3" cy="13" r="1" /><circle cx="9" cy="13" r="1" />
                            </svg>
                          </button>
                          <p className="tl-cola-texto" title={item.texto}>
                            <span className="tl-cola-indice" aria-hidden="true">{indice + 1}</span>
                            {item.texto.replace(/\s+/g, " ").trim()}
                          </p>
                          <div className="tl-cola-acciones">
                            <button
                              type="button"
                              className="tl-cola-redirigir"
                              disabled={envioActual?.colaId === item.id}
                              title="Mover el mensaje al compositor"
                              aria-label={`Redirigir mensaje ${indice + 1} al compositor`}
                              onClick={() => redirigirMensajeCola(item)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 14 4 9l5-5" />
                                <path d="M4 9h9a7 7 0 0 1 7 7v3" />
                              </svg>
                              <span>Redirigir</span>
                            </button>
                            <button
                              type="button"
                              className="tl-accion-icono tl-cola-quitar"
                              disabled={envioActual?.colaId === item.id}
                              aria-label={`Quitar mensaje ${indice + 1} de la cola`}
                              title="Quitar de la cola"
                              onClick={() => cambiarCola(selectedId!, (mensajes) => mensajes.filter((mensaje) => mensaje.id !== item.id))}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" />
                              </svg>
                            </button>
                            <div className="tl-cola-menu-wrap">
                              <button
                                type="button"
                                className="tl-accion-icono"
                                disabled={envioActual?.colaId === item.id}
                                aria-label={`Más opciones para mensaje ${indice + 1}`}
                                aria-expanded={menuColaAbierto === item.id}
                                title="Más opciones"
                                onClick={() => setMenuColaAbierto((abierto) => abierto === item.id ? null : item.id)}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                  <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {menuColaItem && envioActual?.colaId !== menuColaItem.id && (
                  <div className="tl-cola-menu" role="menu">
                    <button type="button" role="menuitem" disabled={indiceMenuCola <= 0 || envioActual?.colaId === cola[indiceMenuCola - 1]?.id} onClick={() => moverCola(menuColaItem.id, -1)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
                      Subir en la cola
                    </button>
                    <button type="button" role="menuitem" disabled={indiceMenuCola < 0 || indiceMenuCola >= cola.length - 1 || envioActual?.colaId === cola[indiceMenuCola + 1]?.id} onClick={() => moverCola(menuColaItem.id, 1)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                      Bajar en la cola
                    </button>
                    <button type="button" role="menuitem" onClick={() => {
                      setTextoEditadoCola(menuColaItem.texto);
                      setEditandoColaId(menuColaItem.id);
                      setMenuColaAbierto(null);
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z" /></svg>
                      Editar mensaje
                    </button>
                    <button type="button" role="menuitem" onClick={() => redirigirMensajeCola(menuColaItem)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v3" /></svg>
                      Redirigir al compositor
                    </button>
                    <button type="button" role="menuitem" onClick={cambiarColaActiva}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={colaActiva ? "M18 6 6 18M6 6l12 12" : "M5 12h14M12 5v14"} /></svg>
                      {colaActiva ? "Desactivar cola" : "Activar cola"}
                    </button>
                  </div>
                )}
                {errorCola && (
                  <p className="tl-cola-error" role="alert">
                    El mensaje sigue guardado en la cola. <button type="button" onClick={() => setFalloCola(null)}>Reintentar</button>
                  </p>
                )}
              </section>
            )}

            <div className="tl-chat-navegacion" role="group" aria-label="Navegación del chat">
              <button type="button" onClick={irAlInicio} disabled={!mostrarIrAlInicio} aria-label="Ir al primer mensaje" title="Ir al primer mensaje">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7M5 3h14" /></svg>
              </button>
              <button type="button" onClick={irAlFinal} disabled={!mostrarIrAlFinal} aria-label="Ir al último mensaje" title="Ir al último mensaje">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14m-7-7 7 7 7-7M5 21h14" /></svg>
              </button>
            </div>
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

              {mediosAbierto && (
                <CapacidadesMedios
                  modelo={current?.model ?? null}
                  nombreModelo={modelInfo?.name ?? null}
                  onCerrar={() => setMediosAbierto(false)}
                  disparador={mediosRef}
                />
              )}

              {pendientes.length > 0 && (
                <ul className="tl-adjuntos-pendientes" aria-label="Archivos del mensaje">
                  {pendientes.map((p) => {
                    const { lectura } = p;
                    const nombre = lectura.tipo === "texto" ? lectura.adjunto.nombre : lectura.nombre;
                    const motivo = lectura.tipo === "texto"
                      ? "Se envía con el mensaje"
                      : lectura.tipo === "imagen"
                        ? "Se envía al agente como entrada visual; el modelo debe admitir imágenes"
                        : lectura.motivo;
                    const estado =
                      lectura.tipo === "texto"
                        ? `${etiquetaBytes(lectura.tamano)}${lectura.recortado ? " · recortado" : ""}`
                        : lectura.tipo === "imagen"
                          ? `${etiquetaBytes(lectura.tamano)} · se envía al agente`
                        : lectura.tipo === "solo_vista"
                          ? `${etiquetaBytes(lectura.tamano)} · no se envía · solo texto`
                          : "No se añadió";
                    const imagen = lectura.tipo === "imagen" || (lectura.tipo === "solo_vista" && lectura.imagen);
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

              {menuSkillsAbierto && (
                <MenuSkillsChat
                  skills={skillsFiltradas}
                  prefijo={tokenSkill!.prefijo}
                  activo={indiceSkillActivo}
                  onElegir={elegirSkill}
                />
              )}

              {menuAbierto && !menuSkillsAbierto && (
                <MenuComandosChat comandos={comandosFiltrados} activo={indiceSlash} onElegir={elegirComando} />
              )}

              <textarea
                ref={inputRef}
                className="tl-composer-input"
                rows={2}
                value={draft}
                placeholder={sugerencia ?? (
                  planPendiente
                    ? "Responde las preguntas del plan"
                    : agenteOcupado && colaActiva
                    ? "El agente responde; escribe en cola"
                    : "Escribe un mensaje"
                )}
                aria-label={planPendiente ? "Aclaraciones o cambios al plan" : "Mensaje"}
                aria-description={sugerencia ? "Pulsa Tab para insertar la recomendación." : undefined}
                aria-autocomplete={menuSkillsAbierto || menuAbierto ? "list" : undefined}
                aria-activedescendant={
                  menuSkillsAbierto
                    ? `skill-opcion-${skillsFiltradas[indiceSkillActivo]?.nombre}`
                    : menuAbierto
                    ? `comando-chat-${comandosFiltrados[indiceSlash]?.id}`
                    : undefined
                }
                onChange={(e) => cambiarBorrador(e.target.value)}
                onPaste={alPegar}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.nativeEvent.isComposing) return;
                  if (menuSkillsAbierto) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const paso = e.key === "ArrowDown" ? 1 : -1;
                      setSkillIndex((indiceSkillActivo + paso + skillsFiltradas.length) % skillsFiltradas.length);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSkillPickerOculto(true);
                      return;
                    }
                    if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      elegirSkill(skillsFiltradas[indiceSkillActivo]!);
                      return;
                    }
                  }
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
                  if (e.key === "Tab" && !e.shiftKey && !menuAbierto && !menuSkillsAbierto && sugerencia) {
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

              {/* Herramientas, selector conjunto de modelo y esfuerzo, botón de uso y envío. */}
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
                      setMediosAbierto(false);
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

                  <button
                    ref={usoRef}
                    type="button"
                    className="tl-boton tl-boton-compacto tl-uso"
                    aria-haspopup="dialog"
                    aria-expanded={usoAbierto}
                    onClick={() => {
                      setPickerOpen(false);
                      setMediosAbierto(false);
                      setUsoAbierto((o) => !o);
                    }}
                  >
                    Uso
                  </button>

                  <button
                    ref={mediosRef}
                    type="button"
                    className="tl-boton tl-boton-compacto tl-uso tl-medios-boton"
                    aria-label="Capacidades multimedia"
                    title="Capacidades multimedia"
                    aria-haspopup="dialog"
                    aria-expanded={mediosAbierto}
                    onClick={() => {
                      setPickerOpen(false);
                      setUsoAbierto(false);
                      setMediosAbierto((o) => !o);
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m10 9 5 3-5 3z" />
                    </svg>
                    <span className="tl-medios-boton-texto">Medios</span>
                  </button>
                </div>

                <div className="tl-composer-der">
                  {planPendiente ? (
                    <div className="tl-composer-decisiones">
                      <button
                        type="button"
                        className="ghost tl-boton-plan-cancelar"
                        disabled={cancelarPlanMutation.isPending || decidirPlanMutation.isPending}
                        onClick={() => {
                          if (tareaChat?.id) cancelarPlanMutation.mutate(tareaChat.id);
                        }}
                        title="Cancelar la tarea actual"
                      >
                        {cancelarPlanMutation.isPending ? "Cancelando…" : "Cancelar tarea"}
                      </button>
                      {draft.trim() && (
                        <button
                          type="button"
                          className="ghost tl-boton-plan-reanalizar"
                          disabled={decidirPlanMutation.isPending}
                          onClick={() => {
                            decidirPlanMutation.mutate({ decision: "revise", feedback: draft.trim() });
                          }}
                          title="Solicitar al analizador que elabore un nuevo plan con estas aclaraciones"
                        >
                          {decidirPlanMutation.isPending ? "Enviando…" : "Re-analizar plan"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="primary tl-boton-plan-aprobar"
                        disabled={decidirPlanMutation.isPending}
                        onClick={() => {
                          decidirPlanMutation.mutate({ decision: "approve", feedback: draft.trim() || undefined });
                        }}
                        title={draft.trim() ? "Aprobar el plan incluyendo tus notas" : "Aprobar el plan"}
                      >
                        {decidirPlanMutation.isPending ? "Aprobando…" : "Aprobar plan"}
                      </button>
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            </div>
            <p className="tl-composer-nota">
              Los agentes trabajan en el servidor de forma persistente. Revisa sus cambios antes de aplicarlos.
            </p>
          </form>

          {mostrarPanelArchivo && archivoAbierto && (
            <div
              className="tl-chat-archivo-separador"
              role="separator"
              tabIndex={0}
              aria-label="Ajustar el espacio entre el chat y el archivo"
              aria-orientation={vistaMovil ? "horizontal" : "vertical"}
              aria-valuemin={vistaMovil ? 180 : 260}
              aria-valuemax={limitesSeparadorArchivo().maximo}
              aria-valuenow={vistaMovil
                ? altoArchivo ?? Math.round(Math.max(180, Math.min(320, window.innerHeight * 0.34)))
                : anchoArchivo ?? Math.round(Math.max(260, Math.min(560, window.innerWidth * 0.42)))}
              title={vistaMovil ? "Arrastra o usa ↑/↓ para cambiar el alto" : "Arrastra o usa ←/→ para cambiar el ancho"}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={moverSeparadorArchivo}
              onKeyDown={tecladoSeparadorArchivo}
            />
          )}
          {mostrarPanelArchivo && archivoAbierto && current && (
            <ChatArchivoPreview
              conversationId={current.id}
              referencia={archivoAbierto}
              onClose={cerrarArchivo}
              onSelectPath={(ruta) => setArchivoAbierto({ ruta, linea: archivoAbierto.linea })}
            />
          )}

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

          {contextoAbierto && current && (
            <ChatContexto
              conversationId={current.id}
              messages={messages.data ?? []}
              models={modelList}
              onClose={() => setContextoAbierto(false)}
              disparador={contextoRef}
            />
          )}

          {vistaDoc && <VistaDocumento documento={vistaDoc} onCerrar={() => setVistaDoc(null)} />}
        </>
      )}
    </section>
  );
}
