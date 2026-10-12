import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Identifica cada build. La app lo compara con version.json para avisar de cambios.
const buildId = Date.now().toString(36);

// Escribe version.json junto al build.
function versionFile(): Plugin {
  return {
    name: "telo-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: buildId }) });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      // "prompt": la versión nueva espera y la app pregunta antes de recargar.
      registerType: "prompt",
      // El service worker no debe responder las rutas de la API: la vuelta de Google y las descargas
      // llegan al servidor, no al index.html guardado en caché.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "Telo",
        short_name: "Telo",
        description: "Telo, orquestador de agentes de IA",
        theme_color: "#111419",
        background_color: "#111419",
        display: "standalone",
        id: "/",
        scope: "/",
        start_url: "/chat",
        lang: "es",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
