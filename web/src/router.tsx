import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { ChatPage } from "./pages/chat";

function Layout() {
  return <Outlet />;
}

function Status() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 15_000,
  });

  return (
    <main className="status-page">
      <Link to="/chat" className="back">
        Volver al chat
      </Link>
      <h1>Estado</h1>
      {health.isPending && <p className="muted-note">Consultando…</p>}
      {health.isError && <p className="error">Sin conexión con el servidor.</p>}
      {health.data && (
        <p>
          API {health.data.ok ? "activa" : "con errores"}
          <span className="muted-note"> · {new Date(health.data.time).toLocaleTimeString()}</span>
        </p>
      )}
    </main>
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
const statusRoute = createRoute({ getParentRoute: () => rootRoute, path: "/estado", component: Status });
const routeTree = rootRoute.addChildren([indexRoute, chatRoute, statusRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
