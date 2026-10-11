import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { ChatPage } from "./pages/chat";
import { LoginPage } from "./pages/login";
import { TasksPage } from "./pages/tasks";
import { AnalyticsPage } from "./pages/analytics";
import { SettingsPage } from "./pages/settings";
import { ProjectsPage } from "./pages/proyectos";
import { ProjectDetailPage } from "./pages/proyecto";
import { ServerPage } from "./pages/servidor";

import { ShellProvider } from "./components/shell-context";
import { Shell } from "./components/shell";

function Layout() {
  // La pantalla de entrada va sin barra lateral.
  const sinMarco = useRouterState({ select: (s) => s.location.pathname === "/entrar" });
  if (sinMarco) return <Outlet />;
  return (
    <ShellProvider>
      <Shell>
        <Outlet />
      </Shell>
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
const serverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/servidor", component: ServerPage });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tareas", component: TasksPage });
const taskDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tareas/$id", component: TasksPage });
const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/proyectos", component: ProjectsPage });
const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proyectos/$id",
  component: ProjectDetailPage,
});
const analyticsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/analiticas", component: AnalyticsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/ajustes", component: SettingsPage });
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
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
