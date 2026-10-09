import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

async function fetchHealth(): Promise<{ ok: boolean; time: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function Layout() {
  return (
    <div className="app">
      <nav className="sidebar">
        <strong>Orquestador</strong>
        <Link to="/">Inicio</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  });

  return (
    <section>
      <h1>Estado del servidor</h1>
      {health.isPending && <p>Consultando…</p>}
      {health.isError && <p>Sin conexión con el servidor.</p>}
      {health.data && (
        <p>
          API {health.data.ok ? "activa" : "con errores"} ·{" "}
          {new Date(health.data.time).toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
