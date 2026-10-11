import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@fontsource-variable/instrument-sans";
import { router } from "./router";
import { captureInstallPrompt } from "./lib/install";
import { UpdatePrompt } from "./components/update-prompt";
import "./styles.css";

captureInstallPrompt();

// Al volver a la app (teléfono o pestaña) los datos se actualizan solos. Sin esto, un mensaje
// enviado desde la PC no aparecía en el teléfono hasta cambiar de chat.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </QueryClientProvider>
  </StrictMode>,
);
