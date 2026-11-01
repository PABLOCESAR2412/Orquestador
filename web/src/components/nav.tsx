import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

// Los chats no tienen enlace propio: se listan debajo, en la barra lateral.
const ITEMS: NavItem[] = [
  {
    to: "/tareas",
    label: "Tareas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    to: "/proyectos",
    label: "Proyectos",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
  {
    to: "/analiticas",
    label: "Analíticas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    to: "/oficina",
    label: "Oficina",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11M15 3v7"/></svg>,
  },
  {
    to: "/cerebro",
    label: "Cerebro",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="7" r="2" /><circle cx="17" cy="5" r="2" /><circle cx="14" cy="17" r="2" /><circle cx="5" cy="18" r="2" />
        <path d="m8 7 7-1M7 9l-1 7m2 2 4-1m3-2 2-7" />
      </svg>
    ),
  },
  {
    to: "/ajustes",
    label: "Ajustes",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    to: "/servidor",
    label: "Servidor",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
];

export function AppNav({
  variant = "sidebar",
  onItemClick,
}: {
  variant?: "sidebar" | "row" | "rail";
  onItemClick?: () => void;
}) {
  if (variant === "row") {
    return (
      <nav className="top-nav" aria-label="Navegación principal">
        <div className="nav-inner">
          <div className="nav-links">
            {ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="nav-link"
                activeProps={{ className: "nav-link active", "aria-current": "page" as const }}
                onClick={onItemClick}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    );
  }

  if (variant === "rail") {
    return (
      <nav className="app-nav app-nav-rail" aria-label="Principal">
        {ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="app-link"
            activeProps={{ className: "app-link active", "aria-current": "page" as const }}
            onClick={onItemClick}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  // En el riel, Servidor ya no es un ítem: su pantalla se une a Ajustes.
  return (
    <nav className="sidebar-nav" aria-label="Navegación principal">
      {ITEMS.filter((item) => item.to !== "/servidor").map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="sidebar-link"
          activeProps={{ className: "sidebar-link active", "aria-current": "page" as const }}
          onClick={onItemClick}
        >
          <span className="sidebar-link-icon">{item.icon}</span>
          <span className="sidebar-link-label">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
