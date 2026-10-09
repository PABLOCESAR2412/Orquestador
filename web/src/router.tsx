import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ChatPage } from "./pages/chat";
import { TasksPage } from "./pages/tasks";
import { AnalyticsPage } from "./pages/analytics";
import { SettingsPage } from "./pages/settings";

import { StatusPage } from "./pages/status";

import { ShellProvider } from "./components/shell-context";
import { Shell } from "./components/shell";

function Layout() {
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
const statusRoute = createRoute({ getParentRoute: () => rootRoute, path: "/estado", component: StatusPage });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tareas", component: TasksPage });
const analyticsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/analiticas", component: AnalyticsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/ajustes", component: SettingsPage });
const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  statusRoute,
  tasksRoute,
  analyticsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
