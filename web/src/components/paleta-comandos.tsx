import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { guardarTema } from "../lib/tema";
import { useDialogo } from "./controls";
import { useShell } from "./shell-context";

type Comando = {
  id: string;
  grupo: string;
  etiqueta: string;
  // Palabras extra que también encuentran el comando al escribir.
  alias?: string;
  ejecutar: () => Promise<unknown> | void;
};

// Quita tildes y pasa a minúsculas: "analiticas" encuentra "Analíticas".
const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Ctrl+K o Cmd+K abre la paleta desde cualquier pantalla. Monta la hoja solo mientras está abierta.
export function PaletaComandos() {
  const { paletteOpen, setPaletteOpen, closePalette } = useShell();
  const previo = useRef<HTMLElement | null>(null);

  const abrir = () => {
    previo.current = document.activeElement as HTMLElement | null;
    setPaletteOpen(true);
  };

  const cerrar = () => {
    closePalette();
    const el = previo.current;
    previo.current = null;
    if (el && el.isConnected) el.focus();
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteOpen) cerrar();
        else abrir();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  if (!paletteOpen) return null;
  return <HojaComandos onCerrar={cerrar} />;
}

function HojaComandos({ onCerrar }: { onCerrar: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { triggerNewTask, setSelectedConversationId } = useShell();
  const [consulta, setConsulta] = useState("");
  const [activo, setActivo] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogo(dialogRef, onCerrar);

  const comandos: (Comando & { shortcut?: string })[] = [
    {
      id: "nuevo-chat",
      grupo: "NUEVO CHAT",
      etiqueta: "Nuevo chat",
      shortcut: "Ctrl+N",
      alias: "conversacion",
      ejecutar: async () => {
        const conv = await api.createConversation(null);
        await qc.invalidateQueries({ queryKey: ["conversations"] });
        setSelectedConversationId(conv.id);
        await navigate({ to: "/chat" });
      },
    },
    {
      id: "nueva-tarea",
      grupo: "TAREAS",
      etiqueta: "Nueva tarea",
      shortcut: "Ctrl+T",
      alias: "lanzar agente",
      ejecutar: () => triggerNewTask(),
    },
    { id: "ir-chat", grupo: "IR A", etiqueta: "Chat", ejecutar: () => navigate({ to: "/chat" }) },
    { id: "ir-tareas", grupo: "IR A", etiqueta: "Tareas", ejecutar: () => navigate({ to: "/tareas" }) },
    { id: "ir-proyectos", grupo: "IR A", etiqueta: "Proyectos", ejecutar: () => navigate({ to: "/proyectos" }) },
    { id: "ir-analiticas", grupo: "IR A", etiqueta: "Analíticas", alias: "costos uso", ejecutar: () => navigate({ to: "/analiticas" }) },
    { id: "ir-servidor", grupo: "IR A", etiqueta: "Servidor", alias: "estado", ejecutar: () => navigate({ to: "/servidor" }) },
    { id: "ir-ajustes", grupo: "IR A", etiqueta: "Ajustes", ejecutar: () => navigate({ to: "/ajustes" }) },
    { id: "tema-oscuro", grupo: "TEMA", etiqueta: "Tema oscuro", ejecutar: () => guardarTema("oscuro") },
    { id: "tema-claro", grupo: "TEMA", etiqueta: "Tema claro", ejecutar: () => guardarTema("claro") },
    { id: "tema-sistema", grupo: "TEMA", etiqueta: "Tema del sistema", alias: "automatico", ejecutar: () => guardarTema("sistema") },
  ];

  const palabras = normalizar(consulta.trim()).split(/\s+/).filter(Boolean);
  const lista = comandos.filter((c) => {
    const texto = normalizar(`${c.etiqueta} ${c.grupo} ${c.alias ?? ""}`);
    return palabras.every((p) => texto.includes(p));
  });
  const indice = Math.min(activo, Math.max(lista.length - 1, 0));
  const idActivo = lista[indice] ? `paleta-op-${lista[indice].id}` : undefined;

  useEffect(() => {
    if (idActivo) document.getElementById(idActivo)?.scrollIntoView({ block: "nearest" });
  }, [idActivo]);

  const ejecutar = async (cmd: Comando) => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      await cmd.ejecutar();
    } catch (err) {
      setError(errorText(err));
      setOcupado(false);
      return;
    }
    onCerrar();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      onCerrar();
      return;
    }
    if (e.key === "ArrowDown" && lista.length) {
      e.preventDefault();
      setActivo((indice + 1) % lista.length);
    } else if (e.key === "ArrowUp" && lista.length) {
      e.preventDefault();
      setActivo((indice - 1 + lista.length) % lista.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = lista[indice];
      if (cmd) void ejecutar(cmd);
    }
  };

  return (
    <div
      className="cmd-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="cmd-palette-box" role="dialog" aria-modal="true" aria-label="Paleta de comandos" ref={dialogRef}>
        <div className="cmd-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--ink-2)", flexShrink: 0 }} aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="cmd-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            aria-autocomplete="list"
            aria-activedescendant={idActivo}
            aria-label="Buscar comando"
            placeholder="Escribe un comando"
            autoFocus
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setActivo(0);
              setError(null);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="cmd-esc-note">Esc</span>
        </div>

        <div id="paleta-lista" role="listbox" aria-label="Comandos" className="cmd-list" aria-busy={ocupado}>
          {lista.map((cmd, i) => {
            const esPrimeroDelGrupo = i === 0 || lista[i - 1].grupo !== cmd.grupo;
            return (
              <div key={cmd.id}>
                {esPrimeroDelGrupo && <div className="cmd-group-label">{cmd.grupo}</div>}
                <div
                  id={`paleta-op-${cmd.id}`}
                  role="option"
                  aria-selected={i === indice}
                  className={`cmd-item${i === indice ? " active" : ""}`}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => void ejecutar(cmd)}
                >
                  <span>{cmd.etiqueta}</span>
                  {cmd.shortcut && <span className="cmd-item-shortcut">{cmd.shortcut}</span>}
                </div>
              </div>
            );
          })}
          {lista.length === 0 && <p className="cmd-empty">Ningún comando coincide.</p>}
          {error && (
            <p className="cmd-empty error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
