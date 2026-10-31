import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ChatPage = lazy(() => import("./pages/chat").then((m) => ({ default: m.ChatPage })));
const LoginPage = lazy(() => import("./pages/login").then((m) => ({ default: m.LoginPage })));
const TasksPage = lazy(() => import("./pages/tasks").then((m) => ({ default: m.TasksPage })));
const AnalyticsPage = lazy(() => import("./pages/analytics").then((m) => ({ default: m.AnalyticsPage })));
const BrainPage = lazy(() => import("./pages/cerebro").then((m) => ({ default: m.BrainPage })));
const OfficePage = lazy(() => import("./pages/oficina").then((m) => ({ default: m.OfficePage })));
const SettingsPage = lazy(() => import("./pages/settings").then((m) => ({ default: m.SettingsPage })));
const ProjectsPage = lazy(() => import("./pages/proyectos").then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import("./pages/proyecto").then((m) => ({ default: m.ProjectDetailPage })));

import { ShellProvider } from "./components/shell-context";
import { Shell } from "./components/shell";

function Layout() {
  // La pantalla de entrada va sin barra lateral.
  const sinMarco = useRouterState({ select: (s) => s.location.pathname === "/entrar" });
  const contenido = (
    <Suspense fallback={<p className="muted-note container" role="status">Cargando pantalla…</p>}>
      <Outlet />
    </Suspense>
  );
  if (sinMarco) return contenido;
  return (
    <ShellProvider>
      <Shell>{contenido}</Shell>
    </ShellProvider>
  );
}

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/chat" });
  },
});
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: "/chat", component: ChatPage });
// /estado se conserva como enlace: la vista del servidor la reemplaza.
const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/estado",
  beforeLoad: () => {
    throw redirect({ to: "/servidor" });
  },
});
// /servidor vive ahora como pestaña de Ajustes y Servidor.
const serverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/servidor",
  beforeLoad: () => {
    throw redirect({ to: "/ajustes", search: { pestana: "servidor" } });
  },
});
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tareas", component: TasksPage });
const taskDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tareas/$id", component: TasksPage });
const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/proyectos", component: ProjectsPage });
const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proyectos/$id",
  component: ProjectDetailPage,
});
const brainRoute = createRoute({ getParentRoute: () => rootRoute, path: "/cerebro", component: BrainPage });
const officeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/oficina", component: OfficePage });
const analyticsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/analiticas", component: AnalyticsPage });
// La pestaña va en la URL (?pestana=) para que se pueda enlazar y el redirect de /servidor la abra.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ajustes",
  component: SettingsPage,
  // Opcional: sin pestaña, se abre "Proveedores IA" (así siguen válidos los enlaces sin parámetros).
  validateSearch: (busqueda: Record<string, unknown>): { pestana?: "personalizacion" | "proveedores" | "conexiones" | "servidor" | "almacenamiento" } => ({
    pestana:
      busqueda.pestana === "personalizacion" || busqueda.pestana === "proveedores"
        || busqueda.pestana === "conexiones" || busqueda.pestana === "servidor" || busqueda.pestana === "almacenamiento"
        ? busqueda.pestana
        : undefined,
  }),
});
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/entrar", component: LoginPage });
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  chatRoute,
  statusRoute,
  serverRoute,
  tasksRoute,
  taskDetailRoute,
  projectsRoute,
  projectDetailRoute,
  analyticsRoute,
  brainRoute,
  officeRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
