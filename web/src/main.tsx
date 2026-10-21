import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@fontsource/geist-sans";
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/instrument-sans";
import { router } from "./router";
import { captureInstallPrompt } from "./lib/install";
import { aplicarTema } from "./lib/tema";
import { UpdatePrompt } from "./components/update-prompt";
import "./styles.css";

captureInstallPrompt();
// Aplica el tema guardado en este dispositivo antes de montar la app.
aplicarTema();

// Al volver a la app (teléfono o pestaña) los datos se actualizan solos. Sin esto, un mensaje
// enviado desde la PC no aparecía en el teléfono hasta cambiar de chat.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </QueryClientProvider>
  </StrictMode>,
);
