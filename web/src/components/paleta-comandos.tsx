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
  const [abierta, setAbierta] = useState(false);
  // Elemento que tenía el foco al abrir: vuelve a recibirlo al cerrar.
  const previo = useRef<HTMLElement | null>(null);

  const abrir = () => {
    previo.current = document.activeElement as HTMLElement | null;
    setAbierta(true);
  };
  const cerrar = () => {
    setAbierta(false);
    const el = previo.current;
    previo.current = null;
    if (el && el.isConnected) el.focus();
  };

  useEffect(() => {
    if (abierta) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        abrir();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierta]);

  if (!abierta) return null;
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

  const comandos: Comando[] = [
    {
      id: "nuevo-chat",
      grupo: "Chat",
      etiqueta: "Nuevo chat",
      alias: "conversacion",
      ejecutar: async () => {
        const conv = await api.createConversation(null);
        await qc.invalidateQueries({ queryKey: ["conversations"] });
        setSelectedConversationId(conv.id);
        await navigate({ to: "/chat" });
      },
    },
    { id: "nueva-tarea", grupo: "Tareas", etiqueta: "Nueva tarea", alias: "lanzar agente", ejecutar: () => triggerNewTask() },
    { id: "ir-chat", grupo: "Ir a", etiqueta: "Ir a Chat", ejecutar: () => navigate({ to: "/chat" }) },
    { id: "ir-tareas", grupo: "Ir a", etiqueta: "Ir a Tareas", ejecutar: () => navigate({ to: "/tareas" }) },
    { id: "ir-proyectos", grupo: "Ir a", etiqueta: "Ir a Proyectos", ejecutar: () => navigate({ to: "/proyectos" }) },
    { id: "ir-analiticas", grupo: "Ir a", etiqueta: "Ir a Analíticas", alias: "costos uso", ejecutar: () => navigate({ to: "/analiticas" }) },
    { id: "ir-servidor", grupo: "Ir a", etiqueta: "Ir a Servidor", alias: "estado", ejecutar: () => navigate({ to: "/servidor" }) },
    { id: "ir-ajustes", grupo: "Ir a", etiqueta: "Ir a Ajustes", ejecutar: () => navigate({ to: "/ajustes" }) },
    { id: "tema-oscuro", grupo: "Tema", etiqueta: "Tema oscuro", ejecutar: () => guardarTema("oscuro") },
    { id: "tema-claro", grupo: "Tema", etiqueta: "Tema claro", ejecutar: () => guardarTema("claro") },
    { id: "tema-sistema", grupo: "Tema", etiqueta: "Tema del sistema", alias: "automatico", ejecutar: () => guardarTema("sistema") },
  ];

  // Cada palabra escrita debe aparecer en el nombre, el grupo o las palabras extra.
  const palabras = normalizar(consulta.trim()).split(/\s+/).filter(Boolean);
  const lista = comandos.filter((c) => {
    const texto = normalizar(`${c.etiqueta} ${c.grupo} ${c.alias ?? ""}`);
    return palabras.every((p) => texto.includes(p));
  });
  const indice = Math.min(activo, Math.max(lista.length - 1, 0));
  const idActivo = lista[indice] ? `paleta-op-${lista[indice].id}` : undefined;

  // Mantiene visible la opción marcada al moverse con el teclado.
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
    // Ctrl+K con la paleta abierta la cierra.
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
      className="paleta-capa"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Paleta de comandos" ref={dialogRef}>
        <input
          className="paleta-buscar"
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

        <ul id="paleta-lista" role="listbox" aria-label="Comandos" className="paleta-lista" aria-busy={ocupado}>
          {lista.map((cmd, i) => (
            <li
              key={cmd.id}
              id={`paleta-op-${cmd.id}`}
              role="option"
              aria-selected={i === indice}
              className="paleta-opcion"
              onMouseEnter={() => setActivo(i)}
              onClick={() => void ejecutar(cmd)}
            >
              <span>{cmd.etiqueta}</span>
              <span className="paleta-grupo">{cmd.grupo}</span>
            </li>
          ))}
        </ul>

        {lista.length === 0 && <p className="muted-note paleta-vacio">Ningún comando coincide.</p>}
        {error && (
          <p className="error paleta-vacio" role="alert">
            {error}
          </p>
        )}
        <p className="paleta-pie">{ocupado ? "Ejecutando…" : "Flechas para moverte · Enter para elegir · Esc para cerrar"}</p>
      </div>
    </div>
  );
}
