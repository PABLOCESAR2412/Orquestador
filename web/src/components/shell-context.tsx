import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

interface ShellContextType {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  closeDrawer: () => void;
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
  newTaskOpen: boolean;
  setNewTaskOpen: (open: boolean) => void;
  triggerNewTask: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  triggerPalette: () => void;
  closePalette: () => void;
}

const ShellContext = createContext<ShellContextType | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const routerState = useRouterState();

  const toggleDrawer = useCallback(() => setDrawerOpen((prev) => !prev), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const triggerPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const triggerNewTask = useCallback(() => {
    setNewTaskOpen(true);
    closeDrawer();
    const currentPath = routerState.location.pathname;
    if (currentPath !== "/tareas") {
      void navigate({ to: "/tareas" });
    }
  }, [closeDrawer, navigate, routerState.location.pathname]);

  // Shortcut ⌘N / Ctrl+N para nueva tarea
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Solo ⌘N o Ctrl+N: Ctrl+Shift+N (ventana privada) y Alt siguen siendo del navegador.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        triggerNewTask();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerNewTask]);

  return (
    <ShellContext.Provider
      value={{
        drawerOpen,
        setDrawerOpen,
        toggleDrawer,
        closeDrawer,
        selectedConversationId,
        setSelectedConversationId,
        newTaskOpen,
        setNewTaskOpen,
        triggerNewTask,
        paletteOpen,
        setPaletteOpen,
        triggerPalette,
        closePalette,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellContextType {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell debe usarse dentro de un ShellProvider");
  }
  return ctx;
}
