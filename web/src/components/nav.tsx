import { Link } from "@tanstack/react-router";

const ITEMS = [
  { to: "/chat", label: "Chat" },
  { to: "/tareas", label: "Tareas" },
  { to: "/analiticas", label: "Analíticas" },
  { to: "/ajustes", label: "Ajustes" },
  { to: "/estado", label: "Estado" },
] as const;

// Navegación compartida. "rail" va dentro del riel del chat; "row" debajo de los títulos.
export function AppNav({ variant = "row" }: { variant?: "row" | "rail" }) {
  return (
    <nav className={`app-nav app-nav-${variant}`} aria-label="Principal">
      {ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="app-link"
          activeProps={{ className: "app-link active", "aria-current": "page" as const }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
